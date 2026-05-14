// ─────────────────────────────────────────────────────────────────────
// /api/inbox/send — Send a WhatsApp message (text and/or attachment) from staff
//
// Request body:
//   {
//     phone:    string                       // recipient
//     message?: string                       // optional text body / caption
//     caseId?:  string | null                // optional matched case
//     attachment?: {                         // optional file
//       name: string,
//       type: string,                        // MIME type
//       data: string                         // base64 (no data:mime;base64, prefix)
//     }
//   }
//
// Behavior:
//   - text only         → send as text message
//   - file only         → send as media message
//   - file + text       → send as media with text as caption
//
// On success the outbound message is logged to whatsapp_inbox so it shows up
// in the inbox conversation. For attachments we also save the file to S3 and
// store the download metadata in the inbox row (same `[doc:msgId|...]` format
// the inbound side uses) so the Download button works for outbound files too.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { sendWhatsAppText, sendWhatsAppMedia } from "@/lib/whatsapp";
import { addMessage, getCase } from "@/lib/store";
import { putObjectToS3, isS3StorageEnabled, normalizeFilename } from "@/lib/object-storage";

type AttachmentInput = { name: string; type: string; data: string };

function decodeBase64(data: string): Buffer | null {
  try {
    // Tolerate "data:foo;base64,XXX" prefix in case the client doesn't strip it
    const m = data.match(/^data:[^;]+;base64,(.*)$/);
    const raw = m ? m[1] : data;
    return Buffer.from(raw, "base64");
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const phone = body?.phone;
  const message: string = String(body?.message || "").trim();
  const caseId: string | null = body?.caseId || null;
  const attachment: AttachmentInput | null = body?.attachment || null;

  if (!phone) {
    return NextResponse.json({ error: "phone required" }, { status: 400 });
  }
  if (!message && !attachment) {
    return NextResponse.json({ error: "Either message or attachment is required" }, { status: 400 });
  }

  const cleanPhone = String(phone).replace(/\D/g, "");
  if (!cleanPhone) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }

  // ─── Path A: attachment (with optional caption) ───
  if (attachment) {
    const buf = decodeBase64(attachment.data);
    if (!buf) {
      return NextResponse.json({ error: "Invalid attachment data (not base64)" }, { status: 400 });
    }
    if (buf.length > 16 * 1024 * 1024) {
      // WhatsApp image max ~5MB, doc max ~100MB but practical limit is ~16MB.
      // Be defensive — reject obvious oversize before round-tripping to Meta.
      return NextResponse.json({ error: "Attachment too large (16 MB max)" }, { status: 413 });
    }

    console.log(`📤 Inbox media send: phone=${cleanPhone} | name=${attachment.name} | type=${attachment.type} | bytes=${buf.length} | caption="${message.slice(0, 50)}"`);

    const result = await sendWhatsAppMedia({
      to: cleanPhone,
      fileBuffer: buf,
      mimeType: attachment.type || "application/octet-stream",
      filename: attachment.name || "attachment",
      caption: message || undefined,
    });

    if (!result.success) {
      console.error(`❌ Media send failed: ${result.error}`);
      return NextResponse.json({ error: result.error || "Failed to send" }, { status: 500 });
    }

    // Save outbound to S3 and to inbox table (with doc placeholder so the
    // inbox UI shows a Download button on the outbound bubble too).
    let s3Key = "";
    if (isS3StorageEnabled()) {
      try {
        const safeName = normalizeFilename(attachment.name || "attachment");
        s3Key = `companies/${user.companyId}/outbound/${Date.now()}-${safeName}`;
        await putObjectToS3({ key: s3Key, content: buf, contentType: attachment.type });
      } catch (e) {
        console.error("Outbound S3 save failed (non-fatal):", e);
        s3Key = "";
      }
    }

    const inboxMsgId = `WA-OUT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const kind = attachment.type?.startsWith("image/") ? "image"
               : attachment.type?.startsWith("audio/") ? "audio"
               : "document";
    const safeName = (attachment.name || "attachment").replace(/\|/g, "");
    const docPlaceholder = s3Key
      ? `[doc:${inboxMsgId}|kind=${kind}|name=${encodeURIComponent(safeName)}|mime=${encodeURIComponent(attachment.type || "application/octet-stream")}|s3=${encodeURIComponent(s3Key)}${message ? `|caption=${encodeURIComponent(message.slice(0, 200))}` : ""}]`
      : `[doc:${inboxMsgId}|kind=${kind}|name=${encodeURIComponent(safeName)}|mime=${encodeURIComponent(attachment.type || "application/octet-stream")}|nos3=1${message ? `|caption=${encodeURIComponent(message.slice(0, 200))}` : ""}]`;

    try {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      // Normalize phone the same way as inbound
      const digits = cleanPhone;
      const normalizedPhone = digits.length === 10 ? `1${digits}`
                              : digits.length === 11 && digits.startsWith("1") ? digits
                              : digits;
      // Look up matched_case_name so the inbox row shows the linked client name
      let _matchedCaseName: string | null = null;
      if (caseId) {
        try {
          const c = await getCase(user.companyId, caseId);
          if (c) _matchedCaseName = c.client || null;
        } catch { /* non-fatal */ }
      }
      await pool.query(
        `INSERT INTO whatsapp_inbox (id, phone, message, direction, matched_case_id, matched_case_name, is_read, created_at)
         VALUES ($1, $2, $3, 'outbound', $4, $5, TRUE, NOW())`,
        [inboxMsgId, normalizedPhone, docPlaceholder, caseId || null, _matchedCaseName]
      );
      await pool.end();
    } catch (e) {
      console.error("Outbound inbox log failed (non-fatal):", (e as Error).message);
    }

    if (caseId) {
      await addMessage({
        companyId: user.companyId,
        caseId,
        senderType: "staff",
        senderName: user.name,
        text: `[WhatsApp file: ${safeName}]${message ? `\n${message}` : ""}`,
        channel: "whatsapp",
      } as any).catch(() => {});
    }

    return NextResponse.json({ ok: true, messageId: result.messageId, mediaId: result.mediaId });
  }

  // ─── Path B: text only (existing behaviour) ───
  console.log(`📤 Inbox send: phone=${cleanPhone} | msg=${message.slice(0, 50)} | caseId=${caseId || "none"}`);
  const result = await sendWhatsAppText(cleanPhone, message);
  console.log(`📬 Inbox send result: success=${result.success} | error=${result.error || "none"} | msgId=${result.messageId || "none"}`);

  if (!result.success) {
    console.error(`❌ Inbox send failed: ${result.error}`);
    return NextResponse.json({ error: result.error || "Failed to send" }, { status: 500 });
  }

  if (caseId) {
    await addMessage({
      companyId: user.companyId,
      caseId,
      senderType: "staff",
      senderName: user.name,
      text: `[WhatsApp] ${message}`,
      channel: "whatsapp",
    } as any).catch(() => {});
  }

  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const digits = cleanPhone;
    const normalizedPhone = digits.length === 10 ? `1${digits}`
                            : digits.length === 11 && digits.startsWith("1") ? digits
                            : digits;
    let _matchedCaseName2: string | null = null;
    if (caseId) {
      try {
        const c = await getCase(user.companyId, caseId);
        if (c) _matchedCaseName2 = c.client || null;
      } catch { /* non-fatal */ }
    }
    await pool.query(
      `INSERT INTO whatsapp_inbox (id, phone, message, direction, matched_case_id, matched_case_name, is_read, created_at)
       VALUES ($1, $2, $3, 'outbound', $4, $5, TRUE, NOW())`,
      [`WA-OUT-${Date.now()}`, normalizedPhone, message, caseId || null, _matchedCaseName2]
    );
    await pool.end();
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, messageId: result.messageId });
}
