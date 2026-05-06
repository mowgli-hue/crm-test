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

export interface ExtractedFields {
  category?: string;
  label?: string;
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
  "category": "passport|study_permit|work_permit|visa|completion_letter|transcripts|language_test|photo|bank_statement|job_offer|medical|police_clearance|ielts|lmia|eap|copr|other",
  "label": "Short human label e.g. Passport, Study Permit, Completion Letter",
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
  "institutionOrEmployer": "School name or employer name"
}

IMPORTANT:
- For passports, set countryOfBirth from the 'Place of Birth' field's country (look at MRZ if needed). Do NOT default to 'Canada' or 'India' — only use what's actually on the document.
- For study permits, the UCI is critical — extract it precisely with dashes.
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
        max_tokens: 600,
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
  }

  return fields;
}
