import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { canStaffAccessCase } from "@/lib/rbac";
import { maybeAutoRunImm5710 } from "@/lib/imm5710-runner";
import { buildReadyPackage, writeReadyPackageToDisk } from "@/lib/ready-package";
import {
  getCase,
  listDocuments,
  resolveUserFromInviteToken,
  syncCaseAutomation,
  updateCaseImm5710Automation,
  updateCasePgwpIntake
} from "@/lib/store";
import { PgwpIntakeData } from "@/lib/models";
import { buildCaseFolderNameWithApp, createCaseDriveStructure, extractDriveFolderId, uploadFileToDriveFolder } from "@/lib/google-drive";
import { resolveCaseDriveRootLink, updateCaseLinks } from "@/lib/store";
import { buildSimpleTextPdf } from "@/lib/simple-pdf";
import { getDataDir } from "@/lib/storage-paths";
import { runAiIntakeCheckAndCreateTasks } from "@/lib/ai-intake-automation";

const INTAKE_FIELDS: Array<keyof PgwpIntakeData> = [
  "fullName",
  "applicationType",
  "applicationSpecificAnswers",
  "intendedWorkDetails",
  "usedOtherName",
  "otherNameDetails",
  "travelHistorySixMonths",
  "travelHistoryDetails",
  "currentCountry",
  "currentCountryStatus",
  "currentCountryFromDate",
  "currentCountryToDate",
  "previousCountries",
  "firstName",
  "lastName",
  "dateOfBirth",
  "placeOfBirthCity",
  "passportNumber",
  "passportIssueDate",
  "passportExpiryDate",
  "nationalIdNumber",
  "usGreenCardNumber",
  "countryOfBirth",
  "citizenship",
  "uci",
  "address",
  "city",
  "province",
  "postalCode",
  "email",
  "phone",
  "nativeLanguage",
  "canCommunicateEnglishFrench",
  "preferredLanguage",
  "maritalStatus",
  "spouseName",
  "spouseDob",
  "spouseDateOfMarriage",
  "previousMarriageCommonLaw",
  "previousRelationshipDetails",
  "residentialAddress",
  "education",
  "educationDetails",
  "ieltsDetails",
  "englishTestTaken",
  "originalEntryDate",
  "originalEntryPlacePurpose",
  "originalEntryToCanadaPlace",
  "originalEntryPurpose",
  "recentEntryAny",
  "recentEntryDetails",
  "employmentHistory",
  "dliNameLocation",
  "programNameDuration",
  "completionLetterDate",
  "fullTimeStudentThroughout",
  "gapsOrPartTimeDetails",
  "previousCollegesInCanada",
  "academicProbationOrTransfer",
  "unauthorizedWorkDuringStudies",
  "hasRepresentative",
  "permitDetails",
  "studyPermitExpiryDate",
  "pastStudiesDetails",
  "currentStudyCompletionLetterDetails",
  "restorationNeeded",
  "fundsAvailable",
  "medicalExamCompleted",
  "refusedAnyCountry",
  "refusalDetails",
  "militaryServiceDetails",
  "criminalHistory",
  "medicalHistory",
  "additionalNotes"
];

function sanitizePatch(body: Record<string, unknown>): Partial<PgwpIntakeData> {
  const patch: Partial<PgwpIntakeData> = {};
  // Save known fields
  for (const field of INTAKE_FIELDS) {
    if (body[field] !== undefined) {
      patch[field] = String(body[field] ?? "").trim();
    }
  }
  // Also save any extra portal fields (dob, sex, place_birth_city, emp1_title, etc.)
  // These come from the new client portal questionnaire
  const EXTRA_PORTAL_KEYS = [
    "dob","sex","place_birth_city","place_birth_country","citizenship_country",
    "native_language","mailing_street_num","mailing_street_name","mailing_apt_unit",
    "mailing_city","mailing_province","mailing_postal_code",
    "current_status","current_status_from_date","current_status_to_date",
    "original_entry_place","recent_entry_date","recent_entry_place",
    "marital_status","spouse_family_name","spouse_given_name","date_of_marriage",
    "prev_application_refused","has_criminal_record","has_medical_condition","has_military_service",
    "edu_school_name","edu_field_of_study","edu_city","edu_from_year","edu_to_year",
    "__empCount",
  ];
  for (const field of EXTRA_PORTAL_KEYS) {
    if (body[field] !== undefined) {
      (patch as any)[field] = String(body[field] ?? "").trim();
    }
  }
  // Save dynamic employment fields (emp1_title, emp2_employer, etc.)
  for (const key of Object.keys(body)) {
    if (/^emp\d+_(title|employer|city|country|from|to)$/.test(key)) {
      (patch as any)[key] = String(body[key] ?? "").trim();
    }
  }
  return patch;
}

function labelForField(key: keyof PgwpIntakeData): string {
  const map: Partial<Record<keyof PgwpIntakeData, string>> = {
    fullName: "Full name",
    applicationSpecificAnswers: "Application specific answers",
    phone: "Phone number",
    maritalStatus: "Marital status",
    address: "Mailing address",
    nativeLanguage: "Native language",
    englishTestTaken: "English test taken",
    originalEntryDate: "Original entry date to Canada",
    originalEntryPlacePurpose: "Original entry place and purpose",
    travelHistorySixMonths: "Travel history over 6 months",
    travelHistoryDetails: "Travel history details",
    education: "Education after 12th",
    educationDetails: "Education details",
    employmentHistory: "Employment history",
    refusedAnyCountry: "Any refusal/flagpoling",
    refusalDetails: "Refusal details",
    criminalHistory: "Criminal history",
    medicalHistory: "Medical history",
    additionalNotes: "Additional notes",
    usedOtherName: "Used any other name",
    otherNameDetails: "Other name details",
    spouseName: "Spouse full name",
    spouseDateOfMarriage: "Date of marriage",
    previousMarriageCommonLaw: "Previously married/common-law",
    previousRelationshipDetails: "Previous relationship details"
  };
  if (map[key]) return String(map[key]);
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (m) => m.toUpperCase());
}

async function saveIntakeAnswersPdf(input: {
  companyId: string;
  caseId: string;
  intake: PgwpIntakeData;
}): Promise<{ localPath: string; driveLink?: string }> {
  let caseItem = await getCase(input.companyId, input.caseId);
  if (!caseItem) throw new Error("Case not found for intake PDF.");

  const lines: string[] = [
    "Newton Immigration - Client Intake Answers",
    `Case ID: ${caseItem.id}`,
    `Client: ${caseItem.client}`,
    `Generated At: ${new Date().toISOString()}`,
    ""
  ];

  for (const key of INTAKE_FIELDS) {
    const value = String(input.intake[key] || "").trim();
    if (!value) continue;
    lines.push(`${labelForField(key)}:`);
    for (const row of value.split(/\r?\n/)) lines.push(`  ${row}`);
    lines.push("");
  }

  const pdf = buildSimpleTextPdf(lines);
  const outDir = join(getDataDir(), "intake_pdfs");
  await mkdir(outDir, { recursive: true });
  const localPath = join(outDir, `${caseItem.id}_intake_answers.pdf`);
  await writeFile(localPath, pdf);

  let driveFolderId = extractDriveFolderId(caseItem.applicationFormsLink || caseItem.docsUploadLink || "");
  if (!driveFolderId) {
    const choice = await resolveCaseDriveRootLink(input.companyId, input.caseId);
    const rootId = extractDriveFolderId(String(choice.link || ""));
    if (rootId) {
      const structure = await createCaseDriveStructure(
        rootId,
        buildCaseFolderNameWithApp(caseItem.id, caseItem.client, caseItem.formType)
      );
      await updateCaseLinks(input.companyId, input.caseId, {
        docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
        applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
        submittedFolderLink: structure.subfolders.submitted.webViewLink,
        correspondenceFolderLink: structure.subfolders.correspondence.webViewLink
      });
      caseItem = (await getCase(input.companyId, input.caseId)) || caseItem;
      driveFolderId = structure.subfolders.applicationForms.id;
    }
  }
  if (!driveFolderId) {
    throw new Error("Drive folder is not linked for this case. Add Main Google Drive Link in Settings.");
  }

  const uploaded = await uploadFileToDriveFolder({
    folderId: driveFolderId,
    fileName: `${caseItem.id}_IntakeAnswers.pdf`,
    fileBuffer: pdf,
    mimeType: "application/pdf"
  });
  return { localPath, driveLink: uploaded.webViewLink };
}

async function ensureCaseDriveFolders(companyId: string, caseId: string) {
  const caseItem = await getCase(companyId, caseId);
  if (!caseItem) return { created: false, skipped: "case_not_found" as const };

  if (
    caseItem.applicationFormsLink &&
    caseItem.submittedFolderLink &&
    caseItem.correspondenceFolderLink
  ) {
    return { created: false, skipped: "already_exists" as const };
  }

  const choice = await resolveCaseDriveRootLink(companyId, caseItem.id);
  const driveRoot = String(choice.link || "").trim();
  if (!driveRoot) return { created: false, skipped: "drive_root_missing" as const };

  const rootId = extractDriveFolderId(driveRoot);
  if (!rootId) return { created: false, skipped: "drive_root_invalid" as const };

  const structure = await createCaseDriveStructure(
    rootId,
    buildCaseFolderNameWithApp(caseItem.id, caseItem.client, caseItem.formType)
  );
  await updateCaseLinks(companyId, caseItem.id, {
    docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
    applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
    submittedFolderLink: structure.subfolders.submitted.webViewLink,
    correspondenceFolderLink: structure.subfolders.correspondence.webViewLink
  });
  return { created: true as const, folderLink: structure.caseFolder.webViewLink };
}

async function resolveRequestUser(request: NextRequest, caseId: string) {
  const user = await getCurrentUserFromRequest(request);
  if (user) return user;

  const inviteToken =
    String(request.nextUrl.searchParams.get("t") || "").trim() ||
    String(request.headers.get("x-client-invite-token") || "").trim();
  if (!inviteToken) return null;
  return resolveUserFromInviteToken(inviteToken, caseId);
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await resolveRequestUser(request, params.id);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const caseItem = await getCase(user.companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  if (user.userType === "client" && user.caseId !== caseItem.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (user.userType === "staff" && !canStaffAccessCase(user.role, user.name, caseItem.assignedTo)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    intake: caseItem.pgwpIntake ?? {},
    formType: caseItem.formType,
    client: caseItem.client,
    retainerSigned: caseItem.retainerSigned ?? false,
    retainerAmount: caseItem.servicePackage?.retainerAmount ?? 0,
    caseId: caseItem.id,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  
  // Allow system token calls (backfill, auto-generation)
  const isSystemCall = String(rawBody.systemToken || "").trim() === (process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024");
  
  const user = await resolveRequestUser(request, params.id);
  if (!user && !isSystemCall) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = user?.companyId || process.env.DEFAULT_COMPANY_ID || "newton";
  const caseItem = await getCase(companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  if (!isSystemCall) {
    if (user!.userType === "client" && user!.caseId !== caseItem.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (user!.userType === "staff" && !canStaffAccessCase(user!.role, user!.name, caseItem.assignedTo)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  // Support both { intake: {...} } (portal) and flat { field: value } (staff/AI)
  const body = (rawBody.intake && typeof rawBody.intake === "object")
    ? rawBody.intake as Record<string, unknown>
    : rawBody;
  const patch = sanitizePatch(body);
  const finalizeIntake = String(body.finalizeIntake ?? "").toLowerCase() === "true" || body.finalizeIntake === true;

  const updated = await updateCasePgwpIntake(companyId, params.id, patch);
  if (!updated) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const synced = await syncCaseAutomation(companyId, params.id);
  if (!synced) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  let intakePdf: { localPath: string; driveLink?: string } | null = null;
  let intakePdfError = "";
  if (finalizeIntake) {
    try {
      await ensureCaseDriveFolders(companyId, params.id);
      const refreshedCase = await getCase(companyId, params.id);
      if (refreshedCase?.pgwpIntake) {
        intakePdf = await saveIntakeAnswersPdf({
          companyId: companyId,
          caseId: params.id,
          intake: refreshedCase.pgwpIntake
        });
      }
    } catch (error) {
      // Keep intake save successful even if PDF upload fails.
      intakePdfError = (error as Error).message;
    }
  }
  const docs = await listDocuments(companyId, params.id);
  const snapshot = buildReadyPackage(synced, docs);
  let automation: { started: boolean; skippedReason?: string; error?: string } | null = null;
  let drive: { created: boolean; skipped?: string; error?: string; folderLink?: string } | null = null;
  if (snapshot.readyPackage.readiness.readyForHumanReview) {
    try {
      drive = await ensureCaseDriveFolders(companyId, synced.id);
    } catch (error) {
      drive = { created: false, error: (error as Error).message };
    }
    const readyPath = await writeReadyPackageToDisk(synced.id, snapshot.readyPackage);
    const run = maybeAutoRunImm5710(synced, readyPath);
    automation = run;
    if (run.started) {
      await updateCaseImm5710Automation(companyId, synced.id, {
        status: "started",
        startedAt: new Date().toISOString(),
        pid: run.pid,
        logPath: run.logPath,
        readyPackagePath: readyPath,
        autoTriggered: true,
        lastError: undefined
      });
    } else if (run.error) {
      await updateCaseImm5710Automation(companyId, synced.id, {
        status: "failed",
        readyPackagePath: readyPath,
        lastError: run.error,
        autoTriggered: true
      });
    }
  }

  const latest = await getCase(companyId, params.id);
  const autoIntake = await runAiIntakeCheckAndCreateTasks({
    companyId: companyId,
    caseId: params.id,
    actorUserId: user.id,
    actorName: user.name,
    maxTasks: Number(process.env.AI_INTAKE_AUTO_TASKS_MAX || 8),
    auditAction: "case.ai.intake_check.auto_from_intake"
  }).catch(() => null);

  // Auto-generate IRCC forms when questionnaire is complete
  let formsGenerated: string[] = [];
  try {
    const { isQuestionnaireComplete } = await import("@/lib/application-question-flows");
    const intakeData = (latest?.pgwpIntake ?? {}) as Record<string, string>;
    if (isQuestionnaireComplete(latest?.formType || "", intakeData)) {
      const baseUrl = process.env.NEXTAUTH_URL || `https://${request.headers.get("host")}`;
      const formRes = await fetch(`${baseUrl}/api/cases/${params.id}/generate-forms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemToken: process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024",
          intake: intakeData
        })
      }).catch(() => null);
      if (formRes?.ok) {
        const formData = await formRes.json().catch(() => ({}));
        formsGenerated = formData.generated || [];
      }
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({
    intake: latest?.pgwpIntake ?? {},
    case: latest ?? synced,
    automation,
    drive,
    intakePdf,
    intakePdfError,
    autoIntakeCheck: autoIntake,
    formsGenerated
  });
}
