// ─────────────────────────────────────────────────────────────────────
// Reviewer routing — which application types each reviewer is responsible for.
// Edit this as the team changes. Matching is by first name (case-insensitive),
// so "Serbleen" matches the account "Serbleen Kaur".
//
// Listed reviewers (Serbleen, Parinita) review ONLY their block. The lead
// (ProcessingLead) reviews the OVERFLOW — the types nobody is blocked on
// (LMIA, SOWP, VOWP, sponsorship, …) — so simple types aren't double-handled.
// Admins are NOT in the review rotation (they have the firm at-risk view).
// ─────────────────────────────────────────────────────────────────────

import type { Role } from "@/lib/models";

// firstName(lowercased) -> list of formType keywords they review
export const REVIEWER_BLOCKS: Record<string, string[]> = {
  serbleen: ["pgwp", "post-graduation", "post graduation", "study permit"],
  parinita: ["trv", "visitor record", "visitor visa"],
  // Ramandeep is ProcessingLead → reviews the overflow (no entry needed).
};

// Every form-type keyword claimed by some blocked reviewer.
const CLAIMED = Object.values(REVIEWER_BLOCKS).flat();

function firstName(name: string): string {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim().split(" ")[0];
}

function normalizeRole(role: Role | string): string {
  return String(role || "").trim().toLowerCase().replace(/\s+/g, "");
}

function typeIsClaimed(formType: string): boolean {
  const ft = String(formType || "").toLowerCase();
  return CLAIMED.some((kw) => ft.includes(kw));
}

// Should this reviewer review this application type?
export function reviewerHandles(userName: string, role: Role, formType: string): boolean {
  const block = REVIEWER_BLOCKS[firstName(userName)];
  if (block) {
    // A blocked reviewer (Serbleen/Parinita) sees ONLY their block.
    const ft = String(formType || "").toLowerCase();
    return block.some((kw) => ft.includes(kw));
  }
  // Lead / unlisted reviewer gets the OVERFLOW — anything no blocked reviewer owns.
  if (normalizeRole(role) === "processinglead") return !typeIsClaimed(formType);
  // An unlisted plain Reviewer also takes only the overflow (avoid double-handling).
  return !typeIsClaimed(formType);
}

// Is this person in the review rotation (gets a review queue)? Admins are not.
export function isReviewer(role: Role): boolean {
  const r = normalizeRole(role);
  return r === "reviewer" || r === "processinglead";
}
