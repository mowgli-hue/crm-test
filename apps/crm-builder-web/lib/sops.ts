// ─────────────────────────────────────────────────────────────────────
// SOPs — the step-by-step "how to do it" for each work step.
//
// Phase 1 told people WHAT the next step is (next-action.ts). Phase 2 tells a
// (vetted, newly-trained) team member exactly HOW to do it, so the procedure
// lives in the CRM instead of in someone's head. Surfaced inline on the Work
// Now card and the case page.
//
// Structure: one SOP per next-action key, with per-application specializations
// for "assemble" (the step that differs most by application type).
// ─────────────────────────────────────────────────────────────────────

import type { NextActionKey } from "@/lib/next-action";
import { resolveApplicationChecklistKey } from "@/lib/application-checklists";

export interface Sop {
  title: string;
  steps: string[];
}

const GENERIC: Record<NextActionKey, Sop> = {
  collect: {
    title: "Collect documents & intake",
    steps: [
      "Open the case and read the checklist — note every item still marked missing.",
      "Message the client on WhatsApp with the exact outstanding list (one clear message, not a wall).",
      "As files come in, confirm each one actually lands in the case's Drive folder and is the right document.",
      "Fill any missing intake answers from what the client sends.",
      "When the checklist is all green, set the case to ready-to-assemble and check out as 'Ready for review' or hand off.",
    ],
  },
  assemble: {
    title: "Fill & assemble the forms",
    steps: [
      "Confirm intake + client documents are complete before you start (don't assemble a half-ready file).",
      "Fill the IRCC form from the verified intake data — cert-safe (don't break the certificate).",
      "Generate IMM5476 (Use of Representative) and the representative submission letter.",
      "Click Assemble to build the Client Information folder.",
      "Open the folder and confirm passport, photo, the forms and supporting docs are all present and correct.",
      "Set the case to Under review and check out with a note on anything the reviewer should know.",
    ],
  },
  review: {
    title: "Review the package",
    steps: [
      "Open the assembled Client Information folder and the filled form side by side.",
      "Check every form field against the source documents — name spelling, DOB, passport number, dates.",
      "Verify eligibility for this application type (e.g. SOWP: principal's NOC is eligible; restoration: within the 90-day window).",
      "Confirm nothing required is missing and no wrong-client document slipped in.",
      "If it's clean → approve (changes done). If not → send it back (changes needed) with a clear note on each fix.",
    ],
  },
  fix: {
    title: "Fix the reviewer's changes",
    steps: [
      "Open the reviewer's notes and list every flagged item.",
      "Correct each one — re-fill the form field, swap the document, or fix the data.",
      "If you changed the forms, re-run Assemble so the folder reflects the fix.",
      "Set the case back to Under review and check out with a note saying what you changed.",
    ],
  },
  submit: {
    title: "Submit to IRCC",
    steps: [
      "Open the approved Client Information folder — confirm it's the reviewer-approved version.",
      "Log in to the IRCC portal and start the application for this client.",
      "Upload each file to its correct slot; double-check nothing is missing.",
      "Pay the fee (fee-exempt for VOWP) and submit.",
      "Save the confirmation number to the case and set status to Submitted, then check out as 'Submitted'.",
    ],
  },
  progress: {
    title: "Move the case forward",
    steps: [
      "Open the case and read where it actually stands.",
      "Action the single most outstanding item.",
      "Check out with a clear status so the next person knows what's left.",
    ],
  },
};

// Assemble differs by application type — these replace the generic assemble steps.
const ASSEMBLE_BY_KEY: Partial<Record<string, string[]>> = {
  pgwp: [
    "Confirm passport, study permit, completion letter, transcripts and photo are all in.",
    "Fill IMM5710 from intake (cert-safe). Generate IMM5476 + submission letter.",
    "Run Assemble. Confirm the folder has the forms + transcripts + completion letter.",
    "Set Under review; note anything unusual (gaps in study, etc.).",
  ],
  sowp: [
    "Confirm the marriage certificate / relationship proof AND the principal's employment letter showing an ELIGIBLE NOC (TEER 0/1 or select 2/3) — this is the eligibility gate.",
    "Confirm the principal's permit has 16+ months left; flag for review if not.",
    "Fill IMM5710 (inside Canada) from intake. Generate IMM5476 + submission letter.",
    "Run Assemble. Confirm the Client Info bundle has the marriage cert + principal's job evidence.",
    "Set Under review.",
  ],
  vowp: [
    "Confirm passport, photo, current permit, and the proof of abuse / risk (the eligibility basis).",
    "Fill IMM5710 (inside Canada, fee-exempt) from intake. Generate IMM5476 + submission letter.",
    "Run Assemble (minimal set: passport, photo, Client Information bundle).",
    "Set Under review — handle the abuse evidence sensitively.",
  ],
  trv_inside: [
    "Confirm passport (with stamps), current permit, proof of funds, and photo.",
    "Fill IMM5257 + IMM5476 (cert-safe).",
    "Run Assemble — builds the single Client Information PDF (passport, photo, permit, 5476).",
    "Set Under review.",
  ],
  study_permit_extension: [
    "Confirm passport, current permit, LOA, PAL (if needed), proof of funds, transcripts and photo.",
    "Fill IMM5709 from intake. Generate IMM5476 + submission letter.",
    "Run Assemble. Confirm LOA + PAL + proof of funds are in.",
    "Set Under review.",
  ],
};

export function getSop(actionKey: NextActionKey, formType: string): Sop {
  if (actionKey === "assemble") {
    const key = resolveApplicationChecklistKey(formType || "");
    const steps = ASSEMBLE_BY_KEY[key];
    if (steps) return { title: GENERIC.assemble.title, steps };
  }
  return GENERIC[actionKey] || GENERIC.progress;
}
