// app/api/admin/bulk-reassign/route.ts
//
// Reassign many cases at once in a single store write — for team rebalancing /
// onboarding. Far faster than PATCHing each case (which re-syncs Google Sheets
// per case). Admin only.
//
//   POST { assignments: [{ caseId, assignTo }] }  → { ok, updated, notFound }
//
// Every change is recorded as one audit-log entry summarising the batch.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { bulkReassignCases } from "@/lib/store";
import { insertAuditLogRow } from "@/lib/postgres-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — admins only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({} as any));
  const raw = Array.isArray(body?.assignments) ? body.assignments : [];
  const assignments = raw
    .map((a: any) => ({ caseId: String(a?.caseId || "").trim(), assignTo: String(a?.assignTo || "").trim() }))
    .filter((a: any) => a.caseId && a.assignTo);
  if (assignments.length === 0) {
    return NextResponse.json({ error: "assignments: [{caseId, assignTo}] required" }, { status: 400 });
  }
  if (assignments.length > 1000) {
    return NextResponse.json({ error: "Too many assignments in one call (max 1000)." }, { status: 400 });
  }

  const result = await bulkReassignCases(assignments);

  // Per-person tally for the audit record.
  const tally: Record<string, number> = {};
  for (const a of assignments) tally[a.assignTo] = (tally[a.assignTo] || 0) + 1;

  try {
    await insertAuditLogRow({
      id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      companyId: user.companyId,
      actorUserId: user.id,
      actorName: user.name,
      action: "bulk_reassign",
      resourceType: "case",
      resourceId: `${result.updated} cases`,
      metadata: { updated: String(result.updated), tally: JSON.stringify(tally).slice(0, 400) },
    });
  } catch { /* audit best-effort */ }

  return NextResponse.json({ ok: true, ...result, tally });
}
