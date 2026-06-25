// ─────────────────────────────────────────────────────────────────────
// PATCH  /api/tracking/[id]   → update a tracker entry (e.g. move the stage)
// DELETE /api/tracking/[id]   → remove a tracker entry
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { updateTracker, deleteTracker } from "@/lib/store";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const patch: Record<string, any> = { updatedBy: user.name };
  for (const k of ["applicationNumber", "clientName", "clientPhone", "applicationType", "stage", "nextStep", "notes", "archived", "pendingReview"]) {
    if (body[k] !== undefined) patch[k] = (k === "archived" || k === "pendingReview") ? Boolean(body[k]) : body[k];
  }
  // Clearing the review flag also clears its note.
  if (body.pendingReview === false) patch.pendingReviewNote = undefined;
  const updated = await updateTracker(user.companyId, params.id, patch);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, tracker: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ok = await deleteTracker(user.companyId, params.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
