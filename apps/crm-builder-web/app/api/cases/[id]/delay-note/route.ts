// POST /api/cases/[id]/delay-note  — the assigned staff (or a manager) records
// WHY a long-pending file has been sitting. Shown in the manager brief.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { setCaseDelayReason } from "@/lib/store";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (!reason) return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  const updated = await setCaseDelayReason(user.companyId, params.id, reason, user.name);
  if (!updated) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  return NextResponse.json({ ok: true, case: { id: updated.id, delayReason: updated.delayReason, delayReasonAt: updated.delayReasonAt } });
}
