// ─────────────────────────────────────────────────────────────────────
// Pre-Submission Review Checklists
// ─────────────────────────────────────────────────────────────────────
//
// What this is: per-application-type checklists that staff manually tick
// AFTER clicking "Assemble Submission Package" but BEFORE uploading to the
// IRCC portal. The checklist forces a deliberate human review of every
// requirement that IRCC commonly refuses applications for.
//
// Why it exists: assembled packages are mechanically correct (right
// filenames, right forms generated) but only humans can verify subjective
// things like:
//   - Status is currently valid (else need restoration)
//   - Field of study CIP code is on IRCC's list
//   - Language test result is < 2 years old
//   - Form fields actually match passport
//   - Photo meets IRCC specs (white background, dimensions)
//   - Fee paid and receipt attached
//
// Source: each item below is grounded in canada.ca IRCC requirements
// (researched May 2026). Item descriptions cite the specific IRCC rule.
//
// How it's used:
//   - Each item has a `key`, `label`, `description`, `required` flag,
//     `category` for grouping, and an `autoVerifiable` flag (system can
//     auto-tick).
//   - Staff sees the checklist in a new "Review" section under the case
//     panel. They tick items as they verify.
//   - "Mark Ready for IRCC Upload" button stays disabled until all
//     `required: true` items are ticked.
//   - Each tick saves: who ticked + timestamp (audit trail).
// ─────────────────────────────────────────────────────────────────────

export type ReviewCategory =
  | "status_eligibility"  // FIRST — catches expiry/restoration before anything else
  | "documents"           // physical doc quality
  | "forms"               // IMM form field accuracy
  | "submission_package"  // assembled package contents
  | "fees_signoff";       // fee, client signoff, internal approval

export type ReviewItem = {
  key: string;            // unique within app type, used for storage
  label: string;          // short, shown on screen
  description?: string;   // longer explanation for tooltip / expanded view
  category: ReviewCategory;
  required: boolean;      // blocks "Ready for IRCC" button if unticked
  autoVerifiable?: boolean; // system can auto-tick (doc exists, form generated, etc.)
};

export type ReviewChecklist = {
  applicationType: string;
  description: string;    // one-line summary shown at top
  items: ReviewItem[];
};

// ─────────────────────────────────────────────────────────────────────
// PGWP — Post-Graduation Work Permit (IMM 5710)
// ─────────────────────────────────────────────────────────────────────
// Source: canada.ca — most refused for: missing language test, expired
// status, wrong CIP code, missing field-of-study proof, late application
// (>180 days), insufficient passport validity, part-time studies during
// non-final semester. Research date: May 2026. ─────────────────────────

export const REVIEW_PGWP: ReviewChecklist = {
  applicationType: "PGWP",
  description: "Post-Graduation Work Permit — open work permit, one per lifetime, max 3 years",
  items: [
    // ── Status & Eligibility (THE MOST IMPORTANT — check FIRST) ─────────
    {
      key: "status_valid_or_restoration",
      label: "Current status valid OR within 90-day restoration window",
      description:
        "If study permit is still valid → apply normally with implied/maintained status. " +
        "If expired ≤ 90 days ago → must apply for RESTORATION ($350 fee) at the same time. " +
        "If expired > 90 days → cannot file PGWP from inside Canada. Client must leave. " +
        "Do NOT skip this — wrong filing path = automatic refusal + lost fee.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "applied_within_180_days",
      label: "Applying within 180 days of program completion",
      description:
        "180-day clock starts from the date on the official completion letter (NOT graduation " +
        "ceremony). After 180 days client is permanently ineligible. Verify completion-letter " +
        "date matches what's in the case file.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "study_permit_was_valid",
      label: "Study permit was valid at some point during the 180-day window",
      description:
        "If study permit expired BEFORE the 180-day window started, client is ineligible " +
        "regardless of restoration. Verify the dates align.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "dli_pgwp_eligible",
      label: "DLI is on IRCC's PGWP-eligible list",
      description:
        "Verify the school is on the current PGWP-eligible DLI list (canada.ca > Designated " +
        "Learning Institutions). Some private colleges and curriculum-licensing programs are " +
        "NOT eligible. If unsure → check the official list before submitting.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "program_min_8_months",
      label: "Program was ≥ 8 months long (or ≥ 900 hours if Quebec)",
      description:
        "Less than 8 months = ineligible. Confirm from transcript / completion letter.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "fulltime_each_semester",
      label: "Full-time student status maintained EACH semester",
      description:
        "Part-time only allowed in the FINAL semester. Any other part-time term = refusal " +
        "risk. Check transcript for any term that wasn't full-time.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "field_of_study_cip",
      label: "Field of study CIP code is on IRCC eligible list (or exempt)",
      description:
        "Required for diploma/certificate grads who applied for study permit ON OR AFTER " +
        "Nov 1, 2024. Bachelor/master/doctoral degree holders are EXEMPT. Verify the 6-digit " +
        "CIP code from school registrar against canada.ca CIP list.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "language_test_under_2_years",
      label: "Language test result < 2 years old",
      description:
        "IELTS-G / CELPIP-G / PTE Core / TEF / TCF only. Required CLB level: " +
        "CLB 7 (degree) or CLB 5 (diploma in eligible field). Test date must be < 2 years " +
        "from PGWP submission date. Older test = refusal.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "no_previous_pgwp",
      label: "Client has not been issued a PGWP before",
      description:
        "ONE PGWP per lifetime. Confirm with client + check IRCC notes if available. " +
        "Even an expired previous PGWP disqualifies them.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "passport_valid_long_enough",
      label: "Passport valid for full PGWP length (3 yrs ideal)",
      description:
        "PGWP duration is capped at passport expiry. If passport expires in 1 year, PGWP " +
        "will be 1 year (NOT 3). If client has time, recommend renewing passport BEFORE " +
        "submitting to get the full PGWP duration.",
      category: "status_eligibility",
      required: false,
    },

    // ── Forms (condensed) ───────────────────────────────────────────
    {
      key: "imm5710_reviewed",
      label: "IMM5710 reviewed end-to-end (every field accurate, signed, barcodes generated)",
      description:
        "Verify ALL: name/DOB/citizenship match passport; UCI matches study permit; current " +
        "address & phone; marital status + spouse if applicable; education entries; employment " +
        "history; native language. Form must be signed by client (online: barcode page; paper: " +
        "every signature line). Barcode page must validate.",
      category: "forms",
      required: true,
    },
    {
      key: "imm5476_signed",
      label: "IMM5476 — Use of Representative signed by client + Sandhu",
      description:
        "Section A signed by client, Section C/D signed by RCIC. Without this IRCC can't " +
        "communicate with us on the file.",
      category: "forms",
      required: true,
    },

    // ── Document Quality ─────────────────────────────────────────────
    {
      key: "passport_bio_clear",
      label: "Passport bio page — all 4 corners visible, text legible",
      category: "documents",
      required: true,
    },
    {
      key: "passport_all_stamped_pages",
      label: "Passport — every stamped/visa page included",
      description:
        "All pages with entry/exit stamps, visas, or any markings. Blank pages NOT needed.",
      category: "documents",
      required: true,
    },
    {
      key: "photo_meets_ircc_specs",
      label: "Digital photo meets IRCC specs",
      description:
        "JPEG, white/off-white background, head straight, neutral expression, no glasses " +
        "(if possible), 35mm × 45mm equivalent, taken within last 6 months. " +
        "Wrong specs = refusal.",
      category: "documents",
      required: true,
    },
    {
      key: "completion_letter_official",
      label: "Completion letter — official, dated, on school letterhead",
      description:
        "Must explicitly say program is complete. Course-finish letters or transcripts " +
        "alone don't count. Letter date = start of 180-day clock.",
      category: "documents",
      required: true,
    },
    {
      key: "transcript_official_final",
      label: "Official final transcript — all semesters, all courses, final grades",
      description:
        "Verifies full-time status each semester. Internal/student-portal screenshots " +
        "NOT acceptable. Must be from registrar.",
      category: "documents",
      required: true,
    },
    {
      key: "language_test_attached",
      label: "Language test result PDF attached to application",
      description:
        "IRCC's online checklist does NOT have a slot for language tests — must upload " +
        "in the 'Client Information' section. Verify it's actually in the upload.",
      category: "documents",
      required: true,
    },
    {
      key: "field_of_study_proof",
      label: "Field of study proof attached (if required)",
      description:
        "If client needs CIP-eligible field (diploma + study permit ≥ Nov 1 2024), upload " +
        "evidence (program description, CIP letter from registrar) in 'Client Information'. " +
        "Skip this for degree-level grads — they're exempt.",
      category: "documents",
      required: false,
    },

    // ── Submission Package ───────────────────────────────────────────
    {
      key: "submission_letter_generated",
      label: "Representative Submission Letter generated and reviewed",
      description:
        "Use Letter Generator. Read it through — it should match the case facts (school, " +
        "program, dates, client narrative).",
      category: "submission_package",
      required: true,
      autoVerifiable: true,
    },
    {
      key: "client_info_bundle_reviewed",
      label: "Client_Info bundle PDF reviewed (study permit, language test, transcript)",
      category: "submission_package",
      required: true,
    },
    {
      key: "filenames_standardized",
      label: "All filenames follow Newton's standard format",
      description: "<DocType>_<First>_<Last>.pdf — no spaces in DocType, no extra text.",
      category: "submission_package",
      required: true,
      autoVerifiable: true,
    },

    // ── Fees & Sign-off ──────────────────────────────────────────────
    {
      key: "fee_calculated_correct",
      label: "Total fee calculated correctly",
      description:
        "PGWP: CA$255 (work permit $155 + open work permit holder $100). " +
        "If restoration: + CA$350. Biometrics if needed: + CA$85.",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "client_confirmed_final",
      label: "Client confirmed final review of forms & docs",
      description:
        "Send package summary to client on WhatsApp. Get explicit 'I approve' before " +
        "submitting. Without this, any error becomes Newton's liability.",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "sandhu_approved",
      label: "Sandhu (RCIC) reviewed and approved package",
      description: "Final RCIC sign-off. Required for every submission.",
      category: "fees_signoff",
      required: true,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// SOWP — Spousal Open Work Permit
// ─────────────────────────────────────────────────────────────────────
// Source: canada.ca — significantly tightened Jan 21 2025 + Mar 4 2026.
// Most refused for: principal worker NOT in TEER 0/1 (or eligible TEER 2/3),
// principal worker has < 16 months work auth left, marriage proof
// insufficient, student-spouse SOWP filed in final term. ────────────

export const REVIEW_SOWP: ReviewChecklist = {
  applicationType: "SOWP",
  description: "Spousal Open Work Permit — open WP for spouse of TEER 0/1 worker, master's/PhD student, or PGWP holder",
  items: [
    // ── Status & Eligibility ────────────────────────────────────────
    {
      key: "spouse_status_valid_or_restoration",
      label: "Spouse's current status valid OR within 90-day restoration window",
      description:
        "If applicant is in Canada and current visitor/work/study permit expired, must apply " +
        "for restoration ($350) along with SOWP. If expired > 90 days, cannot file from inside " +
        "Canada — must apply from outside.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "principal_eligibility_path",
      label: "Principal applicant fits ONE eligibility path",
      description:
        "Choose ONE: " +
        "(A) Foreign worker in TEER 0/1, OR select TEER 2/3 from IRCC's list; " +
        "(B) International student in master's program ≥ 16 months / doctoral / listed " +
        "professional degree; " +
        "(C) PGWP holder employed in TEER 0/1/2/3. " +
        "DOES NOT QUALIFY: TEER 4/5 worker, student in bachelor's / college diploma, " +
        "student in final term (refused as of Mar 4 2026 even on renewal).",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "principal_16_months_work_auth",
      label: "Principal has ≥ 16 months valid work authorization remaining (path A)",
      description: "Skip if principal is a student (path B) or PGWP holder (path C).",
      category: "status_eligibility",
      required: false,
    },
    {
      key: "principal_lives_in_canada",
      label: "Principal applicant lives in Canada",
      description: "Or has confirmed plan to live in Canada while working.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "noc_teer_verified_by_duties",
      label: "Principal's NOC/TEER verified by ACTUAL duties, not job title",
      description:
        "IRCC officers re-classify based on duties listed in employer letter / job " +
        "description. A 'manager' title doing TEER 4 work won't qualify. " +
        "Check NOC duties match real role.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "marriage_proof_strong",
      label: "Marriage / common-law evidence is strong",
      description:
        "Marriage cert + photos + joint accounts + shared lease/utilities + insurance + " +
        "relationship timeline. Common-law: 12 months continuous cohabitation proof. " +
        "Weak relationship evidence is the #1 SOWP refusal reason.",
      category: "status_eligibility",
      required: true,
    },

    // ── Forms (condensed) ───────────────────────────────────────────
    {
      key: "sowp_form_reviewed",
      label: "Application form reviewed end-to-end (IMM5710 in Canada / IMM1295 outside)",
      description:
        "Verify ALL: correct form for location; name/DOB/citizenship match passport; marital " +
        "status = Married/Common-law with spouse info filled; employer section = 'Open' (no " +
        "specific employer); signed; barcodes generated.",
      category: "forms",
      required: true,
    },
    {
      key: "imm5476_signed_sowp",
      label: "IMM5476 — Use of Representative signed",
      category: "forms",
      required: true,
    },
    {
      key: "imm5409_if_commonlaw",
      label: "IMM5409 — Statutory Declaration of Common-Law (if common-law, not married)",
      description: "Only required for common-law couples. Skip if legally married.",
      category: "forms",
      required: false,
    },

    // ── Documents ────────────────────────────────────────────────────
    {
      key: "marriage_cert_attached",
      label: "Marriage certificate attached (or 12-month cohabitation evidence)",
      category: "documents",
      required: true,
    },
    {
      key: "principal_status_doc",
      label: "Principal's current work permit / study permit / PGWP attached",
      category: "documents",
      required: true,
    },
    {
      key: "principal_employment_letter",
      label: "Principal's employment letter (path A or C)",
      description:
        "Must include: job title, NOC, duties, salary, hours/week, start date, employer " +
        "address, signed by HR. Skip for student spouses (path B).",
      category: "documents",
      required: false,
    },
    {
      key: "principal_pay_stubs",
      label: "Principal's recent pay stubs (last 3 months)",
      category: "documents",
      required: false,
    },
    {
      key: "principal_school_doc",
      label: "Principal's enrollment letter (path B — student)",
      description: "From DLI confirming master's/doctoral/professional program enrollment.",
      category: "documents",
      required: false,
    },
    {
      key: "applicant_passport",
      label: "Applicant's passport bio page + all stamped pages",
      category: "documents",
      required: true,
    },
    {
      key: "applicant_photo",
      label: "Digital photo (IRCC specs)",
      category: "documents",
      required: true,
    },
    {
      key: "relationship_evidence",
      label: "Relationship evidence package (photos, joint docs, communication)",
      category: "documents",
      required: true,
    },

    // ── Fees & Sign-off ──────────────────────────────────────────────
    {
      key: "sowp_fee",
      label: "Fee calculated: $255 (WP $155 + open WP $100), + $350 if restoration",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "client_confirmed_sowp",
      label: "Client confirmed final review",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "sandhu_approved_sowp",
      label: "Sandhu (RCIC) approved",
      category: "fees_signoff",
      required: true,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Study Permit Extension (IMM 5709)
// ─────────────────────────────────────────────────────────────────────
// Source: canada.ca Guide 5552. Most refused for: study permit already
// expired > 90 days (not eligible to restore), no PAL when required, no
// proof of funds, school not on DLI list. ─────────────────────────

export const REVIEW_STUDY_PERMIT_EXT: ReviewChecklist = {
  applicationType: "Study Permit Extension",
  description: "Extending study permit from inside Canada (IMM5709)",
  items: [
    // ── Status & Eligibility ────────────────────────────────────────
    {
      key: "sp_status_valid_or_restoration",
      label: "Study permit valid OR within 90-day restoration window",
      description:
        "If valid → file extension normally (apply ≥ 30 days before expiry, ideally 4–6 months). " +
        "If expired ≤ 90 days → must include RESTORATION ($200) + extension fee ($150). " +
        "Cannot study during the wait. " +
        "If expired > 90 days → must leave Canada. Cannot file extension.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "applied_before_expiry_for_implied",
      label: "Application submitted BEFORE current SP expires (for maintained status)",
      description:
        "If filed before expiry → maintained status, can keep studying. " +
        "If filed after → restoration required, MUST STOP studying until approved.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "school_dli_status",
      label: "Current school is on the DLI list",
      description:
        "Verify DLI number in IRCC's DLI database. If de-designated, cannot continue studies.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "passport_valid_for_extension_period",
      label: "Passport valid for full requested extension period",
      description:
        "Study permit cannot be issued past passport expiry. Renew passport first if needed.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "pal_obtained_or_exempt",
      label: "Provincial Attestation Letter (PAL) obtained OR exempt",
      description:
        "PAL required for most new study permits. " +
        "EXEMPT if: same college (no school change), graduate-level program, K-12, " +
        "or specific exempt categories. Check IRCC PAL exemption list.",
      category: "status_eligibility",
      required: true,
    },

    // ── Forms (condensed) ───────────────────────────────────────────
    {
      key: "imm5709_reviewed",
      label: "IMM5709 reviewed end-to-end (latest version, every field accurate, signed, barcodes)",
      description:
        "Verify ALL: using LATEST IMM5709 version (old versions error on upload); personal " +
        "info matches passport; DLI number / program / dates match LOA; funds section completed " +
        "(tuition + living + travel); signed; barcode page validates.",
      category: "forms",
      required: true,
    },
    {
      key: "imm5476_signed_spe",
      label: "IMM5476 — Use of Representative signed",
      category: "forms",
      required: true,
    },

    // ── Documents ────────────────────────────────────────────────────
    {
      key: "passport_with_canada_entry_stamp",
      label: "Passport bio + most recent Canada entry stamp visible",
      description: "Required by Guide 5552 — entry stamp from most recent arrival.",
      category: "documents",
      required: true,
    },
    {
      key: "loa_current_school",
      label: "Letter of Acceptance from current/new school",
      category: "documents",
      required: true,
    },
    {
      key: "pal_attached_if_required",
      label: "PAL attached (if not exempt)",
      category: "documents",
      required: false,
    },
    {
      key: "proof_of_funds_strong",
      label: "Proof of funds: tuition + CA$20,635 living + travel",
      description:
        "Bank statements (last 4 months ideally), GIC, scholarship letter, employment letter " +
        "if working off-campus. Show enough to cover full extension period.",
      category: "documents",
      required: true,
    },
    {
      key: "current_study_permit_attached",
      label: "Current study permit (front + back) attached",
      category: "documents",
      required: true,
    },
    {
      key: "transcripts_so_far",
      label: "Most recent transcripts (showing satisfactory academic progress)",
      description:
        "If student has been failing or showing no progress, IRCC may refuse. Strong " +
        "transcripts = stronger application.",
      category: "documents",
      required: false,
    },
    // Employment / off-campus work — relevant when student is working
    {
      key: "spe_offcampus_work_hours_legal",
      label: "Off-campus work hours legal (≤ 24 hrs/wk during studies, full-time on breaks)",
      description:
        "As of Nov 2024, IRCC allows ≤ 24 hours/week off-campus during studies (full-time " +
        "during scheduled breaks). Working over the limit = serious refusal trigger AND " +
        "could affect future PGWP eligibility. Verify employer letter / pay stubs match.",
      category: "status_eligibility",
      required: false,
    },
    {
      key: "spe_employment_letter_if_working",
      label: "Current employer letter (if applicable)",
      description:
        "If client is working, attach employer letter showing: title, hours/week, salary, " +
        "start date. Must comply with study permit work conditions.",
      category: "documents",
      required: false,
    },
    {
      key: "spe_pay_stubs_if_working",
      label: "Recent pay stubs / T4 (if applicable)",
      description: "Last 3 months' pay stubs OR T4 from previous tax year if working.",
      category: "documents",
      required: false,
    },
    {
      key: "spe_employment_history_form",
      label: "IMM5709 employment history complete (last 5 years, no gaps)",
      description:
        "Form needs ALL jobs in last 5 years (Canada and abroad). Gaps without explanation " +
        "(unemployment / studies / stay-at-home) = refusal trigger.",
      category: "forms",
      required: true,
    },
    {
      key: "submission_letter_spe",
      label: "Representative Submission Letter generated and reviewed",
      category: "submission_package",
      required: true,
      autoVerifiable: true,
    },

    // ── Fees & Sign-off ──────────────────────────────────────────────
    {
      key: "spe_fee",
      label: "Fee: $150 SP extension + $200 restoration (if needed) + $85 biometrics (if needed)",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "client_confirmed_spe",
      label: "Client confirmed final review",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "sandhu_approved_spe",
      label: "Sandhu (RCIC) approved",
      category: "fees_signoff",
      required: true,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// TRV / Visitor Visa (IMM 5257 outside, IMM 5708 visitor record inside)
// ─────────────────────────────────────────────────────────────────────
// Most refused for: insufficient ties to home country, weak proof of
// funds, vague purpose of visit, missing host/inviter info, criminal/
// medical inadmissibility. ───────────────────────────────────────────

export const REVIEW_TRV: ReviewChecklist = {
  applicationType: "TRV / Visitor Visa",
  description: "Temporary Resident Visa for visiting Canada (IMM5257)",
  items: [
    // ── Status & Eligibility ────────────────────────────────────────
    {
      key: "trv_purpose_clear",
      label: "Purpose of visit clearly defined and documented",
      description:
        "Tourism / visit family / business meeting / etc. Must match itinerary, invitation " +
        "letter, and supporting docs. Vague purpose = top refusal reason.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "trv_dual_intent_handled",
      label: "Dual intent handled (if also pursuing PR)",
      description:
        "If client has open PR application or future PR plans, they must demonstrate they " +
        "WILL leave Canada at end of authorized stay. Letter of explanation strongly " +
        "recommended.",
      category: "status_eligibility",
      required: false,
    },
    {
      key: "trv_ties_to_home",
      label: "Strong ties to home country documented",
      description:
        "Job (employment letter + leave approval), family (dependents), property (deed/lease), " +
        "business ownership, etc. Without ties = #1 refusal reason.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "trv_no_inadmissibility",
      label: "No criminal/medical inadmissibility issues",
      description:
        "Check: prior visa refusals, criminal record, prior overstays, deportations from any " +
        "country, TB/medical conditions for designated countries.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "trv_passport_6_months_validity",
      label: "Passport valid ≥ 6 months beyond intended stay",
      category: "status_eligibility",
      required: true,
    },

    // ── Forms (condensed) ───────────────────────────────────────────
    {
      key: "imm5257_reviewed",
      label: "IMM5257 reviewed end-to-end (every field accurate, signed, barcodes)",
      description:
        "Verify ALL: latest version + all fields filled; purpose of visit matches supporting " +
        "docs; employment history (last 10 years) accurate; education history accurate; signed; " +
        "barcode page validates.",
      category: "forms",
      required: true,
    },
    {
      key: "imm5645_family_info",
      label: "IMM5645 — Family Information form completed",
      description: "Lists ALL family members (spouse, children, parents, siblings) with details.",
      category: "forms",
      required: true,
    },
    {
      key: "imm5476_signed_trv",
      label: "IMM5476 — Use of Representative signed",
      category: "forms",
      required: true,
    },

    // ── Documents ────────────────────────────────────────────────────
    {
      key: "passport_full_trv",
      label: "Passport bio + all pages with stamps/visas",
      category: "documents",
      required: true,
    },
    {
      key: "photo_trv",
      label: "Digital photo (IRCC specs)",
      category: "documents",
      required: true,
    },
    {
      key: "proof_of_funds_trv",
      label: "Proof of funds: bank statements (last 4 months)",
      category: "documents",
      required: true,
    },
    {
      key: "invitation_letter_if_visiting",
      label: "Invitation letter from host in Canada (if visiting)",
      description:
        "Host's status (citizen/PR/work permit), address, relationship, length of stay, " +
        "who pays expenses.",
      category: "documents",
      required: false,
    },
    {
      key: "host_status_doc",
      label: "Host's status document (passport / PR card / work permit)",
      category: "documents",
      required: false,
    },
    {
      key: "itinerary_attached",
      label: "Travel itinerary (flight booking + accommodation)",
      category: "documents",
      required: false,
    },
    // Employment is the #1 ties-to-home factor — give it dedicated items
    {
      key: "trv_employment_letter",
      label: "Employment letter from current employer (home country)",
      description:
        "Letter on official letterhead showing: job title, salary, length of employment, " +
        "approved leave dates (matching travel dates), confirmation of return, employer's " +
        "stamp/signature + contact info. Without this, ties-to-home is weak — top refusal " +
        "reason.",
      category: "documents",
      required: true,
    },
    {
      key: "trv_pay_stubs",
      label: "Recent pay stubs (last 3 months)",
      description: "Confirms ongoing employment + income level.",
      category: "documents",
      required: false,
    },
    {
      key: "trv_employment_history_complete",
      label: "10-year employment/education history complete on IMM5257",
      description:
        "Form requires 10 years — every job, every gap, every period of unemployment / " +
        "studies / stay-at-home. Gaps without explanation = refusal trigger. If retired or " +
        "self-employed, document accordingly.",
      category: "forms",
      required: true,
    },
    {
      key: "trv_self_employed_docs",
      label: "Self-employed: business registration + financials (if applicable)",
      description:
        "If client is self-employed: business registration, tax returns, recent bank " +
        "statements showing business income. Skip if employed by someone else.",
      category: "documents",
      required: false,
    },
    {
      key: "trv_retired_pension_docs",
      label: "Retired: pension/SSN proof (if applicable)",
      description: "Pension statement, SSN benefit letter, or retirement certificate.",
      category: "documents",
      required: false,
    },
    {
      key: "ties_evidence_attached",
      label: "Other ties-to-home evidence: property, family, business",
      category: "documents",
      required: true,
    },

    // ── Fees & Sign-off ──────────────────────────────────────────────
    {
      key: "trv_fee",
      label: "Fee: $100 TRV + $85 biometrics (if needed)",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "client_confirmed_trv",
      label: "Client confirmed final review",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "sandhu_approved_trv",
      label: "Sandhu (RCIC) approved",
      category: "fees_signoff",
      required: true,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Citizenship — Adult (CIT 0002)
// ─────────────────────────────────────────────────────────────────────
// Most refused for: insufficient physical presence (1095 days in 5 years),
// missed tax filings (3 of 5 years), language test gaps for 18-54, missing
// police certs for 183-day countries. ───────────────────────────────

export const REVIEW_CITIZENSHIP: ReviewChecklist = {
  applicationType: "Citizenship",
  description: "Canadian Citizenship — Adult Grant (CIT 0002)",
  items: [
    // ── Status & Eligibility ────────────────────────────────────────
    {
      key: "cit_pr_status_active",
      label: "PR status currently valid (not under removal/inadmissibility)",
      description:
        "If under removal order, in IRB proceedings, or under criminal inadmissibility " +
        "review → cannot apply. Verify CBSA/IRCC notices.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "cit_physical_presence_1095",
      label: "Physical presence: ≥ 1,095 days in last 5 years",
      description:
        "Use IRCC Physical Presence Calculator (online tool). Pre-PR days count as " +
        "half-day (max 365). Days outside Canada subtracted. Calculator output PDF must be " +
        "in submission package.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "cit_tax_filing_3_of_5",
      label: "Tax filing: filed taxes 3 of last 5 years (when required)",
      description:
        "Required if income met CRA filing threshold. If they didn't have to file (low " +
        "income), still need CRA Notice of Assessment showing 'not required'. Letter from " +
        "CRA may be needed.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "cit_language_proof_18_54",
      label: "Language proof CLB 4+ (if applicant aged 18-54)",
      description:
        "EXEMPT if < 18 or > 54 at time of application. Otherwise: CELPIP-G L4+/S4+, " +
        "IELTS-G listening 4.5/speaking 4.0, transcripts from Canadian high school/university " +
        "(English/French medium), or government-funded LINC/CLIC.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "cit_no_prohibitions",
      label: "No citizenship prohibitions (criminal/security/military)",
      description:
        "Check: indictable offense conviction in last 4 years, currently incarcerated, " +
        "under criminal investigation, IRB removal proceedings, security/war crimes " +
        "concerns, served in opposing armed forces.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "cit_police_certs_183_days",
      label: "Police certs from countries lived ≥ 183 days (in last 5 years)",
      description:
        "ANY country (other than Canada) where applicant lived 183+ consecutive or " +
        "non-consecutive days in any year of the 5-year window. Original or certified copies.",
      category: "status_eligibility",
      required: true,
    },

    // ── Forms (condensed) ───────────────────────────────────────────
    {
      key: "cit0002_reviewed",
      label: "CIT 0002 reviewed end-to-end (all sections complete, signed, dated)",
      description:
        "Verify ALL sections: residence history, work, education, physical presence, language, " +
        "consents. Form must be signed and dated by client.",
      category: "forms",
      required: true,
    },
    {
      key: "cit0007_completed_internal",
      label: "CIT 0007 (residence questionnaire) — completed internally as backup",
      description: "Newton internal practice — keeps detailed presence records on file.",
      category: "forms",
      required: false,
    },

    // ── Documents ────────────────────────────────────────────────────
    {
      key: "cit_pr_card_both_sides",
      label: "PR card (front + back) — current copy",
      category: "documents",
      required: true,
    },
    {
      key: "cit_pr_landing_doc",
      label: "PR landing document (IMM 1000 / 5292 / 5688 / Confirmation of PR)",
      category: "documents",
      required: true,
    },
    {
      key: "cit_passport_current",
      label: "Current passport (bio + all stamped pages)",
      category: "documents",
      required: true,
    },
    {
      key: "cit_passports_5_years",
      label: "All passports held in last 5 years (for travel history verification)",
      category: "documents",
      required: true,
    },
    {
      key: "cit_secondary_id",
      label: "Secondary ID (driver's license / health card / etc.)",
      category: "documents",
      required: true,
    },
    {
      key: "cit_photos_specs",
      label: "2 citizenship photos (50 mm × 70 mm — DIFFERENT from regular photo specs)",
      description:
        "CITIZENSHIP photo specs differ from work/study permit photos. Confirm photographer " +
        "knew it was for citizenship. Wrong size = re-take.",
      category: "documents",
      required: true,
    },
    {
      key: "cit_presence_calc_pdf",
      label: "Physical Presence Calculator PDF — printed from IRCC tool",
      category: "documents",
      required: true,
    },
    {
      key: "cit_language_proof_doc",
      label: "Language proof document (test result or qualifying transcript)",
      category: "documents",
      required: false,
    },
    {
      key: "cit_tax_notices_5_years",
      label: "CRA Notices of Assessment (3 of last 5 years minimum)",
      category: "documents",
      required: true,
    },
    {
      key: "cit_police_certs_attached",
      label: "Police certificates attached (for 183-day countries)",
      category: "documents",
      required: false,
    },

    // ── Fees & Sign-off ──────────────────────────────────────────────
    {
      key: "cit_fee",
      label: "Fee: $630 ($530 processing + $100 right-of-citizenship)",
      description: "Right-of-citizenship fee waived for minors.",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "client_confirmed_cit",
      label: "Client confirmed final review",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "sandhu_approved_cit",
      label: "Sandhu (RCIC) approved",
      category: "fees_signoff",
      required: true,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// PR Card Renewal (IMM 5444 + IMM 5644 checklist)
// ─────────────────────────────────────────────────────────────────────
// Source: canada.ca + IRCC Help Centre + IRPA s. 28 (researched May 2026).
// Most refused or returned for: applying too early (> 9 months before
// expiry, no name change), insufficient 730-day proof, photos that don't
// meet PR-card-specific specs (different from work-permit photos!),
// applying from outside Canada (must use PRTD instead). ───────────────

export const REVIEW_PR_CARD_RENEWAL: ReviewChecklist = {
  applicationType: "PR Card Renewal",
  description: "Permanent Resident Card renewal — IMM 5444, $50 fee, must be in Canada",
  items: [
    // ── Status & Eligibility (catch the disqualifiers first) ────────
    {
      key: "prcard_in_canada_now",
      label: "Client is currently INSIDE Canada (not outside)",
      description:
        "PR card renewal must be filed from inside Canada. If client is outside, they need " +
        "a Permanent Resident Travel Document (PRTD) to return first, then renew the card. " +
        "Online portal blocks submissions from outside Canada — wrong filing path = refusal.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "prcard_eligible_renewal_window",
      label: "Card expires within 9 months OR is already expired",
      description:
        "IRCC returns applications filed > 9 months before expiry UNLESS there's a name " +
        "change, gender marker change, photo discrepancy, or damaged/lost card. " +
        "Verify the renewal trigger is valid.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "prcard_residency_730_days",
      label: "Met 730-day residency obligation in last 5 years",
      description:
        "IRPA s. 28 — must be physically present in Canada ≥ 730 days within any 5-year " +
        "rolling window. Calculate from declared travel history. Time spent abroad with " +
        "Canadian-citizen spouse, working for Canadian employer abroad, or accompanying a " +
        "PR spouse working abroad MAY count — check exceptions. If short of 730, do NOT " +
        "submit blindly — file with H&C explanation or wait until met.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "prcard_residency_calculation_correct",
      label: "Travel history complete — every entry/exit declared",
      description:
        "IRCC cross-references with CBSA records. Any undeclared trip = misrepresentation = " +
        "5-year ban. Pull all entry/exit dates from passports + flight records + CBSA history " +
        "report (request from CBSA if needed).",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "prcard_not_under_removal",
      label: "Not under removal order or active inadmissibility review",
      description:
        "If under IRB removal proceedings, criminal inadmissibility review, or has unresolved " +
        "PR status investigation → cannot apply. Verify CBSA / IRCC notices on file.",
      category: "status_eligibility",
      required: true,
    },
    {
      key: "prcard_not_citizen",
      label: "Client has NOT become a Canadian citizen",
      description:
        "PR cards are not issued to citizens. If client took oath, they're a citizen and " +
        "cannot renew a PR card.",
      category: "status_eligibility",
      required: true,
    },

    // ── Forms (condensed) ───────────────────────────────────────────
    {
      key: "imm5444_reviewed",
      label: "IMM 5444 reviewed end-to-end (every field accurate, signed)",
      description:
        "Verify ALL: name spelling matches PR landing doc EXACTLY (else file IMM 5218 first); " +
        "UCI / Client ID matches landing doc; DOB / gender / country of birth match passport; " +
        "current Canadian address with postal code; every trip outside Canada in last 5 years " +
        "listed (days out < 1,095); employment/education history (last 5 years); signed and " +
        "dated by client.",
      category: "forms",
      required: true,
    },
    {
      key: "imm5644_checklist_completed",
      label: "IMM 5644 (PR Card Document Checklist) completed",
      description: "IRCC's official checklist — must be included with submission.",
      category: "forms",
      required: true,
    },
    {
      key: "imm5476_signed_prcard",
      label: "IMM 5476 — Use of Representative signed by client + Sandhu",
      category: "forms",
      required: true,
    },

    // ── Document Quality ────────────────────────────────────────────
    {
      key: "prcard_current_both_sides",
      label: "Current/expiring PR card (FRONT + BACK) attached",
      description: "Both sides required. Damaged card = also include damage statement.",
      category: "documents",
      required: true,
    },
    {
      key: "prcard_passport_bio_stamps",
      label: "Passport bio page + every stamped/visa page (5-year coverage)",
      description:
        "Need to see every entry stamp to verify travel history. If client renewed passports " +
        "during the 5-year window, attach BOTH old and new passports with all stamps.",
      category: "documents",
      required: true,
    },
    {
      key: "prcard_landing_doc",
      label: "PR landing document attached (IMM 1000 / 5292 / 5688 / COPR)",
      category: "documents",
      required: true,
    },
    {
      key: "prcard_photos_PR_specs",
      label: "2 photos meet PR-CARD specs (NOT work-permit specs)",
      description:
        "PR-card photos: 50mm × 70mm, color, white background, taken < 6 months. DIFFERENT " +
        "from work-permit photo dimensions. Photographer must know it's for PR card. " +
        "Wrong specs = automatic return, fee not refunded.",
      category: "documents",
      required: true,
    },
    {
      key: "prcard_residency_proof_noa",
      label: "CRA Notices of Assessment for last 3 years",
      description:
        "Primary residency proof. Even if income was zero, NOA shows Canadian tax filing. " +
        "If client didn't file when not required (low income), need CRA letter explaining " +
        "non-filing.",
      category: "documents",
      required: true,
    },
    {
      key: "prcard_residency_proof_t4",
      label: "T4 slips for last 3-5 years (employment in Canada)",
      category: "documents",
      required: false,
    },
    {
      key: "prcard_residency_proof_address",
      label: "Address proof: utility bills, lease, bank statements",
      description:
        "Cover the full 5-year window if possible. Gaps in address proof are common refusal " +
        "triggers. Match addresses with employment/education records.",
      category: "documents",
      required: true,
    },
    {
      key: "prcard_secondary_id",
      label: "Secondary government ID (driver's license / health card)",
      category: "documents",
      required: true,
    },
    {
      key: "prcard_name_change_doc",
      label: "Name change document (if applicable)",
      description:
        "Marriage certificate, divorce decree, court order. Required if name on application " +
        "differs from landing doc.",
      category: "documents",
      required: false,
    },

    // ── Submission Package ──────────────────────────────────────────
    {
      key: "prcard_submission_letter",
      label: "Representative Submission Letter generated and reviewed",
      category: "submission_package",
      required: true,
      autoVerifiable: true,
    },
    {
      key: "prcard_residency_calculator_attached",
      label: "Residency-day calculator output (Newton internal) attached",
      description:
        "Days-in / days-out spreadsheet with totals. Helps reviewer + future Newton staff " +
        "if file gets returned for clarification.",
      category: "submission_package",
      required: false,
    },

    // ── Fees & Sign-off ─────────────────────────────────────────────
    {
      key: "prcard_fee_paid",
      label: "Fee paid: CA$50 (PR card renewal)",
      description:
        "Non-refundable once processing begins. Receipt PDF must be uploaded to 'Fee Proof' " +
        "section. CA$50 is the ONLY correct fee — paying $255 (work permit fee) means client " +
        "filed wrong app type.",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "prcard_fee_receipt_attached",
      label: "Payment receipt PDF attached",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "prcard_client_confirmed",
      label: "Client confirmed final review",
      category: "fees_signoff",
      required: true,
    },
    {
      key: "prcard_sandhu_approved",
      label: "Sandhu (RCIC) approved",
      category: "fees_signoff",
      required: true,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Resolver — pick the right checklist for a case's form type
// ─────────────────────────────────────────────────────────────────────

export function getReviewChecklist(formType: string): ReviewChecklist | null {
  const ft = String(formType || "").toLowerCase();

  if (
    ft.includes("pgwp") ||
    ft.includes("post-graduation") ||
    ft.includes("post graduation")
  ) return REVIEW_PGWP;

  if (
    ft.includes("sowp") ||
    ft.includes("spousal open work permit") ||
    ft.includes("spousal work permit") ||
    (ft.includes("open work permit") && ft.includes("spous"))
  ) return REVIEW_SOWP;

  if (
    ft.includes("study permit extension") ||
    ft.includes("study permit ext") ||
    (ft.includes("study permit") && (ft.includes("extend") || ft.includes("renew") || ft.includes("ext")))
  ) return REVIEW_STUDY_PERMIT_EXT;

  if (
    ft.includes("trv") ||
    ft.includes("visitor visa") ||
    ft.includes("visitor record")
  ) return REVIEW_TRV;

  // PR card renewal/replacement — must come BEFORE citizenship branch
  // because some intake systems lump them together. PR card renewal has
  // very different requirements (730 days, IMM 5444, $50 fee) vs
  // citizenship (1095 days, CIT 0002, $630 fee).
  if (
    ft.includes("pr card renewal") ||
    ft.includes("pr card replacement") ||
    ft.includes("permanent resident card") ||
    ft.includes("imm5444") ||
    ft.includes("imm 5444") ||
    (ft.includes("pr card") && !ft.includes("citizenship"))
  ) return REVIEW_PR_CARD_RENEWAL;

  if (ft.includes("citizenship")) return REVIEW_CITIZENSHIP;

  // No checklist defined yet — null means "show generic message: not yet
  // available for this application type, contact dev"
  return null;
}

// Calculate summary metrics — used by UI
export function summarizeReview(
  checklist: ReviewChecklist,
  ticked: Record<string, { ticked: boolean; by?: string; at?: string }>,
): {
  total: number;
  required: number;
  tickedTotal: number;
  tickedRequired: number;
  readyForUpload: boolean;  // all required ticked
  byCategory: Record<ReviewCategory, { total: number; ticked: number }>;
} {
  const byCategory: any = {
    status_eligibility: { total: 0, ticked: 0 },
    documents: { total: 0, ticked: 0 },
    forms: { total: 0, ticked: 0 },
    submission_package: { total: 0, ticked: 0 },
    fees_signoff: { total: 0, ticked: 0 },
  };

  let required = 0;
  let tickedRequired = 0;
  let tickedTotal = 0;

  for (const item of checklist.items) {
    byCategory[item.category].total++;
    const isTicked = !!ticked[item.key]?.ticked;
    if (isTicked) {
      tickedTotal++;
      byCategory[item.category].ticked++;
    }
    if (item.required) {
      required++;
      if (isTicked) tickedRequired++;
    }
  }

  return {
    total: checklist.items.length,
    required,
    tickedTotal,
    tickedRequired,
    readyForUpload: tickedRequired === required,
    byCategory,
  };
}

export const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  status_eligibility: "Status & Eligibility",
  documents: "Document Quality",
  forms: "IRCC Form Review",
  submission_package: "Submission Package",
  fees_signoff: "Fees & Sign-off",
};
