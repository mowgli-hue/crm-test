import { getChecklistForFormType, getMissingChecklistDocs } from "@/lib/application-checklists";
import { getQuestionFlowForFormType } from "@/lib/application-question-flows";
import { CaseItem, DocumentItem, PgwpIntakeData } from "@/lib/models";

type MissingIntakeItem = {
  key: string;
  label: string;
};

export type IntakeCheckResult = {
  questionnaireComplete: boolean;
  missingIntakeItems: MissingIntakeItem[];
  missingRequiredDocs: string[];
  riskFlags: string[];
  recommendedTaskTitles: string[];
};

function asText(value: unknown): string {
  return String(value || "").trim();
}

function hasValue(intake: Record<string, string>, key: string): boolean {
  return asText(intake[key]).length > 0;
}

function isYes(value: string): boolean {
  const normalized = asText(value).toLowerCase();
  return normalized.startsWith("y");
}

function parseSpecificAnswers(raw: unknown, prompts: string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const prompt of prompts) output[prompt] = "";
  const source = asText(raw);
  if (!source) return output;
  try {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    for (const prompt of prompts) output[prompt] = asText(parsed[prompt]);
  } catch {
    // Keep defaults for invalid JSON.
  }
  return output;
}

function fieldLabel(key: string): string {
  const map: Record<string, string> = {
    fullName: "Full name",
    phone: "Phone number",
    maritalStatus: "Marital status",
    address: "Mailing address",
    travelHistorySixMonths: "Travel history over 6 months",
    travelHistoryDetails: "Travel history details",
    nativeLanguage: "Native language",
    englishTestTaken: "English test taken",
    originalEntryDate: "Original entry date",
    originalEntryPlacePurpose: "Original entry place and purpose",
    employmentHistory: "Employment history",
    education: "Education after 12th",
    educationDetails: "Education details",
    refusedAnyCountry: "Refusal/flagpoling question",
    refusalDetails: "Refusal details",
    criminalHistory: "Criminal history",
    medicalHistory: "Medical history",
    usedOtherName: "Used other name",
    otherNameDetails: "Other name details",
    spouseName: "Spouse name",
    spouseDateOfMarriage: "Date of marriage",
    previousMarriageCommonLaw: "Previous marriage/common-law",
    previousRelationshipDetails: "Previous relationship details"
  };
  return map[key] || key;
}

function toIntakeRecord(intake?: PgwpIntakeData): Record<string, string> {
  const out: Record<string, string> = {};
  if (!intake) return out;
  Object.entries(intake).forEach(([k, v]) => {
    out[k] = asText(v);
  });
  return out;
}

function buildRiskFlags(caseItem: CaseItem, intake: Record<string, string>, missingRequiredDocs: string[]): string[] {
  const flags: string[] = [];
  if (isYes(intake.refusedAnyCountry)) flags.push("Previous refusal/flagpoling present.");
  if (isYes(intake.criminalHistory)) flags.push("Criminal history present.");
  if (isYes(intake.medicalHistory)) flags.push("Medical history present.");
  if ((caseItem.processingStatus || "") === "other" && asText(caseItem.processingStatusOther)) {
    flags.push(`Custom processing status: ${asText(caseItem.processingStatusOther)}`);
  }
  if (missingRequiredDocs.length > 0) {
    flags.push(`Missing required docs: ${missingRequiredDocs.length}`);
  }
  return flags;
}

export function runIntakeCheck(caseItem: CaseItem, documents: DocumentItem[]): IntakeCheckResult {
  const intake = toIntakeRecord(caseItem.pgwpIntake);
  const flow = getQuestionFlowForFormType(caseItem.formType || "generic");

  // Required documents — always checked, regardless of how intake was collected.
  const checklistAll = getChecklistForFormType(caseItem.formType || "generic");
  const missingDocs = getMissingChecklistDocs(caseItem.formType || "generic", documents);

  // ── WhatsApp AI intake completion shortcut ──
  // The WhatsApp AI intake saves each answer under q1..qN and full-question-text
  // keys — NOT the named fields (fullName/phone/address/…) or the
  // applicationSpecificAnswers JSON this checker reads. So a FULLY-COMPLETED
  // WhatsApp intake was being reported as dozens of answers "missing", which kept
  // the case from EVER showing ready-to-prepare even though every answer is on
  // file. If the WhatsApp intake finished, the questionnaire is captured — trust
  // its completion marker. (Non-WhatsApp / partial intakes still fall through to
  // the detailed field-by-field check below.)
  const whatsappDone =
    asText(intake.whatsappIntakeCompletedAt).length > 0 ||
    asText(intake.whatsappIntakePhase).toLowerCase() === "complete";
  if (whatsappDone) {
    return {
      questionnaireComplete: true,
      missingIntakeItems: [],
      missingRequiredDocs: missingDocs,
      riskFlags: buildRiskFlags(caseItem, intake, missingDocs),
      recommendedTaskTitles: checklistAll
        .filter((item) => item.required && missingDocs.includes(item.label))
        .map((item) => `Collect required document: ${item.label}`),
    };
  }

  const missingIntakeItems: MissingIntakeItem[] = [];
  flow.requiredFields.forEach((field) => {
    if (!hasValue(intake, field)) {
      missingIntakeItems.push({ key: field, label: fieldLabel(field) });
    }
  });

  if (isYes(intake.usedOtherName) && !hasValue(intake, "otherNameDetails")) {
    missingIntakeItems.push({ key: "otherNameDetails", label: fieldLabel("otherNameDetails") });
  }

  const marital = asText(intake.maritalStatus).toLowerCase();
  const requiresSpouse = marital.includes("married") || marital.includes("common");
  if (requiresSpouse) {
    if (!hasValue(intake, "spouseName")) {
      missingIntakeItems.push({ key: "spouseName", label: fieldLabel("spouseName") });
    }
    if (!hasValue(intake, "spouseDateOfMarriage")) {
      missingIntakeItems.push({
        key: "spouseDateOfMarriage",
        label: fieldLabel("spouseDateOfMarriage")
      });
    }
  }

  if (isYes(intake.previousMarriageCommonLaw) && !hasValue(intake, "previousRelationshipDetails")) {
    missingIntakeItems.push({
      key: "previousRelationshipDetails",
      label: fieldLabel("previousRelationshipDetails")
    });
  }

  if (isYes(intake.refusedAnyCountry) && !hasValue(intake, "refusalDetails")) {
    missingIntakeItems.push({ key: "refusalDetails", label: fieldLabel("refusalDetails") });
  }

  if (isYes(intake.travelHistorySixMonths) && !hasValue(intake, "travelHistoryDetails")) {
    missingIntakeItems.push({
      key: "travelHistoryDetails",
      label: fieldLabel("travelHistoryDetails")
    });
  }

  const education = asText(intake.education).toLowerCase();
  if (["bachelor", "master", "other"].includes(education) && !hasValue(intake, "educationDetails")) {
    missingIntakeItems.push({ key: "educationDetails", label: fieldLabel("educationDetails") });
  }

  const specificAnswers = parseSpecificAnswers(intake.applicationSpecificAnswers, flow.prompts);
  flow.prompts.forEach((prompt, idx) => {
    if (!asText(specificAnswers[prompt])) {
      missingIntakeItems.push({
        key: `applicationSpecificAnswers.${idx}`,
        label: `Application question: ${prompt}`
      });
    }
  });

  const checklist = getChecklistForFormType(caseItem.formType || "generic");
  const missingRequiredDocs = getMissingChecklistDocs(caseItem.formType || "generic", documents);

  const docTaskTitles = checklist
    .filter((item) => item.required && missingRequiredDocs.includes(item.label))
    .map((item) => `Collect required document: ${item.label}`);

  const intakeTaskTitles = missingIntakeItems.map((item) => `Collect intake answer: ${item.label}`);

  return {
    questionnaireComplete: missingIntakeItems.length === 0,
    missingIntakeItems,
    missingRequiredDocs,
    riskFlags: buildRiskFlags(caseItem, intake, missingRequiredDocs),
    recommendedTaskTitles: [...intakeTaskTitles, ...docTaskTitles]
  };
}

