/**
 * AI-assisted parser for messy intake fields
 * ===========================================
 *
 * Real clients don't type addresses or education history in clean comma-separated
 * format. They write paragraphs, skip fields, use weird punctuation, mix languages.
 * Regex parsers break. Claude Haiku doesn't.
 *
 * This module sends the raw answers + the case context to Claude Haiku in ONE
 * batch request and gets back structured field data. Total cost: ~$0.001 per case.
 * Total latency: ~2 seconds. Falls back to regex if AI fails.
 *
 * Shape of output is the same fields the form-specific mappers expect, so callers
 * can replace their regex parsing with `await parseIntakeWithAI(intake, formType)`.
 */

import {
  textToCountryCode,
  textToProvinceCode,
  textToLanguageCode,
  textToVisitPurposeCode,
  textToStatusCode,
  textToMaritalCode,
} from "./ircc-codes";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

export interface ParsedIntake {
  // Address parsing
  mailing?: {
    apt_unit?: string;
    street_num?: string;
    street_name?: string;
    city?: string;
    province?: string;
    postal_code?: string;
    country?: string;
  };
  residential?: {
    apt_unit?: string;
    street_num?: string;
    street_name?: string;
    city?: string;
    province?: string;
    postal_code?: string;
    country?: string;
  };
  residential_same_as_mailing?: boolean;

  // Spouse / family
  spouse?: {
    family_name?: string;
    given_name?: string;
    date_of_marriage?: string;
    dob?: string;
    citizenship?: string;
    status_in_canada?: string;
  };
  previous_marriage?: {
    has_previous?: boolean;
    family_name?: string;
    given_name?: string;
    relationship_type?: string;
    from_date?: string;
    to_date?: string;
  };

  // Education history (array — clients often have multiple entries)
  education?: Array<{
    school_name?: string;
    field_of_study?: string;
    city?: string;
    country?: string;
    from_year?: string;
    from_month?: string;
    to_year?: string;
    to_month?: string;
  }>;

  // Employment history (array)
  employment?: Array<{
    from_year?: string;
    from_month?: string;
    to_year?: string;
    to_month?: string;
    occupation?: string;
    employer?: string;
    city?: string;
    country?: string;
  }>;

  // Travel history (array)
  travel_history?: Array<{
    country?: string;
    from_year?: string;
    from_month?: string;
    to_year?: string;
    to_month?: string;
    purpose?: string;
  }>;

  // Background — Y/N + extracted details
  refusal?: { has?: boolean; details?: string; to_canada?: boolean };
  medical?: { has?: boolean; details?: string };
  criminal?: { has?: boolean; details?: string };
  overstay?: { has?: boolean; details?: string };

  // Visit-specific (visitor visa / record)
  visit?: {
    purpose?: string;
    arrival_date?: string;
    departure_date?: string;
  };
  canada_contact?: {
    name?: string;
    relationship?: string;
    address?: string;
    phone?: string;
    email?: string;
  };
  funds?: {
    amount_cad?: string;
    paid_by_self?: boolean;
    paid_by_parents?: boolean;
    paid_by_other?: boolean;
    paid_by_other_details?: string;
  };

  // Languages
  language?: {
    native?: string;
    communicate?: string; // "English" | "French" | "Both" | "Neither"
    test_taken?: boolean;
  };

  // Entry to Canada
  entry?: {
    original_date?: string;
    original_place?: string;
    original_purpose?: string;
    recent_date?: string;
    recent_place?: string;
  };

  // Study-specific (Study Permit Extension)
  study?: {
    school_name?: string;
    school_city?: string;
    program_name?: string;
    program_end_date?: string;
    permit_number?: string;
    permit_expiry?: string;
    changing_school?: boolean;
    change_school_details?: string;
    changing_program?: boolean;
    change_program_details?: string;
    extension_reason?: string;
    maintained_full_time?: boolean;
    full_time_explanation?: string;
  };

  // Internal — was AI used?
  _ai_used?: boolean;
  _ai_error?: string;
}

/**
 * Build the prompt for Claude Haiku to parse intake answers.
 * Sends ALL relevant Q answers in ONE request to minimize latency + cost.
 */
function buildParsingPrompt(intake: Record<string, any>, formType: string): string {
  // Collect all q1, q2, q3... answers and their question text if available
  const lines: string[] = [];

  // Try to identify Q-numbered answers
  for (let i = 1; i <= 30; i++) {
    const key = `q${i}`;
    if (intake[key]) {
      lines.push(`Q${i}: ${intake[key]}`);
    }
  }

  // Also include some structured fields if present
  if (intake.address) lines.push(`Address (legacy): ${intake.address}`);
  if (intake.phone) lines.push(`Phone: ${intake.phone}`);
  if (intake.email) lines.push(`Email: ${intake.email}`);
  if (intake.maritalStatus) lines.push(`Marital status (legacy): ${intake.maritalStatus}`);

  return lines.join("\n");
}

/**
 * Call Claude Haiku once with all the messy fields, get structured JSON back.
 * Falls back gracefully if AI fails — caller should still use regex mappers as backup.
 */
export async function parseIntakeWithAI(
  intake: Record<string, any>,
  formType: string
): Promise<ParsedIntake> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { _ai_used: false, _ai_error: "ANTHROPIC_API_KEY not set" };
  }

  const intakeText = buildParsingPrompt(intake, formType);
  if (!intakeText.trim()) {
    return { _ai_used: false, _ai_error: "No intake answers to parse" };
  }

  const systemPrompt = `You are an expert at parsing immigration form intake answers from clients of Newton Immigration. Clients answer questions via WhatsApp, often in messy free-text form. Your job is to extract structured field data from their answers.

You will receive numbered answers (Q1, Q2, etc.) for a "${formType}" application. Extract whatever fields you can identify from the answers. If a field is not mentioned or unclear, OMIT it (don't guess).

CRITICAL RULES:
1. Return ONLY valid JSON matching the schema below. No markdown, no preamble, no explanation.
2. Date format is always YYYY-MM-DD or split into year/month/day.
3. Postal codes: format like "V8B 0Y8" (Canadian) or "M5V 2T6" (with space).
4. Country names: full name, not codes (e.g., "Canada" not "CA").
5. Booleans: true/false (not "Yes"/"No" strings).
6. If client wrote "Yes, refused in 2019 for visitor visa", the boolean is true and details is "refused in 2019 for visitor visa".
7. If client said "SAME" for residential address, set residential_same_as_mailing: true.
8. If education/employment/travel has multiple entries, return them all as array elements.
9. Strip any leading "N.) " prefix from answers (e.g. "5.) 2014 Dowad" → "2014 Dowad").

OUTPUT JSON SCHEMA:
{
  "mailing": { "apt_unit": "", "street_num": "", "street_name": "", "city": "", "province": "", "postal_code": "", "country": "" },
  "residential": { ... same shape ... },
  "residential_same_as_mailing": true|false,
  "spouse": { "family_name": "", "given_name": "", "date_of_marriage": "YYYY-MM-DD", "dob": "YYYY-MM-DD", "citizenship": "", "status_in_canada": "" },
  "previous_marriage": { "has_previous": true|false, "family_name": "", "given_name": "", "relationship_type": "Married|Common-Law", "from_date": "YYYY-MM-DD", "to_date": "YYYY-MM-DD" },
  "education": [ { "school_name": "", "field_of_study": "", "city": "", "country": "", "from_year": "", "from_month": "", "to_year": "", "to_month": "" } ],
  "employment": [ { "from_year": "", "from_month": "", "to_year": "", "to_month": "", "occupation": "", "employer": "", "city": "", "country": "" } ],
  "travel_history": [ { "country": "", "from_year": "", "from_month": "", "to_year": "", "to_month": "", "purpose": "" } ],
  "refusal": { "has": true|false, "details": "", "to_canada": true|false },
  "medical": { "has": true|false, "details": "" },
  "criminal": { "has": true|false, "details": "" },
  "overstay": { "has": true|false, "details": "" },
  "visit": { "purpose": "", "arrival_date": "YYYY-MM-DD", "departure_date": "YYYY-MM-DD" },
  "canada_contact": { "name": "", "relationship": "", "address": "", "phone": "", "email": "" },
  "funds": { "amount_cad": "", "paid_by_self": true|false, "paid_by_parents": true|false, "paid_by_other": true|false, "paid_by_other_details": "" },
  "language": { "native": "", "communicate": "English|French|Both|Neither", "test_taken": true|false },
  "entry": { "original_date": "YYYY-MM-DD", "original_place": "", "original_purpose": "Study|Work|Visit|Other", "recent_date": "YYYY-MM-DD", "recent_place": "" },
  "study": { "school_name": "", "school_city": "", "program_name": "", "program_end_date": "YYYY-MM-DD", "permit_number": "", "permit_expiry": "YYYY-MM-DD", "changing_school": true|false, "change_school_details": "", "changing_program": true|false, "change_program_details": "", "extension_reason": "", "maintained_full_time": true|false, "full_time_explanation": "" }
}

OMIT any top-level key whose values are all empty/unknown. Return ONLY the JSON object.`;

  const userPrompt = `Form type: ${formType}

Client's intake answers:
${intakeText}

Parse and return the JSON.`;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      // 12-second hard timeout — form generation shouldn't hang waiting on AI
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      return { _ai_used: false, _ai_error: `API ${res.status}` };
    }

    const data = (await res.json()) as any;
    const text = data?.content?.[0]?.text || "";

    // Strip any markdown fences AI sometimes adds despite instructions
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: ParsedIntake;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { _ai_used: false, _ai_error: "AI returned invalid JSON: " + (e as Error).message };
    }

    parsed._ai_used = true;
    return parsed;
  } catch (e) {
    return { _ai_used: false, _ai_error: (e as Error).message };
  }
}

/**
 * Helper: merge AI-parsed data into the form-data object built by regex mappers.
 * AI data wins when present and non-empty; regex data is the fallback.
 *
 * This is the function called by the form generator route to produce the final
 * form-fill payload. Pass in the regex-mapped output and the AI-parsed result.
 */
export function mergeAIIntoFormData(
  formData: Record<string, any>,
  ai: ParsedIntake
): Record<string, any> {
  if (!ai._ai_used) return formData;

  const merged = { ...formData };
  const setIf = (key: string, val: any) => {
    if (val !== undefined && val !== null && val !== "") merged[key] = val;
  };

  // CODE-AWARE setIf for IRCC numeric-coded fields. Behavior:
  //   - If existing value is already a numeric IRCC code (matches /^\d+$/ and >=2 digits),
  //     LEAVE IT ALONE. The v2 regex mapper produced the right value, don't second-guess.
  //   - If existing is empty or text, take AI's value but CONVERT it to numeric via the
  //     supplied converter when possible. If conversion fails (unknown country/lang/etc),
  //     fall back to writing AI's raw text so the form still has SOMETHING (and staff
  //     can fix it during review).
  //
  // Safe for non-PGWP forms whose mappers output text: their existing values won't match
  // the numeric-code regex, so we just convert text→code if possible (which produces the
  // same code anyway — IRCC codes are universal across forms).
  const setIfNotOverridingCode = (
    key: string,
    val: any,
    converter?: (s: string) => string,
  ) => {
    if (val === undefined || val === null || val === "") return;
    const existing = String(merged[key] ?? "");
    if (/^\d+$/.test(existing) && existing.length >= 2) return;
    if (converter) {
      const code = converter(String(val));
      merged[key] = code || val;
    } else {
      merged[key] = val;
    }
  };

  // Mailing address
  if (ai.mailing) {
    setIf("mailing_apt_unit", ai.mailing.apt_unit);
    setIf("mailing_street_num", ai.mailing.street_num);
    setIf("mailing_street_name", ai.mailing.street_name);
    setIf("mailing_city", ai.mailing.city);
    setIfNotOverridingCode("mailing_province", ai.mailing.province, textToProvinceCode);
    setIf("mailing_postal_code", ai.mailing.postal_code);
    setIfNotOverridingCode("mailing_country", ai.mailing.country, textToCountryCode);
  }

  // Residential
  if (ai.residential_same_as_mailing !== undefined) {
    merged.residential_same_as_mailing = ai.residential_same_as_mailing;
  }
  if (ai.residential && !ai.residential_same_as_mailing) {
    setIf("residential_apt_unit", ai.residential.apt_unit);
    setIf("residential_street_num", ai.residential.street_num);
    setIf("residential_street_name", ai.residential.street_name);
    setIf("residential_city", ai.residential.city);
    setIfNotOverridingCode("residential_province", ai.residential.province, textToProvinceCode);
  }

  // Spouse
  if (ai.spouse) {
    setIf("spouse_family_name", ai.spouse.family_name);
    setIf("spouse_given_name", ai.spouse.given_name);
    setIf("date_of_marriage", ai.spouse.date_of_marriage);
    setIf("spouse_dob", ai.spouse.dob);
    setIf("spouse_citizenship", ai.spouse.citizenship);
    setIf("spouse_status_in_canada", ai.spouse.status_in_canada);
  }

  // Previous marriage
  if (ai.previous_marriage) {
    setIf("previously_married", ai.previous_marriage.has_previous);
    setIf("prev_spouse_family_name", ai.previous_marriage.family_name);
    setIf("prev_spouse_given_name", ai.previous_marriage.given_name);
    setIf("prev_relationship_type", ai.previous_marriage.relationship_type);
    setIf("prev_marriage_from", ai.previous_marriage.from_date);
    setIf("prev_marriage_to", ai.previous_marriage.to_date);
  }

  // Education (use first entry for the single-entry form fields)
  if (ai.education && ai.education.length > 0) {
    const e = ai.education[0];
    merged.has_education = true;
    setIf("edu_school_name", e.school_name);
    setIf("edu_field_of_study", e.field_of_study);
    setIf("edu_city", e.city);
    setIfNotOverridingCode("edu_country", e.country, textToCountryCode);
    setIf("edu_from_year", e.from_year);
    setIf("edu_from_month", e.from_month);
    setIf("edu_to_year", e.to_year);
    setIf("edu_to_month", e.to_month);
    // Also expose full array for forms that support multiple entries
    merged.education_history = ai.education;
  }

  // Garbage-employment filter: reject entries that don't look like real jobs.
  // The v2 mapper's parseEmploymentBestEffort splits by comma and assigns
  // positionally — when q14/q15 contain test-info or single language words
  // (intake-bot Q-mapping bug), this produces nonsense entries. Apply the
  // same filter to AI's array too. Real "Unemployed/N/A" entries (PGWP legal
  // compliance) pass through because their occupation is long enough and
  // doesn't match rejection patterns.
  const looksLikeRealJob = (e: any): boolean => {
    const occ = String(e?.occupation || "").replace(/[\u2060\u200B-\u200D\uFEFF]/g, "").trim();
    const emp = String(e?.employer || "").replace(/[\u2060\u200B-\u200D\uFEFF]/g, "").trim();
    const city = String(e?.city || "").replace(/[\u2060\u200B-\u200D\uFEFF]/g, "").trim();
    if (occ.length < 3) return false;
    if (/^(yes|no|na|n\/a|none|nil)$/i.test(occ)) return false;
    // Score-like values in the city slot (e.g. "6.5 bands", "7.0") are language-test data.
    if (/^[\d.]+\s*(bands?|points?)?$/i.test(city)) return false;
    // Test-name in employer slot (e.g. "IELTS", "TOEFL") — language test, not a job.
    if (/^(ielts|toefl|pte|celpip|test)$/i.test(emp)) return false;
    return true;
  };

  // First clean v2's existing employment, preserving the legally-required
  // "Unemployed/N/A" entry if present.
  if (Array.isArray(merged.employment)) {
    merged.employment = merged.employment.filter(looksLikeRealJob);
  }

  // Employment (full array — many forms support multiple entries)
  if (ai.employment && ai.employment.length > 0) {
    const cleanedAi = ai.employment.filter(looksLikeRealJob);
    if (cleanedAi.length > 0) {
      // PGWP legal compliance: the v2 regex mapper for PGWP prepends an
      // "Unemployed / N/A" entry that runs from the completion-letter date to
      // present. Preserve it as employment[0] when present, append AI's real
      // jobs after — instead of letting AI's array wipe it out.
      const existing = formData.employment;
      const firstIsUnemployed =
        Array.isArray(existing) &&
        existing[0] &&
        existing[0].occupation === "Unemployed" &&
        existing[0].employer === "N/A";
      if (firstIsUnemployed) {
        merged.employment = [existing[0], ...cleanedAi];
      } else {
        merged.employment = cleanedAi;
      }
    }
    // If cleanedAi is empty (all entries were garbage), leave merged.employment
    // as the already-cleaned v2 output (which may also be empty if v2's only
    // entries were garbage too — that's correct: staff fills in manually).
  }

  // Travel history
  if (ai.travel_history && ai.travel_history.length > 0) {
    merged.travel_history = ai.travel_history;
  }

  // Background flags
  // IMPORTANT: When has=false, FORCE-clear the details field. Don't trust AI to send empty.
  // This prevents the form from showing "Visitor visa refused 2019" while ALSO ticking the
  // No checkbox — which is a real failure mode that confuses IRCC officers.
  if (ai.refusal) {
    if (ai.refusal.has !== undefined) merged.prev_application_refused = ai.refusal.has;
    if (ai.refusal.to_canada !== undefined) merged.prev_refused_to_canada = ai.refusal.to_canada;
    if (ai.refusal.has === false) {
      merged.prev_refused_details = "";
      merged.prev_refused_to_canada = false;
    } else if (ai.refusal.details) {
      merged.prev_refused_details = ai.refusal.details;
    }
  }
  if (ai.medical) {
    if (ai.medical.has !== undefined) merged.has_medical_condition = ai.medical.has;
    if (ai.medical.has === false) {
      merged.medical_details = "";
    } else if (ai.medical.details) {
      merged.medical_details = ai.medical.details;
    }
  }
  if (ai.criminal) {
    if (ai.criminal.has !== undefined) merged.has_criminal_record = ai.criminal.has;
    if (ai.criminal.has === false) {
      merged.criminal_details = "";
    } else if (ai.criminal.details) {
      merged.criminal_details = ai.criminal.details;
    }
  }
  if (ai.overstay) {
    if (ai.overstay.has !== undefined) merged.has_overstayed = ai.overstay.has;
    if (ai.overstay.has === false) {
      merged.overstay_details = "";
    } else if (ai.overstay.details) {
      merged.overstay_details = ai.overstay.details;
    }
  }

  // Visit details (visitor visa / record)
  if (ai.visit) {
    setIf("visit_purpose", ai.visit.purpose);
    setIf("visit_arrival_date", ai.visit.arrival_date);
    setIf("visit_departure_date", ai.visit.departure_date);
  }
  if (ai.canada_contact) {
    setIf("canada_contact_name", ai.canada_contact.name);
    setIf("canada_contact_relationship", ai.canada_contact.relationship);
    setIf("canada_contact_address", ai.canada_contact.address);
    setIf("canada_contact_phone", ai.canada_contact.phone);
    setIf("canada_contact_email", ai.canada_contact.email);
  }
  if (ai.funds) {
    setIf("funds_amount_cad", ai.funds.amount_cad);
    setIf("funds_paid_by_self", ai.funds.paid_by_self);
    setIf("funds_paid_by_parents", ai.funds.paid_by_parents);
    setIf("funds_paid_by_other", ai.funds.paid_by_other);
    setIf("funds_paid_by_other_details", ai.funds.paid_by_other_details);
  }

  // Language
  if (ai.language) {
    setIfNotOverridingCode("native_language", ai.language.native, textToLanguageCode);
    setIf("communicate_language", ai.language.communicate);
    setIf("language_test_taken", ai.language.test_taken);
    // NOTE: do NOT set frequent_language to the native language. The IRCC
    // "language you are most at ease in" field only accepts English/French.
    // Writing the native tongue (e.g. "Punjabi") produces an invalid LOV value.
    // frequent_language is set to English/French by the mapper; leave it alone here.
  }

  // Entry to Canada
  if (ai.entry) {
    setIf("original_entry_date", ai.entry.original_date);
    setIf("original_entry_place", ai.entry.original_place);
    setIfNotOverridingCode("original_entry_purpose", ai.entry.original_purpose, textToVisitPurposeCode);
    setIf("recent_entry_date", ai.entry.recent_date);
    setIf("recent_entry_place", ai.entry.recent_place);
  }

  // Study-specific (IMM5709E)
  if (ai.study) {
    setIf("study_school_name", ai.study.school_name);
    setIf("edu_school_name", ai.study.school_name);
    setIf("edu_city", ai.study.school_city);
    setIf("study_program_name", ai.study.program_name);
    setIf("edu_field_of_study", ai.study.program_name);
    setIf("study_program_end_date", ai.study.program_end_date);
    setIf("previous_doc_number", ai.study.permit_number);
    setIf("current_status_to_date", ai.study.permit_expiry);
    setIf("study_changing_school", ai.study.changing_school);
    setIf("study_change_school_details", ai.study.change_school_details);
    setIf("study_changing_program", ai.study.changing_program);
    setIf("study_change_program_details", ai.study.change_program_details);
    setIf("study_extension_reason", ai.study.extension_reason);
    setIf("study_maintained_full_time", ai.study.maintained_full_time);
    setIf("study_full_time_explanation", ai.study.full_time_explanation);
  }

  // Stamp the AI status onto the output for debugging / UI
  merged._ai_parser_used = true;
  return merged;
}
