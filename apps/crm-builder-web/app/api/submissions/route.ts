import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { createSubmission, listSubmissions } from "@/lib/store";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await listSubmissions(user.companyId);
  return NextResponse.json({ rows });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));

  // Idempotency: if a caseId is provided AND a submission already exists for it,
  // return the existing row instead of creating a duplicate.
  // This protects against double-submission when staff click submit twice.
  if (body.caseId) {
    const existing = await listSubmissions(user.companyId);
    const dupe = existing.find((s) => s.caseId === body.caseId);
    if (dupe) {
      return NextResponse.json({ entry: dupe, dedupe: true }, { status: 200 });
    }
  }

  const entry = await createSubmission({
    companyId: user.companyId,
    caseId: body.caseId || null,
    clientName: body.clientName,
    clientPhone: body.clientPhone,
    appType: body.appType,
    submittedDate: body.submittedDate,
    irccReference: body.irccReference,
    status: body.status || "submitted",
    notes: body.notes,
    submittedBy: body.submittedBy || user.name || "",
  });
  return NextResponse.json({ entry }, { status: 201 });
}
