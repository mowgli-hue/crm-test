// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/at-risk
//
// Manager view: the whole firm's active cases, scored with the SAME signals as
// My Day (deadlines + document-readiness + status), grouped into risk buckets
// so a lead can see what's slipping across everyone — plus an at-risk count per
// team member. Managers only (Admin / Marketing / ProcessingLead / Reviewer).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listCases, listAllDocumentsByCase } from "@/lib/store";
import { canSeeAllCases } from "@/lib/rbac";
import { scoreCase, isClosed, riskBucket, type RiskBucket } from "@/lib/case-priority";

export const runtime = "nodejs";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

type Row = {
  caseId: string; client: string; type: string; assignedTo: string;
  reason: string; ready: string; deadlineDays: number | null; score: number;
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!canSeeAllCases(user.role)) return NextResponse.json({ error: "Forbidden — managers only" }, { status: 403 });

  const [all, docsByCase] = await Promise.all([
    listCases(user.companyId || COMPANY_ID),
    listAllDocumentsByCase(),
  ]);

  const buckets: Record<RiskBucket, Row[]> = {
    overdue: [], due_soon: [], ready: [], assemble: [], stalled: [], in_progress: [],
  };
  const assigneeAtRisk = new Map<string, number>();

  for (const c of all as any[]) {
    if (isClosed(c)) continue;
    const s = scoreCase(c, docsByCase.get(c.id) || []);
    const bucket = riskBucket(s);
    const assignedTo = String(c.assignedTo || "Unassigned");
    const row: Row = {
      caseId: c.id,
      client: String(c.client || ""),
      type: String(c.formType || ""),
      assignedTo,
      reason: s.reason,
      ready: s.ready,
      deadlineDays: s.deadlineDays,
      score: s.score,
    };
    buckets[bucket].push(row);
    if (bucket === "overdue" || bucket === "due_soon" || bucket === "stalled") {
      assigneeAtRisk.set(assignedTo, (assigneeAtRisk.get(assignedTo) || 0) + 1);
    }
  }

  for (const k of Object.keys(buckets) as RiskBucket[]) {
    buckets[k].sort((a, b) => b.score - a.score);
  }

  const perAssignee = Array.from(assigneeAtRisk.entries())
    .map(([name, atRisk]) => ({ name, atRisk }))
    .sort((a, b) => b.atRisk - a.atRisk);

  return NextResponse.json({
    ok: true,
    counts: {
      overdue: buckets.overdue.length,
      due_soon: buckets.due_soon.length,
      ready: buckets.ready.length,
      assemble: buckets.assemble.length,
      stalled: buckets.stalled.length,
    },
    buckets,
    perAssignee,
  });
}
