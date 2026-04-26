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

// Twilio fires this asynchronously a few seconds/minutes after the voicemail is recorded,
// once their transcription service finishes processing the audio.
// Note: Twilio's free transcription is English-only and somewhat low quality.
//       For better quality, add Anthropic/OpenAI-based transcription on the recording URL.
export async function POST(request: NextRequest) {
  try {
    const params = await parseTwilioBody(request);

    const callSid = params.CallSid || "";
    const transcriptionText = params.TranscriptionText || "";
    const transcriptionStatus = params.TranscriptionStatus || "";

    console.log(`📝 Voicemail transcript for ${callSid}: status=${transcriptionStatus}`);

    if (callSid && transcriptionText && transcriptionStatus === "completed") {
      await pool.query(
        `UPDATE call_log
         SET voicemail_transcript = $1,
             notes = COALESCE(notes, '') || CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n\n' END || 'Voicemail transcript: ' || $1,
             updated_at = NOW()
         WHERE twilio_call_sid = $2`,
        [transcriptionText, callSid]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Transcription webhook error:", (e as Error).message);
    return NextResponse.json({ ok: false });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, webhook: "twilio-voicemail-transcribe" });
}
