import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { deleteSubmission, updateSubmission } from "@/lib/store";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patch: any = {};
  if ("clientName" in body) patch.clientName = String(body.clientName || "");
  if ("clientPhone" in body) patch.clientPhone = String(body.clientPhone || "");
  if ("appType" in body) patch.appType = String(body.appType || "");
  if ("submittedDate" in body) patch.submittedDate = String(body.submittedDate || "");
  if ("irccReference" in body) patch.irccReference = String(body.irccReference || "");
  if ("status" in body) {
    const valid = ["submitted", "aor_received", "decision_pending", "approved", "refused"];
    patch.status = valid.includes(body.status) ? body.status : "submitted";
  }
  if ("notes" in body) patch.notes = String(body.notes || "");
  if ("submittedBy" in body) patch.submittedBy = String(body.submittedBy || "");

  const entry = await updateSubmission(user.companyId, params.id, patch);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ok = await deleteSubmission(user.companyId, params.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
