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
  const q16Raw = qN(16);
  const nativeLangText = looksLikeLanguage(q16Raw) ? q16Raw.split(/[,;]/)[0].trim() : "";
  const nativeLangCode = textToLanguageCode(nativeLangText);

  // ─── Q17: Language test — DEFAULT YES (PGWP requires it) ───
  const langTestRaw = qN(17);
  const langTest = !isNo(langTestRaw); // YES unless they explicitly said NO
  const langTestDetails = langTest ? detailsAfterYN(langTestRaw) : "";

  // ─── Q18: Plan to work in medical field ───
  const medicalFieldRaw = qN(18);
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
// Question flow ('study_permit_extension' — 14 questions):
//   Q1  Have you used any other name?
//   Q2  Marital status
//   Q3  Mailing address (NB: NO spouse Q here, unlike PGWP!)
//   Q4  Phone
//   Q5  Current study permit number and expiry
//   Q6  Current institution name and city
//   Q7  Current program of study and expected completion
//   Q8  Are you changing colleges?
//   Q9  Are you changing your program?
//   Q10 Reason for extension
//   Q11 Have you maintained full-time enrollment?
//   Q12 Have you ever been refused a visa or permit?
//   Q13 Medical history
//   Q14 Criminal history

function mapForStudyPermitExtension(intake: Record<string, any>, formType: string): Record<string, any> {
  const { qN } = buildLookup(intake);

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

  // Q3: Mailing address (no separate residential question — assume same)
  const mailing = parseAddress(qN(3));

  // Q4: Phone
  const phone = parsePhone(qN(4));

  // Q5: Current study permit "ABC123, 2025-09-01"
  const permitParts = qN(5).split(",").map((p) => p.trim());
  const permitNum = permitParts[0] || "";
  const permitExpiry = permitParts[1] || "";

  // Q6: Current institution "Capilano University, North Vancouver"
  const instParts = qN(6).split(",").map((p) => p.trim());
  const schoolName = instParts[0] || "";
  const schoolCity = instParts[1] || "";

  // Q7: Program "Associate of Arts, 2025-12-31"
  const progParts = qN(7).split(",").map((p) => p.trim());
  const programName = progParts[0] || "";
  const programEnd = progParts[1] || "";

  // Q11: Full-time enrollment maintained
  const enrollmentRaw = qN(11);
  const maintainedFT = !isNo(enrollmentRaw); // default to yes unless explicit no

  // Q12: Refusal history
  const refusalRaw = qN(12);
  const hasRefusal = isYes(refusalRaw);

  // Q13: Medical
  const medicalRaw = qN(13);
  const hasMedical = isYes(medicalRaw);

  // Q14: Criminal
  const criminalRaw = qN(14);
  const hasCriminal = isYes(criminalRaw);

  return {
    ...buildIdentitySection(intake),
    // Section 1: Application type — extending study permit
    applying_restore_status: false,
    applying_extend_stay: true,
    applying_trp: false,

    // UCI
    uci_client_id: stripPrefix(intake.uci || ""),

    // Q1: Aliases
    has_alias: isYes(qN(1)),
    alias_family_name: "",
    alias_given_name: "",

    // Q2: Marital — no spouse questions in this flow
    marital_status: marital,
    spouse_family_name: "",
    spouse_given_name: "",
    date_of_marriage: "",
    spouse_status_in_canada: "",
    previously_married: false,
    prev_spouse_family_name: "",
    prev_spouse_given_name: "",
    prev_relationship_type: "",
    prev_marriage_from: "",
    prev_marriage_to: "",

    // Q3-Q4: Address & phone
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

    // Status: currently a student in Canada
    current_status: "Student",
    current_status_from_date: "",
    current_status_to_date: permitExpiry,

    // Languages — use defaults for now (form has no explicit Qs in this flow)
    native_language: stripPrefix(intake.nativeLanguage || ""),
    communicate_language: "English",
    language_test_taken: false,
    frequent_language: "English",

    // Q5: Original entry — use earliest study permit start as fallback
    original_entry_date: stripPrefix(intake.firstEntryDate || ""),
    original_entry_place: stripPrefix(intake.firstEntryPlace || ""),
    original_entry_purpose: "Study",
    recent_entry_date: stripPrefix(intake.recentEntryDate || ""),
    recent_entry_place: stripPrefix(intake.recentEntryPlace || ""),
    previous_doc_number: permitNum,

    // Q6/Q7: Study details
    has_education: true,
    edu_school_name: schoolName,
    edu_field_of_study: programName,
    edu_city: schoolCity,
    edu_country: "Canada",
    edu_from_year: "",
    edu_from_month: "09",
    edu_to_year: programEnd ? programEnd.split("-")[0] : "",
    edu_to_month: programEnd ? programEnd.split("-")[1] || "06" : "06",

    // Study-specific fields (IMM5709 has these in Section 8)
    study_school_name: schoolName,
    study_program_name: programName,
    study_program_end_date: programEnd,
    study_changing_school: isYes(qN(8)),
    study_change_school_details: isYes(qN(8)) ? detailsAfterYN(qN(8)) : "",
    study_changing_program: isYes(qN(9)),
    study_change_program_details: isYes(qN(9)) ? detailsAfterYN(qN(9)) : "",
    study_extension_reason: stripPrefix(qN(10)),
    study_maintained_full_time: maintainedFT,
    study_full_time_explanation: maintainedFT ? "" : detailsAfterYN(enrollmentRaw),

    // Employment
    employment: [],

    // Q12-Q14: Background
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

  // Q1: Name (as on passport — but passport scan is more reliable, use intake first)
  const nameRaw = qN(1);
  const nameParts = nameRaw.split(",").map((p) => p.trim());
  const familyName = (intake.lastName || nameParts[0] || "").toUpperCase();
  const givenName = (intake.firstName || nameParts[1] || "").toUpperCase();

  // Q2: DOB
  const dob = parseDate(qN(2) || intake.dateOfBirth || "");

  // Q3: Gender
  const sex = (() => {
    const v = stripPrefix(qN(3) || intake.sex || "").toLowerCase();
    if (v.startsWith("f")) return "F Female";
    if (v.startsWith("m")) return "M Male";
    return "";
  })();

  // Q4: Birth place
  const birthRaw = qN(4);
  const birthParts = birthRaw.split(",").map((p) => p.trim());
  const birthCity = birthParts[1] || intake.cityOfBirth || "";
  const birthCountry = birthParts[0] || intake.countryOfBirth || "";

  // Q5: Citizenship
  const citizenship = stripPrefix(qN(5) || intake.citizenship || birthCountry);

  // Q6: Passport "ABC123, India, 2020-01-01, 2030-01-01"
  const passportParts = qN(6).split(",").map((p) => p.trim());
  const passportNum = passportParts[0] || intake.passportNumber || "";
  const passportCountry = passportParts[1] || citizenship;
  const passportIssue = parseDate(passportParts[2] || intake.passportIssueDate || "");
  const passportExpiry = parseDate(passportParts[3] || intake.passportExpiryDate || "");

  // Q7-Q8: Marital + spouse
  const maritalRaw = stripPrefix(qN(7) || "Single");
  const marital = (() => {
    const v = maritalRaw.toLowerCase();
    if (v.startsWith("mar")) return "Married";
    if (v.startsWith("com")) return "Common-Law";
    if (v.startsWith("div")) return "Divorced";
    if (v.startsWith("wid")) return "Widowed";
    if (v.startsWith("sep")) return "Separated";
    return "Single";
  })();
  const spouseRaw = qN(8);
  const isMarried = marital === "Married" || marital === "Common-Law";
  const spouseParts = isMarried && !isNo(spouseRaw) ? spouseRaw.split(",").map((p) => p.trim()) : [];

  // Q9: Country of residence & status — "India, Citizen"
  const residenceParts = qN(9).split(",").map((p) => p.trim());
  const currentCountry = residenceParts[0] || "";
  const currentStatus = residenceParts[1] || "Citizen";

  // Q11: Home address & phone — combined: "Address full, country, +1 604 ..."
  const addressPhoneRaw = qN(11);
  // Try to find a phone-looking substring
  const phoneMatch = addressPhoneRaw.match(/[\+\d][\d\s\-\(\)]{6,}/);
  const phoneRaw = phoneMatch ? phoneMatch[0] : "";
  const addressOnly = phoneRaw ? addressPhoneRaw.replace(phoneRaw, "").trim().replace(/[,;]\s*$/, "") : addressPhoneRaw;
  const mailing = parseAddress(addressOnly);
  const phone = parsePhone(phoneRaw);

  // Q12: Purpose of visit
  const purpose = stripPrefix(qN(12)) || "Tourism";

  // Q13: Travel dates "2025-08-01, 2025-08-30"
  const travelParts = qN(13).split(",").map((p) => p.trim());
  const arrivalDate = travelParts[0] || "";
  const departureDate = travelParts[1] || "";

  // Q14: Contact in Canada
  const contactRaw = qN(14);
  const contactParts = isNo(contactRaw) ? [] : contactRaw.split(",").map((p) => p.trim());

  // Q15: Funds
  const fundsRaw = qN(15);
  const fundsAmount = (fundsRaw.match(/[\d,]+/g) || [])[0]?.replace(/,/g, "") || "";

  // Q19/Q20: Refusals
  const overstayRaw = qN(19);
  const hasOverstay = isYes(overstayRaw);
  const canRefusalRaw = qN(20);
  const hasCanRefusal = isYes(canRefusalRaw);

  // Q21: Combined criminal + medical
  const crimMedRaw = qN(21);
  const hasCriminal = /criminal/i.test(crimMedRaw) && isYes(crimMedRaw);
  const hasMedical = /medical/i.test(crimMedRaw) && isYes(crimMedRaw);

  // Q22: Native language
  const langRaw = qN(22);
  const langParts = langRaw.split(",").map((p) => p.trim());
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

    // Q1: Aliases
    has_alias: false,
    alias_family_name: "",
    alias_given_name: "",

    // Q7-Q8: Marital
    marital_status: marital,
    spouse_family_name: spouseParts[0]?.split(" ").slice(-1)[0] || "",
    spouse_given_name: spouseParts[0]?.split(" ").slice(0, -1).join(" ") || "",
    date_of_marriage: "",
    spouse_dob: spouseParts[1] || "",
    spouse_citizenship: spouseParts[2] || "",
    previously_married: false,
    prev_spouse_family_name: "",
    prev_spouse_given_name: "",

    // Q9: Country of residence
    current_country_residence: currentCountry,
    current_country_status: currentStatus,

    // Q11: Home address
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
    email: stripPrefix(intake.email || ""),

    // Q12-Q13: Visit details
    visit_purpose: purpose,
    visit_arrival_date: arrivalDate,
    visit_departure_date: departureDate,

    // Q14: Contact in Canada
    canada_contact_name: contactParts[0] || "",
    canada_contact_relationship: contactParts[1] || "",
    canada_contact_address: contactParts[2] || "",
    canada_contact_phone: contactParts[3] || "",
    canada_contact_email: contactParts[4] || "",

    // Q15: Funds
    funds_amount_cad: fundsAmount,

    // Languages
    native_language: nativeLang,
    communicate_language: commLang,
    language_test_taken: false,
    frequent_language: nativeLang || "English",

    // Q19/Q20/Q21: Background
    has_overstayed: hasOverstay,
    overstay_details: hasOverstay ? detailsAfterYN(overstayRaw) : "",
    prev_application_refused: hasCanRefusal,
    prev_refused_to_canada: hasCanRefusal,
    prev_refused_details: hasCanRefusal ? detailsAfterYN(canRefusalRaw) : "",
    has_medical_condition: hasMedical,
    medical_details: hasMedical ? crimMedRaw : "",
    has_criminal_record: hasCriminal,
    criminal_details: hasCriminal ? crimMedRaw : "",
    has_military_service: false,
    held_government_position: false,
    witnessed_ill_treatment: false,

    employment: [],
    has_education: false,
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

  // ── BUG FIX: TRV Inside Canada routing ──
  // normalizeFormType() collapses both "TRV Inside" and "TRV Outside" to
  // just "TRV", so we can't distinguish them from formType alone. Look at
  // the intake itself: a TRV-Inside intake includes a question about
  // "current immigration status in Canada" (their work/study permit
  // expiry), which a TRV-Outside intake does not.
  const isInsideCanada =
    ft.includes("inside") ||
    ft.includes("visitor record") ||
    /current.+(?:immigration\s+)?status\s+in\s+canada/i.test(
      String(intake.q6 || "") + " " + String(intake.q7 || "")
    ) ||
    /\b(work permit|study permit)\b.+expir/i.test(
      String(intake.q6 || "") + " " + String(intake.q7 || "")
    );

  // Visitor Record (Inside Canada) — IMM5708E
  if (ft.includes("visitor record") || (ft.includes("trv") && isInsideCanada)) {
    return mapForVisitorRecord(intake, formType);
  }

  // Visitor Visa (Outside Canada) — IMM5257E
  if (ft.includes("visitor visa") || (ft.includes("trv") && !isInsideCanada) || ft.includes("super visa")) {
    return mapForVisitorVisa(intake, formType);
  }

  // Default: PGWP / SOWP / BOWP / VOWP / Work Permits / generic — IMM5710E
  return mapForPGWP(intake, formType);
}
