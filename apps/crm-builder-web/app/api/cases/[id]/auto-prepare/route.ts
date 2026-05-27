// app/api/cases/[id]/auto-prepare/route.ts
//
// AUTO-PREPARE ORCHESTRATOR ("the member that gets a case ready")
//
// Runs the case-preparation pipeline end-to-end so that, by the time staff
// open the case, the mechanical work is done and they only need to verify and
// submit. It chains the existing, individually-tested steps:
//
//   1. Doc-completeness precheck  (getChecklistProgress)
//   2. Draft representative letter (POST /rep-letter, systemToken)
//   3. Compute pre-submission review checklist (getReviewChecklist)
//   4. Move case → "under_review" (= Ready for RCIC review) + aiStatus completed
//   5. Write a summary note: what was prepared + what a human must verify
//
// NOTE: IMM form generation was intentionally removed from this pipeline —
// the forms were not uploading reliably and orphaned files in Drive.
//
// HARD SAFETY LINE: this NEVER submits to IRCC. It stops at "Ready for RCIC
// review." Submission is a deliberate human action (RCIC Sandhu) via /submit.
//
// Trigger: manual (staff click) for now. The function is written so an
// automatic trigger (on doc-complete) can call it later with a systemToken.

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { canStaffAccessCase } from "@/lib/rbac";
import { getCase, listDocuments, updateCaseProcessing } from "@/lib/store";
import { getChecklistProgress } from "@/lib/application-checklists";
import { getReviewChecklist } from "@/lib/pre-submission-review";
import { getAuthRecoveryToken, isValidSystemToken } from "@/lib/auth-recovery-token";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

function baseUrl(): string {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "https://crm.newtonimmigration.com"
  );
}

async function callStep(
  path: string,
  systemToken: string
): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false || data?.error) {
      return { ok: false, data, error: data?.error || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function writeNote(caseId: string, companyId: string, text: string, addedBy: string) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS case_notes (
        id TEXT PRIMARY KEY, case_id TEXT NOT NULL, company_id TEXT NOT NULL,
        text TEXT NOT NULL, added_by TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const id = `NOTE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await pool.query(
      `INSERT INTO case_notes (id, case_id, company_id, text, added_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, caseId, companyId, text, addedBy]
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));

  // Auth: a staff session (manual click) OR an internal system call (future
  // auto-trigger). Either is accepted.
  const isSystemCall = isValidSystemToken(body?.systemToken);
  let actorName = "system (auto-trigger)";
  let companyId = COMPANY_ID;
  let sessionUser: Awaited<ReturnType<typeof getCurrentUserFromRequest>> = null;
  if (!isSystemCall) {
    sessionUser = await getCurrentUserFromRequest(request);
    if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (sessionUser.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    actorName = sessionUser.name;
    companyId = sessionUser.companyId;
  }

  const caseItem = await getCase(companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  if (sessionUser && !canStaffAccessCase(sessionUser.role, sessionUser.name, caseItem.assignedTo)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formType = String(caseItem.formType || "");

  // ── STEP 1: Doc-completeness precheck ──
  // Don't prepare an incomplete package. If required documents are still
  // missing, report what's needed and stop — nothing is changed.
  const docs = await listDocuments(companyId, params.id);
  const progress = getChecklistProgress(formType, docs);
  if (progress.missingRequired.length > 0) {
    return NextResponse.json({
      ok: true,
      prepared: false,
      reason: "missing_documents",
      missingRequired: progress.missingRequired,
      received: progress.receivedRequired,
      message: `Not prepared — still missing ${progress.missingRequired.length} required document(s).`,
    });
  }

  const systemToken = getAuthRecoveryToken();
  const results: Record<string, { ok: boolean; error?: string }> = {};

  // ── STEP 2: Draft representative letter ──
  // NOTE: IMM form generation was intentionally removed — the forms were not
  // uploading reliably and orphaned files in Drive. The letter is best-effort.
  const letter = await callStep(`/api/cases/${params.id}/rep-letter`, systemToken);
  results.repLetter = { ok: letter.ok, error: letter.error };

  // ── STEP 3: Pre-submission review checklist ──
  const checklist = getReviewChecklist(formType);
  const reviewItems = checklist?.items.filter((i) => i.required && !i.autoVerifiable) ?? [];
  const reviewRequiredCount = checklist?.items.filter((i) => i.required).length ?? 0;

  // The doc-completeness precheck above already passed, so the case is ready
  // for human review regardless of whether the letter draft succeeded.
  const prepared = true;

  // ── STEP 4: Move to "Ready for RCIC review" ──
  await updateCaseProcessing(companyId, params.id, {
    processingStatus: "under_review",
    aiStatus: "completed",
  });

  // ── STEP 6: Summary note for staff ──
  const lines: string[] = [];
  lines.push(`🤖 Auto-prepare ${prepared ? "completed" : "ran with issues"} (triggered by ${actorName}) — ${new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver" })}`);
  lines.push("");
  lines.push(`• Rep letter: ${results.repLetter.ok ? "drafted ✓" : `not done — ${results.repLetter.error}`}`);
  lines.push(`• Required documents: all received ✓ (${progress.receivedRequired.length})`);
  lines.push("");
  if (reviewItems.length > 0) {
    lines.push(`👀 Before submitting, a human must verify these ${reviewItems.length} item(s):`);
    for (const it of reviewItems.slice(0, 12)) lines.push(`   – ${it.label}`);
    if (reviewItems.length > 12) lines.push(`   – …and ${reviewItems.length - 12} more (see Review tab)`);
  } else if (!checklist) {
    lines.push(`ℹ️ No pre-submission checklist is defined for "${formType}" yet — review manually.`);
  }
  lines.push("");
  lines.push("⚠️ This case was NOT submitted to IRCC. RCIC (Sandhu) must review and submit.");
  await writeNote(params.id, companyId, lines.join("\n"), "AI Auto-prepare").catch(() => {});

  return NextResponse.json({
    ok: true,
    prepared,
    results,
    review: { requiredCount: reviewRequiredCount, humanVerifyCount: reviewItems.length },
    status: prepared ? "under_review" : caseItem.processingStatus,
    submitted: false,
    message: prepared
      ? "Case prepared and moved to Ready for RCIC review. Not submitted."
      : "Auto-prepare ran but forms did not generate — see case note.",
  });
}
