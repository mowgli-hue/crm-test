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
  "approval", "refusal", "passport_request", "biometrics", "medical", "aor", "additional_docs", "other",
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
    let match = appNumber
      ? cases.find((c) => normApp((c as any).applicationNumber) && normApp((c as any).applicationNumber) === normApp(appNumber))
      : undefined;
    if (!match && clientName) {
      match = cases.find((c) => normName(c.client) === normName(clientName));
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
  if (sendWhatsApp && phone) {
    try {
      const wa = await import("@/lib/whatsapp");
      const firstName = str("firstName") || clientName.split(/\s+/)[0];

      if (resultType === "approval") {
        // Approvals go via the approved Marketing template on the MARKETING WABA.
        // A template DELIVERS regardless of the client's 24-hour window — a
        // free-form text would be accepted (200) but silently dropped if the
        // client hasn't messaged us in the last day. Template body params are
        // {{1}} = first name, {{2}} = Nimmi share link.
        const tmpl = await wa.sendWhatsAppTemplate({
          to: phone,
          templateName: process.env.NIMMI_APPROVAL_TEMPLATE_NAME || "approval_review",
          languageCode: process.env.NIMMI_APPROVAL_TEMPLATE_LANG || "en",
          // The template was approved on the Marketing WABA, so it must be sent
          // from that number. Omit to fall back to the Processing number.
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
      } else {
        // Non-approval results stay on the privacy-aware free-form text for now
        // (no template approved yet). Add a `result_update` Utility template and
        // wire it here the same way once it's live.
        const message = buildResultWhatsAppMessage(resultType, firstName, result.shareUrl);
        const send = await wa.sendWhatsAppText(phone, message);
        whatsappSent = Boolean(send.success);
        if (!send.success) whatsappError = send.error;
      }
    } catch (e) {
      whatsappError = (e as Error).message;
    }
  }

  console.log(
    `📨 Nimmi result sent for ${clientName} (${resultType}) → ${result.shareUrl}` +
    ` | matchedToUser=${result.matchedToUser} | whatsapp=${whatsappSent ? "sent" : sendWhatsApp ? "FAILED:" + whatsappError : "skipped"}`
  );

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
