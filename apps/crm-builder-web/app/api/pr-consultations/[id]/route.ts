import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { deletePrConsultation, updatePrConsultation } from "@/lib/store";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patch: any = {};
  if ("clientName" in body) patch.clientName = String(body.clientName || "");
  if ("clientPhone" in body) patch.clientPhone = String(body.clientPhone || "");
  if ("clientEmail" in body) patch.clientEmail = String(body.clientEmail || "");
  if ("paymentAmount" in body) patch.paymentAmount = Number(body.paymentAmount || 0);
  if ("paymentReceived" in body) patch.paymentReceived = body.paymentReceived === true;
  if ("paymentMethod" in body) patch.paymentMethod = String(body.paymentMethod || "");
  if ("consultationDate" in body) patch.consultationDate = String(body.consultationDate || "");
  if ("consultant" in body) patch.consultant = String(body.consultant || "");
  if ("status" in body) patch.status = body.status === "done" ? "done" : "pending";
  if ("notes" in body) patch.notes = String(body.notes || "");

  const entry = await updatePrConsultation(user.companyId, params.id, patch);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ok = await deletePrConsultation(user.companyId, params.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
