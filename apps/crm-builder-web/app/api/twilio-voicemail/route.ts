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

// Fires when caller finishes leaving a voicemail (Record verb completed)
export async function POST(request: NextRequest) {
  try {
    const params = await parseTwilioBody(request);

    const callSid = params.CallSid || "";
    const recordingUrl = params.RecordingUrl || "";
    const recordingDuration = parseInt(params.RecordingDuration || "0", 10);

    console.log(`🎤 Voicemail received for ${callSid}: ${recordingUrl} (${recordingDuration}s)`);

    if (callSid && recordingUrl) {
      await pool.query(
        `UPDATE call_log
         SET voicemail_url = $1,
             outcome = 'voicemail',
             call_status = 'voicemail',
             duration_seconds = COALESCE(duration_seconds, $2),
             updated_at = NOW()
         WHERE twilio_call_sid = $3`,
        [recordingUrl, recordingDuration, callSid]
      );
    }

    // End the call
    return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thank you. We will return your call shortly.</Say>
  <Hangup/>
</Response>`, {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (e) {
    console.error("Voicemail webhook error:", (e as Error).message);
    return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`, {
      headers: { "Content-Type": "text/xml" },
    });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, webhook: "twilio-voicemail" });
}
