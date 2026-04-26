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

// ── Shared parsing helpers ────────────────────────────────────────────────

const parseAddress = (raw: string) => {
  const parts = (raw || "").split(",").map((p) => p.trim());
  const streetMatch = (parts[0] || "").match(/^(\d+)\s+(.+)/);
  return {
    apt_unit: "",
    street_num: streetMatch ? streetMatch[1] : "",
    street_name: streetMatch ? streetMatch[2] : (parts[0] || ""),
    city: parts[1] || "",
    province: parts[2] || "",
    postal_code: parts[3] || "",
    country: parts[4] || "Canada",
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

// ─────────────────────────────────────────────────────────────────────────
// MAPPER 1: PGWP / SOWP / BOWP / VOWP / Work Permits → IMM5710E
// ─────────────────────────────────────────────────────────────────────────
//
// Question flow (from application-question-flows.ts → 'pgwp' / 'work_permit'):
//   Q1  Have you used any other name?
//   Q2  Marital status
//   Q3  Spouse name & marriage date
//   Q4  Previous marriage / common-law
//   Q5  Mailing address
//   Q6  Residential (or SAME)
//   Q7  Phone
//   Q8  Original entry to Canada (date and place)
//   Q9  Current entry to Canada
//   Q10 Current document number (Study/Work Permit)
//   Q11 Have you ever been refused?
//   Q12 Medical history
//   Q13 Criminal history
//   Q14 Education history
//   Q15 Employment history
//   Q16 Native language and English/French
//   Q17 Language test taken?
//   Q18 Medical field worker?

function mapForPGWP(intake: Record<string, any>, formType: string): Record<string, any> {
  const { qN } = buildLookup(intake);
  const ft = (formType || "").toLowerCase();

  // Marital
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

  // Spouse (Q3): "Jane Doe, 2020-06-15"
  const spouseRaw = qN(3);
  const isMarried = marital === "Married" || marital === "Common-Law";
  const spouseParts = isMarried && !isNo(spouseRaw) ? spouseRaw.split(",").map((p) => p.trim()) : [];
  const spouseName = spouseParts[0] || "";
  const spouseNameParts = spouseName.split(" ");

  // Previous marriage (Q4)
  const prevRaw = qN(4);
  const hasPrev = isYes(prevRaw);
  const prevParts = hasPrev ? prevRaw.split(/[,;]+/).map((p) => p.trim()) : [];

  // Addresses (Q5/Q6)
  const mailing = parseAddress(qN(5));
  const resRaw = qN(6);
  const resSame = isNo(resRaw) || resRaw.toLowerCase().includes("same") || !resRaw;
  const residential = resSame ? mailing : parseAddress(resRaw);

  // Phone (Q7)
  const phone = parsePhone(qN(7));

  // Entry (Q8): "2020-09-01, Vancouver/YVR"
  const entryParts = qN(8).split(",").map((p) => p.trim());
  const entryDate = parseDate(entryParts[0] || "");

  // Current document (Q10)
  const docNum = qN(10);

  // Background (Q11/Q12/Q13)
  const refusalRaw = qN(11);
  const hasRefusal = isYes(refusalRaw);
  const medicalRaw = qN(12);
  const hasMedical = isYes(medicalRaw);
  const criminalRaw = qN(13);
  const hasCriminal = isYes(criminalRaw);

  // Education (Q14)
  const eduRaw = qN(14);
  const hasEdu = !!eduRaw && !isNo(eduRaw);
  const eduParts = hasEdu ? eduRaw.split(",").map((p) => p.trim()) : [];

  // Languages (Q16/Q17)
  const langRaw = qN(16);
  const langParts = langRaw.split(/[,;]/).map((p) => p.trim());
  const nativeLang = langParts[0] || "";
  const commLang = (langParts[1] || "English").toLowerCase().includes("french")
    ? "French"
    : langParts[1]?.toLowerCase().includes("both")
    ? "Both"
    : "English";
  const langTest = isYes(qN(17));

  return {
    ...buildIdentitySection(intake),
    // Section 1: Application type
    applying_restore_status: ft.includes("restore"),
    applying_extend_stay: !ft.includes("restore"),
    applying_change_employer: ft.includes("lmia") || ft.includes("change employer"),
    applying_trp: ft.includes("trp"),

    // UCI from intake (rare)
    uci_client_id: stripPrefix(intake.uci || ""),

    // Q1: Other names
    has_alias: isYes(qN(1)),
    alias_family_name: hasPrev ? "" : "",
    alias_given_name: "",

    // Q2-Q4: Marital
    marital_status: marital,
    spouse_family_name: spouseNameParts.slice(-1)[0] || "",
    spouse_given_name: spouseNameParts.slice(0, -1).join(" ") || "",
    date_of_marriage: spouseParts[1] || "",
    spouse_status_in_canada: "",
    previously_married: hasPrev,
    prev_spouse_family_name: hasPrev ? (prevParts[1] || "").split(" ").slice(-1)[0] : "",
    prev_spouse_given_name: hasPrev ? (prevParts[1] || "").split(" ").slice(0, -1).join(" ") : "",
    prev_relationship_type: hasPrev ? "Married" : "",
    prev_marriage_from: hasPrev ? prevParts[3] || "" : "",
    prev_marriage_to: hasPrev ? prevParts[4] || "" : "",

    // Q5-Q7: Address & phone
    mailing_apt_unit: mailing.apt_unit,
    mailing_street_num: mailing.street_num,
    mailing_street_name: mailing.street_name,
    mailing_city: mailing.city,
    mailing_province: mailing.province,
    mailing_postal_code: mailing.postal_code,
    mailing_country: "Canada",
    residential_same_as_mailing: resSame,
    residential_apt_unit: resSame ? "" : residential.apt_unit,
    residential_street_num: resSame ? "" : residential.street_num,
    residential_street_name: resSame ? "" : residential.street_name,
    residential_city: resSame ? "" : residential.city,
    residential_province: resSame ? "" : residential.province,
    phone_type: "Canada/US",
    phone_number_type: "Mobile",
    phone_area_code: phone.area_code,
    phone_first_three: phone.first_three,
    phone_last_five: phone.last_five,
    email: stripPrefix(intake.email || ""),

    // Q8: Original entry
    original_entry_date: entryParts[0] || "",
    original_entry_place: entryParts[1] || "",
    original_entry_purpose: ft.includes("study") ? "Study" : "Work",
    recent_entry_date: entryParts[0] || "",
    recent_entry_place: entryParts[1] || "",

    // Q10: Document
    previous_doc_number: docNum,
    work_permit_type: ft.includes("lmia") ? "Work" : "",

    // Section 5: Languages
    native_language: nativeLang,
    communicate_language: commLang,
    language_test_taken: langTest,
    frequent_language: nativeLang || "English",

    // Status (in Canada — temporary)
    current_status: ft.includes("study") ? "Student" : "Worker",
    current_status_from_date: entryParts[0] || "",
    current_status_to_date: "",

    // Q14: Education
    has_education: hasEdu,
    edu_school_name: eduParts[0] || "",
    edu_field_of_study: eduParts[1] || "",
    edu_city: eduParts[2] || "",
    edu_country: eduParts[3] || "Canada",
    edu_from_year: (eduRaw.match(/(20\d{2})/g) || [])[0] || "",
    edu_from_month: "09",
    edu_to_year: (eduRaw.match(/(20\d{2})/g) || [])[1] || "",
    edu_to_month: "06",

    // Q15: Employment (single record, can be expanded)
    employment: [],

    // Q11/Q12/Q13: Background
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

  // Visitor Record (Inside Canada) — IMM5708E
  if (ft.includes("visitor record") || (ft.includes("trv") && ft.includes("inside"))) {
    return mapForVisitorRecord(intake, formType);
  }

  // Visitor Visa (Outside Canada) — IMM5257E
  if (ft.includes("visitor visa") || (ft.includes("trv") && !ft.includes("inside")) || ft.includes("super visa")) {
    return mapForVisitorVisa(intake, formType);
  }

  // Default: PGWP / SOWP / BOWP / VOWP / Work Permits / generic — IMM5710E
  return mapForPGWP(intake, formType);
}
