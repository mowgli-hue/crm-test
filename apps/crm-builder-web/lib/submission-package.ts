/**
 * PGWP Submission Package Assembly
 *
 * Given a case ID, this module:
 *   1. Validates that all required documents are present on the case
 *   2. Generates IMM5476 (Use of Representative) form
 *   3. Bundles client supporting documents (study permit + IELTS + previous
 *      school records) into a single Client_Info PDF
 *   4. Copies/uploads everything into a Submission_<First>_<Last> subfolder
 *      in the case's Drive folder with standardized filenames
 *
 * Naming convention (per Newton scope decision A):
 *   Passport_<First>_<Last>.pdf
 *   Photo_<First>_<Last>.<ext>
 *   Transcript_<First>_<Last>.pdf
 *   Completion_Letter_<First>_<Last>.pdf
 *   IMM5710e_<First>_<Last>.pdf
 *   IMM5476e_<First>_<Last>.pdf
 *   Representative_Submission_Letter_<First>_<Last>.pdf
 *   Client_Info_<First>_<Last>.pdf
 *
 * Re-running on the same case overwrites the existing submission subfolder
 * (per scope decision Q4 = "existing").
 *
 * Required documents — generation blocks if any are missing:
 *   - passport, photo, transcript, completion_letter (uploaded by client)
 *   - imm_form (specifically IMM5710 — must already be generated)
 *   - submission_letter (must already be generated)
 *
 * Optional documents — included if present, skipped silently if not:
 *   - study_permit (current + previous)
 *   - language_test (IELTS / CELPIP)
 *   - older transcripts and LOAs (e.g., from a previous school)
 */

import { getCase, listDocuments } from "@/lib/store";
import { CaseItem, DocumentItem } from "@/lib/models";
import {
  getOrCreateDriveSubfolder,
  uploadFileToDriveFolder,
  copyDriveFileToFolder,
  downloadDriveFileBytes,
  extractDriveFileId,
  extractDriveFolderId,
  deleteFilesByNameInFolder,
} from "@/lib/google-drive";
import { categorizeDocumentByFilename, DocCategory } from "@/lib/document-categories";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SubmissionPackageResult = {
  ok: boolean;
  folderLink?: string;
  folderId?: string;
  filesAdded?: Array<{ name: string; link: string; source: "copied" | "generated" }>;
  missingRequired?: string[];   // populated when ok=false
  errors?: string[];            // non-fatal errors during assembly
  warnings?: string[];          // e.g., optional docs not found
};

type CategorizedDoc = DocumentItem & {
  category: DocCategory;
  driveFileId: string | null;
};

// Required categories for a complete PGWP submission
const REQUIRED_FOR_PGWP: DocCategory[] = [
  "passport",
  "photo",
  "transcript",
  "completion_letter",
  "imm_form",        // IMM5710 must be already generated
  "submission_letter",
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function splitClientName(fullName: string): { first: string; last: string } {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Client", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _.-]/g, "").trim() || "File";
}

function buildStandardName(template: string, firstName: string, lastName: string, extension: string): string {
  const f = safeFileName(firstName).replace(/\s+/g, "_");
  const l = safeFileName(lastName).replace(/\s+/g, "_");
  const stem = template.replace("<First>", f).replace("<Last>", l).replace(/_+$/, "");
  return `${stem}.${extension.replace(/^\./, "")}`;
}

function inferExtension(filename: string, fallback = "pdf"): string {
  const m = filename.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : fallback;
}

async function categorizeDocs(documents: DocumentItem[]): Promise<CategorizedDoc[]> {
  // Pass 1: filename-based categorization (cheap, fast, deterministic)
  const initial: CategorizedDoc[] = documents.map((d) => ({
    ...d,
    category: categorizeDocumentByFilename(d.name),
    driveFileId: extractDriveFileId(d.link),
  }));

  // Pass 2: OCR fallback for docs categorized as "other" — staff often
  // upload passport/transcript/etc with generic filenames like "IMG_5234.jpg"
  // that the regex categorizer can't recognize. Vision OCR reads the actual
  // content and categorizes properly.
  //
  // We only OCR docs marked "other" (the unknowns), and we cap at 8 OCR
  // calls per package run to keep latency bounded. If you have 30+ unknown
  // files, the rest stay as "other" and get reviewed manually by staff.
  const OCR_BUDGET = 8;
  let ocrUsed = 0;
  const result: CategorizedDoc[] = [];

  for (const doc of initial) {
    if (doc.category !== "other" || !doc.driveFileId || ocrUsed >= OCR_BUDGET) {
      result.push(doc);
      continue;
    }
    try {
      const bytes = await downloadDriveFileBytes(doc.driveFileId);
      if (bytes.length >= 10 * 1024 * 1024) {
        result.push(doc);
        continue;
      }
      const mimeType = doc.name.toLowerCase().endsWith(".pdf") ? "application/pdf" :
        doc.name.toLowerCase().match(/\.(jpe?g|png|webp)$/) ? `image/${doc.name.toLowerCase().match(/\.(jpe?g|png|webp)$/)![1].replace("jpg", "jpeg")}` :
        "application/pdf";
      const { extractDocumentFields } = await import("@/lib/doc-ocr");
      const extracted = await extractDocumentFields(bytes, mimeType, "Client");
      ocrUsed++;
      if (extracted && extracted.category) {
        // Map OCR category strings to our CategorizedDoc category type
        const ocrCat = extracted.category.toLowerCase();
        const categoryMap: Record<string, DocCategory> = {
          passport: "passport",
          photo: "photo",
          study_permit: "study_permit",
          work_permit: "work_permit",
          transcripts: "transcript",
          completion_letter: "completion_letter",
          language_test: "language_test",
          ielts: "language_test",
          medical: "medical",
          loa: "loa",
          bank_statement: "bank_statement",
        };
        const mapped = categoryMap[ocrCat];
        if (mapped) {
          console.log(`📋 OCR re-categorized "${doc.name}" from "other" → "${mapped}"`);
          // Avoid spread (TS in this file has type-inference issues elsewhere
          // that cause `...doc` to flag as never). Manually copy fields.
          result.push(Object.assign({}, doc, { category: mapped }) as CategorizedDoc);
          continue;
        }
      }
      result.push(doc);
    } catch (e) {
      // OCR failed — keep as "other"
      result.push(doc);
    }
  }

  return result;
}

/**
 * Pick "the" doc for each required category.
 * - For passport/photo/completion_letter/submission_letter: most recently uploaded
 * - For transcript: most recently uploaded is treated as the CURRENT school transcript;
 *     older transcripts are pushed into the Client Info bundle
 * - For imm_form: prefer IMM5710 specifically; fall back to other IMM forms
 */
function selectPrimaryDocs(categorized: CategorizedDoc[]): {
  passport?: CategorizedDoc;
  photo?: CategorizedDoc;
  transcript?: CategorizedDoc;
  completionLetter?: CategorizedDoc;
  imm5710?: CategorizedDoc;
  imm5476?: CategorizedDoc;
  submissionLetter?: CategorizedDoc;
  olderTranscripts: CategorizedDoc[];
  studyPermits: CategorizedDoc[];
  workPermits: CategorizedDoc[];
  languageTests: CategorizedDoc[];
  loas: CategorizedDoc[];
  medicals: CategorizedDoc[];
} {
  // Sort by uploadedAt descending so .find() picks the most recent
  const byDateDesc = [...categorized].sort((a, b) => {
    const aT = a.uploadedAt ? Date.parse(a.uploadedAt) : 0;
    const bT = b.uploadedAt ? Date.parse(b.uploadedAt) : 0;
    return bT - aT;
  });

  const passport = byDateDesc.find((d) => d.category === "passport");
  const photo = byDateDesc.find((d) => d.category === "photo");
  const completionLetter = byDateDesc.find((d) => d.category === "completion_letter");
  const submissionLetter = byDateDesc.find((d) => d.category === "submission_letter");

  // IMM forms: prefer IMM5710 by filename match, fall back to first imm_form
  const immForms = byDateDesc.filter((d) => d.category === "imm_form");
  const imm5710 = immForms.find((d) => /\b5710/i.test(d.name)) || immForms[0];
  const imm5476 = immForms.find((d) => /\b5476/i.test(d.name));

  // Transcripts: newest = current; older = into bundle
  const allTranscripts = byDateDesc.filter((d) => d.category === "transcript");
  const transcript = allTranscripts[0];
  const olderTranscripts = allTranscripts.slice(1);

  const studyPermits = byDateDesc.filter((d) => d.category === "study_permit");
  const workPermits = byDateDesc.filter((d) => d.category === "work_permit");
  const languageTests = byDateDesc.filter((d) => d.category === "language_test");
  const loas = byDateDesc.filter((d) => d.category === "loa");
  const medicals = byDateDesc.filter((d) => d.category === "medical");

  return {
    passport, photo, transcript, completionLetter,
    imm5710, imm5476, submissionLetter,
    olderTranscripts, studyPermits, workPermits, languageTests, loas, medicals,
  };
}

function validateRequired(
  primary: ReturnType<typeof selectPrimaryDocs>
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!primary.passport)         missing.push("Passport (upload as 'passport.pdf' or similar)");
  if (!primary.photo)            missing.push("Digital photo");
  if (!primary.transcript)       missing.push("Official transcript");
  if (!primary.completionLetter) missing.push("Completion letter");
  if (!primary.imm5710)          missing.push("IMM5710 (use 'Generate Forms' button first)");
  if (!primary.submissionLetter) missing.push("Representative Submission Letter (use letter generator first)");
  return { ok: missing.length === 0, missing };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Service callers
// ─────────────────────────────────────────────────────────────────────────────

function pdfServiceUrl(): string {
  return process.env.PDF_SERVICE_URL || "https://crm-test-production-b755.up.railway.app";
}

async function generateImm5476(applicantData: Record<string, unknown>): Promise<Buffer> {
  const res = await fetch(`${pdfServiceUrl()}/fill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formId: "imm5476", data: applicantData }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`IMM5476 generation failed: ${(err as { error?: string }).error || res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function bundleClientInfo(
  files: Array<{ filename: string; bytes: Buffer }>
): Promise<Buffer> {
  if (files.length === 0) {
    throw new Error("bundleClientInfo: no files to bundle");
  }
  const payload = {
    files: files.map((f) => ({
      filename: f.filename,
      base64: f.bytes.toString("base64"),
    })),
  };
  const res = await fetch(`${pdfServiceUrl()}/bundle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Bundle failed: ${(err as { error?: string }).error || res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// IMM5476 input mapper — pulls applicant fields out of pgwpIntake / case
// ─────────────────────────────────────────────────────────────────────────────

function buildImm5476Data(caseItem: CaseItem): Record<string, unknown> {
  const intake = (caseItem.pgwpIntake as Record<string, unknown>) || {};
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Try multiple intake field names (clients may store under different keys)
  const firstName =
    (intake.firstName as string) ||
    (intake.first_name as string) ||
    (intake.givenName as string) ||
    splitClientName(caseItem.client || "").first;
  const lastName =
    (intake.lastName as string) ||
    (intake.last_name as string) ||
    (intake.familyName as string) ||
    splitClientName(caseItem.client || "").last;
  const dob =
    (intake.dateOfBirth as string) ||
    (intake.dob as string) ||
    "";
  const email =
    (intake.email as string) ||
    "";
  const phone =
    (intake.phone as string) ||
    (intake.q7 as string) ||  // q7 of PGWP intake is phone
    (caseItem.phone as string) ||
    "";
  const uci =
    (intake.uci as string) ||
    (intake.UCI as string) ||
    "";

  // Application type — derive from case formType (always "Post Graduate Work Permit" for PGWP)
  const formType = (caseItem.formType || "").toLowerCase();
  let applicationType = "Post Graduate Work Permit";
  if (formType.includes("study permit")) applicationType = "Study Permit Extension";
  else if (formType.includes("visitor")) applicationType = "Temporary Resident Visa";
  else if (formType.includes("trv")) applicationType = "Temporary Resident Visa";
  else if (formType.includes("work permit")) applicationType = "Work Permit";

  return {
    applicant_family_name:  lastName,
    applicant_given_name:   firstName,
    applicant_dob:          dob,
    applicant_email:        email,
    applicant_phone:        phone,
    application_type:       applicationType,
    applicant_uci:          uci,
    rep_signed_date:        today,
    applicant_signed_date:  today,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Drive folder resolution
// ─────────────────────────────────────────────────────────────────────────────

function getCaseDriveFolderId(caseItem: CaseItem): string | null {
  // Prefer applicationFormsLink's parent (the main case folder), fall back to docsUploadLink
  const candidates = [
    caseItem.docsUploadLink,
    caseItem.applicationFormsLink,
    caseItem.submittedFolderLink,
  ].filter(Boolean) as string[];
  for (const link of candidates) {
    const id = extractDriveFolderId(link);
    if (id) return id;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function assemblePgwpSubmissionPackage(
  companyId: string,
  caseId: string
): Promise<SubmissionPackageResult> {
  const caseItem = await getCase(companyId, caseId);
  if (!caseItem) return { ok: false, errors: [`Case ${caseId} not found`] };

  // Step 1: load + categorize documents
  const docs = await listDocuments(companyId, caseId);
  const categorized = await categorizeDocs(docs);
  const primary = selectPrimaryDocs(categorized);

  // Step 2: validate required docs (assemble what's available; surface missing
  // ones as warnings rather than blocking — per scope revision: "create whatever
  // is available", staff prefers a partial package they can review over an
  // error message).
  const validation = validateRequired(primary);
  const initialWarnings: string[] = [];
  if (!validation.ok) {
    initialWarnings.push(
      `Missing recommended docs (package generated anyway): ${validation.missing.join("; ")}`
    );
  }

  // Step 3: resolve target Drive folder. We use the case's docsUploadLink folder
  // as the parent and create/reuse a "Submission_<First>_<Last>" subfolder inside.
  const caseFolderId = getCaseDriveFolderId(caseItem);
  if (!caseFolderId) {
    return {
      ok: false,
      errors: ["No Drive folder set for this case. Generate Forms first to set up Drive folders."],
    };
  }

  const { first, last } = splitClientName(caseItem.client || "Client");
  const subfolderName = buildStandardName("Submission_<First>_<Last>", first, last, "")
    .replace(/^\.|\.$/g, "")
    .replace(/\.+$/, "");

  const subfolder = await getOrCreateDriveSubfolder(caseFolderId, subfolderName);
  const submissionFolderId = subfolder.id;

  const errors: string[] = [];
  const filesAdded: SubmissionPackageResult["filesAdded"] = [];
  const warnings: string[] = [...initialWarnings];

  // Step 4: copy top-level docs with standardized names. Each entry is added
  // to copyJobs only if the underlying doc exists on the case — missing docs
  // are skipped silently (they're listed in initialWarnings already).
  type CopyJob = { doc: CategorizedDoc; template: string; ext?: string };
  const copyJobs: CopyJob[] = [];
  if (primary.passport)         copyJobs.push({ doc: primary.passport,         template: "Passport_<First>_<Last>" });
  if (primary.photo)            copyJobs.push({ doc: primary.photo,            template: "Photo_<First>_<Last>" });
  if (primary.transcript)       copyJobs.push({ doc: primary.transcript,       template: "Transcript_<First>_<Last>" });
  if (primary.completionLetter) copyJobs.push({ doc: primary.completionLetter, template: "Completion_Letter_<First>_<Last>" });
  if (primary.imm5710)          copyJobs.push({ doc: primary.imm5710,          template: "IMM5710e_<First>_<Last>" });
  if (primary.submissionLetter) copyJobs.push({ doc: primary.submissionLetter, template: "Representative_Submission_Letter_<First>_<Last>" });

  // ── WRONG-CLIENT SAFETY FILTER FOR TOP-LEVEL COPIES ──
  // Catches cases where staff accidentally drops another client's docs into
  // a case folder (real Newton bug: Pratham case had Prashil Savalia's files).
  //
  // CRITICAL: build the client name reference set from MULTIPLE sources, not
  // just `caseItem.client`. The case "client" field is sometimes a placeholder
  // like "newton" or "File" — using it alone causes the filter to skip the
  // legitimate client's own docs because OCR returns "PRATHAM BAMBUWALA"
  // and "newton" doesn't match "pratham".
  //
  // Sources (any can match):
  //   1. caseItem.client (raw)
  //   2. intake.firstName + intake.lastName (from OCR or staff entry)
  //   3. intake.fullName
  //
  // If none of these yield ≥1 real name token (≥3 chars, alphabetic), we
  // SKIP the filter entirely — better to include questionable docs than to
  // drop the client's own docs because we don't know who they are.
  const intakeForFilter = (caseItem.pgwpIntake || {}) as Record<string, any>;
  const nameSources: string[] = [
    caseItem.client || "",
    String(intakeForFilter.firstName || ""),
    String(intakeForFilter.lastName || ""),
    String(intakeForFilter.fullName || ""),
  ];
  const caseNameTokensTop = nameSources
    .join(" ")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3 && !["newton", "file", "client", "test"].includes(t));

  if (caseNameTokensTop.length >= 1) {
    const { extractDocumentFields: extractTop } = await import("@/lib/doc-ocr");
    const filteredJobs: CopyJob[] = [];
    for (const job of copyJobs) {
      const skipNameCheck =
        job.template.includes("IMM5710") ||
        job.template.includes("Photo") ||
        job.template.includes("Submission_Letter") ||
        !job.doc.driveFileId;
      if (skipNameCheck) {
        filteredJobs.push(job);
        continue;
      }
      try {
        const bytes = await downloadDriveFileBytes(job.doc.driveFileId);
        if (bytes.length >= 10 * 1024 * 1024) {
          filteredJobs.push(job);
          continue;
        }
        const mimeType = job.doc.name.toLowerCase().endsWith(".pdf") ? "application/pdf" :
          job.doc.name.toLowerCase().match(/\.(jpe?g|png|webp)$/) ? `image/${job.doc.name.toLowerCase().match(/\.(jpe?g|png|webp)$/)![1].replace("jpg", "jpeg")}` :
          "application/pdf";
        const extracted = await extractTop(bytes, mimeType, caseItem.client || "Client");
        if (extracted) {
          const docFirstName = String(extracted.firstName || "").toLowerCase();
          const docLastName = String(extracted.lastName || "").toLowerCase();
          const docNameTokens = (docFirstName + " " + docLastName)
            .split(/[^a-z]+/)
            .filter((t) => t.length >= 3);

          // Only skip if BOTH conditions hold:
          //   1. Doc clearly has a name (≥1 token)
          //   2. NONE of the doc's tokens overlap with ANY of the case's tokens
          // This is conservative — if anything overlaps, we keep the doc.
          if (docNameTokens.length > 0) {
            const hasOverlap = docNameTokens.some((dt) =>
              caseNameTokensTop.some((ct) =>
                ct === dt || (ct.length >= 4 && dt.length >= 4 && (ct.includes(dt) || dt.includes(ct)))
              )
            );
            if (!hasOverlap) {
              warnings.push(
                `⚠️ SKIPPED top-level wrong-client doc: "${job.doc.name}" appears to belong to "${docFirstName} ${docLastName}" (case names: ${caseNameTokensTop.join(", ")}). Please verify and remove from case folder.`
              );
              continue;
            }
          }
        }
      } catch (e) {
        // Filter check failed — non-fatal, fall through and include the doc
      }
      filteredJobs.push(job);
    }
    copyJobs.length = 0;
    copyJobs.push(...filteredJobs);
  } else {
    // No usable name reference for this case — skip the filter entirely.
    // Better to bundle wrong-client docs (caught at staff review) than to
    // skip the client's own docs because we don't know their name.
    console.warn(`Submission package: no usable client name tokens for case ${caseItem.id} — wrong-client filter SKIPPED. Add firstName/lastName to intake to enable.`);
  }

  // Determine final filename + extension for each job. Images get converted to PDF
  // for everything EXCEPT the digital photo (IRCC requires photo as image format).
  const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff"]);
  const finalizedJobs = copyJobs.map((job) => {
    const sourceExt = inferExtension(job.doc.name, "pdf");
    const sourceIsImage = IMAGE_EXTENSIONS.has(sourceExt);
    const isPhoto = job.template === "Photo_<First>_<Last>";
    // Photo: keep image format. Everything else: PDF.
    const finalExt = isPhoto ? sourceExt : (sourceIsImage ? "pdf" : sourceExt);
    const newName = buildStandardName(job.template, first, last, finalExt);
    const needsConversion = sourceIsImage && !isPhoto;
    return { ...job, sourceExt, finalExt, newName, needsConversion };
  });

  // Per-file dedup: before writing each file, delete any existing copy with
  // the same name in the submission folder. Idempotent across re-runs even
  // when files persist from previous attempts.
  const targetNames = finalizedJobs.map((j) => j.newName);
  // Add IMM5476 + Client_Info names to dedup list (we generate those below)
  targetNames.push(buildStandardName("IMM5476e_<First>_<Last>", first, last, "pdf"));
  targetNames.push(buildStandardName("Client_Info_<First>_<Last>", first, last, "pdf"));
  try {
    const dedup = await deleteFilesByNameInFolder(submissionFolderId, targetNames);
    if (dedup.errors.length > 0) {
      warnings.push(`Pre-write dedup had ${dedup.errors.length} error(s) — see logs`);
      console.warn("Submission dedup errors:", dedup.errors);
    }
  } catch (e) {
    warnings.push(`Pre-write dedup failed (non-fatal): ${(e as Error).message}`);
  }

  // Step 4 execute: copy or convert each job into the submission folder
  for (const job of finalizedJobs) {
    if (!job.doc.driveFileId) {
      errors.push(`${job.doc.name}: cannot copy (no Drive file ID)`);
      continue;
    }
    try {
      if (job.needsConversion) {
        // Image → PDF: download original, send through bundler (which converts), upload result
        const imgBytes = await downloadDriveFileBytes(job.doc.driveFileId);
        const pdfBytes = await bundleClientInfo([{ filename: job.doc.name, bytes: imgBytes }]);
        const uploaded = await uploadFileToDriveFolder({
          folderId: submissionFolderId,
          fileName: job.newName,
          fileBuffer: pdfBytes,
          mimeType: "application/pdf",
        });
        filesAdded.push({ name: job.newName, link: uploaded.webViewLink, source: "generated" });
      } else {
        // Same-format: server-side Drive copy (fast)
        const copied = await copyDriveFileToFolder({
          sourceFileId: job.doc.driveFileId,
          newName: job.newName,
          targetFolderId: submissionFolderId,
        });
        filesAdded.push({ name: job.newName, link: copied.webViewLink, source: "copied" });
      }
    } catch (e) {
      errors.push(`Failed for ${job.doc.name}: ${(e as Error).message}`);
    }
  }

  // Step 5: generate IMM5476 and upload to subfolder
  try {
    const imm5476Data = buildImm5476Data(caseItem);
    const imm5476Bytes = await generateImm5476(imm5476Data);
    const imm5476Name = buildStandardName("IMM5476e_<First>_<Last>", first, last, "pdf");
    const uploaded = await uploadFileToDriveFolder({
      folderId: submissionFolderId,
      fileName: imm5476Name,
      fileBuffer: imm5476Bytes,
      mimeType: "application/pdf",
    });
    filesAdded.push({ name: imm5476Name, link: uploaded.webViewLink, source: "generated" });
  } catch (e) {
    errors.push(`IMM5476 generation failed: ${(e as Error).message}`);
  }

  // Step 6: bundle Client_Info per Newton's spec — order:
  //   1. Current + previous study/work permits
  //   2. English language test (IELTS/CELPIP)
  //   3. Older transcripts (previous schools)
  //   4. Older LOAs (previous schools)
  //   5. Medical exam (if uploaded)
  // ── Bundle source list ──
  // "other"-categorized docs are explicitly NOT bundled — staff handles them
  // manually. Bank statements, employment contracts, pay stubs, etc. are NOT
  // part of a PGWP-style submission.
  const bundleSources: CategorizedDoc[] = [
    ...primary.studyPermits,
    ...primary.workPermits,
    ...primary.languageTests,
    ...primary.olderTranscripts,
    ...primary.loas,
    ...primary.medicals,
  ];

  if (bundleSources.length === 0) {
    warnings.push("No study permit / IELTS / prior school records found — Client_Info bundle skipped.");
  } else {
    try {
      const fetchedFiles: Array<{ filename: string; bytes: Buffer }> = [];

      // ── WRONG-CLIENT SAFETY FILTER ──
      // Real Newton bug: a previous case (Pratham) had Prashil Savalia's
      // study permit + passport + IELTS sitting in the case folder by mistake.
      // The bundler dutifully scooped them into Client_Info — making the
      // submission unusable.
      //
      // Mitigation: before bundling each file, run a quick Claude vision check
      // to extract the client name on the doc, then compare against the case's
      // client name. Skip if it clearly belongs to someone else.
      //
      // Reuse the case name tokens computed earlier for the top-level filter.
      // Same logic applies: pull names from intake, fall back to case.client,
      // skip filter entirely if no usable tokens are available (rather than
      // skipping all the client's own docs).
      const caseNameTokens = caseNameTokensTop; // same tokens as top-level filter

      const { extractDocumentFields } = await import("@/lib/doc-ocr");

      for (const src of bundleSources) {
        if (!src.driveFileId) {
          warnings.push(`Skipped from bundle (no Drive ID): ${src.name}`);
          continue;
        }
        try {
          const bytes = await downloadDriveFileBytes(src.driveFileId);

          // Only run vision check if we have a usable name reference for the case.
          // If caseNameTokens is empty, skip the filter — better to bundle a wrong-
          // client doc (caught at staff review) than to skip the client's own docs.
          if (caseNameTokens.length >= 1 && bytes.length < 10 * 1024 * 1024) {
            try {
              const mimeType = src.name.toLowerCase().endsWith(".pdf") ? "application/pdf" :
                src.name.toLowerCase().match(/\.(jpe?g|png|webp)$/) ? `image/${src.name.toLowerCase().match(/\.(jpe?g|png|webp)$/)![1].replace("jpg", "jpeg")}` :
                "application/pdf";
              const extracted = await extractDocumentFields(bytes, mimeType, caseItem.client || "Client");
              if (extracted) {
                const docFirstName = String(extracted.firstName || "").toLowerCase();
                const docLastName = String(extracted.lastName || "").toLowerCase();
                const docNameTokens = (docFirstName + " " + docLastName)
                  .split(/[^a-z]+/)
                  .filter((t) => t.length >= 3);

                // If we got names from the doc, check overlap with case name tokens.
                // Conservative: any overlap = keep. Only skip when CLEARLY a different person.
                if (docNameTokens.length > 0) {
                  const hasOverlap = docNameTokens.some((dt) =>
                    caseNameTokens.some((ct) =>
                      ct === dt || (ct.length >= 4 && dt.length >= 4 && (ct.includes(dt) || dt.includes(ct)))
                    )
                  );
                  if (!hasOverlap) {
                    warnings.push(
                      `⚠️ SKIPPED wrong-client doc from bundle: "${src.name}" appears to belong to "${docFirstName} ${docLastName}" (case names: ${caseNameTokens.join(", ")}). Please verify and remove from case folder.`
                    );
                    continue;
                  }
                }
              }
            } catch (e) {
              // Vision check failed — non-fatal, fall through and bundle the doc anyway
              // (better to over-include than to miss a legitimate doc due to vision flaw)
            }
          }

          fetchedFiles.push({ filename: src.name, bytes });
        } catch (e) {
          warnings.push(`Skipped from bundle (download failed): ${src.name}`);
        }
      }
      if (fetchedFiles.length > 0) {
        const bundled = await bundleClientInfo(fetchedFiles);
        const bundleName = buildStandardName("Client_Info_<First>_<Last>", first, last, "pdf");
        const uploaded = await uploadFileToDriveFolder({
          folderId: submissionFolderId,
          fileName: bundleName,
          fileBuffer: bundled,
          mimeType: "application/pdf",
        });
        filesAdded.push({ name: bundleName, link: uploaded.webViewLink, source: "generated" });
      } else {
        warnings.push("Client_Info bundle: all source files unreachable — skipped.");
      }
    } catch (e) {
      errors.push(`Client_Info bundle failed: ${(e as Error).message}`);
    }
  }

  return {
    ok: true,
    folderLink: subfolder.webViewLink,
    folderId: submissionFolderId,
    filesAdded,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
