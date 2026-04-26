import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function parseTwilioBody(request: NextRequest): Promise<Record<string, string>> {
  const text = await request.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  params.forEach((v, k) => { out[k] = v; });
  return out;
}

// Twilio fires this webhook when the <Dial> verb completes (call ended, no answer, busy, etc.)
// DialCallStatus values: completed, busy, no-answer, failed, canceled
// Also gets the duration in seconds
export async function POST(request: NextRequest) {
  try {
    const params = await parseTwilioBody(request);

    const callSid = params.CallSid || params.ParentCallSid || "";
    const dialStatus = params.DialCallStatus || params.CallStatus || "";
    const dialDuration = parseInt(params.DialCallDuration || params.CallDuration || "0", 10);
    const recordingUrl = params.RecordingUrl || "";

    console.log(`📞 Call ${callSid} ended: status=${dialStatus}, duration=${dialDuration}s`);

    // Map Twilio status → our outcome
    let outcome: string | null = null;
    let answeredAt: string | null = null;

    if (dialStatus === "completed") {
      outcome = "info_provided"; // staff actually answered & talked — they can re-categorize later
      answeredAt = new Date(Date.now() - dialDuration * 1000).toISOString();
    } else if (dialStatus === "no-answer" || dialStatus === "no_answer") {
      outcome = "no_answer";
    } else if (dialStatus === "busy") {
      outcome = "no_answer";
    } else if (dialStatus === "failed" || dialStatus === "canceled") {
      outcome = "no_answer";
    }

    if (callSid) {
      await pool.query(
        `UPDATE call_log
         SET call_status = $1,
             duration_seconds = $2,
             duration_minutes = CASE WHEN $2 > 0 THEN GREATEST(1, ROUND($2::numeric / 60.0)) ELSE NULL END,
             outcome = COALESCE(outcome, $3),
             answered_at = COALESCE(answered_at, $4::timestamptz),
             ended_at = NOW(),
             updated_at = NOW()
         WHERE twilio_call_sid = $5`,
        [dialStatus, dialDuration, outcome, answeredAt, callSid]
      );
    }

    // Twilio expects a TwiML response (or empty 200). If we don't return TwiML on action callback,
    // the call drops. Return empty <Response/> so the call ends cleanly without further prompts.
    return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (e) {
    console.error("Twilio call-status webhook error:", (e as Error).message);
    return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, {
      headers: { "Content-Type": "text/xml" },
    });
  }
}

// Health check
export async function GET() {
  return NextResponse.json({ ok: true, webhook: "twilio-call-status" });
}
