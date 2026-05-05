// ─────────────────────────────────────────────────────────────────────
// Intake Validators
//
// Catches obvious wrong answers BEFORE they make it into the form mapper.
//
// Design: HYBRID
//   - Hard checks (regex/heuristics) for obvious misfits — fast, free
//   - AI check ONLY for ambiguous cases that pass hard checks
//   - Smart mode: only re-ask when CLEARLY wrong (not borderline)
//   - Max 1 re-ask per question — after that, accept + flag for staff review
//
// V1 scope: employment + dates only (highest-value)
// Future: education, names, addresses, language fields
//
// Each validator returns:
//   { ok: true }                              → answer is fine, save it
//   { ok: false, hint: "..." }                → re-ask client with this hint
//   { ok: "flag", reason: "..." }             → accept but flag for staff review
//
// Validators NEVER throw — failure → { ok: true } so intake never gets stuck.
// ─────────────────────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true }
  | { ok: false; hint: string }
  | { ok: "flag"; reason: string };

// ─── Question type detection ─────────────────────────────────────────
// Identify what KIND of question this is by looking at the question text.
// We can't trust q-numbers since they shift across form types.

export function classifyQuestion(questionText: string): string {
  const q = (questionText || "").toLowerCase();

  // Order matters — more specific first
  if (/employment\s+details|list\s+all\s+jobs|job\s+title.*employer/i.test(q)) {
    return "employment";
  }
  if (/education\s+after|name\s+of\s+institute|field\s+of\s+study/i.test(q)) {
    return "education";
  }
  if (/native\s+language|first\s+language|mother\s+tongue/i.test(q)) {
    return "language";
  }
  if (/date\s+of\s+birth|dob/i.test(q)) {
    return "date_of_birth";
  }
  if (/passport.*expir|expir.*passport|expiry\s+date/i.test(q)) {
    return "passport_expiry";
  }
  if (/passport\s+(number|no)/i.test(q)) {
    return "passport_number";
  }
  if (/email/i.test(q)) {
    return "email";
  }
  if (/phone\s+number|mobile\s+number/i.test(q)) {
    return "phone";
  }
  if (/marital\s+status/i.test(q)) {
    return "marital_status";
  }
  if (/address|street/i.test(q)) {
    return "address";
  }
  return "other";
}

// ─── Helpers ─────────────────────────────────────────────────────────

const COMMON_LANGUAGES = [
  "english", "french", "punjabi", "hindi", "urdu", "gujarati", "tamil",
  "telugu", "marathi", "bengali", "malayalam", "kannada", "spanish",
  "portuguese", "italian", "german", "mandarin", "cantonese", "korean",
  "japanese", "arabic", "tagalog", "vietnamese", "thai", "russian",
  "ukrainian", "polish", "turkish", "farsi", "persian", "dari", "pashto",
];

function isYesNoOnly(s: string): boolean {
  return /^\s*(?:yes|yeah|yep|y|no|nope|n)\s*[.!]?\s*$/i.test(s);
}

function isLanguageNameOnly(s: string): boolean {
  const v = s.trim().toLowerCase();
  // Pure language word, OR comma-separated language list
  return v.split(/[,;\s/&]+/).filter(Boolean).every((part) =>
    COMMON_LANGUAGES.includes(part)
  );
}

// Has at least some "real content" sign — date, year, or 4+ word phrase
function hasSubstantiveContent(s: string): boolean {
  const v = s.trim();
  if (v.length < 10) return false;
  // Look for year (1990-2099)
  if (/\b(19|20)\d{2}\b/.test(v)) return true;
  // Look for month name
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(v)) return true;
  // Look for 4+ words
  const words = v.split(/\s+/).filter((w) => w.length > 1);
  if (words.length >= 4) return true;
  return false;
}

// ─── Employment validator ───────────────────────────────────────────
//
// Real Newton failure modes:
//   - Tarandeep wrote "punjabi" → got dumped into employment field
//   - Some clients write "yes" → meaningless
//   - Some clients write only a single word like "cook"
//
// Acceptable answers:
//   - "NONE" / "no employment" / "never worked"
//   - Real employment text with dates / employers / titles
//   - Multi-line lists of jobs

function validateEmployment(answer: string): ValidationResult {
  const v = (answer || "").trim();

  if (!v) return { ok: false, hint: "I didn't catch your employment details. Please tell me about your work history (or reply NONE if you've never worked)." };

  // Explicit "no employment" answer — accept
  if (/^\s*(none|no|n\/?a|never\s+worked|haven['’]?t\s+worked|no\s+employment)\b/i.test(v)) {
    return { ok: true };
  }

  // Just "yes" or "y" — clearly wrong (yes to what?)
  if (isYesNoOnly(v)) {
    return {
      ok: false,
      hint: "I need details about your work — could you list your jobs with dates? For example: 'From 2020-01 To 2023-06, Cook at McDonald's, Toronto'. Or reply NONE if you've never worked.",
    };
  }

  // Just language names — Tarandeep case
  if (isLanguageNameOnly(v)) {
    return {
      ok: false,
      hint: "That looks like a language. Could you tell me about your WORK history instead? List each job with dates — or reply NONE if you've never worked.",
    };
  }

  // Way too short — needs substance
  if (v.length < 10) {
    return {
      ok: false,
      hint: "Could you give a bit more detail? For each job please include the dates (From / To), job title, and employer name. Reply NONE if no employment.",
    };
  }

  // Has date or year or month — looks substantive — accept
  if (/\b(19|20)\d{2}\b/.test(v) || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(v)) {
    return { ok: true };
  }

  // Has "from" or "to" or "current" — also looks like employment
  if (/\b(from|to|current|present|continuing|ongoing|since)\b/i.test(v)) {
    return { ok: true };
  }

  // Borderline — accept but flag
  if (v.length >= 15) {
    return {
      ok: "flag",
      reason: `Employment answer looks short / undetailed: "${v.slice(0, 80)}"`,
    };
  }

  // Doesn't match obvious wrong patterns but no positive signals
  return {
    ok: false,
    hint: "Could you list your work history with dates? For each job: From (YYYY-MM), To (YYYY-MM), Job Title, Employer. Reply NONE if no employment.",
  };
}

// ─── Date validator ─────────────────────────────────────────────────
//
// For: date_of_birth, passport_expiry
// Catches: invalid month (2023-19-12), impossible dates, wrong format
//
// IRCC requires YYYY-MM-DD. Accept other formats but normalize.

function validateDate(answer: string, kind: "dob" | "passport_expiry"): ValidationResult {
  const v = (answer || "").trim();
  if (!v) return { ok: false, hint: "I need a date. Please reply with the date in YYYY-MM-DD format (e.g., 1995-08-22)." };

  // Try common formats
  const patterns = [
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/, // YYYY-MM-DD
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/, // DD-MM-YYYY (ambiguous with MM-DD-YYYY)
  ];

  let year = 0, month = 0, day = 0, matched = false;

  for (const re of patterns) {
    const m = v.match(re);
    if (m) {
      // First pattern: year/month/day; second: ambiguous — assume DD-MM-YYYY (Newton's clients tend to use this)
      if (re === patterns[0]) {
        [, year, month, day] = m.map((x) => parseInt(x, 10)) as any;
      } else {
        [, day, month, year] = m.map((x) => parseInt(x, 10)) as any;
        // If "day" > 12 we're confident it's DD-MM-YYYY; otherwise it's ambiguous
        // Leave as-is for now; flag if validation fails
      }
      matched = true;
      break;
    }
  }

  if (!matched) {
    return {
      ok: false,
      hint: "I couldn't read that date. Please use this format: YYYY-MM-DD. For example: 1995-08-22 (= 22 August 1995).",
    };
  }

  // Validate ranges
  if (month < 1 || month > 12) {
    return {
      ok: false,
      hint: `That date has month=${month} which isn't valid (must be 1-12). Please reply with the date in YYYY-MM-DD format. Example: 1995-08-22.`,
    };
  }
  if (day < 1 || day > 31) {
    return {
      ok: false,
      hint: `That date has day=${day} which isn't valid. Please reply with the date in YYYY-MM-DD format. Example: 1995-08-22.`,
    };
  }
  if (year < 1900 || year > 2100) {
    return {
      ok: false,
      hint: "That year doesn't look right. Please reply with the date in YYYY-MM-DD format. Example: 1995-08-22.",
    };
  }

  // Sanity-check by kind
  const now = new Date();
  const thisYear = now.getFullYear();
  if (kind === "dob") {
    // DOB shouldn't be in the future or > 110 years ago
    if (year > thisYear) {
      return { ok: false, hint: "Date of birth can't be in the future. Could you check the year?" };
    }
    if (thisYear - year > 110) {
      return { ok: false, hint: "That date of birth seems too far in the past. Please double-check the year." };
    }
  }
  if (kind === "passport_expiry") {
    // Passport expiry shouldn't be in the past (or it's not useful)
    // But don't BLOCK — some clients have passports about to expire and that's a real issue
    if (year < thisYear - 1) {
      return {
        ok: "flag",
        reason: `Passport expiry "${v}" is in the past — client may need to renew before applying`,
      };
    }
  }

  return { ok: true };
}

// ─── Master dispatcher ──────────────────────────────────────────────
//
// Given a question and an answer, return whether the answer is acceptable.
// This is the function the intake bot calls.

export function validateAnswer(
  questionText: string,
  answer: string,
  retryCount: number = 0
): ValidationResult {
  // SMART MODE: after 1 retry, accept whatever we got (don't loop infinitely)
  // The mapper will flag it for staff review later.
  if (retryCount >= 1) {
    // Still do a basic check — if it's literally empty, ask once more
    if (!answer || !answer.trim()) {
      return { ok: false, hint: "I didn't get an answer — could you try replying again?" };
    }
    return {
      ok: "flag",
      reason: `Client gave borderline answer after ${retryCount} retry; accepted to avoid loop. Question: "${questionText.slice(0, 60)}", Answer: "${answer.slice(0, 80)}"`,
    };
  }

  const kind = classifyQuestion(questionText);

  switch (kind) {
    case "employment":
      return validateEmployment(answer);
    case "date_of_birth":
      return validateDate(answer, "dob");
    case "passport_expiry":
      return validateDate(answer, "passport_expiry");
    // V1: only employment + dates. Other types pass through.
    default:
      return { ok: true };
  }
}

// ─── Self-test (for dev / CI) ───────────────────────────────────────

export function runSelfTest(): { passed: number; failed: number; failures: string[] } {
  const cases: Array<{ q: string; a: string; expect: "ok" | "reject" | "flag"; label: string }> = [
    // Employment — should reject
    { q: "Employment details — list ALL jobs with dates", a: "punjabi", expect: "reject", label: "Tarandeep — language as employment" },
    { q: "Employment details — list ALL jobs with dates", a: "yes", expect: "reject", label: "Yes-only employment" },
    { q: "Employment details — list ALL jobs with dates", a: "english, french", expect: "reject", label: "Language list as employment" },
    { q: "Employment details — list ALL jobs with dates", a: "cook", expect: "reject", label: "Single word employment (no dates)" },

    // Employment — should accept
    { q: "Employment details — list ALL jobs with dates", a: "NONE", expect: "ok", label: "Explicit NONE" },
    { q: "Employment details — list ALL jobs with dates", a: "From 2020-03 To 2023-06, Cook at McDonald's, Toronto", expect: "ok", label: "Well-formed employment" },
    { q: "Employment details — list ALL jobs with dates", a: "I worked as a cashier at Tim Hortons from January 2022 to present", expect: "ok", label: "Conversational employment" },
    { q: "Employment details — list ALL jobs with dates", a: "no employment", expect: "ok", label: "No employment" },

    // DOB — should reject
    { q: "What is your date of birth (DOB)?", a: "1995-19-12", expect: "reject", label: "Invalid month" },
    { q: "What is your date of birth (DOB)?", a: "yesterday", expect: "reject", label: "Non-date answer" },
    { q: "What is your date of birth (DOB)?", a: "2050-08-22", expect: "reject", label: "Future DOB" },

    // DOB — should accept
    { q: "What is your date of birth (DOB)?", a: "1995-08-22", expect: "ok", label: "Valid DOB YYYY-MM-DD" },
    { q: "What is your date of birth (DOB)?", a: "22-08-1995", expect: "ok", label: "Valid DOB DD-MM-YYYY" },

    // Passport expiry — should flag (past) but not reject
    { q: "When does your passport expire?", a: "2020-01-15", expect: "flag", label: "Past passport expiry" },

    // Other questions — pass through
    { q: "What is your full name as on passport?", a: "anything", expect: "ok", label: "Non-validated question" },
  ];

  const failures: string[] = [];
  let passed = 0;
  for (const c of cases) {
    const r = validateAnswer(c.q, c.a, 0);
    const got = r.ok === true ? "ok" : r.ok === "flag" ? "flag" : "reject";
    if (got !== c.expect) {
      failures.push(`✗ ${c.label}: expected ${c.expect}, got ${got} (${r.ok === false ? r.hint : r.ok === "flag" ? r.reason : ""})`);
    } else {
      passed++;
    }
  }
  return { passed, failed: failures.length, failures };
}
