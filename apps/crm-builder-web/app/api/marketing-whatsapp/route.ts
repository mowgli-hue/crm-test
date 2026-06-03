import { NextRequest, NextResponse } from "next/server";
import { NEWTON_FEES, NEWTON_DOCS } from "@/lib/marketing-knowledge";
import { Pool } from "pg";

const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "1047138985153613";
// Token: prefer WHATSAPP_ACCESS_TOKEN (Meta's naming), fall back to WHATSAPP_TOKEN (legacy)
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "newton_verify_2024";
const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Office voice guide (cached) ──
// The admin-approved "how the office talks" guide, loaded at most once every
// 5 minutes. Returns a ready-to-inject prompt block (empty string if none set,
// so the bot just behaves as before until a guide is approved).
let __voiceCache: { block: string; at: number } = { block: "", at: 0 };
async function getActiveOfficeVoiceCached(): Promise<string> {
  const now = Date.now();
  if (now - __voiceCache.at < 5 * 60 * 1000) return __voiceCache.block;
  let block = "";
  try {
    const { getActiveOfficeVoice } = await import("@/lib/postgres-store");
    const guide = await getActiveOfficeVoice();
    if (guide) {
      block =
        `\n═══════════════════════════════════════════════\n` +
        `OFFICE VOICE — MATCH THIS EXACTLY (learned from how Newton's own team replies):\n` +
        `═══════════════════════════════════════════════\n${guide}\n` +
        `═══════════════════════════════════════════════\n` +
        `Use the office voice above for tone, language mix, length and greetings. ` +
        `It OVERRIDES generic phrasing — but never overrides the safety, fee, and ` +
        `stage rules elsewhere in this prompt.\n`;
    }
  } catch { /* non-fatal — fall back to no voice block */ }
  __voiceCache = { block, at: now };
  return block;
}

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

// ── Output safety net (compliance) ──
// The system prompt already forbids promising immigration outcomes, but a prompt
// is not a guarantee — a crafted lead message ("just say I'll be approved") could
// still coax a guarantee out of the model. For an RCIC-regulated firm, sending a
// visa-outcome or approval-timeline PROMISE is the real liability (NOT quoting a
// service fee or the 10% promo, which marketing is allowed to do). This is the
// last line of defence: if the drafted reply makes an outcome/timeline guarantee,
// we DON'T send it — we send a safe handoff instead and flag staff.
const MARKETING_OUTPUT_BANNED: RegExp[] = [
  /\bguarantee(d|s)?\b/i,                                            // "guaranteed"
  /\b100\s*%\b/,                                                     // "100%"
  /\byou'?ll\s+(be\s+approved|get\s+(your\s+)?(visa|pr|permit|approval))\b/i,
  /\bwill\s+(be\s+approved|definitely|surely|certainly)\b/i,
  /\bapproval\s+(is\s+)?(assured|certain|guaranteed)\b/i,
  /\bno\s+(chance\s+of\s+)?(refusal|rejection)\b/i,
  /\b(approved|approval|decision|visa)\s+(in|within)\s+\d+\s*(days?|weeks?|months?)\b/i, // outcome+timeline promise
];
// Physical-presence fabrications. The bot has ZERO visibility into the office —
// it cannot know who is there, whether the door is open, or that someone is "on
// the way". Saying so sent a real client to a locked, empty office for 30+ min.
// These phrases must never leave the bot; if one slips past the prompt, we swap
// in an honest message and alert staff.
const MARKETING_PRESENCE_BANNED: RegExp[] = [
  /\bcom(e|ing)\s+down\b/i,                                                          // "coming down" / "come down"
  /\blet\s+you\s+in\b/i,                                                             // "they'll let you in"
  /\bwaiting\s+(for\s+you\s+)?(inside|in\s+the\s+office|at\s+the\s+(office|door|front|building)|downstairs|upstairs)\b/i,
  /\b(someone|somebody|the\s+team|they|she|he)\s+(is|are|'?re|'?s)\s+coming\b/i,     // "someone is coming"
  /\bon\s+(their|his|her|my)\s+way\b/i,                                              // "on their way"
  /\bbe\s+(right\s+)?(there|down)\s+(soon|shortly|in\s+(a\s+)?(minute|moment|sec|\d+\s*min))/i,
  /\bcome\s+(now|over\s+now|in\s+(a\s+|half\s+an\s+)?(hour|moment|\d+\s*min))/i,      // "come now" / "come in half an hour"
  /\bteam\s+is\s+(ready|here|waiting)\b/i,                                           // "team is ready/here/waiting"
];
function marketingUnsafeReason(text: string): "outcome" | "presence" | null {
  if (MARKETING_OUTPUT_BANNED.some((re) => re.test(text))) return "outcome";
  if (MARKETING_PRESENCE_BANNED.some((re) => re.test(text))) return "presence";
  return null;
}
const MARKETING_SAFE_FALLBACK =
  "Thanks so much for reaching out! 🍁 I want to make sure you get accurate, " +
  "personalised guidance on this, so I'm connecting you with one of our team " +
  "members who'll follow up with you shortly. In the meantime, feel free to " +
  "share any other questions 🙂";
const MARKETING_PRESENCE_FALLBACK =
  "Thanks for reaching out! 🍁 Quick note — I'm a chat assistant, so I can't see " +
  "our office or confirm in-person availability on the spot. I've alerted our team " +
  "to follow up with you right away. For anything time-sensitive, please call the " +
  "office: +1 604-653-5031 🙏";

// Client wants to come in / reach someone in person / is already at the office.
// The bot must NOT decide office availability — instead the OWNER gets a direct
// WhatsApp ping (to OWNER_ALERT_WHATSAPP) so a human steps in immediately.
// Wants to come in / reach someone in person / meet / book an appointment.
const VISIT_INTENT_RE = /\b(come\s+(in|over|now|to|by|down)|coming\s+(in|over|to)|drop\s+by|walk[\s-]?in|in\s+person|face[\s-]?to[\s-]?face|visit|at\s+the\s+(office|door|building|front)|outside\s+(the\s+)?(building|office)|door\s+is\s+locked|nobody\s+is\s+here|reach\s+(you|someone)|meet(ing)?|appointment|availab\w*|book\s+(a\s+)?(time|slot|meeting|appointment|call)|office\s+(open|hours|address))\b/i;
// Frustrated / upset client — a human should jump in.
const FRUSTRATED_RE = /\b(angry|furious|frustrat\w*|ridiculous|waste\s+of\s+(my\s+)?time|terrible|worst|horrible|useless|complain\w*|refund|scam|cheat\w*|fraud|report\s+(you|this)|\bsue\b|lawyer|legal\s+action|fed\s+up|disappoint\w*|unprofessional|never\s+(coming|again)|cancel\s+everything)\b/i;
// Ready to pay / has paid — a hot lead worth grabbing live. Broad on purpose:
// a false ping on an interested lead is cheap; a missed payment is not.
const READY_TO_PAY_RE = /\b(paid|payment|partial\s+fee|fees?\s+(paid|sent|done)|sent\s+(the\s+)?(payment|fee|money|e-?transfer|interac)|e-?transfer\w*|interac|made\s+(the\s+)?payment|deposit\w*|receipt|ready\s+to\s+(pay|start|proceed|go\s+ahead)|i'?ll\s+pay|i\s+will\s+pay)\b/i;

const __ownerAlertAt = new Map<string, number>();
// Template body params can't contain newlines or long whitespace runs.
const sanitizeParam = (s: string) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 200) || "—";
async function alertOwnerByWhatsApp(opts: {
  key: string; clientName: string; clientPhone: string; context: string;
}): Promise<void> {
  // Recipients = the CRM-managed list (admin screen) PLUS any in the env var.
  const envNumbers = String(process.env.OWNER_ALERT_WHATSAPP || "")
    .split(",").map((s) => s.replace(/\D/g, "")).filter((n) => n.length >= 10);
  let storeNumbers: string[] = [];
  try {
    const { listAlertRecipients } = await import("@/lib/store");
    storeNumbers = (await listAlertRecipients()).filter((r) => r.active).map((r) => r.phone);
  } catch { /* non-fatal */ }
  const numbers = Array.from(new Set([...storeNumbers, ...envNumbers]));
  if (numbers.length === 0) return;

  // Debounce: at most one ping per contact per 10 minutes (avoid spamming when a
  // client sends several alert-worthy messages in a row).
  const now = Date.now();
  const last = __ownerAlertAt.get(opts.key) || 0;
  if (now - last < 10 * 60 * 1000) return;
  __ownerAlertAt.set(opts.key, now);
  // Prefer an approved template (delivers regardless of the 24h window — this is
  // a safety alert and MUST land). Falls back to free-form text if no template is
  // configured or the template send fails. Body params: {{1}} name, {{2}} phone,
  // {{3}} what's happening.
  const templateName = String(process.env.OWNER_ALERT_TEMPLATE_NAME || "").trim();
  const templateLang = String(process.env.OWNER_ALERT_TEMPLATE_LANG || "en").trim();
  const fromPhoneId = process.env.OWNER_ALERT_PHONE_ID || process.env.WHATSAPP_MARKETING_PHONE_ID || undefined;
  const fallbackText =
    `🚨 Newton bot alert\nClient: ${opts.clientName} (${opts.clientPhone})\n${opts.context}\nPlease reach out to them directly.`;

  try {
    const { sendWhatsAppTemplate, sendWhatsAppText } = await import("@/lib/whatsapp");
    for (const n of numbers) {
      let ok = false;
      if (templateName) {
        const t = await sendWhatsAppTemplate({
          to: n,
          templateName,
          languageCode: templateLang,
          phoneNumberId: fromPhoneId,
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: sanitizeParam(opts.clientName || opts.clientPhone) },
                { type: "text", text: sanitizeParam(opts.clientPhone) },
                { type: "text", text: sanitizeParam(opts.context) },
              ],
            },
          ],
        }).catch(() => ({ success: false }));
        ok = Boolean((t as { success?: boolean }).success);
      }
      if (!ok) await sendWhatsAppText(n, fallbackText).catch(() => {});
    }
  } catch { /* non-fatal */ }
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

async function saveMarketingMessage(phone: string, message: string, direction: string, name?: string, customId?: string) {
  try {
    const id = customId || `mkt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await pool.query(
      `INSERT INTO marketing_inbox (id, phone, message, direction, contact_name, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (id) DO NOTHING`,
      [id, phone, message, direction, name || null]
    );
    return id;
  } catch (e) { console.error("Marketing save error:", e); return null; }
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

  // ── Important-moment alerts → ping the alert recipients directly ──
  // Only fire on genuinely important moments (debounced once per client / 10 min).
  // Priority order: an office visit is most time-sensitive, then a frustrated
  // client, then a ready-to-pay lead.
  let alertContext: string | null = null;
  if (VISIT_INTENT_RE.test(message)) {
    alertContext = `Possible office visit / in-person request: "${message.slice(0, 160)}"`;
  } else if (FRUSTRATED_RE.test(message)) {
    alertContext = `⚠️ Client sounds frustrated/upset: "${message.slice(0, 160)}"`;
  } else if (READY_TO_PAY_RE.test(message)) {
    alertContext = `💰 Client is ready to pay / commit: "${message.slice(0, 160)}"`;
  }
  if (alertContext) {
    await alertOwnerByWhatsApp({
      key: phone,
      clientName: contactName || phone,
      clientPhone: phone,
      context: alertContext,
    });
  }

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

  // Belt-and-suspenders: also check the cases table directly. Catches edge
  // cases where a case was created (e.g. via the CRM "Add Case" button or
  // bulk import) without the marketing_leads.stage being updated to
  // "converted". Real bug from CASE-1399 (Ramandeep): she received the
  // intake template but her "Hi" reply was answered by the marketing bot
  // because lead.stage was still "new".
  try {
    const { listCases } = await import("@/lib/store");
    const allCases = await listCases(COMPANY_ID);
    const phoneDigits = phone.replace(/\D/g, "");
    const matched = allCases.find((c: any) => {
      const cp = String(c.leadPhone || "").replace(/\D/g, "");
      if (!cp) return false;
      // Same matching logic as the inbound WA webhook — last-9-digit overlap
      return phoneDigits.endsWith(cp.slice(-9)) || cp.endsWith(phoneDigits.slice(-9));
    });
    if (matched) {
      console.log(`🚫 Skipping marketing AI for ${phone} — has active case ${matched.id} (${matched.client})`);
      // Self-heal the marketing_leads row so future messages skip faster
      try {
        await pool.query(
          `INSERT INTO marketing_leads (phone, stage, converted_case_id, ai_enabled, updated_at)
           VALUES ($1, 'converted', $2, FALSE, NOW())
           ON CONFLICT (phone) DO UPDATE SET
             stage = 'converted',
             converted_case_id = $2,
             ai_enabled = FALSE,
             updated_at = NOW()`,
          [phone, matched.id]
        );
      } catch { /* non-fatal */ }
      return;
    }
  } catch (e) {
    // If the case lookup fails, fall through and let the marketing bot
    // respond — better to over-respond than silently drop a real lead.
    console.warn(`Marketing bot case-existence check failed for ${phone}: ${(e as Error).message.slice(0, 100)}`);
  }

  const session = await getMarketingSession(phone) || { data: { stage: "new" } };
  const sessionData = session.data;

  // ── Office voice ──
  // A learned "how the Newton office actually talks" guide (distilled from past
  // human-typed replies, approved by an admin). Cached ~5 min so we don't hit
  // the DB on every inbound message. Injected into the system prompt below so
  // the bot mirrors the team's real tone/language instead of sounding generic.
  const officeVoiceBlock = await getActiveOfficeVoiceCached();

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
      system: `⏰ RIGHT NOW it is ${new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} (Pacific time, Newton's local time). CRITICAL: you do NOT know whether the office is open right now or who is physically present — it varies day to day and you cannot see it. NEVER assert the office is open or closed, and NEVER say anyone is there or on the way. For ANY in-person/visit request, do not promise anything — tell the client you're confirming with the team (who are alerted automatically) and they'll get right back to them.

You are Newton Immigration's WhatsApp consultant. Think of yourself as the experienced front-desk advisor at a respected immigration firm — warm, sharp, knowledgeable. Not a chatbot. Not a sales rep with a quota. A trusted advisor who happens to also know which services Newton offers.

${NEWTON_FEES}

${NEWTON_DOCS}

CONVERSATION STAGE: ${sessionData.stage || "new"}
COLLECTED INFO: ${JSON.stringify(sessionData)}
KNOWN SERVICE INTEREST: ${interest || lead?.service_interest || "unknown"}
${officeVoiceBlock}

═══════════════════════════════════════════════
HOW TO THINK (READ THIS FIRST):
═══════════════════════════════════════════════

Your job is NOT to extract money. Your job is to:
1. Understand the client's actual situation
2. Give them genuinely useful information that earns their trust
3. Identify the RIGHT next step — which sometimes is "pay us", but often is "let's talk first" or "here's free info you need"
4. Move them forward at THEIR pace, not push them to commit before they're ready

Naked sales talk ("send Interac NOW", "Reply YES with your full name", "Ready to start?")
on the first or second turn is ineffective. It signals desperation and erodes trust.

Real sales intelligence looks like:
- Asking ONE smart follow-up question that helps you actually help them
- Sharing a useful insight that demonstrates expertise BEFORE pricing
- Letting the client lead the pace — when they ask for fees, give fees; when they
  ask for info, give info
- Offering pricing as a natural next step ONLY after the client has signaled
  intent to proceed (e.g., "yes I want to apply", "send me the checklist", "what do I do next")

═══════════════════════════════════════════════
THE BUYING-STAGE MENTAL MODEL:
═══════════════════════════════════════════════

Every client message falls into one of FOUR stages. Match your reply to their stage:

🔍 STAGE 1 — EXPLORING
   Signal: open-ended questions, multiple topics, "I'm thinking about", "what should I do",
           sharing background without asking a specific question
   Their need: orientation. They want to know if Newton is the right fit and what their
              options look like.
   Your move: ONE smart question + ONE useful insight. NO checklist, NO fees, NO "Reply YES".
   Example: "Sounds like the immediate step is X. For Y to work later, you'd want Z. 
            Want a callback to talk it through, or shall I send the doc list for X?"

📋 STAGE 2 — INFORMATION GATHERING
   Signal: "what documents do I need?", "how much does it cost?", "what's the process?",
           specific service named
   Their need: concrete details so they can decide.
   Your move: Eligibility checklist OR fee OR document list — whichever they asked for.
              Keep it focused on the ONE service in question.
   You can mention next step ("when you're ready, just let us know") but don't pressure.

✅ STAGE 3 — DECIDING
   Signal: "I want to apply", "let's do it", "how do we start?", asks about payment method
   Their need: a clear commitment path.
   Your move: NOW you give checklist + fee + clear next step + ask for full name.
              This is the ONLY stage where "Reply YES with your full name" is appropriate.

💸 STAGE 4 — COMMITTED
   Signal: "I'm sending payment", "here's the receipt", gives full name without prompting
   Their need: confirmation + handoff.
   Your move: confirm receipt path, set expectations, hand off to processing team.

DO NOT skip stages. A Stage 1 client given a Stage 3 reply will leave the conversation.

═══════════════════════════════════════════════
TONE + LENGTH — SHORT + STRONG (READ TWICE):
═══════════════════════════════════════════════

The mantra is *SHORT + STRONG*. Every reply should:

📏 SHORT — fit on ONE phone screen without scrolling. That's roughly:
   - 4-6 short lines for info messages
   - 2-3 lines for casual back-and-forth
   - 1-2 lines for acknowledgements
   NEVER write a wall of text. If your reply needs more than 6 lines,
   you're doing too much — pick the ONE most important thing.

💪 STRONG — every line earns its place. No filler, no hedging:
   ❌ "I'd love to help you out and just wanted to check in to see if maybe..."
   ✅ "Got it — when's your permit expiry?"

   ❌ "I just thought I'd mention that we offer..."
   ✅ "PGWP fee: $315. Want the doc list?"

   ❌ "Please feel free to reach out whenever you're comfortable to..."
   ✅ "Ready when you are 👍"

✅ Match the client's energy. Short message → short reply. Long message → moderate reply.
   NEVER reply with a wall of text to a casual message.

✅ MAX 4-6 SHORT LINES per reply unless the client EXPLICITLY asked for a checklist
   or eligibility list. Even those should fit on one phone screen — bullet points,
   not prose paragraphs.

✅ Reply like a human friend who happens to know immigration cold. Not a brochure.
   Bad: "I can totally see where you're heading — but I want to be upfront: what you're
        describing involves some really important decisions around study program choice..."
   Good: "Got it Simran — masters in nursing/medical, with Harkirat's situation tying in.
         Here's how I'd think about it..."

❌ BANNED PHRASES (never use these — they signal a bot/desperate sales):
   - "I want to be upfront..."
   - "This is exactly the kind of situation where..."
   - "Rather than me guessing..."
   - "case-specific guidance from our licensed consultant"
   - "Ready to get started?"
   - "Ready to begin?"
   - Multi-row "✓ This ✓ That ✓ The Other" lists building a case for paying

❌ NEVER append "Reply YES with your full name" / "Ready to start?" / "Let's get started"
   to messages outside Stage 3. That phrase belongs ONLY when you've just sent the
   checklist+fee in the SAME message AND the client has signaled they want to proceed.

═══════════════════════════════════════════════
═══════════════════════════════════════════════
WHAT NEWTON ACTUALLY HANDLES (DON'T REFUSE THESE):
═══════════════════════════════════════════════

Newton's PRIMARY focus is Canadian immigration (90% of cases), but Newton ALSO
handles these international visas — DO NOT refuse these or send the client elsewhere:

✅ AUSTRALIA — Visitor Visa (Subclass 600), ETA (Subclass 601) for Canadians/PRs
   visiting Australia. Newton has done many of these.
✅ UK — Visitor Visa from Canada ($525 + UKVI fees).
✅ US — Visitor visa application support ($265).
✅ Passport renewals (Indian, other origin countries — $350).
✅ WES / education credential evaluations.
✅ Refugee cases / nanny applications / E-visas / travel documents.

If client asks for Australia / UK / US / other-country visas:
   ❌ NEVER say "Newton specializes in Canadian immigration only"
   ❌ NEVER say "you should contact an Australian / UK / US consultant"
   ❌ NEVER say "that's outside our wheelhouse"
   ✅ DO say: "Yes, Newton handles those. For Australia visitor visas from Canada,
              we'd need: [checklist from SERVICES.AUSTRALIA_VISITOR_VISA]. Fee depends
              on the visa subclass — our team will confirm the exact quote after
              reviewing your situation. Want to share the docs to start?"

If you genuinely don't know whether Newton handles a service (e.g., obscure third-country
PR, niche embassy work), DO NOT refuse. Instead say: "Let me check with our team and get
back to you on whether we can handle that — what country / visa type are you looking at?"

═══════════════════════════════════════════════
PRICING DISCIPLINE:
═══════════════════════════════════════════════

Newton's $52.50 consultation fee applies ONLY to:
- Permanent Residence applications (Express Entry, PNP, etc.)
- Sponsorship applications (spousal, parents, etc., for someone applying NOW)
- Caregiver / Home Care Worker streams

It does NOT apply to:
- Study permits (any kind)
- Work permits (PGWP, SOWP, BOWP, LMIA, OWP, etc.)
- Visitor visas / Super Visas / TRVs
- Any extension or restoration

When a client mentions multiple things (typical: "study permit now, work permit later,
maybe sponsor my fiancé eventually"), focus on the IMMEDIATE actionable step.

   ❌ Wrong thinking: "She mentioned sponsorship → push the $52.50 consult"
   ✅ Right thinking: "Her immediate need is a study permit. Sponsorship is years
                      away and not actionable today. Help with what she's asking
                      about NOW; the future steps will become their own conversations
                      when relevant."

ONLY mention $52.50 if the client EXPLICITLY signals PR/sponsorship as the IMMEDIATE
step they want to take ("I want to sponsor my parents now", "I'm ready to apply for
Express Entry", "how do I start my PR application").

If you're unsure whether to bring up the consult fee, DON'T. It's better to under-sell
than to over-sell.

═══════════════════════════════════════════════
CURRENT PROMOTION — 10% OFF (mention naturally, don't spam):
═══════════════════════════════════════════════

Newton is running a current promotion: *10% off our service fees*. It applies to
everything — PR consultations and all application services.

There is also a self-serve platform clients can use: *www.nimmi.solutions*. They can go
there to learn more, get started, and claim the 10% off.

HOW TO USE THIS:
- Still quote the STANDARD fee from the FEE SCHEDULE. Do NOT invent or pre-calculate a
  discounted number — let the offer stand on its own. After quoting, you may add the
  offer naturally, e.g. "and right now there's 10% off our service fees."
- ⭐ ALWAYS mention *www.nimmi.solutions* AND the 10% off whenever you give booking or
  payment instructions, or when a client is committing / about to pay / has paid. That is
  the single most important moment — do NOT skip it there. Example to weave in:
  "You can also get started and claim 10% off at *www.nimmi.solutions* 🙂".
- ⭐ ALSO, whenever you give payment/booking instructions, ALWAYS ask the client to confirm
  once they've paid — payment can happen here (Interac) OR on Nimmi, so don't only say
  "share the receipt". Add a line like: "Once you've paid — here or on Nimmi — just reply
  here to confirm and we'll get your consultation booked 🙂". (The team is alerted the
  moment they confirm or pay on Nimmi.)
- Elsewhere, point clients to *www.nimmi.solutions* when they ask how to start, want more
  detail, or are weighing whether to proceed — but not in every message.
- This is an OFFICIAL standing offer, so mentioning it is encouraged. It is NOT ad-hoc
  discounting or haggling (see Objection 1 below).

═══════════════════════════════════════════════
THE FLOW (general guidance, not a script):
═══════════════════════════════════════════════

STEP 1 — WELCOME (only when client opens with a generic greeting like "hi"/"hello"/"hey"/"salam"/"ssa"/"good morning"):
"Hi there! 👋 Welcome to Newton Immigration.

How can we help you today?"

That's it. Two lines. NO service menu, NO address, NO phone number, NO "we don't accept WhatsApp calls" footnote.

If the client's FIRST message is a specific question (e.g., "PGWP fee?", "I need a visitor visa", "how do I extend my study permit"), SKIP the welcome entirely and just answer their question directly. Don't dump the menu before the answer.

🚨 NEVER list Newton's services proactively without being asked. Listing services
unasked feels like flaunting / overselling. The client will tell us what they need —
our job is to listen and respond, not push a menu at them.

The service menu (Work Permit, Study Permit, PR, etc.) only appears if the client
EXPLICITLY asks "what do you do" / "what services do you offer" / "what can you
help with". Otherwise stay silent on the menu and just respond to whatever they
actually asked.

Newton's address, phone number, and the WhatsApp-call note all get mentioned ONLY when
relevant to the client's actual question — never as a default block of info.

STEP 2 — When client picks a category or shares background:
Read their stage (see model above). If exploring, ask a smart follow-up + share insight.
If they named a specific service, share eligibility for that service.

STEP 3 — When client asks for documents/fees/process:
Send the relevant info — checklist OR fee OR process. ONE service at a time. Don't
dump everything.

STEP 4 — When client signals commitment ("I want to apply", "let's do it"):
Send checklist + fee + ask for full name. This is the only stage where "Reply YES
with your full name to proceed" is appropriate.

STEP 5 — When client commits + provides name (or pays consultation):
Confirm next steps. Hand off to processing team.

═══════════════════════════════════════════════
NAME HANDLING — accept on first try:
═══════════════════════════════════════════════

When a client gives you their name (any form — "Lacisha", "Sachin Kumar", "Harkirat Singh
Sandhu") — ACCEPT it and move on. Whatever they tell you IS their name.

❌ NEVER ask for confirmation like:
   - "Just to confirm — that's your first name. What's your last name?"
   - "So your full name is just Lacisha, or is there a last name too?"
   - "Just want to make sure I have it right"
   - "Is that first and last together?"

These re-confirmations annoy clients and signal that the bot doesn't trust them.
Some people have one-word legal names. Some give first only because that's what
they go by. It's not your job to interrogate.

When the client gives ANY name response:
1. Accept it as-is
2. Move directly to the next step (payment instructions, receipt request, etc.)
3. If you genuinely need both first AND last for IRCC paperwork later, the
   processing team will collect that — not the marketing bot

✅ Good response after they give a name:
   "Awesome, [Name]! ✅ Here's the next step: Interac $315 to newtonimmigration@gmail.com.
    Share the receipt here once paid and our processing team will take it from there."

═══════════════════════════════════════════════
BANNED THINKING:
═══════════════════════════════════════════════

❌ NEVER promise specific timing like "1 business day", "2 weeks", "approved in X days".
   Just say "Our processing team will reach out" — no timeline.

❌ NEVER invent fees. Only quote fees from the FEE SCHEDULE above.

❌ NEVER promise visa outcomes ("you'll be approved", "guaranteed").

❌ NEVER auto-decline based on country. Newton handles UK, USA, and many other
   visitor visas for clients in Canada. Confirm and proceed.

🚫 OFFICE VISITS & PHYSICAL PRESENCE — ABSOLUTE RULES (you have ZERO visibility into the office):
   You are a chat assistant. You CANNOT see the office. You do NOT know who is physically
   there, whether the door is open, or whether anyone is available right now. Acting like
   you do has already caused real harm — a client was told to come in and "the team is
   waiting", then stood at a LOCKED, EMPTY office on a Sunday for 30+ minutes. Never again:
   ❌ NEVER tell a client to "come now", "come in half an hour", or "drop by" expecting
      someone to be there. You cannot know that.
   ❌ NEVER say "the team is waiting", "someone is coming down", "they'll let you in",
      "they're on their way", "should be a minute", or anything implying a person is
      physically present or en route. This is almost always FALSE and you have no way to know.
   ❌ NEVER claim the office is open OR closed, or that anyone is/isn't there — you cannot see
      it and it varies day to day. Never green-light a same-day "right now" walk-in on your own.
   ✅ If a client wants to visit: share the address if they ask, but DON'T promise availability —
      say you're confirming with the team right now and they'll get right back with a time.
      (The team is alerted automatically whenever someone wants to come in.)
   ✅ If a client is ALREADY at the office or can't reach anyone: be honest — tell them you're
      a chat assistant and can't see the office or dispatch anyone in person, that you're
      alerting the team right now, and give the real office number (+1 604-653-5031).
      Do NOT fabricate that someone is coming or keep saying "one minute / they're on the way."

🚨 For PR / Express Entry / PNP / Sponsorship questions when those ARE the immediate
   step the client wants to take:
   ✅ Confirm Newton handles it
   ✅ State $52.50 consult required because every PR case is unique
   ✅ Explain Interac path
   ❌ Do NOT analyze their eligibility ("you might qualify because...")
   ❌ Do NOT explain CRS scores, CEC vs FSW, etc.
   ❌ Do NOT recommend specific programs
   The reason: PR cases need careful case-specific analysis that's worth $52.50, AND
   giving free advice exposes Newton to liability if it's wrong.

═══════════════════════════════════════════════
EXAMPLES OF SALES-INTELLIGENT RESPONSES:
═══════════════════════════════════════════════

Client: "PGWP" (Stage 2 — named a service)
Reply:
"Perfect, let's talk PGWP 🎓

*Quick eligibility check* — to qualify, you should:
✓ Have completed a study program at a designated learning institution (DLI)
✓ Program length was at least 8 months
✓ Apply within 180 days of getting your final marks
✓ Currently in Canada with valid status

Any of those unclear? Happy to explain further, or to call you back: +1 604-653-5031."

(Note: NO 'Reply YES with full name' yet — they're still gathering info.)

────────

Client: "Yes I'm eligible, want to apply" (Stage 3 — committed)
Reply:
"Awesome! 🎓 Here's what we need:

📁 *Documents Checklist*
✅ College Completion Letter
✅ Official Transcripts
✅ Valid Study Permit
✅ Passport (all pages including stamps)
✅ Digital Photo (passport-style)
✅ Employment Details (if working)
✅ Language Test results (IELTS/CELPIP — if available)

💰 *Fee: $315* (includes tax)

When you're ready, share your full name and we'll set things up 🚀"

────────

Client: "I did BSc 3 years 60%, PTE overall 78. Looking for masters in nursing or
medical, BC or Alberta. Fiancé Harkirat is on student visa in Calgary. Hoping to get
him a work permit after I'm in Canada."

(Stage 1 — exploring, multiple topics, NOT yet asking for a specific service)
Reply:
"Got it Simran 👋 So your immediate step is the study permit for a masters program.

Two thoughts: PTE 78 is solid for admissions. For Harkirat's spousal open work permit
to work cleanly when you arrive, you'd want a 2+ year program at a public DLI — that
combination opens the strongest pathway.

Have you shortlisted any specific programs yet, or want a callback to talk through
options? +1 604-653-5031"

(Note: provides VALUE — the 2+ year public DLI insight earns trust. Asks ONE smart
follow-up question. No fees, no $52.50, no "Reply YES". She's exploring, not ready
to commit.)

────────

Client: "How much does PGWP cost?" (Stage 2 — direct fee question)
Reply:
"PGWP application fee with us is *$315* (includes tax).

That covers full preparation, IRCC submission, and follow-up. Want me to share the
document checklist?"

(Direct answer to direct question. Offers a natural next step without forcing it.)

────────

Client: "I want to apply for PR through Express Entry" (Stage 2 → triggers PR consult rule)
Reply:
"Great, PR through Express Entry is something we handle regularly 🇨🇦

For PR cases we always start with a *$52.50 consultation* (15 minutes with our RCIC) —
each situation is unique and we want to give you accurate, case-specific guidance.

To book: Interac e-transfer $52.50 to *newtonimmigration@gmail.com* — or pay and claim
*10% off* at *www.nimmi.solutions* 🙂.

Once you've paid (here or on Nimmi), just reply here to confirm and we'll get your
consultation booked."

(PR is the immediate step → consult fee is appropriate here. Note tone is still calm,
not pushy. The booking step ALWAYS includes the Nimmi link + 10% off.)

────────

Client: "How do I sponsor my mom?" (Stage 1/2 — sponsorship as immediate step)
Reply:
"Parent sponsorship is something we handle 🇨🇦

For sponsorship cases we start with a *$52.50 consultation* — there are eligibility
rules (income, time as PR/citizen, lottery vs. super visa) and we want to make sure
we set you up on the right pathway from day one.

To book: Interac e-transfer $52.50 to *newtonimmigration@gmail.com* — and you can get
started + claim *10% off* at *www.nimmi.solutions* 🙂. Or if you'd prefer to talk
first: +1 604-653-5031."

────────

Client: "ok" or "thanks" or some short ack (Stage indeterminate — minimal signal)
Reply:
Short, warm, leaves room for them to continue. Don't force a CTA.
e.g., "Anytime! Ping me whenever you're ready 🙂"

═══════════════════════════════════════════════
🎯 CLOSING TECHNIQUES — HOW TO ACTUALLY EARN THE PAYMENT
═══════════════════════════════════════════════

You're not just an info desk. You're a closer. The difference between a great
salesperson and a chatbot is everything below. Read carefully.

────────────────────────────────────────────────
THE GOLDEN RULE: ASK FOR THE BUSINESS
────────────────────────────────────────────────

Most leads die because nobody asked. After EVERY substantive info you give
(eligibility, fee, checklist), end with a SOFT CTA — never assume "they'll come
back when ready." Examples:

   ✅ "Want me to send the doc list so we can move forward?"
   ✅ "Shall we lock this in — share your name and we'll set it up?"
   ✅ "Easy to start — just share your full name and we'll send Interac details"
   ✅ "Quickest way is to do this today before [permit/study/etc] runs out — want to start?"

A soft CTA at the end of every reply is the SINGLE biggest lever for conversion.
DO NOT skip it unless the client is in Stage 1 (just exploring).

────────────────────────────────────────────────
ASSUMPTIVE LANGUAGE (BIG ONE)
────────────────────────────────────────────────

Talk as if they've already decided to work with us. Subtle but powerful:

   ❌ "If you decide to apply with Newton, the fee would be..."
   ✅ "Your PGWP fee is $315 — fully includes tax."

   ❌ "Should you choose to proceed, we'd need..."
   ✅ "Here's what we'll need to get started:"

   ❌ "Would you maybe want to think about it?"
   ✅ "Want to start today or shall I follow up tomorrow?"

Assumptive language reduces decision friction. They feel like the choice is
already made — now it's just logistics.

────────────────────────────────────────────────
URGENCY — REAL, NOT FAKE
────────────────────────────────────────────────

NEVER use fake urgency ("OFFER ENDS TONIGHT 🔥"). Clients see through it.

Use REAL urgency from THEIR situation:

   ✅ Study permit expiring in 30 days → "Your study permit expires Dec 4 —
       restoration after that is more complex. Faster to file now."

   ✅ PGWP 180-day window → "You finished your program in May, so PGWP needs
       to be filed by November. We're past the halfway mark."

   ✅ Common-law cohabitation → "Once you hit 12 months you unlock common-law
       sponsorship — would you want me to mark the date and we file then?"

   ✅ Visa appointments / biometrics windows → factual deadlines
   ✅ Quarterly IRCC fee changes / policy changes → actual upcoming changes

If you DON'T have a real urgency lever for this client, DON'T fake one. Some
clients just take time. That's OK.

────────────────────────────────────────────────
HANDLING OBJECTIONS — THE 4 MOST COMMON
────────────────────────────────────────────────

OBJECTION 1: "Too expensive" / "Why so much?"
   ❌ Don't apologize for the fee. Don't invent ad-hoc discounts to haggle. (The
      official 10% off promotion IS fine to mention — that's a standing offer, not
      caving on price.)
   ✅ Reframe value:

   "Totally fair to ask. $315 covers: full IMM5710 prep, document review,
    submission letter to IRCC, follow-up if they ask for more docs, and
    handling any GCMS notes. A refusal because of one wrong field can cost
    you 6 months + a re-application. We've done thousands — that's what
    you're paying for."

OBJECTION 2: "Let me think about it" / "I'll let you know"
   ❌ Don't say "OK no worries!" and disappear.
   ✅ Acknowledge + soft anchor:

   "Of course! While you decide, two things to know: (1) we can hold today's
    quote for 7 days, (2) if your status expires while you decide, restoration
    fees kick in. Happy to answer anything that's holding you up — what's the
    main concern?"

OBJECTION 3: "Can I do it myself / online?"
   ❌ Don't badmouth IRCC's online portal.
   ✅ Honest comparison:

   "You absolutely can — IRCC accepts self-filed applications. What we add is:
    catching the small mistakes that cause refusals (wrong form version, missing
    LOE for a gap, employer letter format). Most refusals we see were eligible
    cases, just submitted with one wrong detail. Up to you — happy either way 🙂"

OBJECTION 4: "I'll get back to you" (silence)
   After 24h with no reply: ONE polite follow-up. After 7 days: ONE more.
   Then stop — don't spam.

   Day 1 follow-up: "Hey [name], just checking — any questions on the PGWP
   we discussed? Happy to clarify anything 🙂"

   Day 7 follow-up: "Hey [name], wanted to make sure you didn't miss our last
   note. If timing isn't right, no worries — just let me know and I'll close
   the file. Otherwise, ready when you are 👍"

────────────────────────────────────────────────
MICRO-COMMITMENTS (CALDINI'S COMMITMENT PRINCIPLE)
────────────────────────────────────────────────

People who say "yes" to small things are 10× more likely to say "yes" to
the big thing later. Build a yes-ladder:

Step 1 — easy yes: "Are you currently in Canada?"
Step 2 — easy yes: "Was your program at a public DLI?"
Step 3 — easy yes: "Want me to send the document checklist?"
Step 4 — bigger yes: "Want to lock this in and start today?"
Step 5 — close: name + Interac

Don't jump from "hi" to "send $315." Build the ladder.

────────────────────────────────────────────────
THE PAYMENT ASK — DO THIS RIGHT
────────────────────────────────────────────────

When they signal commitment ("yes I want to apply", "let's do it", "ok send
me details"), the close should be CONFIDENT and CLEAR. Not apologetic.

❌ "If you're sure you'd like to proceed, you can transfer the fee to..."
✅ "Awesome! Here's how to start:

    💸 *Interac $315* to *newtonimmigration@gmail.com*
    📝 Share your full name once sent

    Once received, our processing team takes over and starts your file.
    Easy as that 🚀"

Three lines. Confident. Specific. Action-oriented. ZERO weasel words.

────────────────────────────────────────────────
WHAT GREAT SALES PEOPLE NEVER DO
────────────────────────────────────────────────

❌ Beg for the sale ("please consider us!")
❌ Discount unprompted ("I can do $250 if you decide today")
❌ Slam competitors ("other consultants charge double")
❌ Pretend to be the client's friend forever ("we'll always be here for you 💕")
❌ Send 3 messages in a row when they don't reply
❌ Ask "are you still there?" — instead, send VALUE that re-engages

────────────────────────────────────────────────
WHAT GREAT SALES PEOPLE ALWAYS DO
────────────────────────────────────────────────

✅ Listen for the REAL question behind the question
   (Client says "how long?" → real question is "will I have status when I need it?")
✅ Use the client's name once they share it (instant warmth)
✅ Confirm WHAT they want before quoting (avoid wasted info dumps)
✅ End every substantive message with a question or soft CTA
✅ Match their energy — if they're excited, mirror it; if they're nervous,
   slow down and reassure
✅ Acknowledge what they said before answering ("Got it — finished in May,
   here for ~6 months...")

═══════════════════════════════════════════════

RESPONSE FORMAT: Reply ONLY with the WhatsApp message to send. No JSON, no preamble like
"Here's the reply:" — just the message itself.

✅ For *bold* in WhatsApp use SINGLE asterisks (*PGWP*) — never double (**PGWP**).
✅ For _italic_ use single underscores.
✅ Match client's language (English/Punjabi).
✅ Keep replies focused — one purpose per message.`,
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

  // ── Compliance safety net ──
  // If the drafted reply slipped an outcome/timeline guarantee past the prompt,
  // replace it with a safe handoff and remember that we tripped so staff get
  // alerted below. Prices and the 10% promo are allowed and never trip this.
  let safetyTripped = false;
  let safetyReason: "outcome" | "presence" | null = null;
  const unsafeReason = marketingUnsafeReason(reply);
  if (unsafeReason) {
    console.warn(`[marketing-safety] Blocked ${unsafeReason} reply to ${phone}: ${reply.slice(0, 160)}`);
    reply = unsafeReason === "presence" ? MARKETING_PRESENCE_FALLBACK : MARKETING_SAFE_FALLBACK;
    safetyTripped = true;
    safetyReason = unsafeReason;
    if (unsafeReason === "presence") {
      // The bot just tried to fabricate office presence — ping the owner directly
      // (they may have a client physically waiting). 10-min debounce still applies.
      await alertOwnerByWhatsApp({
        key: phone,
        clientName: contactName || phone,
        clientPhone: phone,
        context: "Bot tried to claim someone is at/coming to the office — BLOCKED. Client may be waiting in person.",
      });
    }
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
        message: safetyReason === "presence"
          ? `🚨 URGENT: ${contactName || phone} may be trying to visit/reach the office in person — the bot blocked a fabricated "team is on the way" reply. Call them now: ${phone}`
          : safetyTripped
          ? `⚠️ Marketing bot blocked an unsafe reply (outcome/guarantee) to ${contactName || phone} and sent a safe handoff instead — please follow up personally.`
          : `📣 Marketing inquiry from ${contactName || phone}: "${message.slice(0, 60)}..."`
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

    if (!Array.isArray(value?.messages) || value.messages.length === 0) {
      return NextResponse.json({ status: "ok" });
    }

    // Meta can batch multiple inbound messages in a single webhook. Process each
    // (the processing webhook already loops; this one used to drop messages[1+]).
    for (const message of value.messages) {
    const from = message.from;
    const msgType = String(message?.type || "text"); // text, image, document, audio

    // ── IDEMPOTENCY CLAIM (Meta's stable message id) ──
    // Same protection as the processing webhook. The whatsapp-router forwards
    // here with a 15s timeout and retries on timeout, and Meta itself retries
    // when we're slow to return 200. AI reply generation is slow, so a single
    // inbound marketing message could be processed several times — making the
    // bot send the SAME reply repeatedly (logs showed 9x to one number). We
    // claim Meta's message.id exactly once in the shared whatsapp_processed_msgs
    // table; if the INSERT conflicts, this is a retry of an already-handled
    // message and we skip it. wamids are globally unique, so sharing the table
    // with the processing route is safe.
    const metaMsgId = String(message?.id || "");
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
        if (claim.rowCount === 0) alreadyProcessed = true;
      } catch (e) {
        console.error("[marketing] Dedup claim failed (non-fatal, processing anyway):", (e as Error).message);
      }
      if (alreadyProcessed) {
        console.log(`⏸️  [marketing] Duplicate webhook for Meta msg ${metaMsgId} — already processed, skipping.`);
        continue;
      }
    }

    const text = message.text?.body || "";
    const contact = value.contacts?.[0];
    const contactName = contact?.profile?.name || "";
    // Click-to-WhatsApp ads include `referral` with source_url, headline, etc.
    const referral = message?.referral?.source_id || message?.referral?.headline || "";

    if (text && from) {
      await handleMarketingMessage(from, text, contactName, referral);
    } else if (from && (msgType === "image" || msgType === "document" || msgType === "audio")) {
      // ── Inbound media on marketing number ──
      // Save a placeholder row immediately with msgId AS the database id
      // (previously the row id was random and the UPDATE below silently
      // matched zero rows). Then process the media inline so S3 upload +
      // DB update complete before the webhook returns. The previous
      // fire-and-forget IIFE didn't survive serverless function teardown
      // on Railway, leaving every image stuck on "Uploading…" forever.
      const msgId = `mkt-in-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const docKind = msgType === "image" ? "image" : msgType === "audio" ? "audio" : "document";
      const docCaption = String(message[msgType]?.caption || message[msgType]?.filename || "").trim();
      const captionPart = docCaption ? `|caption=${encodeURIComponent(docCaption)}` : "";
      const placeholder = `[doc:${msgId}|kind=${docKind}|pending=1${captionPart}]`;

      await ensureLead(from, contactName);
      // Use msgId as the row id so the UPDATE below targets the right row
      await saveMarketingMessage(from, placeholder, "inbound", contactName, msgId);

      // A lead sending an image/document on the MARKETING number is almost always
      // a payment receipt or an ID/doc they want looked at — a human should see
      // it. Ping the alert recipients (debounced per client / 10 min). This is
      // the path the original missed payment-screenshot took.
      if (msgType === "image" || msgType === "document") {
        await alertOwnerByWhatsApp({
          key: from,
          clientName: contactName || from,
          clientPhone: from,
          context: `Sent ${msgType === "image" ? "an image" : "a document"} on the marketing line (often a payment receipt) — please review.`,
        });
      }

      // ── Inline: download from Meta + upload to S3 + update placeholder ──
      // Meta webhook gives us ~5-10s before timing out; image/document
      // download + S3 upload typically completes well within that. If the
      // webhook does take a bit longer, Meta will retry — fine.
      try {
        const mediaObj = message[msgType];
        if (!mediaObj?.id) {
          console.warn(`Marketing inbound: no media id in ${msgType} from ${from}`);
        } else {
          const urlRes = await fetch(`https://graph.facebook.com/v18.0/${mediaObj.id}`, {
            headers: { Authorization: `Bearer ${WA_TOKEN}` }
          });
          const urlData: any = await urlRes.json().catch(() => ({}));
          if (!urlData?.url) {
            console.warn(`Marketing inbound: no download URL for ${mediaObj.id}`);
          } else {
            const fileRes = await fetch(urlData.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
            const buffer = Buffer.from(await fileRes.arrayBuffer());
            const mimeType: string = urlData.mime_type || "application/octet-stream";

            const { putObjectToS3, isS3StorageEnabled, normalizeFilename } = await import("@/lib/object-storage");
            if (!isS3StorageEnabled()) {
              console.warn("Marketing inbound: S3 not configured, skipping upload");
            } else {
              const extMap: Record<string, string> = {
                "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
                "image/heic": "heic", "application/zip": "zip", "video/mp4": "mp4",
                "audio/ogg": "ogg", "audio/mpeg": "mp3",
              };
              const ext = extMap[mimeType] || (mimeType.split("/")[1] || "bin").slice(0, 6);
              const safeName = normalizeFilename(mediaObj.filename || `marketing-${from}-${Date.now()}.${ext}`);
              const phoneFolder = String(from).replace(/\D/g, "") || "unknown";
              const s3Key = `companies/newton/marketing-inbound/${phoneFolder}/${Date.now()}-${safeName}`;

              await putObjectToS3({ key: s3Key, content: buffer, contentType: mimeType });

              const finalName = (mediaObj.filename || safeName).replace(/\|/g, "");
              const updatedPlaceholder = `[doc:${msgId}|kind=${docKind}|name=${encodeURIComponent(finalName)}|mime=${encodeURIComponent(mimeType)}|s3=${encodeURIComponent(s3Key)}${captionPart}]`;

              const updRes = await pool.query(
                `UPDATE marketing_inbox SET message = $1 WHERE id = $2`,
                [updatedPlaceholder, msgId]
              );
              console.log(`📎 Marketing media saved (${docKind}, ${updRes.rowCount} rows updated): ${finalName}`);

              // ── Drive backup (Stage 2) — non-fatal best-effort ──
              const marketingDriveRoot = process.env.MARKETING_DOCS_DRIVE_FOLDER_ID || "";
              if (marketingDriveRoot) {
                try {
                  const { getOrCreateDriveSubfolder, uploadFileToDriveFolder } = await import("@/lib/google-drive");
                  const lead = await getLead(from).catch(() => null);
                  const clientLabel = (lead?.contact_name || contactName || "")
                    .replace(/[\/\\<>:"|?*]/g, " ")
                    .trim();
                  const clientFolderName = clientLabel ? `${clientLabel} (${from})` : from;
                  const clientFolder = await getOrCreateDriveSubfolder(marketingDriveRoot, clientFolderName);
                  await uploadFileToDriveFolder({
                    folderId: clientFolder.id,
                    fileName: finalName,
                    fileBuffer: buffer,
                    mimeType,
                  });
                  console.log(`☁️  Marketing doc uploaded to Drive: ${clientFolderName}/${finalName}`);
                } catch (e) {
                  console.error("Marketing Drive upload failed (non-fatal):", (e as Error).message);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error("Marketing inbound media save failed:", (e as Error).message);
      }
    }
    } // end for (const message of value.messages)

    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error("Marketing WA error:", e);
    return NextResponse.json({ status: "ok" });
  }
}
