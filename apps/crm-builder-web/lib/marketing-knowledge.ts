// ─────────────────────────────────────────────────────────────────────
// Newton Immigration — Marketing Knowledge Base
//
// IMPORTANT: This is the SOURCE OF TRUTH for marketing AI replies.
// The AI is told to ONLY use info from here — never invent fees or rules.
// Verified with Newton ownership (Apr 30 / May 1, 2026).
//
// Update rules:
// - Fees here MUST match what's actually billed
// - Eligibility lines should be plain English, no legal jargon
// - Checklist items are what client needs to physically provide
// ─────────────────────────────────────────────────────────────────────

export const NEWTON_FEES = `
## NEWTON IMMIGRATION — VERIFIED FEE SCHEDULE (2026)

PR / SPONSORSHIP — $52.50 consultation REQUIRED before quote
  (PR cases are too varied to quote without review.
   Interac for consultation: newtonimmigration@gmail.com)

WORK PERMITS — NO consultation fee:
  • PGWP: $315 (includes tax)
  • SOWP Inside Canada: $1,260 (excludes IRCC fees)
  • SOWP Outside Canada: $1,575 (excludes IRCC fees)
  • SOWP Extension: $1,200 (excludes tax) + IRCC on client card
  • LMIA Work Permit (with employer paperwork): $1,260
  • LMIA Work Permit (you have all employer docs): $840
  • BOWP (Bridging Open Work Permit): $525
  • VOWP: $1,260
  • Verification of Status: $210

STUDY PERMITS — NO consultation fee:
  • Study Permit Extension: $570 ($420 processing + $150 IRCC)
  • Study Permit Outside Canada: $1,050 + IRCC on client card
  • Restoration + Study Permit: $525 + $240 + $150 IRCC

VISITOR / SUPER VISA — NO consultation fee:
  • Visitor Visa (TRV outside Canada): $710 ($525 + $185 IRCC)
  • TRV stamping (inside Canada): $415 ($315 + $100 embassy)
  • Visitor Record (extending stay): $415 ($315 + $100 IRCC)
  • Super Visa: $1,050 + $185 IRCC per applicant
  • TRP: $2,100

OTHER — NO consultation fee:
  • Citizenship: $1,050
  • PR Card Renewal: $525 each
  • Passport Renewal: $350
  • WES Evaluation: $475
  • US Application: $265

PAYMENT METHOD:
  • Interac e-transfer to: newtonimmigration@gmail.com
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
  PGWP: {
    key: "PGWP",
    displayName: "PGWP (Post-Graduation Work Permit)",
    category: "work",
    feeText: "$315 (includes tax)",
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
      "Passport (all pages including stamps)",
      "Digital Photo (passport-style)",
      "Employment Details (if you're working)",
      "Language Test results (IELTS/CELPIP — if available)",
    ],
    emoji: "🎓",
  },
  SOWP: {
    key: "SOWP",
    displayName: "SOWP (Spousal Open Work Permit)",
    category: "work",
    feeText: "$1,260 inside Canada / $1,575 outside Canada (excludes IRCC fees)",
    feeAmount: 1260,
    needsConsultation: false,
    eligibility: [
      "Your spouse is studying or working in Canada with valid status",
      "You're legally married OR in a common-law partnership (12+ months)",
      "Your spouse holds an eligible permit (full-time study at DLI, OR work permit at TEER 0/1/2/3 job)",
    ],
    checklist: [
      "Your passport (all pages and stamps)",
      "Your current Study/Work Permit (if any)",
      "Marriage Certificate",
      "Spouse's passport, permit, job/study letter, transcripts/paystubs",
      "Bank balance certificate (financial proof)",
      "Address proof",
      "Photographs together (relationship proof)",
    ],
    emoji: "💑",
  },
  LMIA_WP: {
    key: "LMIA_WP",
    displayName: "LMIA-based Work Permit",
    category: "work",
    feeText: "$1,260 with employer paperwork / $840 if you already have all docs",
    feeAmount: 1260,
    needsConsultation: false,
    eligibility: [
      "You have a valid Canadian job offer from an employer who has approved LMIA",
      "Your employer has the LMIA number / copy ready",
      "You meet the job's qualifications (education + experience)",
    ],
    checklist: [
      "Passport (all pages and stamps)",
      "LMIA copy from your employer",
      "Job offer letter",
      "Employment contract",
      "Recent paystubs (if currently working)",
      "Current Work Permit (if any)",
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
      "You've already applied for permanent residence (PR)",
      "Your current work permit is expiring within 4 months",
      "Your PR application is past initial review (AOR received)",
    ],
    checklist: [
      "Passport (all pages and stamps)",
      "Current Work Permit",
      "PR application acknowledgement letter (AOR)",
      "Current job letter and paystubs",
      "Digital Photo",
    ],
    emoji: "🌉",
  },
  VISITOR_RECORD: {
    key: "VISITOR_RECORD",
    displayName: "Visitor Record (extending your stay in Canada)",
    category: "visit",
    feeText: "$415 ($315 processing + $100 IRCC)",
    feeAmount: 415,
    needsConsultation: false,
    eligibility: [
      "You're currently in Canada as a visitor",
      "You want to extend your stay",
      "You apply at least 30 days before your current status expires",
    ],
    checklist: [
      "Passport",
      "Digital Photo",
      "Current address",
      "Marital status",
      "Education history",
      "Employment history",
      "Any past visa refusal (if applicable)",
    ],
    emoji: "📅",
  },
  STUDY_PERMIT_EXT: {
    key: "STUDY_PERMIT_EXT",
    displayName: "Study Permit Extension",
    category: "study",
    feeText: "$570 ($420 processing + $150 IRCC)",
    feeAmount: 570,
    needsConsultation: false,
    eligibility: [
      "Currently studying at a designated learning institution (DLI)",
      "Your permit expires soon (apply at least 30 days before expiry)",
      "In good academic standing with your institution",
      "Active study status",
    ],
    checklist: [
      "Letter of Acceptance (LOA) or current enrollment letter",
      "PAL (Provincial Attestation Letter)",
      "Letter of confirmation",
      "Recent fees receipts",
      "Passport",
      "Current address + email",
      "Any study gap explanation (if applicable)",
      "Any past visa refusal (if applicable)",
    ],
    emoji: "📚",
  },
  STUDY_PERMIT_NEW: {
    key: "STUDY_PERMIT_NEW",
    displayName: "Study Permit (from outside Canada / status change)",
    category: "study",
    feeText: "$1,050 (IRCC fees billed to your card separately)",
    feeAmount: 1050,
    needsConsultation: false,
    eligibility: [
      "You have an LOA from a designated learning institution (DLI)",
      "You can show financial proof for tuition + living expenses",
      "If converting from work permit / visitor — status must still be valid",
    ],
    checklist: [
      "Letter of Acceptance (LOA)",
      "PAL (Provincial Attestation Letter)",
      "Passport (all pages and stamps)",
      "Bank documents — financial proof",
      "Last 2 years ITRs / tax documents (if from India)",
      "Education transcripts",
      "Property valuation (if applicable)",
      "CA Report",
      "Digital Photo",
      "Upfront medical exam",
      "Marriage certificate + spouse's passport (if married)",
    ],
    emoji: "🎒",
  },
  VISITOR_VISA: {
    key: "VISITOR_VISA",
    displayName: "Visitor Visa (TRV — outside Canada)",
    category: "visit",
    feeText: "$710 ($525 processing + $185 IRCC)",
    feeAmount: 710,
    needsConsultation: false,
    eligibility: [
      "You have a clear purpose of visit (family, tourism, business)",
      "You can demonstrate ties to your home country (job, family, property)",
      "You have financial support for the visit",
      "You have someone in Canada inviting you (recommended but not required)",
    ],
    checklist: [
      "Passport (all pages and stamps)",
      "Bank statements",
      "Family information (parents' name, DOB, occupation)",
      "Travel history (if any)",
      "Current employment letter and paystubs",
      "Education details (after high school)",
      "CA Report",
      "Sponsor's documents (if invited): passport, status, bank statement, address",
    ],
    emoji: "✈️",
  },
  SUPER_VISA: {
    key: "SUPER_VISA",
    displayName: "Super Visa (parents/grandparents)",
    category: "visit",
    feeText: "$1,050 processing + $185 IRCC per applicant",
    feeAmount: 1050,
    needsConsultation: false,
    eligibility: [
      "You're a parent or grandparent of a Canadian citizen or PR",
      "Your child/grandchild meets minimum income (LICO) requirements",
      "You have valid medical insurance for at least 1 year ($100K+ coverage)",
      "You'll undergo an upfront medical exam",
    ],
    checklist: [
      "Passport (all pages and stamps)",
      "Vaccination certificate",
      "Digital Photo",
      "Bank document — financial proof",
      "Upfront medical exam",
      "Job letter (if working)",
      "ITRs from last 2 years",
      "Property valuation",
      "Sponsor's: passport/PR card, job letter, NOA, bank, property assessment",
      "Medical insurance proof (1 year minimum)",
      "Birth certificate of child(ren) — if any",
    ],
    emoji: "👵",
  },
  PR: {
    key: "PR",
    displayName: "Permanent Residence (PR / Sponsorship / Express Entry / PNP)",
    category: "pr",
    feeText: "$52.50 consultation required first (PR cases are too varied to quote upfront)",
    feeAmount: null,
    needsConsultation: true,
    eligibility: [
      "Many PR pathways exist — Express Entry, PNP, Spousal Sponsorship, Family Sponsorship, Caregiver pilots",
      "Each pathway has different requirements (CRS score, language test, work experience, family ties)",
      "Best to talk through your situation 1-on-1 to find your strongest path",
    ],
    checklist: [
      "We'll review your situation in the consultation and give you an exact list",
    ],
    emoji: "🇨🇦",
  },
  CITIZENSHIP: {
    key: "CITIZENSHIP",
    displayName: "Canadian Citizenship",
    category: "other",
    feeText: "$1,050 (includes taxes)",
    feeAmount: 1050,
    needsConsultation: false,
    eligibility: [
      "You're a Permanent Resident of Canada",
      "You've physically been in Canada for at least 1,095 days in the last 5 years",
      "You've filed Canadian taxes (3 of last 5 years)",
      "You meet language proficiency (CLB 4+) if 18-54 years old",
    ],
    checklist: [
      "Passport",
      "PR Card",
      "Digital Photo",
      "Police Clearance Certificate",
      "English language proficiency proof (CLB 4+)",
    ],
    emoji: "🍁",
  },
  PR_CARD_RENEWAL: {
    key: "PR_CARD_RENEWAL",
    displayName: "PR Card Renewal",
    category: "other",
    feeText: "$525 each applicant",
    feeAmount: 525,
    needsConsultation: false,
    eligibility: [
      "You're a Permanent Resident with an expiring or expired PR card",
      "You've met your residency obligation (730 days in last 5 years)",
    ],
    checklist: [
      "Passport",
      "PR Card (current/expired)",
      "Canadian education docs",
      "Travel history (last 5 years)",
    ],
    emoji: "🪪",
  },
  HOME_CARE_WORKER: {
    key: "HOME_CARE_WORKER",
    displayName: "Home Care Worker Immigration Pilot",
    category: "pr",
    feeText: "Consultation needed — pilot has specific requirements",
    feeAmount: null,
    needsConsultation: true,
    eligibility: [
      "You have a full-time home care job offer in Canada",
      "Either: 6+ months caregiver training credential OR 6+ months relevant work experience",
      "CLB 4+ language proficiency",
      "High school diploma minimum",
    ],
    checklist: [
      "We'll review your specific situation in the consultation",
    ],
    emoji: "👨‍⚕️",
  },
};

// Backwards-compatible: keep NEWTON_DOCS export for old code
export const NEWTON_DOCS = `
## NEWTON IMMIGRATION — KEY CONTACT INFO

KEY FACTS:
- Surrey office: 9850 King George Hub, Surrey, BC
- Calls (WhatsApp calls NOT available): +1 604-653-5031
- Processing Team WhatsApp: +1 604-779-5700
- Email: newtonimmigration@gmail.com
- RCIC: Navdeep Singh Sandhu, R-705964
`;
