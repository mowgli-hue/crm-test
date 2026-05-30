// ─────────────────────────────────────────────────────────────────────
// Document OCR — extract structured fields from passport, study permit,
// work permit, and other immigration documents using Claude vision.
//
// USED BY:
//   - apps/api/whatsapp/route.ts        (WhatsApp inbound — existing)
//   - apps/api/cases/[id]/scan-docs/    (new staff-triggered scan)
//
// Why a shared module: the OCR logic was duplicated in the WhatsApp route
// and there was no way to run it on docs uploaded directly to Drive (staff
// uploads). Extracting here means staff can click "Rescan documents" on a
// case to populate intake fields from already-uploaded passports.
// ─────────────────────────────────────────────────────────────────────

// Largest file (raw bytes) we attempt to OCR. Anything bigger is saved but not
// auto-read. Exported so the WhatsApp handler can tell a client their upload was
// too large to process and ask for a smaller copy.
export const OCR_MAX_BYTES = 4_500_000; // ~4.5MB raw -> ~6MB base64, under the 32MB API limit

export interface ExtractedFields {
  category?: string;
  label?: string;
  // Legibility assessment from the vision model. legible=false means the scan is
  // too blurry/dark/cropped/low-res to reliably read — the caller can ask the
  // client to resend a clearer copy instead of silently accepting an unusable doc.
  legible?: boolean;
  qualityNote?: string;
  expiryDate?: string;
  issueDate?: string;
  documentNumber?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  // Country fields. Passports have BOTH: country of citizenship (passport-issuing
  // country) AND country of birth (could differ from citizenship).
  issuingCountry?: string;
  countryOfBirth?: string;
  placeOfBirthCity?: string;       // Surendranagar, Mumbai, etc.
  // Study/work permit specifics
  uci?: string;                     // 11-2216-2829
  programOrField?: string;
  institutionOrEmployer?: string;
  // ── LOA-specific fields (Letter of Acceptance from school) ──
  // Used by study permit applications to fill IMM5709 / IMM1294.
  schoolName?: string;              // "University Canada West"
  schoolAddress?: string;           // Full street address
  schoolCity?: string;              // "Vancouver"
  schoolProvince?: string;          // 2-letter code "BC"
  dliNumber?: string;               // Designated Learning Institution # — "O19395389734"
  studentId?: string;               // School-issued student number
  studyLevel?: string;              // Free-text from LOA: "Bachelor of Computer Science"
  studyField?: string;              // Free-text from LOA: "Computer Science"
  studyFromDate?: string;           // YYYY-MM-DD program start
  studyToDate?: string;             // YYYY-MM-DD program end
  tuitionCost?: string;             // CAD amount, digits only
  // ── PAL fields (Provincial Attestation Letter) ──
  // Mandatory for most undergrad study permit applications since 2024.
  // Graduate students (Master's / PhD), K-12, exchange students are exempt.
  palDocNumber?: string;
  palExpiryDate?: string;           // YYYY-MM-DD
}

/**
 * Run Claude vision/document OCR on a file buffer and return structured fields.
 *
 * @param buffer    Raw bytes of the file (image or PDF)
 * @param mimeType  MIME type (image/jpeg, image/png, application/pdf, etc.)
 * @param clientName  Used to give Claude context about whose document this is
 * @returns Extracted fields (any field not found will be empty/undefined)
 */
export async function extractDocumentFields(
  buffer: Buffer,
  mimeType: string,
  clientName: string,
): Promise<ExtractedFields | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("doc-ocr: ANTHROPIC_API_KEY not set, skipping OCR");
    return null;
  }

  const isImage = mimeType.includes("image");
  const isPdf = mimeType.includes("pdf");
  if (!isImage && !isPdf) {
    return null;
  }

  // ── SIZE GUARD ──
  // The Anthropic API rejects requests larger than ~32MB total, and base64
  // encoding inflates the payload by ~33%. Large scanned PDFs (e.g. a 38MB
  // multi-page tenancy agreement) blow straight past this and return
  // HTTP 413 (request_too_large). Worse, the doomed call wastes several
  // seconds, which pushes the WhatsApp webhook past the router's 15s timeout
  // and triggers duplicate reprocessing of the whole message.
  //
  // Documents that actually need field extraction (passports, permits,
  // photos, letters) are small — typically well under 2MB. So we skip the
  // scan for anything above a safe threshold; the document is still saved to
  // Drive/S3 by the caller, just without auto-naming/auto-fill (a human can
  // label it). Returning null = "no extraction available".
  const MAX_OCR_BYTES = OCR_MAX_BYTES;
  if (buffer.length > MAX_OCR_BYTES) {
    console.warn(
      `doc-ocr: skipping scan for ${clientName} — file is ${(buffer.length / 1e6).toFixed(1)}MB ` +
      `(limit ${(MAX_OCR_BYTES / 1e6).toFixed(1)}MB). Saved without auto-extraction.`
    );
    return null;
  }

  // Build content array — Claude vision needs base64-encoded source
  const scanContent: any[] = [];
  if (isImage) {
    const safeType =
      mimeType.includes("png") ? "image/png" :
      mimeType.includes("gif") ? "image/gif" :
      mimeType.includes("webp") ? "image/webp" :
      "image/jpeg";
    scanContent.push({
      type: "image",
      source: { type: "base64", media_type: safeType, data: buffer.toString("base64") },
    });
  } else {
    scanContent.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
    });
  }

  scanContent.push({
    type: "text",
    text: `Scan this immigration document for client ${clientName}.

Return ONLY a JSON object with these fields (use empty string "" if unknown — never null):
{
  "category": "passport|study_permit|work_permit|visa|completion_letter|transcripts|language_test|photo|bank_statement|job_offer|medical|police_clearance|ielts|lmia|eap|copr|loa|pal|other",
  "label": "Short human label e.g. Passport, Study Permit, Letter of Acceptance, PAL",
  "legible": true,
  "qualityNote": "If not legible, briefly why (e.g. 'too blurry', 'too dark', 'edges cut off', 'glare covers text', 'low resolution'). Empty if legible.",
  "expiryDate": "YYYY-MM-DD",
  "issueDate": "YYYY-MM-DD",
  "documentNumber": "Passport number or permit number (digits/letters only, no spaces)",
  "firstName": "Given name(s) — UPPERCASE if shown that way on the doc",
  "lastName": "Family name / Surname",
  "dateOfBirth": "YYYY-MM-DD",
  "gender": "Male or Female",
  "issuingCountry": "Country that issued the document (e.g. India for an Indian passport)",
  "countryOfBirth": "Country where person was born — usually same as issuingCountry on a passport, but extract separately if shown",
  "placeOfBirthCity": "City and/or state of birth (e.g. 'Surendranagar, Gujarat'). Found on passport's 'Place of Birth' field. Empty for non-passport docs.",
  "uci": "UCI / IUC number — usually 8-10 digits with dashes (e.g. 11-2216-2829). Found on study permits, work permits, COPR. Empty for passports.",
  "programOrField": "Field of study or job role",
  "institutionOrEmployer": "School name or employer name",

  "schoolName": "(LOA only) Full official school name e.g. 'University Canada West'",
  "schoolAddress": "(LOA only) Full street address of the school",
  "schoolCity": "(LOA only) City where school is located e.g. 'Vancouver'",
  "schoolProvince": "(LOA only) 2-letter province code: BC, ON, AB, QC, MB, SK, NS, NB, NL, PE, YT, NT, NU",
  "dliNumber": "(LOA only) Designated Learning Institution number, format O followed by 11 digits e.g. 'O19395389734'",
  "studentId": "(LOA only) School-issued student ID number",
  "studyLevel": "(LOA only) Verbatim level from the doc e.g. 'Bachelor of Computer Science', 'Master of Business Administration', 'College Diploma'",
  "studyField": "(LOA only) Verbatim field from the doc e.g. 'Computer Science', 'Business Administration', 'Hospitality Management'",
  "studyFromDate": "(LOA only) Program start date YYYY-MM-DD",
  "studyToDate": "(LOA only) Program end date YYYY-MM-DD",
  "tuitionCost": "(LOA only) Tuition cost in CAD, digits only e.g. '24500'",

  "palDocNumber": "(PAL only) PAL document number — usually starts with PAL- followed by digits, or province-specific format",
  "palExpiryDate": "(PAL only) PAL expiry date YYYY-MM-DD"
}

IMPORTANT:
- For passports, set countryOfBirth from the 'Place of Birth' field's country (look at MRZ if needed). Do NOT default to 'Canada' or 'India' — only use what's actually on the document.
- For study permits, the UCI is critical — extract it precisely with dashes.
- For LOA: extract DLI number carefully. It usually appears as 'DLI #', 'Designated Learning Institution Number', or just 'O' followed by 11 digits. Common variations exist.
- For LOA tuition: if multiple amounts shown (semester vs yearly), use the YEARLY amount. Strip $ and commas — pure digits only.
- For PAL: only fill palDocNumber and palExpiryDate when category is "pal". Otherwise leave them empty.
- Reply with ONLY the JSON, no other text.`
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{ role: "user", content: scanContent }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`doc-ocr: API ${res.status}: ${errBody.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as any;
    const text = data.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as ExtractedFields;

    // Normalize empty strings to undefined for cleaner downstream handling
    for (const k of Object.keys(parsed)) {
      const v = (parsed as any)[k];
      if (v === "" || v === null || v === undefined) {
        delete (parsed as any)[k];
      }
    }

    return parsed;
  } catch (e) {
    console.error("doc-ocr: extraction failed:", (e as Error).message);
    return null;
  }
}

/**
 * Map extracted fields to the intake schema (pgwpIntake fields).
 *
 * The intake stores fields with semantic names like `passportNumber`,
 * `studyPermitExpiryDate`, etc. This function takes the OCR output and
 * turns it into a partial intake update object.
 *
 * Smart merging: only sets fields that aren't already populated. Existing
 * intake data (e.g., from manual staff entry) takes precedence over OCR.
 */
export function mapExtractedToIntake(
  extracted: ExtractedFields,
  existingIntake: Record<string, any> = {},
): Record<string, string> {
  const fields: Record<string, string> = {};

  // Helper: only set if extracted value exists AND existing is empty
  const setIfMissing = (key: string, value: string | undefined) => {
    if (value && (!existingIntake[key] || String(existingIntake[key]).trim() === "")) {
      fields[key] = value;
    }
  };

  // Common identity fields (extracted from passport primarily)
  setIfMissing("firstName", extracted.firstName);
  setIfMissing("lastName", extracted.lastName);
  setIfMissing("dateOfBirth", extracted.dateOfBirth);
  setIfMissing("sex", extracted.gender);
  setIfMissing("placeOfBirthCity", extracted.placeOfBirthCity);

  // Country fields — prefer countryOfBirth if explicitly extracted,
  // fall back to issuingCountry as a reasonable proxy
  setIfMissing("countryOfBirth", extracted.countryOfBirth || extracted.issuingCountry);
  setIfMissing("citizenship", extracted.issuingCountry);

  // Document-specific fields based on category
  if (extracted.category === "passport") {
    setIfMissing("passportNumber", extracted.documentNumber);
    setIfMissing("passportIssueDate", extracted.issueDate);
    setIfMissing("passportExpiryDate", extracted.expiryDate);
  } else if (extracted.category === "study_permit") {
    setIfMissing("permitDetails", extracted.documentNumber);
    setIfMissing("studyPermitExpiryDate", extracted.expiryDate);
    setIfMissing("uci", extracted.uci);
    setIfMissing("programOfStudy", extracted.programOrField);
    setIfMissing("institutionName", extracted.institutionOrEmployer);
  } else if (extracted.category === "work_permit") {
    setIfMissing("workPermitNumber", extracted.documentNumber);
    setIfMissing("workPermitExpiryDate", extracted.expiryDate);
    setIfMissing("uci", extracted.uci);
  } else if (extracted.category === "visa") {
    // Visa stamps in passport — issue/expiry, no UCI typically
    if (!existingIntake.visaIssueDate && extracted.issueDate) fields.visaIssueDate = extracted.issueDate;
    if (!existingIntake.visaExpiryDate && extracted.expiryDate) fields.visaExpiryDate = extracted.expiryDate;
  } else if (extracted.category === "loa") {
    // Letter of Acceptance — primary source of school + program details for
    // study permit applications. Fills the IMM5709 / IMM1294 study section.
    setIfMissing("loaSchoolName", extracted.schoolName || extracted.institutionOrEmployer);
    setIfMissing("loaSchoolAddress", extracted.schoolAddress);
    setIfMissing("loaSchoolCity", extracted.schoolCity);
    setIfMissing("loaSchoolProvince", extracted.schoolProvince);
    setIfMissing("loaDliNumber", extracted.dliNumber);
    setIfMissing("loaStudentId", extracted.studentId);
    setIfMissing("loaStudyLevel", extracted.studyLevel);
    setIfMissing("loaStudyField", extracted.studyField || extracted.programOrField);
    setIfMissing("loaStudyFromDate", extracted.studyFromDate);
    setIfMissing("loaStudyToDate", extracted.studyToDate);
    setIfMissing("loaTuitionCost", extracted.tuitionCost);
  } else if (extracted.category === "pal") {
    // Provincial Attestation Letter — required for most undergrad SP applications
    // since 2024. Graduate students, K-12, and exchange students are exempt.
    setIfMissing("palDocNumber", extracted.palDocNumber || extracted.documentNumber);
    setIfMissing("palExpiryDate", extracted.palExpiryDate || extracted.expiryDate);
  }

  return fields;
}
