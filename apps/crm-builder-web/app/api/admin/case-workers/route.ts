// app/api/admin/case-workers/route.ts
//
// For every case, who has actually WORKED it (from the time-tracking logs) and
// how much — the real "who had this / how far along" signal. Used to redistribute
// cases intelligently: a case someone logged real time on should go back to that
// person; an untouched case can go to anyone.
//
//   GET  → { workers: { [caseId]: { name, staffId, seconds, sessions, lastOutcome, lastAt } } }
//
// Admin only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgres-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — admins only" }, { status: 403 });
  }

  const workers: Record<string, { name: string; staffId: string; seconds: number; sessions: number; lastOutcome: string; lastAt: string | null }> = {};
  try {
    const pool = getPool();
    // Per case + worker, total time + sessions + last activity. We then keep the
    // top worker per case (most time logged).
    const r = await pool.query(
      `SELECT case_id, staff_id,
              MAX(staff_name) AS name,
              COALESCE(SUM(duration_seconds),0)::int AS secs,
              COUNT(*)::int AS sessions,
              MAX(ended_at) AS last_at,
              (ARRAY_AGG(outcome ORDER BY ended_at DESC))[1] AS last_outcome
         FROM case_time_logs
        WHERE ended_at IS NOT NULL
     GROUP BY case_id, staff_id`
    );
    for (const row of r.rows as any[]) {
      const cur = workers[row.case_id];
      if (!cur || row.secs > cur.seconds) {
        workers[row.case_id] = {
          name: row.name || "",
          staffId: row.staff_id || "",
          seconds: row.secs || 0,
          sessions: row.sessions || 0,
          lastOutcome: row.last_outcome || "",
          lastAt: row.last_at || null,
        };
      }
    }
  } catch (e) {
    console.error("[case-workers] read failed:", (e as Error).message);
  }

  return NextResponse.json({ ok: true, caseCount: Object.keys(workers).length, workers });
}
