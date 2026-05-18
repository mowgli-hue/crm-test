// app/api/cases/[id]/audit/route.ts
//
// Returns the audit-log entries for a single case in chronological order
// (oldest first). Lets staff investigate "who created this case", "who
// reassigned it", "when was status changed", etc.
//
// Auth: any staff user can view (read-only). Returns 403 for client users.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listAuditLogs } from "@/lib/store";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const caseId = params.id;

  // Fetch a generous slice of audit logs and filter for this case. The store
  // is small enough (a few thousand entries max) that this is cheap.
  const allLogs = await listAuditLogs(user.companyId, 1000);
  const caseLogs = allLogs
    .filter((l) => l.resourceType === "case" && l.resourceId === caseId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first

  return NextResponse.json({ logs: caseLogs });
}