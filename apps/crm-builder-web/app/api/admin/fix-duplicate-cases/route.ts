// app/api/admin/fix-duplicate-cases/route.ts
//
// Diagnose + repair duplicate CASE-ids caused by company_id drift.
//
//   GET  ?phone=4376607947            → report only (no changes): duplicate ids,
//                                        company distribution, phone matches.
//   POST { confirm: true, alignCompanyId?: "newton" }
//                                      → keep the oldest case for each colliding
//                                        id, give every newer duplicate a fresh
//                                        unique CASE number; optionally re-point
//                                        repaired cases to alignCompanyId so the
//                                        processing team can see them.
//
// Admin only. The repair is reversible in spirit (it only renames/moves the
// duplicate, never deletes) but still gated behind an explicit confirm.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { inspectCaseData, repairDuplicateCaseIds } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }
  const phone = request.nextUrl.searchParams.get("phone") || undefined;
  const report = await inspectCaseData(phone);
  return NextResponse.json({ ok: true, report });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return NextResponse.json(
      { error: "Confirmation required. Re-send with { confirm: true }. Optionally include alignCompanyId to move repaired cases to a company the processing team sees." },
      { status: 400 }
    );
  }
  const alignCompanyId = typeof body?.alignCompanyId === "string" && body.alignCompanyId.trim()
    ? body.alignCompanyId.trim()
    : undefined;

  const { changes } = await repairDuplicateCaseIds({ alignCompanyId });
  console.log(`[fix-duplicate-cases] ${user.name || user.id} repaired ${changes.length} duplicate case id(s)`, changes);
  return NextResponse.json({ ok: true, repaired: changes.length, changes });
}
