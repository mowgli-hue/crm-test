// ─────────────────────────────────────────────────────────────────────
// POST /api/integrations/nimmi/payment
//
// Nimmi → CRM webhook. Fires when a client PAYS on Nimmi. It creates a real
// CRM case for the paid service so the work lands in the team's pipeline
// automatically — no manual re-entry.
//
// Setup:
//   1. This file.
//   2. Env: NIMMI_WEBHOOK_SECRET = the same value as Nimmi's CRM_WEBHOOK_SECRET.
//   3. saveNimmiCase() below is wired to the CRM's real createCase() — it
//      actually writes a case. If the write throws (DB down, etc.) the route
//      returns 500 so Nimmi marks the push failed and retries — no false success.
//
// Idempotent: createCase() dedupes by company+client+formType(+phone) within
// 24h, and we also key sourceLeadKey on the Nimmi payment id, so Nimmi retries
// never spawn duplicate cases.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createCase } from "@/lib/store";
import { verifyNimmiWebhook } from "@/lib/nimmi/webhook-utils";

export const runtime = "nodejs";

const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

// Map Nimmi service slugs / names → CRM form types. Falls back to the raw
// service string when unmapped, so an unknown service still creates a case
// (a human can correct the type) rather than getting lost.
const SERVICE_TO_FORM_TYPE: Record<string, string> = {
  pgwp: "PGWP",
  "post-graduation-work-permit": "PGWP",
  "study-permit-extension": "Study Permit Extension",
  "study-permit": "Study Permit (Outside Canada)",
  "visitor-record": "Visitor Record (Extension)",
  trv: "TRV (Inside Canada)",
  "visitor-visa": "Visitor Visa (TRV - Outside Canada)",
  "super-visa": "Super Visa",
  sowp: "Spousal Open Work Permit (SOWP)",
  "spousal-open-work-permit": "Spousal Open Work Permit (SOWP)",
  vowp: "Vulnerable Open Work Permit",
  bowp: "Bridging Open Work Permit (BOWP)",
  lmia: "LMIA-Based Work Permit",
  "lmia-work-permit": "LMIA + Work Permit",
  "express-entry": "Express Entry PR Application",
  "express-entry-profile": "Express Entry Profile Creation",
  pnp: "PNP",
  "spousal-sponsorship-inside": "Spousal Sponsorship (Inside Canada)",
  "spousal-sponsorship-outside": "Spousal Sponsorship (Outside Canada)",
  "pr-card-renewal": "PR Card Renewal",
  citizenship: "Citizenship Application",
  restoration: "Restoration (Work/Study/Visitor)",
  consultation: "PR Consultation",
  "pr-consultation": "PR Consultation",
};

function toFormType(services: unknown): string {
  const list = Array.isArray(services) ? services : services ? [services] : [];
  const first = String(list[0] ?? "").trim();
  if (!first) return "Other (Nimmi)";
  const key = first.toLowerCase().replace(/\s+/g, "-");
  return SERVICE_TO_FORM_TYPE[key] || SERVICE_TO_FORM_TYPE[first.toLowerCase()] || first;
}

// Actually writes the case. Throws on failure so the caller returns 500 and
// Nimmi retries — we never report success without a real case.
async function saveNimmiCase(body: any) {
  const fullName =
    [body.first_name, body.last_name].filter(Boolean).join(" ").trim() ||
    String(body.email || "").trim() ||
    "Nimmi Client";

  const amount = Number(body.amount ?? body.final_amount ?? 0) || undefined;
  const ref = String(body.payment_reference || body.nimmi_payment_id || "").trim();
  const notes = [
    "💰 Created from a paid Nimmi order.",
    ref ? `Payment ref: ${ref}` : null,
    amount ? `Amount paid: $${amount}` : null,
    body.email ? `Email: ${body.email}` : null,
    Array.isArray(body.services) ? `Services: ${body.services.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const newCase = await createCase({
    companyId: DEFAULT_COMPANY_ID,
    client: fullName,
    formType: toFormType(body.services),
    leadPhone: body.phone ? String(body.phone) : undefined,
    leadEmail: body.email ? String(body.email) : undefined,
    additionalNotes: notes,
    totalCharges: amount,
    // Keyed on the Nimmi payment id so retries return the same case, not a new one.
    sourceLeadKey: `nimmi-payment:${body.nimmi_payment_id || ref || fullName}`,
  });
  return newCase;
}

export async function POST(req: NextRequest) {
  // 1) Verify the shared secret (returns an error response if invalid/missing).
  const denied = verifyNimmiWebhook(req);
  if (denied) return denied;

  // 2) Parse.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.nimmi_payment_id || !(body.amount ?? body.final_amount)) {
    return NextResponse.json({ error: "Missing required fields (nimmi_payment_id, amount)" }, { status: 400 });
  }

  // 3) Write the case. If this throws, return 500 so Nimmi retries.
  try {
    const created = await saveNimmiCase(body);

    // Best-effort: ping the team that a paid client just landed (non-fatal).
    try {
      const { notifyAlertRecipients } = await import("@/lib/owner-alerts");
      const phoneDigits = String(body.phone || "").replace(/\D/g, "");
      const svc = Array.isArray(body.services) ? body.services.join(", ") : String(body.services || "");
      await notifyAlertRecipients({
        key: phoneDigits || String(body.nimmi_payment_id),
        clientName: created.client,
        clientPhone: phoneDigits || "—",
        context: `💰 PAID on Nimmi → case ${created.id} created${svc ? ` (${svc})` : ""}. Please action it.`,
      });
    } catch (e) {
      console.error("[nimmi/payment] alert failed (non-fatal):", (e as Error).message);
    }

    return NextResponse.json({ ok: true, caseId: created.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[nimmi/payment] case creation failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
