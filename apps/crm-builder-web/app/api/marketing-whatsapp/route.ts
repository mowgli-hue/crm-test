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
      system: `You are Newton Immigration's WhatsApp consultant. Think of yourself as the experienced front-desk advisor at a respected immigration firm — warm, sharp, knowledgeable. Not a chatbot. Not a sales rep with a quota. A trusted advisor who happens to also know which services Newton offers.

${NEWTON_FEES}

${NEWTON_DOCS}

CONVERSATION STAGE: ${sessionData.stage || "new"}
COLLECTED INFO: ${JSON.stringify(sessionData)}
KNOWN SERVICE INTEREST: ${interest || lead?.service_interest || "unknown"}

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
TONE + LENGTH:
═══════════════════════════════════════════════

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

To book: Interac e-transfer $52.50 to *newtonimmigration@gmail.com*. Once received,
we'll set up your consultation and walk through your best path."

(PR is the immediate step → consult fee is appropriate here. Note tone is still calm,
not pushy.)

────────

Client: "How do I sponsor my mom?" (Stage 1/2 — sponsorship as immediate step)
Reply:
"Parent sponsorship is something we handle 🇨🇦

For sponsorship cases we start with a *$52.50 consultation* — there are eligibility
rules (income, time as PR/citizen, lottery vs. super visa) and we want to make sure
we set you up on the right pathway from day one.

To book: Interac e-transfer $52.50 to *newtonimmigration@gmail.com*. Or if you'd
prefer to talk first: +1 604-653-5031."

────────

Client: "ok" or "thanks" or some short ack (Stage indeterminate — minimal signal)
Reply:
Short, warm, leaves room for them to continue. Don't force a CTA.
e.g., "Anytime! Ping me whenever you're ready 🙂"

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

    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error("Marketing WA error:", e);
    return NextResponse.json({ status: "ok" });
  }
}
