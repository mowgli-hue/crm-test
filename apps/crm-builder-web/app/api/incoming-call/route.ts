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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Marketing number config ───
// This webhook is for the MARKETING number (separate from Processing's case-intake number).
// We deliberately read WHATSAPP_MARKETING_PHONE_ID, not WHATSAPP_PHONE_NUMBER_ID.
const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "";
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";

function isMarketingWhatsAppConfigured() {
  return Boolean(MARKETING_PHONE_ID && WA_TOKEN);
}

// Send WhatsApp text from the MARKETING number (NOT the case-intake/Processing number).
// NOTE: Plain text only works within an OPEN 24-hour window — i.e. after the customer
// has messaged us first. For unsolicited business-initiated messages (like a missed-call
// welcome), use sendMarketingTemplate() with a Meta-approved template instead.
async function sendMarketingWhatsApp(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isMarketingWhatsAppConfigured()) {
    return { success: false, error: "Marketing WhatsApp not configured (missing WHATSAPP_MARKETING_PHONE_ID or WHATSAPP_ACCESS_TOKEN)" };
  }
  // Normalize phone — Meta wants digits only, leading "+" stripped
  const cleanPhone = String(to || "").replace(/[^\d]/g, "");
  if (!cleanPhone || cleanPhone.length < 7) {
    return { success: false, error: "Invalid phone number" };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${MARKETING_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${WA_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: "text",
        text: { body: message },
      }),
    });
    const data = await res.json().catch(() => ({})) as { messages?: { id: string }[]; error?: { message: string } };
    if (!res.ok) {
      return { success: false, error: data?.error?.message || `Meta API error (HTTP ${res.status})` };
    }
    return { success: true, messageId: data?.messages?.[0]?.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Send a pre-approved Marketing TEMPLATE from the MARKETING number.
// Used for first-time outreach (e.g. missed-call welcome) since Meta requires
// approved templates for any business-initiated message outside a 24-hour window.
//
// The template name + language must match what was approved in Meta Business Manager.
// If the template body has no variables, pass `variables: []`.
// If the template body has {{1}} {{2}} etc, pass the values in order: ["John", "PGWP"].
async function sendMarketingTemplate(
  to: string,
  templateName: string,
  languageCode: string = "en",
  variables: string[] = []
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isMarketingWhatsAppConfigured()) {
    return { success: false, error: "Marketing WhatsApp not configured (missing WHATSAPP_MARKETING_PHONE_ID or WHATSAPP_ACCESS_TOKEN)" };
  }
  const cleanPhone = String(to || "").replace(/[^\d]/g, "");
  if (!cleanPhone || cleanPhone.length < 7) {
    return { success: false, error: "Invalid phone number" };
  }

  // Build template payload. Components only included if there are variables.
  const components: any[] = [];
  if (variables.length > 0) {
    components.push({
      type: "body",
      parameters: variables.map((v) => ({ type: "text", text: String(v) })),
    });
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${MARKETING_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${WA_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(components.length > 0 ? { components } : {}),
        },
      }),
    });
    const data = await res.json().catch(() => ({})) as { messages?: { id: string }[]; error?: { message: string } };
    if (!res.ok) {
      return { success: false, error: data?.error?.message || `Meta API error (HTTP ${res.status})` };
    }
    return { success: true, messageId: data?.messages?.[0]?.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

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
  // Parse called_at robustly. Accepts:
  //   - ISO strings ("2026-05-02T01:23:45Z")
  //   - Unix epoch seconds ("1777696708") — common from Tasker's %TIMES
  //   - Unix epoch milliseconds ("1777696708000")
  //   - null / missing / unparseable → falls back to NOW() at insert time
  // We coerce to ISO-8601 here so Postgres always gets a clean cast input.
  let calledAtISO: string | null = null;
  const rawCalledAt = body?.called_at ? String(body.called_at).trim() : null;
  if (rawCalledAt) {
    if (/^\d+$/.test(rawCalledAt)) {
      // All digits → Unix timestamp. <= 13 digits = ms range, ~10 digits = seconds.
      const num = Number(rawCalledAt);
      const ms = rawCalledAt.length <= 11 ? num * 1000 : num;
      const d = new Date(ms);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
        calledAtISO = d.toISOString();
      }
    } else {
      // Try as ISO / native Date parse
      const d = new Date(rawCalledAt);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
        calledAtISO = d.toISOString();
      }
    }
    // If still null, we just ignore and let NOW() fill in (don't fail the request)
  }
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
      [callId, cleanPhone, contactName, calledAtISO, "Tasker (auto)"]
    );

    // Bump the lead row if this phone is already in marketing_leads
    pool.query(
      `UPDATE marketing_leads SET updated_at = NOW() WHERE phone = $1`,
      [cleanPhone]
    ).catch(() => { /* table may not exist yet */ });

    // ─── Determine: is this a NEW number we've never engaged with before? ───
    // We only auto-send the welcome message to first-time callers.
    // Existing leads/customers should reach a real human conversation
    // instead of getting a templated "thanks for calling" message.
    //
    // A number is considered NEW if NONE of the following exist for that phone:
    //   1. Prior WhatsApp messages in marketing_inbox (any direction)
    //   2. An existing marketing_leads row
    //   3. An existing case in app_store_snapshots (leadPhone match)
    //   4. Any call_log entries OTHER than the one we just inserted ($1 = this call's id)
    //
    // If queries fail (tables missing, etc.), we fail-open and TREAT AS NEW
    // (better to send an extra welcome than to miss an opportunity).
    let isNewNumber = true;
    try {
      // Build phone-match patterns to catch variations: with/without "+", with/without "1"
      // Last 10 digits is the most reliable comparison for North American numbers.
      const last10 = cleanPhone.replace(/\D/g, "").slice(-10);
      const phoneLike = `%${last10}`;

      // Check 1 + 2: marketing_inbox / marketing_leads
      const inboxCheck = await pool.query(
        `SELECT 1 FROM marketing_inbox WHERE phone LIKE $1 LIMIT 1`,
        [phoneLike]
      ).catch(() => ({ rowCount: 0 }));
      const leadsCheck = await pool.query(
        `SELECT 1 FROM marketing_leads WHERE phone LIKE $1 LIMIT 1`,
        [phoneLike]
      ).catch(() => ({ rowCount: 0 }));

      // Check 3: any prior call_log entries (other than the one we just added)
      const callsCheck = await pool.query(
        `SELECT 1 FROM call_log WHERE phone LIKE $1 AND id != $2 LIMIT 1`,
        [phoneLike, callId]
      ).catch(() => ({ rowCount: 0 }));

      // Check 4: case match (leadPhone in cases JSONB blob)
      const casesCheck = await pool.query(
        `SELECT 1 FROM app_store_snapshots,
                LATERAL jsonb_array_elements(payload->'cases') AS c
         WHERE id = 'global'
           AND regexp_replace(c->>'leadPhone', '[^0-9]', '', 'g') LIKE $1
         LIMIT 1`,
        [phoneLike]
      ).catch(() => ({ rowCount: 0 }));

      if ((inboxCheck.rowCount || 0) > 0
          || (leadsCheck.rowCount || 0) > 0
          || (callsCheck.rowCount || 0) > 0
          || (casesCheck.rowCount || 0) > 0) {
        isNewNumber = false;
      }
    } catch {
      // Defensive — treat unknown as new
      isNewNumber = true;
    }

    // ─── Send WhatsApp welcome message ───
    let whatsappSent = false;
    let whatsappError: string | null = null;
    let skippedReason: string | null = null;

    if (!sendWelcome) {
      skippedReason = "send_welcome=false";
    } else if (!isNewNumber) {
      skippedReason = "existing contact — already has prior conversation/case";
    } else if (!isMarketingWhatsAppConfigured()) {
      whatsappError = "Marketing WhatsApp not configured";
    } else {
      // Meta REQUIRES an approved Template for first-time outreach (24-hour rule).
      // Plain text only works AFTER the customer has messaged us first.
      // Template name + language must match what's approved in Meta Business Manager.
      const templateName = process.env.TASKER_WELCOME_TEMPLATE || "missed_call_welcome";
      // Try the configured lang first, then common fallbacks. Meta returns
      // 132001 ("Template name does not exist in the translation") when
      // language code doesn't match what's approved (e.g. "en" vs "en_US").
      const langPrimary = process.env.TASKER_WELCOME_TEMPLATE_LANG || "en";
      const langCandidates = Array.from(new Set([langPrimary, "en", "en_US", "en_GB"]));
      let result: { success: boolean; messageId?: string; error?: string } = { success: false };
      for (const lang of langCandidates) {
        result = await sendMarketingTemplate(cleanPhone, templateName, lang, []);
        if (result.success) break;
        // Stop trying other languages if the error isn't translation-related
        if (!/132001|translation/i.test(result.error || "")) break;
      }
      whatsappSent = result.success;
      whatsappError = result.error || null;

      // For logging in marketing_inbox, use the human-readable text version of the
      // template body. This is what staff will see in the Inbox UI.
      const inboxLogMessage = process.env.TASKER_WELCOME_MESSAGE || DEFAULT_WELCOME;

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
            inboxLogMessage,
            contactName,
          ]
        ).catch(() => { /* table may not exist or schema mismatch — non-blocking */ });
      }
    }

    return NextResponse.json({
      ok: true,
      callId,
      phone: cleanPhone,
      contact_name: contactName,
      isNewNumber,
      whatsappSent,
      whatsappError,
      skippedReason,
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
    marketingWhatsappConfigured: isMarketingWhatsAppConfigured(),
    welcomeMessageCustomized: Boolean(process.env.TASKER_WELCOME_MESSAGE),
  });
}
