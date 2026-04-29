import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { deleteWebForm, updateWebForm } from "@/lib/store";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patch: any = {};
  if ("clientName" in body) patch.clientName = String(body.clientName || "");
  if ("caseId" in body) patch.caseId = body.caseId || null;
  if ("formType" in body) patch.formType = String(body.formType || "");
  if ("dateSubmitted" in body) patch.dateSubmitted = String(body.dateSubmitted || "");
  if ("status" in body) patch.status = body.status === "done" ? "done" : "pending";
  if ("link" in body) patch.link = String(body.link || "");
  if ("assignedTo" in body) patch.assignedTo = String(body.assignedTo || "");
  if ("notes" in body) patch.notes = String(body.notes || "");

  const entry = await updateWebForm(user.companyId, params.id, patch);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ok = await deleteWebForm(user.companyId, params.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
