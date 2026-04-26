import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Comma-separated list of Newton staff phone numbers to ring on inbound calls
// Example: TWILIO_FORWARD_TO=+16048975894,+16046535031,+16049070314
const FORWARD_TO = (process.env.TWILIO_FORWARD_TO || "").split(",").map(s => s.trim()).filter(Boolean);

// Caller ID to display when forwarding (typically your Twilio number — required for forwarding to landlines)
const CALLER_ID = process.env.TWILIO_CALLER_ID || "";

// Ring timeout per leg before falling back to voicemail (seconds)
const RING_TIMEOUT = parseInt(process.env.TWILIO_RING_TIMEOUT || "20", 10);

// Public URL where Twilio can reach our voicemail/status webhooks (e.g. https://yourapp.up.railway.app)
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN
  ? (process.env.PUBLIC_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
  : "";

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_log (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL DEFAULT 'inbound',
      phone TEXT,
      contact_name TEXT,
      duration_minutes INTEGER,
      duration_seconds INTEGER,
      outcome TEXT,
      service_interest TEXT,
      notes TEXT,
      ai_summary TEXT,
      logged_by TEXT,
      logged_by_name TEXT,
      linked_lead_phone TEXT,
      linked_case_id TEXT,
      twilio_call_sid TEXT,
      call_status TEXT,
      voicemail_url TEXT,
      voicemail_transcript TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      answered_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// Auto-create a marketing_leads row for new caller numbers
async function ensureLead(phone: string) {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS marketing_leads (
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
      )`
    );
    await pool.query(
      `INSERT INTO marketing_leads (phone, source, stage, updated_at)
       VALUES ($1, 'phone_call', 'new', NOW())
       ON CONFLICT (phone) DO UPDATE SET updated_at = NOW()`,
      [phone]
    );
  } catch (e) { /* table may not exist on first call */ }
}

// Twilio sends form-encoded params, not JSON
async function parseTwilioBody(request: NextRequest): Promise<Record<string, string>> {
  const text = await request.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  params.forEach((v, k) => { out[k] = v; });
  return out;
}

// Returns TwiML XML response
function twiml(body: string): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    headers: { "Content-Type": "text/xml" },
  });
}

// ── POST: Twilio voice webhook ──
// Twilio calls this when an inbound call hits your Twilio number
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const params = await parseTwilioBody(request);

    const callSid = params.CallSid || "";
    const from = params.From || "";
    const to = params.To || "";
    const callerName = params.CallerName || "";

    console.log(`📞 Inbound call from ${from} to ${to} (SID: ${callSid})`);

    // Log the call IMMEDIATELY so staff can see it ring
    if (callSid && from) {
      const id = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await pool.query(
        `INSERT INTO call_log
          (id, direction, phone, contact_name, twilio_call_sid, call_status, source, called_at)
         VALUES ($1, 'inbound', $2, $3, $4, 'ringing', 'twilio', NOW())
         ON CONFLICT (id) DO NOTHING`,
        [id, from, callerName || null, callSid]
      ).catch(e => console.error("call_log insert failed:", e));

      await ensureLead(from);
    }

    // Build TwiML: forward to staff phones, fall back to voicemail
    if (FORWARD_TO.length === 0) {
      // No staff numbers configured — go straight to voicemail
      return twiml(`
<Response>
  <Say voice="Polly.Joanna">Thank you for calling Newton Immigration. Please leave a message after the tone and we will call you back shortly.</Say>
  <Record action="${PUBLIC_URL}/api/twilio-voicemail" maxLength="120" transcribe="true" transcribeCallback="${PUBLIC_URL}/api/twilio-voicemail/transcribe" playBeep="true"/>
  <Say voice="Polly.Joanna">We did not receive a message. Goodbye.</Say>
  <Hangup/>
</Response>
      `.trim());
    }

    // Build a <Dial> with multiple <Number> children — Twilio rings them all simultaneously
    const numbersXml = FORWARD_TO.map(n => `    <Number>${escapeXml(n)}</Number>`).join("\n");
    const callerIdAttr = CALLER_ID ? ` callerId="${escapeXml(CALLER_ID)}"` : "";

    return twiml(`
<Response>
  <Dial timeout="${RING_TIMEOUT}" answerOnBridge="true"${callerIdAttr} action="${PUBLIC_URL}/api/twilio-call-status">
${numbersXml}
  </Dial>
  <Say voice="Polly.Joanna">Sorry, we could not reach our team. Please leave a message after the tone.</Say>
  <Record action="${PUBLIC_URL}/api/twilio-voicemail" maxLength="120" transcribe="true" transcribeCallback="${PUBLIC_URL}/api/twilio-voicemail/transcribe" playBeep="true"/>
  <Hangup/>
</Response>
    `.trim());

  } catch (e) {
    console.error("Twilio voice webhook error:", (e as Error).message);
    // Always return valid TwiML even on error so the caller hears something
    return twiml(`
<Response>
  <Say>We are experiencing technical difficulties. Please try again later.</Say>
  <Hangup/>
</Response>
    `.trim());
  }
}

// Twilio also sends GET requests to validate the webhook on save
export async function GET() {
  return twiml(`<Response><Say>Newton Immigration webhook is live.</Say><Hangup/></Response>`);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
