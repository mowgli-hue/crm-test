// ─────────────────────────────────────────────────────────────────────
// Incoming Call Webhook — for Tasker (Android) integration
//
// Tasker on the marketing phone detects an incoming call and POSTs to
// this endpoint with the caller's phone number, contact name (if saved
// on the phone), and timestamp. We:
//   1. Insert a row in call_log (with source='tasker' for tracing)
//   2. Optionally auto-send a WhatsApp welcome message to the caller
//
// AUTHENTICATION:
//   This endpoint uses a SHARED SECRET in the X-Webhook-Secret header
//   instead of a user session, because Tasker can't log in. The secret
//   is stored as TASKER_WEBHOOK_SECRET in Railway env vars.
//
// ENDPOINT: POST /api/incoming-call
// HEADERS:  X-Webhook-Secret: <secret>
// BODY: {
//   "phone": "+16041234567",       // required — caller's phone (E.164 ideal)
//   "contact_name": "John Doe",    // optional — name from phone contacts
//   "called_at": "2026-04-29T...", // optional — ISO timestamp; defaults to now
//   "send_welcome": true           // optional — defaults to true; sends WA welcome msg
// }
// RESPONSE: { ok: true, callId: "call-xxx", whatsappSent: true|false }
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { sendWhatsAppText, isWhatsAppConfigured } from "@/lib/whatsapp";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Default welcome message — overridable via TASKER_WELCOME_MESSAGE env var.
// Customize per business — keep it short, polite, and actionable.
const DEFAULT_WELCOME =
  "Hi! Thanks for calling Newton Immigration. We just missed your call. " +
  "Reply here on WhatsApp with what you need help with (PR, study permit, work permit, etc.) " +
  "and one of our team will get back to you within an hour.\n\n— Newton Immigration Team";

async function ensureCallLogSchema() {
  // Schema is owned by /api/call-log — we don't recreate, just ensure the
  // 'source' column exists (it should already, but defensive).
  await pool.query(`
    ALTER TABLE call_log ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  `).catch(() => { /* call_log might not exist if /call-log never hit yet — that's OK, INSERT below will fail with clear error */ });
}

export async function POST(request: NextRequest) {
  // ─── Auth via shared secret ───
  const expectedSecret = process.env.TASKER_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Endpoint not configured (TASKER_WEBHOOK_SECRET missing)" },
      { status: 500 }
    );
  }
  const providedSecret = request.headers.get("x-webhook-secret") || "";
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── Parse body ───
  const body = await request.json().catch(() => ({}));
  const phone = String(body?.phone || "").trim();
  const contactName = body?.contact_name ? String(body.contact_name).trim() : null;
  const calledAt = body?.called_at ? String(body.called_at) : null;
  const sendWelcome = body?.send_welcome !== false; // default true

  if (!phone) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  // Sanity: phone should look like a phone number
  const cleanPhone = phone.replace(/[^\d+]/g, "");
  if (cleanPhone.length < 7) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  try {
    await ensureCallLogSchema();

    // ─── Insert call_log row ───
    const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await pool.query(
      `INSERT INTO call_log
        (id, direction, phone, contact_name, source, called_at, logged_by_name)
       VALUES ($1, 'inbound', $2, $3, 'tasker', COALESCE($4::timestamptz, NOW()), $5)`,
      [callId, cleanPhone, contactName, calledAt, "Tasker (auto)"]
    );

    // Bump the lead row if this phone is already in marketing_leads
    pool.query(
      `UPDATE marketing_leads SET updated_at = NOW() WHERE phone = $1`,
      [cleanPhone]
    ).catch(() => { /* table may not exist yet */ });

    // ─── Send WhatsApp welcome message ───
    let whatsappSent = false;
    let whatsappError: string | null = null;

    if (sendWelcome) {
      if (!isWhatsAppConfigured()) {
        whatsappError = "WhatsApp not configured";
      } else {
        const message = process.env.TASKER_WELCOME_MESSAGE || DEFAULT_WELCOME;
        const result = await sendWhatsAppText(cleanPhone, message);
        whatsappSent = result.success;
        whatsappError = result.error || null;

        // If sent successfully, log the outbound message in marketing_inbox so it
        // shows up in staff's inbox view alongside future replies.
        if (result.success) {
          pool.query(
            `INSERT INTO marketing_inbox
              (id, phone, message, direction, contact_name, is_read, created_at)
             VALUES ($1, $2, $3, 'outbound', $4, true, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [
              `wa-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              cleanPhone,
              message,
              contactName,
            ]
          ).catch(() => { /* table may not exist or schema mismatch — non-blocking */ });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      callId,
      phone: cleanPhone,
      contact_name: contactName,
      whatsappSent,
      whatsappError,
    });
  } catch (e) {
    console.error("incoming-call POST failed:", e);
    return NextResponse.json(
      { error: "Server error", detail: String(e) },
      { status: 500 }
    );
  }
}

// ─── Optional: GET for health check ───
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/incoming-call",
    expects: "POST with X-Webhook-Secret header",
    secretConfigured: Boolean(process.env.TASKER_WEBHOOK_SECRET),
    whatsappConfigured: isWhatsAppConfigured(),
  });
}
