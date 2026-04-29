import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { createPrConsultation, listPrConsultations } from "@/lib/store";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await listPrConsultations(user.companyId);
  return NextResponse.json({ rows });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const entry = await createPrConsultation({
    companyId: user.companyId,
    clientName: body.clientName,
    clientPhone: body.clientPhone,
    clientEmail: body.clientEmail,
    paymentAmount: Number(body.paymentAmount || 0),
    paymentReceived: body.paymentReceived === true,
    paymentMethod: body.paymentMethod,
    consultationDate: body.consultationDate,
    consultant: body.consultant,
    status: body.status === "done" ? "done" : "pending",
    notes: body.notes,
  });
  return NextResponse.json({ entry }, { status: 201 });
}
