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

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
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
// a properly structured letter body using HEADING/BULLET markers
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

async function generateLetterBodyWithAI(p: AIBodyParams): Promise<string[]> {
  const knownFacts: string[] = [];
  if (p.passportNo) knownFacts.push(`Passport No.: ${p.passportNo}`);
  if (p.uci) knownFacts.push(`UCI: ${p.uci}`);
  if (p.institution) knownFacts.push(`Institution: ${p.institution}`);
  if (p.program) knownFacts.push(`Program: ${p.program}`);
  if (p.arrivalDate) knownFacts.push(`Arrival in Canada: ${p.arrivalDate}`);
  if (p.permitExpiry) knownFacts.push(`Current permit expires: ${p.permitExpiry}`);
  if (p.programEndDate) knownFacts.push(`Program end date: ${p.programEndDate}`);

  const systemPrompt = `You are a Regulated Canadian Immigration Consultant (RCIC) drafting the body of a formal Representative Submission Letter to IRCC (Immigration, Refugees and Citizenship Canada).

You will receive:
- The client's specific story / situational notes from the consultant
- The client's known facts (name, passport, institution, etc.)
- The application type

Your job: produce a polished, professional letter body that weaves the client's specific situation into an appropriate IRCC submission letter structure.

CRITICAL OUTPUT FORMAT — return ONLY a JSON array of strings. Each string is one element of the letter body, in order. Use these markers:

  "HEADING:Section Title"           — produces a bold section heading with red accent bar
  "BULLET:Bold Label:|Rest of text" — produces a bullet point with bold label
  "Plain paragraph text"            — any string without a marker is a body paragraph

Example output:
[
  "I am writing to formally request a study permit extension on behalf of my client, Aarti (Passport No. U4471976)...",
  "She is committed to her academic program...",
  "HEADING:Eligibility for Study Permit Extension",
  "As per Canadian government regulations, an inside-Canada application may be submitted if...",
  "BULLET:Valid Study Permit:|Attached is Aarti's valid study permit.",
  "BULLET:Confirmation of Enrollment:|We have included the confirmation of enrollment from Capilano University.",
  "HEADING:Request for Consideration",
  "We respectfully request your prompt and favourable consideration of this application...",
  "Thank you for your attention to this matter."
]

STRUCTURE GUIDELINES:
1. Open with 1-2 introductory paragraphs that name the client and the application type, weaving in their specific situation from the story
2. Add 2-4 HEADING sections that organize the eligibility argument or substantive case (e.g. "Background and Academic Journey", "Eligibility for [Permit Type]", "Compliance with IRCC Requirements", "Request for Consideration")
3. Use BULLET points where listing eligibility criteria or supporting facts adds clarity (typically under "Eligibility" sections)
4. Close with a polite request for favourable consideration and a thank-you paragraph
5. Use the consultant's third-person voice — refer to "my client" and "${p.clientName}". Use the pronoun set ${p.pronoun.subject}/${p.pronoun.object}/${p.pronoun.possessive} for the client.
6. Keep the tone formal, respectful, professional. No flowery language, no exclamation marks.
7. Total letter body should be 6-12 entries in the array.
8. NEVER include "Dear Sir/Madam" or "Sincerely" — those are added separately.
9. NEVER include the document subject line — that's added separately.
10. Weave the client's specific story (transfers, hardships, achievements, gaps, etc.) into the body naturally.

Return ONLY the JSON array. No prose before or after. No markdown fences.`;

  const userPrompt = `APPLICATION TYPE: ${p.formTypeFull}
CLIENT NAME: ${p.clientName}
PRONOUN: ${p.pronoun.subject}/${p.pronoun.object}/${p.pronoun.possessive}

KNOWN FACTS:
${knownFacts.length ? knownFacts.map(f => `- ${f}`).join("\n") : "(none provided)"}

CLIENT'S STORY / NOTES FROM CONSULTANT:
${p.clientStory}

Draft the letter body as a JSON array of strings using the HEADING/BULLET markers as instructed.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
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

  // Find JSON array in response
  const startIdx = text.indexOf("[");
  const endIdx = text.lastIndexOf("]");
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error("AI response did not contain a JSON array");
  }
  const jsonStr = text.substring(startIdx, endIdx + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error("AI response was not valid JSON: " + (e as Error).message);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI response was not an array");
  }

  const result = parsed.filter((s) => typeof s === "string" && s.trim().length > 0) as string[];
  if (result.length < 3) {
    throw new Error("AI response had too few entries");
  }
  return result;
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
    const subjectLine = getSubjectLine(formType, clientName);
    const docs = getDocumentsList(formType);

    // ── Body generation: use AI if clientStory provided, otherwise fall back to template ──
    const clientStory = String(body.clientStory || "").trim();
    const editedBodyLines: string[] | null = Array.isArray(body.editedBodyLines)
      ? body.editedBodyLines.map((l: unknown) => String(l || ""))
      : null;
    const mode = String(body.mode || "").toLowerCase();
    let bodyLines: string[];

    if (editedBodyLines && editedBodyLines.length > 0) {
      // ── Path: client passed back edited body. Use it verbatim, no AI re-run.
      // Filter out any completely empty trailing lines but preserve in-body blanks
      // (those become paragraph breaks).
      bodyLines = editedBodyLines;
      while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
        bodyLines = bodyLines.slice(0, -1);
      }
    } else if (clientStory && clientStory.length >= 20 && process.env.ANTHROPIC_API_KEY) {
      // Use Claude to weave the client's specific story into a properly-structured letter
      try {
        bodyLines = await generateLetterBodyWithAI({
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
      } catch (e) {
        console.warn("AI letter body generation failed, falling back to template:", (e as Error).message);
        bodyLines = getBodyParagraphs({
          clientName, pronoun, formType, passportNo, uci, institution, program,
          arrivalDate, permitExpiry, programEndDate,
        });
      }
    } else {
      bodyLines = getBodyParagraphs({
        clientName, pronoun, formType, passportNo, uci, institution, program,
        arrivalDate, permitExpiry, programEndDate,
      });
    }

    // ── Preview mode: return body content as JSON for in-browser editing ──
    //
    // Frontend uses this two-step flow:
    //   1. Open modal → POST with `mode=preview` → receive JSON of body lines
    //      Staff edits the lines in a textarea
    //   2. Click Download → POST with `editedBodyLines` → receive PDF
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
      page.drawText(text, { x, y, size, font, color });
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
        page.drawText(line, { x: MARGIN_X + indent, y, size, font, color });
        y -= lh;
      }
      y -= opts.gapAfter ?? 6;
    };

    const drawBullet = (boldPart: string, restPart: string) => {
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
          page.drawText(ln, { x: MARGIN_X + indent, y, size, font: fontReg, color: TEXT_BLACK });
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
        page.drawText(line, {
          x: MARGIN_X + 6 + numberW + 4,
          y,
          size: 10.5,
          font: fontReg,
          color: TEXT_BLACK,
        });
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
