import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "1047138985153613";
// Token: prefer WHATSAPP_ACCESS_TOKEN (Meta's naming), fall back to WHATSAPP_TOKEN (legacy)
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";

// ──────────────────────────────────────────────────────────────
// Schema bootstrap — runs idempotently on first hit
// ──────────────────────────────────────────────────────────────

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_inbox (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'inbound',
      contact_name TEXT,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_inbox_phone ON marketing_inbox(phone)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_inbox_created ON marketing_inbox(created_at DESC)`);

  // Lead pipeline table — one row per phone
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_leads (
      phone TEXT PRIMARY KEY,
      contact_name TEXT,
      stage TEXT NOT NULL DEFAULT 'new',
      source TEXT,
      service_interest TEXT,
      tags TEXT[],
      notes TEXT,
      assigned_to TEXT,
      next_follow_up DATE,
      consultation_paid BOOLEAN NOT NULL DEFAULT FALSE,
      converted_case_id TEXT,
      ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_leads_stage ON marketing_leads(stage)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_leads_followup ON marketing_leads(next_follow_up) WHERE next_follow_up IS NOT NULL`);
}

// ──────────────────────────────────────────────────────────────
// GET — list all messages, plus lead metadata so the UI can show stages
// ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureSchema();

    // Lightweight unread-count mode for the sidebar badge poller.
    // Returns just the integer; runs everywhere in the app.
    const url = new URL(request.url);
    if (url.searchParams.get("count_only") === "1") {
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS unread_count
           FROM marketing_inbox
          WHERE direction = 'inbound'
            AND is_read = FALSE`
      );
      return NextResponse.json({
        unreadCount: countRes.rows[0]?.unread_count ?? 0,
      });
    }

    const messagesRes = await pool.query(
      `SELECT * FROM marketing_inbox ORDER BY created_at DESC LIMIT 1000`
    );
    const leadsRes = await pool.query(`SELECT * FROM marketing_leads`);

    // Index leads by phone for the UI to merge against threads
    const leadsByPhone: Record<string, any> = {};
    for (const lead of leadsRes.rows) {
      leadsByPhone[lead.phone] = lead;
    }

    return NextResponse.json({ messages: messagesRes.rows, leads: leadsByPhone });
  } catch (e) {
    console.error("Marketing inbox GET error:", (e as Error).message);
    return NextResponse.json({ messages: [], leads: {} });
  }
}

// ──────────────────────────────────────────────────────────────
// POST — actions: send message (default), saveName, markRead, deleteThread
// ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = body?.action;

  try {
    await ensureSchema();

    // ── Save / update contact name on a thread ──
    if (action === "saveName") {
      const { phone, name } = body;
      if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
      const cleanName = String(name || "").trim();

      // Update all messages for this phone with the new name
      await pool.query(
        `UPDATE marketing_inbox SET contact_name = $2 WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1`,
        [String(phone).replace(/\D/g, "").slice(-9), cleanName || null]
      );

      // Upsert lead row
      await pool.query(
        `INSERT INTO marketing_leads (phone, contact_name, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (phone) DO UPDATE SET contact_name = $2, updated_at = NOW()`,
        [phone, cleanName || null]
      );
      return NextResponse.json({ ok: true });
    }

    // ── Mark thread as read ──
    if (action === "markRead") {
      const { phone } = body;
      if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
      await pool.query(
        `UPDATE marketing_inbox SET is_read = TRUE WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1 AND direction = 'inbound'`,
        [String(phone).replace(/\D/g, "").slice(-9)]
      );
      return NextResponse.json({ ok: true });
    }

    // ── Delete a thread (all messages for one phone) ──
    if (action === "deleteThread") {
      const { phone } = body;
      if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
      await pool.query(`DELETE FROM marketing_inbox WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1`, [String(phone).replace(/\D/g, "").slice(-9)]);
      // Don't delete the lead — staff might want history of converted leads
      return NextResponse.json({ ok: true });
    }

    // ── Re-engagement: reopen a closed 24h window ──
    // WhatsApp drops free-form text outside the 24h customer-service window.
    // This sends an APPROVED template (which delivers any time) inviting the
    // client to reply — once they do, the window reopens and normal messages go
    // through. Template name/lang come from env so staff can swap the approved
    // template without a code change.
    if (action === "reengage") {
      const { phone } = body;
      if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
      const cleaned = String(phone).replace(/\D/g, "");
      if (!cleaned) return NextResponse.json({ error: "Invalid phone" }, { status: 400 });

      const templateName = process.env.REENGAGE_TEMPLATE_NAME || "reengage_v1";
      const templateLang = process.env.REENGAGE_TEMPLATE_LANG || "en";

      // First name for the {{1}} body param — pull the saved contact name.
      const nameRes = await pool.query(
        `SELECT contact_name FROM marketing_inbox
          WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
            AND contact_name IS NOT NULL AND contact_name != ''
          ORDER BY created_at DESC LIMIT 1`,
        [cleaned.slice(-9)]
      ).catch(() => ({ rows: [] as any[] }));
      const firstName = String(nameRes.rows?.[0]?.contact_name || "").trim().split(/\s+/)[0] || "there";

      const { sendWhatsAppTemplate } = await import("@/lib/whatsapp");
      const tmpl = await sendWhatsAppTemplate({
        to: cleaned,
        templateName,
        languageCode: templateLang,
        phoneNumberId: MARKETING_PHONE_ID,
        components: [
          { type: "body", parameters: [{ type: "text", text: firstName }] },
        ],
      });
      if (!tmpl.success) {
        return NextResponse.json(
          { error: `Re-engagement template failed: ${tmpl.error || "unknown"} (template "${templateName}"/${templateLang})` },
          { status: 502 }
        );
      }

      // Log it in the thread so staff see it went out.
      const rid = `mkt-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await pool.query(
        `INSERT INTO marketing_inbox (id, phone, message, direction, is_read, created_at)
         VALUES ($1,$2,$3,'outbound',TRUE,NOW())`,
        [rid, phone, `🔔 Re-engagement sent (asked client to reply to reopen the chat).`]
      );
      return NextResponse.json({ ok: true, messageId: tmpl.messageId, templateName });
    }

    // ── Toggle AI auto-reply for a thread (default: true) ──
    if (action === "toggleAI") {
      const { phone, enabled } = body;
      if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
      await pool.query(
        `INSERT INTO marketing_leads (phone, ai_enabled, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (phone) DO UPDATE SET ai_enabled = $2, updated_at = NOW()`,
        [phone, !!enabled]
      );
      return NextResponse.json({ ok: true, ai_enabled: !!enabled });
    }

    // ── Default: send an outbound message (text and/or attachment) ──
    //
    // Accepts:
    //   { phone, message }                      → text only (current behavior)
    //   { phone, attachment: {...} }            → file only
    //   { phone, message, attachment: {...} }   → file with caption
    //
    // Attachment shape: { name, type (mime), data (base64 string) }
    //
    // For attachments, we use the shared sendWhatsAppMedia helper which:
    //   1. Uploads the file to Meta's /media endpoint
    //   2. Sends a media message referencing the upload
    // We pass `phoneNumberId: MARKETING_PHONE_ID` so the send goes via the
    // Marketing WABA, not Processing. Same `[doc:...|s3=...]` format used in
    // Processing inbox so the download button rendering is consistent.
    const { phone, message, attachment } = body;
    if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
    if (!message && !attachment) return NextResponse.json({ error: "Either message or attachment required" }, { status: 400 });

    const cleanedPhone = phone.replace(/\D/g, "");
    if (!cleanedPhone) return NextResponse.json({ error: "Invalid phone" }, { status: 400 });

    // ── Attachment path ──
    if (attachment) {
      // Decode base64
      let buf: Buffer;
      try {
        const m = String(attachment.data || "").match(/^data:[^;]+;base64,(.*)$/);
        const raw = m ? m[1] : String(attachment.data || "");
        buf = Buffer.from(raw, "base64");
      } catch {
        return NextResponse.json({ error: "Invalid attachment data" }, { status: 400 });
      }
      if (!buf || buf.length === 0) return NextResponse.json({ error: "Empty attachment" }, { status: 400 });
      if (buf.length > 16 * 1024 * 1024) return NextResponse.json({ error: "Attachment too large (16 MB max)" }, { status: 413 });

      const { sendWhatsAppMedia } = await import("@/lib/whatsapp");
      const { putObjectToS3, isS3StorageEnabled, normalizeFilename } = await import("@/lib/object-storage");

      const sendRes = await sendWhatsAppMedia({
        to: cleanedPhone,
        fileBuffer: buf,
        mimeType: attachment.type || "application/octet-stream",
        filename: attachment.name || "attachment",
        caption: typeof message === "string" && message.trim() ? message.trim() : undefined,
        phoneNumberId: MARKETING_PHONE_ID,
      });
      if (!sendRes.success) {
        return NextResponse.json({ error: sendRes.error || "Send failed" }, { status: 500 });
      }

      // Save to S3 (best-effort backup; non-fatal if it fails)
      let s3Key = "";
      if (isS3StorageEnabled()) {
        try {
          const safeName = normalizeFilename(attachment.name || "attachment");
          // Phone-based folder structure (same convention as inbound).
          const phoneFolder = String(cleanedPhone).replace(/\D/g, "") || "unknown";
          s3Key = `companies/${user.companyId}/marketing-outbound/${phoneFolder}/${Date.now()}-${safeName}`;
          await putObjectToS3({ key: s3Key, content: buf, contentType: attachment.type || "application/octet-stream" });
        } catch (e) {
          console.error("Marketing outbound S3 save failed (non-fatal):", e);
        }
      }

      const inboxMsgId = `mkt-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const kind = String(attachment.type || "").startsWith("image/") ? "image"
                 : String(attachment.type || "").startsWith("audio/") ? "audio"
                 : "document";
      const safeName = String(attachment.name || "attachment").replace(/\|/g, "");
      const captionPart = (typeof message === "string" && message.trim())
        ? `|caption=${encodeURIComponent(message.trim().slice(0, 200))}`
        : "";
      const docPlaceholder = s3Key
        ? `[doc:${inboxMsgId}|kind=${kind}|name=${encodeURIComponent(safeName)}|mime=${encodeURIComponent(attachment.type || "application/octet-stream")}|s3=${encodeURIComponent(s3Key)}${captionPart}]`
        : `[doc:${inboxMsgId}|kind=${kind}|name=${encodeURIComponent(safeName)}|mime=${encodeURIComponent(attachment.type || "application/octet-stream")}|nos3=1${captionPart}]`;

      await pool.query(
        `INSERT INTO marketing_inbox (id, phone, message, direction, is_read, created_at)
         VALUES ($1,$2,$3,'outbound',TRUE,NOW())`,
        [inboxMsgId, phone, docPlaceholder]
      );

      // ── Drive backup (Stage 2) — same as inbound flow ──
      // Staff-sent docs also go into the per-client Drive folder so the
      // Marketing Drive folder shows the full conversation history.
      const marketingDriveRoot = process.env.MARKETING_DOCS_DRIVE_FOLDER_ID || "";
      if (marketingDriveRoot) {
        try {
          const { getOrCreateDriveSubfolder, uploadFileToDriveFolder } = await import("@/lib/google-drive");

          // Look up contact name from any prior message on this phone.
          const nameRes = await pool.query(
            `SELECT contact_name FROM marketing_inbox
             WHERE phone = $1 AND contact_name IS NOT NULL AND contact_name != ''
             ORDER BY created_at DESC LIMIT 1`,
            [phone]
          ).catch(() => ({ rows: [] }));
          const clientLabel = (nameRes.rows?.[0]?.contact_name || "")
            .replace(/[\/\\<>:"|?*]/g, " ")
            .trim();
          const clientFolderName = clientLabel
            ? `${clientLabel} (${cleanedPhone})`
            : cleanedPhone;

          const clientFolder = await getOrCreateDriveSubfolder(marketingDriveRoot, clientFolderName);
          await uploadFileToDriveFolder({
            folderId: clientFolder.id,
            fileName: `[OUTBOUND] ${safeName}`,  // tag outbound so staff can tell
            fileBuffer: buf,
            mimeType: attachment.type || "application/octet-stream",
          });
          console.log(`☁️  Marketing OUTBOUND doc uploaded to Drive: ${clientFolderName}/[OUTBOUND] ${safeName}`);
        } catch (e) {
          console.error("Marketing outbound Drive upload failed (non-fatal):", (e as Error).message);
        }
      }

      return NextResponse.json({ ok: true, messageId: sendRes.messageId, mediaId: sendRes.mediaId });
    }

    // ── Text-only path (existing behavior, preserved) ──
    const res = await fetch(`https://graph.facebook.com/v18.0/${MARKETING_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanedPhone,
        type: "text",
        text: { body: message }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("WA send failed:", res.status, errText);
      return NextResponse.json({ error: "Failed to send", detail: errText }, { status: 500 });
    }

    const id = `mkt-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await pool.query(
      `INSERT INTO marketing_inbox (id, phone, message, direction, is_read, created_at)
       VALUES ($1,$2,$3,'outbound',TRUE,NOW())`,
      [id, phone, message]
    );

    // Mark inbound as read since staff just replied
    await pool.query(
      `UPDATE marketing_inbox SET is_read = TRUE WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1 AND direction = 'inbound'`,
      [String(phone).replace(/\D/g, "").slice(-9)]
    );

    // Auto-advance lead stage from "new" -> "contacted" once staff replies, AND
    // stamp last_human_reply_at so the bot backs off (won't talk over staff).
    await pool.query(`ALTER TABLE marketing_leads ADD COLUMN IF NOT EXISTS last_human_reply_at TIMESTAMPTZ`).catch(() => {});
    await pool.query(
      `INSERT INTO marketing_leads (phone, stage, updated_at, last_human_reply_at)
       VALUES ($1, 'contacted', NOW(), NOW())
       ON CONFLICT (phone) DO UPDATE
         SET stage = CASE WHEN marketing_leads.stage = 'new' THEN 'contacted' ELSE marketing_leads.stage END,
             last_human_reply_at = NOW(),
             updated_at = NOW()`,
      [phone]
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Marketing inbox POST error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
