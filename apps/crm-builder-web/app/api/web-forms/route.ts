import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { createWebForm, listWebForms } from "@/lib/store";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await listWebForms(user.companyId);
  return NextResponse.json({ rows });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const entry = await createWebForm({
    companyId: user.companyId,
    clientName: body.clientName,
    caseId: body.caseId || null,
    formType: body.formType,
    dateSubmitted: body.dateSubmitted,
    status: body.status === "done" ? "done" : "pending",
    link: body.link,
    assignedTo: body.assignedTo,
    notes: body.notes,
  });
  return NextResponse.json({ entry }, { status: 201 });
}
