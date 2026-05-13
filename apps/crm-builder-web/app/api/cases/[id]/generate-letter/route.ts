import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase } from "@/lib/store";
import path from "path";
import fs from "fs";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUserFromRequest(request).catch(() => null);
    const body = await request.json().catch(() => ({}));
    if (!user && !isValidSystemToken(body.systemToken)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const companyId = user?.companyId || "newton";
    const caseItem = await getCase(companyId, params.id);
    if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

    const intake = (caseItem.pgwpIntake || {}) as Record<string, string>;
    const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Vancouver", year: "numeric", month: "long", day: "numeric" });
    const clientName = caseItem.client || "Client";
    const formType = caseItem.formType || "Immigration Application";
    const passportNumber = intake.passportNumber || "[Passport Number]";
    const entryDate = intake.originalEntryDate || "[Entry Date]";
    const program = intake.programOfStudy || "[Program]";
    const institution = intake.institutionName || "[Institution]";
    const permitExpiry = intake.studyPermitExpiryDate || intake.workPermitExpiryDate || (caseItem as any).permitExpiryDate || "[Permit Expiry]";
    const ieltsScore = intake.englishTestTaken || "[IELTS Score]";

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{ role: "user", content: `Write a Representative Submission Letter body for Newton Immigration.
Client: ${clientName}, Form: ${formType}, Passport: ${passportNumber}, Entry: ${entryDate}, Program: ${program}, Institution: ${institution}, Permit Expiry: ${permitExpiry}, IELTS: ${ieltsScore}, Date: ${today}
Write professional letter body paragraphs with sections appropriate for ${formType}. Use **text** for bold. Include Supporting Documents list and Request for Consideration. No header or signature needed.` }]
      })
    });

    let letterContent = "Letter content could not be generated. Please fill in manually.";
    if (aiRes.ok) {
      const aiData = await aiRes.json() as any;
      letterContent = aiData.content?.[0]?.text || letterContent;
    }

    const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, Header, BorderStyle, TabStopType } = await import("docx");
    const logoPath = path.join(process.cwd(), "public", "newton_logo.png");
    const logoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;
    const RED = "C0392B"; const BLACK = "1a1a1a";

    function makeRuns(text: string): TextRun[] {
      return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
        new TextRun({ text: part, bold: i % 2 === 1, size: 22, color: BLACK, font: "Arial" })
      );
    }
    function makePara(text: string) {
      return new Paragraph({ children: makeRuns(text), spacing: { after: 160 } });
    }
    function makeHeading(text: string) {
      return new Paragraph({
        children: [new TextRun({ text: text.replace(/\*\*/g, ""), bold: true, size: 22, color: BLACK, font: "Arial" })],
        spacing: { before: 200, after: 100 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } }
      });
    }

    const contentParas: Paragraph[] = [];
    for (const line of letterContent.split("\n")) {
      if (!line.trim()) { contentParas.push(new Paragraph({ children: [], spacing: { after: 80 } })); }
      else if (line.match(/^#{1,3}\s/) || (line.length < 70 && !line.includes(".") && line === line.replace(/\*\*/g, "") )) { contentParas.push(makeHeading(line.replace(/^#+\s*/, ""))); }
      else if (line.match(/^[●•\-]\s/)) { contentParas.push(new Paragraph({ children: makeRuns(line.replace(/^[●•\-]\s*/, "")), spacing: { after: 80 }, indent: { left: 360 } })); }
      else { contentParas.push(makePara(line)); }
    }

    const headerParas: Paragraph[] = [];
    if (logoBuffer) {
      headerParas.push(new Paragraph({
        children: [
          new ImageRun({ data: logoBuffer, transformation: { width: 180, height: 70 }, type: "png" }),
          new TextRun({ text: "\t", font: "Arial" }),
          new TextRun({ text: "+1-778-723-6662  |  newtonimmigration@gmail.com  |  www.newtonimmigration.com", size: 16, color: RED, font: "Arial" }),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RED, space: 4 } },
        spacing: { after: 200 }
      }));
    }

    const doc = new Document({
      sections: [{
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 720, right: 1080, bottom: 1080, left: 1080 } } },
        headers: { default: new Header({ children: headerParas }) },
        children: [
          new Paragraph({ children: [new TextRun({ text: "REPRESENTATIVE'S SUBMISSION LETTER", bold: true, size: 26, color: BLACK, font: "Arial" })], alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
          new Paragraph({ children: [new TextRun({ text: today, bold: true, size: 22, font: "Arial" })], spacing: { after: 160 } }),
          new Paragraph({ children: [new TextRun({ text: "Immigration, Refugees and Citizenship Canada (IRCC)", bold: true, size: 22, font: "Arial" })], spacing: { after: 160 } }),
          new Paragraph({ children: [], spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: "Subject: ", bold: true, size: 22, font: "Arial" }), new TextRun({ text: `Support Letter for ${formType} Application – ${clientName}`, bold: true, size: 22, font: "Arial" })], spacing: { after: 160 } }),
          new Paragraph({ children: [], spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: "To Whom It May Concern,", bold: true, size: 22, font: "Arial" })], spacing: { after: 160 } }),
          new Paragraph({ children: [], spacing: { after: 80 } }),
          ...contentParas,
          new Paragraph({ children: [], spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: "Yours sincerely,", bold: true, size: 22, font: "Arial" })], spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: "NEWTON IMMIGRATION INC.", bold: true, size: 22, font: "Arial" })], spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: "Navdeep Singh Sandhu, RCIC (R705964)", bold: true, size: 22, font: "Arial" })], spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: "📧 newtonimmigration@gmail.com  |  📞 +1 778-723-6662  |  📍 8327 120 Street, Delta, BC, V4C 6R1, Canada", size: 20, font: "Arial" })], spacing: { after: 80 } }),
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const fileName = `${clientName.replace(/[^a-z0-9]/gi, "_")}_Rep_Letter.docx`;
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${fileName}"` }
    });
  } catch (e) {
    console.error("Letter generation error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
