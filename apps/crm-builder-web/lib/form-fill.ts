// lib/form-fill.ts
//
// The bridge between a CRM case and the IRCC XFA form-fillers in apps/pdf-service.
//
// The PDF service (POST /fill { formId, data }) already fills the real XFA forms
// (IMM5710/5708/5709/5257/5476) by editing the form's XFA datasets XML — the
// correct way for dynamic IRCC PDFs. What was missing is the MAPPING: turning a
// case's intake answers into the exact `data` keys each filler expects. That's
// what this module does, grounded in the fillers' real field names.
//
// IMPORTANT: forms produced here are DRAFTS for staff to verify and sign — they
// fill only the facts we hold with confidence and leave legal-choice radios
// (application type, admissibility questions) for a human. Nothing is submitted.

import type { CaseItem } from "@/lib/models";

export function pdfServiceUrl(): string {
  return (process.env.PDF_SERVICE_URL || "https://crm-test-production-b755.up.railway.app").replace(/\/+$/, "");
}

// Forms this module can map from case data. The four temp-status forms share a
// large "personal core" of identical field names, so they all map from one core
// builder + small per-form additions. IMM5476 is applicant-only (rep hardcoded).
export const MAPPABLE_FORMS = new Set(["imm5710", "imm5708", "imm5257", "imm5709", "imm5476"]);

const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
const pick = (obj: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) { const v = s(obj[k]); if (v) return v; }
  return "";
};

function splitName(full: string): { first: string; last: string } {
  const parts = s(full).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

// "YYYY-MM-DD" (or similar) → { y, m, d }. Best-effort; blank parts stay blank.
function splitDob(v: string): { y: string; m: string; d: string } {
  const m = s(v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return { y: m[1], m: m[2].padStart(2, "0"), d: m[3].padStart(2, "0") };
  return { y: "", m: "", d: "" };
}

// North-American phone → area/exchange/line parts the XFA expects.
function splitPhone(v: string): { area: string; first3: string; last4: string; intl: string } {
  const d = s(v).replace(/\D/g, "");
  const ten = d.length >= 10 ? d.slice(-10) : "";
  if (!ten) return { area: "", first3: "", last4: "", intl: s(v) };
  return { area: ten.slice(0, 3), first3: ten.slice(3, 6), last4: ten.slice(6, 10), intl: "" };
}

// The shared "personal core" — field names identical across IMM5710/5708/5709
// and (bar the service field) IMM5257. Extra keys a given form doesn't read are
// harmlessly ignored by the filler, so one core safely serves all four. We fill
// only confident identity/contact facts; legal-choice radios and gated sections
// (work/study/visit details) are left for staff to complete on the draft.
function personalCore(caseItem: CaseItem): Record<string, string> {
  const intake = ((caseItem as any).pgwpIntake as Record<string, unknown>) || {};
  const first = pick(intake, "firstName", "first_name", "givenName", "given_name") || splitName(s((caseItem as any).client)).first;
  const last = pick(intake, "lastName", "last_name", "familyName", "family_name") || splitName(s((caseItem as any).client)).last;
  const dob = splitDob(pick(intake, "dateOfBirth", "dob", "date_of_birth"));
  const phone = splitPhone(pick(intake, "phone", "phoneNumber", "q7") || s((caseItem as any).leadPhone));
  const citizenship = pick(intake, "citizenship", "nationality", "countryOfCitizenship", "country_of_citizenship");
  const pExp = splitDob(pick(intake, "passportExpiry", "passport_expiry", "passportExpiryDate"));
  const pIss = splitDob(pick(intake, "passportIssue", "passport_issue", "passportIssueDate"));
  const spouse = splitName(pick(intake, "spouseName", "spouse_name"));

  return {
    uci_client_id: pick(intake, "uci", "UCI", "clientId", "uci_client_id"),
    family_name: last,
    given_name: first,
    sex: pick(intake, "sex", "gender"),
    dob_year: dob.y, dob_month: dob.m, dob_day: dob.d,
    place_birth_city: pick(intake, "placeOfBirthCity", "birthCity", "place_birth_city"),
    place_birth_country: pick(intake, "placeOfBirthCountry", "birthCountry", "countryOfBirth", "place_birth_country"),
    citizenship_country: citizenship,
    marital_status: pick(intake, "maritalStatus", "marital_status"),
    spouse_family_name: spouse.last,
    spouse_given_name: spouse.first,
    native_language: pick(intake, "nativeLanguage", "motherTongue", "native_language"),
    passport_number: pick(intake, "passportNumber", "passport", "passport_number"),
    passport_country: citizenship,
    passport_issue_year: pIss.y, passport_issue_month: pIss.m, passport_issue_day: pIss.d,
    passport_expiry_year: pExp.y, passport_expiry_month: pExp.m, passport_expiry_day: pExp.d,
    mailing_street_num: pick(intake, "streetNumber", "street_num", "mailing_street_num"),
    mailing_street_name: pick(intake, "streetName", "street_name", "mailing_street_name", "address"),
    mailing_city: pick(intake, "city", "mailing_city"),
    mailing_province: pick(intake, "province", "mailing_province"),
    mailing_postal_code: pick(intake, "postalCode", "postal_code", "mailing_postal_code"),
    mailing_country: pick(intake, "country", "mailing_country") || "Canada",
    residential_same_as_mailing: "Y",
    phone_area_code: phone.area, phone_first_three: phone.first3, phone_last_five: phone.last4,
    phone_intl_number: phone.intl,
    email: pick(intake, "email") || s((caseItem as any).leadEmail),
  };
}

// PGWP / worker — IMM5710. service field is `service_in_language`.
export function mapCaseToImm5710(caseItem: CaseItem): Record<string, string> {
  return { ...personalCore(caseItem), service_in_language: "01" }; // English; work-details section left for staff
}
// Visitor Record — IMM5708. Personal core; extend/visit choices left for staff.
export function mapCaseToImm5708(caseItem: CaseItem): Record<string, string> {
  return { ...personalCore(caseItem) };
}
// TRV / Visitor Visa — IMM5257. Uses `service_in` (not service_in_language).
export function mapCaseToImm5257(caseItem: CaseItem): Record<string, string> {
  const intake = ((caseItem as any).pgwpIntake as Record<string, unknown>) || {};
  return {
    ...personalCore(caseItem),
    service_in: "01",
    residential_postal_code: pick(intake, "postalCode", "postal_code"),
  };
}
// Study Permit Extension — IMM5709. Personal core; study-details section gated/left for staff.
export function mapCaseToImm5709(caseItem: CaseItem): Record<string, string> {
  return { ...personalCore(caseItem) };
}

// Map a case → IMM5476 (Use of Representative). Rep details are hardcoded inside
// the filler; we supply the applicant facts only.
export function mapCaseToImm5476(caseItem: CaseItem): Record<string, string> {
  const intake = ((caseItem as any).pgwpIntake as Record<string, unknown>) || {};
  const name = {
    first: pick(intake, "firstName", "first_name", "givenName") || splitName(s((caseItem as any).client)).first,
    last: pick(intake, "lastName", "last_name", "familyName") || splitName(s((caseItem as any).client)).last,
  };
  return {
    family_name: name.last,
    given_name: name.first,
    dob: pick(intake, "dateOfBirth", "dob"),
    uci: pick(intake, "uci", "UCI"),
    declaration_date: new Date().toISOString().slice(0, 10),
  };
}

export function buildFormData(formId: string, caseItem: CaseItem): Record<string, string> | null {
  switch (formId) {
    case "imm5710": return mapCaseToImm5710(caseItem);
    case "imm5708": return mapCaseToImm5708(caseItem);
    case "imm5257": return mapCaseToImm5257(caseItem);
    case "imm5709": return mapCaseToImm5709(caseItem);
    case "imm5476": return mapCaseToImm5476(caseItem);
    default: return null; // no mapper yet — caller skips / flags for manual
  }
}

// Fill a form through the PDF service and return the PDF bytes.
export async function fillFormViaService(formId: string, data: Record<string, unknown>): Promise<Buffer> {
  const res = await fetch(`${pdfServiceUrl()}/fill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formId, data }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`PDF service /fill ${res.status}: ${(err as any)?.error || "failed"}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
