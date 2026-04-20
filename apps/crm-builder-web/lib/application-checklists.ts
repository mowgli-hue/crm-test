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
  | "study_permit"
  | "study_permit_extension"
  | "super_visa"
  | "express_entry"
  | "express_entry_pr"
  | "family_sponsorship"
  | "citizenship_prcard"
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
  if (
    ft.includes("work permit") ||
    ft.includes("lmia") ||
    ft.includes("sowp") ||
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
  if (ft.includes("citizenship") || ft.includes("pr card renewal") || ft.includes("pr card replacement")) return "citizenship_prcard";
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
    { key: "passport", label: "Passport(s)", required: true, keywords: ["passport"] },
    { key: "status_docs", label: "Sponsor Status Proof (PR card/citizenship)", required: true, keywords: ["pr card", "citizenship", "canadian passport"] },
    { key: "relationship", label: "Relationship Proof (marriage/birth/etc.)", required: true, keywords: ["marriage certificate", "birth certificate", "relationship proof"] },
    { key: "financials", label: "Sponsor Financial Docs (NOA/T4/paystubs)", required: true, keywords: ["noa", "t4", "paystub", "job letter"] },
    { key: "photos_chat", label: "Photos/Communication Evidence", required: false, keywords: ["photo", "chat", "call log"] }
  ],
  citizenship_prcard: [
    { key: "id_docs", label: "Current ID + Existing PR card/Passport", required: true, keywords: ["id", "pr card", "passport"] },
    { key: "travel_history", label: "Travel/Address history details", required: true, keywords: ["travel history", "address history"] },
    { key: "photos", label: "Required photos", required: true, keywords: ["photo"] },
    { key: "supporting", label: "Supporting documents (if requested)", required: false, keywords: ["supporting", "explanation"] }
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
