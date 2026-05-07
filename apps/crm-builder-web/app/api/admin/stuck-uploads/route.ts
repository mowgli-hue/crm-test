// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/stuck-uploads
//
// Diagnostic endpoint: finds inbox rows still showing "pending=1"
// (the "Uploading…" state) older than a threshold. These are uploads
// that started but never completed S3 save or inbox UPDATE.
//
// Real bug from Newton: Harwinder Singh (CASE-1394) had 4 docs stuck
// at "Uploading…" with no logs because container restarted before we
// could grab them. This endpoint lets staff find stuck uploads anytime.
//
// Returns:
//   stuckCount: number of pending rows older than threshold
//   rows: each row with id, phone, age in minutes, matched case
//
// Usage from CLI:
//   curl https://crm.newtonimmigration.com/api/admin/stuck-uploads
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const minAgeMinutes = parseInt(url.searchParams.get("minAge") || "5", 10);

  try {
    const result = await pool.query(
      `SELECT id, phone, message, matched_case_id, matched_case_name, created_at,
              EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 as age_minutes
       FROM whatsapp_inbox
       WHERE message LIKE '%pending=1%'
         AND created_at < NOW() - INTERVAL '${minAgeMinutes} minutes'
       ORDER BY created_at DESC
       LIMIT 50`
    );

    const rows = result.rows.map((r: any) => {
      // Extract msgId, caption, kind from placeholder format:
      // [doc:msgId|kind=...|pending=1|caption=...]
      const msg = String(r.message || "");
      const msgIdMatch = msg.match(/\[doc:([^|]+)\|/);
      const kindMatch = msg.match(/kind=([^|]+)/);
      const captionMatch = msg.match(/caption=([^|\]]+)/);
      return {
        rowId: r.id,
        phone: r.phone,
        msgId: msgIdMatch?.[1] || "?",
        kind: kindMatch?.[1] || "?",
        caption: captionMatch?.[1] ? decodeURIComponent(captionMatch[1]) : "",
        case: r.matched_case_name || r.matched_case_id || "(unmatched)",
        ageMinutes: Math.round(r.age_minutes),
        createdAt: r.created_at,
      };
    });

    return NextResponse.json({
      ok: true,
      stuckCount: rows.length,
      thresholdMinutes: minAgeMinutes,
      rows,
      hint:
        rows.length > 0
          ? "These uploads never completed. Causes: (a) downloadWaMedia failed, (b) S3 putObject failed, (c) inbox UPDATE failed. Check logs around the createdAt of each row."
          : "No stuck uploads — all WA uploads completing normally.",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
