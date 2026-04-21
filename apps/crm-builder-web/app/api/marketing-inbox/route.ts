import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  try {
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
    
    const res = await pool.query(
      `SELECT * FROM marketing_inbox ORDER BY created_at DESC LIMIT 1000`
    );
    return NextResponse.json({ messages: res.rows });
  } catch(e) {
    return NextResponse.json({ messages: [] });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const body = await request.json().catch(() => ({}));
  const { phone, message } = body;
  
  if (!phone || !message) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  
  // Send via marketing WhatsApp
  const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "1047138985153613";
  const WA_TOKEN = process.env.WHATSAPP_TOKEN || "";
  
  const res = await fetch(`https://graph.facebook.com/v18.0/${MARKETING_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone.replace(/\D/g, ""),
      type: "text",
      text: { body: message }
    })
  });
  
  if (res.ok) {
    const id = `mkt-out-${Date.now()}`;
    await pool.query(
      `INSERT INTO marketing_inbox (id, phone, message, direction, is_read, created_at) VALUES ($1,$2,$3,'outbound',TRUE,NOW())`,
      [id, phone, message]
    );
    return NextResponse.json({ ok: true });
  }
  
  return NextResponse.json({ error: "Failed to send" }, { status: 500 });
}
