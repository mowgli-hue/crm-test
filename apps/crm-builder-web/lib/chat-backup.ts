/**
 * Chat backup to Drive
 * ====================
 *
 * When a WhatsApp intake completes (or any other trigger), this module
 * exports the entire client conversation as a Newton-branded PDF and
 * uploads it to the case's Google Drive folder.
 *
 * This is the bulletproof safety net: even if the CRM database is wiped
 * or a code bug eats `pgwpIntake`, the conversation itself is permanently
 * archived in Drive, alongside the client's other documents.
 *
 * Trigger points (called from):
 *   - lib/store.ts → updateCasePgwpIntake (when whatsappIntakePhase becomes 'complete')
 *
 * The export is fire-and-forget: errors are logged but never block the
 * caller. If Drive upload fails, the function still tries to record the
 * PDF on the case's documents list with a fallback link.
 */

import { Pool } from "pg";
import { getCase, addDocument } from "@/lib/store";
import { uploadFileToDriveFolder, extractDriveFolderId, createCaseDriveStructure, getOrCreateDriveSubfolder } from "@/lib/google-drive";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

interface InboxRow {
  id: string;
  phone: string;
  message: string;
  direction: "inbound" | "outbound";
  matched_case_id: string | null;
  matched_case_name: string | null;
  is_read: boolean;
  created_at: string;
}

/**
 * Build a PDF of the WhatsApp conversation between Newton and the client.
 * Returns the PDF bytes — caller is responsible for uploading or returning.
 */
export async function buildChatPdf(opts: {
  caseId: string;
  clientName: string;
  phone: string;
  formType: string;
  messages: InboxRow[];
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Page setup — US Letter
  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN_X = 48;
  const MARGIN_Y_TOP = 72;
  const MARGIN_Y_BOT = 56;
  const NEWTON_BLUE = rgb(0.122, 0.306, 0.475);
  const TEXT_BLACK = rgb(0.06, 0.06, 0.06);
  const TEXT_GREY = rgb(0.45, 0.45, 0.45);
  const BG_INBOUND = rgb(0.96, 0.96, 0.96);  // light grey — client messages
  const BG_OUTBOUND = rgb(0.86, 0.94, 1.0);  // light blue — Newton messages

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let pageNum = 1;
  let y = PAGE_H - MARGIN_Y_TOP;

  // Header on every page
  const drawHeader = (p: typeof page) => {
    p.drawText("NEWTON IMMIGRATION INC.", {
      x: MARGIN_X, y: PAGE_H - 36, size: 11, font: fontBold, color: NEWTON_BLUE
    });
    p.drawText("Client WhatsApp Conversation Archive", {
      x: MARGIN_X, y: PAGE_H - 50, size: 9, font: fontItalic, color: TEXT_GREY
    });
    // Right-aligned page label
    const label = `${opts.clientName} • ${opts.caseId}`;
    const w = fontReg.widthOfTextAtSize(label, 9);
    p.drawText(label, { x: PAGE_W - MARGIN_X - w, y: PAGE_H - 36, size: 9, font: fontReg, color: TEXT_GREY });
    // Divider
    p.drawLine({
      start: { x: MARGIN_X, y: PAGE_H - 60 },
      end:   { x: PAGE_W - MARGIN_X, y: PAGE_H - 60 },
      thickness: 1, color: NEWTON_BLUE,
    });
  };

  const drawFooter = (p: typeof page, n: number) => {
    const s = `Page ${n}`;
    const w = fontReg.widthOfTextAtSize(s, 8);
    p.drawText(s, { x: (PAGE_W - w) / 2, y: 28, size: 8, font: fontReg, color: TEXT_GREY });
    p.drawText("Newton Immigration Inc.  |  17282 59A Avenue, Surrey, BC V3S 5S5  |  +1 778.723.6662", {
      x: MARGIN_X, y: 16, size: 7, font: fontItalic, color: TEXT_GREY
    });
  };

  drawHeader(page);

  // Cover info block
  y = PAGE_H - 88;
  page.drawText("CONVERSATION ARCHIVE", { x: MARGIN_X, y, size: 14, font: fontBold, color: NEWTON_BLUE });
  y -= 20;
  const meta = [
    ["Client",        opts.clientName],
    ["Phone",         opts.phone],
    ["Case ID",       opts.caseId],
    ["Application",   opts.formType],
    ["Messages",      String(opts.messages.length)],
    ["Generated",     new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC"],
  ];
  for (const [k, v] of meta) {
    page.drawText(`${k}:`, { x: MARGIN_X, y, size: 10, font: fontBold, color: TEXT_BLACK });
    page.drawText(v, { x: MARGIN_X + 80, y, size: 10, font: fontReg, color: TEXT_BLACK });
    y -= 14;
  }
  y -= 8;
  // Section divider
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.5, color: TEXT_GREY });
  y -= 16;

  // Helpers — wrap text into lines that fit `maxWidth` chars at the given font/size
  const wrap = (text: string, font: typeof fontReg, size: number, maxWidth: number): string[] => {
    const lines: string[] = [];
    const sourceLines = text.split("\n");
    for (const sourceLine of sourceLines) {
      if (!sourceLine.trim()) { lines.push(""); continue; }
      const words = sourceLine.split(" ");
      let current = "";
      for (const word of words) {
        const next = current ? current + " " + word : word;
        const w = font.widthOfTextAtSize(next, size);
        if (w > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = next;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  };

  // Format date — "Apr 16, 2026 06:53"
  const fmtDate = (iso: string): string => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-CA", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false
    });
  };

  let lastDay: string | null = null;

  for (let i = 0; i < opts.messages.length; i++) {
    const m = opts.messages[i];
    const dayKey = m.created_at.slice(0, 10);

    // Day separator
    if (dayKey !== lastDay) {
      const need = 32;
      if (y - need < MARGIN_Y_BOT) {
        drawFooter(page, pageNum);
        page = pdfDoc.addPage([PAGE_W, PAGE_H]); pageNum++;
        drawHeader(page);
        y = PAGE_H - MARGIN_Y_TOP - 10;
      }
      const dateLabel = new Date(m.created_at).toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const wDate = fontBold.widthOfTextAtSize(dateLabel, 9);
      page.drawText(dateLabel, { x: (PAGE_W - wDate) / 2, y: y - 4, size: 9, font: fontBold, color: NEWTON_BLUE });
      page.drawLine({ start: { x: MARGIN_X, y: y - 8 }, end: { x: (PAGE_W - wDate) / 2 - 8, y: y - 8 }, thickness: 0.4, color: TEXT_GREY });
      page.drawLine({ start: { x: (PAGE_W + wDate) / 2 + 8, y: y - 8 }, end: { x: PAGE_W - MARGIN_X, y: y - 8 }, thickness: 0.4, color: TEXT_GREY });
      y -= 26;
      lastDay = dayKey;
    }

    const inbound = m.direction === "inbound";
    const bubbleMaxW = (PAGE_W - MARGIN_X * 2) * 0.70;  // 70% of content width
    const textMaxW = bubbleMaxW - 16;  // 8pt padding each side
    const lines = wrap(m.message, fontReg, 9.5, textMaxW);

    // Bubble height
    const lineH = 12;
    const bubbleH = lines.length * lineH + 22;  // top header + content + bottom padding
    // Page break check
    if (y - bubbleH < MARGIN_Y_BOT) {
      drawFooter(page, pageNum);
      page = pdfDoc.addPage([PAGE_W, PAGE_H]); pageNum++;
      drawHeader(page);
      y = PAGE_H - MARGIN_Y_TOP - 10;
    }

    // Compute bubble width (longest line + padding)
    let bubbleW = 60;
    for (const line of lines) {
      const w = fontReg.widthOfTextAtSize(line, 9.5);
      if (w + 16 > bubbleW) bubbleW = w + 16;
    }
    if (bubbleW > bubbleMaxW) bubbleW = bubbleMaxW;

    // Position bubble — inbound left, outbound right
    const bubbleX = inbound ? MARGIN_X : PAGE_W - MARGIN_X - bubbleW;
    const bubbleY = y - bubbleH;

    // Draw bubble background
    page.drawRectangle({
      x: bubbleX, y: bubbleY,
      width: bubbleW, height: bubbleH,
      color: inbound ? BG_INBOUND : BG_OUTBOUND,
      borderColor: inbound ? rgb(0.85, 0.85, 0.85) : rgb(0.7, 0.85, 0.95),
      borderWidth: 0.4,
    });

    // Draw "from" label inside bubble top
    const fromLabel = inbound ? `${opts.clientName.split(" ")[0]} (Client)` : "Newton";
    const timeLabel = fmtDate(m.created_at).split(" ").slice(-1)[0];  // just HH:MM
    page.drawText(fromLabel, {
      x: bubbleX + 8, y: bubbleY + bubbleH - 12,
      size: 7.5, font: fontBold, color: inbound ? rgb(0.4, 0.4, 0.4) : NEWTON_BLUE,
    });
    const wTime = fontReg.widthOfTextAtSize(timeLabel, 7.5);
    page.drawText(timeLabel, {
      x: bubbleX + bubbleW - 8 - wTime, y: bubbleY + bubbleH - 12,
      size: 7.5, font: fontReg, color: TEXT_GREY,
    });

    // Draw message lines
    let textY = bubbleY + bubbleH - 22;
    for (const line of lines) {
      page.drawText(line, {
        x: bubbleX + 8, y: textY,
        size: 9.5, font: fontReg, color: TEXT_BLACK,
      });
      textY -= lineH;
    }

    y = bubbleY - 6;
  }

  // Footer on last page
  drawFooter(page, pageNum);

  return await pdfDoc.save();
}

/**
 * Pull all WhatsApp messages for a given phone number from the inbox table.
 */
export async function getInboxMessagesForPhone(phone: string): Promise<InboxRow[]> {
  if (!process.env.DATABASE_URL) return [];
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    // Match phone with various formattings (with/without +, country code, etc.)
    const cleanPhone = phone.replace(/\D/g, "");
    const last9 = cleanPhone.slice(-9);
    const res = await pool.query(
      `SELECT id, phone, message, direction, matched_case_id, matched_case_name,
              is_read, created_at
       FROM whatsapp_inbox
       WHERE phone = $1 OR phone LIKE $2 OR phone LIKE $3
       ORDER BY created_at ASC`,
      [phone, `%${last9}`, `%${cleanPhone}`]
    );
    return res.rows.map((r: any) => ({
      ...r,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    }));
  } finally {
    await pool.end().catch(() => {});
  }
}

/**
 * Main entry point — backs up a case's WhatsApp chat to Drive.
 * Called by store.ts when intake completes. Errors logged, never thrown.
 */
export async function backupChatToDrive(companyId: string, caseId: string): Promise<{ ok: boolean; driveLink?: string; error?: string }> {
  try {
    const caseItem = await getCase(companyId, caseId);
    if (!caseItem) return { ok: false, error: "Case not found" };

    // Identify phone — try several possible fields
    let phone = caseItem.leadPhone || (caseItem as any).phone || "";

    // Fallback: extract from intake session metadata
    if (!phone) {
      const session = (caseItem.pgwpIntake as Record<string, unknown> | undefined)?.whatsappSession;
      if (typeof session === "string") {
        try {
          const parsed = JSON.parse(session);
          if (parsed?.phone) phone = parsed.phone;
        } catch { /* not JSON */ }
      }
    }

    if (!phone) {
      return { ok: false, error: "No phone number found on case" };
    }
    return backupChatToDriveWithPhone(companyId, caseItem, phone);
  } catch (e: any) {
    console.error("[chat-backup] Unexpected error:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

async function backupChatToDriveWithPhone(companyId: string, caseItem: any, phone: string) {
  const messages = await getInboxMessagesForPhone(phone);
  if (messages.length === 0) {
    return { ok: false, error: "No messages found for phone " + phone };
  }

  const clientName = caseItem.client || caseItem.clientName || "Client";
  const formType = caseItem.formType || "Application";

  // Build the PDF
  const pdfBytes = await buildChatPdf({
    caseId: caseItem.id,
    clientName,
    phone,
    formType,
    messages,
  });

  const safeName = String(clientName).replace(/[^a-zA-Z0-9 ]/g, "").trim() || "Client";
  const today = new Date().toISOString().slice(0, 10);
  const fileName = `${safeName} - WhatsApp Chat (${today}).pdf`;

  // Determine Drive folder for this case
  let folderId: string | null = null;
  try {
    folderId = extractDriveFolderId(caseItem.docsUploadLink || "");
    if (!folderId) {
      const structure = await createCaseDriveStructure({ clientName, caseId: caseItem.id, companyId });
      folderId = structure.mainFolderId;
    }
    // Place chat backup inside a "Chat Archive" subfolder for cleanliness
    const subfolder = await getOrCreateDriveSubfolder(folderId, "Chat Archive");
    folderId = subfolder.id;
  } catch (e: any) {
    console.warn("[chat-backup] Could not resolve Drive folder:", e?.message || e);
  }

  let driveLink = "";
  if (folderId) {
    try {
      const driveRes = await uploadFileToDriveFolder({
        folderId,
        fileName,
        mimeType: "application/pdf",
        fileBuffer: Buffer.from(pdfBytes),
      });
      driveLink = driveRes.webViewLink || "";
      console.log(`[chat-backup] ✅ ${caseItem.id}: ${fileName} uploaded to Drive`);
    } catch (e: any) {
      console.error("[chat-backup] Drive upload failed:", e?.message || e);
    }
  }

  // Record the document on the case (regardless of Drive success)
  try {
    await addDocument({
      companyId,
      caseId: caseItem.id,
      name: fileName,
      category: "client",
      uploadedBy: "Auto Chat Backup",
      status: "received",
      link: driveLink,
    });
  } catch (e: any) {
    console.warn("[chat-backup] Could not record document:", e?.message || e);
  }

  return { ok: true, driveLink };
}
