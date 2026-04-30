import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "1047138985153613";
// Token: prefer WHATSAPP_ACCESS_TOKEN (Meta's naming), fall back to WHATSAPP_TOKEN (legacy)
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";

// ──────────────────────────────────────────────────────────────
// Schema bootstrap — runs idempotently on first hit
// ──────────────────────────────────────────────────────────────

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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_inbox_phone ON marketing_inbox(phone)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_inbox_created ON marketing_inbox(created_at DESC)`);

  // Lead pipeline table — one row per phone
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_leads_stage ON marketing_leads(stage)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_leads_followup ON marketing_leads(next_follow_up) WHERE next_follow_up IS NOT NULL`);
}

// ──────────────────────────────────────────────────────────────
// GET — list all messages, plus lead metadata so the UI can show stages
// ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureSchema();
    const messagesRes = await pool.query(
      `SELECT * FROM marketing_inbox ORDER BY created_at DESC LIMIT 1000`
    );
    const leadsRes = await pool.query(`SELECT * FROM marketing_leads`);

    // Index leads by phone for the UI to merge against threads
    const leadsByPhone: Record<string, any> = {};
    for (const lead of leadsRes.rows) {
      leadsByPhone[lead.phone] = lead;
    }

    return NextResponse.json({ messages: messagesRes.rows, leads: leadsByPhone });
  } catch (e) {
    console.error("Marketing inbox GET error:", (e as Error).message);
    return NextResponse.json({ messages: [], leads: {} });
  }
}

// ──────────────────────────────────────────────────────────────
// POST — actions: send message (default), saveName, markRead, deleteThread
// ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = body?.action;

  try {
    await ensureSchema();

    // ── Save / update contact name on a thread ──
    if (action === "saveName") {
      const { phone, name } = body;
      if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
      const cleanName = String(name || "").trim();

      // Update all messages for this phone with the new name
      await pool.query(
        `UPDATE marketing_inbox SET contact_name = $2 WHERE phone = $1`,
        [phone, cleanName || null]
      );

      // Upsert lead row
      await pool.query(
        `INSERT INTO marketing_leads (phone, contact_name, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (phone) DO UPDATE SET contact_name = $2, updated_at = NOW()`,
        [phone, cleanName || null]
      );
      return NextResponse.json({ ok: true });
    }

    // ── Mark thread as read ──
    if (action === "markRead") {
      const { phone } = body;
      if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
      await pool.query(
        `UPDATE marketing_inbox SET is_read = TRUE WHERE phone = $1 AND direction = 'inbound'`,
        [phone]
      );
      return NextResponse.json({ ok: true });
    }

    // ── Delete a thread (all messages for one phone) ──
    if (action === "deleteThread") {
      const { phone } = body;
      if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
      await pool.query(`DELETE FROM marketing_inbox WHERE phone = $1`, [phone]);
      // Don't delete the lead — staff might want history of converted leads
      return NextResponse.json({ ok: true });
    }

    // ── Toggle AI auto-reply for a thread (default: true) ──
    if (action === "toggleAI") {
      const { phone, enabled } = body;
      if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
      await pool.query(
        `INSERT INTO marketing_leads (phone, ai_enabled, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (phone) DO UPDATE SET ai_enabled = $2, updated_at = NOW()`,
        [phone, !!enabled]
      );
      return NextResponse.json({ ok: true, ai_enabled: !!enabled });
    }

    // ── Default: send an outbound message ──
    const { phone, message } = body;
    if (!phone || !message) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const cleanedPhone = phone.replace(/\D/g, "");
    if (!cleanedPhone) return NextResponse.json({ error: "Invalid phone" }, { status: 400 });

    const res = await fetch(`https://graph.facebook.com/v18.0/${MARKETING_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanedPhone,
        type: "text",
        text: { body: message }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("WA send failed:", res.status, errText);
      return NextResponse.json({ error: "Failed to send", detail: errText }, { status: 500 });
    }

    const id = `mkt-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await pool.query(
      `INSERT INTO marketing_inbox (id, phone, message, direction, is_read, created_at)
       VALUES ($1,$2,$3,'outbound',TRUE,NOW())`,
      [id, phone, message]
    );

    // Mark inbound as read since staff just replied
    await pool.query(
      `UPDATE marketing_inbox SET is_read = TRUE WHERE phone = $1 AND direction = 'inbound'`,
      [phone]
    );

    // Auto-advance lead stage from "new" -> "contacted" once staff replies
    await pool.query(
      `INSERT INTO marketing_leads (phone, stage, updated_at)
       VALUES ($1, 'contacted', NOW())
       ON CONFLICT (phone) DO UPDATE
         SET stage = CASE WHEN marketing_leads.stage = 'new' THEN 'contacted' ELSE marketing_leads.stage END,
             updated_at = NOW()`,
      [phone]
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Marketing inbox POST error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
