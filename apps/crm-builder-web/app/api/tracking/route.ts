// ─────────────────────────────────────────────────────────────────────
// GET  /api/tracking          → list this company's tracker entries
// POST /api/tracking          → create a tracker entry
//
// The post-ITA / PR milestone tracker. Staff enter an application number +
// client name and move the stage forward as IRCC emails arrive.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listTrackers, createTracker } from "@/lib/store";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const trackers = await listTrackers(user.companyId);
  return NextResponse.json({ ok: true, trackers });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientName = String(body.clientName || "").trim();
  const applicationNumber = String(body.applicationNumber || "").trim();
  if (!clientName && !applicationNumber) {
    return NextResponse.json({ error: "Client name or application number is required" }, { status: 400 });
  }
  const entry = await createTracker({
    companyId: user.companyId,
    applicationNumber,
    clientName,
    clientPhone: body.clientPhone,
    applicationType: body.applicationType,
    stage: body.stage,
    nextStep: body.nextStep,
    notes: body.notes,
    caseId: body.caseId ?? null,
    updatedBy: user.name,
  });
  return NextResponse.json({ ok: true, tracker: entry });
}
