/**
 * Form-specific intake-to-form mappers
 * ====================================
 *
 * Each IRCC form (PGWP/SOWP/Work Permits IMM5710E, Study Permit Extension IMM5709E,
 * Visitor Visa IMM5257E, Visitor Record IMM5708E) has its OWN question flow defined
 * in `application-question-flows.ts`. The same question number means different things
 * across forms — e.g. for PGWP Q11 = "previous refusal" but for Study Permit Extension
 * Q12 = "previous refusal".
 *
 * The old `imm5710-mapper.ts` assumed PGWP question numbering for ALL forms, which is
 * why Sahil's Study Permit Extension form had education answers landing in the
 * refusal-details slot, funding info in medical-history, etc.
 *
 * This file fixes that by routing intake → form fields based on the actual form type,
 * using the correct Q# for each form.
 *
 * Form mapping logic and shared helpers live in this file. Each mapper outputs the
 * `EMPTY_CLIENT` shape expected by the corresponding Python filler (`fill_imm5709.py`,
 * `fill_imm5710.py`, etc.).
 */

import {
  textToCountryCode,
  textToProvinceCode,
  textToMaritalCode,
  textToPhoneTypeCode,
  textToVisitPurposeCode,
  textToStatusCode,
  textToLanguageCode,
} from "./ircc-codes";

// Newton's hardcoded email — IRCC correspondence always goes here, never to client
const NEWTON_EMAIL = "newtonimmigration@gmail.com";

// ── Shared parsing helpers ────────────────────────────────────────────────

// Canadian postal code regex: A1A 1A1 / A1A1A1 / a1a1a1 etc.
const POSTAL_RE = /\b([A-Za-z]\d[A-Za-z])\s*(\d[A-Za-z]\d)\b/;
// Common apt-unit keywords clients write as a single word: "basement", "main floor",
// "upper unit", "1st floor". Match if the WHOLE part matches one of these patterns.
const APT_KEYWORDS_RE = /^(basement|main\s*floor|upper(\s*unit|\s*floor)?|lower(\s*unit|\s*floor)?|\d+(st|nd|rd|th)?\s*floor|unit\s*\S+|apt\s*\S+|suite\s*\S+|#\s*\S+)$/i;
// Canadian provinces (full names + abbreviations)
const PROVINCE_RE = /^(BC|British Columbia|AB|Alberta|SK|Saskatchewan|MB|Manitoba|ON|Ontario|QC|Quebec|NB|New Brunswick|NS|Nova Scotia|PE|PEI|Prince Edward Island|NL|Newfoundland(\s*and Labrador)?|YT|Yukon|NT|Northwest Territories|NU|Nunavut)$/i;

const parseAddress = (raw: string) => {
  const parts = (raw || "").split(",").map((p) => p.trim()).filter(Boolean);

  // First pass: pull out the components we can identify by pattern, regardless
  // of position. Clients write addresses in any order — "15469 86ave, V3S 2P9,
  // basement" is real intake data and the OLD parser put postal_code in city
  // and "basement" in province. Detect-by-pattern fixes that.
  let apt_unit = "";
  let postal_code = "";
  let province = "";
  const remaining: string[] = [];

  for (const p of parts) {
    if (!postal_code) {
      const pm = p.match(POSTAL_RE);
      if (pm) {
        postal_code = (pm[1] + " " + pm[2]).toUpperCase();
        // If the part is JUST the postal code, consume it. Otherwise leave the rest.
        const rest = p.replace(POSTAL_RE, "").trim().replace(/^[,\s]+|[,\s]+$/g, "");
        if (rest) remaining.push(rest);
        continue;
      }
    }
    if (!apt_unit && APT_KEYWORDS_RE.test(p)) {
      apt_unit = p;
      continue;
    }
    if (!province && PROVINCE_RE.test(p)) {
      province = p;
      continue;
    }
    remaining.push(p);
  }

  // From the remaining parts, the FIRST is street (with optional leading number),
  // the SECOND is city, the rest are extras (might include country).
  const streetMatch = (remaining[0] || "").match(/^(\d+)\s+(.+)/);
  const street_num = streetMatch ? streetMatch[1] : "";
  const street_name = streetMatch ? streetMatch[2] : (remaining[0] || "");
  const city = remaining[1] || "";
  const country = remaining[2] || "Canada";

  return {
    apt_unit,
    street_num,
    street_name,
    city,
    province,
    postal_code,
    country,
  };
};

const parsePhone = (raw: string) => {
  const digits = (raw || "").replace(/\D/g, "");
  // North American format: country code "1" + 10 digits
  if (digits.length === 11 && digits.startsWith("1")) {
    const num = digits.slice(1);
    return {
      area_code: num.slice(0, 3),
      first_three: num.slice(3, 6),
      last_five: num.slice(6),
    };
  }
  // 10 digits: assume already without country code (Canada/US local)
  if (digits.length === 10) {
    return {
      area_code: digits.slice(0, 3),
      first_three: digits.slice(3, 6),
      last_five: digits.slice(6),
    };
  }
  // International (e.g. India +91 9876543210 → 12 digits). Strip leading country code,
  // returning the trailing 10 digits as the local number.
  if (digits.length > 10) {
    const local = digits.slice(-10);
    return {
      area_code: local.slice(0, 3),
      first_three: local.slice(3, 6),
      last_five: local.slice(6),
    };
  }
  // Too short — return what we have, padded with empty
  return {
    area_code: digits.slice(0, 3),
    first_three: digits.slice(3, 6),
    last_five: digits.slice(6),
  };
};

const parseDate = (raw: string) => {
  // Accept YYYY-MM-DD or YYYY/MM/DD
  const cleaned = (raw || "").replace(/\//g, "-");
  const parts = cleaned.split("-");
  return { year: parts[0] || "", month: parts[1] || "", day: parts[2] || "" };
};

// Normalize any date-ish string to YYYY-MM-DD (hyphens). IMM5710 and IRCC
// generally store dates in this format — verified against Paras's filed form.
// Mixed slash/hyphen output looks unprofessional and can confuse officers.
const normalizeDate = (raw: string): string => {
  if (!raw) return "";
  const s = String(raw).trim();
  // Already YYYY-MM-DD with 2-digit month/day
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYY/MM/DD or YYYY-M-D variations
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  // YYYY-MM or YYYY/MM (no day)
  const m2 = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m2) {
    return `${m2[1]}-${m2[2].padStart(2, "0")}`;
  }
  // Format unrecognized — leave alone, staff can fix during review.
  return s;
};

// Strip leading "N.) " or "N. " or "N) " prefix from answers — defensive cleanup
// in case any old-style corrupt answers remain in the database.
const stripPrefix = (s: string): string => {
  if (!s) return "";
  return String(s).replace(/^\s*\d{1,2}[.)\:]+\s*/, "").trim();
};

// Yes/No detection — handles "Yes", "Y", "yes please", and longer affirmatives
const isYes = (s: string): boolean => {
  const v = stripPrefix(String(s || "")).toLowerCase().trim();
  return v.startsWith("y") || v === "true" || v === "1";
};

const isNo = (s: string): boolean => {
  const v = stripPrefix(String(s || "")).toLowerCase().trim();
  return v === "n" || v === "no" || v === "na" || v === "n/a" || v === "none" || v === "false" || v === "0" || v === "";
};

// "Free-text after Yes/No" — extracts the content after a Yes/No prefix
// e.g. "Yes, refused in 2019 for visitor visa" → "refused in 2019 for visitor visa"
const detailsAfterYN = (s: string): string => {
  const v = stripPrefix(String(s || ""));
  // Match "Yes" / "Y" / "No" / "N" possibly followed by separator and the rest
  const m = v.match(/^(?:yes|y|no|n)\b[\s,;:.\-]*(.*)$/i);
  return m ? m[1].trim() : v;
};

// ── Builds the answer-lookup helper for a given intake ────────────────────

const buildLookup = (intake: Record<string, any>) => {
  let specific: Record<string, string> = {};
  try {
    specific = JSON.parse(intake.applicationSpecificAnswers || "{}");
  } catch {
    /* ignore */
  }

  // qN: 1-indexed answer from intake (q1, q2 ... saved by WhatsApp AI handler)
  const qN = (n: number): string => {
    const key = `q${n}`;
    if (intake[key] !== undefined && intake[key] !== null && intake[key] !== "") {
      return stripPrefix(String(intake[key]));
    }
    const k = Object.keys(specific)[n - 1];
    return k ? stripPrefix(String(specific[k] || "")) : "";
  };

  const qByKeyword = (keyword: string): string => {
    const key = Object.keys(specific).find((k) => k.toLowerCase().includes(keyword.toLowerCase()));
    return key ? stripPrefix(String(specific[key] || "")) : "";
  };

  return { qN, qByKeyword, specific };
};

// ── Common base section shared by all forms ───────────────────────────────
// Identity, passport, name — these come from the passport scan, NOT from intake Qs

const buildIdentitySection = (intake: Record<string, any>) => {
  const dob = parseDate(intake.dateOfBirth || "");
  const passportIssue = parseDate(intake.passportIssueDate || "");
  const passportExpiry = parseDate(intake.passportExpiryDate || "");
  const fullName = String(intake.fullName || "").trim();
  const givenName = intake.firstName || fullName.split(" ").slice(0, -1).join(" ") || fullName;
  const familyName = intake.lastName || (fullName.split(" ").length > 1 ? fullName.split(" ").slice(-1)[0] : "");

  return {
    family_name: String(familyName || "").toUpperCase(),
    given_name: String(givenName || "").toUpperCase(),
    sex: (() => {
      const s = String(intake.sex || intake.gender || "").toLowerCase();
      if (s.startsWith("f")) return "F Female";
      if (s.startsWith("m")) return "M Male";
      return "";
    })(),
    dob_year: dob.year,
    dob_month: dob.month,
    dob_day: dob.day,
    place_birth_city: String(intake.cityOfBirth || "").trim(),
    place_birth_country: String(intake.countryOfBirth || "").trim(),
    citizenship_country: String(intake.citizenship || intake.countryOfBirth || "").trim(),
    passport_number: String(intake.passportNumber || "").trim(),
    passport_country: String(intake.citizenship || intake.countryOfBirth || "").trim(),
    passport_issue_year: passportIssue.year,
    passport_issue_month: passportIssue.month,
    passport_issue_day: passportIssue.day,
    passport_expiry_year: passportExpiry.year,
    passport_expiry_month: passportExpiry.month,
    passport_expiry_day: passportExpiry.day,
    has_national_id: false,
    has_us_card: false,
  };
};

// ── Patched helpers for form-fill bug fixes ─────────────────────────────
// (added by the form-fill mapper patch — see commit message for details)

/**
 * Strip a leading "Yes"/"Yeah"/"Y"/"No"/"N" prefix and any separator before
 * extracting subsequent fields. Fixes the bug where "Yes from India" landed
 * in recent_entry_place instead of just "from India".
 */
const stripYesNoPrefix = (s: string): string => {
  if (!s) return "";
  return String(s)
    .replace(/^\s*(?:yes|yeah|yep|y|no|nope|n)\b[\s,;:.\-–]*/i, "")
    .trim();
};

/**
 * A document number must look like a real IRCC permit number:
 * letters + digits, at least 4 digits. Anything else (yes/no answers,
 * "WORK PERMIT", "Same") returns "".
 */
const sanitizeDocumentNumber = (raw: string): string => {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (isNo(v) || isYes(v)) return "";
  const cleaned = stripYesNoPrefix(v).replace(/[\s\-]/g, "");
  if (!/[A-Za-z]/.test(cleaned) || (cleaned.match(/\d/g) || []).length < 4) {
    return "";
  }
  return cleaned.toUpperCase();
};

/**
 * Map Newton's canonical formType (from normalizeFormType in import-cases.ts)
 * to the exact dropdown text the IRCC IMM 5710 PDF expects.
 *
 * Without this mapping, the PDF's dropdown defaults to "Start-up Business
 * Class".
 */
const deriveWorkPermitType = (formType: string): { type: string; other: string } => {
  const ft = (formType || "").toLowerCase().trim();
  if (ft === "pgwp" || ft.includes("pgwp") || ft.includes("post-graduation") || ft.includes("post graduation")) {
    return { type: "Post Graduation Work Permit", other: "" };
  }
  if (ft === "sowp" || ft.includes("sowp") || ft.includes("spousal open work")) {
    return { type: "Open Work Permit", other: "" };
  }
  if (ft === "bowp" || ft.includes("bowp") || ft.includes("bridging")) {
    return { type: "Open Work Permit", other: "" };
  }
  if (ft === "vowp" || ft.includes("vowp") || ft.includes("vulnerable")) {
    return { type: "Open Work Permit for Vulnerable Workers", other: "" };
  }
  if (ft.includes("co-op") || ft.includes("co op")) {
    return { type: "Co-op Work Permit", other: "" };
  }
  if (ft.includes("lmia exempt") || ft.includes("exemption")) {
    return { type: "Exemption from Labour Market Impact Assessment", other: "" };
  }
  if (ft.includes("lmia")) {
    return { type: "Labour Market Impact Assessment Stream", other: "" };
  }
  if (ft.includes("caregiver") || ft.includes("live-in")) {
    return { type: "Live-in Caregiver Program", other: "" };
  }
  if (ft.includes("start-up") || ft.includes("start up") || ft.includes("startup")) {
    return { type: "Start-up Business Class", other: "" };
  }
  if (ft.includes("open work")) {
    return { type: "Open Work Permit", other: "" };
  }
  return { type: "", other: "" };
};

/** Common language names — used to detect when a client mistakenly answered
 * an employment/education question with a language name. */
const LANGUAGE_NAMES = [
  "english", "french", "punjabi", "hindi", "urdu", "gujarati", "tamil",
  "telugu", "marathi", "bengali", "malayalam", "kannada", "spanish",
  "portuguese", "italian", "german", "mandarin", "cantonese", "korean",
  "japanese", "arabic", "tagalog", "vietnamese", "thai", "russian",
  "ukrainian", "polish", "turkish", "farsi", "persian", "dari", "pashto",
];

const looksLikeLanguage = (s: string): boolean => {
  const v = (s || "").toLowerCase().trim();
  if (!v) return false;
  if (isYes(v) || isNo(v)) return false;
  return v.split(/[,;]/).every((part) => {
    const word = part.trim().split(/\s+/)[0];
    return word && (LANGUAGE_NAMES.includes(word) || word.length >= 4);
  });
};

const looksLikeEmployment = (s: string): boolean => {
  const v = (s || "").trim();
  if (!v) return false;
  if (isYes(v) || isNo(v)) return false;
  if (v.length < 15) return false;
  if (LANGUAGE_NAMES.includes(v.toLowerCase())) return false;
  if (/^(yes[\s\-,]+)?(ielts|celpip|toefl|tef|tcf|pte)\b/i.test(v)) return false;
  const employmentSignals = [
    /\b(19|20)\d{2}\b/,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
    /\b(cook|chef|cashier|cleaner|driver|handler|assistant|manager|engineer|developer|operator|labourer|laborer|worker|technician|nurse|teacher|sales|clerk|server|host|barista|baker|delivery|warehouse|forklift|security|guard|janitor|maintenance|electrician|plumber|carpenter|painter|mechanic|farm|construction|retail)\b/i,
    /\b(from|to|current|present|continuing|ongoing)\b/i,
    /\bemployer\b/i,
  ];
  return employmentSignals.some((re) => re.test(v));
};

/**
 * Best-effort employment parser. Splits free-text employment answers into
 * structured entries. Used as a fallback until a Claude-based extractor
 * is wired up. Handles Newton's typical client formats well enough for v1.
 */
function parseEmploymentBestEffort(raw: string): any[] {
  if (!raw || isNo(raw)) return [];

  const monthMap: Record<string, string> = {
    jan: "01", january: "01",
    feb: "02", february: "02",
    mar: "03", march: "03",
    apr: "04", april: "04",
    may: "05",
    jun: "06", june: "06",
    jul: "07", july: "07",
    aug: "08", august: "08",
    sep: "09", september: "09", sept: "09",
    oct: "10", october: "10",
    nov: "11", november: "11",
    dec: "12", december: "12",
  };

  // Match full YYYY-MM-DD first (most specific), then YYYY-MM, then word-month dates.
  // ORDER MATTERS — the regex alternation is greedy so the longest match wins.
  // Without YYYY-MM-DD as the first alternative, "2024-05-06" matches "2024-05"
  // and leaves "-06" as a leftover token that pollutes occupation/city fields.
  //
  // For word-month, we ONLY accept actual month names (Jan, January, etc.) — not
  // ANY word followed by a year. Otherwise " to 2022" matches as a date and
  // pollutes the `to` field with a yearless date.
  const MONTH_WORDS = "Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December";
  const DATE_RE = new RegExp(
    `(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{4}[-/]\\d{1,2}|\\b\\d{0,2}\\s*(?:${MONTH_WORDS})\\s+\\d{4}|\\b(?:${MONTH_WORDS})\\s+\\d{4})`,
    "gi"
  );

  const parseMonthYear = (s: string): { year: string; month: string } => {
    const txt = s.trim();
    // YYYY-MM-DD or YYYY/MM/DD — extract just YYYY and MM
    const isoFull = txt.match(/(\d{4})[-/](\d{1,2})[-/]\d{1,2}/);
    if (isoFull) return { year: isoFull[1], month: isoFull[2].padStart(2, "0") };
    // YYYY-MM or YYYY/MM
    const iso = txt.match(/(\d{4})[-/](\d{1,2})/);
    if (iso) return { year: iso[1], month: iso[2].padStart(2, "0") };
    const wordMonth = txt.match(/(?:\d{1,2}\s*)?([A-Za-z]+)\s*(\d{4})/);
    if (wordMonth) {
      const m = monthMap[wordMonth[1].toLowerCase()];
      if (m) return { year: wordMonth[2], month: m };
    }
    const yearOnly = txt.match(/(\d{4})/);
    return { year: yearOnly ? yearOnly[1] : "", month: "" };
  };

  const isCurrent = (s: string): boolean =>
    /\b(continuing|present|current|now|ongoing|to date|till date)\b/i.test(s);

  const blocks = (() => {
    const numbered = raw.split(/\n\s*\d+[).:]\s*|\n\s*Job\s*\d+[:.\-]\s*/i);
    if (numbered.length > 1) return numbered.map((b) => b.trim()).filter(Boolean);
    const blank = raw.split(/\n\s*\n/);
    if (blank.length > 1) return blank.map((b) => b.trim()).filter(Boolean);
    const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2 && lines.every((l) => /\d{4}/.test(l))) return lines;
    return [raw.trim()];
  })();

  const entries: any[] = [];
  for (const block of blocks) {
    if (!block || isNo(block)) continue;

    const fromMatch = block.match(/[Ff]rom\s+([^,\n]+?)\s+to\s+([^,\n]+?)(?:[,\n]|$)/);
    let from = { year: "", month: "" };
    let to = { year: "", month: "" };
    let current = false;

    if (fromMatch) {
      from = parseMonthYear(fromMatch[1]);
      current = isCurrent(fromMatch[2]);
      to = current ? { year: "", month: "" } : parseMonthYear(fromMatch[2]);
    } else {
      const dates = [...block.matchAll(DATE_RE)].map((m) => m[1]);
      if (dates.length >= 1) from = parseMonthYear(dates[0]);
      if (dates.length >= 2) to = parseMonthYear(dates[1]);
      current = isCurrent(block);
      if (current) to = { year: "", month: "" };
    }

    // Strip ALL date forms cleanly so they don't pollute the remaining text.
    // Same regex as DATE_RE plus the "from X to Y" pattern. Also strip "to" when
    // it appears between two dates (e.g., "2024-05-06 to 2026-05-06" → "").
    const monthWords = "(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)";
    const noDates = block
      .replace(/[Ff]rom\s+[^,\n]+?\s+to\s+[^,\n]+?(?:[,\n]|$)/g, "")
      .replace(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(to|-)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/g, "")
      .replace(/(\d{4}[-/]\d{1,2})\s*(to|-)\s*(\d{4}[-/]\d{1,2})/g, "")
      .replace(new RegExp(`(${monthWords}\\s+\\d{4})\\s*(to|-)\\s*(${monthWords}\\s+\\d{4})`, "gi"), "")
      // Strip "<date> to <present-word>" patterns where one side is a "currently"-style word
      .replace(/(\d{4}[-/]\d{1,2}|\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(to|-)\s*(continuing|present|current|now|ongoing|to date|till date)/gi, "")
      .replace(new RegExp(`(${monthWords}\\s+\\d{4})\\s*(to|-)\\s*(continuing|present|current|now|ongoing|to date|till date)`, "gi"), "")
      .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, "")
      .replace(/\d{4}[-/]\d{1,2}/g, "")
      .replace(new RegExp(`\\b\\d{0,2}\\s*${monthWords}\\s+\\d{4}\\b`, "gi"), "")
      .replace(/\b(continuing|present|current|now|ongoing|to date|till date)\b/gi, "")
      .replace(/\bworked in\b/gi, "")
      .replace(/\bemployer[:\s]?/gi, "")
      .replace(/^\s*[,\-—]\s*/g, "")
      .replace(/\s*[,\-—]\s*$/g, "")
      .replace(/\n+/g, ", ")
      .trim();

    const parts = noDates.split(",").map((p) => p.trim().replace(/\.$/, "")).filter(Boolean);

    let occupation = "";
    let employer = "";
    let city = "";
    let prov_state = "";
    let country = "";

    if (parts.length >= 1) {
      const jobIdx = parts.findIndex((p) =>
        /\b(cook|chef|cashier|cleaner|driver|handler|assistant|manager|engineer|developer|operator|labourer|laborer|worker|technician|nurse|teacher|sales|clerk|server|host|barista|baker|delivery|warehouse|forklift|security|guard|janitor|maintenance|electrician|plumber|carpenter|painter|mechanic|farm|construction|retail|customer\s*service)\b/i.test(p)
      );
      if (jobIdx >= 0) {
        occupation = parts[jobIdx];
        const rest = parts.filter((_, i) => i !== jobIdx);
        employer = rest[0] || "";
        city = rest[1] || "";
        prov_state = rest[2] || "";
        country = rest[3] || "";
      } else {
        occupation = parts[0] || "";
        employer = parts[1] || "";
        city = parts[2] || "";
        prov_state = parts[3] || "";
        country = parts[4] || "";
      }
    }

    if (!country && /^(BC|AB|ON|QC|MB|SK|NS|NB|NL|PE|YT|NT|NU|British\s*Columbia|Alberta|Ontario|Quebec)/i.test(prov_state)) {
      country = "Canada";
    }

    if (occupation) {
      occupation = occupation
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }

    entries.push({
      from_year: from.year,
      from_month: from.month,
      to_year: to.year,
      to_month: to.month,
      is_current: current,
      occupation,
      employer,
      city,
      prov_state,
      country,
    });
  }

  return entries;
}

// ─────────────────────────────────────────────────────────────────────────
// MAPPER 1: PGWP / SOWP / BOWP / VOWP / Work Permits → IMM5710E
// ─────────────────────────────────────────────────────────────────────────
//
// CORRECTED Question flow (matches application-question-flows.ts → 'work_permit'):
//   Q1  Have you used any other name?      [Yes/No + details]
//   Q2  Marital status
//   Q3  Spouse name & marriage date         [if married]
//   Q4  Previous marriage / common-law      [Yes/No + details]
//   Q5  Mailing address
//   Q6  Residential address                 [or SAME]
//   Q7  Phone
//   Q8  Original entry — date & place
//   Q9  Purpose of original visit           [Study/Work/Visit]
//   Q10 Any recent entry?                   [Yes/No + date and reason]
//   Q11 Refused a visa/permit?              [Yes/No + details]
//   Q12 Medical history?                    [Yes/No + details]
//   Q13 Criminal history?                   [Yes/No + details]
//   Q14 Employment details                  ← was treated as education
//   Q15 Education after 12th                ← was ignored
//   Q16 Native language
//   Q17 Language test taken?
//   Q18 Plan to work in medical field?      [Yes/No]

function mapForPGWP(intake: Record<string, any>, formType: string): Record<string, any> {
  const { qN } = buildLookup(intake);
  const ft = (formType || "").toLowerCase();

  // ─── Q1: Other names (alias) ───
  const aliasRaw = qN(1);
  const hasAlias = isYes(aliasRaw);
  const aliasDetails = hasAlias ? detailsAfterYN(aliasRaw) : "";
  const aliasNameParts = hasAlias ? aliasDetails.split(/\s+/).filter(Boolean) : [];

  // ─── Q2: Marital status (NUMERIC code "01"/"02"/etc) ───
  const maritalRaw = stripPrefix(qN(2) || intake.maritalStatus || "Single");
  const maritalText = (() => {
    const v = maritalRaw.toLowerCase();
    if (v.startsWith("mar")) return "Married";
    if (v.startsWith("com")) return "Common-Law";
    if (v.startsWith("div")) return "Divorced";
    if (v.startsWith("wid")) return "Widowed";
    if (v.startsWith("sep")) return "Separated";
    return "Single";
  })();
  const maritalCode = textToMaritalCode(maritalText) || "02"; // "02" = Single fallback
  const isMarried = maritalText === "Married" || maritalText === "Common-Law";

  // ─── Q3: Spouse details (only fill if married/common-law) ───
  const spouseRaw = qN(3);
  const spouseProvided = isMarried && !isNo(spouseRaw) && spouseRaw.toLowerCase() !== "na";
  const spouseParts = spouseProvided ? spouseRaw.split(",").map((p) => p.trim()) : [];
  const spouseName = spouseParts[0] || "";
  const spouseNameParts = spouseName.split(/\s+/).filter(Boolean);

  // ─── Q4: Previous marriage (default NO) ───
  const prevRaw = qN(4);
  const hasPrev = isYes(prevRaw);
  const prevDetails = hasPrev ? detailsAfterYN(prevRaw) : "";
  const prevParts = hasPrev ? prevDetails.split(/[,;]+/).map((p) => p.trim()) : [];
  const prevSpouseNameParts = (prevParts[0] || "").split(/\s+/).filter(Boolean);

  // ─── Q5/Q6: Addresses ───
  const mailing = parseAddress(qN(5) || intake.address || "");
  const resRaw = qN(6);
  const resSame = isNo(resRaw) || resRaw.toLowerCase().includes("same") || !resRaw;
  const residential = resSame ? mailing : parseAddress(resRaw);

  // Convert mailing province/country to NUMERIC codes
  const mailingProvCode = textToProvinceCode(mailing.province);
  const mailingCountryCode = textToCountryCode("Canada"); // PGWP applicants are in Canada

  // ─── Q7: Phone (mobile = code 02) ───
  const phone = parsePhone(qN(7) || intake.phone || "");
  const phoneTypeCode = textToPhoneTypeCode("mobile");

  // ─── Q8/Q9: Original entry to Canada ───
  const entryRaw = qN(8);
  const entryParts = entryRaw.split(",").map((p) => p.trim());
  const originalEntryDate = entryParts[0] || intake.originalEntryDate || "";
  const originalEntryPlace = entryParts[1] || "";

  const purposeRaw = (qN(9) || "").toLowerCase();
  const purposeText =
    purposeRaw.includes("stud") ? "Study" :
    purposeRaw.includes("work") ? "Work" :
    purposeRaw.includes("visit") || purposeRaw.includes("tour") ? "Tourism" :
    "Study"; // PGWP applicants are almost always study-permit holders
  const purposeCode = textToVisitPurposeCode(purposeText);

  // ─── Q10: Recent entry (only fill if YES or if a date is present) ───
  // Older logic required isYes(recentRaw), which meant a client typing just
  // "2025-12-31" (a clear positive answer with date) was ignored. Now we
  // also treat any raw answer containing a date as a positive answer.
  const recentRaw = qN(10);
  const recentDateInRaw = recentRaw.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
  const hasRecentEntry = isYes(recentRaw) || !!recentDateInRaw;
  const recentDetails = hasRecentEntry ? stripYesNoPrefix(recentRaw) : "";
  const recentParts = hasRecentEntry ? recentDetails.split(",").map((p) => p.trim()) : [];
  const datePattern = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/;
  // Check first part as date, OR fall back to any date found anywhere in raw
  const recentDateCandidate = recentParts[0] || "";
  const recentEntryDate = datePattern.test(recentDateCandidate)
    ? recentDateCandidate
    : (recentDateInRaw ? recentDateInRaw[1] : "");
  const recentEntryPlace = recentEntryDate
    ? (recentParts.slice(1).join(", ").trim() || "")
    : (recentParts[0] || "");

  // ─── Q11/Q12/Q13: Background — DEFAULT NO ───
  const refusalRaw = qN(11);
  const hasRefusal = isYes(refusalRaw);
  const medicalRaw = qN(12);
  const hasMedical = isYes(medicalRaw);
  const criminalRaw = qN(13);
  const hasCriminal = isYes(criminalRaw);

  // ─── Q14: Employment + Q15: Education ───
  // For PGWP, Education = the Canadian DLI program completed (not highest after 12th).
  const employmentRaw = qN(14);
  const educationRaw = qN(15);
  const additionalNotes = stripPrefix(intake.additionalNotes || "");

  const employmentLooksValid = looksLikeEmployment(employmentRaw);
  const educationLooksLikeEmployment = looksLikeEmployment(educationRaw);

  const employmentSources: string[] = [];
  if (employmentLooksValid) employmentSources.push(employmentRaw);
  if (educationLooksLikeEmployment) employmentSources.push(educationRaw);
  if (additionalNotes && looksLikeEmployment(additionalNotes)) employmentSources.push(additionalNotes);

  const realJobs = employmentSources.length > 0
    ? parseEmploymentBestEffort(employmentSources.join("\n"))
    : [];

  // ─── EMPLOYMENT LEGAL COMPLIANCE (PGWP-specific) ───
  // After completion-letter date, applicant is NOT allowed to work until PGWP approved.
  // 1. Cap real jobs at completion-letter date (if known).
  // 2. Add an "Unemployed / N/A" entry from completion date to current.
  //
  // Source priority for completion date:
  //   1. Explicit intake.completionLetterDate (best — from completion letter doc)
  //   2. Education end date from Q15 — if client typed "2024-05 to 2026-05",
  //      use 2026-05 as proxy. Imperfect but correct in practice for PGWP cases
  //      (program end ≈ completion letter date for most DLIs).
  let completionLetterDate = intake.completionLetterDate || "";
  if (!completionLetterDate && educationRaw && !isNo(educationRaw)) {
    // Find a year-month range in the education answer; take the LATER date as program-end.
    const eduDateRange = educationRaw.match(/(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?\s*(?:to|-)\s*(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/);
    if (eduDateRange) {
      const endYear = eduDateRange[3];
      const endMonth = eduDateRange[4].padStart(2, "0");
      completionLetterDate = `${endYear}-${endMonth}-01`;
    }
  }
  const completionYear = completionLetterDate.slice(0, 4);
  const completionMonth = completionLetterDate.slice(5, 7);

  const cappedJobs = realJobs.map((j: any) => {
    if (completionYear && (!j.to_year || j.to_year > completionYear)) {
      return { ...j, to_year: completionYear, to_month: completionMonth || j.to_month || "" };
    }
    return j;
  });

  const cityForEmployment = residential.city || mailing.city || "";
  const provForEmployment = textToProvinceCode(residential.province || mailing.province) || "";
  const unemployedEntry = completionLetterDate ? {
    from_year: completionYear,
    from_month: completionMonth || "01",
    occupation: "Unemployed",
    employer: "N/A",
    city: cityForEmployment,
    country: "511",            // Canada (numeric)
    prov_state: provForEmployment,
    to_year: "",
    to_month: "",
  } : null;

  // Order matters: filler maps employment[0] → EmpRec1 (most-recent slot on
  // the form). Unemployed entry is the *current* state, so it goes FIRST,
  // followed by older real jobs in EmpRec2/EmpRec3. Verified against Paras's
  // filed form: EmpRec1 = Unemployed, with prior real jobs in subsequent slots.
  const employment = unemployedEntry ? [unemployedEntry, ...cappedJobs] : cappedJobs;

  // ─── Education: Canadian program (PGWP) ───
  const educationLooksValid = !educationLooksLikeEmployment && !!educationRaw && !isNo(educationRaw);
  const eduParts = educationLooksValid ? educationRaw.split(",").map((p: string) => p.trim()) : [];
  const eduYears = educationLooksValid ? (educationRaw.match(/(20\d{2})/g) || []) : [];

  // ─── Q16: Native language (NUMERIC code) ───
  // ─── Smart Q-index resolution for PGWP ───
  // OLD PGWP layout: q15=native_lang, q16=lang_test, q17=medical_field
  // NEW PGWP layout (added 2026-05): q15=same_college (Yes/No), q16=native_lang,
  //                                  q17=lang_test, q18=medical_field
  //
  // Detect by checking: does q15 look like a language? if yes → OLD layout.
  // Does q16 look like a language? → NEW layout.
  // This means new and old cases both work without hardcoding shifts everywhere.
  const q15Maybe = qN(15);
  const q16Maybe = qN(16);
  const q17Maybe = qN(17);
  const q18Maybe = qN(18);

  // Detect layout
  const newLayout = looksLikeLanguage(q16Maybe) && !looksLikeLanguage(q15Maybe);
  const oldLayout = looksLikeLanguage(q15Maybe) && !looksLikeLanguage(q16Maybe);

  // Same-college: only set if NEW layout AND q15 is Yes/No-shaped
  const sameCollegeRaw = newLayout && (isYes(q15Maybe) || isNo(q15Maybe)) ? q15Maybe : "";
  const sameCollegeAnswer = isYes(sameCollegeRaw) ? "Yes"
                          : isNo(sameCollegeRaw) ? "No"
                          : "";

  // Native language — smart pick
  const nativeLangRaw = newLayout ? q16Maybe : (oldLayout ? q15Maybe : (q16Maybe || q15Maybe));
  const q16Raw = nativeLangRaw; // alias kept for downstream code
  const nativeLangText = looksLikeLanguage(nativeLangRaw) ? nativeLangRaw.split(/[,;]/)[0].trim() : "";
  const nativeLangCode = textToLanguageCode(nativeLangText);

  // ─── Language test — DEFAULT YES (PGWP requires it) ───
  // NEW layout: q17. OLD layout: q16. Other (study perm ext, etc): q17.
  const langTestRaw = newLayout ? q17Maybe : (oldLayout ? q16Maybe : q17Maybe);
  const langTest = !isNo(langTestRaw); // YES unless they explicitly said NO
  const langTestDetails = langTest ? detailsAfterYN(langTestRaw) : "";

  // ─── Plan to work in medical field ───
  const medicalFieldRaw = newLayout ? q18Maybe : (oldLayout ? q17Maybe : q18Maybe);
  const planMedicalField = isYes(medicalFieldRaw);

  // ─── Work permit type (PGWP / SOWP / etc — text dropdown) ───
  const wpType = deriveWorkPermitType(formType);

  // ─── Place of birth: combine city + state ("Karnal, Haryana") ───
  const birthCity = stripPrefix(intake.placeOfBirthCity || intake.cityOfBirth || "");
  const birthState = stripPrefix(intake.placeOfBirthState || intake.stateOfBirth || "");
  const placeBirthCombined = birthState ? `${birthCity}, ${birthState}` : birthCity;

  // ─── Country codes (numeric) ───
  const birthCountryText = stripPrefix(intake.countryOfBirth || "India");
  const birthCountryCode = textToCountryCode(birthCountryText);
  const citizenshipText = stripPrefix(intake.citizenship || birthCountryText);
  const citizenshipCode = textToCountryCode(citizenshipText);

  // ─── Current status: PGWP applicants are currently STUDENTS ───
  // Dates from study permit (start → expiry).
  const currentStatusCode = textToStatusCode("Student"); // "05"
  const currentStatusFrom = intake.studyPermitStartDate || originalEntryDate;
  // currentStatusTo: prefer studyPermitExpiryDate, fall back to workPermitExpiryDate.
  // Critically, NEVER default to today's date — leaving this empty is much better
  // than writing today's date as the permit expiry, which is wrong and confusing.
  const currentStatusTo = intake.studyPermitExpiryDate
    || intake.workPermitExpiryDate
    || "";

  // ─── Review flags for staff to inspect before submitting ───
  const reviewFlags: string[] = [];
  if (!employmentLooksValid && employmentRaw && !isNo(employmentRaw)) {
    reviewFlags.push(`Q14 employment doesn't look like job details: "${employmentRaw}"`);
  }
  if (!educationLooksValid && educationRaw && !isNo(educationRaw) && !educationLooksLikeEmployment) {
    reviewFlags.push(`Q15 education doesn't look like education details: "${educationRaw}"`);
  }
  if (q16Raw && !looksLikeLanguage(q16Raw)) {
    reviewFlags.push(`Q16 native language looks suspicious: "${q16Raw}"`);
  }
  if (!completionLetterDate) {
    reviewFlags.push(`Completion letter date missing — employment section will be incomplete`);
  }
  if (!intake.uci) {
    reviewFlags.push(`UCI number missing — extract from study permit document and add to case`);
  }
  if (!intake.studyPermitExpiryDate) {
    reviewFlags.push(`Study permit expiry date missing — current status To-date will be empty`);
  }
  if (sameCollegeAnswer === "No") {
    reviewFlags.push(`Client transferred from previous college — make sure old-college docs (completion letter, transcripts, LOA) are uploaded; they get bundled into Client_Info`);
  }
  if (planMedicalField) {
    reviewFlags.push(`Client plans to work in medical field — Immigration Medical Exam (IME) likely required before submission`);
  }
  // Inadmissibility questions not asked in the PGWP intake are defaulted to "No".
  // A wrong "No" here is a misrepresentation / refusal risk — staff must confirm.
  reviewFlags.push(`Confirm background Qs not asked in intake (defaulted "No"): military service, government/public position, witnessing ill-treatment of persons.`);
  // Ambiguous admissibility answers (neither a clean Yes nor No) silently default to
  // "No" on the form — surface them so a real disclosure isn't dropped.
  if (refusalRaw && !isYes(refusalRaw) && !isNo(refusalRaw)) {
    reviewFlags.push(`Q11 (prior refusal/removal) is ambiguous — form defaulted to "No": "${refusalRaw}". Verify before submitting.`);
  }
  if (criminalRaw && !isYes(criminalRaw) && !isNo(criminalRaw)) {
    reviewFlags.push(`Q13 (criminal history) is ambiguous — form defaulted to "No": "${criminalRaw}". Verify before submitting.`);
  }
  if (medicalRaw && !isYes(medicalRaw) && !isNo(medicalRaw)) {
    reviewFlags.push(`Q12 (medical condition) is ambiguous — form defaulted to "No": "${medicalRaw}". Verify before submitting.`);
  }
  // The IMM5710 has 3 employment slots; a PGWP needs a gap-free 10-year history.
  // If parsed entries exceed the slots, the extras are dropped — flag for a continuation sheet.
  const EMPLOYMENT_SLOTS = 3;
  if (employment.length > EMPLOYMENT_SLOTS) {
    reviewFlags.push(`Employment history has ${employment.length} entries but the form has only ${EMPLOYMENT_SLOTS} slots — attach a continuation sheet for the overflow (last 10 years must have no gaps).`);
  }

  return {
    ...buildIdentitySection(intake),

    // ── Section 1: Application type ──
    // PGWP = applying for a NEW work permit (XFA NewEmployer=1, despite the misleading
    // name — it actually means "applying for new permit / change conditions").
    applying_restore_status: ft.includes("restore"),
    applying_extend_stay: false, // PGWP is NOT an extension of an existing permit
    applying_change_employer: !ft.includes("restore") && !ft.includes("trp"),
    applying_trp: ft.includes("trp"),

    // UCI from study permit (staff fills this on the case if missing from intake)
    uci_client_id: stripPrefix(intake.uci || ""),
    // "I want service in" — IRCC code "01" = English. Newton's clients always
    // pick English. Setting it explicitly avoids the dropdown rendering blank.
    service_in_language: "01",

    // ── Q1: Other names (alias) ──
    has_alias: hasAlias,
    alias_family_name: aliasNameParts.length > 1 ? aliasNameParts[aliasNameParts.length - 1] : "",
    alias_given_name: aliasNameParts.length > 1
      ? aliasNameParts.slice(0, -1).join(" ")
      : (aliasNameParts[0] || ""),

    // ── Section 2: Personal — birth city includes state, country uses NUMERIC code ──
    place_birth_city: placeBirthCombined,
    place_birth_country: birthCountryCode,
    citizenship_country: citizenshipCode,
    // Passport country must also be numeric — buildIdentitySection sets it as
    // text by default; verified against Paras's filed form (= "205" for India).
    passport_country: citizenshipCode,

    // ── Q2-Q4: Marital — NUMERIC code ──
    marital_status: maritalCode,
    spouse_family_name: spouseNameParts.length > 1
      ? spouseNameParts[spouseNameParts.length - 1] : "",
    spouse_given_name: spouseNameParts.length > 1
      ? spouseNameParts.slice(0, -1).join(" ")
      : (spouseNameParts[0] || ""),
    date_of_marriage: spouseProvided ? normalizeDate(spouseParts[1] || "") : "",
    spouse_status_in_canada: "",
    spouse_canadian_citizen_or_pr: false, // default NO (most clients)
    previously_married: hasPrev,
    prev_spouse_family_name: prevSpouseNameParts.length > 1
      ? prevSpouseNameParts[prevSpouseNameParts.length - 1] : "",
    prev_spouse_given_name: prevSpouseNameParts.length > 1
      ? prevSpouseNameParts.slice(0, -1).join(" ")
      : (prevSpouseNameParts[0] || ""),
    prev_relationship_type: hasPrev ? "Married" : "",
    prev_marriage_from: hasPrev ? normalizeDate(prevParts[2] || "") : "",
    prev_marriage_to: hasPrev ? normalizeDate(prevParts[3] || "") : "",

    // ── Section 3: Status in Canada (PGWP applicant = currently Student) ──
    current_status: currentStatusCode,           // "05" = Student
    current_status_country: mailingCountryCode,  // "511" = Canada
    current_status_from_date: normalizeDate(currentStatusFrom),
    current_status_to_date: normalizeDate(currentStatusTo),
    // Q8 of form: "Have you lived in any country other than your country of
    // citizenship or current residence for more than 6 months in the past 5 years?"
    // We default to NO ("N") when no prev_country_1 is set — this ticks the
    // No box on the form. Previously the indicator was just `false` which
    // didn't render any tick at all.
    prev_country_indicator: !!intake.previousCountries && !isNo(intake.previousCountries),

    // ── Section 5: Languages — defaults ──
    native_language: nativeLangCode,             // numeric (e.g. 324 Punjabi, 321 Hindi)
    native_language_text: nativeLangText,        // human-readable for display
    communicate_language: "English",             // ALWAYS English for IRCC service
    prefer_service_language: "English",
    language_test_taken: langTest,               // DEFAULT YES (PGWP requirement)
    language_test_details: langTestDetails,
    // "Which language are you most at ease in" — IRCC form only accepts English
    // or French. We always pick English regardless of native language. Previously
    // this used nativeLangText which produced things like "Hindi" — invalid value.
    frequent_language: "English",

    // ── Section 6: Documents — DEFAULT NO ──
    taiwan_passport: false,
    israeli_passport: false,
    has_national_id: false,
    has_us_card: false,

    // Document number — sanitized
    previous_doc_number: sanitizeDocumentNumber(intake.previousDocNumber || ""),
    work_permit_type: wpType.type,
    work_permit_type_other: wpType.other,

    // ── Section 7: Address & phone — client's actual ──
    mailing_apt_unit: mailing.apt_unit,
    mailing_street_num: mailing.street_num,
    mailing_street_name: mailing.street_name,
    mailing_city: mailing.city,
    mailing_province: mailingProvCode,           // NUMERIC (e.g. "11" = BC)
    mailing_postal_code: mailing.postal_code,
    mailing_country: mailingCountryCode,         // NUMERIC "511" = Canada
    residential_same_as_mailing: resSame,
    residential_apt_unit: resSame ? "" : residential.apt_unit,
    residential_street_num: resSame ? "" : residential.street_num,
    residential_street_name: resSame ? "" : residential.street_name,
    residential_city: resSame ? "" : residential.city,
    residential_province: resSame ? "" : textToProvinceCode(residential.province),
    phone_type: phoneTypeCode,                   // NUMERIC "02" = Cellular
    phone_number_type: "Mobile",
    phone_canada_us: "1",
    phone_area_code: phone.area_code,
    phone_first_three: phone.first_three,
    phone_last_five: phone.last_five,
    phone_actual_number: `${phone.area_code}${phone.first_three}${phone.last_five}`,
    email: NEWTON_EMAIL,                         // HARDCODED — IRCC mail to Newton

    // ── Section 8: Original entry ──
    original_entry_date: normalizeDate(originalEntryDate),
    original_entry_place: originalEntryPlace,
    original_entry_purpose: purposeCode,         // NUMERIC "04" = Study

    // Recent entry — only filled if YES
    recent_entry_date: recentEntryDate,
    recent_entry_place: recentEntryPlace,

    // ── Section 9: Education (PGWP = Canadian DLI program) ──
    has_education: educationLooksValid,
    edu_school_name: educationLooksValid ? (eduParts[0] || "") : "",
    edu_field_of_study: educationLooksValid ? (eduParts[1] || "") : "",
    edu_city: educationLooksValid ? (eduParts[2] || "") : "",
    edu_country: educationLooksValid ? textToCountryCode("Canada") : "", // PGWP = Canada
    edu_province: educationLooksValid ? textToProvinceCode(eduParts[3] || "") : "",
    edu_from_year: educationLooksValid ? (eduYears[0] || "") : "",
    edu_from_month: educationLooksValid ? "09" : "",
    edu_to_year: educationLooksValid ? (eduYears[1] || "") : "",
    edu_to_month: educationLooksValid ? "06" : "",

    // ── Section 10: Employment (with legal compliance) ──
    employment,

    // ── Section 11: Background — DEFAULT NO ──
    has_medical_condition: hasMedical || planMedicalField,
    medical_details: hasMedical
      ? detailsAfterYN(medicalRaw) + (planMedicalField ? " | Plans to work in medical field" : "")
      : (planMedicalField ? "Plans to work in medical field" : ""),
    prev_application_refused: hasRefusal,
    prev_refused_to_canada: hasRefusal && refusalRaw.toLowerCase().includes("canada"),
    prev_refused_details: hasRefusal ? detailsAfterYN(refusalRaw) : "",
    has_criminal_record: hasCriminal,
    criminal_details: hasCriminal ? detailsAfterYN(criminalRaw) : "",
    has_military_service: false,
    held_government_position: false,
    witnessed_ill_treatment: false,

    // ── Review hooks — staff sees these before submitting ──
    _review_flags: reviewFlags,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MAPPER 2: Study Permit Extension → IMM5709E
// ─────────────────────────────────────────────────────────────────────────
//
// ─────────────────────────────────────────────────────────────────────────
// MAPPER 2: Study Permit Extension → IMM5709E
// ─────────────────────────────────────────────────────────────────────────
//
// LEAN flow ('study_permit_extension' — 22 questions, qN 1-indexed):
//   Q1  Upload-prompt acknowledgment ("done" / "ok")
//   Q2  Alias (Yes/No + name)
//   Q3  Marital status
//   Q4  Spouse details + spouse-in-Canada status (only if married)
//   Q5  Previously married (Yes/No + details)
//   Q6  Mailing address in Canada
//   Q7  Phone + email
//   Q8  Same college since last permit? (drives PAL exemption)
//   Q9  If changed college: Canada history explanation
//   Q10 Reason for extension
//   Q11 Graduate program (Master's/PhD)? (drives PAL exemption)
//   Q12 Funds: total + source + room/board + other costs
//   Q13 Co-op or open work permit alongside study?
//   Q14 First entry to Canada (date, place, purpose)
//   Q15 Past education before current Canada studies
//   Q16 Employment history
//   Q17 Travel history last 5 years
//   Q18 Maintained full-time enrollment?
//   Q19 Refusals
//   Q20 Criminal/medical
//   Q21 Background (military / govt / ill treatment)
//   Q22 Native language
//
// OLD flow (14 questions) is also supported via layout detection — old cases
// with name/passport in qN(1)..qN(7) still parse correctly.
//
// Identity fields (name, DOB, passport, UCI, school, PAL etc.) come from
// intake.* fields populated by OCR — NOT from typed questions in LEAN flow.

// Map free-text study level from LOA to IRCC dropdown options.
// IMM5709 enum: Primary School | Secondary School | PTC/TCST/DVS/AVS |
// CEGEP - Pre-university | CEGEP - Technical | College - Certificate |
// College - Diploma | College - Applied degree |
// University - Bachelor's Deg. | University - Master's Deg. | University - Doctorate |
// University - Other Studies | ESL/FSL | ESL/FSL and College | ESL/FSL and University
function normalizeStudyLevel(raw: string): string {
  if (!raw) return "";
  const v = raw.toLowerCase();
  if (/master|\bmba\b|\bmsc\b|\bma\b\s*$|m\.\s*sc/i.test(raw)) return "University - Master's Deg.";
  if (/phd|doctorate|doctoral|ph\.\s*d/i.test(raw)) return "University - Doctorate";
  if (/bachelor|undergrad|associate|\bbsc\b|\bba\b\s*$|b\.\s*sc/i.test(raw)) return "University - Bachelor's Deg.";
  if (/post.?graduate.{0,10}(certificate|diploma)|\bpg\b/i.test(raw)) return "College - Certificate";
  if (/diploma/i.test(v)) return "College - Diploma";
  if (/certificate/i.test(v)) return "College - Certificate";
  if (/cegep.*pre.*university/i.test(v)) return "CEGEP - Pre-university";
  if (/cegep.*technical/i.test(v)) return "CEGEP - Technical";
  if (/esl|fsl|english.{0,5}second.{0,5}language|french.{0,5}second.{0,5}language/i.test(v)) return "ESL/FSL";
  if (/secondary|high\s*school/i.test(v)) return "Secondary School";
  if (/primary|elementary/i.test(v)) return "Primary School";
  if (/university/i.test(v)) return "University - Other Studies";
  return ""; // unmapped — review flag will surface
}

// Map free-text study field from LOA to IRCC dropdown options.
// IMM5709 enum: Arts/Humanities/Social Science | Arts, Fine/Visual/Performing |
// Business/Commerce | Computing/IT | ESL/FSL | Flight Training | Hospitality/Tourism |
// Law | Medicine | Science, Applied | Sciences, General | Sciences, Health |
// Trades/Vocational | Theology/Religious Studies | Other
function normalizeStudyField(raw: string): string {
  if (!raw) return "";
  const v = raw.toLowerCase();
  // Order matters — more specific matches first.
  if (/hospitality|tourism|culinary|hotel/i.test(v)) return "Hospitality/Tourism";
  if (/comput|software|\bit\b|information\s+tech|programming|data\s+sci|cybersec/i.test(v)) return "Computing/IT";
  if (/nurs|medic|pharm|health|dent|veterin/i.test(v)) return "Sciences, Health";
  if (/engin/i.test(v)) return "Science, Applied";
  if (/law|legal|paralegal/i.test(v)) return "Law";
  if (/trade|vocation|welding|plumb|electric|construct|automotive|hvac|mechanic/i.test(v)) return "Trades/Vocational";
  if (/flight|aviation|pilot/i.test(v)) return "Flight Training";
  if (/art|design|media|film|theatre|music|visual|fine/i.test(v)) return "Arts, Fine/Visual/Performing";
  if (/theology|religion|divinity/i.test(v)) return "Theology/Religious Studies";
  if (/business|commerce|\bmba\b|finance|account|management|marketing|economics|admin/i.test(v)) return "Business/Commerce";
  if (/social|sociology|psychology|history|political|humanit/i.test(v)) return "Arts/Humanities/Social Science";
  if (/science/i.test(v)) return "Sciences, General";
  if (/esl|fsl/i.test(v)) return "ESL/FSL";
  return "Other";
}

function mapForStudyPermitExtension(intake: Record<string, any>, formType: string): Record<string, any> {
  const { qN } = buildLookup(intake);

  // ─── Smart layout detection (2 generations) ───
  // OLD (14 Q): qN(1)=alias YES/NO, qN(2)=marital, qN(3)=address, qN(4)=phone,
  //   qN(5)=permit#+expiry, qN(6)=institution, qN(7)=program, qN(8)=changing-college,
  //   qN(9)=changing-program, qN(10)=reason, qN(11)=full-time, qN(12)=refusal,
  //   qN(13)=medical, qN(14)=criminal
  // LEAN (22 Q): qN(1)=upload-ack, qN(2)=alias, qN(3)=marital, qN(4)=spouse,
  //   qN(5)=prev-married, qN(6)=address, qN(7)=phone+email, qN(8)=same-college,
  //   qN(9)=changed-school-explanation, qN(10)=reason, qN(11)=graduate?, qN(12)=funds,
  //   qN(13)=coop-wp, qN(14)=entry, qN(15)=past-edu, qN(16)=employment,
  //   qN(17)=travel-history, qN(18)=full-time, qN(19)=refusal,
  //   qN(20)=criminal+medical, qN(21)=background, qN(22)=native-lang
  const q1 = qN(1);
  const q1Trimmed = q1.trim().toLowerCase();
  // Upload ack: must be a SHORT standalone confirmation. If it's "yes - <details>"
  // or "yes, <name>" then it's an alias answer (OLD layout), not an upload ack.
  const q1LooksLikeUploadAck = q1Trimmed.length > 0 && q1Trimmed.length <= 20 &&
    /^(done|ok|okay|yes|uploaded|sent|finished|complete|all done|all uploaded)$/.test(q1Trimmed);
  const intakeHasIdentity = !!(intake.firstName || intake.lastName || intake.passportNumber);

  let layout: "OLD" | "LEAN";
  if (q1LooksLikeUploadAck) {
    layout = "LEAN";
  } else if (!q1Trimmed && intakeHasIdentity) {
    layout = "LEAN";
  } else if (intakeHasIdentity && qN(2) && /^(yes|no)\b/i.test(qN(2).trim()) && qN(3) && /single|married|common|divorced|widowed|separated/i.test(qN(3))) {
    // intake has OCR identity + q2 looks like alias YES/NO + q3 looks like marital status → LEAN
    layout = "LEAN";
  } else {
    layout = "OLD";
  }

  // Position-aware Q getter — returns "" for any field not asked in the layout
  const Q = layout === "LEAN" ? {
    alias:        qN(2),
    marital:      qN(3),
    spouse:       qN(4),
    prevMarriage: qN(5),
    address:      qN(6),
    phoneEmail:   qN(7),
    sameCollege:  qN(8),
    canadaHistory: qN(9),
    extReason:    qN(10),
    graduate:     qN(11),
    funds:        qN(12),
    coopWp:       qN(13),
    entry:        qN(14),
    pastEdu:      qN(15),
    employment:   qN(16),
    travelHist:   qN(17),
    fullTime:     qN(18),
    refusal:      qN(19),
    crimMed:      qN(20),
    background:   qN(21),
    nativeLang:   qN(22),
  } : { // OLD
    alias:        qN(1),
    marital:      qN(2),
    spouse:       "",
    prevMarriage: "",
    address:      qN(3),
    phoneEmail:   qN(4),
    sameCollege:  qN(8) ? (isYes(qN(8)) ? "No" : "Yes") : "Yes", // Q8 = "are you CHANGING colleges?" — invert
    canadaHistory: qN(8),
    extReason:    qN(10),
    graduate:     "",
    funds:        "",
    coopWp:       "",
    entry:        "",
    pastEdu:      "",
    employment:   "",
    travelHist:   "",
    fullTime:     qN(11),
    refusal:      qN(12),
    crimMed:      qN(13) + " " + qN(14),
    background:   "",
    nativeLang:   "",
  };

  // ─── Identity (LEAN: from OCR'd intake; OLD: same fallback) ───
  const familyName = (intake.lastName || "").toUpperCase();
  const givenName = (intake.firstName || "").toUpperCase();

  // ─── Alias ───
  const hasAlias = isYes(Q.alias);
  const aliasDetails = hasAlias ? detailsAfterYN(Q.alias) : "";
  const aliasFirstName = aliasDetails.split(/[\s,]/)[0] || "";
  const aliasLastName = aliasDetails.split(/[\s,]/).slice(1).join(" ") || "";

  // ─── Marital + spouse + prev marriage ───
  const maritalRaw = stripPrefix(Q.marital || intake.maritalStatus || "Single");
  const marital = (() => {
    const v = maritalRaw.toLowerCase();
    if (v.startsWith("mar")) return "Married";
    if (v.startsWith("com")) return "Common-Law";
    if (v.startsWith("div")) return "Divorced";
    if (v.startsWith("wid")) return "Widowed";
    if (v.startsWith("sep")) return "Separated";
    return "Single";
  })();
  const isMarried = marital === "Married" || marital === "Common-Law";
  // Spouse parts: name, DOB, citizenship, marriage date, spouse-in-Canada(Yes/No), spouse-status
  const spouseParts = isMarried && !isNo(Q.spouse) ? Q.spouse.split(",").map((p) => p.trim()) : [];
  const previouslyMarried = isYes(Q.prevMarriage);
  const prevMarriageDetails = previouslyMarried ? detailsAfterYN(Q.prevMarriage) : "";
  const prevSpouseParts = prevMarriageDetails.split(",").map((p) => p.trim());

  // Spouse in Canada — find the part containing "yes/no" or status keywords
  const spouseInCanada = (() => {
    if (!isMarried || spouseParts.length === 0) return "";
    // Try to find a part that says Yes/No about being in Canada
    for (const p of spouseParts) {
      if (/canada/i.test(p)) return /yes|in\s+canada/i.test(p) ? "Yes" : "No";
    }
    return "";
  })();

  // ─── Address + phone + email ───
  const mailing = parseAddress(Q.address);
  const phoneEmailRaw = Q.phoneEmail;
  const emailMatch = phoneEmailRaw.match(/[\w.-]+@[\w.-]+\.\w+/);
  const emailFromQ = emailMatch ? emailMatch[0] : "";
  const phoneStr = emailFromQ ? phoneEmailRaw.replace(emailFromQ, "").trim() : phoneEmailRaw;
  const phone = parsePhone(phoneStr);

  // ─── Same college continuity (drives PAL exemption) ───
  const sameCollege = isYes(Q.sameCollege);
  const isGraduateProgram = isYes(Q.graduate);

  // ─── Funds parser ───
  // Format: "Total: 25000 CAD; Source: Self; Room/board: 12000; Other: 3000"
  const fundsRaw = Q.funds;
  const fundsAmount = (fundsRaw.match(/\b(\d[\d,]*)\b/g) || [])[0]?.replace(/,/g, "") || "";
  // Source — find token like Self/Parents/Sponsor/Scholarship/GIC/Other
  const fundsSource = (() => {
    const m = fundsRaw.toLowerCase();
    if (m.includes("scholar")) return "Scholarship";
    if (m.includes("sponsor")) return "Sponsor";
    if (m.includes("parent")) return "Parents";
    if (m.includes("gic")) return "GIC";
    if (m.includes("self")) return "Myself";
    if (m.includes("other")) return "Other";
    return "Myself";
  })();
  // Room/board cost
  const roomBoardMatch = fundsRaw.match(/room.{0,15}\b(\d[\d,]*)/i);
  const roomBoardCost = roomBoardMatch ? roomBoardMatch[1].replace(/,/g, "") : "";
  const otherCostsMatch = fundsRaw.match(/other.{0,15}\b(\d[\d,]*)/i);
  const otherCosts = otherCostsMatch ? otherCostsMatch[1].replace(/,/g, "") : "";

  // ─── Co-op work permit ───
  const applyingForWp = isYes(Q.coopWp);
  const wpType = (() => {
    if (!applyingForWp) return "";
    const v = Q.coopWp.toLowerCase();
    if (v.includes("co-op") || v.includes("coop")) return "Co-op Work Permit";
    if (v.includes("post grad") || v.includes("pgwp")) return "Post Graduation Work Permit";
    return "Open Work Permit";
  })();

  // ─── Entry to Canada ───
  // Format: "2023-09-01, Toronto Pearson, Study"
  const entryParts = Q.entry.split(",").map((p) => p.trim());
  const originalEntryDate = entryParts[0] || "";
  const originalEntryPlace = entryParts[1] || "";
  const originalEntryPurpose = (() => {
    const v = (entryParts[2] || "Study").toLowerCase();
    if (v.startsWith("stud")) return "Study";
    if (v.startsWith("work")) return "Work";
    if (v.startsWith("vis") || v.startsWith("tour")) return "Tourism";
    if (v.startsWith("fam")) return "Family Visit";
    return "Study";
  })();

  // ─── Past education (1 row) ───
  // Format: "2018-09, 2022-06, Computer Science, Surat University, Surat, India"
  const pastEduRaw = Q.pastEdu;
  const hasPastEdu = pastEduRaw && !isNo(pastEduRaw);
  const eduParts = hasPastEdu ? pastEduRaw.split(",").map((p) => p.trim()) : [];
  const eduFromYM = eduParts[0] || "";
  const eduToYM = eduParts[1] || "";
  const eduField = eduParts[2] || "";
  const eduSchool = eduParts[3] || "";
  const eduCity = eduParts[4] || "";
  const eduCountry = eduParts[5] || "";

  // ─── Employment ───
  // Use existing parser if available (parseEmploymentBestEffort)
  let employmentArr: any[] = [];
  try {
    employmentArr = (typeof parseEmploymentBestEffort === "function")
      ? parseEmploymentBestEffort(Q.employment).slice(0, 3)
      : [];
  } catch { employmentArr = []; }

  // ─── Background block ───
  const refusalRaw = Q.refusal;
  const hasRefusal = isYes(refusalRaw);
  const crimMedRaw = Q.crimMed;
  const hasCriminal = /criminal/i.test(crimMedRaw) && isYes(crimMedRaw);
  const hasMedical = /medical/i.test(crimMedRaw) && isYes(crimMedRaw);

  const bgRaw = Q.background;
  const allNoBg = /^\s*(no|none|n\/a|na)\s*$/i.test(bgRaw.trim());
  const hasMilitary = !allNoBg && /(military|militia|armed|army|forces|served)/i.test(bgRaw) && isYes(bgRaw);
  const heldGovt = !allNoBg && /(government|political|public office|civil service|police officer|judge)/i.test(bgRaw) && isYes(bgRaw);
  const witnessedIll = !allNoBg && /(witness|ill\s*treat|war|genocide|atrocit|abuse)/i.test(bgRaw) && isYes(bgRaw);

  const enrollmentRaw = Q.fullTime;
  const maintainedFT = !isNo(enrollmentRaw); // default Yes unless explicit No

  // ─── Native language ───
  const langParts = Q.nativeLang.split(",").map((p) => p.trim());
  const nativeLang = langParts[0] || "";
  const commLang = (langParts[1] || "English").toLowerCase().includes("french")
    ? "French"
    : langParts[1]?.toLowerCase().includes("both")
    ? "Both"
    : langParts[1]?.toLowerCase().includes("neither")
    ? "Neither"
    : "English";
  const langTestTaken = /test|ielts|celpip|tef|tcf/i.test(Q.nativeLang) && isYes(Q.nativeLang);

  // ─── PAL exemption logic ───
  // PAL EXEMPT cases (per IRCC): same-DLI extension, Master's/PhD, K-12, exchange,
  // family of foreign worker/student/diplomat. We check the two we can determine:
  //   1. Same college (= same DLI extension)
  //   2. Graduate program (Master's/PhD)
  // Other exemptions surface as a review flag for staff to confirm.
  const palExempt = sameCollege || isGraduateProgram;
  const hasPalUploaded = !!(intake.palDocNumber);

  // ─── Review flags — surface anything that needs human attention ───
  const reviewFlags: string[] = [];
  if (!hasPalUploaded && !palExempt) {
    reviewFlags.push(`PAL likely required — client is at a new college and not in graduate program. Request PAL document.`);
  }
  if (!intake.loaSchoolName) {
    reviewFlags.push(`No LOA uploaded yet — school details (DLI, program, dates, tuition) will be empty on form.`);
  }
  if (intake.loaStudyLevel && !normalizeStudyLevel(intake.loaStudyLevel)) {
    reviewFlags.push(`Could not auto-categorize study level "${intake.loaStudyLevel}" — staff please verify Section 8b on form.`);
  }
  if (!sameCollege && !Q.canadaHistory) {
    reviewFlags.push(`Client changed college but did not provide Canada-history explanation — Section 3 may be incomplete.`);
  }

  // ─── School details (LOA-OCR'd) ───
  const schoolName = stripPrefix(intake.loaSchoolName || "");
  const schoolAddress = stripPrefix(intake.loaSchoolAddress || "");
  const schoolCity = stripPrefix(intake.loaSchoolCity || "");
  const schoolProvince = stripPrefix(intake.loaSchoolProvince || "");
  const dliNumber = stripPrefix(intake.loaDliNumber || "");
  const studentId = stripPrefix(intake.loaStudentId || "");
  const studyLevel = normalizeStudyLevel(stripPrefix(intake.loaStudyLevel || ""));
  const studyField = normalizeStudyField(stripPrefix(intake.loaStudyField || intake.loaStudyLevel || ""));
  const studyFromDate = stripPrefix(intake.loaStudyFromDate || "");
  const studyToDate = stripPrefix(intake.loaStudyToDate || "");
  const tuitionCost = stripPrefix(intake.loaTuitionCost || "");

  // ─── Permit details (current study permit OCR'd) ───
  const permitNum = stripPrefix(intake.permitDetails || "");
  const permitIssue = stripPrefix(intake.studyPermitIssueDate || "");
  const permitExpiry = stripPrefix(intake.studyPermitExpiryDate || "");

  // ─── Passport details (OCR'd) ───
  const passportIssue = parseDate(intake.passportIssueDate || "");
  const passportExpiry = parseDate(intake.passportExpiryDate || "");
  const dob = parseDate(intake.dateOfBirth || "");

  return {
    // Section 1: Application type
    applying_restore_status: /restore/i.test(formType || ""),
    applying_extend_stay: !/restore/i.test(formType || ""),
    applying_trp: false,

    // Section 2: Personal (all OCR'd from passport)
    uci_client_id: stripPrefix(intake.uci || ""),
    family_name: familyName,
    given_name: givenName,
    has_alias: hasAlias,
    alias_family_name: aliasLastName,
    alias_given_name: aliasFirstName,
    sex: (() => {
      const s = String(intake.sex || "").toLowerCase();
      if (s.startsWith("f")) return "F Female";
      if (s.startsWith("m")) return "M Male";
      return "";
    })(),
    dob_year: dob.year,
    dob_month: dob.month,
    dob_day: dob.day,
    place_birth_city: stripPrefix(intake.placeOfBirthCity || intake.cityOfBirth || ""),
    place_birth_country: stripPrefix(intake.countryOfBirth || ""),
    citizenship_country: stripPrefix(intake.citizenship || intake.countryOfBirth || ""),

    // Section 3: Status (currently a student, dates from current permit OCR)
    current_status: "Student",
    current_status_other: "",
    current_status_from_date: permitIssue,
    current_status_to_date: permitExpiry,
    prev_country_1: "",
    prev_status_1: "",
    prev_status_other_1: "",
    prev_from_date_1: "",
    prev_to_date_1: "",
    prev_country_2: "",
    prev_status_2: "",
    prev_status_other_2: "",
    prev_from_date_2: "",
    prev_to_date_2: "",

    // Section 4: Marital
    marital_status: marital,
    spouse_family_name: spouseParts[0]?.split(" ").slice(-1)[0] || "",
    spouse_given_name: spouseParts[0]?.split(" ").slice(0, -1).join(" ") || "",
    date_of_marriage: spouseParts[3] || "",
    spouse_status_in_canada: spouseInCanada,
    previously_married: previouslyMarried,
    prev_spouse_family_name: prevSpouseParts[0]?.split(" ").slice(-1)[0] || "",
    prev_spouse_given_name: prevSpouseParts[0]?.split(" ").slice(0, -1).join(" ") || "",
    prev_relationship_type: previouslyMarried ? (prevSpouseParts[2] || "Married") : "",
    prev_marriage_from: prevSpouseParts[3] || "",
    prev_marriage_to: prevSpouseParts[4] || "",
    prev_spouse_dob_year: "",
    prev_spouse_dob_month: "",
    prev_spouse_dob_day: "",

    // Section 5: Languages
    native_language: nativeLang || stripPrefix(intake.nativeLanguage || ""),
    communicate_language: commLang,
    language_test_taken: langTestTaken,
    frequent_language: nativeLang || "English",

    // Section 6: Travel docs (passport OCR'd)
    passport_number: stripPrefix(intake.passportNumber || ""),
    passport_country: stripPrefix(intake.citizenship || intake.countryOfBirth || ""),
    passport_issue_year: passportIssue.year,
    passport_issue_month: passportIssue.month,
    passport_issue_day: passportIssue.day,
    passport_expiry_year: passportExpiry.year,
    passport_expiry_month: passportExpiry.month,
    passport_expiry_day: passportExpiry.day,
    has_national_id: false,
    national_id_number: "",
    national_id_country: "",
    national_id_issue_date: "",
    national_id_expiry_date: "",
    has_us_card: false,
    us_card_number: "",
    us_card_expiry_date: "",

    // Section 7: Contact
    mailing_po_box: "",
    mailing_apt_unit: mailing.apt_unit,
    mailing_street_num: mailing.street_num,
    mailing_street_name: mailing.street_name,
    mailing_city: mailing.city,
    mailing_province: mailing.province,
    mailing_postal_code: mailing.postal_code,
    mailing_country: "Canada",  // SP ext is in-Canada by definition
    mailing_district: "",
    residential_same_as_mailing: true,
    residential_apt_unit: "",
    residential_street_num: "",
    residential_street_name: "",
    residential_city: "",
    residential_province: "",
    residential_country: "",
    phone_type: "Canada/US",
    phone_number_type: "Mobile",
    phone_area_code: phone.area_code,
    phone_first_three: phone.first_three,
    phone_last_five: phone.last_five,
    phone_extension: "",
    phone_intl_number: "",
    alt_phone_area_code: "",
    alt_phone_first_three: "",
    alt_phone_last_five: "",
    alt_phone_extension: "",
    email: emailFromQ || stripPrefix(intake.email || ""),

    // Section 8: Entry to Canada
    original_entry_date: originalEntryDate,
    original_entry_place: originalEntryPlace,
    original_entry_purpose: originalEntryPurpose,
    original_entry_purpose_other: "",
    recent_entry_date: stripPrefix(intake.recentEntryDate || ""),
    recent_entry_place: stripPrefix(intake.recentEntryPlace || ""),
    previous_doc_number: permitNum,

    // Section 8b: Study Permit details (LOA OCR'd, with field/level normalization)
    school_name: schoolName,
    study_field: studyField,
    study_level: studyLevel,
    school_province: schoolProvince,
    school_city: schoolCity,
    school_address: schoolAddress,
    school_dli_number: dliNumber,
    student_id: studentId,
    study_from_date: studyFromDate,
    study_to_date: studyToDate,
    tuition_cost: tuitionCost,
    room_board_cost: roomBoardCost,
    other_costs: otherCosts,
    funds_available: fundsAmount,
    expenses_paid_by: fundsSource,
    expenses_paid_by_other: fundsSource === "Other" ? "" : "",

    // Section 8c: Work permit alongside study
    applying_for_work_permit: applyingForWp,
    work_permit_type: wpType,

    // Section 8d: CAQ (Quebec only — leave blank, staff fills if needed)
    caq_cert_number: "",
    caq_cert_expiry: "",

    // Section 8e: PAL (OCR'd from PAL doc)
    pal_doc_number: stripPrefix(intake.palDocNumber || ""),
    pal_doc_expiry: stripPrefix(intake.palExpiryDate || ""),

    // Section 9: Past education (one row before current Canada studies)
    has_education: !!hasPastEdu,
    edu_from_year: eduFromYM.split("-")[0] || "",
    edu_from_month: eduFromYM.split("-")[1] || "",
    edu_field_of_study: eduField,
    edu_school_name: eduSchool,
    edu_to_year: eduToYM.split("-")[0] || "",
    edu_to_month: eduToYM.split("-")[1] || "",
    edu_city: eduCity,
    edu_country: eduCountry,
    edu_province: "",

    // Section 10: Employment
    employment: employmentArr,

    // Section 11: Background
    has_medical_condition: hasMedical,
    medical_details: hasMedical ? crimMedRaw : "",
    prev_application_refused: hasRefusal,
    prev_refused_to_canada: hasRefusal && /canada/i.test(refusalRaw),
    prev_refused_details: hasRefusal ? detailsAfterYN(refusalRaw) : "",
    has_criminal_record: hasCriminal,
    criminal_details: hasCriminal ? crimMedRaw : "",
    has_military_service: hasMilitary,
    military_details: hasMilitary ? detailsAfterYN(bgRaw) : "",
    held_government_position: heldGovt,
    witnessed_ill_treatment: witnessedIll,

    // Newton-specific helper fields (not on form, used by submission package / UI)
    same_college: sameCollege,
    is_graduate_program: isGraduateProgram,
    pal_exempt: palExempt,
    canada_history: !sameCollege ? Q.canadaHistory : "",
    extension_reason: stripPrefix(Q.extReason),
    full_time_maintained: maintainedFT,
    full_time_explanation: maintainedFT ? "" : detailsAfterYN(enrollmentRaw),

    // Layout marker for downstream debugging
    _layout: layout,
    _review_flags: reviewFlags,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MAPPER 3: Visitor Visa (TRV outside Canada) → IMM5257E
// ─────────────────────────────────────────────────────────────────────────
//
// Question flow ('visitor_visa' — 22 questions):
//   Q1  Full name as on passport (Family, Given)
//   Q2  Date of birth
//   Q3  Gender
//   Q4  Country & city of birth
//   Q5  Citizenship
//   Q6  Passport number, country, issue & expiry
//   Q7  Marital status
//   Q8  Spouse details
//   Q9  Current country of residence and status
//   Q10 Other countries lived in last 5 years
//   Q11 Home address & phone
//   Q12 Purpose of visit
//   Q13 Travel dates
//   Q14 Contact in Canada
//   Q15 Funds available
//   Q16 Education history
//   Q17 Employment history
//   Q18 Travel history
//   Q19 Overstayed/refused/deported (any country)
//   Q20 Refused Canadian visa or permit
//   Q21 Criminal/medical history
//   Q22 Native language

function mapForVisitorVisa(intake: Record<string, any>, formType: string): Record<string, any> {
  const { qN } = buildLookup(intake);

  // ─── Smart layout detection (3 generations of visitor_visa flow) ───
  //
  // OLD (22 questions): qN(1)=name, qN(2)=DOB(date), Q7-Q22.
  // MID (25 questions): qN(1)=name, qN(2)=alias, adds Q9 prev marriage, Q23 background.
  // LEAN (20 questions): qN(1)=upload confirmation ("done"/"ok"), qN(2)=alias.
  //   Identity fields (name/DOB/gender/birthplace/citizenship/passport) come
  //   from OCR-filled intake.firstName, intake.dateOfBirth, etc.
  //
  // Detection strategy — examine qN(1) and qN(2) shapes:
  //   - q1 looks like a name (contains comma OR 2+ words, length >= 4) → OLD or MID
  //   - q1 looks like upload confirmation (short single word like "done"/"ok") → LEAN
  //   - q1 empty AND intake.firstName set → LEAN (client skipped because OCR did it)
  //   - q2 parses as date → OLD; q2 looks like Yes/No → MID/LEAN
  const q1 = qN(1);
  const q2 = qN(2);
  const q1Trimmed = q1.trim().toLowerCase();
  const q1LooksLikeName = (q1.includes(",") || q1.split(/\s+/).filter(Boolean).length >= 2) && q1.length >= 4;
  const q1LooksLikeUploadAck = q1Trimmed.length > 0 && q1Trimmed.length <= 15 &&
    /^(done|ok|okay|yes|uploaded|sent|finished|complete|all done|all uploaded)$/.test(q1Trimmed);
  const q2LooksLikeDate = /^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(q2) ||
                          /^\s*\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(q2);

  let layout: "OLD" | "MID" | "LEAN";
  if (q1LooksLikeUploadAck) {
    // Upload acknowledgment is a strong LEAN signal — check first.
    layout = "LEAN";
  } else if (q1LooksLikeName && q2LooksLikeDate) {
    layout = "OLD";
  } else if (q1LooksLikeName && !q2LooksLikeDate) {
    layout = "MID";
  } else if (!q1Trimmed && (intake.firstName || intake.lastName)) {
    layout = "LEAN";
  } else {
    // Fallback: if intake has identity fields filled (OCR ran), assume LEAN.
    // Otherwise default to MID (most recent flow before LEAN).
    layout = (intake.firstName || intake.lastName || intake.passportNumber) ? "LEAN" : "MID";
  }

  // Position-aware Q getter — different qN offsets per layout. Anything not
  // asked in a given layout returns "" (and the field falls back to intake.* values).
  const Q = layout === "LEAN" ? {
    name:           "",  // not asked — comes from intake.firstName/lastName
    alias:          qN(2),
    dob:            "",  // OCR
    gender:         "",  // OCR
    birthplace:     "",  // OCR
    citizenship:    "",  // OCR
    passport:       "",  // OCR
    marital:        qN(3),
    spouse:         qN(4),
    prevMarriage:   qN(5),
    residence:      qN(6),
    otherCountries: qN(7),
    addressPhone:   qN(8),
    purpose:        qN(9),
    travelDates:    qN(10),
    contacts:       qN(11),
    funds:          qN(12),
    education:      qN(13),
    employment:     qN(14),
    travelHistory:  qN(15),
    overstay:       qN(16),
    canRefusal:     qN(17),
    crimMed:        qN(18),
    background:     qN(19),
    nativeLang:     qN(20),
  } : layout === "MID" ? {
    name:           qN(1),
    alias:          qN(2),
    dob:            qN(3),
    gender:         qN(4),
    birthplace:     qN(5),
    citizenship:    qN(6),
    passport:       qN(7),
    marital:        qN(8),
    spouse:         qN(9),
    prevMarriage:   qN(10),
    residence:      qN(11),
    otherCountries: qN(12),
    addressPhone:   qN(13),
    purpose:        qN(14),
    travelDates:    qN(15),
    contacts:       qN(16),
    funds:          qN(17),
    education:      qN(18),
    employment:     qN(19),
    travelHistory:  qN(20),
    overstay:       qN(21),
    canRefusal:     qN(22),
    crimMed:        qN(23),
    background:     qN(24),
    nativeLang:     qN(25),
  } : { // OLD
    name:           qN(1),
    alias:          "",
    dob:            qN(2),
    gender:         qN(3),
    birthplace:     qN(4),
    citizenship:    qN(5),
    passport:       qN(6),
    marital:        qN(7),
    spouse:         qN(8),
    prevMarriage:   "",
    residence:      qN(9),
    otherCountries: qN(10),
    addressPhone:   qN(11),
    purpose:        qN(12),
    travelDates:    qN(13),
    contacts:       qN(14),
    funds:          qN(15),
    education:      qN(16),
    employment:     qN(17),
    travelHistory:  qN(18),
    overstay:       qN(19),
    canRefusal:     qN(20),
    crimMed:        qN(21),
    background:     "",
    nativeLang:     qN(22),
  };

  // Identity fields — for LEAN layout these always come from intake.* (OCR);
  // for OLD/MID layouts we still try the typed answer first, then fall back
  // to intake.* (handles cases where staff hand-corrects after OCR).
  const familyNameFromIntake = (intake.lastName || "").toUpperCase();
  const givenNameFromIntake = (intake.firstName || "").toUpperCase();
  let familyName: string;
  let givenName: string;
  if (layout === "LEAN") {
    familyName = familyNameFromIntake;
    givenName = givenNameFromIntake;
  } else {
    const nameParts = Q.name.split(",").map((p) => p.trim());
    familyName = familyNameFromIntake || (nameParts[0] || "").toUpperCase();
    givenName = givenNameFromIntake || (nameParts[1] || "").toUpperCase();
  }

  // Q2 NEW: Alias
  const hasAlias = isYes(Q.alias);
  const aliasDetails = hasAlias ? detailsAfterYN(Q.alias) : "";
  const aliasFirstName = aliasDetails.split(/[\s,]/)[0] || "";
  const aliasLastName = aliasDetails.split(/[\s,]/).slice(1).join(" ") || "";

  // DOB — from typed answer in OLD/MID layouts; from intake.dateOfBirth in LEAN
  const dob = parseDate(Q.dob || intake.dateOfBirth || "");

  // Gender
  const sex = (() => {
    const v = stripPrefix(Q.gender || intake.sex || "").toLowerCase();
    if (v.startsWith("f")) return "F Female";
    if (v.startsWith("m")) return "M Male";
    return "";
  })();

  // Birth place
  const birthParts = Q.birthplace.split(",").map((p) => p.trim());
  const birthCity = birthParts[1] || intake.placeOfBirthCity || intake.cityOfBirth || "";
  const birthCountry = birthParts[0] || intake.countryOfBirth || "";

  // Citizenship — typed answer first, then OCR'd intake.citizenship, then birth country
  const citizenship = stripPrefix(Q.citizenship || intake.citizenship || birthCountry);

  // Passport — for LEAN layout Q.passport is empty, so all fields come from
  // OCR-filled intake. For OLD/MID layouts we still parse the typed answer.
  const passportParts = Q.passport ? Q.passport.split(",").map((p) => p.trim()) : [];
  const passportNum = (intake.passportNumber || passportParts[0] || "").toString().trim();
  const passportCountry = passportParts[1] || citizenship;
  const passportIssue = parseDate((intake.passportIssueDate as string) || passportParts[2] || "");
  const passportExpiry = parseDate((intake.passportExpiryDate as string) || passportParts[3] || "");

  // Q8/Q9 (was Q7/Q8): Marital + spouse
  const maritalRaw = stripPrefix(Q.marital || "Single");
  const marital = (() => {
    const v = maritalRaw.toLowerCase();
    if (v.startsWith("mar")) return "Married";
    if (v.startsWith("com")) return "Common-Law";
    if (v.startsWith("div")) return "Divorced";
    if (v.startsWith("wid")) return "Widowed";
    if (v.startsWith("sep")) return "Separated";
    return "Single";
  })();
  const isMarried = marital === "Married" || marital === "Common-Law";
  const spouseParts = isMarried && !isNo(Q.spouse) ? Q.spouse.split(",").map((p) => p.trim()) : [];

  // Q10 NEW: Previously married
  const previouslyMarried = isYes(Q.prevMarriage);
  const prevMarriageDetails = previouslyMarried ? detailsAfterYN(Q.prevMarriage) : "";
  const prevSpouseParts = prevMarriageDetails.split(",").map((p) => p.trim());

  // Q11 (was Q9): Residence + status + dates
  // Format expected: "India, Citizen, 2000-01-01, permanent" or "India, Worker, 2020-05-15, 2025-05-14"
  const residenceParts = Q.residence.split(",").map((p) => p.trim());
  const currentCountry = residenceParts[0] || "";
  const currentStatus = residenceParts[1] || "Citizen";
  const fromDateParsed = parseDate(residenceParts[2] || "");
  const currentStatusFromDate = fromDateParsed.year
    ? `${fromDateParsed.year}-${fromDateParsed.month}-${fromDateParsed.day}`
    : "";
  const currentStatusToDateRaw = residenceParts[3] || "";
  const toDateParsed = parseDate(currentStatusToDateRaw);
  const currentStatusToDate = currentStatusToDateRaw.toLowerCase().includes("permanent") || !toDateParsed.year
    ? ""
    : `${toDateParsed.year}-${toDateParsed.month}-${toDateParsed.day}`;

  // Q13 (was Q11): Home address + phone + email — combined
  const addressPhoneRaw = Q.addressPhone;
  const phoneMatch = addressPhoneRaw.match(/[\+\d][\d\s\-\(\)]{6,}/);
  const phoneRaw = phoneMatch ? phoneMatch[0] : "";
  const emailMatch = addressPhoneRaw.match(/[\w.-]+@[\w.-]+\.\w+/);
  const emailFromQ = emailMatch ? emailMatch[0] : "";
  let addressOnly = addressPhoneRaw;
  if (phoneRaw) addressOnly = addressOnly.replace(phoneRaw, "");
  if (emailFromQ) addressOnly = addressOnly.replace(emailFromQ, "");
  addressOnly = addressOnly.trim().replace(/[,;]\s*$/, "");
  const mailing = parseAddress(addressOnly);
  const phone = parsePhone(phoneRaw);

  // Q14 (was Q12): Purpose of visit
  const purpose = stripPrefix(Q.purpose) || "Tourism";

  // Q15 (was Q13): Travel dates
  const travelParts = Q.travelDates.split(",").map((p) => p.trim());
  const arrivalDate = travelParts[0] || "";
  const departureDate = travelParts[1] || "";

  // Q16 (was Q14): Contact in Canada — now supports up to 2 contacts.
  // Format expected: "Name1, Rel1, Addr1, Phone1, Email1; Name2, Rel2, Addr2, ..."
  const contactsRaw = Q.contacts;
  const contactBlocks = isNo(contactsRaw) ? [] : contactsRaw.split(/;\s*/).filter(Boolean);
  const contact1Parts = (contactBlocks[0] || "").split(",").map((p) => p.trim());
  const contact2Parts = (contactBlocks[1] || "").split(",").map((p) => p.trim());

  // Q17 (was Q15): Funds
  const fundsRaw = Q.funds;
  const fundsAmount = (fundsRaw.match(/[\d,]+/g) || [])[0]?.replace(/,/g, "") || "";

  // Q21/Q22/Q23 (was Q19/Q20/Q21): Refusals + criminal/medical
  const hasOverstay = isYes(Q.overstay);
  const hasCanRefusal = isYes(Q.canRefusal);
  const crimMedRaw = Q.crimMed;
  const hasCriminal = /criminal/i.test(crimMedRaw) && isYes(crimMedRaw);
  const hasMedical = /medical/i.test(crimMedRaw) && isYes(crimMedRaw);

  // Q24 NEW: Background — military / government position / witnessed ill treatment
  // Single answer covers 3 Yes/No questions. We parse permissively: if the answer
  // contains "yes" or "served" → military=true; "government" or "political" → govt;
  // "ill" or "war" or "witnessed" → ill_treatment.
  const bgRaw = Q.background;
  const bgLower = bgRaw.toLowerCase();
  // If user said straight "no" or "none", all three are false
  const allNo = /^\s*(no|none|n\/a|na)\s*$/i.test(bgRaw.trim());
  const hasMilitary = !allNo && /(military|militia|armed|army|forces|served)/i.test(bgRaw) && isYes(bgRaw);
  const heldGovt = !allNo && /(government|political|public office|civil service|police officer|judge)/i.test(bgRaw) && isYes(bgRaw);
  const witnessedIll = !allNo && /(witness|ill\s*treat|war|genocide|atrocit|abuse)/i.test(bgRaw) && isYes(bgRaw);

  // Q25 (was Q22): Native language
  const langParts = Q.nativeLang.split(",").map((p) => p.trim());
  const nativeLang = langParts[0] || "";
  const commLang = (langParts[1] || "English").toLowerCase().includes("french")
    ? "French"
    : langParts[1]?.toLowerCase().includes("both")
    ? "Both"
    : langParts[1]?.toLowerCase().includes("neither")
    ? "Neither"
    : "English";

  return {
    family_name: familyName,
    given_name: givenName,
    sex,
    dob_year: dob.year,
    dob_month: dob.month,
    dob_day: dob.day,
    place_birth_city: birthCity,
    place_birth_country: birthCountry,
    citizenship_country: citizenship,
    passport_number: passportNum,
    passport_country: passportCountry,
    passport_issue_year: passportIssue.year,
    passport_issue_month: passportIssue.month,
    passport_issue_day: passportIssue.day,
    passport_expiry_year: passportExpiry.year,
    passport_expiry_month: passportExpiry.month,
    passport_expiry_day: passportExpiry.day,
    has_national_id: false,
    has_us_card: false,

    // Section 1: Service required (visitor visa is the default for IMM5257)
    applying_visitor_visa: true,

    // UCI
    uci_client_id: stripPrefix(intake.uci || ""),

    // Q2: Aliases
    has_alias: hasAlias,
    alias_family_name: aliasLastName,
    alias_given_name: aliasFirstName,

    // Q8/Q9: Marital
    marital_status: marital,
    spouse_family_name: spouseParts[0]?.split(" ").slice(-1)[0] || "",
    spouse_given_name: spouseParts[0]?.split(" ").slice(0, -1).join(" ") || "",
    date_of_marriage: spouseParts[3] || "",
    spouse_dob: spouseParts[1] || "",
    spouse_citizenship: spouseParts[2] || "",
    previously_married: previouslyMarried,
    prev_spouse_family_name: prevSpouseParts[0]?.split(" ").slice(-1)[0] || "",
    prev_spouse_given_name: prevSpouseParts[0]?.split(" ").slice(0, -1).join(" ") || "",

    // Q11: Country of residence + status dates
    current_country_residence: currentCountry,
    current_country_status: currentStatus,
    current_status_from_date: currentStatusFromDate,
    current_status_to_date: currentStatusToDate,

    // Q13: Home address
    mailing_apt_unit: mailing.apt_unit,
    mailing_street_num: mailing.street_num,
    mailing_street_name: mailing.street_name,
    mailing_city: mailing.city,
    mailing_province: mailing.province,
    mailing_postal_code: mailing.postal_code,
    mailing_country: mailing.country || currentCountry,
    residential_same_as_mailing: true,
    residential_apt_unit: "",
    residential_street_num: "",
    residential_street_name: "",
    residential_city: "",
    residential_province: "",
    phone_type: "Other",
    phone_number_type: "Mobile",
    phone_area_code: phone.area_code,
    phone_first_three: phone.first_three,
    phone_last_five: phone.last_five,
    email: emailFromQ || stripPrefix(intake.email || ""),

    // Q14-Q15: Visit details
    visit_purpose: purpose,
    visit_arrival_date: arrivalDate,
    visit_departure_date: departureDate,

    // Q16: Contacts in Canada (up to 2)
    canada_contact_name: contact1Parts[0] || "",
    canada_contact_relationship: contact1Parts[1] || "",
    canada_contact_address: contact1Parts[2] || "",
    canada_contact_phone: contact1Parts[3] || "",
    canada_contact_email: contact1Parts[4] || "",
    contact_2_name: contact2Parts[0] || "",
    contact_2_relationship: contact2Parts[1] || "",
    contact_2_address: contact2Parts[2] || "",

    // Q17: Funds
    funds_amount_cad: fundsAmount,

    // Languages
    native_language: nativeLang,
    communicate_language: commLang,
    language_test_taken: false,
    frequent_language: nativeLang || "English",

    // Q21/Q22/Q23: Background — refusals + criminal/medical
    has_overstayed: hasOverstay,
    overstay_details: hasOverstay ? detailsAfterYN(Q.overstay) : "",
    prev_application_refused: hasCanRefusal,
    prev_refused_to_canada: hasCanRefusal,
    prev_refused_details: hasCanRefusal ? detailsAfterYN(Q.canRefusal) : "",
    has_medical_condition: hasMedical,
    medical_details: hasMedical ? crimMedRaw : "",
    has_criminal_record: hasCriminal,
    criminal_details: hasCriminal ? crimMedRaw : "",

    // Q24: Background flags (military / government / ill treatment)
    has_military_service: hasMilitary,
    military_details: hasMilitary ? detailsAfterYN(bgRaw) : "",
    held_government_position: heldGovt,
    witnessed_ill_treatment: witnessedIll,

    employment: [],
    has_education: false,

    // Layout marker — useful for downstream debugging / review
    _layout: layout,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MAPPER 4: Visitor Record (TRV inside Canada) → IMM5708E
// ─────────────────────────────────────────────────────────────────────────
//
// Question flow ('visitor_record' — 17 questions):
//   Q1  Have you used any other name?
//   Q2  Marital status
//   Q3  Spouse details
//   Q4  Mailing address in Canada
//   Q5  Phone
//   Q6  Current immigration status & expiry
//   Q7  What are you applying for? (Extend / Restore)
//   Q8  Purpose of visit
//   Q9  Visit start & leave dates
//   Q10 Funds available
//   Q11 Who pays?
//   Q12 Visiting anyone?
//   Q13 First entry to Canada
//   Q14 Refusal history
//   Q15 Medical history
//   Q16 Criminal history
//   Q17 Native language

function mapForVisitorRecord(intake: Record<string, any>, formType: string): Record<string, any> {
  const { qN } = buildLookup(intake);
  const ft = (formType || "").toLowerCase();

  // Q2: Marital
  const maritalRaw = stripPrefix(qN(2) || intake.maritalStatus || "Single");
  const marital = (() => {
    const v = maritalRaw.toLowerCase();
    if (v.startsWith("mar")) return "Married";
    if (v.startsWith("com")) return "Common-Law";
    if (v.startsWith("div")) return "Divorced";
    if (v.startsWith("wid")) return "Widowed";
    if (v.startsWith("sep")) return "Separated";
    return "Single";
  })();

  // Q3: Spouse
  const spouseRaw = qN(3);
  const isMarried = marital === "Married" || marital === "Common-Law";
  const spouseParts = isMarried && !isNo(spouseRaw) ? spouseRaw.split(",").map((p) => p.trim()) : [];
  const spouseNameParts = (spouseParts[0] || "").split(" ");

  // Q4: Address
  const mailing = parseAddress(qN(4));

  // Q5: Phone
  const phone = parsePhone(qN(5));

  // Q6: Status & expiry "Visitor, 2025-09-01"
  const statusParts = qN(6).split(",").map((p) => p.trim());
  const currentStatus = statusParts[0] || "Visitor";
  const statusExpiry = statusParts[1] || "";

  // Q7: Applying for
  const applyForRaw = stripPrefix(qN(7)).toLowerCase();
  const isRestore = applyForRaw.includes("restore");

  // Q8: Purpose of visit
  const purpose = stripPrefix(qN(8)) || "Tourism";

  // Q9: Travel dates
  const travelParts = qN(9).split(",").map((p) => p.trim());
  const arrivalDate = travelParts[0] || "";
  const departureDate = travelParts[1] || "";

  // Q10: Funds
  const fundsRaw = qN(10);
  const fundsAmount = (fundsRaw.match(/[\d,]+/g) || [])[0]?.replace(/,/g, "") || "";

  // Q11: Who pays
  const paidByRaw = stripPrefix(qN(11));
  const paidBy = paidByRaw.toLowerCase();

  // Q12: Visiting someone
  const visitingRaw = qN(12);
  const isVisiting = isYes(visitingRaw);
  // Strip leading "Yes" / "Yes," / "Yes -" before parsing the contact details
  const visitingDetails = isVisiting ? detailsAfterYN(visitingRaw) : "";
  const visitingParts = visitingDetails ? visitingDetails.split(",").map((p) => p.trim()) : [];

  // Q13: First entry "2020-01-15, Vancouver"
  const entryParts = qN(13).split(",").map((p) => p.trim());

  // Q14/Q15/Q16: Background
  const refusalRaw = qN(14);
  const hasRefusal = isYes(refusalRaw);
  const medicalRaw = qN(15);
  const hasMedical = isYes(medicalRaw);
  const criminalRaw = qN(16);
  const hasCriminal = isYes(criminalRaw);

  // Q17: Native language
  const langRaw = qN(17);
  const langParts = langRaw.split(",").map((p) => p.trim());
  const nativeLang = langParts[0] || "";
  const canSpeakEnFr = !isNo(langParts[1] || "Yes");

  return {
    ...buildIdentitySection(intake),
    // Section 1
    applying_restore_status: isRestore,
    applying_extend_stay: !isRestore,
    applying_trp: false,

    uci_client_id: stripPrefix(intake.uci || ""),

    // Q1: Aliases
    has_alias: isYes(qN(1)),
    alias_family_name: "",
    alias_given_name: "",

    // Q2/Q3: Marital
    marital_status: marital,
    spouse_family_name: spouseNameParts.slice(-1)[0] || "",
    spouse_given_name: spouseNameParts.slice(0, -1).join(" ") || "",
    date_of_marriage: spouseParts[1] || "",
    spouse_status_in_canada: "",
    previously_married: false,
    prev_spouse_family_name: "",
    prev_spouse_given_name: "",
    prev_relationship_type: "",
    prev_marriage_from: "",
    prev_marriage_to: "",

    // Q4-Q5: Address & phone
    mailing_apt_unit: mailing.apt_unit,
    mailing_street_num: mailing.street_num,
    mailing_street_name: mailing.street_name,
    mailing_city: mailing.city,
    mailing_province: mailing.province,
    mailing_postal_code: mailing.postal_code,
    mailing_country: "Canada",
    residential_same_as_mailing: true,
    residential_apt_unit: "",
    residential_street_num: "",
    residential_street_name: "",
    residential_city: "",
    residential_province: "",
    phone_type: "Canada/US",
    phone_number_type: "Mobile",
    phone_area_code: phone.area_code,
    phone_first_three: phone.first_three,
    phone_last_five: phone.last_five,
    email: stripPrefix(intake.email || ""),

    // Q6: Current status
    current_status: currentStatus,
    current_status_from_date: "",
    current_status_to_date: statusExpiry,

    // Q8/Q9: Visit details
    visit_purpose: purpose,
    visit_arrival_date: arrivalDate,
    visit_departure_date: departureDate,

    // Q10/Q11: Funds
    funds_amount_cad: fundsAmount,
    funds_paid_by_self: paidBy.includes("myself") || paidBy.includes("self"),
    funds_paid_by_parents: paidBy.includes("parent"),
    funds_paid_by_other: !paidBy.includes("myself") && !paidBy.includes("parent"),
    funds_paid_by_other_details: !paidBy.includes("myself") && !paidBy.includes("parent") ? paidByRaw : "",

    // Q12: Visiting someone
    canada_contact_name: visitingParts[0] || "",
    canada_contact_relationship: visitingParts[1] || "",
    canada_contact_address: visitingParts[2] || "",

    // Q13: First entry
    original_entry_date: entryParts[0] || "",
    original_entry_place: entryParts[1] || "",
    original_entry_purpose: "Visit",
    recent_entry_date: entryParts[0] || "",
    recent_entry_place: entryParts[1] || "",

    // Languages
    native_language: nativeLang,
    communicate_language: canSpeakEnFr ? "English" : "Neither",
    language_test_taken: false,
    frequent_language: nativeLang || "English",

    // Q14/Q15/Q16: Background
    has_medical_condition: hasMedical,
    medical_details: hasMedical ? detailsAfterYN(medicalRaw) : "",
    prev_application_refused: hasRefusal,
    prev_refused_to_canada: hasRefusal && refusalRaw.toLowerCase().includes("canada"),
    prev_refused_details: hasRefusal ? detailsAfterYN(refusalRaw) : "",
    has_criminal_record: hasCriminal,
    criminal_details: hasCriminal ? detailsAfterYN(criminalRaw) : "",
    has_military_service: false,
    held_government_position: false,
    witnessed_ill_treatment: false,

    employment: [],
    has_education: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ROUTER — picks the right mapper based on form type
// ─────────────────────────────────────────────────────────────────────────

export function mapIntakeToForm(intake: Record<string, any>, formType: string): Record<string, any> {
  const ft = (formType || "").toLowerCase();

  // Study Permit Extension (Inside Canada) — IMM5709E
  if (ft.includes("study permit extension") || (ft.includes("study permit") && ft.includes("extension"))) {
    return mapForStudyPermitExtension(intake, formType);
  }

  // Visitor Record — IMM5708E. This is ONLY for an actual "Visitor Record"
  // application (extending/changing visitor status inside Canada).
  // A TRV is NOT a visitor record: a TRV is the travel-document application on
  // IMM5257 whether it's filed from inside or outside Canada. So we route by the
  // application type, not by where the client physically is.
  if (ft.includes("visitor record")) {
    return mapForVisitorRecord(intake, formType);
  }

  // TRV / Visitor Visa / Super Visa — IMM5257E (inside or outside Canada).
  if (ft.includes("trv") || ft.includes("visitor visa") || ft.includes("super visa")) {
    return mapForVisitorVisa(intake, formType);
  }

  // Default: PGWP / SOWP / BOWP / VOWP / Work Permits / generic — IMM5710E
  return mapForPGWP(intake, formType);
}
