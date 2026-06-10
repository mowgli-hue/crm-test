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
import { inAgentScope } from "@/lib/case-agent";
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
  systemToken: string,
  extraBody?: Record<string, unknown>
): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemToken, ...(extraBody || {}) }),
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

// Humanize an intake key for the client-story summary ("programOrField" →
// "program or field", "q3" → "Answer 3").
function humanizeKey(k: string): string {
  return k
    .replace(/^q(\d+)$/i, "Answer $1")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

// Build a factual narrative seed from the case's intake answers so the rep
// letter endpoint produces a PERSONALISED draft (it falls back to the generic
// template unless it receives a clientStory of >= 20 chars). Returns "" when
// there's nothing usable, which preserves the old generic-template behaviour.
function buildClientStoryFromCase(caseItem: any): string {
  const intake = (caseItem?.pgwpIntake as Record<string, unknown>) || {};
  const SKIP = new Set([
    "whatsappsession", "whatsappintakephase", "whatsappintakecompletedat",
    "chatturns", "currentbatch",
  ]);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(intake)) {
    if (k.startsWith("_")) continue;                 // internal flags
    if (SKIP.has(k.toLowerCase())) continue;         // session metadata
    if (v == null) continue;
    const val = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    if (!val || val.length > 300) continue;          // skip empties / blobs
    parts.push(`${humanizeKey(k)}: ${val}`);
  }
  if (parts.length === 0) return "";
  const header =
    `${caseItem?.client || "The client"} is applying for ` +
    `${caseItem?.formType || "an immigration application"}. ` +
    `Details the client provided during intake:`;
  return [header, ...parts].join("\n").slice(0, 4000);
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
  const results: Record<string, { ok: boolean; error?: string; personalized?: boolean }> = {};

  // ── STEP 2: Draft representative letter (PERSONALISED) ──
  // Feed a factual narrative built from the case's intake answers so the letter
  // endpoint produces a tailored draft instead of the generic template. The
  // letter is best-effort — a failure here doesn't block the case from review.
  // (IMM form generation stays removed — it orphaned files in Drive.)
  const clientStory = buildClientStoryFromCase(caseItem);
  const letter = await callStep(
    `/api/cases/${params.id}/rep-letter`,
    systemToken,
    clientStory ? { clientStory } : undefined,
  );
  results.repLetter = { ok: letter.ok, error: letter.error, personalized: Boolean(clientStory) };

  // ── STEP 2.5: Fill the IRCC forms, THEN assemble the full submission package ──
  // For the agent's in-scope types (PGWP, Visitor Record, TRV), "preparing the
  // application" means producing the whole ordered package, not just the letter.
  // Order matters: fill the forms FIRST so the freshly-filled IMM5710/5257/5708
  // is registered as a document, THEN assemble the package so it lands in the
  // ordered Drive folder alongside passport/photo/transcript/completion/test +
  // the rep letter (or, for TRV, the merged Client Information PDF). Best-effort
  // and non-blocking — failures are noted, never thrown.
  const ftLower = formType.toLowerCase();
  const isAgentScoped = inAgentScope(formType);
  if (isAgentScoped) {
    // 1) Fill the IRCC forms from intake (full AI-parsed data).
    const forms = await callStep(`/api/cases/${params.id}/fill-forms`, systemToken);
    results.forms = { ok: forms.ok, error: forms.error };
    // 2) Assemble the complete ordered submission package into Drive.
    const pkg = await callStep(`/api/cases/${params.id}/submission-package`, systemToken);
    results.package = { ok: pkg.ok, error: pkg.error };
  }

  // ── STEP 3: Pre-submission review checklist ──
  const checklist = getReviewChecklist(formType);
  const humanVerifyItems = checklist?.items.filter((i) => i.required && !i.autoVerifiable) ?? [];
  const systemVerifiedItems = checklist?.items.filter((i) => i.required && i.autoVerifiable) ?? [];
  const reviewRequiredCount = checklist?.items.filter((i) => i.required).length ?? 0;

  // ── STEP 4: Financial / engagement readiness gate ──
  // A case is only "Ready for RCIC review" when the firm is actually engaged:
  // retainer signed AND fee handled. Mirrors ready-package.ts readiness. We do
  // the prep work regardless (so nothing is wasted), but we DON'T push an
  // unpaid/unsigned case into Sandhu's review queue.
  const retainerOk = Boolean(caseItem.retainerSigned);
  const paymentOk = caseItem.paymentStatus === "paid" || caseItem.paymentStatus === "not_required";
  const financialBlockers: string[] = [];
  if (!retainerOk) financialBlockers.push("Retainer not signed");
  if (!paymentOk) financialBlockers.push(`Payment outstanding (status: ${caseItem.paymentStatus || "pending"})`);
  const readyForReview = financialBlockers.length === 0;

  // ── STEP 5: Advance status only when truly ready ──
  if (readyForReview) {
    await updateCaseProcessing(companyId, params.id, {
      processingStatus: "under_review",
      aiStatus: "completed",
    });
  }

  // ── STEP 6: Summary note for staff ──
  const lines: string[] = [];
  lines.push(`🤖 Auto-prepare ${readyForReview ? "completed" : "ran (held — not yet ready)"} (triggered by ${actorName}) — ${new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver" })}`);
  lines.push("");
  lines.push(`• Rep letter: ${results.repLetter.ok ? `drafted ✓${clientStory ? " (personalised from intake)" : " (generic template — no intake detail)"}` : `not done — ${results.repLetter.error}`}`);
  if (results.forms) {
    lines.push(`• IRCC forms (filled from intake): ${results.forms.ok ? "done ✓ — verify & sign the drafts" : `not done — ${results.forms.error}`}`);
  }
  if (results.package) {
    lines.push(`• Submission package assembled in Drive: ${results.package.ok ? "done ✓ (forms + supporting docs, ordered)" : `not built — ${results.package.error}`}`);
  }
  lines.push(`• Required documents: all received ✓ (${progress.receivedRequired.length})`);
  if (systemVerifiedItems.length > 0) {
    lines.push(`• System-verified, no need to re-check: ${systemVerifiedItems.length} item(s) (${systemVerifiedItems.map((i) => i.label).slice(0, 4).join("; ")}${systemVerifiedItems.length > 4 ? "; …" : ""})`);
  }
  lines.push("");
  if (financialBlockers.length > 0) {
    lines.push(`⛔ Held back from RCIC review until resolved:`);
    for (const b of financialBlockers) lines.push(`   – ${b}`);
    lines.push("");
  }
  if (humanVerifyItems.length > 0) {
    lines.push(`👀 Before submitting, a human must verify these ${humanVerifyItems.length} item(s):`);
    for (const it of humanVerifyItems.slice(0, 12)) lines.push(`   – ${it.label}`);
    if (humanVerifyItems.length > 12) lines.push(`   – …and ${humanVerifyItems.length - 12} more (see Review tab)`);
  } else if (!checklist) {
    lines.push(`ℹ️ No pre-submission checklist is defined for "${formType}" yet — review manually.`);
  }
  lines.push("");
  lines.push("⚠️ This case was NOT submitted to IRCC. RCIC (Sandhu) must review and submit.");
  await writeNote(params.id, companyId, lines.join("\n"), "AI Auto-prepare").catch(() => {});

  return NextResponse.json({
    ok: true,
    prepared: readyForReview,
    blockers: financialBlockers,
    results,
    review: {
      requiredCount: reviewRequiredCount,
      humanVerifyCount: humanVerifyItems.length,
      systemVerifiedCount: systemVerifiedItems.length,
    },
    status: readyForReview ? "under_review" : caseItem.processingStatus,
    submitted: false,
    message: readyForReview
      ? "Case prepared and moved to Ready for RCIC review. Not submitted."
      : `Case prepared (letter + checklist) but held back from RCIC review: ${financialBlockers.join(", ")}.`,
  });
}
