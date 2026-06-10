// lib/case-agent.ts
//
// The "Case Agent" brain. For each case it figures out — the way an experienced
// team lead would — what stage the file is at and the single most useful NEXT
// ACTION, whether that action is safe to do automatically, and how urgent it is.
//
// It is pure/read-only: it computes an assessment. Acting on it (auto-prepare,
// chasing docs, flagging review) is done by the caller so side-effects stay
// explicit and gated. This is the spine the whole agent loop is built on.

import type { CaseItem, DocumentItem } from "@/lib/models";
import { getChecklistProgress } from "@/lib/application-checklists";
import { formStatus } from "@/lib/application-forms";
import { MAPPABLE_FORMS } from "@/lib/form-fill";

// ── Agent scope ──────────────────────────────────────────────────────────
// The agent only ACTS on the case types it's trained on. Everything else still
// shows in the worklist (for visibility) but is marked manual — the agent won't
// auto-assemble or auto-fill it. Start narrow (PGWP, Visitor Record, TRV) and
// widen via AGENT_SCOPE_FORMTYPES (comma-separated substrings) as we validate
// each type, without a code change.
const AGENT_SCOPE_DEFAULT = ["pgwp", "post-graduation", "post graduation", "visitor record", "trv"];
export function inAgentScope(formType: string): boolean {
  const ft = String(formType || "").toLowerCase();
  const env = String(process.env.AGENT_SCOPE_FORMTYPES || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const matchers = env.length ? env : AGENT_SCOPE_DEFAULT;
  return matchers.some((m) => ft.includes(m));
}

export type CaseStage =
  | "submitted"          // already at IRCC — monitor only
  | "in_review"          // with RCIC for review
  | "changes_needed"     // reviewer sent changes back to the preparer
  | "ready_to_prepare"   // all docs in, not yet assembled → AGENT CAN ACT
  | "prepared"           // assembled, waiting to enter review / submit
  | "awaiting_docs"      // still missing required documents from the client
  | "needs_owner"        // no preparer assigned
  | "unknown";

export type CaseAssessment = {
  caseId: string;
  client: string;
  formType: string;
  assignedTo: string;
  stage: CaseStage;
  stageLabel: string;
  nextAction: string;
  autoDoable: boolean;        // can the agent safely do this with no human?
  autoActionKey?: "auto_prepare" | "request_docs" | "fill_forms";
  priority: number;           // higher = more urgent
  reasons: string[];
  missingDocs: string[];
  permitDaysLeft?: number;
  inScope: boolean;           // is this a type the agent is trained to act on?
  // IRCC form completion — the hook for the XFA form-filling capability.
  formsRequired: string[];    // e.g. ["IMM5710","IMM5476"]
  formsPresent: string[];     // forms already produced for this file
  formsMissing: string[];     // forms still to fill (XFA, etc.)
};

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (iso?: string) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? (Date.now() - t) / DAY : Infinity;
};
const daysUntil = (iso?: string) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? (t - Date.now()) / DAY : Infinity;
};

export function assessCase(c: CaseItem, docs: DocumentItem[]): CaseAssessment {
  const a: CaseAssessment = {
    caseId: c.id,
    client: String((c as any).client || ""),
    formType: String((c as any).formType || ""),
    assignedTo: String((c as any).assignedTo || "Unassigned"),
    stage: "unknown",
    stageLabel: "",
    nextAction: "",
    autoDoable: false,
    priority: 0,
    reasons: [],
    missingDocs: [],
    inScope: inAgentScope(String((c as any).formType || "")),
    formsRequired: [],
    formsPresent: [],
    formsMissing: [],
  };

  // IRCC form completion status (which forms produced vs. still to fill).
  const fs = formStatus(a.formType, docs.map((d) => String((d as any).name || "")));
  a.formsRequired = fs.required.map((f) => f.id);
  a.formsPresent = fs.present;
  a.formsMissing = fs.missing.map((f) => f.id);

  const ps = String((c as any).processingStatus || "docs_pending");
  const reviewStatus = String((c as any).reviewStatus || "");
  const assigned = a.assignedTo && a.assignedTo !== "Unassigned";
  const permitDaysLeft = daysUntil((c as any).permitExpiryDate);
  if (Number.isFinite(permitDaysLeft)) a.permitDaysLeft = Math.ceil(permitDaysLeft);

  // ── Already submitted → just monitor ──
  if (ps === "submitted") {
    a.stage = "submitted"; a.stageLabel = "Submitted to IRCC";
    a.nextAction = "Monitor for the IRCC decision; nothing to do now.";
    a.priority = -100;
    return a;
  }

  const progress = getChecklistProgress(a.formType, docs);
  a.missingDocs = progress.missingRequired;

  // ── Reviewer sent changes back ──
  if (reviewStatus === "changes_needed") {
    a.stage = "changes_needed"; a.stageLabel = "Changes needed";
    a.nextAction = `${a.assignedTo} to address the reviewer's changes, then re-submit for review.`;
    a.reasons.push("Reviewer flagged changes on this file.");
    a.priority += 40;
  }
  // ── With RCIC for review ──
  else if (ps === "under_review") {
    a.stage = "in_review"; a.stageLabel = "In RCIC review";
    const d = daysAgo((c as any).reviewStartedAt);
    a.nextAction = "Awaiting RCIC review.";
    if (d > 3) { a.reasons.push(`In review ${Math.floor(d)} days.`); a.priority += 15; }
  }
  // ── Still waiting on the client's documents ──
  else if (progress.missingRequired.length > 0) {
    a.stage = "awaiting_docs"; a.stageLabel = "Awaiting documents";
    a.nextAction = `Request ${progress.missingRequired.length} missing document(s) from the client: ${progress.missingRequired.slice(0, 5).join(", ")}${progress.missingRequired.length > 5 ? "…" : ""}.`;
    a.autoDoable = true; a.autoActionKey = "request_docs";
    const waiting = daysAgo((c as any).createdAt);
    a.reasons.push(`${progress.receivedRequired.length}/${progress.required.length} required docs in.`);
    if (waiting > 7) { a.reasons.push(`Waiting ${Math.floor(waiting)} days.`); a.priority += 20; }
    a.priority += 10;
  }
  // ── All docs in but not assembled → AGENT CAN ASSEMBLE THE FILE ──
  else if (String((c as any).aiStatus || "") !== "completed") {
    a.stage = "ready_to_prepare"; a.stageLabel = "Ready to prepare";
    a.nextAction = "All required documents are in — run auto-prepare to assemble the file (letter + package) and move it to review.";
    a.autoDoable = true; a.autoActionKey = "auto_prepare";
    a.reasons.push("All required docs received.");
    if (a.formsMissing.length) a.reasons.push(`IRCC forms still to fill: ${a.formsMissing.join(", ")}.`);
    a.priority += 25;
  }
  // ── Assembled. If the IRCC forms still aren't filled, that's the next gap ──
  else if (a.formsMissing.length > 0) {
    a.stage = "prepared"; a.stageLabel = "Forms outstanding";
    const mappable = a.formsMissing.filter((id) => MAPPABLE_FORMS.has(id.toLowerCase()));
    a.autoActionKey = "fill_forms";
    // Auto-doable when at least one missing form has a built mapper — the agent
    // produces a DRAFT (no submission) for staff to verify. Forms without a
    // mapper yet are flagged for manual completion.
    a.autoDoable = mappable.length > 0;
    a.nextAction = mappable.length
      ? `Auto-fill the IRCC form draft(s): ${mappable.join(", ")} — then staff verify & sign.${a.formsMissing.length > mappable.length ? ` (Fill manually: ${a.formsMissing.filter((id) => !MAPPABLE_FORMS.has(id.toLowerCase())).join(", ")}.)` : ""}`
      : `File assembled — fill the IRCC form(s) manually: ${a.formsMissing.join(", ")}.`;
    a.reasons.push(`Forms to fill: ${a.formsMissing.join(", ")}.`);
    a.priority += 18;
  }
  // ── Assembled and forms done, sitting before review/submit ──
  else {
    a.stage = "prepared"; a.stageLabel = "Prepared — ready for review";
    a.nextAction = "File is assembled and forms are in. Move to RCIC review / submit when ready.";
    a.reasons.push("Assembled, forms done.");
    a.priority += 10;
  }

  // ── Cross-cutting flags ──
  if (!assigned) {
    a.priority += 30;
    if (a.stage === "awaiting_docs") {
      // Don't message a client about a file nobody owns — assign first.
      a.stage = "needs_owner"; a.stageLabel = "Needs an owner";
      a.nextAction = "Assign a preparer, then request the missing documents.";
      a.autoDoable = false;
    } else {
      // ready_to_prepare / forms outstanding / prepared: the agent CAN do the
      // mechanical prep now, before assignment — the file is ready the moment a
      // preparer picks it up. We just flag that it still needs an owner so it
      // gets assigned for review afterwards. (autoDoable stays on.)
      a.reasons.push("No preparer assigned yet — agent can prepare now; assign for review.");
      a.stageLabel = `${a.stageLabel} · needs owner`;
    }
  }
  if (Number.isFinite(permitDaysLeft) && permitDaysLeft >= 0 && permitDaysLeft <= 30) {
    a.reasons.push(`Permit expires in ${Math.ceil(permitDaysLeft)} day(s).`);
    a.priority += permitDaysLeft <= 14 ? 100 : 50;
  }

  // ── Scope gate ──
  // The agent only auto-acts on the case types it's trained on. Out-of-scope
  // files still show their stage (visibility) but the agent won't touch them —
  // staff handle those manually until we widen the scope.
  if (!a.inScope) {
    a.autoDoable = false;
    a.autoActionKey = undefined;
    a.reasons.push("Outside the agent's current scope — handle manually.");
    a.priority = Math.max(0, a.priority - 40); // de-prioritise vs in-scope work
  }

  return a;
}

export function assessAll(
  cases: CaseItem[],
  docsByCase: Map<string, DocumentItem[]>
): CaseAssessment[] {
  const active = cases.filter((c) => {
    const st = String((c as any).caseStatus || "");
    return st !== "archived" && st !== "closed";
  });
  return active
    .map((c) => assessCase(c, docsByCase.get(c.id) || []))
    .sort((x, y) => y.priority - x.priority);
}
