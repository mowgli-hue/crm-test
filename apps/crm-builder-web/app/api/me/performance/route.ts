// app/api/me/performance/route.ts
//
// A staff member's OWN day-by-day performance history — for the personal
// performance calendar on their dashboard. Every factor that defines good work:
//   • output      — applications submitted that day
//   • accuracy    — reviewer change-flags ("errors") received on their cases
//   • effort      — hours logged, cases touched, sessions
// Each day gets a simple rating so the calendar can colour it.
//
//   GET ?days=60  → { days: [{date, hours, sessions, cases, submitted, errors, rating}],
//                     totals: { submitted, errors, accuracyPct, activeDays, hours, ... } }
//
// Auth: the logged-in staff member sees only their OWN numbers.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgres-store";
import { listAllStaff, listAllCases } from "@/lib/store";
import { buildCanonicalizer } from "@/lib/staff-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pacificDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get("days")) || 60, 14), 120);
  const now = Date.now();
  const sinceMs = now - days * 86_400_000;
  const sinceISO = new Date(sinceMs).toISOString();

  const [staff, cases] = await Promise.all([listAllStaff(), listAllCases()]);
  const canonical = buildCanonicalizer(staff.map((s) => String(s.name || "")));
  const me = canonical(user.name).toLowerCase();
  const myCases = cases.filter((c) => {
    const who = String((c as any).assignedTo || "").trim();
    return who && who.toLowerCase() !== "unassigned" && canonical(who).toLowerCase() === me;
  });
  const myCaseIds = myCases.map((c) => c.id);

  // ── per-day buckets ──
  type Day = { date: string; seconds: number; sessions: number; cases: number; submitted: number; errors: number };
  const byDay = new Map<string, Day>();
  const ensure = (d: string): Day => { if (!byDay.has(d)) byDay.set(d, { date: d, seconds: 0, sessions: 0, cases: 0, submitted: 0, errors: 0 }); return byDay.get(d)!; };

  // 1) Time logged per Pacific day (mine).
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT to_char(started_at AT TIME ZONE 'America/Vancouver','YYYY-MM-DD') AS d,
              COALESCE(SUM(duration_seconds),0)::int AS secs,
              COUNT(*)::int AS sessions,
              COUNT(DISTINCT case_id)::int AS cases
         FROM case_time_logs
        WHERE staff_id = $1 AND ended_at IS NOT NULL AND started_at >= $2
     GROUP BY d`,
      [user.id, sinceISO]
    );
    for (const x of r.rows as any[]) { const day = ensure(x.d); day.seconds = x.secs; day.sessions = x.sessions; day.cases = x.cases; }
  } catch (e) { console.error("[me/performance] time read failed:", (e as Error).message); }

  // 2) Submissions per Pacific day (my cases).
  for (const c of myCases) {
    const sub = (c as any).submittedAt as string | undefined;
    if (!sub) continue;
    const ms = Date.parse(sub);
    if (Number.isNaN(ms) || ms < sinceMs) continue;
    ensure(pacificDate(ms)).submitted += 1;
  }

  // 3) Errors (reviewer change-flags) per Pacific day on my cases.
  if (myCaseIds.length) {
    try {
      const pool = getPool();
      const rc = await pool.query(
        `SELECT to_char(created_at AT TIME ZONE 'America/Vancouver','YYYY-MM-DD') AS d, COUNT(*)::int AS n
           FROM review_comments
          WHERE parent_id IS NULL AND created_at >= $2 AND case_id = ANY($1)
       GROUP BY d`,
        [myCaseIds, sinceISO]
      );
      for (const x of rc.rows as any[]) ensure(x.d).errors += x.n;
      const cn = await pool.query(
        `SELECT to_char(created_at AT TIME ZONE 'America/Vancouver','YYYY-MM-DD') AS d, COUNT(*)::int AS n
           FROM case_notes
          WHERE created_at >= $2 AND case_id = ANY($1)
            AND ( text ILIKE '⚠️%CHANGES NEEDED%' OR text ILIKE 'CHANGES NEEDED%'
               OR text ILIKE 'CHANGE NEEDED%' OR text ILIKE 'CHANGES HIGHLIGHTED%'
               OR text ILIKE 'CHANGES REQUIRED%' )
       GROUP BY d`,
        [myCaseIds, sinceISO]
      );
      for (const x of cn.rows as any[]) ensure(x.d).errors += x.n;
    } catch (e) { console.error("[me/performance] error read failed:", (e as Error).message); }
  }

  // ── rate each day for the calendar colour ──
  // strong = output, no errors · flagged = got rework · progress = worked, no
  // output yet · off = nothing logged.
  const rate = (d: Day): "strong" | "good" | "flagged" | "progress" | "off" => {
    const worked = d.seconds > 0 || d.sessions > 0;
    if (!worked && d.submitted === 0 && d.errors === 0) return "off";
    if (d.errors > 0) return "flagged";
    if (d.submitted > 0) return "strong";
    return "progress";
  };

  const list = Array.from(byDay.values()).map((d) => ({
    date: d.date,
    hours: Math.round((d.seconds / 3600) * 10) / 10,
    sessions: d.sessions,
    cases: d.cases,
    submitted: d.submitted,
    errors: d.errors,
    rating: rate(d),
  })).sort((a, b) => a.date.localeCompare(b.date));

  const submitted = list.reduce((a, x) => a + x.submitted, 0);
  const errors = list.reduce((a, x) => a + x.errors, 0);
  const activeDays = list.filter((x) => x.hours > 0 || x.sessions > 0).length;
  const totalHours = Math.round(list.reduce((a, x) => a + x.hours, 0) * 10) / 10;
  // Accuracy = clean rate of submissions (no rework). Efficiency = output per active day.
  const accuracyPct = submitted > 0 ? Math.max(0, Math.round((1 - errors / submitted) * 100)) : null;

  return NextResponse.json({
    ok: true,
    name: user.name,
    windowDays: days,
    days: list,
    totals: {
      submitted,
      errors,
      accuracyPct,
      activeDays,
      totalHours,
      avgHoursPerActiveDay: activeDays ? Math.round((totalHours / activeDays) * 10) / 10 : 0,
      submittedPerActiveDay: activeDays ? Math.round((submitted / activeDays) * 10) / 10 : 0,
    },
  });
}
