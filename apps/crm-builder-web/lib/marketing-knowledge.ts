// ─────────────────────────────────────────────────────────────────────
// Newton Immigration — Marketing Knowledge Base
//
// IMPORTANT: This is the SOURCE OF TRUTH for marketing AI replies AND for
// the Marketing Inbox sidebar quick-checklist sender.
// The AI is told to ONLY use info from here — never invent fees or rules.
// Verified with Newton ownership (May 2026).
//
// Update rules:
// - Fees here MUST match what's actually billed
// - Eligibility lines should be plain English, no legal jargon
// - Checklist items are what client needs to physically provide
// - When fees have multiple options, list them all with conditions
//
// Categories used by the sidebar grouping:
//   work | study | visit | pr | other
// ─────────────────────────────────────────────────────────────────────

export const NEWTON_FEES = `
## NEWTON IMMIGRATION — VERIFIED FEE SCHEDULE (2026)

PR / SPONSORSHIP — $52.50 consultation REQUIRED before quote
  (PR cases are too varied to quote without review.
   Interac for consultation: newtonimmigration@gmail.com)

WORK PERMITS — NO consultation fee:
  • PGWP: $315 (includes tax) + $255 IRCC = $570 total
  • PGWP Paper Application: $315 (includes tax) — paper-based only
  • SOWP Inside Canada: $1,260 (excludes IRCC fees)
  • SOWP Outside Canada: $1,575 (excludes IRCC fees)
  • SOWP Extension: $1,200 (excludes tax) + IRCC on client card
  • LMIA Work Permit (with employer paperwork): $1,260 (includes tax — also covers job offer & employment contract)
  • LMIA Work Permit (you have all employer docs): $840 (includes tax)
  • BOWP (Bridging Open Work Permit): $525
  • VOWP (Vulnerable Open Work Permit): $1,260
  • Verification of Status: $210
  • Employer LMIA Processing: quoted on case-by-case basis

STUDY PERMITS — NO consultation fee:
  • Study Permit Extension: $570 ($420 processing + $150 IRCC)
  • Study Permit Outside Canada / Status Change: $1,050 + IRCC on client card
  • Restoration: $415 (includes taxes) + $230 embassy
  • Restoration + Study Permit: $525 processing + $240 IRCC restoration + $150 IRCC study permit
  • College Change: quoted after document review
  • TRP (Temporary Resident Permit): $2,100

VISITOR / SUPER VISA — NO consultation fee:
  • Visitor Visa (TRV outside Canada): $710 ($525 + $185 IRCC)
  • TRV / Stamping (inside Canada): $415 ($315 + $100 embassy)
  • Visitor Record (extending stay): $415 ($315 + $100 IRCC)
  • Super Visa: $1,050 + $185 IRCC per applicant
  • ATIP Notes: $215

PR / SPONSORSHIP / EXPRESS ENTRY — consultation REQUIRED:
  • PR Sponsorship Inside Canada: $2,100 (includes taxes)
  • PR Sponsorship Outside Canada: $3,000 + taxes
  • Express Entry Profile Creation: $525 (includes taxes)
  • Express Entry After Invitation: $2,000
  • Express Entry Final Stage: $500
  • PNP Only: $2,100 (includes taxes)
  • PNP + PR: $3,000 + taxes
  • Citizenship: $1,050 (includes taxes)
  • PR Card Renewal: $525 each applicant
  • Home Care Worker Pilot: consultation required

OTHER:
  • Passport Renewal: $350 (includes taxes)
  • WES Evaluation: $475
  • US Application: $265
  • E-Visa: quoted after review
  • Travel Documents: quoted after review
  • Refugee Case: $4,000 (excluding taxes)
  • Nanny Application: $5,000

PAYMENT METHOD:
  • Interac e-transfer to: newtonimmigration@gmail.com
  • Alt Interac (sometimes used): navisandhu0297@gmail.com
  • Receipt must be shared on WhatsApp after payment
`;

// ─── Service catalog (structured for template generation) ───
export type ServiceInfo = {
  key: string;
  displayName: string;
  category: "work" | "study" | "pr" | "visit" | "other";
  feeText: string;
  feeAmount: number | null;
  needsConsultation: boolean;
  eligibility: string[];
  checklist: string[];
  emoji: string;
};

export const SERVICES: Record<string, ServiceInfo> = {
  // ═══════════════════════════════════════════════════════════════════
  //   WORK PERMITS
  // ═══════════════════════════════════════════════════════════════════
  PGWP: {
    key: "PGWP",
    displayName: "PGWP (Post-Graduation Work Permit)",
    category: "work",
    feeText: "$315 processing + $255 IRCC = $570 total (paper application: $315 only)",
    feeAmount: 315,
    needsConsultation: false,
    eligibility: [
      "Completed a study program at a designated learning institution (DLI) in Canada",
      "Program was at least 8 months long",
      "Apply within 180 days of getting your final marks / completion letter",
      "Currently in Canada with valid status (or just left)",
    ],
    checklist: [
      "College Completion Letter",
      "Official Transcripts",
      "Valid Study Permit",
      "Passport PDF — first, last, all stamped pages",
      "Digital Photo",
      "Employment Details (if working)",
      "Language Proficiency Test (IELTS/CELPIP if available)",
    ],
    emoji: "🎓",
  },
  SOWP: {
    key: "SOWP",
    displayName: "SOWP (Spousal Open Work Permit)",
    category: "work",
    feeText: "Inside Canada: $1,260 / Outside Canada: $1,575 / Extension: $1,200 (all exclude IRCC fees)",
    feeAmount: 1260,
    needsConsultation: false,
    eligibility: [
      "Spouse or common-law partner is a Canadian citizen, PR, or eligible work/study permit holder",
      "Genuine marriage / common-law relationship (proof required)",
      "Sponsor has eligible status in Canada",
    ],
    checklist: [
      "Passport — front, back, all stamps and visa pages",
      "Current valid Study/Work Permit",
      "Bank Balance Certificate (financial proof)",
      "Marriage Certificate",
      "Address Proof (any government ID)",
      "If student: enrolment letter, recent transcripts, fees payment proof",
      "If on work permit: employment letter with job duties, recent 3 paystubs, Notice of Assessment",
      "Police Clearance Certificate (countries lived 6+ months)",
      "Medical exam (if requested)",
      "Last 3 years ITR / tax returns",
      "Property valuation, CA report, or other financial docs",
      "Photographs together (proof of relationship)",
      "If previously married: divorce certificate or spouse death certificate",
      "If children: birth certificate, passport, supporting docs",
    ],
    emoji: "💑",
  },
  SOWP_EXTENSION: {
    key: "SOWP_EXTENSION",
    displayName: "SOWP Extension",
    category: "work",
    feeText: "$1,200 (excluding taxes) + IRCC fees on client's card",
    feeAmount: 1200,
    needsConsultation: false,
    eligibility: [
      "Currently hold a valid SOWP that needs renewal",
      "Spouse still has eligible status in Canada",
      "Marriage / partnership still ongoing",
    ],
    checklist: [
      "Main Applicant: Passport, Work Permit, Job Letter, Paystubs, Digital Photo, Marriage Certificate, photos together",
      "Spouse: Passport, Work Permit, Job Letter, Pay stubs",
    ],
    emoji: "💑",
  },
  LMIA_WP: {
    key: "LMIA_WP",
    displayName: "LMIA-based Work Permit",
    category: "work",
    feeText: "$1,260 with employer paperwork (includes job offer + contract) / $840 if you have all employer docs",
    feeAmount: 1260,
    needsConsultation: false,
    eligibility: [
      "You have a valid LMIA-approved job offer",
      "Employer can provide LMIA copy + supporting documents",
      "You meet job requirements (skills, experience, language)",
    ],
    checklist: [
      "Passport",
      "LMIA copy",
      "Job letter",
      "Paystubs",
      "New job letter (if changing jobs)",
      "Employment contract",
      "Current Work Permit (if applicable)",
    ],
    emoji: "💼",
  },
  BOWP: {
    key: "BOWP",
    displayName: "BOWP (Bridging Open Work Permit)",
    category: "work",
    feeText: "$525",
    feeAmount: 525,
    needsConsultation: false,
    eligibility: [
      "Have a valid PR application in process under specific PR programs",
      "Currently hold a valid work permit (or about to expire within 4 months)",
      "Already in Canada with status",
    ],
    checklist: [
      "Passport",
      "Current Work Permit",
      "Acknowledgement of Receipt (AOR) for PR application",
      "Job letter",
      "Recent paystubs",
    ],
    emoji: "🌉",
  },
  VOWP: {
    key: "VOWP",
    displayName: "VOWP (Vulnerable Open Work Permit)",
    category: "work",
    feeText: "$1,260",
    feeAmount: 1260,
    needsConsultation: true,
    eligibility: [
      "Currently in Canada and experiencing abuse from employer or family member",
      "Need open work permit to leave abusive situation",
      "Cases are reviewed individually — please book consultation",
    ],
    checklist: [
      "We'll review your situation in a confidential consultation",
    ],
    emoji: "🛡️",
  },
  VERIFICATION_OF_STATUS: {
    key: "VERIFICATION_OF_STATUS",
    displayName: "Verification of Status",
    category: "work",
    feeText: "$210 (includes taxes)",
    feeAmount: 210,
    needsConsultation: false,
    eligibility: [
      "Lost or stolen permit / record needs verification",
      "Need to confirm your immigration status with IRCC",
    ],
    checklist: [
      "Passport",
      "Current permit (if you have a copy)",
      "Reason for lost or stolen status (police report if available)",
    ],
    emoji: "🔍",
  },

  // ═══════════════════════════════════════════════════════════════════
  //   STUDY PERMITS
  // ═══════════════════════════════════════════════════════════════════
  STUDY_PERMIT_EXT: {
    key: "STUDY_PERMIT_EXT",
    displayName: "Study Permit Extension / Study to Study",
    category: "study",
    feeText: "$570 total ($420 processing + $150 IRCC)",
    feeAmount: 570,
    needsConsultation: false,
    eligibility: [
      "Currently have a valid (or recently expired) study permit",
      "Continuing studies at a designated learning institution",
      "In good academic standing with proof of enrolment",
    ],
    checklist: [
      "Letter of Acceptance (LOA)",
      "Current Address",
      "PAL (Provincial Attestation Letter)",
      "Email Address",
      "Letter of Confirmation",
      "Fees Receipts",
      "Any study gap explanation",
      "Any previous refusal details",
      "Passport",
    ],
    emoji: "📚",
  },
  STUDY_PERMIT_NEW: {
    key: "STUDY_PERMIT_NEW",
    displayName: "Study Permit (Outside Canada / Work Permit to Study / Visitor to Study)",
    category: "study",
    feeText: "$1,050 processing (includes taxes) + IRCC fees on client's card",
    feeAmount: 1050,
    needsConsultation: false,
    eligibility: [
      "Have a Letter of Acceptance from designated learning institution",
      "Sufficient funds to pay tuition + living expenses",
      "Will leave Canada when permit expires (or transition to work permit)",
    ],
    checklist: [
      "Passport",
      "Letter of Acceptance (LOA)",
      "Provincial Attestation Letter (PAL)",
      "Tuition fees receipt / proof of payment",
      "Proof of funds (bank statements, GIC)",
      "Educational documents (transcripts, diplomas)",
      "Language test (IELTS / CELPIP / TOEFL)",
      "Statement of Purpose",
      "Digital Photo",
    ],
    emoji: "🎒",
  },
  RESTORATION: {
    key: "RESTORATION",
    displayName: "Status Restoration",
    category: "study",
    feeText: "$415 (includes taxes) + $230 embassy / Restoration + Study: $525 + $240 + $150 IRCC",
    feeAmount: 415,
    needsConsultation: false,
    eligibility: [
      "Lost status within 90 days (i.e., permit expired less than 90 days ago)",
      "Did not work or study without authorization after expiry",
      "Original eligibility for the permit type still applies",
    ],
    checklist: [
      "Expired permit copy",
      "Passport",
      "Reason for restoration (explanation letter)",
      "Updated supporting documents for permit type being restored",
    ],
    emoji: "♻️",
  },
  COLLEGE_CHANGE: {
    key: "COLLEGE_CHANGE",
    displayName: "College Change / Transfer",
    category: "study",
    feeText: "Quoted after reviewing your case",
    feeAmount: null,
    needsConsultation: true,
    eligibility: [
      "Currently have a valid Study Permit",
      "Have a Letter of Acceptance from new college",
      "Meeting study permit conditions through transfer",
    ],
    checklist: [
      "Study Permit",
      "Letter of Acceptance (LOA) — new college",
      "Class 12 / Class 10 transcripts",
      "Any other educational documents",
      "IELTS / language test",
      "Current Address",
      "Passport",
    ],
    emoji: "🔄",
  },
  TRP: {
    key: "TRP",
    displayName: "TRP (Temporary Resident Permit)",
    category: "study",
    feeText: "$2,100 (includes taxes)",
    feeAmount: 2100,
    needsConsultation: true,
    eligibility: [
      "Have inadmissibility issue (criminal, medical, or other)",
      "Compelling reason to enter / remain in Canada",
      "Cases vary widely — consultation strongly recommended",
    ],
    checklist: [
      "Old permits",
      "Passport",
      "Last attended college documents",
      "Details of inadmissibility issue",
    ],
    emoji: "📜",
  },

  // ═══════════════════════════════════════════════════════════════════
  //   VISIT / SUPER VISA
  // ═══════════════════════════════════════════════════════════════════
  VISITOR_VISA: {
    key: "VISITOR_VISA",
    displayName: "Visitor Visa (TRV — Outside Canada)",
    category: "visit",
    feeText: "$710 total ($525 processing + $185 IRCC)",
    feeAmount: 710,
    needsConsultation: false,
    eligibility: [
      "Visiting Canada temporarily for tourism, family, or business",
      "Can show ties to home country (job, family, property)",
      "Sufficient funds for the visit",
    ],
    checklist: [
      "From Sponsor: Passport, Invitation Letter, Status Documents (SP/WP/PR/Citizenship), Bank Statement, Current Address/Phone/Gmail",
      "From Applicant: Passport, Bank Statement, Family Information (parents' name, DOB, occupation), Travel History",
      "Employment letter + paystubs",
      "Education details (post-secondary)",
      "CA Report",
    ],
    emoji: "✈️",
  },
  TRV_STAMPING: {
    key: "TRV_STAMPING",
    displayName: "TRV / Stamping (Inside Canada)",
    category: "visit",
    feeText: "$415 total ($315 processing + $100 embassy)",
    feeAmount: 415,
    needsConsultation: false,
    eligibility: [
      "Already inside Canada with valid status",
      "Need TRV to re-enter after travelling outside",
    ],
    checklist: [
      "Passport",
      "Current Permit",
      "Address",
      "Digital Photo",
      "Marital status",
    ],
    emoji: "🛂",
  },
  VISITOR_RECORD: {
    key: "VISITOR_RECORD",
    displayName: "Visitor Record (Extending Your Stay in Canada)",
    category: "visit",
    feeText: "$415 total ($315 processing + $100 IRCC)",
    feeAmount: 415,
    needsConsultation: false,
    eligibility: [
      "Currently in Canada as visitor (or coming to end of allowed stay)",
      "Have a reason to extend (family, medical, etc.)",
      "Can show financial support during extended stay",
    ],
    checklist: [
      "Passport",
      "Digital Photo",
      "Current Address",
      "Marital Status",
      "Education History",
      "Employment History",
      "Any refusal from any country",
    ],
    emoji: "📅",
  },
  SUPER_VISA: {
    key: "SUPER_VISA",
    displayName: "Super Visa (Parents / Grandparents)",
    category: "visit",
    feeText: "$1,050 processing + $185 IRCC per applicant",
    feeAmount: 1050,
    needsConsultation: false,
    eligibility: [
      "You're the parent or grandparent of a Canadian citizen or PR",
      "Sponsor (child/grandchild) meets minimum income threshold",
      "Have valid medical insurance for at least 1 year",
      "Plan to visit, not immigrate permanently",
    ],
    checklist: [
      "SPONSOR: Canadian Passport or PR Card, Proof of relationship, Bank balance certificate, Notice of Assessment, Current Job Letter, Spouse's documents (if married), Property assessment (if owned), Medical insurance (1 year), Birth certificate of children",
      "MAIN APPLICANT: Passport (front/back/stamps/visas), Vaccination certificate, Digital Photo, Bank document (financial proof), Upfront medical, Job letter (if working), Marriage certificate + spouse's passport, ITR last 2 years, Property valuation, CA Report, Retirement docs (if retired), J-form/fard (if farmer), Affidavit of financial support (if anyone supporting)",
    ],
    emoji: "👴",
  },
  ATIP: {
    key: "ATIP",
    displayName: "ATIP Notes (Access to Info Request)",
    category: "visit",
    feeText: "$215 (includes taxes)",
    feeAmount: 215,
    needsConsultation: false,
    eligibility: [
      "Have had a refusal and need GCMS notes to understand why",
      "Want full IRCC file for transparency before re-applying",
    ],
    checklist: [
      "Passport",
      "Submission Confirmation / Refusal Letter",
      "Address",
    ],
    emoji: "📝",
  },

  // ═══════════════════════════════════════════════════════════════════
  //   PR / SPONSORSHIP / EXPRESS ENTRY
  // ═══════════════════════════════════════════════════════════════════
  PR_SPONSORSHIP: {
    key: "PR_SPONSORSHIP",
    displayName: "PR Sponsorship",
    category: "pr",
    feeText: "Inside Canada: $2,100 (includes taxes) / Outside Canada: $3,000 + taxes (Consultation $52.50 required first)",
    feeAmount: 2100,
    needsConsultation: true,
    eligibility: [
      "Sponsor is Canadian citizen or PR, 18+, living in Canada",
      "Sponsor financially capable of supporting applicant",
      "Genuine relationship (spouse / common-law / dependent child)",
      "Sponsor has not previously sponsored someone in past 3 years (with exceptions)",
    ],
    checklist: [
      "SPONSOR: Passport, PR Card or Canadian Passport, Job documents, Notice of Assessment, Education details, Proof of relationship (marriage cert / birth cert), Financial documents",
      "PRINCIPAL APPLICANT: Passport, Permit (if any), Educational documents, Travel history, Medical (if applicable), Police certificates (if applicable)",
      "Note: Expanded checklist provided after consultation + initial review",
    ],
    emoji: "🇨🇦",
  },
  EXPRESS_ENTRY: {
    key: "EXPRESS_ENTRY",
    displayName: "Express Entry (FSW / CEC / FST)",
    category: "pr",
    feeText: "Profile creation: $525 / After invitation: $2,000 / Final stage: $500 (Consultation $52.50 required first)",
    feeAmount: 525,
    needsConsultation: true,
    eligibility: [
      "Meet one of: skilled work experience, Canadian work experience, or trade qualification",
      "Language test (IELTS / CELPIP) meeting CLB minimum for your stream",
      "Education credential (Canadian or with WES evaluation)",
      "Have minimum points threshold (varies by draw)",
    ],
    checklist: [
      "Passport",
      "IELTS / CELPIP results",
      "Education documents (with WES if foreign)",
      "Employment details (job titles, dates, NOC code)",
    ],
    emoji: "🎯",
  },
  PNP: {
    key: "PNP",
    displayName: "Provincial Nominee Program (PNP)",
    category: "pr",
    feeText: "PNP only: $2,100 (includes taxes) / PNP + PR: $3,000 + taxes (Consultation $52.50 required first)",
    feeAmount: 2100,
    needsConsultation: true,
    eligibility: [
      "Meet specific province's nomination criteria (varies BC vs ON vs SK etc.)",
      "Job offer from provincial employer (most streams) OR international graduate / entrepreneur stream",
      "Strong ties to province (often work / study / family)",
    ],
    checklist: [
      "Passport",
      "Job offer / employment letter",
      "Education documents",
      "Language test results",
      "Province-specific documents (varies by stream — confirmed at consultation)",
    ],
    emoji: "🏞️",
  },
  CITIZENSHIP: {
    key: "CITIZENSHIP",
    displayName: "Canadian Citizenship",
    category: "pr",
    feeText: "$1,050 (includes taxes)",
    feeAmount: 1050,
    needsConsultation: false,
    eligibility: [
      "PR for at least 3 years (1,095 days) in last 5 years",
      "Filed Canadian taxes for at least 3 years",
      "Meet language requirement (CLB 4) — applies to ages 18-54",
      "Pass citizenship test (ages 18-54)",
    ],
    checklist: [
      "Passport",
      "PR Card",
      "Digital Photo",
      "Police Clearance Certificate (PCC)",
      "English/French language proficiency proof",
    ],
    emoji: "🍁",
  },
  PR_CARD_RENEWAL: {
    key: "PR_CARD_RENEWAL",
    displayName: "PR Card Renewal",
    category: "pr",
    feeText: "$525 each applicant",
    feeAmount: 525,
    needsConsultation: false,
    eligibility: [
      "Currently a Permanent Resident of Canada",
      "Met or will meet residency obligation (730 days in last 5 years)",
      "PR Card expiring or already expired",
    ],
    checklist: [
      "Passport",
      "PR Card",
      "Canadian educational documents",
      "Travel History",
    ],
    emoji: "💳",
  },
  HOME_CARE_WORKER: {
    key: "HOME_CARE_WORKER",
    displayName: "Home Care Worker Immigration Pilot",
    category: "pr",
    feeText: "Consultation required to confirm eligibility + quote",
    feeAmount: null,
    needsConsultation: true,
    eligibility: [
      "Have or qualify for full-time job offer in home care",
      "Language proficiency (General training test, CLB 4 minimum)",
      "High school education + 6 months caregiver training OR 6 months recent caregiver experience",
    ],
    checklist: [
      "Travel Document (Passport)",
      "Proof of Language Proficiency (CLB 4 General Training)",
      "Proof of Education — High School + Caregiver Training (diploma/certificate) OR 6+ months caregiver experience (employer reference, work contract, paystubs)",
      "Identity Document",
      "Family Information",
      "Police Clearance Certificate",
      "Digital Photo (applicant + family member, front/back)",
      "Birth Certificate",
      "Proof of Funds (applicant)",
      "Full-time Job Offer",
      "WES Evaluation (highest education)",
      "Marriage Certificate / Divorce Certificate (if applicable)",
    ],
    emoji: "👨‍⚕️",
  },

  // ═══════════════════════════════════════════════════════════════════
  //   OTHER
  // ═══════════════════════════════════════════════════════════════════
  US_APPLICATION: {
    key: "US_APPLICATION",
    displayName: "US Visitor Visa Application",
    category: "other",
    feeText: "$265 processing fees",
    feeAmount: 265,
    needsConsultation: false,
    eligibility: [
      "Currently in Canada with valid status",
      "Visiting USA temporarily (tourism / business / family)",
    ],
    checklist: [
      "Passport",
      "Current status in Canada (PR/SP/WP)",
      "Employment details (company name, address, position, start/end date)",
      "Current Address, Phone Number, Gmail",
      "Spouse name, DOB, address (if married)",
      "Digital Photograph",
      "Father/Mother DOB and current address",
      "Education details",
      "Any relatives in US (names if yes)",
    ],
    emoji: "🇺🇸",
  },
  PASSPORT_RENEWAL: {
    key: "PASSPORT_RENEWAL",
    displayName: "Passport Renewal",
    category: "other",
    feeText: "$350 (includes taxes)",
    feeAmount: 350,
    needsConsultation: false,
    eligibility: [
      "Existing passport expiring or expired",
      "Documents available to support renewal",
    ],
    checklist: [
      "Old Passport",
    ],
    emoji: "🛂",
  },
  WES: {
    key: "WES",
    displayName: "WES Evaluation (Education Credential Assessment)",
    category: "other",
    feeText: "$475",
    feeAmount: 475,
    needsConsultation: false,
    eligibility: [
      "Have foreign education that needs Canadian equivalency",
      "Required for Express Entry / PR / certain professional licenses",
    ],
    checklist: [
      "Educational documents (degrees, transcripts) — original + scanned",
      "Identity proof",
      "Passport",
    ],
    emoji: "📜",
  },
  E_VISA: {
    key: "E_VISA",
    displayName: "E-Visa (Electronic Travel Authorization)",
    category: "other",
    feeText: "Quoted after document review",
    feeAmount: null,
    needsConsultation: false,
    eligibility: [
      "Visiting a country requiring electronic visa",
      "Hold a passport from eligible country",
    ],
    checklist: [
      "Passport",
      "Identity documents",
      "Address",
    ],
    emoji: "💻",
  },
  REFUGEE: {
    key: "REFUGEE",
    displayName: "Refugee Case",
    category: "other",
    feeText: "$4,000 (excluding taxes) — consultation required",
    feeAmount: 4000,
    needsConsultation: true,
    eligibility: [
      "Have a well-founded fear of persecution in your home country",
      "Cases are highly individual — please book consultation",
    ],
    checklist: [
      "Passport",
      "Identity documents",
      "Parents' information",
      "Detailed account of persecution / threat",
    ],
    emoji: "🆘",
  },
  NANNY: {
    key: "NANNY",
    displayName: "Nanny / Caregiver Application",
    category: "other",
    feeText: "$5,000",
    feeAmount: 5000,
    needsConsultation: true,
    eligibility: [
      "Job offer from Canadian family for childcare / homecare",
      "Meet education + experience requirements for caregiver pathway",
    ],
    checklist: [
      "Detailed checklist provided after consultation",
    ],
    emoji: "👶",
  },
  EMPLOYER_LMIA: {
    key: "EMPLOYER_LMIA",
    displayName: "Employer LMIA Processing (for Canadian businesses)",
    category: "other",
    feeText: "Quoted on case-by-case basis",
    feeAmount: null,
    needsConsultation: true,
    eligibility: [
      "Canadian business looking to hire foreign worker",
      "Meet Service Canada / ESDC requirements for the LMIA stream",
    ],
    checklist: [
      "Business license",
      "Incorporation certificate",
      "Payroll account number",
      "Recent PD7A",
      "T2 / Schedule 100 / Schedule 125 (previous years)",
      "Temporary Foreign Workers certificate (TFW)",
    ],
    emoji: "🏢",
  },
};

// Backwards-compatible: keep NEWTON_DOCS export for old code
export const NEWTON_DOCS = `
## NEWTON IMMIGRATION — KEY CONTACT INFO

KEY FACTS:
- Surrey office: 9850 King George Hub, Surrey, BC
- Calgary office: 4715 88 Ave NE, Calgary, AB T3J 4C5
- Calls: Surrey +1 604-897-5894 / +1 604-653-5031 / +1 (236) 877-2225
- Calls: Calgary +1 604-907-0314 / +1 604-907-0218
- Processing Team WhatsApp: +1 604-779-5700
- Email: newtonimmigration@gmail.com
- Interac: newtonimmigration@gmail.com (alt: navisandhu0297@gmail.com)
- RCIC: Navdeep Singh Sandhu, R-705964
- Consultation fee: $52.50 incl. taxes (15-min consultation)
`;
