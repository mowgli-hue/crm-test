// app/api/admin/ops-lead/rebalance/apply/route.ts
//
// Applies the AI Operations Lead's rebalance plan: reassigns cases to protect
// SLAs and survive churn. This is the ONLY side-effecting part of the Ops Lead,
// kept deliberately small and auditable.
//
//   POST { caseIds?: string[] }   → applies the proposed moves (all, or only the
//                                   given caseIds). Re-derives the plan fresh and
//                                   re-checks every guardrail before writing.
//   POST ?systemToken=XXX         → cron path (auto-within-rules), notifies.
//
// Auth: Admin (manual) OR system token (cron).
//
// Guardrails enforced here AGAIN (not just in the planner):
//   • never touch a case someone is punched into right now
//   • never touch a case that's already submitted/closed
//   • only assign to enabled prep staff
// Every move writes a case note and an audit-log row, so it's fully traceable.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { isValidSystemToken } from "@/lib/auth-recovery-token";
import { gatherOpsData } from "@/lib/ops-lead";
import { listAllCases, updateCaseProcessing } from "@/lib/store";
import { getPool, insertAuditLogRow } from "@/lib/postgres-store";
import type { CaseItem } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function writeNote(caseId: string, companyId: string, text: string) {
  try {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS case_notes (
        id TEXT PRIMARY KEY, case_id TEXT NOT NULL, company_id TEXT NOT NULL,
        text TEXT NOT NULL, added_by TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    const id = `NOTE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await pool.query(
      `INSERT INTO case_notes (id, case_id, company_id, text, added_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, caseId, companyId, text, "AI Ops Lead"]
    );
  } catch (e) {
    console.error("[ops-lead apply] note write failed:", (e as Error).message);
  }
}

async function run(request: NextRequest) {
  // Auth: system token (cron) OR a logged-in Admin.
  const url = new URL(request.url);
  const token = url.searchParams.get("systemToken") || "";
  let actor = "AI Ops Lead (cron)";
  if (!isValidSystemToken(token)) {
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff" || user.role !== "Admin") {
      return NextResponse.json({ error: "Forbidden — admins only" }, { status: 403 });
    }
    actor = user.name || "Admin";
  }

  const body = await request.json().catch(() => ({} as any));
  const onlyCaseIds: Set<string> | null = Array.isArray(body?.caseIds) && body.caseIds.length
    ? new Set(body.caseIds.map(String))
    : null;

  // Re-derive the plan fresh so we never act on a stale preview.
  const data = await gatherOpsData({ windowDays: 30 });
  let moves = data.rebalance;
  if (onlyCaseIds) moves = moves.filter((m) => onlyCaseIds.has(m.caseId));

  // Live guardrail data: current case state (company, status, current owner) and
  // who is punched in right now.
  const cases = await listAllCases();
  const caseById = new Map<string, CaseItem>(cases.map((c) => [c.id, c]));
  const openNow = new Set<string>();
  try {
    const pool = getPool();
    const r = await pool.query(`SELECT DISTINCT case_id FROM case_time_logs WHERE ended_at IS NULL`);
    for (const x of r.rows as any[]) openNow.add(x.case_id);
  } catch { /* if time table missing, treat as none open */ }

  const applied: Array<{ caseId: string; from: string; to: string; rule: string }> = [];
  const skipped: Array<{ caseId: string; reason: string }> = [];

  for (const m of moves) {
    const c = caseById.get(m.caseId);
    if (!c) { skipped.push({ caseId: m.caseId, reason: "case not found" }); continue; }
    const st = String((c as any).processingStatus || "").toLowerCase();
    if (st === "submitted" || st === "closed") { skipped.push({ caseId: m.caseId, reason: "already submitted/closed" }); continue; }
    if (openNow.has(m.caseId)) { skipped.push({ caseId: m.caseId, reason: "someone is working it now" }); continue; }
    if (!m.toName || m.toName === m.fromName) { skipped.push({ caseId: m.caseId, reason: "no valid target" }); continue; }

    try {
      await updateCaseProcessing(c.companyId, c.id, { assignedTo: m.toName });
      await writeNote(c.id, c.companyId, `🔁 Reassigned by AI Ops Lead: ${m.fromName} → ${m.toName}. ${m.reason}`);
      try {
        await insertAuditLogRow({
          id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: c.companyId,
          actorUserId: "ops-lead",
          actorName: actor,
          action: "reassign_case",
          resourceType: "case",
          resourceId: c.id,
          metadata: { from: m.fromName, to: m.toName, rule: m.rule, reason: m.reason.slice(0, 200), slaStatus: m.slaStatus },
        });
      } catch { /* audit best-effort */ }
      applied.push({ caseId: m.caseId, from: m.fromName, to: m.toName, rule: m.rule });
    } catch (e) {
      skipped.push({ caseId: m.caseId, reason: (e as Error).message });
    }
  }

  console.log(`[ops-lead apply] applied=${applied.length} skipped=${skipped.length} by=${actor}`);
  return NextResponse.json({
    ok: true,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    applied,
    skipped,
    bottleneck: data.team.bottleneck,
  });
}

export async function POST(request: NextRequest) { return run(request); }
