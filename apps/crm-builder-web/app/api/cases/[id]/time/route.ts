// ─────────────────────────────────────────────────────────────────────
// GET  /api/cases/[id]/time   → { active, summary } for the current case
// POST /api/cases/[id]/time   → { action: "in" | "out" | "manual", minutes?, note? }
//
// Application check-in time tracking. The staff member is always the logged-in
// user (you can't log time as someone else). See lib/time-tracking.ts.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase } from "@/lib/store";
import { canStaffAccessCase } from "@/lib/rbac";
import {
  checkIn, checkOut, addManualEntry, getActiveSession, caseTimeSummary,
} from "@/lib/time-tracking";

export const runtime = "nodejs";

async function guard(request: NextRequest, caseId: string) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.userType !== "staff") return { error: NextResponse.json({ error: "Forbidden — staff only" }, { status: 403 }) };
  const caseItem = await getCase(user.companyId, caseId);
  if (!caseItem) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (!canStaffAccessCase(user.role, user.name, caseItem.assignedTo)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, caseItem };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request, params.id);
  if (g.error) return g.error;
  const active = await getActiveSession(g.user!.id);
  const summary = await caseTimeSummary(params.id);
  return NextResponse.json({
    ok: true,
    // active is only "for this case" from the UI's point of view if it points here
    active: active && active.caseId === params.id ? active : null,
    activeElsewhere: active && active.caseId !== params.id ? { caseId: active.caseId, startedAt: active.startedAt } : null,
    summary,
  });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request, params.id);
  if (g.error) return g.error;
  const body = (await request.json().catch(() => ({}))) as { action?: string; minutes?: number; note?: string; outcome?: string };
  const staffId = g.user!.id;
  const staffName = g.user!.name;
  const companyId = g.user!.companyId;

  try {
    if (body.action === "in") {
      const session = await checkIn({ companyId, caseId: params.id, staffId, staffName, note: body.note });
      return NextResponse.json({ ok: true, active: session });
    }
    if (body.action === "out") {
      const res = await checkOut({ caseId: params.id, staffId, note: body.note, outcome: body.outcome });
      const summary = await caseTimeSummary(params.id);
      return NextResponse.json({ ok: true, closed: res.closed, summary });
    }
    if (body.action === "manual") {
      const minutes = Number(body.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 12 * 60) {
        return NextResponse.json({ error: "minutes must be 1–720" }, { status: 400 });
      }
      const entry = await addManualEntry({ companyId, caseId: params.id, staffId, staffName, minutes, note: body.note });
      const summary = await caseTimeSummary(params.id);
      return NextResponse.json({ ok: true, entry, summary });
    }
    return NextResponse.json({ error: "action must be in | out | manual" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
