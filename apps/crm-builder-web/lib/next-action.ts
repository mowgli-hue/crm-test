// ─────────────────────────────────────────────────────────────────────
// Next-action / owner engine — "what is the ONE next step on this case, who
// owns it, and how is it done."
//
// The CRM should never leave a team member wondering what to do. Given a case's
// readiness (scoreCase.ready) and its review status, this returns the single
// next action, the role responsible, and a one-line "how" (the SOP summary —
// full step-by-step SOPs land in Phase 2).
//
// Keeping this in one place means My Day, the case page, and the manager floor
// view all describe the next step identically.
// ─────────────────────────────────────────────────────────────────────

import type { ReadyKind } from "@/lib/case-priority";

export type NextActionKey = "collect" | "assemble" | "review" | "fix" | "submit" | "progress";

export interface NextAction {
  key: NextActionKey;
  step: string;   // what to do, in plain words
  owner: string;  // the role responsible for this step
  how: string;    // one-line SOP summary (Phase 2 expands to full checklists)
}

/**
 * The single next action for a case.
 *
 * @param ready        scoreCase.ready — the readiness stage
 * @param reviewStatus the case's reviewStatus ("changes_needed" wins)
 */
export function nextActionFor(ready: ReadyKind, reviewStatus?: string): NextAction {
  const rev = String(reviewStatus || "").toLowerCase();

  // Reviewer sent it back — that's a processing fix, regardless of ready kind.
  if (rev === "changes_needed") {
    return {
      key: "fix",
      step: "Fix the changes the reviewer sent back",
      owner: "Processing",
      how: "Open the reviewer's notes, correct each flagged item, then re-submit for review.",
    };
  }

  switch (ready) {
    case "submit":
      return {
        key: "submit",
        step: "Submit to IRCC",
        owner: "Processing / Lead",
        how: "Open the assembled package, upload each file to the IRCC portal, pay the fee, save the confirmation number to the case.",
      };
    case "review":
      return {
        key: "review",
        step: "Review the assembled package",
        owner: "Reviewer",
        how: "Check forms against documents, verify eligibility, names and dates, then approve or send changes back.",
      };
    case "assemble":
      return {
        key: "assemble",
        step: "Fill & assemble the forms",
        owner: "Processing",
        how: "Fill the IMM form from intake, generate IMM5476 + submission letter, then run Assemble to build the submission folder.",
      };
    case "docs":
      return {
        key: "collect",
        step: "Collect the missing documents & intake answers",
        owner: "Communicator",
        how: "Message the client for the outstanding items, then confirm each upload lands in the case folder.",
      };
    case "progress":
    default:
      return {
        key: "progress",
        step: "Move the case forward",
        owner: "Processing",
        how: "Open the case, check what's outstanding, and action the next item.",
      };
  }
}
