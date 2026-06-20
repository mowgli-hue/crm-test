// ─────────────────────────────────────────────────────────────────────
// Per-application SLA clock — "this case must be SUBMITTED within N hours".
//
// Newton is scaling to hundreds of cases/day, so each application carries an
// hours-based clock from the moment it comes in. The clock is split into stage
// budgets (intake → docs → assemble → review → submit) so we can also say which
// stage a case SHOULD be in by now, not just the final deadline.
//
// These are DEFAULT same-business-day targets. They're config — tune per Newton
// policy without touching any logic. Multi-day application types (sponsorship,
// Express Entry PR, citizenship) get larger budgets.
//
// We key the budget on the same checklist family the rest of the app uses
// (resolveApplicationChecklistKey) so a new form type automatically inherits a
// sensible default.
// ─────────────────────────────────────────────────────────────────────

import { resolveApplicationChecklistKey } from "@/lib/application-checklists";
import type { ReadyKind } from "@/lib/case-priority";

export type SlaStage = "docs" | "assemble" | "review" | "submit";
export type SlaStatus = "on_track" | "due_soon" | "breached" | "done";

// Hours budgeted for each stage. `docs` folds intake + document collection
// together (that's how scoreCase reports it). Sum = hours from case creation to
// IRCC submission.
export interface StageBudget {
  docs: number;
  assemble: number;
  review: number;
  submit: number;
}

// ── Budgets are CONTINUOUS clock hours from case creation to submission ──
// IMPORTANT: this clock runs from case creation, and the bulk of that elapsed
// time is the client sending documents — NOT prep time. Measured reality at
// Newton is ~10–26 days (240–640h) creation→submission, so same-day (8h) budgets
// flagged ~every open case as "at-risk," making the signal useless.
//
// These are recalibrated to realistic calendar windows (×24h/day), weighted so
// most of the budget sits in the `docs` stage (the client-document wait). Result:
// "at-risk" now flags the genuinely-late files, not the whole pipeline.
//
// TUNE THESE from /api/admin/sla-calibration (configured vs. actual measured
// times) as more submission data accrues — they are config, not logic.
const DAY = 24;
// Default ~10 calendar days, docs-heavy.
const DEFAULT_BUDGET: StageBudget = { docs: 7 * DAY, assemble: 36, review: 24, submit: 12 }; // 240h

const BUDGET_BY_KEY: Partial<Record<string, StageBudget>> = {
  // Quick temporary-residence types — target ~7 days.
  visitor_record: { docs: 5 * DAY, assemble: 24, review: 16, submit: 8 },   // 168h
  trv_inside:     { docs: 5 * DAY, assemble: 24, review: 16, submit: 8 },   // 168h
  visitor_visa:   { docs: 5 * DAY, assemble: 24, review: 16, submit: 8 },   // 168h
  // Work/study permits — target ~10 days.
  pgwp:                   { docs: 7 * DAY, assemble: 36, review: 24, submit: 12 }, // 240h
  study_permit:           { docs: 7 * DAY, assemble: 36, review: 24, submit: 12 }, // 240h
  study_permit_extension: { docs: 7 * DAY, assemble: 36, review: 24, submit: 12 }, // 240h
  // Document-heavy work permits — target ~12 days.
  work_permit: { docs: 204, assemble: 42, review: 28, submit: 14 }, // 288h
  sowp:        { docs: 204, assemble: 42, review: 28, submit: 14 }, // 288h
  vowp:        { docs: 204, assemble: 42, review: 28, submit: 14 }, // 288h
  // Heavier — target ~14 days.
  super_visa: { docs: 240, assemble: 48, review: 32, submit: 16 }, // 336h
  // PR card renewal — target ~21 days.
  pr_card_renewal: { docs: 360, assemble: 72, review: 48, submit: 24 }, // 504h
  // Citizenship — target ~30 days.
  citizenship: { docs: 504, assemble: 108, review: 72, submit: 36 }, // 720h
  // PR-track (sponsorship, Express Entry) — inherently multi-week, target ~45 days.
  family_sponsorship: { docs: 760, assemble: 160, review: 100, submit: 60 }, // 1080h
  express_entry:      { docs: 760, assemble: 160, review: 100, submit: 60 }, // 1080h
  express_entry_pr:   { docs: 760, assemble: 160, review: 100, submit: 60 }, // 1080h
};

const HOUR_MS = 3_600_000;

export interface Sla {
  key: string;              // checklist family key
  stage: SlaStage;          // the stage the case is in now
  totalBudgetHours: number; // creation → submission budget
  submitDueISO: string;     // when it should be submitted by
  stageDueISO: string;      // when the CURRENT stage should be done by
  remainingMs: number;      // ms to the submit deadline (negative = overdue)
  remainingHours: number;   // remainingMs in hours (rounded to 0.1)
  status: SlaStatus;        // on_track | due_soon | breached | done
  label: string;            // e.g. "3h 10m left" / "2h 5m overdue" / "Submitted"
}

function budgetFor(formType: string): { key: string; budget: StageBudget } {
  const key = resolveApplicationChecklistKey(formType);
  return { key, budget: BUDGET_BY_KEY[key] || DEFAULT_BUDGET };
}

// Total creation→submission budget (hours) for a checklist family key. Used by
// the SLA-calibration report to compare the configured target against measured
// times.
export function totalBudgetForKey(key: string): number {
  const b = BUDGET_BY_KEY[key] || DEFAULT_BUDGET;
  return b.docs + b.assemble + b.review + b.submit;
}

// scoreCase.ready → the SLA stage. "docs"/"progress" are still the collection
// stage; "review" covers both in-review and changes-needed.
function stageFromReady(ready: ReadyKind): SlaStage {
  switch (ready) {
    case "assemble": return "assemble";
    case "review": return "review";
    case "submit": return "submit";
    case "docs":
    case "progress":
    default: return "docs";
  }
}

function fmt(ms: number): string {
  const over = ms < 0;
  const total = Math.round(Math.abs(ms) / 60000); // minutes
  const h = Math.floor(total / 60);
  const m = total % 60;
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return over ? `${span} overdue` : `${span} left`;
}

/**
 * Compute the SLA clock for a case.
 *
 * @param formType         the case's application type
 * @param createdAt        ISO string of when the case came in
 * @param ready            scoreCase.ready (stage signal)
 * @param processingStatus optional — "submitted"/"closed" stops the clock
 * @param now              injectable clock for tests
 */
export function computeSla(
  formType: string,
  createdAt: string | undefined,
  ready: ReadyKind,
  processingStatus?: string,
  now: number = Date.now(),
): Sla {
  const { key, budget } = budgetFor(formType || "");
  const createdMs = Date.parse(createdAt || "") || now;

  // Cumulative deadlines (hours from creation).
  const cDocs = budget.docs;
  const cAssemble = cDocs + budget.assemble;
  const cReview = cAssemble + budget.review;
  const cSubmit = cReview + budget.submit; // = total budget

  const stage = stageFromReady(ready);
  const stageCumHours =
    stage === "docs" ? cDocs :
    stage === "assemble" ? cAssemble :
    stage === "review" ? cReview : cSubmit;

  const submitDueMs = createdMs + cSubmit * HOUR_MS;
  const stageDueMs = createdMs + stageCumHours * HOUR_MS;
  const remainingMs = submitDueMs - now;

  const st = String(processingStatus || "").toLowerCase();
  const isDone = st === "submitted" || st === "closed";

  let status: SlaStatus;
  if (isDone) status = "done";
  else if (remainingMs < 0) status = "breached";
  // due_soon: under 25% of the total budget remaining, or under 1h.
  else if (remainingMs <= Math.max(HOUR_MS, cSubmit * HOUR_MS * 0.25)) status = "due_soon";
  else status = "on_track";

  return {
    key,
    stage,
    totalBudgetHours: cSubmit,
    submitDueISO: new Date(submitDueMs).toISOString(),
    stageDueISO: new Date(stageDueMs).toISOString(),
    remainingMs,
    remainingHours: Math.round((remainingMs / HOUR_MS) * 10) / 10,
    status,
    label: isDone ? "Submitted" : fmt(remainingMs),
  };
}
