// lib/application-forms.ts
//
// Which IRCC forms each application type requires — and whether each is an XFA
// (LiveCycle dynamic) PDF. This is the registry the Case Agent uses to know,
// for any file, which forms still need to be produced. It's also the hook the
// XFA form-filling capability plugs into later: an auto-fill action will read
// `getRequiredForms(formType)`, fill each `xfa` form from the case's intake
// data, and mark it present.
//
// `xfa: true` means the form is a dynamic XFA PDF (most IRCC IMM/CIT forms are).
// Those need the XFA-aware fill pipeline, NOT a plain AcroForm fill — flagging
// them here keeps that distinction explicit for the form-filler.

export type IrccForm = {
  id: string;            // e.g. "IMM5710"
  label: string;
  xfa: boolean;          // dynamic XFA PDF (needs the XFA fill pipeline)
  online?: boolean;      // submitted via an online portal, no PDF to fill
  note?: string;
};

const F = {
  IMM5257: { id: "IMM5257", label: "Application for a Temporary Resident Visa", xfa: true },
  IMM5476: { id: "IMM5476", label: "Use of a Representative", xfa: true },
  IMM5708: { id: "IMM5708", label: "Application to Change Conditions / Extend Stay as a Visitor", xfa: true },
  IMM5709: { id: "IMM5709", label: "Application to Change Conditions / Extend Stay as a Student", xfa: true },
  IMM5710: { id: "IMM5710", label: "Application to Change Conditions / Extend Stay / Remain as a Worker", xfa: true },
  IMM1294: { id: "IMM1294", label: "Application for Study Permit Made Outside of Canada", xfa: true },
  IMM1295: { id: "IMM1295", label: "Application for Work Permit Made Outside of Canada", xfa: true },
  IMM5444: { id: "IMM5444", label: "Application for a Permanent Resident Card", xfa: true },
  IMM5644: { id: "IMM5644", label: "Supplementary Identification Form (PR Card)", xfa: true },
  IMM0008: { id: "IMM0008", label: "Generic Application Form for Canada (PR)", xfa: true },
  IMM1344: { id: "IMM1344", label: "Application to Sponsor / Sponsorship Agreement", xfa: true },
  IMM5532: { id: "IMM5532", label: "Relationship Information and Sponsorship Evaluation", xfa: true },
  CIT0002: { id: "CIT0002", label: "Application for Canadian Citizenship", xfa: true },
  CIT0407: { id: "CIT0407", label: "Physical Presence Calculation (online)", xfa: false, online: true },
  EE_ONLINE: { id: "EE_ONLINE", label: "Express Entry profile (online portal)", xfa: false, online: true, note: "No PDF — completed in the IRCC online account." },
} satisfies Record<string, IrccForm>;

// Map a free-text formType to the IRCC forms it needs. Order = the order they
// belong in the package. Always includes IMM5476 (Use of Representative).
export function getRequiredForms(formType: string): IrccForm[] {
  const ft = String(formType || "").toLowerCase();
  const rep = F.IMM5476;

  // Study
  if (ft.includes("study permit extension") || ft.includes("study to study") || ft.includes("college change") || ft.includes("study extension"))
    return [F.IMM5709, rep];
  if (ft.includes("study permit")) return [F.IMM1294, rep];

  // Work
  if (ft.includes("sowp") || ft.includes("spousal open work")) {
    return ft.includes("outside") ? [F.IMM1295, rep] : [F.IMM5710, rep];
  }
  if (ft.includes("pgwp") || ft.includes("bowp") || ft.includes("vowp") || ft.includes("lmia") ||
      ft.includes("work permit") || ft.includes("post-graduation") || ft.includes("post graduation"))
    return ft.includes("outside") ? [F.IMM1295, rep] : [F.IMM5710, rep];

  // Visit / temporary
  if (ft.includes("visitor record")) return [F.IMM5708, rep];
  // Restoration of visitor status uses the visitor-record form (IMM5708).
  if (ft.includes("restoration")) return [F.IMM5708, rep];
  // A TRV is the travel-document application on IMM5257 — even when filed from
  // inside Canada — NOT the visitor-record form. So TRV (inside or outside)
  // falls through to the IMM5257 branch below.
  if (ft.includes("trv") || ft.includes("visitor visa") || ft.includes("super visa") || ft.includes("supervisa"))
    return [F.IMM5257, rep];

  // PR & Citizenship
  if (ft.includes("pr card") || ft.includes("permanent resident card")) return [F.IMM5444, F.IMM5644, rep];
  if (ft.includes("citizenship")) return [F.CIT0002, F.CIT0407, rep];
  if (ft.includes("spousal") || ft.includes("sponsorship")) return [F.IMM1344, F.IMM5532, F.IMM0008, rep];
  if (ft.includes("express entry") || ft.includes("pnp")) return [F.EE_ONLINE, rep];

  // Fallback: just the representative form.
  return [rep];
}

// Detect which required forms are already present among a case's document
// filenames (e.g. "IMM5710e_Singh.pdf" → IMM5710 present). Online forms are
// treated as "not a PDF we produce" and excluded from the missing list.
export function formStatus(formType: string, docNames: string[]): { required: IrccForm[]; present: string[]; missing: IrccForm[] } {
  const required = getRequiredForms(formType);
  const names = docNames.map((n) => String(n || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const present: string[] = [];
  for (const f of required) {
    const key = f.id.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (names.some((n) => n.includes(key))) present.push(f.id);
  }
  const missing = required.filter((f) => !f.online && !present.includes(f.id));
  return { required, present, missing };
}
