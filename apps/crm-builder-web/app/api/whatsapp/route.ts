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

    // Route marketing number to marketing webhook handler
    const incomingPhoneId = value?.metadata?.phone_number_id;
    const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "1047138985153613";
    if (incomingPhoneId === MARKETING_PHONE_ID) {
      try {
        const baseUrl = process.env.NEXTAUTH_URL || "https://junglecrm-builder-web-production-d358.up.railway.app";
        await fetch(`${baseUrl}/api/marketing-whatsapp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
      } catch(e) { console.error("Marketing forward failed:", e); }
      return NextResponse.json({ status: "ok" });
    }

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
        // For docs/images/audio, save a placeholder that will be UPDATED later
        // (after the file uploads to S3). Format: `[doc:msgId|kind=image|pending=1]`
        // The frontend renders this as "📎 (uploading...)" until the row updates.
        const docKind = msgType === "image" ? "image" : msgType === "audio" ? "audio" : "document";
        const docCaption = String(message[msgType]?.caption || message[msgType]?.filename || message[msgType]?.name || "").trim();
        const captionPart = docCaption ? `|caption=${encodeURIComponent(docCaption)}` : "";
        const displayMsg = msgType === "text"
          ? text
          : `[doc:${msgId}|kind=${docKind}|pending=1${captionPart}]`;
        // ─── Normalize phone before insert ───
        // Meta sometimes sends the same contact under two formats:
        //   "12364120016" (with country code) and "2364120016" (without).
        // We canonicalize to "1" + last 10 digits for North American numbers
        // so all messages from the same contact land in ONE thread.
        // Non-NA numbers: keep digits-only as-is.
        const digits = String(from || "").replace(/\D/g, "");
        const normalizedFrom = (digits.length === 10)
          ? `1${digits}`                 // bare 10-digit NA number → prepend "1"
          : digits.length === 11 && digits.startsWith("1")
            ? digits                     // already in 1XXXXXXXXXX form
            : digits;                    // other lengths/countries: keep as-is
        // Auto-unarchive if client messages again after case was archived.
        // Match across phone-format variants by last 10 digits to be robust
        // against the same client messaging from a differently-formatted number.
        await pool.query(
          `UPDATE whatsapp_inbox SET is_archived = FALSE
           WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = $1
             AND is_archived = TRUE`,
          [digits.slice(-10)]
        ).catch(() => {});
        await pool.query(
          `INSERT INTO whatsapp_inbox (id, phone, message, direction, matched_case_id, matched_case_name, is_read) VALUES ($1,$2,$3,'inbound',$4,$5,FALSE)`,
          [msgId, normalizedFrom, displayMsg, matched?.id || null, matched?.client || null]
        );
        await pool.end();
      } catch { /* non-fatal */ }

      // ── Greeting short-circuit ──
      //
      // Pure greetings ("Hi", "Hello", "Sat sri akal", emoji wave, etc.) should
      // get a friendly conversational reply — NOT trigger the intake bot's full
      // document checklist. Bombarding people with 12-doc lists when they just
      // said "hi" is overwhelming and feels robotic.
      //
      // We catch this BEFORE matched-case logic so it short-circuits both:
      //   - matched cases (don't auto-blast intake checklist on a "hi")
      //   - unknown numbers (don't fall to default welcome flow)
      //
      // After greeting reply, we STOP processing this message. When the client
      // replies with an actual question or request ("I need PR sponsorship"),
      // that goes through the normal flow — intake bot triggers, AI auto-reply
      // works, etc.
      //
      // Skip greeting handling for:
      //   - Non-text messages (docs, images — never just "hello" anyway)
      //   - Staff numbers (their "hi" is internal, no auto-reply needed)
      //   - When a greeting has already been auto-replied to in last 60 minutes
      //     (don't loop on someone repeatedly saying "hi")
      if (msgType === "text" && text) {
        const STAFF_PHONES = ["16046535031","17789828954","17787236662"];
        const isStaffNumber = STAFF_PHONES.some(p => from.includes(p.slice(-9)));

        // Greeting detection — fast regex, no LLM cost. Catches English,
        // Punjabi (romanized + Gurmukhi), common emoji greetings.
        const trimmed = text.trim().toLowerCase();
        const greetingPatterns = [
          /^(hi|hii+|hey+|hello+|helo+|yo)\b[!\s.,]*$/i,
          /^(hi|hello|hey)\s+(there|team|sir|madam|ji)?\s*[!\s.,]*$/i,
          /^(good\s+)?(morning|afternoon|evening|night)\s*[!\s.,]*$/i,
          /^(sat\s*sri\s*akal|sasriakal|namaste|namaskar|salaam|salam|assalam|adaab)\s*[!\s.,]*(ji)?\s*$/i,
          /^(ਸਤ\s*ਸ੍ਰੀ\s*ਅਕਾਲ|ਨਮਸਕਾਰ|ਸਲਾਮ).*$/,
          /^(👋|🙏|🙋‍?♂?♀?|✋)\s*$/,
          /^(how\s+(are\s+)?you|how\s*r\s*u|hru|kiddan|ki\s+haal)\s*[?!\s.,]*$/i,
        ];
        const isGreeting = greetingPatterns.some((re) => re.test(trimmed)) && trimmed.length <= 40;

        if (isGreeting && !isStaffNumber) {
          // Check we haven't auto-greeted this number in the last 60 min
          // (avoid greeting loops if they keep typing "hi", "hi", "hi")
          let recentlyGreeted = false;
          try {
            const { Pool } = await import("pg");
            const checkPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
            const last10check = String(from).replace(/\D/g, "").slice(-10);
            const recent = await checkPool.query(
              `SELECT 1 FROM whatsapp_inbox
               WHERE direction = 'outbound'
                 AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = $1
                 AND created_at > NOW() - INTERVAL '60 minutes'
                 AND id LIKE 'WA-GREET-%'
               LIMIT 1`,
              [last10check]
            );
            recentlyGreeted = recent.rows.length > 0;
            await checkPool.end();
          } catch { /* non-fatal — proceed assuming not greeted */ }

          if (!recentlyGreeted) {
            // Generate a friendly, natural reply via Claude. Falls back to a
            // safe template if the API call fails.
            let greetingReply = "Hi! 👋 How can we help you today? Are you looking for help with a study permit, work permit, PR, or something else?";

            try {
              const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
              if (apiKey) {
                const knownClient = matched?.client ? `The client's name is ${matched.client}.` : "";
                const sys = [
                  "You write a single short WhatsApp reply for Newton Immigration's auto-greeting. Rules:",
                  "1. ONE friendly sentence + ONE question asking what they need help with.",
                  "2. Match the client's language (English / Hindi / Punjabi). If they used 'Sat sri akal' reply with 'Sat sri akal!' once. If English, reply in English.",
                  "3. NEVER quote fees, dates, or processing times.",
                  "4. NEVER promise outcomes.",
                  "5. Mention service categories briefly: study permit, work permit, PR, LMIA, visit visa.",
                  "6. Maximum 2 short lines. No emoji unless client used one.",
                  "7. Return ONLY the reply text — no labels, no quotes.",
                ].join("\n");
                const usr = `Client said: "${text}"\n${knownClient}\nWrite a short friendly greeting reply.`;
                const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                  },
                  body: JSON.stringify({
                    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
                    max_tokens: 120,
                    system: sys,
                    messages: [{ role: "user", content: usr }],
                  }),
                });
                if (aiRes.ok) {
                  const data: any = await aiRes.json();
                  const out = String(data?.content?.[0]?.text || "").trim();
                  if (out && out.length < 400) {
                    // Final safety filter — drop if AI snuck in fees/timing
                    const banned = [/\$\s*\d/, /\bcad\b\s*\d/i, /\b\d{1,3}\s*(days?|weeks?|months?)\b/i, /\b(approved|guaranteed|will be)\b/i];
                    if (!banned.some((re) => re.test(out))) {
                      greetingReply = out;
                    }
                  }
                }
              }
            } catch { /* fall back to default greetingReply */ }

            // Send the greeting
            try {
              const { sendWhatsAppText } = await import("@/lib/whatsapp");
              const sendResult = await sendWhatsAppText(from, greetingReply);
              if (sendResult.success) {
                // Log to inbox so staff sees the auto-greeting in the conversation
                try {
                  const { Pool } = await import("pg");
                  const logPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
                  const digits = String(from || "").replace(/\D/g, "");
                  const normPhone = (digits.length === 10) ? `1${digits}` : digits;
                  await logPool.query(
                    `INSERT INTO whatsapp_inbox (id, phone, message, direction, matched_case_id, matched_case_name, is_read) VALUES ($1,$2,$3,'outbound',$4,$5,TRUE)`,
                    [`WA-GREET-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, normPhone, greetingReply, matched?.id || null, matched?.client || null]
                  );
                  await logPool.end();
                } catch { /* non-fatal */ }
                console.log(`👋 Auto-greeting sent to ${from}: ${greetingReply.slice(0, 60)}`);
              }
            } catch (e) {
              console.error(`Greeting send failed: ${(e as Error).message}`);
            }

            // STOP processing this message — don't trigger intake or AI reply
            continue;
          } else {
            console.log(`👋 Skipped greeting reply for ${from} (greeted within last 60 min)`);
            // Still stop processing the greeting — let it sit until they say something real
            continue;
          }
        }
      }

      // ── Handle docs from UNKNOWN numbers (orphan docs) ──
      // When a brand new number sends a doc, save it to S3 + classify it so it's not lost.
      // It'll be re-filed properly once the contact gets linked to a case.
      if (!matched && (msgType === "document" || msgType === "image" || msgType === "audio")) {
        const mediaId = message[msgType]?.id;
        const originalFilename = message[msgType]?.filename || message[msgType]?.name || null;

        if (mediaId) {
          console.log(`📎 Orphan WA media from unknown number ${from}: ${originalFilename || msgType}`);
          try {
            const media = await downloadWaMedia(mediaId);
            if (media) {
              const { putObjectToS3, buildS3ObjectKey, toS3StoredLink } = await import("@/lib/object-storage");
              const ext = (originalFilename || media.filename || "").includes(".")
                ? (originalFilename || media.filename).split(".").pop()
                : media.mimeType.includes("pdf") ? "pdf" : "jpg";

              // Save to S3 under "orphan" path
              const timestamp = Date.now();
              const s3Key = buildS3ObjectKey({
                companyId: COMPANY_ID,
                caseId: `orphan-${from.replace(/\D/g, "")}`,
                fileName: `${timestamp}-${originalFilename || media.filename}`
              });
              let s3Link = "";
              try {
                await putObjectToS3({ key: s3Key, content: media.buffer, contentType: media.mimeType });
                s3Link = toS3StoredLink(s3Key);
                console.log(`✅ Orphan saved to S3: ${s3Key}`);

                // Update inbox row with download info (same as matched-case path)
                try {
                  const { Pool } = await import("pg");
                  const upPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
                  const finalName = (originalFilename || media.filename || `orphan-${from.replace(/\D/g, "")}.${ext}`).replace(/\|/g, "");
                  const updatedDisplay = `[doc:${msgId}|kind=${msgType === "image" ? "image" : msgType === "audio" ? "audio" : "document"}|name=${encodeURIComponent(finalName)}|mime=${encodeURIComponent(media.mimeType || "application/octet-stream")}|s3=${encodeURIComponent(s3Key)}]`;
                  await upPool.query(`UPDATE whatsapp_inbox SET message = $1 WHERE id = $2`, [updatedDisplay, msgId]);
                  await upPool.end();
                } catch (e) {
                  console.error("Orphan inbox row update failed:", (e as Error).message);
                }
              } catch (e) {
                console.error("Orphan S3 save failed:", e);
              }

              // Quick AI classify so we know what kind of doc it is
              let suggestedLabel = originalFilename || msgType;
              try {
                const isImage = media.mimeType.includes("image");
                const isPdf = media.mimeType.includes("pdf");
                const scanContent: any[] = [];
                if (isImage) {
                  const safeType = media.mimeType.includes("png") ? "image/png" : "image/jpeg";
                  scanContent.push({ type: "image", source: { type: "base64", media_type: safeType, data: media.buffer.toString("base64") } });
                } else if (isPdf) {
                  scanContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: media.buffer.toString("base64") } });
                }
                if (scanContent.length > 0) {
                  scanContent.push({ type: "text", text: `What kind of immigration document is this? Reply with only a short label (e.g. "Passport", "Study Permit", "Transcripts", "IELTS Result"). 1-3 words max.` });
                  const classRes = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
                    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 50, messages: [{ role: "user", content: scanContent }] })
                  });
                  if (classRes.ok) {
                    const classData = await classRes.json() as any;
                    const label = (classData.content?.[0]?.text || "").trim().replace(/[^\w\s-]/g, "").slice(0, 40);
                    if (label) suggestedLabel = label;
                  }
                }
              } catch (e) { /* non-fatal */ }

              // Store orphan doc record for later linking
              try {
                const { Pool } = await import("pg");
                const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
                await pool.query(`
                  CREATE TABLE IF NOT EXISTS orphan_docs (
                    id TEXT PRIMARY KEY,
                    phone TEXT NOT NULL,
                    suggested_label TEXT,
                    original_filename TEXT,
                    mime_type TEXT,
                    s3_key TEXT,
                    s3_link TEXT,
                    linked_case_id TEXT,
                    linked_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                  )
                `);
                await pool.query(`CREATE INDEX IF NOT EXISTS idx_orphan_docs_phone ON orphan_docs(phone) WHERE linked_case_id IS NULL`);
                const orphanId = `orphan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                await pool.query(
                  `INSERT INTO orphan_docs (id, phone, suggested_label, original_filename, mime_type, s3_key, s3_link)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  [orphanId, from, suggestedLabel, originalFilename, media.mimeType, s3Key, s3Link]
                );

                // Update the inbox message to show the doc is captured
                try {
                  await pool.query(
                    `UPDATE whatsapp_inbox SET message = $1 WHERE phone = $2 AND message LIKE '%doc:%' ORDER BY created_at DESC LIMIT 1`,
                    [`📎 ${suggestedLabel} (orphan — save contact name to file)`, from]
                  );
                } catch { /* non-fatal */ }

                await pool.end();
                console.log(`📌 Orphan doc registered: ${suggestedLabel} from ${from}`);
              } catch (e) {
                console.error("Orphan registration failed:", e);
              }
            }
          } catch (e) {
            console.error("Orphan media download failed:", (e as Error).message);
          }
        }
      }

      // Handle document/image uploads → save to Drive (KNOWN clients only)
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
                await putObjectToS3({ key: s3Key, content: media.buffer, contentType: media.mimeType });
                s3Link = toS3StoredLink(s3Key);
                console.log(`✅ S3 saved: ${s3Key}`);

                // ── Update inbox row with download info ──
                // The initial INSERT (line ~129) stored a placeholder with
                // `pending=1`. Now that S3 has the file, replace the placeholder
                // text with one that includes filename + mime + S3 key so the
                // frontend can render a download button.
                try {
                  const { Pool } = await import("pg");
                  const upPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
                  const finalName = (originalFilename || media.filename || `${matched.client || "doc"}.${ext}`).replace(/\|/g, "");
                  const updatedDisplay = `[doc:${msgId}|kind=${msgType === "image" ? "image" : msgType === "audio" ? "audio" : "document"}|name=${encodeURIComponent(finalName)}|mime=${encodeURIComponent(media.mimeType || "application/octet-stream")}|s3=${encodeURIComponent(s3Key)}${mediaCaption && mediaCaption !== originalFilename ? `|caption=${encodeURIComponent(mediaCaption)}` : ""}]`;
                  await upPool.query(`UPDATE whatsapp_inbox SET message = $1 WHERE id = $2`, [updatedDisplay, msgId]);
                  await upPool.end();
                } catch (e) {
                  console.error("Inbox row update failed:", (e as Error).message);
                }
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
              const finalLink = driveLink || s3Link || "";
              
              // Update inbox message with proper file name and drive link
              try {
                const inboxMsg = driveLink 
                  ? `📎 [${properFileName}](${driveLink})`
                  : `📎 ${properFileName}`;
                await pool.query(
                  `UPDATE whatsapp_inbox SET message = $1 WHERE id = $2`,
                  [inboxMsg, msgId]
                );
              } catch { /* non-fatal */ }

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

          // Skip AI auto-reply for staff numbers
          const STAFF_PHONES = ["16046535031","17789828954","17787236662"];
          const isStaffNumber = STAFF_PHONES.some(p => from.includes(p.slice(-9)));
          if (isStaffNumber) {
            console.log(`👥 Staff message from ${from} — skipping AI auto-reply`);
          } else {
            // ─── Post-intake AI auto-reply (careful) ───
            //
            // For matched cases where intake bot didn't handle this message
            // (intake done, or off-topic question, or update command), we
            // run a careful two-step AI flow:
            //
            //   1. classifyMessage()  → ai | staff | ignore
            //   2. if "ai", generateReply() → short, safe text
            //   3. if reply produced, send it via WhatsApp + log to inbox
            //
            // If the classifier or generator says "no" at any step, we just
            // do the team notification (already done above) and stay quiet.
            try {
              const { classifyMessage, generateReply } = await import("@/lib/post-intake-ai-reply");
              const classification = await classifyMessage({
                clientName: matched.client || "",
                formType: matched.formType || "",
                caseStage: String((matched as any).stage || ""),
                message: text,
              });
              console.log(`🤖 Classifier for ${from}: ${classification.route} (${classification.reason})`);

              if (classification.route === "ai") {
                // Pull recent conversation context (last 8 messages from inbox)
                const { Pool } = await import("pg");
                const pool2 = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
                const last10 = String(matched.leadPhone || "").replace(/\D/g, "").slice(-10);
                const recentRows = last10
                  ? await pool2.query(
                      `SELECT message, direction, created_at FROM whatsapp_inbox
                       WHERE matched_case_id = $1 OR RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = $2
                       ORDER BY created_at DESC LIMIT 8`,
                      [matched.id, last10]
                    )
                  : await pool2.query(
                      `SELECT message, direction, created_at FROM whatsapp_inbox
                       WHERE matched_case_id = $1
                       ORDER BY created_at DESC LIMIT 8`,
                      [matched.id]
                    );
                await pool2.end();
                const recentConversation = (recentRows.rows || [])
                  .reverse() // oldest-first for the LLM
                  .map((r: any) => ({
                    role: r.direction === "inbound" ? ("client" as const) : ("staff" as const),
                    text: String(r.message || ""),
                  }));

                // Compute missing docs (best-effort, optional context)
                let missingDocs: string[] = [];
                try {
                  const { listDocuments } = await import("@/lib/store");
                  const docs = await listDocuments(COMPANY_ID, matched.id);
                  missingDocs = docs.filter((d: any) => d.status !== "received").map((d: any) => d.label || d.name || "");
                } catch { /* non-fatal */ }

                const reply = await generateReply({
                  clientName: matched.client || "",
                  formType: matched.formType || "",
                  caseStage: String((matched as any).stage || ""),
                  missingDocs,
                  recentConversation,
                  message: text,
                });

                if (reply) {
                  const { sendWhatsAppText } = await import("@/lib/whatsapp");
                  const sendResult = await sendWhatsAppText(from, reply);
                  if (sendResult.success) {
                    // Log outbound to inbox so staff sees it in conversation view
                    try {
                      const pool3 = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
                      const digits = String(from || "").replace(/\D/g, "");
                      const normalizedPhone = (digits.length === 10)
                        ? `1${digits}`
                        : digits.length === 11 && digits.startsWith("1")
                          ? digits
                          : digits;
                      await pool3.query(
                        `INSERT INTO whatsapp_inbox (id, phone, message, direction, matched_case_id, matched_case_name, is_read) VALUES ($1,$2,$3,'outbound',$4,$5,TRUE)`,
                        [`WA-AI-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, normalizedPhone, reply, matched.id, matched.client || null]
                      );
                      await pool3.end();
                    } catch (e) {
                      console.error("AI reply inbox log error:", (e as Error).message);
                    }
                    console.log(`🤖✅ AI auto-replied to ${matched.client}: ${reply.slice(0, 60)}...`);
                  } else {
                    console.error(`🤖❌ AI reply send failed: ${sendResult.error}`);
                  }
                } else {
                  console.log(`🤖 generateReply returned null — staying silent (staff already notified)`);
                }
              } else if (classification.route === "ignore") {
                console.log(`🤖 Skipped reply (ignore — ${classification.reason})`);
              } else {
                console.log(`🤖 Deferring to staff (${classification.reason})`);
              }
            } catch (e) {
              console.error("Post-intake AI reply error:", (e as Error).message);
              // Fall through silently — staff was already notified above
            }
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
