import { NextRequest, NextResponse } from "next/server";
import { NEWTON_FEES, NEWTON_DOCS } from "@/lib/marketing-knowledge";
import { Pool } from "pg";

const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "1047138985153613";
const WA_TOKEN = process.env.WHATSAPP_TOKEN || "";
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "newton_verify_2024";
const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

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
  } catch(e) { console.error("Marketing save error:", e); }
}

async function ensureTable() {
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
}

async function getMarketingSession(phone: string): Promise<any> {
  try {
    const res = await pool.query(
      `SELECT * FROM marketing_sessions WHERE phone = $1`,
      [phone]
    );
    return res.rows[0] || null;
  } catch { return null; }
}

async function saveMarketingSession(phone: string, data: any) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_sessions (
        phone TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      `INSERT INTO marketing_sessions (phone, data, updated_at) VALUES ($1,$2,NOW())
       ON CONFLICT (phone) DO UPDATE SET data=$2, updated_at=NOW()`,
      [phone, JSON.stringify(data)]
    );
  } catch(e) { console.error("Session save error:", e); }
}

async function handleMarketingMessage(phone: string, message: string, contactName?: string) {
  await saveMarketingMessage(phone, message, "inbound", contactName);
  
  const session = await getMarketingSession(phone) || { data: { stage: "new" } };
  const sessionData = session.data;

  // Use Claude to handle the conversation
  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: `You are Newton Immigration's marketing assistant on WhatsApp. You help potential clients with inquiries about immigration services.

${NEWTON_FEES}

${NEWTON_DOCS}

CONVERSATION STAGE: ${sessionData.stage || "new"}
COLLECTED INFO: ${JSON.stringify(sessionData)}

YOUR JOB:
1. Greet new inquiries warmly in English (or match their language)
2. Ask what immigration service they need
3. Give accurate fee quotes from the fee schedule
4. Send relevant document checklist
5. Book consultation ($52.50) - collect their name, best time to call
6. For complex cases encourage them to book consultation

RULES:
- Always be warm, professional, helpful in English or Punjabi
- Give specific fees — never say "contact us for pricing"  
- Keep messages SHORT (WhatsApp style)
- If they ask about a service not in list, say consultation is $52.50
- Interac for consultation payment: newtonimmigration@gmail.com ONLY
- Surrey office: +1 604-897-5894 / +1 604-653-5031
- Calgary: +1 604-907-0314

DOCUMENT COLLECTION FLOW:
When client is ready to proceed or wants to share documents:
ALWAYS tell them: "Please send all your documents directly to our processing team on WhatsApp at *+1 604-779-5700*. Our team will save everything and start your file right away! 📁"

This is important — documents go to processing number +1 604-779-5700, NOT this number.

CONSULTATION BOOKING:
- Fee: $52.50 including taxes
- Payment via Interac e-transfer: newtonimmigration@gmail.com
- After payment, team will call to confirm appointment

RESPONSE FORMAT: Reply ONLY with the WhatsApp message to send. No JSON, no explanation.`,
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

  // Update session history
  sessionData.history = [
    ...(sessionData.history || []).slice(-8),
    { role: "user", content: message },
    { role: "assistant", content: reply }
  ];
  sessionData.stage = "active";
  if (contactName) sessionData.name = contactName;
  await saveMarketingSession(phone, sessionData);

  // Send reply
  await sendMarketingMessage(phone, reply);
  await saveMarketingMessage(phone, reply, "outbound");

  // Notify staff in CRM
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
  } catch(e) {}
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
    await ensureTable();
    const body = await request.json() as any;
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    
    if (!value?.messages?.[0]) return NextResponse.json({ status: "ok" });
    
    const message = value.messages[0];
    const from = message.from;
    const text = message.text?.body || "";
    const contact = value.contacts?.[0];
    const contactName = contact?.profile?.name || "";

    if (text && from) {
      await handleMarketingMessage(from, text, contactName);
    }

    return NextResponse.json({ status: "ok" });
  } catch(e) {
    console.error("Marketing WA error:", e);
    return NextResponse.json({ status: "ok" });
  }
}
