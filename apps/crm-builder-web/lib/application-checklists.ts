import { DocumentItem } from "@/lib/models";

export type ApplicationChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  keywords: string[];
};

function normalize(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function resolveApplicationChecklistKey(formType: string):
  | "pgwp"
  | "trv_inside"
  | "visitor_visa"
  | "visitor_record"
  | "work_permit"
  | "sowp"
  | "study_permit"
  | "study_permit_extension"
  | "super_visa"
  | "express_entry"
  | "express_entry_pr"
  | "family_sponsorship"
  | "citizenship_prcard"
  | "pr_card_renewal"
  | "us_b1b2"
  | "uk_visitor"
  | "refugee"
  | "canadian_passport_doc"
  | "generic" {
  const ft = normalize(formType);
  if (ft.includes("pgwp") || ft.includes("post graduation") || ft.includes("imm5710")) return "pgwp";
  if (ft.includes("trv inside")) return "trv_inside";
  if (ft.includes("visitor visa") || ft.includes("trv outside") || ft === "trv") return "visitor_visa";
  if (ft.includes("visitor record")) return "visitor_record";
  // SOWP — must come BEFORE generic work_permit branch. SOWP has very specific
  // requirements (principal worker info, marriage proof, NOC duties) that
  // don't apply to LMIA / VOWP / generic open work permits.
  if (
    ft.includes("sowp") ||
    ft.includes("spousal open work permit") ||
    ft.includes("spousal work permit") ||
    (ft.includes("open work permit") && (ft.includes("spous") || ft.includes("partner")))
  ) return "sowp";
  if (
    ft.includes("work permit") ||
    ft.includes("lmia") ||
    ft.includes("bowp") ||
    ft.includes("vowp") ||
    ft.includes("open work permit") ||
    ft.includes("bridging") ||
    ft.includes("vulnerable") ||
    ft.includes("restoration") ||
    ft.includes("restore")
  )
    return "work_permit";
  if (ft.includes("study permit")) return "study_permit";
  if (ft.includes("study permit extension") || ft.includes("college change") || ft.includes("spe")) return "study_permit_extension";
  if (ft.includes("super visa") || ft.includes("supervisa")) return "super_visa";
  if (ft.includes("express entry") && (ft.includes("pr application") || ft.includes("after ita"))) return "express_entry_pr";
  if (ft.includes("express entry") || ft.includes("pnp")) return "express_entry";
  if (ft.includes("pr application")) return "express_entry_pr";
  if (ft.includes("spousal sponsorship") || ft.includes("parents") || ft.includes("grandparents sponsorship") || ft.includes("family sponsorship")) return "family_sponsorship";
  // PR card renewal is DIFFERENT from citizenship — must route separately.
  // PR card: 730 days, $50 fee, IMM 5444 — 14 questions.
  // Citizenship: 1095 days, $630 fee, CIT 0002 — 21 questions.
  // Old code mapped both to citizenship_prcard (wrong — bot asked citizenship questions
  // for PR card renewal cases). Branch order matters: check PR card first so a form type
  // like "PR card renewal" doesn't accidentally hit the citizenship branch.
  if (
    ft.includes("pr card renewal") ||
    ft.includes("pr card replacement") ||
    ft.includes("permanent resident card") ||
    ft.includes("imm5444") ||
    ft.includes("imm 5444") ||
    (ft.includes("pr card") && !ft.includes("citizenship"))
  ) return "pr_card_renewal";
  if (ft.includes("citizenship")) return "citizenship_prcard";
  if (ft.includes("ds 160") || ft.includes("b1") || ft.includes("b2") || ft.includes("usa")) return "us_b1b2";
  if (ft.includes("uk visa") || ft.includes("uk visitor")) return "uk_visitor";
  if (ft.includes("refugee")) return "refugee";
  if (ft.includes("canadian passport") || ft.includes("travel document")) return "canadian_passport_doc";
  return "generic";
}

const CHECKLISTS: Record<string, ApplicationChecklistItem[]> = {
  pgwp: [
    { key: "passport", label: "Passport", required: true, keywords: ["passport"] },
    { key: "study_permit", label: "Valid Study Permit", required: true, keywords: ["study permit", "permit"] },
    { key: "completion_letter", label: "Completion Letter", required: true, keywords: ["completion letter", "completion"] },
    { key: "transcripts", label: "Official Transcripts", required: true, keywords: ["transcript"] },
    { key: "digital_photo", label: "Digital Photo", required: true, keywords: ["photo", "digital photo"] },
    { key: "language_test", label: "Language Test (IELTS/CELPIP/PTE)", required: false, keywords: ["ielts", "celpip", "pte", "language"] },
    { key: "old_studies", label: "Old/Past College Documents (if transfer)", required: false, keywords: ["old college", "past stud", "previous college"] }
  ],
  trv_inside: [
    { key: "passport", label: "Passport (all pages, clear copies)", required: true, keywords: ["passport"] },
    { key: "current_permit", label: "Current Status Document (study/work permit or TRV)", required: true, keywords: ["current permit", "permit", "status"] },
    { key: "digital_photo", label: "Digital Photo (recent, white background)", required: true, keywords: ["digital photo", "photo"] },
    { key: "funds", label: "Proof of Funds", required: true, keywords: ["fund", "bank", "statement"] },
    { key: "ties", label: "Proof of Ties to Home Country", required: false, keywords: ["ties", "property", "employment", "family"] }
  ],
  visitor_visa: [
    { key: "passport", label: "Passport (all pages, valid min 6 months)", required: true, keywords: ["passport"] },
    { key: "digital_photo", label: "Digital Photo (recent, white background)", required: true, keywords: ["photo", "digital photo"] },
    { key: "employment_letter", label: "Employment Letter (current employer, salary, position, leave approval)", required: true, keywords: ["employment letter", "job letter", "salary"] },
    { key: "bank_statements", label: "Bank Statements (last 3-6 months)", required: true, keywords: ["bank", "statement", "fund"] },
    { key: "property_docs", label: "Property Documents / Proof of Ties to Home Country", required: false, keywords: ["property", "ties", "asset"] },
    { key: "invitation_letter", label: "Invitation Letter from Contact in Canada (if visiting someone)", required: false, keywords: ["invitation", "invite", "sponsor letter"] },
    { key: "travel_history", label: "Previous Visas / Travel History (US visa, Schengen, etc.)", required: false, keywords: ["previous visa", "travel history", "us visa"] },
    { key: "education_docs", label: "Education Documents (degrees, diplomas)", required: false, keywords: ["degree", "diploma", "education"] }
  ],
  visitor_record: [
    { key: "passport", label: "Passport (all pages, clear copies)", required: true, keywords: ["passport"] },
    { key: "current_status", label: "Current Visitor Record / Status Document", required: true, keywords: ["visitor record", "permit", "visa", "status"] },
    { key: "digital_photo", label: "Digital Photo (recent, white background)", required: true, keywords: ["photo", "digital photo"] },
    { key: "funds", label: "Proof of Funds (bank statements last 3 months)", required: true, keywords: ["fund", "bank", "statement"] },
    { key: "travel_history", label: "Travel History Documents (stamps, previous visas)", required: false, keywords: ["travel", "stamp", "previous visa"] },
    { key: "reason_letter", label: "Extension/Restoration Reason Letter", required: true, keywords: ["letter", "explanation", "reason", "extension"] },
    { key: "ties_home", label: "Proof of Ties to Home Country (property, employment, family)", required: false, keywords: ["ties", "property", "employment letter", "family"] }
  ],
  work_permit: [
    { key: "passport", label: "Passport", required: true, keywords: ["passport"] },
    { key: "current_permits", label: "All Current Permits", required: true, keywords: ["permit"] },
    { key: "job_offer", label: "Job Offer/Employment Support Docs", required: true, keywords: ["job", "offer", "employment", "lmia"] },
    { key: "education_docs", label: "Education Documents", required: false, keywords: ["education", "degree", "diploma", "transcript"] },
    { key: "language_test", label: "English Test (if available)", required: false, keywords: ["ielts", "celpip", "pte", "language"] }
  ],
  sowp: [
    // Spousal Open Work Permit — applicant is the SPOUSE; principal docs
    // belong to the partner (worker / student / PGWP holder)
    { key: "applicant_passport", label: "Applicant's passport (bio + stamped pages)", required: true, keywords: ["passport"] },
    { key: "applicant_photo", label: "Applicant's digital photo (IRCC specs)", required: true, keywords: ["photo"] },
    { key: "marriage_cert", label: "Marriage certificate (or 12-month cohabitation evidence)", required: true, keywords: ["marriage", "cohabitation", "common law"] },
    { key: "principal_status", label: "Principal partner's permit (work/study/PGWP)", required: true, keywords: ["work permit", "study permit", "pgwp", "permit"] },
    { key: "principal_employment_letter", label: "Principal's employment letter (NOC, duties, salary, hours)", required: false, keywords: ["employment letter", "job letter", "noc"] },
    { key: "principal_pay_stubs", label: "Principal's pay stubs (last 3 months)", required: false, keywords: ["pay stub", "payslip"] },
    { key: "principal_school_doc", label: "Principal's enrollment letter (if student spouse)", required: false, keywords: ["enrollment", "loa", "school"] },
    { key: "relationship_evidence", label: "Relationship evidence (photos, joint accounts, lease)", required: true, keywords: ["photos", "joint", "lease", "utilities"] },
    { key: "rep_letter", label: "Use of Representative form (IMM 5476)", required: true, keywords: ["5476", "representative"] },
    { key: "submission_letter", label: "Representative Submission Letter", required: false, keywords: ["submission letter"] }
  ],
  study_permit: [
    { key: "passport", label: "Passport", required: true, keywords: ["passport"] },
    { key: "loa", label: "Letter of Acceptance (LOA)", required: true, keywords: ["loa", "letter of acceptance"] },
    { key: "tuition", label: "Tuition Fee Payment Proof", required: true, keywords: ["tuition", "fee receipt"] },
    { key: "education_docs", label: "Education Credentials", required: true, keywords: ["marksheet", "transcript", "degree", "diploma"] },
    { key: "funds", label: "Bank Statements / Financial Proof", required: true, keywords: ["bank", "statement", "fund"] },
    { key: "language", label: "English Proficiency", required: false, keywords: ["ielts", "toefl", "pte"] },
    { key: "medical", label: "Medical Exam", required: false, keywords: ["medical"] }
  ],
  study_permit_extension: [
    { key: "passport", label: "Passport (front/back clear copies)", required: true, keywords: ["passport"] },
    { key: "permits", label: "All current permits", required: true, keywords: ["permit"] },
    { key: "photo", label: "Recent digital photograph", required: true, keywords: ["photo", "digital"] },
    { key: "enrollment", label: "Enrollment letter", required: true, keywords: ["enrollment"] },
    { key: "transcripts", label: "Unofficial transcripts", required: true, keywords: ["transcript"] },
    { key: "tuition", label: "Tuition fee receipts", required: true, keywords: ["tuition", "fee receipt"] },
    { key: "loa", label: "LOA + PAL (if applicable)", required: true, keywords: ["loa", "pal"] },
    { key: "previous_college", label: "Previous college docs (if transfer)", required: false, keywords: ["previous", "old college", "transfer"] }
  ],
  super_visa: [
    { key: "passport", label: "Applicant Passport(s)", required: true, keywords: ["passport"] },
    { key: "digital_photo", label: "Digital Photo", required: true, keywords: ["photo"] },
    { key: "medical", label: "Proof of Upfront Medical", required: true, keywords: ["medical"] },
    { key: "insurance", label: "Medical Insurance", required: true, keywords: ["insurance"] },
    { key: "applicant_funds", label: "Applicant Proof of Funds", required: true, keywords: ["fund", "bank", "certificate", "statement"] },
    { key: "marriage", label: "Marriage Certificate (if applicable)", required: false, keywords: ["marriage certificate"] },
    { key: "sponsor_status", label: "Sponsor Status Proof (PR/Citizenship)", required: true, keywords: ["pr card", "canadian passport", "certificate"] },
    { key: "sponsor_income", label: "Sponsor Income Docs (NOA/T4/Job/Paystubs)", required: true, keywords: ["noa", "t4", "job letter", "paystub"] },
    { key: "sponsor_birth", label: "Sponsor Birth Certificate (if available)", required: false, keywords: ["birth certificate"] }
  ],
  express_entry: [
    { key: "pcc", label: "Police Clearance Certificate (all countries lived 6+ months after age 18)", required: true, keywords: ["police clearance", "pcc", "police certificate"] },
    { key: "passport", label: "Passport (all pages including blank)", required: true, keywords: ["passport"] },
    { key: "ielts", label: "IELTS TRF / Language Test Result", required: true, keywords: ["ielts", "celpip", "tef", "trf", "language test"] },
    { key: "education_docs", label: "All Educational Documents (10+2 onwards) — Degrees, Diplomas, Transcripts", required: true, keywords: ["degree", "diploma", "transcript", "education", "marksheet"] },
    { key: "photo", label: "Digital Photo (as per IRCC guidelines)", required: true, keywords: ["photo", "digital photo", "photograph"] },
    { key: "employment_letter", label: "Letter of Employment (all employers)", required: true, keywords: ["employment letter", "job letter", "offer letter", "reference letter"] },
    { key: "pay_stubs", label: "Pay Stubs (all employments)", required: true, keywords: ["pay stub", "paystub", "pay slip", "payslip", "salary slip"] },
    { key: "tax_docs", label: "Tax Documents (T4, NOA — all employments)", required: true, keywords: ["tax", "t4", "noa", "notice of assessment"] },
    { key: "bank_statements", label: "Bank Statements (all employments)", required: true, keywords: ["bank statement", "bank", "statement"] },
    { key: "permits", label: "All Immigration Permits (study/work/visitor)", required: true, keywords: ["permit", "study permit", "work permit", "visitor record"] },
    { key: "pr_sibling_proof", label: "Proof of PR/Citizen Sibling — Passport, PR card (front & back), Govt ID, Bank Statement", required: false, keywords: ["pr card", "sibling", "brother", "sister", "family member"] },
    { key: "relationship_proof", label: "Proof of Relationship with PR Sibling — Birth Certificates", required: false, keywords: ["birth certificate", "relationship", "sibling proof"] },
  ],
  family_sponsorship: [
    // APPLICANT DOCUMENTS
    { key: "passport", label: "Passport (Applicant)", required: true, keywords: ["passport"] },
    { key: "birth_cert", label: "Birth Certificate (Applicant)", required: true, keywords: ["birth certificate"] },
    { key: "police_clearance", label: "Police Clearance Certificate (all countries where stayed 6+ months after age 18)", required: true, keywords: ["police clearance", "pcc", "criminal record"] },
    { key: "employment_docs", label: "Employment Letter + 3 Paystubs (current/old)", required: true, keywords: ["employment letter", "job letter", "paystub"] },
    { key: "status_docs", label: "All Permits / Status Documents (study permit, work permit, etc.)", required: true, keywords: ["permit", "status", "visa"] },
    { key: "love_letter", label: "Letter of Explanation (Love Story)", required: true, keywords: ["love story", "letter of explanation", "relationship letter"] },
    { key: "govt_id", label: "Government Issued Identity Cards (Applicant)", required: true, keywords: ["id card", "identity card", "aadhar", "driver licence"] },
    { key: "digital_photo", label: "Digital Photo (as per IRCC guidelines)", required: true, keywords: ["digital photo", "photo"] },
    { key: "noa", label: "Notice of Assessment (Applicant)", required: true, keywords: ["noa", "notice of assessment", "t1"] },
    { key: "education_docs", label: "Educational Documents (degrees, transcripts)", required: true, keywords: ["degree", "transcript", "diploma", "education"] },
    // SPONSOR DOCUMENTS
    { key: "sponsor_passport", label: "Sponsor — Passport", required: true, keywords: ["sponsor passport"] },
    { key: "sponsor_pr_card", label: "Sponsor — PR Card", required: true, keywords: ["pr card", "permanent resident card"] },
    { key: "sponsor_noa", label: "Sponsor — Recent Notice of Assessment", required: true, keywords: ["sponsor noa", "notice of assessment"] },
    { key: "sponsor_employment", label: "Sponsor — Employment Letter + 3 Recent Paystubs (stating salary and regular hours)", required: true, keywords: ["sponsor employment", "sponsor job letter", "sponsor paystub"] },
    { key: "marriage_cert", label: "Marriage Certificate", required: true, keywords: ["marriage certificate"] },
    // COHABITATION / RELATIONSHIP PROOF (any 2)
    { key: "joint_ownership", label: "Proof of Joint Ownership / Rental Agreement / Joint Utility/Bank Account", required: true, keywords: ["joint ownership", "rental agreement", "joint bank", "utility"] },
    { key: "vehicle_insurance", label: "Vehicle Insurance (showing both names) OR Government ID showing same address", required: false, keywords: ["vehicle insurance", "car insurance"] },
    // PHOTOS
    { key: "photos", label: "20 Photographs (wedding, engagement, celebrations, outings)", required: true, keywords: ["photo", "photograph", "wedding photo"] },
    // RELATIONSHIP EVIDENCE (any 2)
    { key: "financial_evidence", label: "Financial Support Evidence (joint bank statement, utility bills, e-transfer screenshots)", required: true, keywords: ["joint bank statement", "e-transfer", "utility bill"] },
    { key: "relationship_proof", label: "Other Relationship Proof (signed letters from friends/family, social media, proof of cohabitation)", required: false, keywords: ["relationship proof", "social media", "friend letter"] },
    // CONTACT PROOF
    { key: "contact_proof", label: "Proof of Contact (text messages, emails, WhatsApp chats, airline tickets, boarding passes)", required: true, keywords: ["text message", "email", "whatsapp chat", "airline ticket", "boarding pass"] }
  ],
  citizenship_prcard: [
    { key: "passport_current", label: "Current passport (all pages with stamps + bio page)", required: true, keywords: ["passport"] },
    { key: "passport_old", label: "Expired passports (last 5 years)", required: false, keywords: ["old passport", "expired"] },
    { key: "pr_card", label: "PR card — both sides (must be valid)", required: true, keywords: ["pr card", "permanent resident"] },
    { key: "pr_landing", label: "PR landing document (IMM 1000 / IMM 5292 / IMM 5688)", required: true, keywords: ["imm 1000", "imm 5292", "imm 5688", "record of landing", "copr"] },
    { key: "secondary_id", label: "Secondary photo ID (driver's licence / health card / provincial ID)", required: true, keywords: ["driver", "health card", "provincial id"] },
    { key: "photos", label: "Two citizenship-format photos (with photographer info on back)", required: true, keywords: ["photo", "citizenship photo"] },
    { key: "physical_presence", label: "Physical Presence Calculator printout (CIT-0407, 1095+ days)", required: true, keywords: ["physical presence", "calculator", "cit 0407", "residency"] },
    { key: "language_proof", label: "Language proof — IELTS / CELPIP-G / TEF / TCF results, OR English/French diploma (if 18-54)", required: true, keywords: ["ielts", "celpip", "tef", "tcf", "language", "diploma", "transcript"] },
    { key: "tax_filings", label: "Tax filings — declared 3+ of last 5 years on form (verified with CRA)", required: true, keywords: ["tax", "noa", "notice of assessment", "option c"] },
    { key: "police_certs", label: "Police certificates (if 183+ days in any country in last 4 years)", required: false, keywords: ["police certificate", "police clearance", "criminal record"] },
    { key: "fee_receipt", label: "Fee receipt — CA$530 adult / CA$100 minor + CA$100 right-of-citizenship", required: true, keywords: ["fee", "receipt", "payment"] },
    { key: "rep_letter", label: "Use of Representative form (IMM 5476)", required: true, keywords: ["5476", "representative"] },
    { key: "submission_letter", label: "Representative Submission Letter", required: false, keywords: ["submission letter", "representative letter"] },
    { key: "translations", label: "Certified translations (for any non-English/French docs)", required: false, keywords: ["translation"] }
  ],
  pr_card_renewal: [
    // PR Card Renewal — IMM 5444 + IMM 5644. Distinct from citizenship:
    // 730 days (not 1095), $50 fee (not $630), no language test, no
    // police certs requirement.
    { key: "passport_current", label: "Current passport (bio + all stamped pages, last 5 yrs)", required: true, keywords: ["passport"] },
    { key: "passport_old", label: "Expired passports from last 5 years (if any)", required: false, keywords: ["old passport", "expired"] },
    { key: "pr_card", label: "Current/expiring PR card — FRONT and BACK", required: true, keywords: ["pr card", "permanent resident"] },
    { key: "pr_landing", label: "PR landing document (IMM 1000 / 5292 / 5688 / COPR)", required: true, keywords: ["imm 1000", "imm 5292", "imm 5688", "record of landing", "copr"] },
    { key: "secondary_id", label: "Secondary government ID (driver's licence / health card)", required: true, keywords: ["driver", "health card", "provincial id"] },
    { key: "photos", label: "2 PR-card-format photos (50mm × 70mm — NOT work permit specs)", required: true, keywords: ["photo", "pr card photo"] },
    { key: "tax_noa", label: "CRA Notices of Assessment (last 3 years)", required: true, keywords: ["noa", "notice of assessment", "cra", "tax"] },
    { key: "tax_t4", label: "T4 slips (last 3-5 years)", required: false, keywords: ["t4", "income"] },
    { key: "address_proof", label: "Address proof (utility bills / lease / bank statements — 5-yr coverage)", required: true, keywords: ["utility", "lease", "rental", "bank statement", "address"] },
    { key: "name_change_doc", label: "Name change document (if applicable)", required: false, keywords: ["marriage", "divorce", "name change"] },
    { key: "fee_receipt", label: "Fee receipt — CA$50 PR card renewal", required: true, keywords: ["fee", "receipt", "payment"] },
    { key: "rep_letter", label: "Use of Representative form (IMM 5476)", required: true, keywords: ["5476", "representative"] },
    { key: "submission_letter", label: "Representative Submission Letter", required: false, keywords: ["submission letter", "representative letter"] },
    { key: "translations", label: "Certified translations (for any non-English/French docs)", required: false, keywords: ["translation"] }
  ],
  us_b1b2: [
    { key: "passport", label: "Passport", required: true, keywords: ["passport"] },
    { key: "photo", label: "Digital Photo (DS-160 specs)", required: true, keywords: ["photo"] },
    { key: "travel_history", label: "Travel History / Visa Refusal Details", required: false, keywords: ["travel", "refusal"] },
    { key: "employment_education", label: "Employment/Education history details", required: false, keywords: ["employment", "education", "school"] },
    { key: "social_media", label: "Social media handles (last 5 years)", required: false, keywords: ["social media", "handle"] }
  ],
  uk_visitor: [
    { key: "passport", label: "Passport", required: true, keywords: ["passport"] },
    { key: "photo", label: "Digital Photo", required: true, keywords: ["photo"] },
    { key: "bank", label: "Bank Statements", required: true, keywords: ["bank", "statement"] },
    { key: "job_or_school", label: "Job Letter + Payslips / Enrollment Letter", required: true, keywords: ["job letter", "pay", "enrollment", "school"] },
    { key: "sponsor_docs", label: "Sponsor Docs (if applicable)", required: false, keywords: ["sponsor"] }
  ],
  refugee: [
    { key: "passport", label: "Passport (all pages)", required: true, keywords: ["passport"] },
    { key: "id_docs", label: "National/Civil ID + Birth Certificate", required: true, keywords: ["id", "birth certificate"] },
    { key: "entry_proof", label: "Entry Proof (stamp/eGate/tickets)", required: true, keywords: ["entry", "stamp", "ticket", "boarding"] },
    { key: "canada_status", label: "Current/Past Canadian Permit Docs", required: false, keywords: ["permit", "visa"] },
    { key: "legal_evidence", label: "Legal/Threat Supporting Evidence", required: false, keywords: ["court", "police", "threat", "evidence"] },
    { key: "narrative", label: "Detailed claim narrative/explanation", required: true, keywords: ["explanation", "claim", "incident"] }
  ],
  canadian_passport_doc: [
    { key: "citizenship_certificate", label: "Citizenship Certificate", required: true, keywords: ["citizenship certificate"] },
    { key: "photo_id", label: "Photo ID", required: true, keywords: ["photo id", "driver", "health card"] },
    { key: "passport_photos", label: "Passport Photos (2)", required: true, keywords: ["passport photo", "photo"] },
    { key: "old_passport", label: "Old Passport/Travel Document (if any)", required: false, keywords: ["travel document", "old passport"] },
    { key: "guarantor", label: "Guarantor Documents", required: true, keywords: ["guarantor"] },
    { key: "references", label: "References + Emergency Contact", required: true, keywords: ["reference", "emergency"] }
  ],
  generic: [
    { key: "passport", label: "Passport", required: true, keywords: ["passport"] },
    { key: "application_docs", label: "Application Supporting Documents", required: true, keywords: ["document", "support", "proof"] }
  ]
};

export function getChecklistForFormType(formType: string): ApplicationChecklistItem[] {
  const key = resolveApplicationChecklistKey(formType);
  return CHECKLISTS[key] || CHECKLISTS.generic;
}

export function getMissingChecklistDocs(formType: string, documents: DocumentItem[]): string[] {
  const docs = documents.map((d) => normalize(d.name));
  const checklist = getChecklistForFormType(formType).filter((i) => i.required);
  return checklist
    .filter((item) => !item.keywords.some((k) => docs.some((name) => name.includes(normalize(k)))))
    .map((item) => item.label);
}

// Richer view of checklist progress for a case. Used by the WhatsApp bot to
// say "got X ✓, still need Y, Z" instead of relisting the entire checklist
// on every doc upload. Best-effort keyword matching against document names —
// a broad keyword like "permit" may match more than one item, which is fine
// for a client-facing nudge (staff still verify the real package).
export function getChecklistProgress(
  formType: string,
  documents: DocumentItem[]
): {
  required: string[];          // every required label
  receivedRequired: string[];  // required labels we appear to have
  missingRequired: string[];   // required labels still outstanding
  optional: string[];          // optional / if-applicable labels
} {
  const docNames = documents.map((d) => normalize(d.name));
  const checklist = getChecklistForFormType(formType);
  const isMatched = (item: ApplicationChecklistItem) =>
    item.keywords.some((k) => docNames.some((name) => name.includes(normalize(k))));

  const required = checklist.filter((i) => i.required);
  const optional = checklist.filter((i) => !i.required);

  return {
    required: required.map((i) => i.label),
    receivedRequired: required.filter(isMatched).map((i) => i.label),
    missingRequired: required.filter((i) => !isMatched(i)).map((i) => i.label),
    optional: optional.map((i) => i.label),
  };
}
