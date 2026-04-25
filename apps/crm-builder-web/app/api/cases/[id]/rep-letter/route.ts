import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase } from "@/lib/store";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const RCIC_NAME = "Navdeep Singh Sandhu";
const RCIC_NUMBER = "R-705964";
const RCIC_COMPANY = "Newton Immigration Inc.";
const RCIC_ADDRESS = "Suite 300, 9850 King George Blvd, Surrey BC V3T 0P9";
const RCIC_EMAIL = "newtonimmigration@gmail.com";
const RCIC_PHONE = "+1 778-723-6662";

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}

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
  return formType;
}

function getDocumentsList(formType: string): string[] {
  const ft = formType.toLowerCase();
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
    "Digital Photograph (IRCC compliant)",
  ];
  if (ft.includes("study permit")) return [
    "IMM 1294 – Application for Study Permit",
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Letter of Acceptance from DLI",
    "Proof of Financial Support",
    "Digital Photograph (IRCC compliant)",
  ];
  if (ft.includes("visitor") || ft.includes("trv")) return [
    "IMM 5257 – Application for Visitor Visa",
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Proof of Funds",
    "Travel History Documents",
    "Digital Photograph (IRCC compliant)",
  ];
  if (ft.includes("family") || ft.includes("sponsorship")) return [
    "IMM 1344 – Application to Sponsor",
    "IMM 0008 – Generic Application Form",
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Marriage Certificate",
    "Police Clearance Certificate",
    "Proof of Relationship",
    "Sponsor Financial Documents",
  ];
  return [
    "IMM 5476 – Use of a Representative",
    "Passport (bio page + all relevant pages)",
    "Supporting Documents as required",
    "Digital Photograph (IRCC compliant)",
  ];
}

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
    const formTypeFull = getFormTypeFull(formType);
    const passportNo = intake.passportNumber || body.passportNumber || "";
    const uci = intake.uci || body.uci || "";
    const institution = intake.institution || body.institution || "";
    const program = intake.program || body.program || "";
    const arrivalDate = intake.originalEntryDate || body.arrivalDate || "";
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const docs = getDocumentsList(formType);

    // Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // Letter size
    const { width, height } = page.getSize();

    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const dark = rgb(0.1, 0.1, 0.17);
    const grey = rgb(0.4, 0.4, 0.4);
    const lightGrey = rgb(0.6, 0.6, 0.6);
    const black = rgb(0, 0, 0);

    let y = height - 50;
    const leftX = 60;
    const rightX = width - 60;
    const contentWidth = rightX - leftX;
    const charsPerLine = 85;

    const drawLine = (text: string, x: number, yPos: number, size: number, font = fontReg, color = black) => {
      page.drawText(text, { x, y: yPos, size, font, color });
    };

    const drawWrapped = (text: string, x: number, yPos: number, size: number, font = fontReg, color = black, maxChars = charsPerLine): number => {
      const lines = wrapText(text, maxChars);
      let currentY = yPos;
      for (const line of lines) {
        page.drawText(line, { x, y: currentY, size, font, color });
        currentY -= size + 5;
      }
      return currentY;
    };

    // ── HEADER ──
    drawLine("NEWTON IMMIGRATION INC.", leftX + 130, y, 18, fontBold, dark);
    y -= 22;
    drawLine(`${RCIC_NAME}  •  RCIC ${RCIC_NUMBER}  •  Regulated Canadian Immigration Consultant`, leftX + 50, y, 8, fontReg, grey);
    y -= 14;
    drawLine(`${RCIC_ADDRESS}  •  ${RCIC_EMAIL}  •  ${RCIC_PHONE}`, leftX + 70, y, 8, fontReg, grey);
    y -= 10;

    // Horizontal rule
    page.drawLine({ start: { x: leftX, y }, end: { x: rightX, y }, thickness: 2, color: dark });
    y -= 20;

    // Date
    drawLine(today, leftX, y, 10.5, fontReg, black);
    y -= 24;

    // To
    drawLine("To:", leftX, y, 10.5, fontBold, black);
    y -= 16;
    drawLine("Immigration, Refugees and Citizenship Canada (IRCC)", leftX, y, 10.5, fontReg, black);
    y -= 24;

    // Subject
    drawLine(`Re: Support Letter for ${clientName}'s ${formTypeFull} Application`, leftX, y, 10.5, fontBold, black);
    y -= 15;
    if (passportNo) {
      drawLine(`Passport: ${passportNo}${uci ? `  •  UCI: ${uci}` : ""}`, leftX, y, 9, fontReg, grey);
      y -= 20;
    }
    y -= 8;

    // Body
    drawLine("Dear Immigration Officer,", leftX, y, 10.5, fontReg, black);
    y -= 20;

    y = drawWrapped(
      `I am writing in my capacity as a Regulated Canadian Immigration Consultant (RCIC ${RCIC_NUMBER}), authorized member of the College of Immigration and Citizenship Consultants (CICC), on behalf of my client ${clientName}, in support of their application for a ${formTypeFull}.`,
      leftX, y, 10.5, fontReg, black
    );
    y -= 10;

    // Application-specific paragraph
    const ftLower = formType.toLowerCase();
    if (ftLower.includes("pgwp")) {
      y = drawWrapped(
        `${clientName} first entered Canada${arrivalDate ? ` on ${arrivalDate}` : ""} for the purpose of pursuing post-secondary education. They successfully completed their program of study${institution ? ` at ${institution}` : ""}${program ? ` (${program})` : ""} and are now eligible to apply for a Post-Graduation Work Permit under IRCC regulations.`,
        leftX, y, 10.5, fontReg, black
      );
      y -= 10;
      drawLine("My client meets all eligibility requirements for the PGWP, including:", leftX, y, 10.5, fontReg, black);
      y -= 18;
      const points = [
        "Successful completion of an eligible program of study at a PGWP-eligible DLI",
        "Valid study permit at the time of application",
        "Full-time enrollment throughout the program",
        "Meeting the minimum language proficiency requirements",
      ];
      for (const pt of points) {
        y = drawWrapped(`• ${pt}`, leftX + 15, y, 10.5, fontReg, black, charsPerLine - 5);
        y -= 4;
      }
    } else {
      y = drawWrapped(
        `${clientName} is applying for a ${formTypeFull}. As their authorized representative, I have reviewed all documentation and confirm that my client meets all applicable eligibility requirements under the Immigration and Refugee Protection Act (IRPA) and associated regulations.`,
        leftX, y, 10.5, fontReg, black
      );
    }
    y -= 14;

    // Documents
    drawLine("Enclosed Documents:", leftX, y, 10.5, fontBold, black);
    y -= 18;
    docs.forEach((doc, i) => {
      y = drawWrapped(`${i + 1}. ${doc}`, leftX + 15, y, 10.5, fontReg, black, charsPerLine - 5);
      y -= 2;
    });
    y -= 10;

    // Closing
    y = drawWrapped(
      "I respectfully request that this application receive your prompt and favourable consideration. Should you require any additional information or documentation, please do not hesitate to contact our office directly.",
      leftX, y, 10.5, fontReg, black
    );
    y -= 20;

    drawLine("Sincerely,", leftX, y, 10.5, fontReg, black);
    y -= 50; // Signature space

    drawLine(RCIC_NAME, leftX, y, 10.5, fontBold, black);
    y -= 16;
    drawLine(`RCIC ${RCIC_NUMBER}`, leftX, y, 9, fontReg, grey);
    y -= 14;
    drawLine(RCIC_COMPANY, leftX, y, 9, fontReg, grey);
    y -= 14;
    drawLine(RCIC_ADDRESS, leftX, y, 9, fontReg, grey);
    y -= 14;
    drawLine(`${RCIC_EMAIL}  •  ${RCIC_PHONE}`, leftX, y, 9, fontReg, grey);

    // Footer
    y = 40;
    page.drawLine({ start: { x: leftX, y: y + 10 }, end: { x: rightX, y: y + 10 }, thickness: 0.5, color: lightGrey });
    drawLine(`${RCIC_COMPANY}  •  ${RCIC_NAME}, RCIC ${RCIC_NUMBER}  •  ${RCIC_ADDRESS}`, leftX + 30, y, 7, fontReg, lightGrey);
    y -= 11;
    drawLine(`${RCIC_EMAIL}  •  ${RCIC_PHONE}  •  Confidential`, leftX + 120, y, 7, fontReg, lightGrey);

    const pdfBytes = await pdfDoc.save();
    const fileName = `${clientName.replace(/[^a-zA-Z0-9 ]/g, "").trim()}- Representative Letter.pdf`;

    // Try to upload to Drive
    let driveLink = "";
    try {
      const { uploadFileToDriveFolder, extractDriveFolderId, createCaseDriveStructure } = await import("@/lib/google-drive");
      let folderId = extractDriveFolderId(caseItem.docsUploadLink || "");
      if (!folderId) {
        const structure = await createCaseDriveStructure({ clientName, caseId: params.id, companyId });
        folderId = structure.mainFolderId;
      }
      const driveRes = await uploadFileToDriveFolder({ folderId, fileName, mimeType: "application/pdf", buffer: Buffer.from(pdfBytes) });
      driveLink = driveRes.webViewLink || "";
      console.log(`✅ Rep letter uploaded to Drive: ${fileName}`);
    } catch (e) {
      console.error("Drive upload failed (returning PDF directly):", (e as Error).message);
    }

    // Return PDF as download
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
