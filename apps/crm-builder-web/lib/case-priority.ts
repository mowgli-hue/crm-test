// ─────────────────────────────────────────────────────────────────────
// Shared case-priority scoring — the single source of truth for "what's most
// urgent." Used by the personal My Day view and the manager's firm-wide at-risk
// view so both rank cases identically (deadlines + document readiness + status).
// ─────────────────────────────────────────────────────────────────────

import type { CaseItem, DocumentItem } from "@/lib/models";
import { getCaseReadiness } from "@/lib/case-readiness";

const DAY = 86_400_000;

export type ReadyKind = "submit" | "assemble" | "docs" | "review" | "progress";

export type Scored = {
  score: number;
  reason: string;
  ready: ReadyKind;
  deadlineDays: number | null;
  completionPct: number;   // 0-100, how far along the application is
  daysInSystem: number;    // how long since the case came in
};

// Cases that are finished / not part of the working pipeline.
export function isClosed(c: any): boolean {
  const ft = String(c.formType || "").toLowerCase();
  const st = String(c.processingStatus || "").toLowerCase();
  return st === "submitted" || st === "closed" || ft.includes("not for processing") || ft.includes("consultation");
}

export function ageDays(c: any): number {
  const t = Date.parse(c.updatedAt || c.createdAt || "") || Date.now();
  return Math.max(0, (Date.now() - t) / DAY);
}

// How long the case has been in the system (since it came in). This is the
// "how long it's been sitting here" signal — older = more important.
export function daysInSystem(c: any): number {
  const t = Date.parse(c.createdAt || c.updatedAt || "") || Date.now();
  return Math.max(0, (Date.now() - t) / DAY);
}

// How complete the application is, 0-100, from the three readiness stages.
function completionFromReadiness(r: { intake: { complete: boolean }; clientDocs: { complete: boolean }; forms: { complete: boolean }; submissionReady: boolean }): number {
  if (r.submissionReady) return 100;
  // intake 30% · client docs 45% · forms 25% (docs are the bulk of the work)
  return Math.round((r.intake.complete ? 30 : 0) + (r.clientDocs.complete ? 45 : 0) + (r.forms.complete ? 25 : 0));
}

// Days until a date (negative = already passed). null if unknown.
export function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / DAY);
}

// The most urgent real deadline we know about: an explicit dueInDays, or the
// client's current-status/permit expiry (from the case or intake).
export function deadlineDays(c: any): number | null {
  const intake = c.pgwpIntake || {};
  const candidates: Array<number | null> = [
    Number.isFinite(Number(c.dueInDays)) ? Number(c.dueInDays) : null,
    daysUntil(c.permitExpiryDate),
    daysUntil(intake.studyPermitExpiryDate),
    daysUntil(intake.workPermitExpiryDate),
  ];
  const known = candidates.filter((x): x is number => x !== null);
  return known.length ? Math.min(...known) : null;
}

function deadlineBoost(d: number | null): number {
  if (d === null) return 0;
  if (d < 0) return 460;     // expired — restoration / overdue, most urgent
  if (d <= 3) return 400;
  if (d <= 7) return 300;
  if (d <= 14) return 180;
  if (d <= 30) return 90;
  return 0;
}

// Priority from real signals: status, deadlines, how long it's been in the
// system, and how complete the application is.
export function scoreCase(c: CaseItem | any, docs: DocumentItem[]): Scored {
  const st = String((c as any).processingStatus || "").toLowerCase();
  const review = String((c as any).reviewStatus || "").toLowerCase();
  const here = daysInSystem(c);
  const d = deadlineDays(c);
  const dBoost = deadlineBoost(d);
  const r = getCaseReadiness(c, docs);
  const completionPct = completionFromReadiness(r);

  const dueNote =
    d === null ? "" :
    d < 0 ? ` · status expired ${Math.abs(d)}d ago — restoration window` :
    d <= 30 ? ` · due in ${d}d` : "";

  let base: number, reason: string, ready: ReadyKind;
  if (review === "changes_needed") {
    base = 1000; ready = "review"; reason = "Reviewer sent changes back — fix and resubmit";
  } else if (st === "under_review") {
    base = 820; ready = "review"; reason = "In review";
  } else if (r.submissionReady || st === "ready" || st === "ready_to_submit") {
    base = 760; ready = "submit"; reason = "Ready to submit";
  } else if (r.intake.complete && r.clientDocs.complete && !r.forms.complete) {
    base = 640; ready = "assemble"; reason = "Docs complete — assemble forms";
  } else if (!r.clientDocs.complete || !r.intake.complete) {
    const miss = [...r.clientDocs.missing, ...r.intake.missing].slice(0, 3).join(", ");
    base = 380; ready = "docs"; reason = miss ? `Waiting on: ${miss}` : "Waiting on documents";
  } else {
    base = 300; ready = "progress"; reason = "In progress";
  }

  // Importance modifiers (within the status band):
  //  - the longer it's been sitting here, the more it matters (cap so it can't
  //    overtake a higher band)
  //  - the more complete it is, the closer to the finish line — nudge it up so
  //    near-done files get pushed over
  const ageBoost = Math.min(here * 6, 200);
  const completionBoost = completionPct * 1.2;
  const hereNote = here >= 3 ? ` · ${Math.round(here)}d in queue` : "";

  return {
    score: base + dBoost + ageBoost + completionBoost,
    reason: reason + dueNote + (ready === "docs" || ready === "progress" ? hereNote : ""),
    ready,
    deadlineDays: d,
    completionPct,
    daysInSystem: Math.round(here),
  };
}

// ── Reviewer priority ──────────────────────────────────────────────────
// For the review queue, a case is already prepped and waiting for a reviewer.
// Newton's reviewer factors: (1) whose permit is expiring soonest, (2) which
// client paid the most, (3) which has been waiting longest to be submitted.
export type ScoredReview = {
  score: number;
  reason: string;
  deadlineDays: number | null;
  amountPaid: number;
  daysInSystem: number;
};

function paymentBoost(amount: number): number {
  if (amount >= 1000) return 200;
  if (amount >= 500) return 120;
  if (amount >= 200) return 60;
  if (amount > 0) return 25;
  return 0;
}

// Reviewer priority weights EXPIRY first (per office). This deadline weighting is
// deliberately stronger than payment (max 200) + age (max 200) so a soon-expiring
// permit always outranks a high-payer. Among expired (restoration) cases, the more
// overdue ranks higher (closer to the 90-day restoration deadline).
function reviewDeadlineBoost(d: number | null): number {
  if (d === null) return 0;
  if (d < 0) return 1000 + Math.min(Math.abs(d), 60); // expired: graduated
  if (d <= 3) return 800;
  if (d <= 7) return 600;
  if (d <= 14) return 400;
  if (d <= 30) return 250;
  if (d <= 60) return 120;
  return 0;
}

export function scoreReview(c: CaseItem | any): ScoredReview {
  const here = daysInSystem(c);
  const d = deadlineDays(c);
  const amount = Number((c as any).amountPaid) || 0;

  const score = 500 + reviewDeadlineBoost(d) + paymentBoost(amount) + Math.min(here * 5, 200);

  const parts: string[] = [];
  if (d !== null) parts.push(d < 0 ? `status expired ${Math.abs(d)}d ago` : `permit/due in ${d}d`);
  if (amount > 0) parts.push(`$${amount.toLocaleString()} paid`);
  parts.push(`${Math.round(here)}d waiting`);

  return { score, reason: parts.join(" · "), deadlineDays: d, amountPaid: amount, daysInSystem: Math.round(here) };
}

// Which risk bucket a scored case falls into, for grouped manager views.
export type RiskBucket = "overdue" | "due_soon" | "ready" | "assemble" | "stalled" | "in_progress";
export function riskBucket(s: Scored): RiskBucket {
  if (s.deadlineDays !== null && s.deadlineDays < 0) return "overdue";
  if (s.deadlineDays !== null && s.deadlineDays <= 7) return "due_soon";
  if (s.ready === "submit" || s.ready === "review") return "ready";
  if (s.ready === "assemble") return "assemble";
  if (s.ready === "docs" && s.daysInSystem >= 5) return "stalled";
  return "in_progress";
}
