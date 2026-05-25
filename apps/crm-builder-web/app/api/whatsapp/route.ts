import { NextRequest, NextResponse } from "next/server";
import { getAuthRecoveryToken } from "@/lib/auth-recovery-token";
import { normalizePhone } from "@/lib/phone";
import { notifyCaseEvent } from "@/lib/case-notifications";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";

// Download media from WhatsApp
async function downloadWaMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  try {
    // Get media URL — Meta gives us a temporary download URL (5-15 min lifetime
    // typically; nominally 30 days but often shorter in practice).
    const urlRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` }
    });
    if (!urlRes.ok) {
      const errText = await urlRes.text().catch(() => "");
      console.error(`❌ WA media URL fetch failed for ${mediaId}: status=${urlRes.status} body=${errText.slice(0, 200)}`);
      return null;
    }
    const urlData = await urlRes.json() as { url?: string; mime_type?: string; error?: any };
    if (urlData.error) {
      console.error(`❌ WA media URL response had error for ${mediaId}:`, JSON.stringify(urlData.error).slice(0, 300));
      return null;
    }
    if (!urlData.url) {
      console.error(`❌ WA media URL response missing 'url' field for ${mediaId}:`, JSON.stringify(urlData).slice(0, 300));
      return null;
    }

    // Download the file from the temporary CDN URL
    const fileRes = await fetch(urlData.url, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` }
    });
    if (!fileRes.ok) {
      const errText = await fileRes.text().catch(() => "");
      console.error(`❌ WA media file download failed for ${mediaId}: status=${fileRes.status} body=${errText.slice(0, 200)} (likely expired URL)`);
      return null;
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    if (buffer.length === 0) {
      console.error(`❌ WA media file downloaded as empty buffer for ${mediaId} (URL may have expired silently)`);
      return null;
    }
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
    console.log(`✅ WA media downloaded for ${mediaId}: ${buffer.length} bytes, ${mimeType}`);
    return { buffer, mimeType, filename };
  } catch (e) {
    console.error(`❌ Failed to download WA media ${mediaId}:`, (e as Error).message);
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
    const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "";
    const MAIN_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    if (!MARKETING_PHONE_ID || !MAIN_PHONE_ID) {
      console.error(`[whatsapp-webhook] MISCONFIG: WHATSAPP_PHONE_NUMBER_ID=${MAIN_PHONE_ID ? "set" : "MISSING"} WHATSAPP_MARKETING_PHONE_ID=${MARKETING_PHONE_ID ? "set" : "MISSING"} - both must be set.`);
    } else if (incomingPhoneId && incomingPhoneId !== MARKETING_PHONE_ID && incomingPhoneId !== MAIN_PHONE_ID) {
      console.warn(`[whatsapp-webhook] Unknown phone_number_id=${incomingPhoneId}; routing as main-inbox by default.`);
    }
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
      const msgType = message.type; // text, image, document, audio, button, interactive
      let text = message?.text?.body || "";

      // ── Button & interactive reply normalization ──
      // When a client taps a button on a template message (e.g., the "newton_intake"
      // template's confirm button) or selects from an interactive list/buttons,
      // WhatsApp sends msgType="button" or "interactive" with no text.body field.
      // Without this normalization, our intake handler at line 638 (`msgType === "text"`)
      // never fires — bot acknowledges nothing, intake doesn't start.
      // Symptom: "initial message goes, client confirms by tapping button, but bot
      // doesn't start asking questions."
      if (!text && msgType === "button") {
        text = String(message?.button?.text || message?.button?.payload || "").trim();
      } else if (!text && msgType === "interactive") {
        const ir = message?.interactive;
        text = String(
          ir?.button_reply?.title ||
          ir?.list_reply?.title ||
          ir?.button_reply?.id ||
          ir?.list_reply?.id ||
          ""
        ).trim();
      }
      // After normalization, treat button/interactive replies the same as text
      // for routing decisions below.
      const isTextLike = msgType === "text" || (text && (msgType === "button" || msgType === "interactive"));

      // Hoisted so the post-S3 inbox UPDATE block (line ~430) can reference
      // the same id we used for the INSERT below. Generated once per message.
      const msgId = `WA-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;

      // ── IDEMPOTENCY CLAIM (Meta's stable message id) ──
      // The whatsapp-router forwards inbound webhooks here with a 15s timeout
      // and RETRIES on timeout. Large media (e.g. a 38MB PDF) can take longer
      // than 15s to download + scan + upload, so the router aborts and retries,
      // re-running this whole handler: re-downloading the file and re-saving it
      // to S3/Drive with a fresh timestamp (DUPLICATE Drive files), plus
      // duplicate inbox rows and duplicate client acks. Meta also retries when
      // we're slow to 200. The previous code generated a RANDOM msgId per run,
      // so retries were never recognized as duplicates.
      //
      // Fix: claim Meta's stable message.id ("wamid...") exactly once. If the
      // INSERT conflicts, this is a retry of an already-handled message — skip
      // it entirely. If the dedup check itself errors, we fall through and
      // process normally (better a rare duplicate than a dropped message).
      const metaMsgId = String((message as any)?.id || "");
      if (metaMsgId) {
        let alreadyProcessed = false;
        try {
          const { Pool } = await import("pg");
          const dedupPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
          await dedupPool.query(`CREATE TABLE IF NOT EXISTS whatsapp_processed_msgs (
            meta_msg_id TEXT PRIMARY KEY,
            claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )`);
          const claim = await dedupPool.query(
            `INSERT INTO whatsapp_processed_msgs (meta_msg_id) VALUES ($1) ON CONFLICT DO NOTHING`,
            [metaMsgId]
          );
          await dedupPool.end();
          if (claim.rowCount === 0) {
            alreadyProcessed = true;
          }
        } catch (e) {
          console.error("Dedup claim failed (non-fatal, processing anyway):", (e as Error).message);
        }
        if (alreadyProcessed) {
          console.log(`⏸️  Duplicate webhook for Meta msg ${metaMsgId} — already processed, skipping.`);
          continue;
        }
      }

      const { listCases, addMessage, getCase } = await import("@/lib/store");
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
        // For docs/images/audio, save a placeholder that will be UPDATED later
        // (after the file uploads to S3). Format:
        //   [doc:msgId|kind=image|mediaId=<id>|pending=1|caption=...]
        //
        // Why include mediaId: when the upload silently fails (S3 down, media
        // expired, DB UPDATE error, etc.), the row stays at pending=1 forever.
        // Storing the mediaId in the placeholder lets a retry endpoint
        // re-attempt the fetch from Meta without staff needing to reconstruct
        // the original webhook payload. WhatsApp media URLs are time-limited
        // (~30 days nominal but often shorter in practice), so retries only
        // work for reasonably-recent stuck uploads.
        //
        // The frontend renders this as "📎 (uploading...)" until the row updates.
        const docKind = msgType === "image" ? "image" : msgType === "audio" ? "audio" : "document";
        const docCaption = String(message[msgType]?.caption || message[msgType]?.filename || message[msgType]?.name || "").trim();
        const captionPart = docCaption ? `|caption=${encodeURIComponent(docCaption)}` : "";
        const placeholderMediaId = message[msgType]?.id || "";
        const mediaIdPart = placeholderMediaId ? `|mediaId=${placeholderMediaId}` : "";
        // For button/interactive replies, we extracted readable text above and
        // should display that — NOT a "[doc:...]" placeholder, which would
        // confuse staff reviewing the inbox.
        const displayMsg = (msgType === "text" || (text && (msgType === "button" || msgType === "interactive")))
          ? text
          : `[doc:${msgId}|kind=${docKind}${mediaIdPart}|pending=1${captionPart}]`;
        // ─── Normalize phone before insert ───
        // Meta sometimes sends the same contact under two formats:
        //   "12364120016" (with country code) and "2364120016" (without).
        // We canonicalize to "1" + last 10 digits for North American numbers
        // so all messages from the same contact land in ONE thread.
        // Non-NA numbers: keep digits-only as-is.
        const digits = String(from || "").replace(/\D/g, "");
        const normalizedFrom = normalizePhone(from);
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
      if (isTextLike && text) {
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

        // ── CRITICAL: skip auto-greeting if there's an active intake session ──
        //
        // Real bug from CASE-1399 (Ramandeep): she received the intake template,
        // then replied "Hi" instead of tapping the template button. The auto-
        // greeting fired with a marketing-style "How can we help you today..."
        // message AND short-circuited the rest of the webhook (return at line
        // ~305), so the intake bot's `awaiting_template_reply → ai_chat`
        // transition never happened. She was stuck looking like she was talking
        // to a marketing bot when she should have been talking to her case
        // intake bot.
        //
        // If there IS an active session, we do NOT auto-greet — we let the
        // intake bot's regular handler take the message and advance the phase.
        let hasActiveIntakeSession = false;
        if (isGreeting && !isStaffNumber && matched) {
          try {
            const intakeMod = await import("@/lib/whatsapp-ai-intake");
            const existingSession = await intakeMod.getActiveSession(from, COMPANY_ID);
            if (existingSession) {
              hasActiveIntakeSession = true;
              console.log(`🤖 Skipping auto-greeting for ${from} — has active intake session (case=${matched.id} phase=${(existingSession as any).phase || "unknown"})`);
            }
          } catch (e) {
            // Session-check failure for a MATCHED client: assume there IS
            // an active intake to be safe. Re-greeting a matched client mid-
            // intake (CASE-1399 / CASE-1430) is worse than briefly suppressing
            // a greeting until the next message. Only runs when matched is set.
            console.warn(`[whatsapp] Active-intake check failed for matched client ${matched?.id} (${from}); assuming active session.`, (e as Error).message);
            hasActiveIntakeSession = true;
          }
        }

        if (isGreeting && !isStaffNumber && !hasActiveIntakeSession) {
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
            // Three modes of greeting reply based on client context:
            //
            // (a) Unknown number, no case matched → ask what service they need
            //     (they're a new lead — appropriate to ask)
            //
            // (b) Matched to a case in processing → DON'T ask what service.
            //     We already know what they're working on; asking again makes
            //     us look like we don't recognize them and is annoying.
            //     Just say "Hi [name]! How can we help you today?" and let
            //     them tell us what they need (an update, a question, etc.).
            //     Real annoyance from Jasmeen (CASE-1338): she said "Hi" on
            //     her active OWP case and got the marketing-style "are you
            //     looking for study permits, work permits, PR…" prompt as if
            //     she were a stranger.
            //
            // (c) Active intake session → already handled above; no greeting.
            const clientFirstName = matched?.client ? String(matched.client).split(" ")[0] : "";
            let greetingReply: string;
            if (matched) {
              // Client is in our system — friendly + recognition + open-ended
              greetingReply = `Hi ${clientFirstName}! 👋 How can we help you today?`;
            } else {
              // True new lead — ask what service they need
              greetingReply = "Hi! 👋 Welcome to Newton Immigration. Could you share your name (and case ID if you have one) so our team can look up your file? Our team will get back to you shortly.";
            }

            try {
              const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
              if (apiKey) {
                const knownClient = matched?.client
                  ? `The client's name is ${matched.client} and they are an EXISTING client with case ${matched.id} for ${matched.formType}. They are NOT a new lead.`
                  : "This is an unknown number — no matched case.";
                const sys = matched ? [
                  "You write a single short WhatsApp reply for Newton Immigration's auto-greeting to an EXISTING client.",
                  "Rules:",
                  "1. The client is already in our system with an active case. NEVER ask what service they need — we already know.",
                  "2. Greet them by first name, then ONE short open-ended question asking how you can help today.",
                  "3. Match the client's language (English / Hindi / Punjabi). If they used 'Sat sri akal' reply with 'Sat sri akal!' once. If English, reply in English.",
                  "4. NEVER list service options (study permit, work permit, PR, etc.) — that's for new leads only.",
                  "5. NEVER quote fees, dates, or processing times.",
                  "6. NEVER promise outcomes.",
                  "7. Maximum 2 short lines. No emoji unless client used one.",
                  "8. Return ONLY the reply text — no labels, no quotes.",
                  knownClient,
                ].join("\n") : [
                  "You write a single short WhatsApp reply for Newton Immigration's auto-greeting. Rules:",
                  "1. ONE friendly sentence + ONE question asking what they need help with.",
                  "2. Match the client's language (English / Hindi / Punjabi). If they used 'Sat sri akal' reply with 'Sat sri akal!' once. If English, reply in English.",
                  "3. NEVER quote fees, dates, or processing times.",
                  "4. NEVER promise outcomes.",
                  "5. Do NOT mention or list service categories. The main number is for existing processing clients - never push a marketing-style menu at them.",
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
          console.log(`📎 WA media from ${matched.client} (mediaId=${mediaId}): ${mediaCaption}`);
          try {
            const media = await downloadWaMedia(mediaId);
            if (!media) {
              // downloadWaMedia already logged the specific reason. This adds
              // the context (which case, msgId) so we can correlate to a stuck
              // inbox row later.
              console.error(`❌ Stuck upload: media download returned null. case=${matched.client} msgId=${msgId} mediaId=${mediaId}. Inbox row ${msgId} will remain at pending=1 until cleared.`);
            }
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
                  console.log(`✅ Inbox row ${msgId} updated with download info (case=${matched.client})`);
                } catch (e) {
                  console.error(`❌ Inbox row update failed for ${msgId} (case=${matched.client}):`, (e as Error).message, "— S3 has the file but inbox row is still at pending=1.");
                }
              } catch(e) {
                console.error(`❌ S3 save failed for case=${matched.client} msgId=${msgId}:`, (e as Error).message, "— Inbox row will remain at pending=1.");
              }

              // ── STEP 2: AI CLASSIFY & EXTRACT DATA ──────────────────────
              // Uses the shared doc-ocr module (same logic as the staff-triggered
              // /scan-docs endpoint, so behavior is identical regardless of upload path).
              let docCategory = "client";
              // Fallback name: prefer the client's original filename (so a large
              // doc that skips OCR still gets a meaningful name like
              // "Akash - ASSURED SHORTHOLD.pdf" instead of "Akash - Document.pdf").
              const cleanOriginalName = String(originalFilename || media.filename || "")
                .replace(/\.[^.]+$/, "")              // drop extension
                .replace(/[^a-zA-Z0-9 .\-]/g, " ")    // strip odd chars
                .replace(/\s+/g, " ")
                .trim();
              let properFileName = cleanOriginalName
                ? `${clientNameClean} - ${cleanOriginalName}.${ext}`
                : `${clientNameClean} - Document.${ext}`;
              try {
                const { extractDocumentFields, mapExtractedToIntake } = await import("@/lib/doc-ocr");
                const extracted = await extractDocumentFields(media.buffer, media.mimeType, matched.client);
                if (extracted) {
                  if (extracted.category) docCategory = extracted.category;

                  // Build proper filename: ClientName - DocumentType (exp DATE).ext
                  if (extracted.label) {
                    const expiryPart = extracted.expiryDate ? ` (exp ${extracted.expiryDate})` : "";
                    properFileName = `${clientNameClean} - ${extracted.label}${expiryPart}.${ext}`;
                  }

                  // Map to intake fields, only filling blanks
                  const existingIntake = (matched.pgwpIntake as Record<string, any>) || {};
                  const fields = mapExtractedToIntake(extracted, existingIntake);

                  if (Object.keys(fields).length > 0) {
                    await updateCasePgwpIntake(COMPANY_ID, matched.id, fields as any);
                    console.log(`📋 Extracted ${Object.keys(fields).length} fields from ${extracted.label || extracted.category} for ${matched.client}`);
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
              // doc_uploaded email notification disabled by user request (May 2026)
              // - Was firing on every client doc upload, which created inbox noise.
              // - Doc activity is already visible in the inbox + case detail.
              // - To re-enable: restore the notifyCaseEvent call here, or add an
              //   isSubmittedCase-only branch if only urgent-case alerts are wanted.

              // ── STEP 5: SEND SMART ACKNOWLEDGMENT ───────────────────────
              //
              // Policy (May 2026): the auto-acknowledgement runs ONLY for
              // cases that are still in active intake. For submitted cases
              // we say nothing — uploads on submitted cases are typically
              // IRCC follow-ups (request letters, biometrics confirmations,
              // passport requests) that demand human review BEFORE any
              // client-facing response. The bot's "got your file!" reply
              // misled CASE-1415 (sukhmandeep) into thinking her IRCC
              // request letter was being handled when in fact no staff
              // had even seen it.
              //
              // For submitted cases, instead of an auto-reply we just save
              // the doc silently and let staff notice via inbox + the new
              // dashboard alerts.
              const isSubmittedCase = matched?.processingStatus === "submitted";
              if (!isSubmittedCase) {
                const { sendWhatsAppText } = await import("@/lib/whatsapp");
                const firstName = String(matched.client || "").split(" ")[0];
                const docLabel = properFileName.split(" - ")[1]?.replace(/\.[^.]+$/, "").replace(/ \(exp.*\)/, "") || "document";
                let ackMsg = `✅ ${firstName}, I've saved your *${docLabel}* to your file.`;
                if (docCategory === "passport") ackMsg += `\n\n📘 Passport details have been recorded automatically.`;
                else if (docCategory === "study_permit" || docCategory === "work_permit") ackMsg += `\n\n📋 Permit details have been noted.`;
                else if (docCategory === "completion_letter") ackMsg += `\n\n🎓 Completion letter received!`;
                else if (docCategory === "transcripts") ackMsg += `\n\n📚 Transcripts received!`;
                else if (docCategory === "language_test" || docCategory === "ielts") ackMsg += `\n\n📝 Language test result saved!`;

                // ── SMART COLLECTION: tell the client what's still outstanding ──
                // A real agent doesn't just say "got it" — it keeps the
                // collection moving by naming what's left. We do this ONLY when
                // the client is NOT mid-intake. During active intake the intake
                // flow drives the conversation (and completeIntake sends the
                // full checklist at the end), so adding a second list here would
                // just be noise. Post-intake, this is exactly the nudge that
                // keeps document collection moving without staff effort.
                let inActiveIntake = false;
                try {
                  const intakeMod = await import("@/lib/whatsapp-ai-intake");
                  const sess = await intakeMod.getActiveSession(from, COMPANY_ID);
                  inActiveIntake = (sess as any)?.phase === "ai_chat";
                } catch { /* non-fatal */ }

                if (!inActiveIntake) {
                  try {
                    const { listDocuments } = await import("@/lib/store");
                    const { getMissingChecklistDocs } = await import("@/lib/application-checklists");
                    const freshDocs = await listDocuments(COMPANY_ID, matched.id);
                    const stillNeed = getMissingChecklistDocs(String(matched.formType || ""), freshDocs);
                    if (stillNeed.length > 0) {
                      const list = stillNeed.slice(0, 8).map((d) => `• ${d}`).join("\n");
                      ackMsg += `\n\n📋 *Still needed:*\n${list}`;
                      if (stillNeed.length > 8) ackMsg += `\n…and a few more`;
                      ackMsg += `\n\nPlease send clear photos or scans here whenever you're ready. 📸`;
                    } else {
                      ackMsg += `\n\n🎉 That looks like everything we need from you for now — our team will review and follow up if anything else is required.`;
                    }
                  } catch (e) {
                    console.error("Doc-progress append failed (non-fatal):", (e as Error).message);
                  }
                }

                ackMsg += `\n\n— Newton Immigration Team 🍁`;
                await sendWhatsAppText(from, ackMsg);
              } else {
                console.log(`🤐 Skipped auto-ack for submitted case ${matched.id} (${matched.client}) — uploads on submitted cases need staff review first.`);

                // Submitted-case upload = likely IRCC follow-up (request
                // letter, biometrics, passport request, etc.) Alert staff
                // so someone reviews the document and contacts the client.
                // Hard deadline-driven category — failing to respond can
                // cause refusal (e.g., 30 days for request letters).
                try {
                  const { sendEmail, isEmailConfigured } = await import("@/lib/email");
                  if (isEmailConfigured()) {
                    const { listUsers } = await import("@/lib/store");
                    const users = await listUsers(COMPANY_ID);
                    const recipients: string[] = [];
                    const sandhu = users.find((u: any) =>
                      u.userType === "staff" &&
                      String(u.name || "").toLowerCase().includes("sandhu")
                    );
                    if (sandhu?.email) recipients.push(sandhu.email);
                    const assignedToKey = String(matched.assignedTo || "").toLowerCase().trim();
                    const assignee = users.find((u: any) =>
                      u.userType === "staff" &&
                      String(u.name || "").toLowerCase().trim() === assignedToKey
                    );
                    if (assignee?.email && !recipients.includes(assignee.email)) {
                      recipients.push(assignee.email);
                    }
                    if (recipients.length > 0) {
                      const baseUrl =
                        process.env.PUBLIC_APP_URL ||
                        process.env.NEXT_PUBLIC_APP_URL ||
                        "https://crm.newtonimmigration.com";
                      const caseUrl = `${baseUrl}/?case=${encodeURIComponent(matched.id)}`;
                      const subject = `[Newton CRM] 📨 Client uploaded doc on SUBMITTED case — ${matched.client} — likely IRCC follow-up`;
                      const html = `
<div style="background:#dc2626;padding:18px 24px;border-radius:8px 8px 0 0;">
  <span style="color:white;font-size:18px;font-weight:bold;letter-spacing:0.5px;">📨 SUBMITTED-CASE UPLOAD</span>
</div>
<div style="background:#fef2f2;padding:24px;border-radius:0 0 8px 8px;border:1px solid #fecaca;border-top:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#7f1d1d;line-height:1.6;">
  <h2 style="margin:0 0 12px;font-size:16px;">Likely IRCC follow-up — needs review</h2>
  <p style="margin:0 0 12px;">
    <strong>${matched.client}</strong> just uploaded <strong>${properFileName}</strong> via WhatsApp on a <strong>submitted</strong> case. This is usually an IRCC request letter, biometrics confirmation, passport request, or similar follow-up. The bot did NOT auto-acknowledge to avoid misleading the client about timeline.
  </p>
  <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #fecaca;border-radius:6px;margin:16px 0;">
    <tr><td style="padding:8px 12px;border-bottom:1px solid #fecaca;font-weight:600;width:40%;">Client</td><td style="padding:8px 12px;border-bottom:1px solid #fecaca;">${matched.client}</td></tr>
    <tr><td style="padding:8px 12px;border-bottom:1px solid #fecaca;font-weight:600;">Application Type</td><td style="padding:8px 12px;border-bottom:1px solid #fecaca;">${matched.formType || "—"}</td></tr>
    <tr><td style="padding:8px 12px;border-bottom:1px solid #fecaca;font-weight:600;">Case ID</td><td style="padding:8px 12px;border-bottom:1px solid #fecaca;"><code>${matched.id}</code></td></tr>
    <tr><td style="padding:8px 12px;border-bottom:1px solid #fecaca;font-weight:600;">Document</td><td style="padding:8px 12px;border-bottom:1px solid #fecaca;">${properFileName}</td></tr>
    <tr><td style="padding:8px 12px;font-weight:600;">Assigned To</td><td style="padding:8px 12px;">${matched.assignedTo || "Unassigned"}</td></tr>
  </table>
  <p style="margin:0;">
    <a href="${caseUrl}" style="display:inline-block;background:#dc2626;color:white;padding:12px 22px;border-radius:6px;font-weight:600;text-decoration:none;font-size:14px;">
      Open Case in CRM →
    </a>
  </p>
  <hr style="border:none;border-top:1px solid #fecaca;margin:24px 0 12px;" />
  <p style="font-size:11px;color:#94a3b8;margin:0;">
    Triggered automatically when a doc is uploaded to a submitted case.<br/>
    Newton Immigration Inc. · 8327 120 Street, Delta, BC · RCIC #R705964
  </p>
</div>`;
                      await sendEmail({ to: recipients, subject, html });
                      console.log(`📧 Submitted-case upload alert sent to: ${recipients.join(", ")}`);
                    }
                  }
                } catch (e) {
                  console.error("Submitted-case upload alert failed:", e);
                }
              }

              // ── STEP 6: AUTO-GENERATE PDF IF PASSPORT RECEIVED ──────────
              if (docCategory === "passport") {
                const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "";
                if (baseUrl) {
                  fetch(`${baseUrl}/api/cases/${matched.id}/generate-forms`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ systemToken: getAuthRecoveryToken() })
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
      //
      // ── BURST-UPLOAD DEBOUNCING ──
      // Real bug: client (sukhmandeep singh / CASE-1415) uploaded 7 docs in
      // quick succession. Each doc triggered its own webhook in parallel,
      // each webhook fired its own AI reply, and the client got bombarded
      // with 10+ messages. The webhooks ran concurrently with no lock, so
      // they all read the same chatTurns=14 from the session and all sent
      // their own response.
      //
      // Fix: maintain an in-memory map of recent doc-reply timestamps per
      // phone number. If we already replied to a doc upload from this phone
      // within the last 5 seconds, SKIP this reply. The first webhook in
      // the burst sends the acknowledgment; subsequent ones in the burst
      // just save the doc silently and the client hears one ack instead of
      // seven.
      //
      // The map is module-level so it persists across requests within the
      // same Node process. Serverless cold-starts will reset it, but that's
      // fine — a cold start means there's no prior reply to debounce against.
      if (msgType === "image" || msgType === "document") {
        try {
          const intakeMod = await import("@/lib/whatsapp-ai-intake");
          const session = await intakeMod.getActiveSession(from, COMPANY_ID);
          const skipFormTypes = ["college change", "college transfer"];
          const matchedFormType = String(matched?.formType || "").toLowerCase();
          const skipIntake = skipFormTypes.some(t => matchedFormType.includes(t));
          if (session && session.phase === "ai_chat" && !skipIntake) {
            // Check the per-phone debounce window
            const lastReplyAt = (globalThis as any).__waDocReplyDebounce?.[from] as number | undefined;
            const now = Date.now();
            const DEBOUNCE_MS = 5000; // 5 seconds — covers typical "burst upload" of multiple docs
            if (lastReplyAt && now - lastReplyAt < DEBOUNCE_MS) {
              console.log(`⏸️  Skipping doc-reply for ${from} — last doc reply was ${now - lastReplyAt}ms ago (within debounce window). Doc was saved, just no extra ack.`);
            } else {
              // Initialize the map if needed (first call)
              if (!(globalThis as any).__waDocReplyDebounce) {
                (globalThis as any).__waDocReplyDebounce = {};
              }
              (globalThis as any).__waDocReplyDebounce[from] = now;
              // Acknowledge doc and send next question
              await intakeMod.handleIncomingReply({ phone: from, message: "[document received]", companyId: COMPANY_ID });
            }
          }
        } catch(e) { console.error("Intake image handler error:", e); }
      }

      if (isTextLike && text) {
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
            // ── Per-message-ID dedup ──
            // Meta occasionally retries webhooks (especially on slow networks).
            // If we've already processed this exact msgId in the last 60 seconds,
            // skip it to avoid the bot replying twice. Different from the doc
            // debounce above (which is per-phone for bursts of different msgIds);
            // this is per-msgId for retries of the SAME message.
            const dedupKey = `text:${msgId}`;
            const lastSeenAt = (globalThis as any).__waMsgDedup?.[dedupKey] as number | undefined;
            const now = Date.now();
            const DEDUP_WINDOW_MS = 60000; // 60 seconds
            if (lastSeenAt && now - lastSeenAt < DEDUP_WINDOW_MS) {
              console.log(`⏸️  Skipping text reply for msgId=${msgId} — already processed ${now - lastSeenAt}ms ago (Meta webhook retry).`);
              handledByIntake = true; // Mark handled so we don't fall through to other branches
            } else {
              if (!(globalThis as any).__waMsgDedup) {
                (globalThis as any).__waMsgDedup = {};
              }
              (globalThis as any).__waMsgDedup[dedupKey] = now;
              // Cleanup old entries to prevent memory growth — drop anything older
              // than 5 minutes. Cheap because the map is small in practice (one
              // entry per inbound message in a 60-second window).
              const CLEANUP_MS = 5 * 60 * 1000;
              for (const k of Object.keys((globalThis as any).__waMsgDedup)) {
                if (now - (globalThis as any).__waMsgDedup[k] > CLEANUP_MS) {
                  delete (globalThis as any).__waMsgDedup[k];
                }
              }
              await intakeMod.handleIncomingReply({ phone: from, message: text, companyId: COMPANY_ID });
              handledByIntake = true;
            }
          } else if (session && skipIntake) {
            console.log(`⏭️ Skipping intake for ${matched?.formType} — forwarding to team`);
          }
        } catch (e) {
          console.error("Intake handler error:", (e as Error).message);
        }

        // Handle UNKNOWN numbers — just acknowledge politely and store the
        // extracted name so staff can find them later. We DO NOT auto-link
        // the phone to any case here.
        //
        // ⚠️  HISTORY: Earlier versions of this handler used a fuzzy name
        // match against listCases() and CALLED updateCase(leadPhone) without
        // staff confirmation. That logic produced two catastrophic bugs:
        //   1. Sukhmandeep (CASE-1415) lost her phone link because another
        //      unknown-number reply matched a different case with a
        //      similar-sounding first name → her thread disappeared from
        //      the inbox view (it had no matched case anymore).
        //   2. Ravinder Singh's new number got auto-linked to Ruben's
        //      PR Card Renewal case because both first names share letters
        //      and the find() picked the first one in array order.
        //
        // The fuzzy match was intrinsically unsafe — there's no way to
        // distinguish "Singh" from "Singh" without more signal. So instead:
        //   - Save the name in the inbox row's matched_case_name column
        //     (so staff sees it in the inbox list)
        //   - Send a friendly acknowledgement that the team will review
        //   - Do NOT touch any case's leadPhone
        // Staff uses the new 🔗 Link-to-Case modal to make the connection
        // safely with a search-and-confirm flow.
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

            // Save the extracted name on the inbox row so staff can SEE it
            // in the inbox list — but DO NOT touch any case's leadPhone.
            if (extracted.name && extracted.name !== knownName) {
              await pool.query(`UPDATE whatsapp_inbox SET matched_case_name = $1 WHERE phone = $2`, [extracted.name, from]);
            }

            // Acknowledge — keep it generic; never claim we found their file
            // because we no longer auto-search for it. Staff will link via
            // the searchable Link-to-Case modal in the inbox UI.
            const greeting = extracted.name ? `Hello ${extracted.name.split(" ")[0]}!` : "Hello!";
            if (extracted.isAskingForUpdate) {
              await sendWhatsAppText(from, `${greeting} 🍁

Thank you for reaching out to Newton Immigration.

Our team will review your message and get back to you shortly with an update on your file.

If you have a case ID or application number handy, sharing it will help us respond faster.

— Newton Immigration Team`);
            } else if (extracted.isGreeting || text.length < 20) {
              await sendWhatsAppText(from, `${greeting} 🍁 Welcome to Newton Immigration.

Thanks for reaching out. Our team has received your message and will get back to you shortly. If you have a case ID or application number, sharing it will help us respond faster.

— Newton Immigration Team`);
            } else {
              // General message — acknowledge so the client knows it landed
              await sendWhatsAppText(from, `${greeting} 🍁

Thank you for your message — our team has received it and will get back to you shortly.

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
            // ── SAFE DETERMINISTIC INTERCEPT: "what documents do you need?" ──
            // This is the single most common post-intake question. Answering
            // it from the live checklist is 100% safe — no fees, no timing, no
            // legal opinion — and far more reliable than letting the LLM guess
            // a doc list. If it fires, we skip the LLM flow entirely so the
            // client gets one clean, accurate answer.
            let answeredDocQuestion = false;
            const isSubmittedForDocQ = (matched as any)?.processingStatus === "submitted";
            const docQuestionPattern =
              /(what|which|kihr|kihre|kehr|kaun|ki ki|kya)\s+.*\b(doc|docs|document|documents|paper|papers|file|files)\b/i;
            const docNeedPattern =
              /\b(document|documents|docs|paper|papers)\b.*\b(need|needed|require|required|chahid|chahide|chaida|baki|pending|left|remaining|outstanding|missing)\b/i;
            const whatLeftPattern =
              /\bwhat('?s| is| do you)?\s+(left|pending|remaining|outstanding|need(ed)?|require[ds]?)\b.*\b(from me|me|you|us|now)?\b/i;
            const looksLikeDocQuestion =
              docQuestionPattern.test(text) ||
              docNeedPattern.test(text) ||
              /what do (you|u) need (from me)?/i.test(text) ||
              (whatLeftPattern.test(text) && /\b(doc|document|paper|file|need|send|submit|upload)/i.test(text));

            if (!isSubmittedForDocQ && looksLikeDocQuestion) {
              try {
                const { listDocuments } = await import("@/lib/store");
                const { getChecklistProgress } = await import("@/lib/application-checklists");
                const docsNow = await listDocuments(COMPANY_ID, matched.id);
                const prog = getChecklistProgress(String(matched.formType || ""), docsNow);
                const firstName = String(matched.client || "").split(" ")[0];
                let docMsg: string;
                if (prog.missingRequired.length === 0) {
                  docMsg = `${firstName ? firstName + ", " : ""}good news — we have all the required documents on file for your ${matched.formType || "application"}. 🎉 Our team will review everything and follow up if anything else is needed.\n\n— Newton Immigration Team 🍁`;
                } else {
                  const needList = prog.missingRequired.slice(0, 10).map((d) => `• ${d}`).join("\n");
                  const haveLine =
                    prog.receivedRequired.length > 0
                      ? `\n\n✅ Already received: ${prog.receivedRequired.slice(0, 6).join(", ")}`
                      : "";
                  docMsg = `${firstName ? "Hi " + firstName + "! " : ""}Here's what we still need for your ${matched.formType || "application"}:\n\n📋 *Still needed:*\n${needList}${haveLine}\n\nPlease send clear photos or scans right here whenever you're ready. 📸\n\n— Newton Immigration Team 🍁`;
                }
                const { sendWhatsAppText } = await import("@/lib/whatsapp");
                const docSend = await sendWhatsAppText(from, docMsg);
                if (docSend.success) {
                  answeredDocQuestion = true;
                  try {
                    const { Pool } = await import("pg");
                    const poolDocQ = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
                    const digitsDq = String(from || "").replace(/\D/g, "");
                    const normalizedDq = digitsDq.length === 10 ? `1${digitsDq}` : digitsDq;
                    await poolDocQ.query(
                      `INSERT INTO whatsapp_inbox (id, phone, message, direction, matched_case_id, matched_case_name, is_read) VALUES ($1,$2,$3,'outbound',$4,$5,TRUE)`,
                      [`WA-DOCQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, normalizedDq, docMsg, matched.id, matched.client || null]
                    );
                    await poolDocQ.end();
                  } catch (e) {
                    console.error("Doc-question inbox log error:", (e as Error).message);
                  }
                  console.log(`📋✅ Answered doc-question deterministically for ${matched.client} (${prog.missingRequired.length} still needed)`);
                }
              } catch (e) {
                console.error("Doc-question intercept failed (non-fatal):", (e as Error).message);
              }
            }

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
            if (!answeredDocQuestion) {
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

                // Compute missing docs from the application CHECKLIST (not from
                // doc-record status). The old code only looked at doc rows whose
                // status !== "received", so a case with no placeholder rows
                // looked like it needed nothing — even when the client hadn't
                // sent a passport. getMissingChecklistDocs compares the real
                // required checklist against the documents actually on file.
                let missingDocs: string[] = [];
                try {
                  const { listDocuments } = await import("@/lib/store");
                  const { getMissingChecklistDocs } = await import("@/lib/application-checklists");
                  const docs = await listDocuments(COMPANY_ID, matched.id);
                  missingDocs = getMissingChecklistDocs(String(matched.formType || ""), docs);
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
            } // end if (!answeredDocQuestion)
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
