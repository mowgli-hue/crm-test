import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getCurrentUserFromRequest } from "@/lib/auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_inbox (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'inbound',
      matched_case_id TEXT,
      matched_case_name TEXT,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE whatsapp_inbox ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE
  `);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureTable();
  const url = new URL(request.url);
  const showArchived = url.searchParams.get("archived") === "1";
  
  // Get latest message per phone (thread view)
  const res = await pool.query(
    showArchived
      ? `SELECT DISTINCT ON (phone) * FROM whatsapp_inbox WHERE is_archived = TRUE ORDER BY phone, created_at DESC LIMIT 500`
      : `SELECT DISTINCT ON (phone) * FROM whatsapp_inbox WHERE is_archived = FALSE ORDER BY phone, created_at DESC LIMIT 500`
  );
  
  // Get all messages for thread detail
  const allRes = await pool.query(
    showArchived
      ? `SELECT * FROM whatsapp_inbox WHERE is_archived = TRUE ORDER BY created_at DESC LIMIT 2000`
      : `SELECT * FROM whatsapp_inbox WHERE is_archived = FALSE ORDER BY created_at DESC LIMIT 2000`
  );
  return NextResponse.json({ messages: allRes.rows, threads: res.rows });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { id, phone, action } = body;
  await ensureTable();
  
  if (action === "archive" && phone) {
    // Archive all messages for this phone
    // Load all messages for specific phone
    if (action === "thread" && phone) {
      const result = await pool.query(
        `SELECT * FROM whatsapp_inbox WHERE phone = $1 ORDER BY created_at ASC`,
        [phone]
      );
      return NextResponse.json({ messages: result.rows });
    }

    // Save name for unknown number
    if (action === "saveName" && phone && body.name) {
      const cleanPhone = phone.replace(/\D/g, "");
      await pool.query(
        `UPDATE whatsapp_inbox SET matched_case_name = $1 WHERE phone LIKE $2 OR phone = $3`,
        [body.name, `%${cleanPhone.slice(-9)}`, cleanPhone]
      );
      return NextResponse.json({ ok: true });
    }

    await pool.query(`UPDATE whatsapp_inbox SET is_archived = TRUE WHERE phone = $1`, [phone]);
    return NextResponse.json({ ok: true, action: "archived" });
  }
  
  if (action === "unarchive" && phone) {
    // Unarchive all messages for this phone
    await pool.query(`UPDATE whatsapp_inbox SET is_archived = FALSE WHERE phone = $1`, [phone]);
    return NextResponse.json({ ok: true, action: "unarchived" });
  }
  
  if (action === "read" && phone) {
    await pool.query(`UPDATE whatsapp_inbox SET is_read = TRUE WHERE phone = $1`, [phone]);
    return NextResponse.json({ ok: true });
  }

  if (action === "delete" && id) {
    // Get the message to find the WhatsApp message ID
    const msgRes = await pool.query(`SELECT * FROM whatsapp_inbox WHERE id = $1`, [id]);
    const msg = msgRes.rows[0];
    
    // Delete from WhatsApp (removes from client's chat too)
    if (msg && msg.direction === "outbound") {
      try {
        const { deleteWhatsAppMessage } = await import("@/lib/whatsapp");
        await deleteWhatsAppMessage(id);
      } catch { /* non-fatal */ }
    }
    
    // Delete from our DB
    await pool.query(`DELETE FROM whatsapp_inbox WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true, action: "deleted" });
  }
  
  if (id) {
    await pool.query(`UPDATE whatsapp_inbox SET is_read = TRUE WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  }
  
  return NextResponse.json({ error: "invalid request" }, { status: 400 });
}
