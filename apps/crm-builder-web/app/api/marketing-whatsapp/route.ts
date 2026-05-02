import { NextRequest, NextResponse } from "next/server";
import { NEWTON_FEES, NEWTON_DOCS } from "@/lib/marketing-knowledge";
import { Pool } from "pg";

const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "1047138985153613";
// Token: prefer WHATSAPP_ACCESS_TOKEN (Meta's naming), fall back to WHATSAPP_TOKEN (legacy)
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "newton_verify_2024";
const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_inbox (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'inbound',
      contact_name TEXT,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_leads (
      phone TEXT PRIMARY KEY,
      contact_name TEXT,
      stage TEXT NOT NULL DEFAULT 'new',
      source TEXT,
      service_interest TEXT,
      tags TEXT[],
      notes TEXT,
      assigned_to TEXT,
      next_follow_up DATE,
      consultation_paid BOOLEAN NOT NULL DEFAULT FALSE,
      converted_case_id TEXT,
      ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_sessions (
      phone TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function sendMarketingMessage(to: string, message: string) {
  const phone = to.replace(/\D/g, "");
  const res = await fetch(`https://graph.facebook.com/v18.0/${MARKETING_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: message }
    })
  });
  const data = await res.json() as any;
  console.log(`📤 Marketing WA sent to ${phone}: ${res.status}`);
  return data;
}

async function saveMarketingMessage(phone: string, message: string, direction: string, name?: string) {
  try {
    const id = `mkt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await pool.query(
      `INSERT INTO marketing_inbox (id, phone, message, direction, contact_name, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (id) DO NOTHING`,
      [id, phone, message, direction, name || null]
    );
  } catch (e) { console.error("Marketing save error:", e); }
}

// Upsert lead row for every inbound message
async function ensureLead(phone: string, contactName?: string, source?: string) {
  try {
    await pool.query(
      `INSERT INTO marketing_leads (phone, contact_name, source, stage, updated_at)
       VALUES ($1, $2, $3, 'new', NOW())
       ON CONFLICT (phone) DO UPDATE SET
         contact_name = COALESCE(marketing_leads.contact_name, $2),
         source = COALESCE(marketing_leads.source, $3),
         updated_at = NOW()`,
      [phone, contactName || null, source || null]
    );
  } catch (e) { console.error("Lead upsert error:", e); }
}

async function getLead(phone: string): Promise<any> {
  try {
    const r = await pool.query(`SELECT * FROM marketing_leads WHERE phone = $1`, [phone]);
    return r.rows[0] || null;
  } catch { return null; }
}

async function getMarketingSession(phone: string): Promise<any> {
  try {
    const res = await pool.query(`SELECT * FROM marketing_sessions WHERE phone = $1`, [phone]);
    return res.rows[0] || null;
  } catch { return null; }
}

async function saveMarketingSession(phone: string, data: any) {
  try {
    await pool.query(
      `INSERT INTO marketing_sessions (phone, data, updated_at) VALUES ($1,$2,NOW())
       ON CONFLICT (phone) DO UPDATE SET data=$2, updated_at=NOW()`,
      [phone, JSON.stringify(data)]
    );
  } catch (e) { console.error("Session save error:", e); }
}

// Naive service detection — if AI later refines, we update the lead row
function detectServiceInterest(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bpgwp\b|post.?graduation/.test(t)) return "PGWP";
  if (/\bsowp\b|spousal.*work/.test(t)) return "SOWP";
  if (/\bbowp\b|bridging/.test(t)) return "BOWP";
  if (/study permit extension|sp ?ext/.test(t)) return "Study Permit Extension";
  if (/study permit|student visa/.test(t)) return "Study Permit";
  if (/visitor record|extend.*visitor/.test(t)) return "Visitor Record";
  if (/visitor visa|trv\b|tourist/.test(t)) return "Visitor Visa";
  if (/super visa|parent.*visa/.test(t)) return "Super Visa";
  if (/express entry|\bee\b|\bcrs\b/.test(t)) return "Express Entry";
  if (/spousal sponsorship|sponsor.*spouse/.test(t)) return "Spousal Sponsorship";
  if (/family sponsorship|sponsor.*parent/.test(t)) return "Family Sponsorship";
  if (/\bpr\b|permanent residence/.test(t)) return "PR";
  if (/citizenship/.test(t)) return "Citizenship";
  if (/lmia/.test(t)) return "LMIA";
  if (/\bwes\b/.test(t)) return "WES";
  return null;
}

async function handleMarketingMessage(phone: string, message: string, contactName?: string, referral?: string) {
  await saveMarketingMessage(phone, message, "inbound", contactName);

  // Map referral source — if user clicked an FB/IG ad, "referral" header has source name
  let source: string | undefined;
  if (referral) {
    const lower = referral.toLowerCase();
    if (lower.includes("facebook") || lower.includes("fb")) source = "facebook";
    else if (lower.includes("instagram") || lower.includes("ig")) source = "instagram";
    else if (lower.includes("tiktok")) source = "tiktok";
    else source = "other";
  } else {
    source = "whatsapp";
  }

  await ensureLead(phone, contactName, source);

  // Detect service interest from message and store on lead if found
  const interest = detectServiceInterest(message);
  if (interest) {
    try {
      await pool.query(
        `UPDATE marketing_leads SET service_interest = COALESCE(service_interest, $2), updated_at = NOW() WHERE phone = $1`,
        [phone, interest]
      );
    } catch (e) { /* ignore */ }
  }

  // Check if AI auto-reply is disabled for this thread
  const lead = await getLead(phone);
  if (lead && lead.ai_enabled === false) {
    console.log(`🤚 AI disabled for ${phone} — staff handles manually`);
    // Still notify staff in CRM so they see the message
    try {
      const { addNotification, listUsers } = await import("@/lib/store");
      const users = await listUsers(COMPANY_ID);
      const recipients = users.filter((u: any) => ["Admin", "Marketing", "ProcessingLead"].includes(u.role));
      for (const r of recipients.slice(0, 3)) {
        await addNotification({
          companyId: COMPANY_ID,
          userId: r.id,
          type: "ai_alert",
          message: `📣 ${contactName || phone}: "${message.slice(0, 60)}${message.length > 60 ? "..." : ""}"`,
        });
      }
    } catch (e) { /* non-fatal */ }
    return;
  }

  // Don't auto-reply to converted leads — they are now real cases
  if (lead && lead.stage === "converted") {
    console.log(`🚫 Skipping AI for converted lead ${phone} (case ${lead.converted_case_id})`);
    return;
  }

  const session = await getMarketingSession(phone) || { data: { stage: "new" } };
  const sessionData = session.data;

  // ── New marketing AI prompt ──
  // Drives the eligibility-first → checklist → fee → confirm flow described
  // by Newton ownership on May 1, 2026. Critical rules:
  //   • Consultation fee ($52.50) ONLY for PR cases — NOT for Work/Study/Visit
  //   • Show eligibility first BEFORE sharing fees / checklist
  //   • Send only ONE service's info at a time — never dump full menu
  //   • Don't promise specific timing ("1 business day", "2 weeks", etc.)
  //   • WhatsApp calls NOT available — always direct calls to +1 604-653-5031
  //   • All docs sent later go to Processing Team WhatsApp +1 604-779-5700
  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: `You are Newton Immigration's marketing assistant on WhatsApp. You're warm, friendly, and helpful — like a knowledgeable friend who happens to know immigration inside-out. You also have a professional touch.

${NEWTON_FEES}

${NEWTON_DOCS}

CONVERSATION STAGE: ${sessionData.stage || "new"}
COLLECTED INFO: ${JSON.stringify(sessionData)}
KNOWN SERVICE INTEREST: ${interest || lead?.service_interest || "unknown"}

═══════════════════════════════════════════════
THE FLOW YOU FOLLOW (in order):
═══════════════════════════════════════════════

STEP 1 — WELCOME (only on first message of a new conversation):
"Hi there! 👋 Welcome to Newton Immigration!

We're a licensed Canadian immigration consulting firm based in Surrey, BC.

What can we help you with today?
🛂 Work Permit (PGWP, SOWP, LMIA, BOWP)
📚 Study Permit (new or extension)
🇨🇦 PR / Sponsorship / Express Entry
✈️ Visitor Visa / Super Visa
🏠 Other (Citizenship, PR Card Renewal, etc.)

📍 9850 King George Hub, Surrey, BC
📞 For calls: +1 604-653-5031 (WhatsApp calls not available)"

STEP 2 — When client picks broad category (e.g. "Work Permit"):
Show sub-options for that category. Ask which one fits. Don't dump fees yet.

STEP 3 — When client picks specific service (e.g. "PGWP"):
Send ELIGIBILITY first, then say:
"If any of these are unclear or you want to talk it through, we can call you back — just reply 'CALL ME' with your best time, or call us directly: +1 604-653-5031."

STEP 4 — When client confirms eligible / asks to proceed:
Send: ✅ Documents Checklist + 💰 Fee + clear next step.
For non-PR: "Reply YES with your full name to proceed."
For PR: explain $52.50 consultation needed, give Interac email, ask them to send receipt.

STEP 5 — When client says YES + gives name (or pays consultation):
Send confirmation message:
"Awesome [Name]! 🎉 You're all set to begin.

Here's how it works:
1️⃣ Send payment via Interac to: newtonimmigration@gmail.com
   Amount: [exact fee from catalog]
2️⃣ Share the receipt here on WhatsApp once paid.
3️⃣ Our Processing Team will reach out to you to walk you through every step.

🤝 By proceeding, you're confirming the info you share with us is accurate, and you understand our role is to prepare and submit your application — final decisions rest with IRCC.

We've got your back, [Name]! 🍁"

STEP 6 — When client says CALL ME:
"On it! 📞 We'll give you a call shortly.
Best time to call?
Anything specific you want us to prepare?

If you need us right away: +1 604-653-5031"

═══════════════════════════════════════════════
CRITICAL RULES (NEVER BREAK THESE):
═══════════════════════════════════════════════

❌ NEVER mention $52.50 consultation for Work Permit, Study Permit, or Visit Visa cases.
   ONLY PR / Sponsorship / Caregiver / Home Care Worker need consultation.

❌ NEVER promise specific timing like "1 business day", "2 weeks", "you'll get approved in X days".
   Just say "Our processing team will reach out to you" — no timeline.

❌ NEVER invent fees. Only quote fees that appear in the FEE SCHEDULE above.
   If a service isn't listed, say: "Let me have our team confirm exact pricing for that — would you like a callback?"

❌ NEVER dump all fees / all services in one message. ONE service at a time.

❌ NEVER promise visa outcomes ("you'll be approved", "guaranteed").

✅ Use emojis appropriately (🛂 📚 🇨🇦 ✈️ 🎓 ✅ 🤝 🍁 etc.) — Newton's style is warm.
✅ Use **bold** for fees, names, and key info.
✅ Use ✅ for checklist items, ✓ for eligibility items, 1️⃣ 2️⃣ 3️⃣ for steps.
✅ Match client's language (English/Punjabi).
✅ ALWAYS mention WhatsApp calls don't work + direct line +1 604-653-5031 in welcome.
✅ Keep replies focused — one purpose per message.

═══════════════════════════════════════════════
EXAMPLES OF PERFECT RESPONSES:
═══════════════════════════════════════════════

Client: "PGWP"
Reply:
"Perfect, let's talk PGWP 🎓

**Quick eligibility check** — to qualify, you should:
✓ Have completed a study program at a designated learning institution (DLI)
✓ Program length was at least 8 months
✓ Apply within 180 days of getting your final marks
✓ Currently in Canada with valid status

If any of these are unclear, totally normal! We can call you back — just reply 'CALL ME' with your best time, or call us: +1 604-653-5031.

If you're good to go, just say YES and I'll send you the document checklist + fee 😊"

Client: "Yes"
Reply:
"Awesome! 🎓 Here's what we need for your PGWP:

📁 **Documents Checklist**
✅ College Completion Letter
✅ Official Transcripts
✅ Valid Study Permit
✅ Passport (all pages including stamps)
✅ Digital Photo (passport-style)
✅ Employment Details (if working)
✅ Language Test results (IELTS/CELPIP — if available)

💰 **Fee: $315** (includes tax)

Ready to get started? Just reply with your **full name** and we'll move forward 🚀"

═══════════════════════════════════════════════

RESPONSE FORMAT: Reply ONLY with the WhatsApp message to send. No JSON, no preamble like "Here's the reply:" — just the message itself.`,
      messages: [
        ...(sessionData.history || []).slice(-8),
        { role: "user", content: message }
      ]
    })
  });

  let reply = "Thank you for contacting Newton Immigration! 🍁 How can we help you today?";
  if (aiRes.ok) {
    const aiData = await aiRes.json() as any;
    reply = aiData.content?.[0]?.text || reply;
  }

  sessionData.history = [
    ...(sessionData.history || []).slice(-8),
    { role: "user", content: message },
    { role: "assistant", content: reply }
  ];
  sessionData.stage = "active";
  if (contactName) sessionData.name = contactName;
  await saveMarketingSession(phone, sessionData);

  await sendMarketingMessage(phone, reply);
  await saveMarketingMessage(phone, reply, "outbound");

  // Promote stage 'new' -> 'contacted' since AI replied
  try {
    await pool.query(
      `UPDATE marketing_leads SET stage = 'contacted', updated_at = NOW() WHERE phone = $1 AND stage = 'new'`,
      [phone]
    );
  } catch (e) { /* ignore */ }

  // Notify staff
  try {
    const { addNotification, listUsers } = await import("@/lib/store");
    const users = await listUsers(COMPANY_ID);
    const admins = users.filter((u: any) => ["Admin", "Marketing", "ProcessingLead"].includes(u.role));
    for (const admin of admins.slice(0, 3)) {
      await addNotification({
        companyId: COMPANY_ID,
        userId: admin.id,
        type: "ai_alert",
        message: `📣 Marketing inquiry from ${contactName || phone}: "${message.slice(0, 60)}..."`
      });
    }
  } catch (e) { /* ignore */ }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const body = await request.json() as any;
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.[0]) return NextResponse.json({ status: "ok" });

    const message = value.messages[0];
    const from = message.from;
    const msgType = String(message?.type || "text"); // text, image, document, audio
    const text = message.text?.body || "";
    const contact = value.contacts?.[0];
    const contactName = contact?.profile?.name || "";
    // Click-to-WhatsApp ads include `referral` with source_url, headline, etc.
    const referral = message?.referral?.source_id || message?.referral?.headline || "";

    if (text && from) {
      await handleMarketingMessage(from, text, contactName, referral);
    } else if (from && (msgType === "image" || msgType === "document" || msgType === "audio")) {
      // ── Inbound media on marketing number ──
      // Save a placeholder row immediately so it shows up in the inbox.
      // Then async: download from Meta → save to S3 → update placeholder
      // with the full `[doc:...|s3=...]` format so the download button works.
      // Same flow as the processing webhook handles inbound media.
      const msgId = `mkt-in-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const docKind = msgType === "image" ? "image" : msgType === "audio" ? "audio" : "document";
      const docCaption = String(message[msgType]?.caption || message[msgType]?.filename || "").trim();
      const captionPart = docCaption ? `|caption=${encodeURIComponent(docCaption)}` : "";
      const placeholder = `[doc:${msgId}|kind=${docKind}|pending=1${captionPart}]`;

      await ensureLead(from, contactName);
      await saveMarketingMessage(from, placeholder, "inbound", contactName);

      // ── Async: download + S3 upload + row update ──
      // Don't await — webhook needs to return 200 to Meta within ~5s.
      (async () => {
        try {
          const mediaObj = message[msgType];
          if (!mediaObj?.id) return;

          // Download from Meta. Two-step: get URL → fetch bytes.
          const urlRes = await fetch(`https://graph.facebook.com/v18.0/${mediaObj.id}`, {
            headers: { Authorization: `Bearer ${WA_TOKEN}` }
          });
          const urlData: any = await urlRes.json().catch(() => ({}));
          if (!urlData?.url) return;

          const fileRes = await fetch(urlData.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
          const buffer = Buffer.from(await fileRes.arrayBuffer());
          const mimeType: string = urlData.mime_type || "application/octet-stream";

          const { putObjectToS3, isS3StorageEnabled, normalizeFilename } = await import("@/lib/object-storage");
          if (!isS3StorageEnabled()) return;

          const extMap: Record<string, string> = {
            "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
            "image/heic": "heic", "application/zip": "zip", "video/mp4": "mp4",
            "audio/ogg": "ogg", "audio/mpeg": "mp3",
          };
          const ext = extMap[mimeType] || (mimeType.split("/")[1] || "bin").slice(0, 6);
          const safeName = normalizeFilename(mediaObj.filename || `marketing-${from}-${Date.now()}.${ext}`);
          const s3Key = `companies/newton/marketing-inbound/${Date.now()}-${safeName}`;

          await putObjectToS3({ key: s3Key, content: buffer, contentType: mimeType });

          const finalName = (mediaObj.filename || safeName).replace(/\|/g, "");
          const updatedPlaceholder = `[doc:${msgId}|kind=${docKind}|name=${encodeURIComponent(finalName)}|mime=${encodeURIComponent(mimeType)}|s3=${encodeURIComponent(s3Key)}${captionPart}]`;

          await pool.query(
            `UPDATE marketing_inbox SET message = $1 WHERE id = $2`,
            [updatedPlaceholder, msgId]
          );
        } catch (e) {
          console.error("Marketing inbound media S3 save failed:", (e as Error).message);
        }
      })();
    }

    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error("Marketing WA error:", e);
    return NextResponse.json({ status: "ok" });
  }
}
