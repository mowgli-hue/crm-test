// app/api/admin/dashboard/route.ts
//
// Admin-only overview metrics. Returns aggregate counts and per-staff
// workload data so the Admin Dashboard screen can render KPI cards
// without N+1 lookups on the client.
//
// Auth: Admin only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listCases, listUsers, listAuditLogs } from "@/lib/store";

function daysAgo(iso: string | undefined | null): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!t) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }

  const cases = await listCases(user.companyId);
  const users = await listUsers(user.companyId);
  const staffUsers = users.filter((u) => u.userType === "staff");

  // KPIs ──────────────────────────────────────────────────────────────────
  const total = cases.length;
  const byStatus: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  let urgent = 0;
  let submittedThisMonth = 0;
  let createdThisWeek = 0;
  let stuckOver14d = 0;
  let stuckOver30d = 0;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);

  for (const c of cases) {
    const ps = String(c.processingStatus || "docs_pending");
    byStatus[ps] = (byStatus[ps] || 0) + 1;
    const st = String(c.stage || "unknown");
    byStage[st] = (byStage[st] || 0) + 1;
    if (c.isUrgent) urgent++;
    if (ps === "submitted" && c.submittedAt && new Date(c.submittedAt) >= monthStart) {
      submittedThisMonth++;
    }
    if (c.createdAt && new Date(c.createdAt) >= weekStart) {
      createdThisWeek++;
    }
    if (ps !== "submitted") {
      const age = daysAgo(c.createdAt);
      if (age > 30) stuckOver30d++;
      else if (age > 14) stuckOver14d++;
    }
  }

  // Per-staff workload ────────────────────────────────────────────────────
  const workload: Array<{
    name: string;
    email: string;
    role: string;
    total: number;
    urgent: number;
    stale: number;
    inProcessing: number;
    underReview: number;
  }> = staffUsers.map((u) => {
    const mine = cases.filter((c) =>
      String(c.assignedTo || "").trim().toLowerCase() === String(u.name).trim().toLowerCase()
    );
    return {
      name: u.name,
      email: u.email || "",
      role: u.role,
      total: mine.length,
      urgent: mine.filter((c) => c.isUrgent).length,
      stale: mine.filter((c) => c.processingStatus !== "submitted" && daysAgo(c.updatedAt) > 7).length,
      inProcessing: mine.filter((c) => c.processingStatus !== "submitted").length,
      underReview: mine.filter((c) => c.processingStatus === "under_review").length,
    };
  });

  // Unassigned bucket
  const unassigned = cases.filter((c) => !c.assignedTo || c.assignedTo === "Unassigned").length;

  // Top stuck cases (oldest first, max 10) ─────────────────────────────────
  const topStuck = cases
    .filter((c) => c.processingStatus !== "submitted")
    .map((c) => ({
      id: c.id,
      client: c.client,
      formType: c.formType,
      assignedTo: c.assignedTo || "Unassigned",
      processingStatus: c.processingStatus || "docs_pending",
      daysOld: Math.floor(daysAgo(c.createdAt)),
      daysSinceUpdate: Math.floor(daysAgo(c.updatedAt)),
      isUrgent: !!c.isUrgent,
    }))
    .sort((a, b) => b.daysOld - a.daysOld)
    .slice(0, 10);

  // Recent activity (audit log peek, max 15) ───────────────────────────────
  const recentAuditLogs = await listAuditLogs(user.companyId, 30);
  const recentActivity = recentAuditLogs.slice(0, 15).map((l) => ({
    when: l.createdAt,
    actor: l.actorName,
    action: l.action,
    resourceType: l.resourceType,
    resourceId: l.resourceId,
  }));

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    kpis: {
      total,
      urgent,
      unassigned,
      submittedThisMonth,
      createdThisWeek,
      stuckOver14d,
      stuckOver30d,
    },
    byStatus,
    byStage,
    workload,
    topStuck,
    recentActivity,
  });
}
