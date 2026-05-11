// ─────────────────────────────────────────────────────────────────────
// GET /api/inbox/24h-check?phone=14165551234
//
// Reports whether the WhatsApp 24-hour service window is OPEN for a
// given phone. Meta policy:
//   - When a user sends YOU a message, a 24-hour "service window" opens
//   - During that window, you can send free-form messages back
//   - After 24 hours of silence, free-form messages are SILENTLY DROPPED
//     by Meta (the API still returns 200 OK, but the client never
//     receives anything)
//   - To message after the window closes, you must use an approved
//     template message
//
// This endpoint lets the inbox UI warn staff BEFORE they hit send on a
// free-form message that won't deliver. Otherwise staff types out a
// careful response, clicks Send, sees green checkmarks, and never knows
// the client didn't get it — confusion all around.
//
// Returns:
//   {
//     insideWindow: boolean,    // true if free-form is safe to send now
//     lastInboundAt: ISO | null,
//     hoursAgo: number,         // hours since last inbound message
//   }
//
// If no inbound messages found at all, returns insideWindow=false
// (the client never opened a window with us).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const rawPhone = url.searchParams.get("phone");
  if (!rawPhone) {
    return NextResponse.json({ error: "phone required" }, { status: 400 });
  }

  // Canonical form: last 9 digits. Phone is stored in many formats
  // (with/without country code, dashes, plus signs). Matching on the
  // last 9 digits catches every variant that Meta has ever sent us for
  // the same person.
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 9) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }
  const last9 = digits.slice(-9);

  try {
    const res = await pool.query(
      `SELECT created_at FROM whatsapp_inbox
        WHERE direction = 'inbound'
          AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [last9]
    );

    if (res.rowCount === 0) {
      // Never received an inbound from this number. We've never been
      // inside a window for them — they have to message us first OR we
      // use a template.
      return NextResponse.json({
        insideWindow: false,
        lastInboundAt: null,
        hoursAgo: Infinity,
        reason: "no_inbound_history",
      });
    }

    const lastInboundAt = res.rows[0].created_at as string;
    const lastMs = new Date(lastInboundAt).getTime();
    if (!Number.isFinite(lastMs)) {
      return NextResponse.json({
        insideWindow: false,
        lastInboundAt: null,
        hoursAgo: Infinity,
        reason: "bad_timestamp",
      });
    }
    const hoursAgo = (Date.now() - lastMs) / (1000 * 60 * 60);
    // 24h Meta window, but we use 23.5 as a safety margin — Meta's
    // window clock isn't perfectly aligned with ours, and we'd rather
    // false-alarm staff at 23h59 than have them send a message that
    // gets dropped at 24h00.
    const SAFETY_THRESHOLD_HOURS = 23.5;
    const insideWindow = hoursAgo < SAFETY_THRESHOLD_HOURS;

    return NextResponse.json({
      insideWindow,
      lastInboundAt,
      hoursAgo,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `DB error: ${(e as Error).message.slice(0, 200)}` },
      { status: 500 }
    );
  }
}
