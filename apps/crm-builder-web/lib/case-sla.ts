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

// Same-day default: ~8 working hours start-to-submit.
const DEFAULT_BUDGET: StageBudget = { docs: 4, assemble: 2, review: 1, submit: 1 };

// Per-family overrides. Temporary-residence work/study/visitor = same day.
// PR-track applications (sponsorship, EE PR, citizenship) are inherently
// multi-day, so their budgets are in working-hours-across-days.
const BUDGET_BY_KEY: Partial<Record<string, StageBudget>> = {
  pgwp: { docs: 4, assemble: 2, review: 1, submit: 1 },
  work_permit: { docs: 4, assemble: 2, review: 1, submit: 1 },
  sowp: { docs: 5, assemble: 2, review: 1, submit: 1 },
  vowp: { docs: 4, assemble: 2, review: 1, submit: 1 },
  trv_inside: { docs: 3, assemble: 1, review: 1, submit: 1 },
  visitor_visa: { docs: 3, assemble: 1, review: 1, submit: 1 },
  visitor_record: { docs: 3, assemble: 1, review: 1, submit: 1 },
  study_permit: { docs: 4, assemble: 2, review: 1, submit: 1 },
  study_permit_extension: { docs: 4, assemble: 2, review: 1, submit: 1 },
  super_visa: { docs: 6, assemble: 2, review: 1, submit: 1 },
  pr_card_renewal: { docs: 8, assemble: 4, review: 2, submit: 1 },
  citizenship: { docs: 16, assemble: 8, review: 4, submit: 2 },
  family_sponsorship: { docs: 40, assemble: 16, review: 8, submit: 4 },
  express_entry: { docs: 40, assemble: 16, review: 8, submit: 4 },
  express_entry_pr: { docs: 40, assemble: 16, review: 8, submit: 4 },
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
