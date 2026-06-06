// app/api/results/send-to-nimmi/route.ts
//
// Staff action: push an IRCC result to Nimmi, get back the secure magic-link
// shareUrl, and (optionally) send it to the client over WhatsApp.
//
// Call as multipart/form-data:
//   file         (required) — the result document (PDF / image)
//   clientName   (required)
//   phone        (phone OR email required)
//   email
//   appNumber    (recommended — IRCC application number)
//   serviceSlug  (e.g. pr-spousal, pgwp, study-permit, work-permit, citizenship)
//   resultType   (required) — approval|refusal|passport_request|biometrics|medical|aor|additional_docs|other
//   rcicNote
//   firstName    (for the WhatsApp greeting; falls back to clientName's first word)
//   sendWhatsApp ("true"/"false", default "true")
//
// Auth: staff session.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import {
  pushResultToNimmi,
  buildResultWhatsAppMessage,
  isNimmiConfigured,
  NimmiResultType,
} from "@/lib/nimmi-results";

const VALID_RESULT_TYPES: NimmiResultType[] = [
  "approval", "refusal", "submission", "request_letter",
  "passport_request", "biometrics", "medical", "aor", "additional_docs", "other",
];
const VALID_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic"];

// Best-effort map from the case's formType to a Nimmi serviceSlug. serviceSlug
// is optional on Nimmi's side, so an empty result is fine.
function deriveServiceSlug(formType: string): string {
  const ft = String(formType || "").toLowerCase();
  if (ft.includes("pgwp")) return "pgwp";
  if (ft.includes("spousal") || ft.includes("sponsor")) return "pr-spousal";
  if (ft.includes("citizen")) return "citizenship";
  if (ft.includes("study")) return "study-permit";
  if (ft.includes("sowp") || ft.includes("work permit") || ft.includes("owp") || ft.includes("lmia") || ft.includes("bowp")) return "work-permit";
  if (ft.includes("express entry") || ft.includes("pnp") || ft.includes("permanent res")) return "pr";
  if (ft.includes("visitor") || ft.includes("trv") || ft.includes("super visa")) return "visitor";
  return "";
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!isNimmiConfigured()) {
    return NextResponse.json(
      { error: "Nimmi integration is not configured — set CRM_API_SECRET in the environment." },
      { status: 400 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const str = (k: string) => String(form.get(k) ?? "").trim();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  let clientName = str("clientName");
  let phone = str("phone");
  let email = str("email");
  let serviceSlug = str("serviceSlug");
  const appNumber = str("appNumber");
  const resultType = str("resultType") as NimmiResultType;

  if (!VALID_RESULT_TYPES.includes(resultType)) {
    return NextResponse.json({ error: `resultType must be one of: ${VALID_RESULT_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!clientName && !appNumber) {
    return NextResponse.json({ error: "Provide a client name and/or an application number" }, { status: 400 });
  }

  const contentType = file.type || "application/pdf";
  if (!VALID_CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json(
      { error: `Unsupported file type "${contentType}". Allowed: ${VALID_CONTENT_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  // ── Auto-fetch the client's contact details from the matching case ──
  // Staff only type the client name + application number; we look the case up
  // (by application number first, then by name) and fill in phone/email/service
  // automatically. Anything the staff DID type wins over the fetched value.
  let matchedCaseId: string | undefined;
  try {
    const { listCases } = await import("@/lib/store");
    const cases = await listCases(user.companyId);
    const normApp = (s: string) => String(s || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    const normName = (s: string) => String(s || "").trim().toLowerCase();
    const phoneTail = (s: string) => String(s || "").replace(/\D/g, "").slice(-10);
    let match = appNumber
      ? cases.find((c) => normApp((c as any).applicationNumber) && normApp((c as any).applicationNumber) === normApp(appNumber))
      : undefined;
    // Phone is a real unique identifier — try it before falling back to name.
    if (!match && phone && phoneTail(phone).length >= 10) {
      const tail = phoneTail(phone);
      const byPhone = cases.filter((c) => phoneTail((c as any).leadPhone) === tail);
      match = byPhone.sort((a, b) =>
        String((b as any).updatedAt || (b as any).createdAt || "").localeCompare(String((a as any).updatedAt || (a as any).createdAt || ""))
      )[0];
    }
    if (!match && clientName) {
      // Exact name match, and if several share the name, take the MOST RECENT
      // case — never an arbitrary old one (that caused results to attach to a
      // stale case for repeat/common names).
      const byName = cases.filter((c) => normName(c.client) === normName(clientName));
      match = byName.sort((a, b) =>
        String((b as any).updatedAt || (b as any).createdAt || "").localeCompare(String((a as any).updatedAt || (a as any).createdAt || ""))
      )[0];
    }
    if (match) {
      matchedCaseId = match.id;
      if (!clientName) clientName = String(match.client || "");
      if (!phone) phone = String((match as any).leadPhone || "");
      if (!email) email = String((match as any).leadEmail || "");
      if (!serviceSlug) serviceSlug = deriveServiceSlug(String(match.formType || ""));
    }
  } catch (e) {
    console.error("Nimmi case lookup failed (non-fatal):", (e as Error).message);
  }

  // Fallback to the imported "Submitted applications" sheet for older clients who
  // aren't cases in the CRM (so a manually-typed phone isn't required).
  if (!phone) {
    try {
      const { lookupSubmittedAppByNumber, lookupSubmittedAppByName } = await import("@/lib/postgres-store");
      const hit = appNumber ? await lookupSubmittedAppByNumber(appNumber) : (clientName ? await lookupSubmittedAppByName(clientName) : null);
      if (hit) {
        if (!clientName) clientName = String(hit.name || "");
        if (!phone) phone = String(hit.phone || "");
        if (!serviceSlug) serviceSlug = deriveServiceSlug(String(hit.appType || ""));
      }
    } catch (e) {
      console.error("Nimmi submitted-apps lookup failed (non-fatal):", (e as Error).message);
    }
  }

  if (!clientName) {
    return NextResponse.json({ error: "Could not determine the client name — enter it, or check the case exists." }, { status: 400 });
  }
  if (!phone && !email) {
    return NextResponse.json(
      { error: `No phone or email found for "${clientName}"${appNumber ? ` / app ${appNumber}` : ""}. Make sure the case exists with a phone on file, or enter a phone manually.` },
      { status: 400 }
    );
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name || `${resultType}.pdf`;

  // ── Run the prepare → upload → finalize flow ──
  const result = await pushResultToNimmi({
    clientName,
    phone: phone || undefined,
    email: email || undefined,
    appNumber: appNumber || undefined,
    serviceSlug: serviceSlug || undefined,
    resultType,
    fileName,
    contentType,
    fileBuffer,
    rcicNote: str("rcicNote") || undefined,
  });

  if (!result.ok || !result.shareUrl) {
    console.error(`Nimmi result push failed for ${clientName}: ${result.error}`);
    return NextResponse.json({ error: result.error || "Nimmi push failed" }, { status: 502 });
  }

  // ── Optionally send the magic link over WhatsApp ──
  const sendWhatsApp = str("sendWhatsApp") !== "false"; // default true
  let whatsappSent = false;
  let whatsappError: string | undefined;
  let usedTemplateName: string | undefined;
  if (sendWhatsApp && phone) {
    try {
      const wa = await import("@/lib/whatsapp");
      const firstName = str("firstName") || clientName.split(/\s+/)[0];

      // Both result types go via an approved WhatsApp template — templates DELIVER
      // regardless of the client's 24-hour window, whereas free-form text is
      // accepted (200) but silently dropped if the client hasn't messaged us
      // recently. Approvals use the celebratory Marketing template; everything
      // else (incl. refusals) uses the neutral, privacy-aware Utility template.
      // Both templates' body params are {{1}} = first name, {{2}} = Nimmi link,
      // and both live on the Marketing WABA so they send from that number.
      const isApproval = resultType === "approval";
      const templateName = isApproval
        ? (process.env.NIMMI_APPROVAL_TEMPLATE_NAME || "approval_review")
        : (process.env.NIMMI_RESULT_TEMPLATE_NAME || "result_update");
      const templateLang = isApproval
        ? (process.env.NIMMI_APPROVAL_TEMPLATE_LANG || "en")
        : (process.env.NIMMI_RESULT_TEMPLATE_LANG || "en");
      usedTemplateName = templateName;

      const tmpl = await wa.sendWhatsAppTemplate({
        to: phone,
        templateName,
        languageCode: templateLang,
        phoneNumberId: process.env.WHATSAPP_MARKETING_PHONE_ID || undefined,
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: firstName },
              { type: "text", text: result.shareUrl },
            ],
          },
        ],
      });
      whatsappSent = Boolean(tmpl.success);
      if (!tmpl.success) {
        whatsappError = tmpl.error;
        // Fallback: free-form text (delivers only if the 24h window is open).
        const message = buildResultWhatsAppMessage(resultType, firstName, result.shareUrl);
        const send = await wa.sendWhatsAppText(phone, message);
        if (send.success) { whatsappSent = true; whatsappError = undefined; }
      }
    } catch (e) {
      whatsappError = (e as Error).message;
    }
  }

  console.log(
    `📨 Nimmi result sent for ${clientName} (${resultType}) → ${result.shareUrl}` +
    ` | matchedToUser=${result.matchedToUser} | whatsapp=${whatsappSent ? "sent" : sendWhatsApp ? "FAILED:" + whatsappError : "skipped"}`
  );

  // ── Log this send so there's always a record (phone + details), even before
  // the client replies and opens the 24h window. Non-fatal if it fails. ──
  try {
    const { insertSentResultLog } = await import("@/lib/postgres-store");
    const firstName = str("firstName") || clientName.split(/\s+/)[0];
    await insertSentResultLog({
      companyId: user.companyId,
      caseId: matchedCaseId,
      clientName,
      firstName,
      phone: phone || undefined,
      email: email || undefined,
      appNumber: appNumber || undefined,
      resultType,
      serviceSlug: serviceSlug || undefined,
      shareUrl: result.shareUrl,
      templateName: usedTemplateName,
      delivered: whatsappSent,
      deliveryError: whatsappError,
      sentBy: user.name || user.id,
    });
  } catch (e) {
    console.error("[send-to-nimmi] sent-log write failed (non-fatal):", (e as Error).message);
  }

  // ── Record the result in the Results dashboard feed too ──
  // The dashboard reads legacy_results; previously a SENT result never landed
  // there, so approvals/refusals you sent didn't move the dashboard numbers.
  // Map the result type → the dashboard's outcome buckets. Non-fatal.
  try {
    const { addLegacyResult } = await import("@/lib/store");
    const outcome: "approved" | "refused" | "request_letter" | "other" =
      resultType === "approval" ? "approved" :
      resultType === "refusal" ? "refused" :
      resultType === "request_letter" ? "request_letter" : "other";
    await addLegacyResult({
      companyId: user.companyId,
      entryType: resultType === "submission" ? "submission" : "result",
      clientName,
      phone: phone || undefined,
      applicationNumber: appNumber || "",
      outcome,
      resultDate: new Date().toISOString().slice(0, 10),
      fileName,
      fileLink: result.shareUrl,
      forceMatchedCaseId: matchedCaseId,
      createdByUserId: user.id,
      createdByName: user.name || user.id,
      notes: whatsappSent ? "Sent to client via WhatsApp" : "Uploaded (delivery pending)",
    });
  } catch (e) {
    console.error("[send-to-nimmi] legacy-result write failed (non-fatal):", (e as Error).message);
  }

  // ── Seed the client's WhatsApp chat thread with this outbound send ──
  // Templates are sent from the Marketing number, so the client's reply (if any)
  // lands in marketing_inbox. Dropping an outbound row here "starts the chat" so
  // staff can see, in the inbox, that a result/submission went out and whether
  // the client has replied yet. Non-fatal.
  if (phone) {
    try {
      const { getPool } = await import("@/lib/postgres-store");
      const db = getPool();
      const digits = String(phone).replace(/\D/g, "");
      const typeLabel: Record<string, string> = {
        approval: "Approval", refusal: "Refusal", submission: "Submission confirmation",
        request_letter: "Request / extension letter", passport_request: "Passport request",
        biometrics: "Biometrics", medical: "Medical", aor: "AOR",
        additional_docs: "Additional documents", other: "Update",
      };
      const label = typeLabel[resultType] || "Result";
      const chatMsg =
        `📤 ${label} sent${result.shareUrl ? ` — ${result.shareUrl}` : ""}` +
        `${whatsappSent ? "" : " (delivery pending — client's 24h window may be closed)"}`;
      const mid = `mkt-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await db.query(
        `INSERT INTO marketing_inbox (id, phone, message, direction, contact_name, is_read, created_at)
         VALUES ($1,$2,$3,'outbound',$4,TRUE,NOW())`,
        [mid, digits, chatMsg, clientName || null]
      );
    } catch (e) {
      console.error("[send-to-nimmi] chat-seed write failed (non-fatal):", (e as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    shareUrl: result.shareUrl,
    resultId: result.resultId,
    tokenExpiresAt: result.tokenExpiresAt,
    matchedToUser: result.matchedToUser,
    whatsappSent,
    whatsappError,
  });
}
