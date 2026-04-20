import { NextRequest, NextResponse } from "next/server";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";

// Download media from WhatsApp
async function downloadWaMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  try {
    // Get media URL
    const urlRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` }
    });
    const urlData = await urlRes.json() as { url?: string; mime_type?: string };
    if (!urlData.url) return null;

    // Download the file
    const fileRes = await fetch(urlData.url, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` }
    });
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const mimeType = urlData.mime_type || "application/octet-stream";
    // Get proper extension from mime type
    const extMap: Record<string, string> = {
      "application/pdf": ".pdf",
      "image/jpeg": ".jpg", "image/jpg": ".jpg",
      "image/png": ".png",
      "image/heic": ".heic",
      "application/zip": ".zip",
      "application/x-zip-compressed": ".zip",
      "application/msword": ".doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
      "application/vnd.ms-excel": ".xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
      "video/mp4": ".mp4",
      "audio/ogg": ".ogg", "audio/mpeg": ".mp3",
    };
    const ext = extMap[mimeType] || (mimeType.includes("zip") ? ".zip" : mimeType.includes("pdf") ? ".pdf" : mimeType.includes("image") ? ".jpg" : ".bin");
    const filename = `wa_doc_${Date.now()}${ext}`;
    return { buffer, mimeType, filename };
  } catch (e) {
    console.error("Failed to download WA media:", (e as Error).message);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as any;
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return NextResponse.json({ status: "ok" });

    const messages = value?.messages;
    if (!messages?.length) return NextResponse.json({ status: "ok" });

    for (const message of messages) {
      const from = message.from;
      const msgType = message.type; // text, image, document, audio
      const text = message?.text?.body || "";

      const { listCases, addMessage, updateCase, getCase } = await import("@/lib/store");
      const cases = await listCases(COMPANY_ID);
      const n = from.replace(/\D/g, "");

      // Find matching case by phone
      const matched = cases.find((c) => {
        const cp = (c.leadPhone || "").replace(/\D/g, "");
        return cp && (n.endsWith(cp.slice(-9)) || cp.endsWith(n.slice(-9)));
      });

      // Save to inbox
      try {
        const { Pool } = await import("pg");
        const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await pool.query(`CREATE TABLE IF NOT EXISTS whatsapp_inbox (
          id TEXT PRIMARY KEY, phone TEXT NOT NULL, message TEXT NOT NULL,
          direction TEXT NOT NULL DEFAULT 'inbound', matched_case_id TEXT,
          matched_case_name TEXT, is_read BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        const msgId = `WA-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
        const displayMsg = msgType === "text" ? text : `[${msgType} received]`;
        // Auto-unarchive if client messages again after case was archived
        await pool.query(`UPDATE whatsapp_inbox SET is_archived = FALSE WHERE phone = $1 AND is_archived = TRUE`, [from]).catch(() => {});
        await pool.query(
          `INSERT INTO whatsapp_inbox (id, phone, message, direction, matched_case_id, matched_case_name, is_read) VALUES ($1,$2,$3,'inbound',$4,$5,FALSE)`,
          [msgId, from, displayMsg, matched?.id || null, matched?.client || null]
        );
        await pool.end();
      } catch { /* non-fatal */ }

      // Handle document/image uploads → save to Drive
      if (matched && (msgType === "document" || msgType === "image" || msgType === "audio")) {
        const mediaId = message[msgType]?.id;
        const originalFilename = message[msgType]?.filename || message[msgType]?.name || null;
        const mediaCaption = message[msgType]?.caption || originalFilename || message[msgType]?.filename || msgType;

        if (mediaId) {
          console.log(`📎 WA media from ${matched.client}: ${mediaCaption}`);
          try {
            const media = await downloadWaMedia(mediaId);
            if (media) {
              const { putObjectToS3, buildS3ObjectKey, toS3StoredLink, isS3StorageEnabled } = await import("@/lib/object-storage");
              const { uploadFileToDriveFolder, extractDriveFolderId, createCaseDriveStructure } = await import("@/lib/google-drive");
              const { addDocument, updateCasePgwpIntake, updateCaseLinks } = await import("@/lib/store");
              const caseItem = await getCase(COMPANY_ID, matched.id);
              const clientNameClean = String(matched.client || "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
              const ext = (originalFilename || media.filename || "").includes(".")
                ? (originalFilename || media.filename).split(".").pop()
                : media.mimeType.includes("pdf") ? "pdf" : "jpg";

              // ── STEP 1: SAVE TO S3 IMMEDIATELY ──────────────────────────
              let s3Link = "";
              const timestamp = Date.now();
              const s3Key = buildS3ObjectKey({ 
                companyId: COMPANY_ID, 
                caseId: matched.id, 
                fileName: `${timestamp}-${originalFilename || media.filename}` 
              });
              try {
                await putObjectToS3({ key: s3Key, body: media.buffer, contentType: media.mimeType });
                s3Link = toS3StoredLink(s3Key);
                console.log(`✅ S3 saved: ${s3Key}`);
              } catch(e) { console.error("S3 save failed:", e); }

              // ── STEP 2: AI CLASSIFY & EXTRACT DATA ──────────────────────
              let docCategory = "client";
              let properFileName = `${clientNameClean} - Document.${ext}`;
              const isImage = media.mimeType.includes("image");
              const isPdf = media.mimeType.includes("pdf");
              
              try {
                const scanContent: any[] = [];
                if (isImage) {
                  // Images go as image type
                  const safeType = media.mimeType.includes("png") ? "image/png" : media.mimeType.includes("gif") ? "image/gif" : media.mimeType.includes("webp") ? "image/webp" : "image/jpeg";
                  scanContent.push({ type: "image", source: { type: "base64", media_type: safeType, data: media.buffer.toString("base64") } });
                } else if (isPdf) {
                  // PDFs go as document type
                  scanContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: media.buffer.toString("base64") } });
                }
                scanContent.push({ type: "text", text: `Scan this immigration document for client ${matched.client} (${matched.formType}).
Reply ONLY with JSON: {
  "category": "passport|study_permit|work_permit|completion_letter|transcripts|language_test|photo|bank_statement|job_offer|medical|police_clearance|ielts|lmia|eap|copr|other",
  "label": "Short label e.g. Passport, Study Permit, Completion Letter",
  "expiryDate": "YYYY-MM-DD or empty",
  "documentNumber": "number or empty",
  "firstName": "or empty",
  "lastName": "or empty",
  "dateOfBirth": "YYYY-MM-DD or empty",
  "gender": "Male/Female or empty",
  "issuingCountry": "or empty",
  "issueDate": "YYYY-MM-DD or empty",
  "programOrField": "or empty",
  "institutionOrEmployer": "or empty"
}` });

                const classRes = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
                  body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: scanContent }] })
                });

                if (classRes.ok) {
                  const classData = await classRes.json() as any;
                  const parsed = JSON.parse(classData.content?.[0]?.text?.replace(/```json|```/g,"").trim() || "{}");
                  
                  if (parsed.category) docCategory = parsed.category;
                  
                  // Build proper filename: ClientName - DocumentType (exp DATE).ext
                  if (parsed.label) {
                    const expiryPart = parsed.expiryDate ? ` (exp ${parsed.expiryDate})` : "";
                    properFileName = `${clientNameClean} - ${parsed.label}${expiryPart}.${ext}`;
                  }

                  // Save extracted fields to pgwpIntake
                  const fields: Record<string, string> = {};
                  if (parsed.firstName) fields.firstName = parsed.firstName;
                  if (parsed.lastName) fields.lastName = parsed.lastName;
                  if (parsed.dateOfBirth) fields.dateOfBirth = parsed.dateOfBirth;
                  if (parsed.gender) fields.sex = parsed.gender;
                  if (parsed.issuingCountry) fields.citizenship = parsed.issuingCountry;
                  if (parsed.documentNumber) {
                    if (parsed.category === "passport") fields.passportNumber = parsed.documentNumber;
                    else fields.permitDetails = parsed.documentNumber;
                  }
                  if (parsed.expiryDate) {
                    if (parsed.category === "passport") fields.passportExpiryDate = parsed.expiryDate;
                    else if (parsed.category === "study_permit") fields.studyPermitExpiryDate = parsed.expiryDate;
                    else if (parsed.category === "work_permit") fields.workPermitExpiryDate = parsed.expiryDate;
                  }
                  if (parsed.issueDate && parsed.category === "passport") fields.passportIssueDate = parsed.issueDate;
                  if (parsed.programOrField) fields.programOfStudy = parsed.programOrField;
                  if (parsed.institutionOrEmployer) fields.institutionName = parsed.institutionOrEmployer;

                  if (Object.keys(fields).length > 0) {
                    await updateCasePgwpIntake(COMPANY_ID, matched.id, fields as any);
                    console.log(`📋 Extracted ${Object.keys(fields).length} fields from ${parsed.label} for ${matched.client}`);
                  }
                }
              } catch(e) { console.error("AI scan failed (non-fatal):", e); }

              // ── STEP 3: SAVE TO DRIVE WITH PROPER NAME ──────────────────
              let driveLink = "";
              try {
                let driveFolderId = extractDriveFolderId(caseItem?.docsUploadLink || "");
                
                // Auto-create Drive folders if missing
                if (!driveFolderId && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
                  const structure = await createCaseDriveStructure(
                    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
                    `${matched.client} - ${matched.formType}`
                  );
                  driveFolderId = structure.subfolders.clientDocuments.id;
                  await updateCaseLinks(COMPANY_ID, matched.id, {
                    docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
                    applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
                    submittedFolderLink: structure.subfolders.submitted.webViewLink,
                    correspondenceFolderLink: structure.subfolders.correspondence.webViewLink,
                  });
                  console.log(`📁 Auto-created Drive folders for ${matched.client}`);
                }

                if (driveFolderId) {
                  const driveRes = await uploadFileToDriveFolder({
                    folderId: driveFolderId,
                    fileName: properFileName,
                    fileBuffer: media.buffer,
                    mimeType: media.mimeType
                  });
                  driveLink = driveRes.webViewLink || "";
                  console.log(`✅ Drive saved: ${properFileName}`);
                }
              } catch(e) { console.error("Drive save failed (non-fatal):", e); }

              // ── STEP 4: SAVE DOCUMENT RECORD IN CRM ─────────────────────
              const finalLink = driveLink || s3Link || `wa://media/${mediaId}`;
              await addDocument({
                companyId: COMPANY_ID,
                caseId: matched.id,
                name: properFileName,
                category: docCategory,
                uploadedBy: matched.client || "Client (WhatsApp)",
                status: "received",
                link: finalLink
              });

              // ── STEP 5: SEND SMART ACKNOWLEDGMENT ───────────────────────
              const { sendWhatsAppText } = await import("@/lib/whatsapp");
              const firstName = String(matched.client || "").split(" ")[0];
              const docLabel = properFileName.split(" - ")[1]?.replace(/\.[^.]+$/, "").replace(/ \(exp.*\)/, "") || "document";
              let ackMsg = `✅ ${firstName}, I've saved your *${docLabel}* to your file.`;
              if (docCategory === "passport") ackMsg += `\n\n📘 Passport details have been recorded automatically.`;
              else if (docCategory === "study_permit" || docCategory === "work_permit") ackMsg += `\n\n📋 Permit details have been noted.`;
              else if (docCategory === "completion_letter") ackMsg += `\n\n🎓 Completion letter received!`;
              else if (docCategory === "transcripts") ackMsg += `\n\n📚 Transcripts received!`;
              else if (docCategory === "language_test" || docCategory === "ielts") ackMsg += `\n\n📝 Language test result saved!`;
              ackMsg += `\n\n— Newton Immigration Team 🍁`;
              await sendWhatsAppText(from, ackMsg);

              // ── STEP 6: AUTO-GENERATE PDF IF PASSPORT RECEIVED ──────────
              if (docCategory === "passport") {
                const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "";
                if (baseUrl) {
                  fetch(`${baseUrl}/api/cases/${matched.id}/generate-forms`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ systemToken: process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024" })
                  }).then(r => r.json()).then(d => {
                    console.log(`📄 Auto PDF after passport for ${matched.id}:`, d.generated);
                  }).catch(e => console.error("Auto PDF failed:", e));
                }
              }
            }
          } catch(e) {
            console.error("Media upload error:", (e as Error).message);
          }
        }
      }

      // Handle text messages — intake flow or general message notification
      // Also handle images/documents during intake (send next question after saving doc)
      if (msgType === "image" || msgType === "document") {
        try {
          const intakeMod = await import("@/lib/whatsapp-ai-intake");
          const session = await intakeMod.getActiveSession(from, COMPANY_ID);
          const skipFormTypes = ["college change", "college transfer"];
          const matchedFormType = String(matched?.formType || "").toLowerCase();
          const skipIntake = skipFormTypes.some(t => matchedFormType.includes(t));
          if (session && session.phase === "ai_chat" && !skipIntake) {
            // Acknowledge doc and send next question
            await intakeMod.handleIncomingReply({ phone: from, message: "[document received]", companyId: COMPANY_ID });
          }
        } catch(e) { console.error("Intake image handler error:", e); }
      }

      if (msgType === "text" && text) {
        let handledByIntake = false;
        try {
          const intakeMod = await import("@/lib/whatsapp-ai-intake");
          const session = await intakeMod.getActiveSession(from, COMPANY_ID);
          console.log(`🔍 Session lookup for ${from}: ${session ? `FOUND phase=${session.phase}` : "NOT FOUND"}`);
          
          // Skip intake for College Change / Study Permit Extension cases
          const skipFormTypes = ["college change", "college transfer"];
          const matchedFormType = String(matched?.formType || "").toLowerCase();
          const skipIntake = skipFormTypes.some(t => matchedFormType.includes(t));
          
          if (session && !skipIntake) {
            await intakeMod.handleIncomingReply({ phone: from, message: text, companyId: COMPANY_ID });
            handledByIntake = true;
          } else if (session && skipIntake) {
            console.log(`⏭️ Skipping intake for ${matched?.formType} — forwarding to team`);
          }
        } catch (e) {
          console.error("Intake handler error:", (e as Error).message);
        }

        // Handle UNKNOWN numbers — auto detect name + case status
        if (!handledByIntake && !matched) {
          try {
            const { sendWhatsAppText } = await import("@/lib/whatsapp");
            const { Pool } = await import("pg");
            const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

            // Check if we already know their name from previous messages
            const prevMsg = await pool.query(
              `SELECT matched_case_name FROM whatsapp_inbox WHERE phone = $1 AND matched_case_name IS NOT NULL LIMIT 1`,
              [from]
            );
            const knownName = prevMsg.rows[0]?.matched_case_name || "";

            // Use Claude to extract name and intent from message
            const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 300,
                messages: [{ role: "user", content: `Extract info from this WhatsApp message to Newton Immigration:
Message: "${text}"
Known name: "${knownName}"

Reply ONLY with JSON:
{
  "name": "full name if mentioned or known name",
  "isAskingForUpdate": true/false,
  "isGreeting": true/false,
  "intent": "brief description of what they want"
}` }]
              })
            });

            let extracted = { name: knownName, isAskingForUpdate: false, isGreeting: false, intent: "" };
            if (aiRes.ok) {
              const aiData = await aiRes.json() as any;
              try { extracted = JSON.parse(aiData.content?.[0]?.text?.replace(/```json|```/g,"").trim() || "{}"); } catch {}
            }

            // Save name if detected
            if (extracted.name && extracted.name !== knownName) {
              await pool.query(`UPDATE whatsapp_inbox SET matched_case_name = $1 WHERE phone = $2`, [extracted.name, from]);
            }

            // Search for their case
            const casesData = await listCases(COMPANY_ID);
            const foundCase = extracted.name ? casesData.find((c: any) => {
              const clientName = String(c.client || "").toLowerCase();
              const searchName = String(extracted.name || "").toLowerCase();
              return clientName.includes(searchName.split(" ")[0]) || searchName.includes(clientName.split(" ")[0]);
            }) : null;

            if (foundCase) {
              // Link phone to case
              const { updateCase } = await import("@/lib/store");
              await updateCase(COMPANY_ID, foundCase.id, { leadPhone: from });

              // Reply with case status
              const firstName = String(foundCase.client || "").split(" ")[0];
              const status = foundCase.processingStatus || "in progress";
              const statusMap: Record<string, string> = {
                "docs_pending": "we are waiting for your documents",
                "under_review": "your application is under review by our team",
                "submitted": "your application has been submitted to IRCC",
                "approved": "your application has been approved! 🎉",
                "refused": "unfortunately your application was not approved"
              };
              const statusMsg = statusMap[status] || `status: ${status}`;
              await sendWhatsAppText(from, `Hello ${firstName}! 🍁

We found your file at Newton Immigration.

Your *${foundCase.formType}* application — ${statusMsg}.

If you have any questions, our team will be in touch shortly.

— Newton Immigration Team`);
              console.log(`✅ Auto-replied to unknown number with case status: ${foundCase.client}`);
            } else if (extracted.isAskingForUpdate) {
              // They want an update but we can't find their case
              const name = extracted.name || "there";
              await sendWhatsAppText(from, `Hello ${name}! 🍁

Thank you for reaching out to Newton Immigration.

We couldn't find your file with this number. Could you please share:
1. Your full name
2. Your application type (work permit, study permit, etc.)

Our team will look into your file and get back to you shortly!

— Newton Immigration Team`);
            } else if (extracted.isGreeting || text.length < 20) {
              // Simple greeting
              await sendWhatsAppText(from, `Hello! 🍁 Welcome to Newton Immigration.

How can we help you today? Please share your name and query and our team will assist you.

— Newton Immigration Team`);
            }

            await pool.end();
          } catch(e) { console.error("Unknown number handler error:", e); }
        }

        // If not an intake reply — it's a general client question, notify team
        if (!handledByIntake && matched) {
          try {
            const { readStore, writeStore } = await import("@/lib/store");
            const store = await readStore();

            // Find assigned staff user
            const assignedName = matched.assignedTo || "";
            const staffUser = store.users?.find((u: any) =>
              String(u.name || "").toLowerCase() === assignedName.toLowerCase() &&
              u.companyId === COMPANY_ID
            );

            // Create notification for assigned staff (or all admins if unassigned)
            const targets = staffUser
              ? [staffUser]
              : (store.users || []).filter((u: any) => u.companyId === COMPANY_ID && ["Admin", "ProcessingLead"].includes(u.role));

            for (const target of targets.slice(0, 3)) {
              const notice = {
                id: `NTF-WA-${Date.now()}-${target.id}`,
                companyId: COMPANY_ID,
                userId: target.id,
                type: "ai_alert" as const,
                message: `💬 ${matched.client} sent a message: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}" — Please reply`,
                caseId: matched.id,
                read: false,
                createdAt: new Date().toISOString()
              };
              if (!store.notifications) store.notifications = [];
              store.notifications.unshift(notice);
            }
            await writeStore(store);
            console.log(`🔔 Notified team about message from ${matched.client}`);
          } catch (e) {
            console.error("Team notification error:", (e as Error).message);
          }

          // Smart AI auto-reply for client messages
          try {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://junglecrm-builder-web-production-d358.up.railway.app";
            const aiRes = await fetch(`${appUrl}/api/ai-reply`, {
              method: "POST",
              headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01"
      },
              body: JSON.stringify({
                phone: from,
                message: text,
                caseId: matched.id,
                action: "send",
                systemToken: process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024"
              })
            });
            if (aiRes.ok) {
              console.log(`🤖 AI smart reply sent to ${matched.client}`);
              // Notify staff that bot handled this — no action needed
              try {
                const { readStore, writeStore, addNotification } = await import("@/lib/store");
                const store = await readStore();
                const admins = (store.users || []).filter((u: any) => 
                  u.companyId === COMPANY_ID && ["Admin", "ProcessingLead", "Processing"].includes(u.role)
                );
                for (const admin of admins.slice(0, 3)) {
                  await addNotification({
                    companyId: COMPANY_ID,
                    userId: admin.id,
                    type: "ai_alert",
                    message: `🤖 Newton AI replied to ${matched.client}: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}" — No action needed`,
                    caseId: matched.id
                  });
                }
                // Mark inbound messages as read so "Needs reply" goes away
                const { Pool } = await import("pg");
                const pool3 = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
                await pool3.query(
                  `UPDATE whatsapp_inbox SET is_read = TRUE WHERE phone LIKE $1 AND direction = 'inbound'`,
                  [`%${from.slice(-9)}`]
                );
                await pool3.end();
              } catch(e) { console.error("Bot notification failed:", e); }
            } else {
              console.error(`🤖 AI reply failed: ${aiRes.status}`);
            }
          } catch (e) {
            console.error("AI auto-reply failed (non-fatal):", e);
          }
        }
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error("WA webhook error:", (e as Error).message);
    return NextResponse.json({ status: "ok" });
  }
}
