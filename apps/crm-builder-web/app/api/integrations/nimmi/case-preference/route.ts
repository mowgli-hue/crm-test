// ─────────────────────────────────────────────────────────────────────
// POST /api/integrations/nimmi/case-preference
//
// Nimmi → CRM. A referral agent SUGGESTED a preferred processor for their
// client's case. We record it as a NOTE on the case (remarks) — we do NOT set
// assignedTo, because the RCIC/Newton team keeps the final say on who works a
// file. Matches the case by the client's email/phone among Nimmi-sourced cases.
//
// AUTH: X-Webhook-Secret (same NIMMI_WEBHOOK_SECRET as the other nimmi hooks).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { listCases, getCaseAnyCompany, updateCaseProcessing } from "@/lib/store";
import { verifyNimmiWebhook } from "@/lib/nimmi/webhook-utils";

export const runtime = "nodejs";

const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

export async function POST(req: NextRequest) {
  const denied = verifyNimmiWebhook(req);
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const processor = String(body?.preferred_processor || "").trim();
  if (!processor) {
    return NextResponse.json({ error: "Missing preferred_processor" }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const phone = digits(body?.phone);
  const agent = String(body?.suggested_by_agent || "an agent").trim();

  try {
    // Find the most recent Nimmi-sourced case for this client.
    const cases = await listCases(DEFAULT_COMPANY_ID);
    const matches = cases
      .filter((c) => String((c as any).sourceLeadKey || "").startsWith("nimmi-"))
      .filter((c) => {
        const ce = String((c as any).leadEmail || "").trim().toLowerCase();
        const cp = digits((c as any).leadPhone);
        return (email && ce === email) || (phone && cp && cp === phone);
      })
      .sort((a, b) => new Date((b as any).createdAt || 0).getTime() - new Date((a as any).createdAt || 0).getTime());

    const target = matches[0];
    if (!target) {
      // Case may not exist yet — acknowledge so Nimmi doesn't treat it as an error.
      return NextResponse.json({ ok: true, matched: false });
    }

    const full = await getCaseAnyCompany(target.id);
    const existing = String((full as any)?.remarks || "").trim();
    const line = `🧭 Agent suggested processor: ${processor} (via Nimmi, by ${agent}) — RCIC to confirm.`;
    const remarks = existing.includes(line) ? existing : (existing ? `${existing}\n${line}` : line);

    await updateCaseProcessing(target.companyId, target.id, { remarks });

    return NextResponse.json({ ok: true, matched: true, caseId: target.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[nimmi/case-preference] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "nimmi/case-preference" });
}
