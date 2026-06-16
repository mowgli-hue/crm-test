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

// Priority from real signals: rework/review, document-readiness, and deadlines.
export function scoreCase(c: CaseItem | any, docs: DocumentItem[]): Scored {
  const st = String((c as any).processingStatus || "").toLowerCase();
  const review = String((c as any).reviewStatus || "").toLowerCase();
  const age = ageDays(c);
  const d = deadlineDays(c);
  const dBoost = deadlineBoost(d);
  const r = getCaseReadiness(c, docs);

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
    base = 380 + age; ready = "docs"; reason = miss ? `Waiting on: ${miss}` : `Waiting on documents — ${Math.round(age)}d old`;
  } else {
    base = 300 + age; ready = "progress"; reason = `In progress — ${Math.round(age)}d since last update`;
  }

  return { score: base + dBoost + age * 0.1, reason: reason + dueNote, ready, deadlineDays: d };
}

// Which risk bucket a scored case falls into, for grouped manager views.
export type RiskBucket = "overdue" | "due_soon" | "ready" | "assemble" | "stalled" | "in_progress";
export function riskBucket(s: Scored, ageDaysVal: number): RiskBucket {
  if (s.deadlineDays !== null && s.deadlineDays < 0) return "overdue";
  if (s.deadlineDays !== null && s.deadlineDays <= 7) return "due_soon";
  if (s.ready === "submit" || s.ready === "review") return "ready";
  if (s.ready === "assemble") return "assemble";
  if (s.ready === "docs" && ageDaysVal >= 5) return "stalled";
  return "in_progress";
}
