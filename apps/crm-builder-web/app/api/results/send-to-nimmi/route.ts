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

  const clientName = str("clientName");
  const phone = str("phone");
  const email = str("email");
  const resultType = str("resultType") as NimmiResultType;

  if (!clientName) return NextResponse.json({ error: "clientName is required" }, { status: 400 });
  if (!phone && !email) return NextResponse.json({ error: "phone or email is required" }, { status: 400 });
  if (!VALID_RESULT_TYPES.includes(resultType)) {
    return NextResponse.json({ error: `resultType must be one of: ${VALID_RESULT_TYPES.join(", ")}` }, { status: 400 });
  }

  const contentType = file.type || "application/pdf";
  if (!VALID_CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json(
      { error: `Unsupported file type "${contentType}". Allowed: ${VALID_CONTENT_TYPES.join(", ")}` },
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
    appNumber: str("appNumber") || undefined,
    serviceSlug: str("serviceSlug") || undefined,
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
      const { sendWhatsAppText } = await import("@/lib/whatsapp");
      const firstName = str("firstName") || clientName.split(/\s+/)[0];
      const message = buildResultWhatsAppMessage(resultType, firstName, result.shareUrl);
      const send = await sendWhatsAppText(phone, message);
      whatsappSent = Boolean(send.success);
      if (!send.success) whatsappError = send.error;
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
