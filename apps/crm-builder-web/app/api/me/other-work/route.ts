// app/api/me/other-work/route.ts
//
// "I'm working on something else" — lets a staff member log time on work that
// isn't a CRM case (training, a walk-in client, phone calls, an off-system task
// an old hand is handling). It records to the same time-tracking system as case
// check-ins, so the hours count toward their day and show in the end-of-day
// report and the Ops Lead — with a note describing what they did, so it's fair
// and visible, not invisible.
//
//   POST { action: "start", note }  → start an off-CRM work session (note required)
//   POST { action: "stop",  note }  → end it (note optional, appends)
//   GET                             → is an off-CRM session active right now?
//
// Auth: the logged-in staff member acts on their OWN time only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { checkIn, checkOut, getActiveSession } from "@/lib/time-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A single, recognizable pseudo-case id for non-case work. Sessions are keyed by
// staff id, so everyone's "other work" stays attributed to the right person; this
// id just marks it as off-CRM in reports.
const OFF_CRM = "OFF-CRM";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const active = await getActiveSession(user.id);
  return NextResponse.json({ ok: true, onOtherWork: active?.caseId === OFF_CRM, active: active ? { caseId: active.caseId, startedAt: active.startedAt, note: active.note } : null });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({} as any));
  const action = String(body?.action || "").toLowerCase();
  const note = String(body?.note || "").trim();

  if (action === "start") {
    if (!note) return NextResponse.json({ error: "Please add a short note about what you're working on." }, { status: 400 });
    // checkIn auto-closes any open case session — they've switched to off-CRM work.
    const row = await checkIn({ companyId: user.companyId, caseId: OFF_CRM, staffId: user.id, staffName: user.name, note });
    return NextResponse.json({ ok: true, started: true, startedAt: row.startedAt, note });
  }

  if (action === "stop") {
    const res = await checkOut({ caseId: OFF_CRM, staffId: user.id, note, outcome: "other" });
    return NextResponse.json({ ok: true, stopped: true, closed: res.closed });
  }

  return NextResponse.json({ error: "action must be 'start' or 'stop'" }, { status: 400 });
}
