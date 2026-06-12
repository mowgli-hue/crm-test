import { CaseItem, DocumentItem } from "@/lib/models";
import { runIntakeCheck } from "@/lib/intake-checker";
import { getMissingFormDocs } from "@/lib/application-checklists";

export type ReadinessStage = {
  complete: boolean;
  missing: string[]; // human-readable labels of what's still outstanding
};

export type CaseReadiness = {
  intake: ReadinessStage; // A — required intake answers
  clientDocs: ReadinessStage; // B — required client documents (passport, permit, …)
  forms: ReadinessStage; // C — system-generated forms (IMM5710/5476 + rep letter)
  submissionReady: boolean; // A && B && C
};

/**
 * THE single definition of "is this case ready" — the shared source of truth
 * for the CRM intake view, the submission package, and (via the readiness API)
 * the processing agent, so they all agree on "complete."
 *
 * Three stages, ALL required for `submissionReady`:
 *   A. intake     — every required intake answer is present
 *   B. clientDocs — required client documents are present
 *   C. forms      — the system-generated forms exist (main IRCC form + IMM5476
 *                   + representative submission letter)
 *
 * Stages A and B reuse runIntakeCheck() so there's exactly one place that
 * decides those; stage C uses getMissingFormDocs(). Nothing here re-implements
 * a parallel notion of completeness.
 */
export function getCaseReadiness(caseItem: CaseItem, documents: DocumentItem[]): CaseReadiness {
  const formType = caseItem.formType || "generic";

  const check = runIntakeCheck(caseItem, documents);
  const intakeMissing = check.missingIntakeItems.map((m) => m.label);
  const clientDocsMissing = check.missingRequiredDocs;
  const formsMissing = getMissingFormDocs(formType, documents);

  return {
    intake: { complete: intakeMissing.length === 0, missing: intakeMissing },
    clientDocs: { complete: clientDocsMissing.length === 0, missing: clientDocsMissing },
    forms: { complete: formsMissing.length === 0, missing: formsMissing },
    submissionReady:
      intakeMissing.length === 0 &&
      clientDocsMissing.length === 0 &&
      formsMissing.length === 0,
  };
}

/** Flat list of everything still outstanding, across all three stages. */
export function allMissing(readiness: CaseReadiness): string[] {
  return [
    ...readiness.intake.missing,
    ...readiness.clientDocs.missing,
    ...readiness.forms.missing,
  ];
}
