// app/api/admin/staff-day/route.ts
//
// One staff member's work history for the current (Pacific) day — what they
// checked into, for how long, the status they left it in, and their note.
// Powers the "click a name → see their day" view on the team board.
//
//   GET ?staffId=USR-123  → { staffId, active, totalSeconds, sessions: [...] }
//
// Auth: Admin only (it exposes an individual's activity).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { myDayLog, getActiveSession } from "@/lib/time-tracking";
import { listAllCases } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — admins only" }, { status: 403 });
  }
  const staffId = (new URL(request.url).searchParams.get("staffId") || "").trim();
  if (!staffId) return NextResponse.json({ error: "staffId required" }, { status: 400 });

  const [sessions, active, cases] = await Promise.all([
    myDayLog(staffId),
    getActiveSession(staffId),
    listAllCases(),
  ]);
  const clientByCase = new Map(cases.map((c) => [c.id, String((c as any).client || "")]));

  const enrich = (s: any) => ({
    caseId: s.caseId,
    client: clientByCase.get(s.caseId) || "",
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationSeconds: s.durationSeconds || 0,
    outcome: s.outcome || "",
    note: s.note || "",
    source: s.source,
  });

  const totalSeconds = sessions.reduce((a, s) => a + (s.durationSeconds || 0), 0);

  return NextResponse.json({
    ok: true,
    staffId,
    totalSeconds,
    active: active ? { caseId: active.caseId, client: clientByCase.get(active.caseId) || "", startedAt: active.startedAt } : null,
    sessions: sessions.map(enrich),
  });
}
