// ─────────────────────────────────────────────────────────────────────
// /api/inbox/new-chat — Initiate a new WhatsApp conversation from CRM
//
// Use case: staff has a lead's phone (got it offline, from a referral, etc.)
// and wants to start a WhatsApp conversation BEFORE the lead messages first.
//
// Body:
//   {
//     phone: string,                    // recipient
//     name: string,                     // contact name
//     service?: string,                 // optional service interest (PGWP, PR, etc.)
//     message?: string,                 // optional custom first message
//     channel: "inbox" | "marketing",   // which inbox to log to
//   }
//
// Behavior:
//   1. Validate inputs
//   2. Create / upsert marketing_lead row (so it appears in Lead Pipeline)
//   3. Send WhatsApp:
//      - If `message` provided → try sending free-form text first
//        (works only if recipient messaged us in last 24h)
//      - If template fallback needed OR no message → send the
//        `missed_call_welcome` approved template
//      - This works for any number, not just those who messaged in 24h
//   4. Log outbound message to whatsapp_inbox or marketing_inbox
//   5. Return success/error status
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { sendWhatsAppText, sendWhatsAppTemplate } from "@/lib/whatsapp";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;       // assume Canada/US
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return digits;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const phoneRaw = String(body?.phone || "").trim();
  const name = String(body?.name || "").trim();
  const service = String(body?.service || "").trim();
  const message = String(body?.message || "").trim();
  const channel = body?.channel === "marketing" ? "marketing" : "inbox";

  // Validate
  if (!phoneRaw) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const phone = normalizePhone(phoneRaw);
  if (phone.length < 10) return NextResponse.json({ error: "Invalid phone — too short" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  console.log(`📤 New chat: phone=${phone} | name=${name} | service=${service} | channel=${channel} | hasMessage=${Boolean(message)}`);

  // ── Step 1: Upsert marketing lead ──
  // This makes the new chat show up in Lead Pipeline so staff can convert
  // it later. If the phone already has a lead, we just update name/service.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_leads (
        phone TEXT PRIMARY KEY,
        contact_name TEXT,
        service_interest TEXT,
        source TEXT,
        stage TEXT NOT NULL DEFAULT 'new',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      `INSERT INTO marketing_leads (phone, contact_name, service_interest, source, stage)
       VALUES ($1, $2, $3, $4, 'new')
       ON CONFLICT (phone) DO UPDATE SET
         contact_name = COALESCE(NULLIF(EXCLUDED.contact_name, ''), marketing_leads.contact_name),
         service_interest = COALESCE(NULLIF(EXCLUDED.service_interest, ''), marketing_leads.service_interest),
         updated_at = NOW()`,
      [phone, name, service || null, "manual_new_chat"]
    );
  } catch (e) {
    console.error("New chat lead upsert failed (non-fatal):", (e as Error).message);
  }

  // ── Step 2: Send first WhatsApp ──
  //
  // Strategy:
  //   - If staff supplied a message → try sending free-form text first.
  //     This will succeed if recipient messaged us in last 24h, fail otherwise.
  //   - If text fails (or no message provided) → send approved template.
  //     Templates can be sent to any number anytime.
  let sendResult: { success: boolean; messageId?: string; error?: string; method?: string } = { success: false };

  if (message) {
    const textRes = await sendWhatsAppText(phone, message);
    if (textRes.success) {
      sendResult = { ...textRes, method: "text" };
    } else {
      console.log(`📤 New chat: text send failed (${textRes.error}), trying template fallback...`);
      // Fall through to template
    }
  }

  if (!sendResult.success) {
    // Use approved template. This works for any number.
    const templateName = process.env.TASKER_WELCOME_TEMPLATE || "missed_call_welcome";
    const tplRes = await sendWhatsAppTemplate({
      to: phone,
      templateName,
      languageCode: "en",
    });
    if (tplRes.success) {
      sendResult = { ...tplRes, method: "template" };
    } else {
      console.error(`❌ New chat: both text and template failed | template error: ${tplRes.error}`);
      return NextResponse.json(
        { error: tplRes.error || "Failed to send message", method_tried: "template" },
        { status: 500 }
      );
    }
  }

  // ── Step 3: Log outbound to inbox table ──
  const inboxMsgId = `WA-OUT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const loggedMessage = sendResult.method === "template"
    ? `[template:${process.env.TASKER_WELCOME_TEMPLATE || "missed_call_welcome"}] (sent via New Chat)`
    : message;

  try {
    if (channel === "marketing") {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS marketing_inbox (
          id TEXT PRIMARY KEY,
          phone TEXT NOT NULL,
          message TEXT NOT NULL,
          direction TEXT NOT NULL DEFAULT 'inbound',
          contact_name TEXT,
          is_read BOOLEAN NOT NULL DEFAULT FALSE,
          archived BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(
        `INSERT INTO marketing_inbox (id, phone, message, direction, contact_name, is_read, created_at)
         VALUES ($1, $2, $3, 'outbound', $4, TRUE, NOW())`,
        [inboxMsgId, phone, loggedMessage, name]
      );
    } else {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_inbox (
          id TEXT PRIMARY KEY, phone TEXT NOT NULL, message TEXT NOT NULL,
          direction TEXT NOT NULL DEFAULT 'inbound', matched_case_id TEXT,
          matched_case_name TEXT, is_read BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(
        `INSERT INTO whatsapp_inbox (id, phone, message, direction, matched_case_name, is_read, created_at)
         VALUES ($1, $2, $3, 'outbound', $4, TRUE, NOW())`,
        [inboxMsgId, phone, loggedMessage, name]
      );
    }
  } catch (e) {
    console.error("New chat inbox log failed (non-fatal):", (e as Error).message);
  }

  return NextResponse.json({
    ok: true,
    phone,
    name,
    method: sendResult.method,
    messageId: sendResult.messageId,
  });
}
