import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CaseItem, DocumentItem } from "@/lib/models";
import { getMissingImm5710Questions } from "@/lib/imm5710";
import { generatePgwpDraft } from "@/lib/pgwp";
import { getDataDir } from "@/lib/storage-paths";

function toSnakeCaseMapping(intake: Record<string, string | undefined>) {
  return {
    full_name: intake.fullName || "",
    application_type: intake.applicationType || "",
    intended_work_details: intake.intendedWorkDetails || "",
    current_country: intake.currentCountry || "",
    current_country_status: intake.currentCountryStatus || "",
    current_country_from_date: intake.currentCountryFromDate || "",
    current_country_to_date: intake.currentCountryToDate || "",
    previous_countries: intake.travelHistoryDetails || intake.previousCountries || "",
    first_name: intake.firstName || "",
    last_name: intake.lastName || "",
    date_of_birth: intake.dateOfBirth || "",
    place_of_birth_city: intake.placeOfBirthCity || "",
    passport_number: intake.passportNumber || "",
    passport_issue_date: intake.passportIssueDate || "",
    passport_expiry_date: intake.passportExpiryDate || "",
    national_id_number: intake.nationalIdNumber || "",
    us_green_card_number: intake.usGreenCardNumber || "",
    country_of_birth: intake.countryOfBirth || "",
    citizenship: intake.citizenship || "",
    uci: intake.uci || "",
    address: intake.address || "",
    city: intake.city || "",
    province: intake.province || "",
    postal_code: intake.postalCode || "",
    email: intake.email || "",
    phone: intake.phone || "",
    can_communicate_english_french: intake.canCommunicateEnglishFrench || "",
    preferred_language: intake.preferredLanguage || "",
    employer_name: "",
    employment_history: intake.employmentHistory || "",
    marital_status: intake.maritalStatus || "",
    spouse_name: intake.spouseName || "",
    spouse_dob: intake.spouseDob || "",
    native_language: intake.nativeLanguage || "",
    education: intake.education || "",
    education_details: intake.educationDetails || "",
    ielts_details: intake.ieltsDetails || "",
    original_entry_date: intake.originalEntryDate || "",
    original_entry_place_purpose: intake.originalEntryPlacePurpose || "",
    recent_entry_details: intake.recentEntryDetails || "",
    permit_details: intake.permitDetails || "",
    study_permit_expiry_date: intake.studyPermitExpiryDate || "",
    dli_name_location: intake.dliNameLocation || "",
    program_name_duration: intake.programNameDuration || "",
    completion_letter_date: intake.completionLetterDate || "",
    full_time_student_throughout: intake.fullTimeStudentThroughout || "",
    gaps_or_part_time_details: intake.gapsOrPartTimeDetails || "",
    previous_colleges_in_canada: intake.previousCollegesInCanada || "",
    academic_probation_or_transfer: intake.academicProbationOrTransfer || "",
    unauthorized_work_during_studies: intake.unauthorizedWorkDuringStudies || "",
    has_representative: intake.hasRepresentative || "",
    past_studies_details: intake.pastStudiesDetails || "",
    study_completion_details: intake.currentStudyCompletionLetterDetails || "",
    restoration_needed: intake.restorationNeeded || "",
    funds_available: intake.fundsAvailable || "",
    medical_exam_completed: intake.medicalExamCompleted || "",
    refused_any_country: intake.refusedAnyCountry || "",
    refusal_details: intake.refusalDetails || "",
    military_service_details: intake.militaryServiceDetails || "",
    criminal_history: intake.criminalHistory || "",
    medical_history: intake.medicalHistory || "",
    additional_notes: intake.additionalNotes || ""
  };
}

export function buildReadyPackage(caseItem: CaseItem, documents: DocumentItem[]) {
  const intake = caseItem.pgwpIntake ?? {};
  const aiDraft = generatePgwpDraft(caseItem, documents);
  const missingCoreQuestions = getMissingImm5710Questions(intake);

  // Identity/passport fields that must be extracted from documents before the
  // form can be filled. A case is NOT ready for review if any are still blank —
  // otherwise it maps to blank required fields on the IMM5710.
  const internalExtractionRequired = [
    "passportNumber",
    "passportIssueDate",
    "passportExpiryDate",
    "countryOfBirth",
    "citizenship",
    "studyPermitExpiryDate",
    "currentCountryStatus",
  ];
  const missingExtractionFields = internalExtractionRequired.filter(
    (k) => !String((intake as Record<string, unknown>)[k] ?? "").trim()
  );

  const readyPackage = {
    generatedAt: new Date().toISOString(),
    caseId: caseItem.id,
    companyId: caseItem.companyId,
    applicationType: "PGWP",
    formTarget: "IMM5710",
    client: {
      name: caseItem.client,
      firstName: intake.firstName || "",
      lastName: intake.lastName || "",
      email: intake.email || "",
      phone: intake.phone || ""
    },
    imm5710FieldMap: toSnakeCaseMapping(intake as Record<string, string | undefined>),
    intake,
    documents,
    aiDraft,
    readiness: {
      readyForHumanReview:
        aiDraft.missingDocuments.length === 0 &&
        missingCoreQuestions.length === 0 &&
        missingExtractionFields.length === 0 &&
        Boolean(caseItem.retainerSigned) &&
        (caseItem.paymentStatus === "paid" || caseItem.paymentStatus === "not_required"),
      missingDocuments: aiDraft.missingDocuments,
      missingIntakeFields: missingCoreQuestions.map((q) => q.key),
      missingIntakeFieldLabels: missingCoreQuestions.map((q) => q.label),
      internalExtractionRequired,
      missingExtractionFields
    }
  };

  return { readyPackage, aiDraft, missingCoreQuestions };
}

export async function writeReadyPackageToDisk(caseId: string, readyPackage: unknown): Promise<string> {
  const outDir = join(getDataDir(), "ready_packages");
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, `${caseId}_pgwp.json`);
  await writeFile(outFile, JSON.stringify(readyPackage, null, 2), "utf8");
  return outFile;
}
