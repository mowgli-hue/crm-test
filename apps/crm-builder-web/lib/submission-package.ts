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
import { getCaseReadiness, type CaseReadiness } from "@/lib/case-readiness";
import { CaseItem, DocumentItem } from "@/lib/models";
import {
  getOrCreateDriveSubfolder,
  uploadFileToDriveFolder,
  copyDriveFileToFolder,
  downloadDriveFileBytes,
  extractDriveFileId,
  extractDriveFolderId,
  deleteFilesByNameInFolder,
  listFilesInFolder,
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
  readiness?: CaseReadiness;    // shared staged readiness (same def the agent uses)
};

// Omit DocumentItem's own `category` (a narrow "general" | "result" union) before
// adding the richer DocCategory — otherwise the intersection collapses `category`
// to `never` and poisons the whole type (every `.driveFileId`/`.name` access then
// errors as "Property does not exist on type 'never'").
type CategorizedDoc = Omit<DocumentItem, "category"> & {
  category: DocCategory;
  driveFileId: string | null;
};

// NOTE: the old hard-coded REQUIRED_FOR_PGWP list lived here but was dead code
// (never referenced) AND it disagreed with the agent's notion of "complete."
// The single source of truth is now getCaseReadiness() in lib/case-readiness.ts,
// which both this package and the processing agent consult. Below we surface it
// on the result so "assemble submission" reports the same readiness the agent sees.

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function splitClientName(fullName: string): { first: string; last: string } {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Client", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// The fullest legal name for naming files/folders. The case.client field is
// often incomplete (e.g. "Lovepreet" with no surname → files become
// "Lovepreet_File"). The passport-derived intake usually has the real full name,
// so prefer that: intake.fullName, else given + family, else case.client.
function bestClientName(caseItem: CaseItem): string {
  const intake = (caseItem.pgwpIntake as Record<string, any>) || {};
  const full = String(intake.fullName || intake.full_name || "").trim();
  if (full.split(/\s+/).filter(Boolean).length >= 2) return full;
  const given = String(intake.firstName || intake.first_name || intake.givenName || intake.given_name || "").trim();
  const family = String(intake.lastName || intake.last_name || intake.familyName || intake.family_name || "").trim();
  if (given && family) return `${given} ${family}`;
  const c = String(caseItem.client || "").trim();
  if (c.split(/\s+/).filter(Boolean).length >= 2) return c;
  return [c || given, family].filter(Boolean).join(" ").trim() || c || "Client";
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

// ─────────────────────────────────────────────────────────────────────
// Shared OCR cache + throttle for the submission package run.
//
// Background: this file calls Claude vision OCR from THREE places:
//   1. Categorization fallback for "other"-named files
//   2. Wrong-client filter on top-level docs
//   3. Wrong-client filter on bundled docs
//
// Without coordination, the same doc gets OCR'd up to 3 times, and a
// case with 8 docs can fire 24+ vision calls in <30s. That blows
// past the 50K input-tokens-per-minute org rate limit (50K / ~10K per
// vision call ≈ 5 calls/min sustainable).
//
// This helper centralizes:
//   - Cache by driveFileId so each doc is OCR'd at most once per run.
//   - Throttle to keep us safely under the org rate limit.
//   - Hard budget cap so a 30-doc folder doesn't spiral.
//
// All three call sites should use `ocrOnce(doc, ...)` instead of calling
// extractDocumentFields directly.
// ─────────────────────────────────────────────────────────────────────
type OcrResult = Awaited<ReturnType<typeof import("@/lib/doc-ocr").extractDocumentFields>>;
class OcrThrottle {
  private cache = new Map<string, OcrResult>();
  private callCount = 0;
  private lastCallAt = 0;
  // Conservative: ~6 vision calls/min keeps us comfortably under 50K
  // input-tokens/min (large passport scans push 8-12K tokens per call).
  private static readonly MIN_INTERVAL_MS = 11_000; // ≈5.5 calls/min
  private static readonly HARD_BUDGET = 6;

  has(driveFileId: string): boolean {
    return this.cache.has(driveFileId);
  }

  get(driveFileId: string): OcrResult | undefined {
    return this.cache.get(driveFileId);
  }

  budgetRemaining(): number {
    return Math.max(0, OcrThrottle.HARD_BUDGET - this.callCount);
  }

  // Run OCR on the given bytes, caching the result by driveFileId.
  // Returns null if budget is exhausted (caller should treat as
  // "filter check skipped" — doc is included by default).
  async run(
    driveFileId: string,
    bytes: Buffer,
    mimeType: string,
    clientName: string,
  ): Promise<OcrResult | null> {
    if (this.cache.has(driveFileId)) return this.cache.get(driveFileId)!;
    if (this.callCount >= OcrThrottle.HARD_BUDGET) {
      console.warn(`OCR budget exhausted (${OcrThrottle.HARD_BUDGET} calls used) — skipping further OCR for this package run`);
      return null;
    }
    // Throttle: wait until enough time has passed since the last call
    const now = Date.now();
    const sinceLast = now - this.lastCallAt;
    if (this.lastCallAt > 0 && sinceLast < OcrThrottle.MIN_INTERVAL_MS) {
      const waitMs = OcrThrottle.MIN_INTERVAL_MS - sinceLast;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    this.lastCallAt = Date.now();
    this.callCount++;
    try {
      const { extractDocumentFields } = await import("@/lib/doc-ocr");
      const result = await extractDocumentFields(bytes, mimeType, clientName);
      this.cache.set(driveFileId, result);
      return result;
    } catch (e) {
      // On 429 or any failure, cache null to avoid retrying the same doc
      this.cache.set(driveFileId, null as any);
      console.warn(`OCR failed for ${driveFileId.slice(0, 12)}: ${(e as Error).message.slice(0, 100)}`);
      return null;
    }
  }
}

// Quick helper: does this filename clearly belong to the case client?
// If yes, we can skip the OCR-based wrong-client check entirely.
function filenameMatchesClient(filename: string, caseNameTokens: string[]): boolean {
  if (caseNameTokens.length === 0) return false;
  const fn = filename.toLowerCase();
  return caseNameTokens.some((t) => t.length >= 4 && fn.includes(t));
}

async function categorizeDocs(documents: DocumentItem[], ocr: OcrThrottle): Promise<CategorizedDoc[]> {
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
  // Uses the shared OcrThrottle so we don't blow the rate limit. The
  // results are cached so the wrong-client filter (later in this run)
  // can reuse them for free.
  const result: CategorizedDoc[] = [];

  for (const doc of initial) {
    if (doc.category !== "other" || !doc.driveFileId || ocr.budgetRemaining() === 0) {
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
      const extracted = await ocr.run(doc.driveFileId, bytes, mimeType, "Client");
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
          pal: "pal",
          proof_of_funds: "proof_of_funds",
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
  imm5257?: CategorizedDoc;
  imm5476?: CategorizedDoc;
  imm5709?: CategorizedDoc;
  imm0002?: CategorizedDoc;       // CIT-0002 citizenship application
  imm5444?: CategorizedDoc;       // PR card application
  imm5644?: CategorizedDoc;       // PR card document checklist
  submissionLetter?: CategorizedDoc;
  loa?: CategorizedDoc;          // current LOA — top-level for study permit applications
  pal?: CategorizedDoc;          // PAL — top-level for study permit applications
  proofOfFunds?: CategorizedDoc; // top-level for study permit applications
  prCard?: CategorizedDoc;             // PR card (citizenship)
  prLanding?: CategorizedDoc;          // IMM 1000 / 5292 / 5688 (citizenship)
  physicalPresenceCalc?: CategorizedDoc; // CIT-0407 (citizenship)
  secondaryId?: CategorizedDoc;        // driver's licence etc (citizenship)
  languageTest?: CategorizedDoc;       // most recent language test (citizenship)
  taxNotice?: CategorizedDoc;          // most recent tax NOA (citizenship — optional)
  olderTranscripts: CategorizedDoc[];
  studyPermits: CategorizedDoc[];
  workPermits: CategorizedDoc[];
  languageTests: CategorizedDoc[];
  loas: CategorizedDoc[];        // ALL LOAs (current + older school) — for PGWP bundle
  olderLoas: CategorizedDoc[];   // older LOAs only — for SP ext bundle (when changed school)
  medicals: CategorizedDoc[];
  bankStatements: CategorizedDoc[];
  proofsOfFunds: CategorizedDoc[];  // ALL proof-of-funds — older copies go in bundle
  oldPassports: CategorizedDoc[];   // older passports for citizenship bundle (5-yr coverage)
  taxNotices: CategorizedDoc[];     // ALL tax notices for citizenship
  policeCertificates: CategorizedDoc[]; // citizenship police clearances
} {
  // Sort by Drive modifiedTime descending (newest first) so .find() picks the
  // most recently modified file. Falls back to createdAt if modifiedTime isn't
  // set. Tie-breaker: prefer the LARGER file (a filled IMM5710 PDF is bigger
  // than a blank one, so size is a decent signal when modified-times are equal,
  // e.g. when staff bulk-uploaded multiple copies in the same upload session).
  // This is critical when there are duplicates (e.g. staff regenerating
  // IMM5710 — the latest one has the complete data).
  const byDateDesc = [...categorized].sort((a, b) => {
    const aT = (a as any).modifiedTime ? Date.parse((a as any).modifiedTime)
             : a.createdAt ? Date.parse(a.createdAt) : 0;
    const bT = (b as any).modifiedTime ? Date.parse((b as any).modifiedTime)
             : b.createdAt ? Date.parse(b.createdAt) : 0;
    if (bT !== aT) return bT - aT;
    // Tie on time → prefer larger file
    const aS = (a as any).size || 0;
    const bS = (b as any).size || 0;
    return bS - aS;
  });

  const passport = byDateDesc.find((d) => d.category === "passport");
  const photo = byDateDesc.find((d) => d.category === "photo");
  const completionLetter = byDateDesc.find((d) => d.category === "completion_letter");
  const submissionLetter = byDateDesc.find((d) => d.category === "submission_letter");

  // IMM forms: pick each by filename match. Use a permissive regex that
  // catches "IMM5710E", "IMM 5710", "imm-5710", etc. — \b word boundary
  // alone fails on "IMM5710" because both sides are alphanumeric.
  const immForms = byDateDesc.filter((d) => d.category === "imm_form");
  const imm5710 = immForms.find((d) => /5710[a-z]?(?![\d])/i.test(d.name));
  const imm5257 = immForms.find((d) => /5257[a-z]?(?![\d])/i.test(d.name));
  const imm5476 = immForms.find((d) => /5476[a-z]?(?![\d])/i.test(d.name));
  const imm5709 = immForms.find((d) => /5709[a-z]?(?![\d])/i.test(d.name));
  // PR card forms — IMM 5444 (application) + IMM 5644 (doc checklist)
  const imm5444 = immForms.find((d) => /5444[a-z]?(?![\d])/i.test(d.name));
  const imm5644 = immForms.find((d) => /5644[a-z]?(?![\d])/i.test(d.name));
  // Diagnostic: when there are duplicate IMM5710 files (real Newton case —
  // staff regenerates and the old version stays in Drive), log how many we
  // saw and which one we picked so we can verify the sort works.
  const imm5710Dupes = immForms.filter((d) => /5710[a-z]?(?![\d])/i.test(d.name));
  if (imm5710Dupes.length > 1 && imm5710) {
    const pickedSize = (imm5710 as any).size ? `${Math.round((imm5710 as any).size / 1024)}KB` : "?KB";
    const pickedTime = (imm5710 as any).modifiedTime || imm5710.createdAt || "?";
    console.log(`[IMM5710 picker] ${imm5710Dupes.length} dupes found, picked "${imm5710.name}" (modified=${pickedTime}, size=${pickedSize})`);
  }
  // CIT-0002 / CIT 0002 — adult citizenship application form
  const imm0002 = byDateDesc.find((d) => /\bCIT[\s_-]?0002\b/i.test(d.name));

  // Transcripts: newest = current; older = into bundle
  const allTranscripts = byDateDesc.filter((d) => d.category === "transcript");
  const transcript = allTranscripts[0];
  const olderTranscripts = allTranscripts.slice(1);

  // LOAs: newest = current school's LOA (top-level for SP); older = bundled
  const allLoas = byDateDesc.filter((d) => d.category === "loa");
  const loa = allLoas[0];
  const olderLoas = allLoas.slice(1);

  // PAL: pick the most recent
  const pal = byDateDesc.find((d) => d.category === "pal");

  // Proof of funds: most recent for top-level, older copies into bundle
  const proofsOfFunds = byDateDesc.filter((d) => d.category === "proof_of_funds");
  const proofOfFunds = proofsOfFunds[0];

  const studyPermits = byDateDesc.filter((d) => d.category === "study_permit");
  const workPermits = byDateDesc.filter((d) => d.category === "work_permit");
  const languageTestsAll = byDateDesc.filter((d) => d.category === "language_test");
  const languageTest = languageTestsAll[0];   // most recent for citizenship top-level
  const languageTests = languageTestsAll;     // ALL — for bundles
  const loas = allLoas;            // PGWP bundle wants ALL LOAs
  const medicals = byDateDesc.filter((d) => d.category === "medical");
  const bankStatements = byDateDesc.filter((d) => d.category === "bank_statement");

  // Citizenship-specific docs
  const prCard = byDateDesc.find((d) => d.category === "pr_card");
  const prLanding = byDateDesc.find((d) => d.category === "pr_landing");
  const physicalPresenceCalc = byDateDesc.find((d) => d.category === "physical_presence_calc");
  const secondaryId = byDateDesc.find((d) => d.category === "secondary_id");
  const taxNotices = byDateDesc.filter((d) => d.category === "tax_notice");
  const taxNotice = taxNotices[0];
  const policeCertificates = byDateDesc.filter((d) => d.category === "police_certificate");

  // Older passports: any passport scan that isn't the most recent. For citizenship
  // we need 5 years of passport coverage so older ones go in the bundle.
  const allPassports = byDateDesc.filter((d) => d.category === "passport");
  const oldPassports = allPassports.slice(1);

  return {
    passport, photo, transcript, completionLetter,
    imm5710, imm5257, imm5476, imm5709, imm0002, imm5444, imm5644, submissionLetter,
    loa, pal, proofOfFunds,
    prCard, prLanding, physicalPresenceCalc, secondaryId,
    languageTest, taxNotice,
    olderTranscripts, studyPermits, workPermits, languageTests,
    loas, olderLoas, medicals, bankStatements, proofsOfFunds,
    oldPassports, taxNotices, policeCertificates,
  };
}

function validateRequired(
  primary: ReturnType<typeof selectPrimaryDocs>,
  profile: FormProfile
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  // Profile.topLevel describes the docs we expect to copy. Each entry's
  // sourceKey points at primary[key]. If that's empty/falsy, the doc is
  // missing — surface as a warning (informational only).
  for (const entry of profile.topLevel) {
    const val = (primary as any)[entry.sourceKey];
    if (!val) {
      // Find a matching human-readable label from profile.recommended; fall
      // back to the source key if no label found.
      const label = profile.recommended.find((r) =>
        r.toLowerCase().includes(String(entry.sourceKey).toLowerCase())
      ) || String(entry.sourceKey);
      missing.push(label);
    }
  }
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

// ── Form profiles ──
//
// Each form type has its own scope of what goes top-level vs into the
// Client_Info bundle. PGWP needs transcripts + completion letter + IELTS
// + rep letter; TRV is a much smaller submission with just passport, photo,
// 5257, 5476, and (optionally) the current permit + proof of funds.
//
// Adding a new form: define a profile here and the assembler will use it.
// Anything not on a profile (e.g., medical) is ignored unless we explicitly
// list it in `bundleCategories`.
type FormProfile = {
  // Top-level templates: each entry = { source key on `primary`, filename template }.
  // Keys must exist in selectPrimaryDocs return type.
  topLevel: Array<{
    sourceKey: keyof ReturnType<typeof selectPrimaryDocs>;
    template: string;
  }>;
  // Categories that go INTO the Client_Info bundle (in this order).
  // Empty array = no Client_Info bundle at all.
  bundleCategories: Array<keyof ReturnType<typeof selectPrimaryDocs>>;
  // Required for "missing" warnings (informational only — never blocking).
  recommended: string[];
  // Display name for logs
  name: string;
  // When true, the assembler does NOT generate the IMM5476. Used by TRV, where
  // the forms (5476 / 5257) are handled separately and the automation only
  // arranges the supporting documents.
  skipRepForm?: boolean;
  // When true, any uploaded doc the categorizer marked "other" (and that isn't
  // an internal/system file) is also pulled into the Client_Info bundle — so
  // form-specific supporting docs that have no dedicated category still land in
  // the submission folder instead of only being flagged. Used by SOWP, whose
  // core evidence (marriage certificate, proof of relation, principal's
  // employment letter + pay stubs, the client-info file) is all "other".
  bundleOthers?: boolean;
  // When set, the WHOLE submission is a single merged "Client Information" PDF
  // built from these parts IN THIS ORDER — nothing else is copied/bundled.
  // Used by TRV (inside Canada): passport (with stamps) → digital photo →
  // current permit → IMM5476. Tokens: "passport" | "photo" | "currentPermit"
  // | "imm5257" | "imm5476" (imm5476 is generated inline; the rest are uploads).
  clientInfoMerge?: Array<"passport" | "photo" | "currentPermit" | "imm5257" | "imm5476">;
};

const PROFILE_PGWP: FormProfile = {
  name: "PGWP",
  topLevel: [
    { sourceKey: "passport",         template: "Passport_<First>_<Last>" },
    { sourceKey: "photo",            template: "Photo_<First>_<Last>" },
    { sourceKey: "transcript",       template: "Transcript_<First>_<Last>" },
    { sourceKey: "completionLetter", template: "Completion_Letter_<First>_<Last>" },
    { sourceKey: "languageTest",     template: "Language_Test_<First>_<Last>" },
    { sourceKey: "imm5710",          template: "IMM5710e_<First>_<Last>" },
    { sourceKey: "submissionLetter", template: "Representative_Submission_Letter_<First>_<Last>" },
  ],
  // Language test now stands alone at top level (per Newton's PGWP layout), so
  // it's no longer in the Client_Info bundle.
  bundleCategories: [
    "studyPermits", "workPermits",
    "olderTranscripts", "loas", "medicals",
  ],
  recommended: [
    "Passport", "Digital photo", "Official transcript",
    "Completion letter", "IMM5710 (use 'Generate Forms')",
    "Representative Submission Letter (use letter generator)",
  ],
};

const PROFILE_STUDY_PERMIT_EXTENSION: FormProfile = {
  name: "Study Permit Extension",
  topLevel: [
    // Passport, photo, generated forms — same as other profiles
    { sourceKey: "passport",         template: "Passport_<First>_<Last>" },
    { sourceKey: "photo",            template: "Photo_<First>_<Last>" },
    { sourceKey: "imm5709",          template: "IMM5709e_<First>_<Last>" },
    // SP-specific top-level extras (matches Newton's Sneha Gupta reference layout):
    { sourceKey: "loa",              template: "LOA_<First>_<Last>" },
    { sourceKey: "pal",              template: "PAL_<First>_<Last>" },
    { sourceKey: "proofOfFunds",     template: "Proof_of_Funds_<First>_<Last>" },
    { sourceKey: "submissionLetter", template: "Representative_Submission_Letter_<First>_<Last>" },
    // 5476 generated inline below
  ],
  bundleCategories: [
    // Per Newton SOP: their permit + old school docs (transcripts of same college,
    // supporting docs) basically goes inside Client_Info.
    "studyPermits",     // current + previous permits
    "olderTranscripts", // transcripts (old school if changed; or current school's prior years)
    "olderLoas",        // older LOAs only (current LOA is top-level)
  ],
  recommended: [
    "Passport", "Digital photo", "IMM5709 (use 'Generate Forms')",
    "Letter of Acceptance (LOA) from school",
    "Provincial Attestation Letter (PAL) — required for most undergrads",
    "Proof of funds (bank letter / GIC / sponsorship)",
    "Representative Submission Letter (use letter generator)",
  ],
};

const PROFILE_TRV: FormProfile = {
  name: "TRV",
  // The automation only arranges the SUPPORTING documents for a TRV — the forms
  // (IMM5476 / IMM5257) are handled separately (cert-safe fill) and are NOT
  // produced here. Output: Passport + Digital Photo as their own files, plus a
  // Client Information bundle (current permit -> proof of funds).
  topLevel: [
    { sourceKey: "passport", template: "Passport_<First>_<Last>" },
    { sourceKey: "photo",    template: "Digital_Photo_<First>_<Last>" },
  ],
  bundleCategories: ["studyPermits", "workPermits", "proofsOfFunds"],
  skipRepForm: true,
  recommended: [
    "Passport (bio page + all stamped pages)",
    "Digital photo",
    "Current permit (study/work) — goes into Client Information",
    "Proof of funds (bank statement) — goes into Client Information",
  ],
};

const PROFILE_CITIZENSHIP: FormProfile = {
  name: "Citizenship",
  topLevel: [
    // Photo + IDs go up top — what IRCC sees first when staff opens the package
    { sourceKey: "photo",                template: "Citizenship_Photo_<First>_<Last>" },
    { sourceKey: "passport",             template: "Passport_<First>_<Last>" },
    { sourceKey: "prCard",               template: "PR_Card_<First>_<Last>" },
    { sourceKey: "prLanding",            template: "PR_Landing_Document_<First>_<Last>" },
    { sourceKey: "secondaryId",          template: "Secondary_ID_<First>_<Last>" },
    // Citizenship-specific top-level
    { sourceKey: "imm0002",              template: "CIT0002_Application_<First>_<Last>" },
    { sourceKey: "physicalPresenceCalc", template: "Physical_Presence_Calculator_<First>_<Last>" },
    { sourceKey: "languageTest",         template: "Language_Proof_<First>_<Last>" },
    { sourceKey: "submissionLetter",     template: "Representative_Submission_Letter_<First>_<Last>" },
    // 5476 generated inline below — same as other profiles
  ],
  bundleCategories: [
    // Older passports for the 5-year coverage requirement
    "oldPassports",
    // Tax filing supporting docs (NOAs, Option C printouts) — optional but speeds processing
    "taxNotices",
    // Foreign police certificates if any country had 183+ day residence
    "policeCertificates",
    // Any other supporting docs uploaded
  ],
  recommended: [
    "Current passport (bio + all stamped pages)",
    "PR card (both sides — must be valid)",
    "PR landing document (IMM 1000 / 5292 / 5688)",
    "Secondary photo ID (driver's licence / health card / provincial ID)",
    "Two citizenship-format photos",
    "CIT-0002 Application form (validated, signed)",
    "Physical Presence Calculator printout (CIT-0407)",
    "Language proof — IELTS / CELPIP-G / TEF / TCF results, OR English/French diploma",
    "Representative Submission Letter (use letter generator)",
  ],
};

// PR Card Renewal — IMM 5444 + IMM 5644. Smaller scope than citizenship:
// no language proof, no CIT-0002, but adds NOAs/T4s/address proofs as
// residency evidence (for the 730-day obligation). Photo specs are
// PR-CARD-specific (50mm × 70mm) — different from work-permit photos.
const PROFILE_PR_CARD: FormProfile = {
  name: "PR Card Renewal",
  topLevel: [
    // Photo + IDs first (what IRCC sees on opening the package)
    { sourceKey: "photo",            template: "PR_Card_Photo_<First>_<Last>" },
    { sourceKey: "passport",         template: "Passport_<First>_<Last>" },
    { sourceKey: "prCard",           template: "Current_PR_Card_<First>_<Last>" },
    { sourceKey: "prLanding",        template: "PR_Landing_Document_<First>_<Last>" },
    { sourceKey: "secondaryId",      template: "Secondary_ID_<First>_<Last>" },
    // PR-card-specific generated forms
    { sourceKey: "imm5444",          template: "IMM5444e_<First>_<Last>" },
    { sourceKey: "imm5644",          template: "IMM5644e_Document_Checklist_<First>_<Last>" },
    { sourceKey: "submissionLetter", template: "Representative_Submission_Letter_<First>_<Last>" },
    // 5476 generated inline below — same as other profiles
  ],
  bundleCategories: [
    // Older passports for 5-year travel-history verification
    "oldPassports",
    // CRA Notices of Assessment — primary residency-day evidence
    "taxNotices",
    // Address proofs (utility bills, lease, bank statements) bundle
    // No separate "addressProofs" array exists in CategorizedDoc yet — falls into "others"
    // until we add it. For now staff drops these into the case folder and the Drive scan
    // augment picks them up; they'll appear in the misc bundle.
  ],
  recommended: [
    "Current/expiring PR card (FRONT and BACK)",
    "Current passport (bio + all stamped pages)",
    "Old passports from last 5 years (with stamps)",
    "PR landing document (IMM 1000 / 5292 / 5688 / COPR)",
    "Secondary government ID (driver's licence / health card)",
    "2 PR-card-format photos (50mm × 70mm — NOT work permit specs)",
    "CRA Notices of Assessment (last 3 years)",
    "Address proof (utility bills / lease / bank statements)",
    "IMM 5444 Application (validated, signed)",
    "IMM 5644 Document Checklist",
    "Representative Submission Letter (use letter generator)",
  ],
};

// SOWP — Spousal Open Work Permit. Applicant is the SPOUSE; the package
// must include the principal partner's status proof + employment proof
// (which doesn't apply to PGWP / generic work permits). Same form
// (IMM5710 inside Canada / IMM1295 outside) but a different doc set.
const PROFILE_SOWP: FormProfile = {
  name: "SOWP",
  topLevel: [
    { sourceKey: "passport",         template: "Passport_<First>_<Last>" },
    { sourceKey: "photo",            template: "Photo_<First>_<Last>" },
    // IMM 5710 for in-Canada applicants (most common). For outside-Canada,
    // staff would use IMM1295 (not yet auto-generated).
    { sourceKey: "imm5710",          template: "IMM5710e_<First>_<Last>" },
    { sourceKey: "submissionLetter", template: "Representative_Submission_Letter_<First>_<Last>" },
  ],
  bundleCategories: [
    // Spouse's existing permits + supporting docs go in the bundle
    "studyPermits", "workPermits", "languageTests",
  ],
  // SOWP's core evidence — marriage certificate, proof of relation, the
  // principal's employment letter + pay stubs, relationship photos, and the
  // client-info file — all categorize as "other". Pull them into the Client_Info
  // bundle so the assembled folder actually contains them instead of an
  // almost-empty package + a "review these manually" warning.
  bundleOthers: true,
  recommended: [
    "Applicant's passport (bio + stamped pages)",
    "Applicant's digital photo",
    "Marriage certificate (or 12-month cohabitation evidence)",
    "Principal partner's current work permit / study permit / PGWP",
    "Principal partner's employment letter (NOC, duties, salary, hours)",
    "Principal partner's recent pay stubs",
    "Relationship evidence (photos, joint accounts, lease)",
    "IMM5710 (in Canada) — use 'Generate Forms'",
    "IMM5476 — Use of Representative",
    "Representative Submission Letter",
  ],
};

// VOWP — Vulnerable Worker Open Work Permit (IMM5710 inside Canada, fee-exempt,
// online only). For workers experiencing or at risk of abuse from their employer.
// Deliberately a MINIMAL set: passport, digital photo, and a Client Information
// bundle (current permit + proof of abuse/risk + the client-info file + any other
// supporting docs). It must NOT inherit the PGWP profile, which would wrongly
// demand transcripts + a completion letter a vulnerable worker doesn't have.
const PROFILE_VOWP: FormProfile = {
  name: "VOWP",
  topLevel: [
    { sourceKey: "passport",         template: "Passport_<First>_<Last>" },
    { sourceKey: "photo",            template: "Photo_<First>_<Last>" },
    // Forms (generated/filled elsewhere) — copied if already in the case folder.
    { sourceKey: "imm5710",          template: "IMM5710e_<First>_<Last>" },
    { sourceKey: "submissionLetter", template: "Representative_Submission_Letter_<First>_<Last>" },
  ],
  // Current/most-recent permit goes into Client Information; everything else
  // VOWP-specific (proof of abuse, employer docs, client-info file) is "other"
  // and is pulled in via bundleOthers below.
  bundleCategories: ["workPermits", "studyPermits"],
  bundleOthers: true,
  recommended: [
    "Applicant's passport (bio + stamped pages)",
    "Digital photo",
    "Proof of abuse or risk of abuse (core VOWP evidence) — goes into Client Information",
    "Current / most recent work permit — goes into Client Information",
    "IMM5710 (in Canada) — use 'Generate Forms'",
    "IMM5476 — Use of Representative",
    "Representative Submission Letter",
  ],
};

// Future profiles: PROFILE_WORK_PERMIT_LMIA, etc.

function pickProfile(formType: string): FormProfile {
  const ft = (formType || "").toLowerCase();
  if (ft.includes("trv") || ft.includes("visitor visa") || ft.includes("super visa")) {
    return PROFILE_TRV;
  }
  // PR card renewal — must come BEFORE citizenship branch because both
  // include "pr card" patterns. PR card is its own profile (730-day
  // obligation, $50 fee, IMM 5444) — different from citizenship.
  if (
    ft.includes("pr card renewal") ||
    ft.includes("pr card replacement") ||
    ft.includes("permanent resident card") ||
    ft.includes("imm5444") ||
    ft.includes("imm 5444") ||
    (ft.includes("pr card") && !ft.includes("citizenship"))
  ) {
    return PROFILE_PR_CARD;
  }
  // Citizenship application — adult grant
  if (ft.includes("citizenship")) {
    return PROFILE_CITIZENSHIP;
  }
  // SOWP — must come BEFORE generic study permit / PGWP catch-alls.
  // SOWP cases include "spousal open work permit" or "sowp" in formType.
  if (
    ft.includes("sowp") ||
    ft.includes("spousal open work permit") ||
    ft.includes("spousal work permit") ||
    (ft.includes("open work permit") && (ft.includes("spous") || ft.includes("partner")))
  ) {
    return PROFILE_SOWP;
  }
  // VOWP — Vulnerable Worker OWP. Must come BEFORE the default PGWP catch-all,
  // otherwise it inherits the PGWP scope (transcripts + completion letter).
  if (ft.includes("vowp") || ft.includes("vulnerable")) {
    return PROFILE_VOWP;
  }
  // Study permit extension OR new study permit (inside Canada uses 5709)
  if (ft.includes("study permit") || ft.includes("study permit extension") || ft.includes("study extension")) {
    return PROFILE_STUDY_PERMIT_EXTENSION;
  }
  // Default: PGWP / BOWP / VOWP / LMIA / generic work permit
  return PROFILE_PGWP;
}

export async function assemblePgwpSubmissionPackage(
  companyId: string,
  caseId: string
): Promise<SubmissionPackageResult> {
  const caseItem = await getCase(companyId, caseId);
  if (!caseItem) return { ok: false, errors: [`Case ${caseId} not found`] };

  // Shared OCR throttle: cache + budget + rate-limit avoidance for ALL
  // OCR calls during this package run (categorization fallback + 2 wrong-
  // client filters). Without this, the ~50K-tokens/min org limit gets hit
  // when a case has 6+ docs.
  const ocr = new OcrThrottle();

  // Step 1: load documents — from BOTH the `documents` table AND a live Drive
  // folder scan, then merge.
  //
  // Why both: the documents table tracks files registered through the CRM
  // (WhatsApp uploads, "Generate Forms" output, "Send Email" attachments,
  // etc.). But staff often drag-and-drop files directly into the case's
  // Drive folder — those don't get registered in the table. Without scanning
  // Drive, the package would miss them. Real bug from CASE-1401 (Gagan):
  // staff put Passport, Photo, Completion Letter into Drive directly, the
  // documents table only had 8 entries, package missed 4 important docs.
  const docsFromTable = await listDocuments(companyId, caseId);
  let docs = docsFromTable;
  // Map of driveFileId → { modifiedTime, size } from Drive — used later
  // for tie-breaking when picking among duplicate IMM forms / passports.
  const driveMeta = new Map<string, { modifiedTime?: string; size?: number }>();
  try {
    const caseDriveId = getCaseDriveFolderId(caseItem);
    if (caseDriveId) {
      const driveFiles = await listFilesInFolder(caseDriveId);
      // Index every Drive file's modified time so we can sort by it.
      for (const f of driveFiles) {
        driveMeta.set(f.id, { modifiedTime: f.modifiedTime, size: f.size });
      }
      // De-dupe: existing docsFromTable wins (it has a stable id + status +
      // version info). Anything in Drive but NOT in the table is added as a
      // synthetic DocumentItem with the Drive file id encoded as a viewLink.
      const tableDriveIds = new Set(
        docsFromTable
          .map((d) => extractDriveFileId(d.link))
          .filter((id): id is string => !!id),
      );
      const newDriveOnly = driveFiles
        .filter((f) => !tableDriveIds.has(f.id))
        .map((f) => ({
          id: `drive-only-${f.id}`,
          companyId,
          caseId,
          name: f.name,
          fileType: f.mimeType,
          status: "received" as const,
          link: `https://drive.google.com/file/d/${f.id}/view`,
          // Use Drive's modifiedTime as createdAt so sort-by-recency works
          createdAt: f.modifiedTime || new Date().toISOString(),
        }));
      if (newDriveOnly.length > 0) {
        console.log(`[submission ${caseId}] step 1: +${newDriveOnly.length} files found in Drive but NOT in documents table — including them`);
        docs = [...docsFromTable, ...newDriveOnly];
      }
    }
  } catch (e) {
    // Drive scan failed — proceed with just the documents table.
    console.warn(`[submission ${caseId}] Drive scan failed (continuing with table only): ${(e as Error).message.slice(0, 100)}`);
  }

  // Shared readiness — the SAME definition the processing agent consults (via
  // the /readiness API), so "assemble submission" and the agent never disagree
  // on what's complete. Computed against the reconciled doc list (table + Drive).
  const readiness = getCaseReadiness(caseItem, docs as unknown as Parameters<typeof getCaseReadiness>[1]);
  if (!readiness.submissionReady) {
    console.warn(
      `[submission ${caseId}] not submission-ready per shared check — ` +
      `intake missing ${readiness.intake.missing.length}, ` +
      `client docs missing ${readiness.clientDocs.missing.length}, ` +
      `forms missing ${readiness.forms.missing.length}`,
    );
  }

  const categorized = await categorizeDocs(docs, ocr);
  // Augment categorized docs with Drive modifiedTime so primary-doc selection
  // can pick the most recently regenerated version when there are duplicates
  // (real bug from CASE-1401: 5 copies of IMM5710E in folder, picker grabbed
  // an old blank one because we had no modifiedTime to sort by).
  for (const doc of categorized) {
    if (doc.driveFileId && driveMeta.has(doc.driveFileId)) {
      const meta = driveMeta.get(doc.driveFileId)!;
      (doc as any).modifiedTime = meta.modifiedTime;
      (doc as any).size = meta.size;
    }
  }
  const primary = selectPrimaryDocs(categorized);

  // Pick form profile based on case formType. PGWP/SOWP/work permit/study
  // permit ext → PGWP profile (full submission set). TRV/visitor visa →
  // TRV profile (smaller scope: passport, photo, 5257, 5476, current permit).
  const profile = pickProfile(caseItem.formType || "");
  console.log(`📦 Submission package using ${profile.name} profile for case ${caseId} (formType: "${caseItem.formType}")`);
  // Log scalar primary slots (skip arrays — those are for bundles)
  const scalarPrimary = ["passport","photo","transcript","completionLetter","imm5710","imm5257","imm5476","imm5709","submissionLetter","loa","pal","proofOfFunds","prCard","prLanding","physicalPresenceCalc","secondaryId","languageTest","taxNotice"]
    .filter(k => (primary as any)[k])
    .map(k => `${k}="${((primary as any)[k] as CategorizedDoc).name.slice(0,40)}"`)
    .join(", ");
  console.log(`[submission ${caseId}] step 1: ${docs.length} docs in folder, ${categorized.length} categorized. Primary: ${scalarPrimary || "(none)"}`);
  // Log each categorized doc so we see what types got detected
  console.log(`[submission ${caseId}] doc categories: ${categorized.map(d => `${d.name.slice(0,30)}=${d.category}`).join(", ")}`);

  // Step 2: validate required docs (assemble what's available; surface missing
  // ones as warnings rather than blocking — per scope revision: "create whatever
  // is available", staff prefers a partial package they can review over an
  // error message).
  const validation = validateRequired(primary, profile);
  const initialWarnings: string[] = [];
  if (!validation.ok) {
    initialWarnings.push(
      `Missing recommended docs (package generated anyway): ${validation.missing.join("; ")}`
    );
    console.log(`[submission ${caseId}] step 2: missing recommended docs: ${validation.missing.join(", ")}`);
  }

  // Step 3: resolve target Drive folder. We use the case's docsUploadLink folder
  // as the parent and create/reuse a "Submission_<First>_<Last>" subfolder inside.
  const caseFolderId = getCaseDriveFolderId(caseItem);
  if (!caseFolderId) {
    console.log(`[submission ${caseId}] ABORT — no Drive folder set for case`);
    return {
      ok: false,
      errors: ["No Drive folder set for this case. Generate Forms first to set up Drive folders."],
    };
  }
  console.log(`[submission ${caseId}] step 3: resolving target Drive folder ${caseFolderId.slice(0, 12)}...`);

  const { first, last } = splitClientName(bestClientName(caseItem));
  // Folder named "Client Information - <Full Name>" per Newton's submission layout.
  const subfolderName = `Client Information - ${[first, last].filter(Boolean).join(" ")}`
    .replace(/[\/\\<>:"|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const subfolder = await getOrCreateDriveSubfolder(caseFolderId, subfolderName);
  const submissionFolderId = subfolder.id;
  console.log(`[submission ${caseId}] step 3 done: subfolder "${subfolderName}" id=${submissionFolderId.slice(0, 12)}...`);

  const errors: string[] = [];
  const filesAdded: SubmissionPackageResult["filesAdded"] = [];
  const warnings: string[] = [...initialWarnings];

  // ── TRV special case: ONE merged "Client Information" PDF ──
  // Newton's inside-Canada TRV/visitor submission is a single Client
  // Information document containing, in order: passport (with stamps), digital
  // photo, current permit, and the generated IMM5476 — nothing else. (Per the
  // RCIC: "for TRV it's Client Information — current permit, digital photo,
  // passport with stamps, 5476, that's all.") We build that one PDF and return.
  if (profile.clientInfoMerge?.length) {
    const mergeFiles: Array<{ filename: string; bytes: Buffer }> = [];
    const missing: string[] = [];
    for (const key of profile.clientInfoMerge) {
      try {
        if (key === "imm5476") {
          const imm5476Bytes = await generateImm5476(buildImm5476Data(caseItem));
          mergeFiles.push({ filename: "IMM5476.pdf", bytes: imm5476Bytes });
          continue;
        }
        let doc: CategorizedDoc | undefined;
        if (key === "passport") doc = primary.passport;
        else if (key === "photo") doc = primary.photo;
        else if (key === "imm5257") doc = primary.imm5257;
        else if (key === "currentPermit") doc = primary.studyPermits?.[0] || primary.workPermits?.[0];
        if (!doc?.driveFileId) { missing.push(key); continue; }
        const bytes = await downloadDriveFileBytes(doc.driveFileId);
        mergeFiles.push({ filename: doc.name, bytes });
      } catch (e) {
        missing.push(key);
        warnings.push(`Client Information: could not add ${key} — ${(e as Error).message.slice(0, 80)}`);
      }
    }
    if (mergeFiles.length === 0) {
      return { ok: false, errors: ["Client Information: none of passport / photo / current permit / IMM5476 were available — upload them and retry."], warnings };
    }
    if (missing.length) {
      warnings.push(`Client Information built, but these parts were missing (add manually if needed): ${missing.join(", ")}.`);
    }
    try {
      const merged = await bundleClientInfo(mergeFiles);
      const ciName = buildStandardName("Client_Information_<First>_<Last>", first, last, "pdf");
      const uploaded = await uploadFileToDriveFolder({
        folderId: submissionFolderId, fileName: ciName, fileBuffer: merged, mimeType: "application/pdf",
      });
      filesAdded.push({ name: ciName, link: uploaded.webViewLink, source: "generated" });
      console.log(`[submission ${caseId}] TRV Client Information built from ${mergeFiles.length} part(s); missing: ${missing.join(",") || "none"}`);
    } catch (e) {
      return { ok: false, errors: [`Client Information merge failed: ${(e as Error).message}`], warnings };
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

  // Step 4: copy top-level docs with standardized names. Driven by the
  // form profile selected above — each entry maps a primary doc slot to
  // its standardized filename template.
  //
  // Why profile-driven: PGWP needs passport+photo+transcript+letter+forms;
  // TRV needs only passport+photo+5257. Hardcoding here would bundle PGWP
  // docs into every TRV submission (wrong scope). The profile keeps each
  // form type's scope clean.
  type CopyJob = { doc: CategorizedDoc; template: string; ext?: string };
  const copyJobs: CopyJob[] = [];
  for (const entry of profile.topLevel) {
    const doc = (primary as any)[entry.sourceKey] as CategorizedDoc | undefined;
    if (doc) {
      copyJobs.push({ doc, template: entry.template });
    }
  }

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
    const filteredJobs: CopyJob[] = [];
    for (const job of copyJobs) {
      // Skip OCR check for generated outputs (IMM forms have field overlays
      // that confuse OCR, photos are face-only, rep letter has the Newton
      // representative's name not the client's).
      const skipNameCheck =
        /\bIMM\d{4}/i.test(job.template) ||
        job.template.includes("Photo") ||
        job.template.includes("Submission_Letter") ||
        !job.doc.driveFileId;
      if (skipNameCheck) {
        filteredJobs.push(job);
        continue;
      }
      // Fast-path: if filename already contains the client's name, skip OCR.
      // Saves a vision call per matching doc — most PGWP cases hit this path
      // because client uploads are auto-renamed "<Client> - Document.ext".
      if (filenameMatchesClient(job.doc.name, caseNameTokensTop)) {
        filteredJobs.push(job);
        continue;
      }
      try {
        // driveFileId is guaranteed non-null here: skipNameCheck above includes
        // `!job.doc.driveFileId`, so a null id already pushed+continued.
        const bytes = await downloadDriveFileBytes(job.doc.driveFileId!);
        if (bytes.length >= 10 * 1024 * 1024) {
          filteredJobs.push(job);
          continue;
        }
        const mimeType = job.doc.name.toLowerCase().endsWith(".pdf") ? "application/pdf" :
          job.doc.name.toLowerCase().match(/\.(jpe?g|png|webp)$/) ? `image/${job.doc.name.toLowerCase().match(/\.(jpe?g|png|webp)$/)![1].replace("jpg", "jpeg")}` :
          "application/pdf";
        const extracted = await ocr.run(job.doc.driveFileId!, bytes, mimeType, caseItem.client || "Client");
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
        console.log(`[submission ${caseId}] ✓ converted+uploaded: ${job.newName}`);
      } else {
        // Same-format: server-side Drive copy (fast)
        const copied = await copyDriveFileToFolder({
          sourceFileId: job.doc.driveFileId,
          newName: job.newName,
          targetFolderId: submissionFolderId,
        });
        filesAdded.push({ name: job.newName, link: copied.webViewLink, source: "copied" });
        console.log(`[submission ${caseId}] ✓ copied: ${job.newName}`);
      }
    } catch (e) {
      errors.push(`Failed for ${job.doc.name}: ${(e as Error).message}`);
      console.error(`[submission ${caseId}] ✗ failed for ${job.doc.name}: ${(e as Error).message}`);
    }
  }

  // Step 5: generate IMM5476 and upload to subfolder.
  // Skipped for profiles (e.g. TRV) where the forms are handled separately and
  // the automation only arranges the supporting documents.
  if (!profile.skipRepForm) {
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
  }

  // Step 6: bundle Client_Info per the form profile's bundleCategories.
  //
  // Why profile-driven: PGWP bundle = study/work permits + IELTS + older
  // transcripts + LOAs + medical. TRV bundle is much smaller — just the
  // current permit (for TRV stamp on passport) and optionally bank
  // statements (proof of funds). Each profile defines its own scope.
  //
  // Note: docs categorized as "other" are NEVER bundled regardless of
  // profile — staff handles those manually.
  const bundleSources: CategorizedDoc[] = [];
  for (const cat of profile.bundleCategories) {
    const docs = (primary as any)[cat] as CategorizedDoc[] | undefined;
    if (Array.isArray(docs) && docs.length > 0) {
      bundleSources.push(...docs);
    }
  }

  // bundleOthers (SOWP): also pull in any "other"-category uploads that have no
  // dedicated slot — marriage certificate, proof of relation, principal's
  // employment letter + pay stubs, relationship photos, the client-info file —
  // so they actually land in the folder. We skip anything already placed at top
  // level, internal/system files, and non-document files. The per-file
  // wrong-client filter below still runs on these, same as any other bundle doc.
  if (profile.bundleOthers) {
    const INTERNAL_BUNDLE_RE = /intake answers|chat|conversation|^notes?\b|\.txt$|whatsapp/i;
    const alreadyTopLevel = new Set(
      copyJobs.map((j) => j.doc.driveFileId).filter((id): id is string => !!id),
    );
    const alreadyInBundle = new Set(
      bundleSources.map((d) => d.driveFileId).filter((id): id is string => !!id),
    );
    for (const d of categorized) {
      if (
        d.category === "other" &&
        d.driveFileId &&
        !alreadyTopLevel.has(d.driveFileId) &&
        !alreadyInBundle.has(d.driveFileId) &&
        /\.(pdf|jpe?g|png|webp|heic)$/i.test(String(d.name || "")) &&
        !INTERNAL_BUNDLE_RE.test(String(d.name || ""))
      ) {
        bundleSources.push(d);
        alreadyInBundle.add(d.driveFileId);
      }
    }
  }

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
          //
          // Fast-path: if filename already contains the client's name, skip OCR.
          // Most uploads from the WhatsApp pipeline are auto-renamed to include
          // the client name, so this avoids spending OCR budget on obvious matches.
          const filenameOk = filenameMatchesClient(src.name, caseNameTokens);
          if (!filenameOk && caseNameTokens.length >= 1 && bytes.length < 10 * 1024 * 1024) {
            try {
              const mimeType = src.name.toLowerCase().endsWith(".pdf") ? "application/pdf" :
                src.name.toLowerCase().match(/\.(jpe?g|png|webp)$/) ? `image/${src.name.toLowerCase().match(/\.(jpe?g|png|webp)$/)![1].replace("jpg", "jpeg")}` :
                "application/pdf";
              const extracted = await ocr.run(src.driveFileId, bytes, mimeType, caseItem.client || "Client");
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

  // Step 7: SAFETY NET — copy EVERY uploaded doc that wasn't already placed.
  //
  // The profile-driven steps above only copy/bundle docs that matched a known
  // category. Anything the categorizer marked "other" (a TRV invitation letter,
  // purpose-of-visit letter, proof of funds/ties, employment letter, etc.) was
  // silently dropped — so a case with ALL its supporting docs uploaded came out
  // of the package missing half of them. Real bug: CASE-1612 (Mehak, TRV) had
  // every doc but the package only carried the narrow TRV profile set.
  //
  // Here we copy any uploaded doc not already included into the submission
  // folder (original format preserved, "Supporting - <name>"), so NOTHING the
  // client uploaded is ever left out of the submission. Over-including is safe —
  // staff review the folder — whereas dropping a doc is not.
  // The submission folder must contain ONLY the documents that get submitted —
  // the curated, ordered set above (forms + supporting docs + Client_Info bundle).
  // We do NOT dump every uploaded file in here (that produced duplicates and
  // internal files like "Intake Answers.txt" in the folder). Instead, if there
  // are uploaded docs the profile didn't place AND they look like real, relevant
  // documents (a PDF/image categorised as "other", not an internal/system file),
  // we just FLAG them so staff can add them manually if they belong — keeping the
  // folder clean.
  try {
    const usedIds = new Set<string>();
    for (const job of copyJobs) if (job.doc.driveFileId) usedIds.add(job.doc.driveFileId);
    for (const src of bundleSources) if (src.driveFileId) usedIds.add(src.driveFileId);

    const INTERNAL_RE = /intake answers|chat|conversation|^notes?\b|\.txt$|whatsapp/i;
    const extras = categorized.filter((d) =>
      d.driveFileId && !usedIds.has(d.driveFileId) &&
      d.category === "other" &&
      /\.(pdf|jpe?g|png|webp|heic)$/i.test(String(d.name || "")) &&
      !INTERNAL_RE.test(String(d.name || ""))
    );
    if (extras.length > 0) {
      warnings.push(`Not added to the package — review and add manually only if needed for submission: ${extras.map((d) => d.name).join(", ")}`);
    }
  } catch (e) {
    warnings.push(`Extra-documents check failed: ${(e as Error).message}`);
  }

  console.log(`[submission ${caseId}] ✅ DONE — ${filesAdded.length} files added, ${errors.length} errors, ${warnings.length} warnings`);
  return {
    ok: true,
    folderLink: subfolder.webViewLink,
    folderId: submissionFolderId,
    filesAdded,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    readiness,
  };
}
