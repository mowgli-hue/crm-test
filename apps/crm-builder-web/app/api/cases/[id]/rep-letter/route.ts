import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase } from "@/lib/store";
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont, PDFImage } from "pdf-lib";
import fs from "fs";
import path from "path";

// ──────────────────────────────────────────────────────────────
// Newton Immigration — Representative Submission Letter generator
// Matches the Aarti reference: logo top-left, NEWTON IMMIGRATION wordmark,
// red separator, contact strip top-right, red gradient strip on every page.
// ──────────────────────────────────────────────────────────────

const RCIC_NAME = "Navdeep Singh Sandhu";
const RCIC_NUMBER = "R-705964";
const RCIC_COMPANY = "NEWTON IMMIGRATION INC.";
const RCIC_ADDRESS_LINE_1 = "8327 120 Street";
const RCIC_ADDRESS_LINE_2 = "Delta, BC V4C 6R1";
const RCIC_EMAIL = "newtonimmigration@gmail.com";
const RCIC_PHONE = "+1 778.723.6662";
const RCIC_WEBSITE = "www.newtonimmigration.com";

// Page geometry (Letter size)
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 60;
const HEADER_H = 95;   // letterhead reserved space at top of every page
const FOOTER_H = 30;   // red gradient strip at bottom of every page
const CONTENT_TOP = PAGE_H - HEADER_H - 30;
const CONTENT_BOTTOM = FOOTER_H + 30;

// Colours
const NEWTON_RED = rgb(0.84, 0.10, 0.13);     // ~#D6191F
const NEWTON_RED_DARK = rgb(0.55, 0.05, 0.08);
const TEXT_BLACK = rgb(0.10, 0.10, 0.10);
const TEXT_GREY = rgb(0.40, 0.40, 0.40);

// ──────────────────────────────────────────────────────────────
// Form-type metadata
// ──────────────────────────────────────────────────────────────

function getFormTypeFull(formType: string): string {
  const ft = formType.toLowerCase();
  if (ft.includes("pgwp")) return "Post-Graduation Work Permit (PGWP)";
  if (ft.includes("sowp")) return "Spousal Open Work Permit (SOWP)";
  if (ft.includes("bowp")) return "Bridging Open Work Permit (BOWP)";
  if (ft.includes("vowp")) return "Visitor Open Work Permit";
  if (ft.includes("study permit extension")) return "Study Permit Extension";
  if (ft.includes("study permit")) return "Study Permit";
  if (ft.includes("visitor visa") || ft.includes("trv")) return "Temporary Resident Visa (Visitor Visa)";
  if (ft.includes("visitor record")) return "Visitor Record";
  if (ft.includes("super visa")) return "Super Visa";
  if (ft.includes("family") || ft.includes("sponsorship")) return "Family Sponsorship";
  if (ft.includes("express entry") || ft.includes("pr")) return "Express Entry Permanent Residence";
  return formType || "Immigration Application";
}

function getSubjectLine(formType: string, clientName: string): string {
  const ft = formType.toLowerCase();
  if (ft.includes("study permit extension")) return `Study permit Extension Application for ${clientName}`;
  if (ft.includes("pgwp")) return `Post-Graduation Work Permit Application for ${clientName}`;
  if (ft.includes("sowp")) return `Spousal Open Work Permit Application for ${clientName}`;
  if (ft.includes("study permit")) return `Study Permit Application for ${clientName}`;
  if (ft.includes("visitor visa") || ft.includes("trv")) return `Visitor Visa Application for ${clientName}`;
  if (ft.includes("visitor record")) return `Visitor Record Application for ${clientName}`;
  if (ft.includes("super visa")) return `Super Visa Application for ${clientName}`;
  if (ft.includes("family") || ft.includes("sponsorship")) return `Family Sponsorship Application for ${clientName}`;
  if (ft.includes("work permit")) return `Work Permit Application for ${clientName}`;
  return `${getFormTypeFull(formType)} for ${clientName}`;
}

function getDocumentsList(formType: string): string[] {
  const ft = formType.toLowerCase();
  if (ft.includes("study permit extension")) return [
    "IMM 5709 – Application to Change Conditions, Extend My Stay or Remain in Canada as a Student",
    "IMM 5476 – Use of a Representative",
    "Valid Study Permit",
    "Confirmation of Enrollment / Letter of Enrollment",
    "Official / Unofficial Transcripts",
    "Proof of Tuition Payment",
    "Passport (bio page + all relevant pages)",
    "Digital Photograph (IRCC compliant)",
  ];
  if (ft.includes("pgwp")) return [
    "IMM 5710 – Application to Change Conditions or Extend Stay in Canada",
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Current Study Permit",
    "Program Completion Letter",
    "Official Academic Transcripts",
    "Language Test Results (if applicable)",
    "Digital Photograph (IRCC compliant)",
  ];
  if (ft.includes("sowp") || ft.includes("bowp") || ft.includes("vowp") || ft.includes("work permit")) return [
    "IMM 5710 – Application to Change Conditions or Extend Stay in Canada",
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Current Permit / Status Document",
    "Proof of Employer / Job Offer (if applicable)",
    "Marriage Certificate (if SOWP)",
    "Digital Photograph (IRCC compliant)",
  ];
  if (ft.includes("study permit")) return [
    "IMM 1294 – Application for Study Permit",
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Letter of Acceptance from DLI",
    "Provincial Attestation Letter (PAL)",
    "Proof of Financial Support",
    "Digital Photograph (IRCC compliant)",
  ];
  if (ft.includes("visitor record")) return [
    "IMM 5708 – Application to Change Conditions or Extend Stay in Canada",
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Current Status Document",
    "Reason for Extension",
    "Digital Photograph (IRCC compliant)",
  ];
  if (ft.includes("visitor") || ft.includes("trv")) return [
    "IMM 5257 – Application for Visitor Visa",
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Proof of Funds",
    "Travel History Documents",
    "Invitation Letter (if applicable)",
    "Digital Photograph (IRCC compliant)",
  ];
  if (ft.includes("super visa")) return [
    "IMM 5257 – Application for Visitor Visa (Super Visa)",
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Proof of Relationship to Sponsor",
    "Sponsor's Notice of Assessment / Income Proof",
    "Medical Insurance (1 year)",
    "Upfront Medical Examination",
    "Digital Photograph (IRCC compliant)",
  ];
  if (ft.includes("family") || ft.includes("sponsorship")) return [
    "IMM 1344 – Application to Sponsor",
    "IMM 0008 – Generic Application Form",
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages) – both parties",
    "Marriage Certificate",
    "Police Clearance Certificate",
    "Proof of Genuine Relationship",
    "Sponsor Financial Documents",
  ];
  return [
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Supporting Documents as required",
    "Digital Photograph (IRCC compliant)",
  ];
}

// ──────────────────────────────────────────────────────────────
// Body content per form type (matches Aarti tone for Study Permit Ext)
// ──────────────────────────────────────────────────────────────

interface BodyParams {
  clientName: string;
  pronoun: { subject: string; object: string; possessive: string };
  formType: string;
  passportNo: string;
  uci: string;
  institution: string;
  program: string;
  arrivalDate: string;
  permitExpiry: string;
  programEndDate: string;
}

function getBodyParagraphs(p: BodyParams): string[] {
  const ft = p.formType.toLowerCase();
  const { clientName, pronoun, passportNo, institution, program, programEndDate, permitExpiry } = p;
  const Sub = pronoun.subject.charAt(0).toUpperCase() + pronoun.subject.slice(1);

  // Markers used in the body array:
  //   HEADING:Title       — draws a bold section heading
  //   BULLET:Label:|Rest  — draws a bullet with bold label + regular text
  //   anything else       — body paragraph

  if (ft.includes("study permit extension")) {
    return [
      `I am writing to formally request a study permit extension on behalf of my client, ${clientName}${passportNo ? ` (Passport No. ${passportNo})` : ""}, who is currently enrolled at ${institution || "[Institution]"}. ${clientName} is scheduled to complete ${pronoun.possessive} studies by ${programEndDate || "[Date]"}.`,
      `${Sub} is committed to ${pronoun.possessive} academic program and has demonstrated genuine intent to complete ${pronoun.possessive} studies in Canada. We have attached ${pronoun.possessive} unofficial transcripts, which reflect ${pronoun.possessive} academic progress.`,

      `HEADING:Eligibility for Study Permit Extension`,
      `As per Canadian government regulations, an inside-Canada application to extend a study permit may be submitted if the applicant meets the following conditions:`,
      `BULLET:Valid Study Permit:|Attached is ${clientName}'s valid study permit${permitExpiry ? `, which is valid until ${permitExpiry}` : ""}.`,
      `BULLET:Confirmation of Enrollment:|We have included the confirmation of enrollment from ${institution || "the institution"}, indicating that ${clientName} meets this requirement.`,
      `BULLET:Genuine Student Intent:|${clientName} has remained an active full-time student and intends to continue ${pronoun.possessive} studies until program completion.`,

      `HEADING:Request for Consideration`,
      `All required details have been provided in the application form. We respectfully request your understanding and consideration of this matter. Granting ${clientName} a study permit extension would not only benefit ${pronoun.object} personally but also align with Canada's goals of attracting and retaining talented international students.`,
      `We trust in your team's expertise and commitment to fairness, and we kindly ask for a timely review of this request, given its potential impact on ${clientName}'s future and career.`,

      `Thank you for your attention to this matter. We look forward to a positive resolution and appreciate your dedication to upholding the principles of equity and compassion in Canada's immigration system.`,
    ];
  }

  if (ft.includes("pgwp")) {
    return [
      `I am writing to formally submit an application for a Post-Graduation Work Permit on behalf of my client, ${clientName}${passportNo ? ` (Passport No. ${passportNo})` : ""}, who has successfully completed ${pronoun.possessive} program of study${institution ? ` at ${institution}` : ""}${program ? ` (${program})` : ""}. ${Sub} now seeks authorization to gain Canadian work experience under the PGWP program.`,

      `HEADING:Program Completion and Academic Compliance`,
      `${clientName} has successfully completed all academic requirements of ${pronoun.possessive} program and has been issued a Program Completion Letter${institution ? ` by ${institution}` : ""}. This confirms that ${clientName} meets the core PGWP eligibility requirement of program completion at a Designated Learning Institution (DLI).`,

      `HEADING:Full-Time Status and IRCC Compliance`,
      `Throughout ${pronoun.possessive} studies, ${clientName} maintained continuous full-time student status, except where authorized, in full compliance with IRCC requirements. This demonstrates genuine student intent and adherence to immigration conditions.`,

      `HEADING:Valid Temporary Resident Status`,
      `${clientName} holds valid temporary resident status in Canada at the time of this application, satisfying the requirement to apply for a PGWP from within Canada.`,

      `HEADING:Eligibility Summary`,
      `${clientName} meets all eligibility requirements for the Post-Graduation Work Permit, including:`,
      `BULLET:Program Completion:|Successful completion of an eligible program at a PGWP-eligible DLI.`,
      `BULLET:Valid Study Permit:|Held a valid study permit at the time of program completion.`,
      `BULLET:Full-Time Enrollment:|Maintained full-time status throughout the program.`,
      `BULLET:Genuine Intent:|Clear intent to gain Canadian work experience and contribute to the Canadian economy.`,

      `HEADING:Request for Consideration`,
      `We respectfully request your prompt and favourable consideration of this application. Granting ${clientName} a PGWP will allow ${pronoun.object} to apply ${pronoun.possessive} education in a professional setting, gain valuable Canadian work experience, and contribute meaningfully to Canada's labour market and economic growth.`,

      `Thank you for your attention to this matter. Should you require any additional information or documentation, please do not hesitate to contact our office.`,
    ];
  }

  if (ft.includes("sowp")) {
    return [
      `I am writing to formally submit an application for a Spousal Open Work Permit on behalf of my client, ${clientName}${passportNo ? ` (Passport No. ${passportNo})` : ""}.`,

      `HEADING:Eligibility for Spousal Open Work Permit`,
      `${Sub} is the spouse of an eligible principal applicant who currently holds valid status as a student or worker in Canada. As such, ${clientName} qualifies for a Spousal Open Work Permit under the applicable IRCC provisions.`,

      `HEADING:Genuine Relationship`,
      `The relationship between ${clientName} and the principal applicant is genuine and continuing. Supporting evidence of this relationship has been included with the application, including the marriage certificate and additional relationship documents.`,

      `HEADING:Supporting Documentation`,
      `All required forms, identity documents, and proof of the principal applicant's status have been included with this application. ${clientName} meets all eligibility requirements for the SOWP.`,

      `HEADING:Request for Consideration`,
      `We respectfully request your prompt and favourable consideration of this application. Should you require any additional information or documentation, please do not hesitate to contact our office.`,

      `Thank you for your attention to this matter.`,
    ];
  }

  if (ft.includes("visitor visa") || ft.includes("trv")) {
    return [
      `I am writing to formally submit an application for a Temporary Resident Visa (Visitor Visa) on behalf of my client, ${clientName}${passportNo ? ` (Passport No. ${passportNo})` : ""}.`,

      `HEADING:Purpose of Visit`,
      `${Sub} intends to visit Canada for a temporary purpose and has demonstrated genuine intent to return to ${pronoun.possessive} home country at the end of the authorized period of stay.`,

      `HEADING:Ties to Home Country`,
      `${clientName} maintains strong personal, financial, and professional ties to ${pronoun.possessive} home country, supporting ${pronoun.possessive} clear intent to return after the visit. Documentation evidencing these ties has been included with the application.`,

      `HEADING:Financial Capacity`,
      `${clientName} has demonstrated sufficient funds to support ${pronoun.possessive} stay in Canada without recourse to public funds, as evidenced by the bank statements and supporting financial documents enclosed.`,

      `HEADING:Request for Consideration`,
      `We respectfully request your prompt and favourable consideration of this application. Should you require any additional information, please do not hesitate to contact our office.`,

      `Thank you for your attention to this matter.`,
    ];
  }

  if (ft.includes("visitor record")) {
    return [
      `I am writing to formally submit an application for a Visitor Record on behalf of my client, ${clientName}${passportNo ? ` (Passport No. ${passportNo})` : ""}.`,

      `HEADING:Reason for Extension`,
      `${Sub} seeks to extend ${pronoun.possessive} authorized stay in Canada as a visitor for a legitimate purpose. The reason for the extension has been documented in the application form and supporting submissions.`,

      `HEADING:Compliance with Visitor Status`,
      `Throughout ${pronoun.possessive} stay in Canada, ${clientName} has fully complied with the conditions of ${pronoun.possessive} visitor status and has not engaged in any unauthorized activity.`,

      `HEADING:Request for Consideration`,
      `We respectfully request your prompt and favourable consideration of this matter. All required documentation has been included with this application. Should you require any additional information, please do not hesitate to contact our office.`,

      `Thank you for your attention to this matter.`,
    ];
  }

  if (ft.includes("family") || ft.includes("sponsorship")) {
    return [
      `I am writing to formally submit a Family Sponsorship application on behalf of my client, ${clientName}${passportNo ? ` (Passport No. ${passportNo})` : ""}.`,

      `HEADING:Application Category`,
      `This application is submitted under the Family Class category. All eligibility requirements have been carefully reviewed and confirmed for both the sponsor and the principal applicant.`,

      `HEADING:Genuine Relationship`,
      `The relationship between the sponsor and the principal applicant is genuine and continuing. Supporting evidence — including marriage records, photographs, communication history, and joint financial documentation — has been included with the application.`,

      `HEADING:Sponsor Eligibility`,
      `The sponsor meets all financial and admissibility requirements set out by IRCC, and the corresponding documentation has been provided.`,

      `HEADING:Request for Consideration`,
      `We respectfully request your prompt and favourable consideration of this application. Should you require any additional information, please do not hesitate to contact our office.`,

      `Thank you for your attention to this matter.`,
    ];
  }

  // Generic fallback for any other form type
  return [
    `I am writing to formally submit an application for a ${getFormTypeFull(p.formType)} on behalf of my client, ${clientName}${passportNo ? ` (Passport No. ${passportNo})` : ""}.`,

    `HEADING:Eligibility and Compliance`,
    `As ${pronoun.possessive} authorized representative, I have reviewed all supporting documentation and confirm that ${clientName} meets the applicable eligibility requirements under the Immigration and Refugee Protection Act (IRPA) and associated regulations.`,

    `HEADING:Supporting Documentation`,
    `All required forms and supporting documents have been included with this application.`,

    `HEADING:Request for Consideration`,
    `We respectfully request your prompt and favourable consideration of this application. Should you require any additional information or documentation, please do not hesitate to contact our office.`,

    `Thank you for your attention to this matter.`,
  ];
}

// ──────────────────────────────────────────────────────────────
// Layout helpers
// ──────────────────────────────────────────────────────────────

// Strip characters that pdf-lib's WinAnsi encoder cannot handle.
// In particular newlines (\n, \r) crash drawText with "WinAnsi cannot encode 0x000a".
// Use this for any string that goes directly into page.drawText() without
// first being split into individual lines by wrapText.
function sanitizeForPdf(text: string): string {
  if (!text) return "";
  return String(text)
    .replace(/\r/g, "")           // strip carriage returns
    .replace(/\n+/g, " ")          // newlines → spaces (caller is single-line)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ""); // other control chars
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  // Honor hard newlines first — split on \n so each user-typed line is its own
  // paragraph. Within each segment, do word-wrapping by max width. Strip \r so
  // Windows line-endings don't leave stray carriage returns inside a line
  // (which would crash WinAnsi encoder downstream).
  const segments = String(text).replace(/\r/g, "").split("\n");
  const lines: string[] = [];

  for (const segment of segments) {
    if (!segment) {
      // Preserve blank lines from the original text (give the PDF visible spacing)
      lines.push("");
      continue;
    }
    const words = segment.split(" ");
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const w = font.widthOfTextAtSize(candidate, size);
      if (w > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function drawHeader(page: PDFPage, fonts: { bold: PDFFont; reg: PDFFont }, logoImg: PDFImage | null) {
  const top = PAGE_H;

  // ── TOP-LEFT: Newton emblem placed cleanly on white (no black box) ──
  // The emblem image already shows the full circle + monogram + maple leaf in proper colors,
  // so we let it stand on white — far cleaner and more professional than forcing a black box.
  const logoTargetH = 60;
  const logoX = MARGIN_X;
  const logoY = top - logoTargetH - 18;

  if (logoImg) {
    const dims = logoImg.scale(1);
    const ratio = dims.width / dims.height;
    const drawH = logoTargetH;
    const drawW = drawH * ratio;
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: drawW,
      height: drawH,
    });
  } else {
    // Fallback: red "N" if logo couldn't be embedded
    page.drawText("N", {
      x: logoX + 5,
      y: logoY + 14,
      size: 38,
      font: fonts.bold,
      color: NEWTON_RED,
    });
  }

  // ── CENTER: "NEWTON IMMIGRATION" wordmark ──
  // Vertically centered against the emblem; horizontally centred in the available space
  // between the emblem and the contact strip.
  const wordmarkY = top - 42;
  const wordmarkSize = 22;
  const letterSpacing = 1.5; // tracked-out letters for elegance (faked via individual draws)
  const newtonText = "NEWTON";
  const immText = "IMMIGRATION";

  // Calculate widths with letter spacing
  const newtonW = fonts.bold.widthOfTextAtSize(newtonText, wordmarkSize) + letterSpacing * (newtonText.length - 1);
  const spaceW = fonts.bold.widthOfTextAtSize(" ", wordmarkSize) + 4;
  const immW = fonts.bold.widthOfTextAtSize(immText, wordmarkSize) + letterSpacing * (immText.length - 1);
  const totalW = newtonW + spaceW + immW;

  // Horizontally centre between emblem (with 30pt buffer) and contact strip (with 30pt buffer)
  const availStart = logoX + 70 + 25;
  const availEnd = PAGE_W - MARGIN_X - 145;
  const wordmarkX = availStart + ((availEnd - availStart) - totalW) / 2;

  // Draw NEWTON in red, with letter spacing for elegance
  let cursorX = wordmarkX;
  for (const char of newtonText) {
    page.drawText(char, { x: cursorX, y: wordmarkY, size: wordmarkSize, font: fonts.bold, color: NEWTON_RED });
    cursorX += fonts.bold.widthOfTextAtSize(char, wordmarkSize) + letterSpacing;
  }
  // Space
  cursorX += spaceW - letterSpacing;
  // Draw IMMIGRATION in dark grey/black, also with letter spacing
  for (const char of immText) {
    page.drawText(char, { x: cursorX, y: wordmarkY, size: wordmarkSize, font: fonts.bold, color: rgb(0.10, 0.10, 0.10) });
    cursorX += fonts.bold.widthOfTextAtSize(char, wordmarkSize) + letterSpacing;
  }

  // ── TOP-RIGHT: contact strip ──
  const contactRightX = PAGE_W - MARGIN_X;
  const drawRight = (text: string, y: number, size = 9, color = TEXT_GREY) => {
    const w = fonts.reg.widthOfTextAtSize(text, size);
    page.drawText(text, { x: contactRightX - w, y, size, font: fonts.reg, color });
  };
  drawRight(RCIC_PHONE, top - 30, 9, TEXT_BLACK);
  drawRight(RCIC_EMAIL, top - 44);
  drawRight(RCIC_WEBSITE, top - 58);

  // ── Red separator with thin grey hairline below ──
  // Spans from the right edge of the emblem all the way to the right margin
  const sepY = top - 78;
  const sepStartX = logoX + 75;
  page.drawLine({
    start: { x: sepStartX, y: sepY },
    end: { x: PAGE_W - MARGIN_X, y: sepY },
    thickness: 3,
    color: NEWTON_RED,
  });
  page.drawLine({
    start: { x: sepStartX, y: sepY - 5 },
    end: { x: PAGE_W - MARGIN_X, y: sepY - 5 },
    thickness: 0.6,
    color: rgb(0.30, 0.30, 0.30),
  });
}

function drawFooter(page: PDFPage) {
  // Red gradient strip — simulate with stacked rectangles
  const stripH = 10;
  const segments = 30;
  const segW = PAGE_W / segments;
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const r = 0.55 + t * 0.30;
    const g = 0.05 + t * 0.05;
    const b = 0.07 + t * 0.06;
    page.drawRectangle({
      x: i * segW,
      y: 0,
      width: segW + 0.5,
      height: stripH,
      color: rgb(Math.min(r, 0.88), Math.min(g, 0.12), Math.min(b, 0.15)),
    });
  }
  page.drawRectangle({
    x: 0,
    y: stripH,
    width: PAGE_W,
    height: 1.5,
    color: NEWTON_RED_DARK,
  });
}

// ──────────────────────────────────────────────────────────────
// AI-powered body generation — takes a client's story and produces
// a properly structured letter body using HEADING/BULLET markers.
//
// The AI is given application-specific IRCC rules so it can weave
// regulatory references, key timelines, and eligibility criteria
// directly into the letter rather than producing generic prose.
// ──────────────────────────────────────────────────────────────

interface AIBodyParams {
  clientStory: string;
  clientName: string;
  formType: string;
  formTypeFull: string;
  pronoun: { subject: string; object: string; possessive: string };
  passportNo: string;
  uci: string;
  institution: string;
  program: string;
  arrivalDate: string;
  permitExpiry: string;
  programEndDate: string;
}

// Result of a single AI call: structured body + structured enclosed docs.
// Both are arrays of strings using marker syntax. Returning them together
// in one AI call (rather than two) keeps cost/latency low and lets the AI
// see the docs context when writing the body, so references line up.
interface AIBodyResult {
  bodyLines: string[];
  docs: string[];
}

// ──────────────────────────────────────────────────────────────
// Per-application IRCC rules — fed to the AI so the letter weaves
// in specific regulatory citations, deadlines, and eligibility
// language. Each block is a "what the consultant needs the AI to
// know" briefing — not boilerplate to copy-paste.
//
// Sources: canada.ca/en/immigration-refugees-citizenship, IRCC
// program delivery instructions, R 222 / R 215 of IRPR for status,
// IRPA s. 22 / 24 / 25 for permits.
// ──────────────────────────────────────────────────────────────
function getApplicationRules(formType: string): string {
  const ft = formType.toLowerCase();

  if (ft.includes("pgwp") || ft.includes("post-graduation") || ft.includes("post graduation")) {
    return `PGWP — POST-GRADUATION WORK PERMIT — KEY RULES TO WEAVE IN:
• One-time-only permit. Cannot be issued more than once per applicant in a lifetime.
• Maximum length: 3 years (or matches program length if program was 8-23 months).
• 180-day deadline: must apply within 180 days of program completion (date on official completion letter, not graduation ceremony).
• Eligible institution: client's school must be a Designated Learning Institution (DLI) on IRCC's PGWP-eligible list.
• Program length: ≥ 8 months (full-time). Quebec: ≥ 900 hours.
• Status: client must have held a valid study permit at some point during the 180-day window.
• If status has expired ≤ 90 days ago: apply with restoration ($350 + $239.75 fees).
• If status valid: apply with implied/maintained status; client may continue working full-time per R186(w) while application is processed.
• Field of study: for diploma/certificate grads with study permits applied for ON OR AFTER Feb 7, 2024, field of study CIP code must be on IRCC's eligible list (or be exempt).
• Language: Bachelor's+/Master's grads must have CLB 7 (university programs); college grads CLB 5; reflect in IELTS/CELPIP scores if mentioned.
• Form: IMM 5710 (inside Canada). Mark "Applying to Change Conditions": Yes; "Applying to Extend Stay": NO; "Applying to Change Employer": YES (this is the trick for PGWP).
• When citing: use phrases like "as per the eligibility criteria set out by IRCC for the Post-Graduation Work Permit Program" and "in accordance with section 205(c)(ii) of the IRPR which exempts open work permits from LMIA requirements".`;
  }

  if (ft.includes("sowp") || ft.includes("spousal open work permit") || (ft.includes("open work permit") && ft.includes("spous"))) {
    return `SOWP — SPOUSAL OPEN WORK PERMIT — KEY RULES TO WEAVE IN:
• Spouse/common-law partner of a foreign national who holds a valid work or study permit.
• Principal must be on TEER 0/1 (or eligible TEER 2/3 — recently restricted to specific occupations as of March 2024). Verify principal's NOC.
• If principal is a student, must be enrolled in master's (16+ months) / doctoral / select professional program. As of March 2024, undergraduate spouses no longer qualify.
• PGWP holder spouses: principal must hold PGWP AND be working in TEER 0/1 (or specific TEER 2/3 occupations).
• Genuine relationship: 12-month cohabitation evidence (common-law) OR marriage certificate (legalized + translated if foreign).
• Form: IMM 5710 inside Canada (most common). Outside Canada: IMM 1295.
• Open work permit — no LMIA needed (R205(c)(ii) IRPA).
• When citing: emphasize spouse-of-skilled-worker pathway under R205(c)(ii).`;
  }

  if (ft.includes("study permit extension") || (ft.includes("study permit") && (ft.includes("extend") || ft.includes("renew")))) {
    return `STUDY PERMIT EXTENSION — KEY RULES TO WEAVE IN:
• Apply ≥ 30 days before current permit expires (recommended).
• If permit has expired: must apply for restoration within 90 days ($350 + $239.75) AND must not have studied without authorization.
• Implied/maintained status (R 183(5)(6) IRPR): client may continue studying under same conditions while application processed if applied before expiry.
• Required evidence: valid passport, current study permit, proof of continuing enrollment (Letter of Enrollment / acceptance for new program), recent transcripts, proof of tuition.
• Form: IMM 5709.
• If switching DLI: include new acceptance + transfer documentation.
• When citing: reference "section 222 of IRPR governing study permit conditions" and "R 183(5)-(6) for implied status while application is pending".`;
  }

  if (ft.includes("trv") || ft.includes("visitor visa") || ft.includes("super visa")) {
    const isSuper = ft.includes("super visa");
    return `${isSuper ? "SUPER VISA" : "TRV / VISITOR VISA"} — KEY RULES TO WEAVE IN:
• Form: IMM 5257 (and Schedule 1 if applying outside Canada).
• Dual-intent doctrine: applying for TRV does not preclude applying for permanent residence later (s. 22(2) IRPA).
• Officer must be satisfied applicant will leave Canada at end of authorized stay (s. 22(1)(b) IRPA + R 179(b) IRPR).
• Strong ties to home country: employment, property, family, financial commitments.
• Funds: enough to cover trip + return. Document via bank statements, employment letter with salary, NOA, T4s.
• Travel history: prior travel to US/UK/Schengen strengthens application.
• Purpose: clear, time-bound. Itinerary, return ticket booking (or proof of intent), accommodation arrangements.
${isSuper ? "• Super Visa specific: Canadian sponsor (child/grandchild) must meet LICO; 1-year medical insurance ≥ $100,000 from Canadian insurer; medical exam by panel physician; sponsor's NOA; family relationship proof." : ""}
• When citing: reference "subsection 11(1) of IRPA" and "regulation 179 of IRPR".`;
  }

  if (ft.includes("pr card renewal") || ft.includes("pr card replacement") || (ft.includes("pr card") && !ft.includes("citizenship"))) {
    return `PR CARD RENEWAL / REPLACEMENT — KEY RULES TO WEAVE IN:
• 730-day residency obligation: client must have been physically present in Canada for at least 730 days within the most recent 5-year period (s. 28 IRPA).
• Equivalency periods (count toward 730 days): each day spent abroad with Canadian-citizen spouse, employed full-time by Canadian business abroad, or accompanying PR spouse who is similarly employed.
• Must apply from INSIDE Canada. If outside, must apply for a Permanent Resident Travel Document (PRTD) first.
• Form: IMM 5444. Fee: $50.
• Document checklist: PR landing document (IMM 1000 / 5292 / 5688 / COPR), 2 PR-card-specification photos (50mm × 70mm — different from work-permit photos!), secondary government ID, 3 years of CRA Notice of Assessment, address proof.
• Travel history: every trip in last 5 years with exact dates (cross-checked against CBSA records).
• When citing: reference "section 28 of IRPA setting out the residency obligation" and "section 31 of IRPA governing PR cards".`;
  }

  if (ft.includes("citizenship")) {
    return `CITIZENSHIP — ADULT GRANT — KEY RULES TO WEAVE IN:
• 1095-day physical presence rule: must have been physically in Canada for at least 1095 days in the 5 years immediately before signing the application (s. 5(1)(c)(i) Citizenship Act).
• Pre-PR time: each day as temporary resident OR protected person before becoming PR counts as ½ day, max 365 days credit.
• Tax filing: must have filed Canadian income tax for at least 3 of the 5 years immediately before applying (s. 5(1)(c)(iii)).
• Language: prove CLB/NCLC level 4 in English or French (CELPIP / IELTS / TEF / TCF / approved Canadian secondary or post-secondary).
• Knowledge test: applicants 18-54 must pass citizenship test on rights, responsibilities, history, geography, government.
• No prohibitions: not under removal order, not charged with indictable offence, not currently incarcerated, no recent citizenship revocation.
• Form: CIT 0002 + CIT 0177 (residence calculator). Fee: $630 ($530 + $100 right-of-citizenship).
• When citing: reference "section 5 of the Citizenship Act setting out the requirements for a grant of citizenship".`;
  }

  if (ft.includes("spousal sponsorship") || ft.includes("spouse sponsorship") || (ft.includes("sponsorship") && (ft.includes("spous") || ft.includes("partner") || ft.includes("conjugal") || ft.includes("common law") || ft.includes("common-law")))) {
    return `SPOUSAL SPONSORSHIP — KEY RULES TO WEAVE IN:
• Sponsor: Canadian citizen or permanent resident, ≥ 18, residing in Canada (or showing intent to return for outland).
• Two streams: INLAND (sponsored spouse already in Canada with valid status, eligible for SOWP after AOR) vs OUTLAND (faster, full appeal rights, sponsored spouse can travel during processing).
• Genuineness of relationship is the central question — every doc package must establish this.
• Forms: IMM 1344 (Application to Sponsor), IMM 0008 (Generic), IMM 5532 (Relationship Information & Sponsorship Eval), IMM 5669 (Schedule A — both parties), IMM 5406 (Additional Family — both parties).
• Sponsor cannot be in default on previous sponsorship undertaking, child support, or social assistance (some exceptions — disability).
• Three relationship categories: Spouse (legally married), Common-Law (12+ months continuous cohabitation), Conjugal (genuine relationship ≥ 1 yr but cannot live together due to barriers).
• Settlement evidence: joint bank, joint lease, joint bills, photos with family/friends, communication records, travel together, statements from people who know the couple.
• Inadmissibility: medical, criminal, security checks for sponsored spouse + family members.
• When citing: reference "section 12(1) of IRPA — Family Class" and "regulation 130 of IRPR for sponsor eligibility".`;
  }

  if (ft.includes("express entry") || ft.includes("eapr") || ft.includes("federal skilled worker") || ft.includes("federal skilled trades") || ft.includes("canadian experience class") || ft.includes("fsw") || ft.includes("cec") || ft.includes("fst") || ft.includes("pnp") || (ft.includes("permanent residence") && !ft.includes("card"))) {
    return `EXPRESS ENTRY — eAPR (Application for Permanent Residence) — KEY RULES TO WEAVE IN:
• 60-day deadline from ITA: complete eAPR must be submitted within 60 days of Invitation to Apply.
• eAPR must match Express Entry profile that earned the ITA. Any inconsistency = misrepresentation risk under IRPA s. 40 (5-year ban).
• Programs: FSW (foreign skilled work, 1 yr in last 10), CEC (Canadian work experience, 1 yr in last 3, valid status during it), FST (skilled trades, 2 yrs experience), PNP-EE (provincial nomination linked to EE).
• NOC: must be TEER 0, 1, 2, or 3. TEER 4/5 disqualifies.
• Language: TRF must be ≤ 2 years old at submission (CLB 7+ for FSW, varies for others).
• ECA: required for any foreign education claimed for CRS points (WES/IQAS/ICAS/CES/ICES/MCC/PEBC).
• Police certificates: every country lived in 6+ months since age 18.
• Medical: panel physician, ≤ 12 months valid.
• Proof of funds: required for FSW + FST (not CEC, not PNP nominees) — current threshold per family size, 6 months of bank statements.
• Forms: IMM 0008 (Generic), Schedule A (IMM 5669 — every applicant 18+), IMM 5406 (Additional Family), IMM 5562 (Travel History), IMM 5476 (Use of Rep).
• When citing: reference "section 12(2) of IRPA — Economic Class" and the specific program "Federal Skilled Worker Class — section 75 of IRPR" / "Canadian Experience Class — section 87.1 of IRPR" / etc.`;
  }

  // Fallback — generic immigration application
  return `GENERIC IMMIGRATION APPLICATION — KEY RULES:
• Cite the specific application type and its governing regulation in IRPA / IRPR / Citizenship Act.
• Address client's status and eligibility clearly.
• List required forms by IMM number.
• Address any inadmissibility / status issues directly.`;
}

async function generateLetterBodyWithAI(p: AIBodyParams): Promise<AIBodyResult> {
  const knownFacts: string[] = [];
  if (p.passportNo) knownFacts.push(`Passport No.: ${p.passportNo}`);
  if (p.uci) knownFacts.push(`UCI: ${p.uci}`);
  if (p.institution) knownFacts.push(`Institution: ${p.institution}`);
  if (p.program) knownFacts.push(`Program: ${p.program}`);
  if (p.arrivalDate) knownFacts.push(`Arrival in Canada: ${p.arrivalDate}`);
  if (p.permitExpiry) knownFacts.push(`Current permit expires: ${p.permitExpiry}`);
  if (p.programEndDate) knownFacts.push(`Program end date: ${p.programEndDate}`);

  const applicationRules = getApplicationRules(p.formType);

  const systemPrompt = `You are a Regulated Canadian Immigration Consultant (RCIC) drafting a formal Representative Submission Letter to IRCC (Immigration, Refugees and Citizenship Canada) for a ${p.formTypeFull} application.

You will receive:
- The consultant's case-specific notes (which may include instructions about what to emphasize, what to omit, or how to frame certain facts)
- The client's known facts (name, passport, institution, etc.)
- A briefing of the IRCC rules and regulations governing this application type

Your job: produce a polished, persuasive, professionally-structured letter body that:
1. Weaves the client's specific story into the proper IRCC submission letter structure
2. Cites the relevant regulations / IRPA / IRPR / IRCC policy where appropriate
3. Anticipates and addresses concerns the visa officer might raise
4. Establishes eligibility CLEARLY using BULLET points where helpful
5. Reads as a confident professional submission, not a generic template

═══════════════════════════════════════════════════════════════
APPLICATION-SPECIFIC RULES TO WEAVE IN:
═══════════════════════════════════════════════════════════════
${applicationRules}

═══════════════════════════════════════════════════════════════
LISTEN TO THE CONSULTANT
═══════════════════════════════════════════════════════════════
The "CLIENT'S STORY / NOTES" field below contains instructions FROM the consultant. The consultant may say things like:
  - "Emphasize that they had a medical leave during semester 3" → put a paragraph or bullet about it
  - "Don't mention the visa refusal from 2019 — it's been disclosed elsewhere" → don't bring it up
  - "Add a strong eligibility argument" → expand the eligibility section
  - "Their employer letter is weak, please write a section explaining the duties match NOC" → write that section
You MUST follow the consultant's directions. The consultant knows the case better than you do.

If the consultant gives generic notes ("just standard PGWP letter"), use the standard structure for that application type.

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — return ONLY a JSON object, no prose, no markdown
═══════════════════════════════════════════════════════════════
{
  "bodyLines": [array of strings using marker syntax described below],
  "docs":      [array of strings — the enclosed-documents list]
}

═══════════════════════════════════════════════════════════════
BODY LINES — marker syntax
═══════════════════════════════════════════════════════════════
  "HEADING:Section Title"           — bold section heading with red accent bar
  "BULLET:Bold Label:|Rest of text" — a bullet point with bold label
  "Plain paragraph text"            — any string without a marker is a body paragraph

Example bodyLines:
[
  "I am writing to formally request a Post-Graduation Work Permit on behalf of my client, ${p.clientName} (Passport No. U4471976), who recently completed ${p.pronoun.possessive} studies at Capilano University.",
  "${p.clientName} successfully completed a 2-year Bachelor of Hospitality Management program on August 15, 2026, fulfilling all academic requirements with consistent full-time enrolment throughout.",
  "HEADING:Eligibility for Post-Graduation Work Permit",
  "${p.clientName.split(' ')[0]} meets each of the eligibility criteria set out by IRCC for the PGWP Program:",
  "BULLET:Designated Learning Institution:|Capilano University is a DLI on IRCC's PGWP-eligible list.",
  "BULLET:Program Length:|The program exceeds the minimum 8-month duration required under PGWP rules.",
  "BULLET:Full-time Enrolment:|${p.pronoun.subject.charAt(0).toUpperCase() + p.pronoun.subject.slice(1)} maintained full-time student status across all required semesters.",
  "BULLET:Application Within 180 Days:|This application is being submitted within the 180-day window from the program completion date as required by IRCC.",
  "BULLET:Valid Status:|${p.pronoun.subject.charAt(0).toUpperCase() + p.pronoun.subject.slice(1)} continues to hold valid status under section 183(5) of IRPR while this application is being processed.",
  "HEADING:Compliance with IRCC Requirements",
  "All required forms and supporting documents have been completed in accordance with the eligibility criteria for the Post-Graduation Work Permit Program. The IMM 5710 has been completed indicating an open work permit application under the PGWP exemption code C43, in accordance with section 205(c)(ii) of the IRPR.",
  "HEADING:Request for Consideration",
  "We respectfully request your prompt and favourable consideration of this application. ${p.clientName.split(' ')[0]} is committed to contributing to the Canadian labour market and to building a long-term future in Canada.",
  "Thank you for your attention to this matter."
]

═══════════════════════════════════════════════════════════════
ENCLOSED DOCUMENTS — what to include
═══════════════════════════════════════════════════════════════
The "docs" array is the numbered list shown under "Enclosed Documents" at the end of the letter. It must reflect the SPECIFIC documents this case needs based on:
- The application type
- The client's specific situation as described in the consultant's notes (e.g., if the case involves restoration, include the restoration fee receipt; if SOWP, include the principal partner's permit and employment letter; if Super Visa, include the Canadian sponsor's NOA + insurance)
- Any documents the consultant explicitly mentions in their notes

Format: a flat array of strings, each a single document entry, properly named. Use IMM numbers + descriptive names. Example:

[
  "IMM 5710 – Application to Change Conditions or Extend Stay in Canada",
  "IMM 5476 – Use of a Representative",
  "Passport (bio page + all relevant pages)",
  "Current Study Permit",
  "Program Completion Letter from Capilano University",
  "Official Academic Transcripts",
  "IELTS Test Report Form (CLB 7+)",
  "Digital Photograph (IRCC compliant)"
]

Typical doc count: 6-12 entries. Order: forms first (IMM numbers), then identity (passport), then status (permits), then evidence (transcripts, letters, financial proofs), then photos last.

═══════════════════════════════════════════════════════════════
🔴 CRITICAL: ENUMERATE EVERY ELIGIBILITY RULE AS A BULLET
═══════════════════════════════════════════════════════════════
Your most important job is to make the eligibility argument VISIBLE.

In the "APPLICATION-SPECIFIC RULES" section above, you were given a list
of rules / requirements / conditions for this application type. EVERY
one of those rules that is RELEVANT to this client's case MUST appear
in the letter body as its OWN bullet point with a bold label.

This is not optional. Visa officers scan rep letters looking for each
eligibility criterion to be addressed. If a rule is not visibly addressed,
the officer assumes we missed it.

Examples of rules that MUST become bullets (when applicable):
  • Language requirement (CLB level) → "BULLET:Language Proficiency:|..."
  • 180-day filing window (PGWP) → "BULLET:Application Within 180 Days:|..."
  • Designated Learning Institution → "BULLET:Eligible DLI:|..."
  • Program length (≥ 8 months) → "BULLET:Program Length:|..."
  • Full-time enrolment → "BULLET:Full-Time Enrolment:|..."
  • Field of study (PGWP CIP code) → "BULLET:Field of Study:|..."
  • Valid status / restoration → "BULLET:Valid Status:|..."
  • 730-day residency (PR card) → "BULLET:Residency Obligation:|..."
  • 1095-day physical presence (citizenship) → "BULLET:Physical Presence:|..."
  • Tax filing (citizenship) → "BULLET:Tax Filing:|..."
  • NOC TEER level (work permits, EE) → "BULLET:NOC Classification:|..."
  • Genuineness of relationship (sponsorship, SOWP) → "BULLET:Genuine Relationship:|..."
  • ECA for foreign credentials (EE) → "BULLET:Educational Credential Assessment:|..."
  • Police certificates / medical (PR) → "BULLET:Background Verification:|..."
  • Funds / financial capacity (TRV, study, EE) → "BULLET:Financial Capacity:|..."
  • Strong ties to home country (TRV) → "BULLET:Ties to Home Country:|..."
  • Dual intent (TRV) → "BULLET:Dual Intent:|..."
  • Principal partner's status (SOWP) → "BULLET:Principal Partner Status:|..."

EACH bullet should:
  - Have a bold label naming the rule (e.g. "Language Proficiency:")
  - Have a body explaining HOW the client meets that rule, citing the
    specific evidence in the file (test score, dates, school name, etc.)
  - Reference the regulation where appropriate (IRPR section, IRPA section,
    IRCC policy)

Example for a PGWP case (Post-Graduation Work Permit):
[
  "BULLET:Eligible Designated Learning Institution:|My client completed studies at Capilano University, which is on IRCC's PGWP-eligible Designated Learning Institution list, satisfying this core eligibility requirement.",
  "BULLET:Program Length:|The Bachelor of Hospitality Management program is a 4-year full-time program, well exceeding the 8-month minimum required under PGWP rules.",
  "BULLET:Full-Time Enrolment:|My client maintained full-time student status across all required academic semesters as evidenced by the official transcripts enclosed.",
  "BULLET:Application Within 180 Days:|This application is submitted within the 180-day window from the program completion date of August 15, 2026, as required by IRCC.",
  "BULLET:Valid Status:|My client continues to hold valid status under section 183(5) of IRPR (implied/maintained status) while this application is being processed.",
  "BULLET:Field of Study:|The program completed by my client falls within IRCC's PGWP-eligible field of study list under the post-February 2024 framework.",
  "BULLET:Language Proficiency:|My client meets the required Canadian Language Benchmark (CLB) level, as evidenced by the IELTS Test Report Form enclosed showing scores well above the minimum threshold.",
  "BULLET:One-Time Eligibility:|My client has not previously been issued a Post-Graduation Work Permit, satisfying the once-per-lifetime eligibility rule under PGWP guidelines."
]

Note how every applicable rule is its own bullet. This is what the
output must look like for ANY application type — adjust the bullets
to match the rule set for the specific application.

═══════════════════════════════════════════════════════════════
STRUCTURE GUIDELINES (BODY)
═══════════════════════════════════════════════════════════════
1. Open with 1-2 introductory paragraphs naming the client + application type, weaving in their specific situation from the consultant's notes.
2. Add a HEADING called "Background and ${p.formTypeFull.includes("Permit") || p.formTypeFull.includes("Visa") ? "Status History" : "Application Context"}" with 1-2 paragraphs of context (academic journey for study/PGWP, employment history for work, relationship timeline for sponsorship, etc.).
3. Add a HEADING called "Eligibility for ${p.formTypeFull}" — under it, ENUMERATE EVERY APPLICABLE RULE AS ITS OWN BULLET (see above — this is the heart of the letter).
4. Add a HEADING called "Compliance with IRCC Requirements" — cite the specific IMM forms enclosed and the relevant IRPR/IRPA sections.
5. Add a HEADING called "Request for Consideration" — close with a polite request for favourable consideration and a thank-you paragraph.
6. BULLET points are mandatory under "Eligibility" — they are how visa officers verify we addressed each criterion.
7. Use the consultant's third-person voice — "my client", "${p.clientName}", and pronouns ${p.pronoun.subject}/${p.pronoun.object}/${p.pronoun.possessive}.
8. Tone: formal, respectful, confident, professional. No flowery adjectives. No exclamation marks. No "I hope" / "I think" hedging.
9. Total body: 12-20 entries in the array (more than before — because every eligibility rule is now its own bullet).
10. NEVER include "Dear Sir/Madam" or "Sincerely" — those are added separately by the PDF builder.
11. NEVER include the document subject line — that's added separately.
12. If the consultant mentions specific dates / facts that contradict known facts, USE THE CONSULTANT'S VERSION (they may have updated info).
13. If the consultant gives instructions like "emphasize X" or "don't mention Y", FOLLOW THOSE INSTRUCTIONS even if it changes the structure above.

Return ONLY the JSON object. No prose before or after. No markdown fences.`;

  const userPrompt = `APPLICATION TYPE: ${p.formTypeFull}
CLIENT NAME: ${p.clientName}
PRONOUN: ${p.pronoun.subject}/${p.pronoun.object}/${p.pronoun.possessive}

KNOWN FACTS:
${knownFacts.length ? knownFacts.map(f => `- ${f}`).join("\n") : "(none provided — use placeholder phrasing the consultant can fill in later)"}

CLIENT'S STORY / NOTES FROM CONSULTANT:
${p.clientStory}

Draft the letter as a JSON object with bodyLines (using HEADING/BULLET markers) and docs (enclosed-documents list).`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // Use Sonnet for quality on this — Haiku can produce shallow output
      // for legally-significant letters. Cost is minimal (one call per
      // letter generation, only when staff explicitly invoke it).
      model: "claude-sonnet-4-5-20250929",
      // 6000 tokens — letters now enumerate every eligibility rule as its
      // own bullet, so they're longer than before. 6000 leaves comfortable
      // room for the full body + docs without truncation.
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  let text = data?.content?.[0]?.text || "";

  // Strip any accidental markdown code fences
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  // Locate the JSON OBJECT in the response. The new prompt asks for
  // {bodyLines: [...], docs: [...]}. We're tolerant of leading/trailing
  // prose just in case.
  const startIdx = text.indexOf("{");
  const endIdx = text.lastIndexOf("}");
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error("AI response did not contain a JSON object");
  }
  const jsonStr = text.substring(startIdx, endIdx + 1);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error("AI response was not valid JSON: " + (e as Error).message);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response was not an object");
  }

  const rawBody = Array.isArray(parsed.bodyLines) ? parsed.bodyLines : [];
  const rawDocs = Array.isArray(parsed.docs) ? parsed.docs : [];

  const bodyLines = rawBody
    .filter((s: unknown) => typeof s === "string" && (s as string).trim().length > 0) as string[];
  const docs = rawDocs
    .filter((s: unknown) => typeof s === "string" && (s as string).trim().length > 0) as string[];

  if (bodyLines.length < 3) {
    throw new Error("AI response had too few body entries");
  }
  // If AI somehow forgot docs, fall back to the static template list — the
  // letter body alone is recoverable but we never want to ship a letter
  // with NO enclosed-doc list.
  return { bodyLines, docs };
}

// ──────────────────────────────────────────────────────────────
// Main route
// ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const systemToken = body?.systemToken;
    const isSystem = systemToken === (process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024");

    if (!isSystem) {
      const user = await getCurrentUserFromRequest(request);
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const companyId = process.env.DEFAULT_COMPANY_ID || "newton";
    const caseItem = await getCase(companyId, params.id);
    if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

    const intake = (caseItem.pgwpIntake as Record<string, string>) || {};
    const clientName = caseItem.client || "Client";
    const formType = caseItem.formType || "Immigration Application";
    const passportNo = intake.passportNumber || body.passportNumber || "";
    const uci = intake.uci || body.uci || "";
    const institution = intake.institution || body.institution || "";
    const program = intake.program || body.program || "";
    const arrivalDate = intake.originalEntryDate || body.arrivalDate || "";
    const permitExpiry = intake.permitExpiry || body.permitExpiry || "";
    const programEndDate = intake.programEndDate || body.programEndDate || "";

    // Pronouns (defaults to they/them/their; caller can pass "he" or "she")
    const pronounIn = String(body.pronouns || intake.pronouns || "they").toLowerCase();
    let pronoun = { subject: "they", object: "them", possessive: "their" };
    if (pronounIn.startsWith("he")) pronoun = { subject: "he", object: "him", possessive: "his" };
    else if (pronounIn.startsWith("she")) pronoun = { subject: "she", object: "her", possessive: "her" };

    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const defaultSubjectLine = getSubjectLine(formType, clientName);
    // editedSubject — staff can edit the subject line in the rep letter
    // modal. If provided on download, we use it verbatim instead of the
    // default formula. Trim and length-cap to avoid pathological inputs
    // (the PDF subject is bold and on one line — keep it sane).
    const editedSubjectRaw = typeof body.editedSubject === "string" ? body.editedSubject.trim() : "";
    const subjectLine = editedSubjectRaw.length > 0 && editedSubjectRaw.length <= 300
      ? editedSubjectRaw
      : defaultSubjectLine;
    // Default docs list — used only as a fallback when:
    //   (a) staff didn't provide a story, OR
    //   (b) AI generation fails, OR
    //   (c) staff hasn't edited the docs but the AI didn't return any
    const fallbackDocs = getDocumentsList(formType);

    // ── Body + docs generation: use AI if clientStory provided, else fall back to template ──
    const clientStory = String(body.clientStory || "").trim();
    const editedBodyLines: string[] | null = Array.isArray(body.editedBodyLines)
      ? body.editedBodyLines.map((l: unknown) => String(l || ""))
      : null;
    // editedDocs — the editable enclosed-document list. Mirrors editedBodyLines:
    // staff modifies the AI/template-generated list in the modal, sends it back
    // here on download. If provided, we use it verbatim (no AI re-run).
    const editedDocs: string[] | null = Array.isArray(body.editedDocs)
      ? body.editedDocs.map((d: unknown) => String(d || "").trim()).filter((s: string) => s.length > 0)
      : null;
    const mode = String(body.mode || "").toLowerCase();
    let bodyLines: string[];
    let docs: string[];

    if (editedBodyLines && editedBodyLines.length > 0) {
      // ── Path: staff passed back edited body. Use it verbatim, no AI re-run.
      // Filter out any completely empty trailing lines but preserve in-body blanks
      // (those become paragraph breaks).
      bodyLines = editedBodyLines;
      while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
        bodyLines = bodyLines.slice(0, -1);
      }
      // Docs: prefer staff-edited list, otherwise the static template list.
      // (We don't re-run AI on a download because the staff has already
      // approved the doc list at this stage.)
      docs = editedDocs && editedDocs.length > 0 ? editedDocs : fallbackDocs;
    } else if (clientStory && clientStory.length >= 20 && process.env.ANTHROPIC_API_KEY) {
      // Use Claude to weave the client's specific story into a properly-structured letter
      // AND generate a tailored enclosed-doc list based on the case-specific facts.
      try {
        const aiResult = await generateLetterBodyWithAI({
          clientStory,
          clientName,
          formType,
          formTypeFull: getFormTypeFull(formType),
          pronoun,
          passportNo,
          uci,
          institution,
          program,
          arrivalDate,
          permitExpiry,
          programEndDate,
        });
        bodyLines = aiResult.bodyLines;
        // If AI generated docs, prefer those (case-tailored). If the AI
        // returned an empty array (rare), fall back to the static template
        // so we never ship a letter without an enclosed-doc list.
        docs = aiResult.docs.length > 0 ? aiResult.docs : fallbackDocs;
      } catch (e) {
        console.warn("AI letter body generation failed, falling back to template:", (e as Error).message);
        bodyLines = getBodyParagraphs({
          clientName, pronoun, formType, passportNo, uci, institution, program,
          arrivalDate, permitExpiry, programEndDate,
        });
        docs = fallbackDocs;
      }
    } else {
      bodyLines = getBodyParagraphs({
        clientName, pronoun, formType, passportNo, uci, institution, program,
        arrivalDate, permitExpiry, programEndDate,
      });
      docs = fallbackDocs;
    }

    // ── Preview mode: return body content + docs as JSON for in-browser editing ──
    //
    // Frontend uses this two-step flow:
    //   1. Open modal → POST with `mode=preview` → receive JSON of body lines + docs
    //      Staff edits the lines AND the enclosed-doc list in textareas
    //   2. Click Download → POST with `editedBodyLines` + `editedDocs` → receive PDF
    //
    // The "header" (date, "Dear Sir/Madam,", subject) and "footer" (sign-off,
    // RCIC info, address, contact) are NOT returned because they are template-
    // generated server-side from case + Newton config and never user-edited.
    // This keeps the source of truth on the server for all the boilerplate
    // and makes editing safer (staff can't accidentally remove the RCIC
    // identifier number from a letter destined for IRCC).
    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        clientName,
        formType,
        subject: subjectLine,
        date: today,
        bodyLines,
        docs,
        // Echo back generation context the editor might want to display.
        generated: clientStory && clientStory.length >= 20 ? "ai" : "template",
      });
    }

    // Build PDF
    const pdfDoc = await PDFDocument.create();
    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Embed Newton emblem (natural colours: black monogram + red maple leaf, on white).
    // Loads emblem first; falls back to full logo if emblem not present.
    let logoImg: PDFImage | null = null;
    try {
      const emblemPath = path.join(process.cwd(), "public", "newton_emblem.png");
      const fallbackPath = path.join(process.cwd(), "public", "newton_logo.png");
      const logoPath = fs.existsSync(emblemPath) ? emblemPath : fallbackPath;
      const logoBytes = fs.readFileSync(logoPath);
      logoImg = await pdfDoc.embedPng(logoBytes);
    } catch (e) {
      console.warn("Newton logo failed to load:", (e as Error).message);
    }

    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    drawHeader(page, { bold: fontBold, reg: fontReg }, logoImg);
    drawFooter(page);

    let y = CONTENT_TOP;
    const contentWidth = PAGE_W - MARGIN_X * 2;
    const lineGap = 4;

    const newPage = () => {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      drawHeader(page, { bold: fontBold, reg: fontReg }, logoImg);
      drawFooter(page);
      y = CONTENT_TOP;
    };

    const ensureSpace = (needed: number) => {
      if (y - needed < CONTENT_BOTTOM) newPage();
    };

    const drawLineText = (text: string, opts: { x?: number; size?: number; font?: PDFFont; color?: any; bold?: boolean } = {}) => {
      const size = opts.size ?? 11;
      const font = opts.font ?? (opts.bold ? fontBold : fontReg);
      const color = opts.color ?? TEXT_BLACK;
      const x = opts.x ?? MARGIN_X;
      ensureSpace(size + lineGap);
      // Sanitize: drawText cannot encode \n or other control chars. Caller
      // expects single-line output here (multi-line goes through drawParagraph).
      page.drawText(sanitizeForPdf(text), { x, y, size, font, color });
      y -= size + lineGap;
    };

    const drawParagraph = (text: string, opts: { size?: number; font?: PDFFont; color?: any; indent?: number; gapAfter?: number } = {}) => {
      const size = opts.size ?? 11;
      const font = opts.font ?? fontReg;
      const color = opts.color ?? TEXT_BLACK;
      const indent = opts.indent ?? 0;
      const lines = wrapText(text, font, size, contentWidth - indent);
      const lh = size * 1.45;
      for (const line of lines) {
        ensureSpace(lh);
        // Empty lines (from hard line-breaks within the source) just advance
        // the cursor — drawText cannot accept "" + we'd leave WinAnsi alone.
        if (line) {
          page.drawText(line, { x: MARGIN_X + indent, y, size, font, color });
        }
        y -= lh;
      }
      y -= opts.gapAfter ?? 6;
    };

    const drawBullet = (boldPartRaw: string, restPartRaw: string) => {
      // Sanitize newlines/control chars — these would crash drawText.
      const boldPart = sanitizeForPdf(boldPartRaw);
      const restPart = sanitizeForPdf(restPartRaw);
      const size = 11;
      const lh = size * 1.45;
      const indent = 22;
      const bulletX = MARGIN_X + 8;

      ensureSpace(lh);
      page.drawCircle({ x: bulletX, y: y + size * 0.35, size: 1.6, color: TEXT_BLACK });

      const boldW = fontBold.widthOfTextAtSize(boldPart + " ", size);
      page.drawText(boldPart, {
        x: MARGIN_X + indent,
        y,
        size,
        font: fontBold,
        color: TEXT_BLACK,
      });

      const firstAvail = contentWidth - indent - boldW;
      const restWords = restPart.split(" ");
      let firstLine = "";
      let i = 0;
      while (i < restWords.length) {
        const candidate = firstLine ? `${firstLine} ${restWords[i]}` : restWords[i];
        if (fontReg.widthOfTextAtSize(candidate, size) > firstAvail) break;
        firstLine = candidate;
        i++;
      }
      page.drawText(firstLine, {
        x: MARGIN_X + indent + boldW,
        y,
        size,
        font: fontReg,
        color: TEXT_BLACK,
      });
      y -= lh;

      const remaining = restWords.slice(i).join(" ");
      if (remaining) {
        const lines = wrapText(remaining, fontReg, size, contentWidth - indent);
        for (const ln of lines) {
          ensureSpace(lh);
          if (ln) {
            page.drawText(ln, { x: MARGIN_X + indent, y, size, font: fontReg, color: TEXT_BLACK });
          }
          y -= lh;
        }
      }
      y -= 2;
    };

    // ── Title (centred, underlined) ──
    const title = "REPRESENTATIVE SUBMISSION LETTER";
    const titleW = fontBold.widthOfTextAtSize(title, 13);
    ensureSpace(40);
    page.drawText(title, {
      x: (PAGE_W - titleW) / 2,
      y,
      size: 13,
      font: fontBold,
      color: TEXT_BLACK,
    });
    page.drawLine({
      start: { x: (PAGE_W - titleW) / 2, y: y - 2 },
      end: { x: (PAGE_W + titleW) / 2, y: y - 2 },
      thickness: 0.8,
      color: TEXT_BLACK,
    });
    y -= 30;

    drawLineText(today, { size: 11 });
    y -= 6;

    drawLineText("Immigration, Refugees and Citizenship Canada", { size: 11 });
    y -= 6;

    drawLineText(`Subject: ${subjectLine}`, { size: 11, bold: true });
    y -= 4;

    drawLineText("Dear Sir/Madam,", { size: 11 });
    y -= 6;

    for (const para of bodyLines) {
      if (para.startsWith("HEADING:")) {
        const headingText = para.substring("HEADING:".length).trim();
        // Reserve enough vertical space for the heading + at least one follow-up paragraph line
        const HEADING_BLOCK_NEEDED = 56;
        if (y - HEADING_BLOCK_NEEDED < CONTENT_BOTTOM) newPage();

        // Generous gap above for clear section separation
        y -= 14;

        // Heading rendering — three coordinated visual elements:
        //   1. Vertical red accent bar at the left edge (4pt wide × heading height)
        //   2. Bold heading text with subtle letter spacing for elegance
        //   3. Thin grey underline rule spanning the full content width below the heading
        const headingSize = 13;
        const headingHeight = headingSize + 2;

        ensureSpace(headingHeight + 8);

        // 1. Red vertical accent bar on the left
        page.drawRectangle({
          x: MARGIN_X - 8,
          y: y - 2,
          width: 3,
          height: headingHeight,
          color: NEWTON_RED,
        });

        // 2. Heading text — bold, slightly tracked
        const trackedSpacing = 0.6;
        let cursorX = MARGIN_X;
        for (const char of headingText) {
          page.drawText(char, {
            x: cursorX,
            y,
            size: headingSize,
            font: fontBold,
            color: TEXT_BLACK,
          });
          cursorX += fontBold.widthOfTextAtSize(char, headingSize) + trackedSpacing;
        }

        y -= headingHeight + 3;

        // 3. Thin grey underline rule across the content width
        page.drawLine({
          start: { x: MARGIN_X, y },
          end: { x: PAGE_W - MARGIN_X, y },
          thickness: 0.5,
          color: rgb(0.78, 0.78, 0.78),
        });

        y -= 12; // breathing room before body content
      } else if (para.startsWith("BULLET:")) {
        const stripped = para.substring("BULLET:".length);
        const [boldLabel, ...restArr] = stripped.split("|");
        const rest = restArr.join("|").trim();
        drawBullet(boldLabel.trim(), rest);
      } else {
        drawParagraph(para, { size: 11, gapAfter: 8 });
      }
    }

    y -= 6;

    // Keep the signature block together — needs about 150pt of vertical space
    const SIGNATURE_BLOCK_HEIGHT = 160;
    if (y - SIGNATURE_BLOCK_HEIGHT < CONTENT_BOTTOM) {
      newPage();
    }

    drawLineText("Sincerely,", { size: 11 });
    y -= 32; // signature space

    // Company name in bold, slightly larger
    ensureSpace(16);
    page.drawText(RCIC_COMPANY, {
      x: MARGIN_X,
      y,
      size: 11.5,
      font: fontBold,
      color: TEXT_BLACK,
    });
    y -= 16;

    // Name + RCIC number on same line, bold name
    ensureSpace(15);
    page.drawText(`${RCIC_NAME}, RCIC ${RCIC_NUMBER}`, {
      x: MARGIN_X,
      y,
      size: 11,
      font: fontBold,
      color: TEXT_BLACK,
    });
    y -= 16;

    // Address block (slightly muted)
    drawLineText(RCIC_ADDRESS_LINE_1, { size: 10.5, color: TEXT_GREY });
    drawLineText(RCIC_ADDRESS_LINE_2, { size: 10.5, color: TEXT_GREY });
    y -= 4;
    // Contact block
    drawLineText(RCIC_EMAIL, { size: 10.5, color: TEXT_GREY });
    drawLineText(RCIC_PHONE, { size: 10.5, color: TEXT_GREY });

    // Keep "Enclosed Documents" header with at least its first 3 items
    const ENCLOSED_HEADER_BLOCK = 110;
    if (y - ENCLOSED_HEADER_BLOCK < CONTENT_BOTTOM) {
      newPage();
    } else {
      y -= 26;
    }

    // ── Enclosed Documents heading (matches the body section heading style) ──
    const headingText2 = "Enclosed Documents";
    const headingSize2 = 13;
    const headingHeight2 = headingSize2 + 2;

    ensureSpace(headingHeight2 + 8);

    // Red vertical accent bar
    page.drawRectangle({
      x: MARGIN_X - 8,
      y: y - 2,
      width: 3,
      height: headingHeight2,
      color: NEWTON_RED,
    });

    // Bold heading text with subtle tracking
    let cursorX2 = MARGIN_X;
    const trackedSpacing2 = 0.6;
    for (const char of headingText2) {
      page.drawText(char, {
        x: cursorX2,
        y,
        size: headingSize2,
        font: fontBold,
        color: TEXT_BLACK,
      });
      cursorX2 += fontBold.widthOfTextAtSize(char, headingSize2) + trackedSpacing2;
    }

    y -= headingHeight2 + 3;

    // Grey underline rule
    page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: PAGE_W - MARGIN_X, y },
      thickness: 0.5,
      color: rgb(0.78, 0.78, 0.78),
    });

    y -= 14;

    docs.forEach((doc, i) => {
      // Render as numbered list with consistent indent
      const number = `${i + 1}.`;
      const numberW = fontBold.widthOfTextAtSize(number, 10.5);
      ensureSpace(16);
      page.drawText(number, {
        x: MARGIN_X + 6,
        y,
        size: 10.5,
        font: fontBold,
        color: NEWTON_RED,
      });
      // Wrap doc text after the number
      const docLines = wrapText(doc, fontReg, 10.5, contentWidth - 30);
      const lh = 10.5 * 1.45;
      docLines.forEach((line, idx) => {
        ensureSpace(lh);
        if (line) {
          page.drawText(line, {
            x: MARGIN_X + 6 + numberW + 4,
            y,
            size: 10.5,
            font: fontReg,
            color: TEXT_BLACK,
          });
        }
        y -= lh;
      });
      y -= 2;
    });

    const pdfBytes = await pdfDoc.save();
    const safeName = clientName.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "Client";
    const fileName = `${safeName} - Representative Letter.pdf`;

    let driveLink = "";
    try {
      const { uploadFileToDriveFolder, extractDriveFolderId, createCaseDriveStructure } = await import("@/lib/google-drive");
      let folderId = extractDriveFolderId(caseItem.docsUploadLink || "");
      if (!folderId) {
        const structure = await createCaseDriveStructure({ clientName, caseId: params.id, companyId });
        folderId = structure.mainFolderId;
      }
      const driveRes = await uploadFileToDriveFolder({ folderId, fileName, mimeType: "application/pdf", fileBuffer: Buffer.from(pdfBytes) });
      driveLink = driveRes.webViewLink || "";
      console.log(`✅ Rep letter uploaded to Drive: ${fileName}`);
    } catch (e) {
      console.error("Drive upload failed (returning PDF directly):", (e as Error).message);
    }

    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Drive-Link": driveLink,
      },
    });

  } catch (e) {
    console.error("Rep letter error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
