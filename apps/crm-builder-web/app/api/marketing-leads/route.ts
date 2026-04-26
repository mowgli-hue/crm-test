import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export const STAGES = ["new", "contacted", "consultation_booked", "consultation_done", "converted", "lost"] as const;
export type Stage = typeof STAGES[number];

export const SOURCES = ["whatsapp", "facebook", "instagram", "referral", "walk_in", "google", "website", "tiktok", "other"] as const;

async function ensureSchema() {
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
// GET — list leads, optionally filtered
// Query params: stage=new, source=facebook, dueToday=1
// ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureSchema();
    const url = new URL(request.url);
    const stage = url.searchParams.get("stage");
    const source = url.searchParams.get("source");
    const dueToday = url.searchParams.get("dueToday");
    const search = url.searchParams.get("q");

    const where: string[] = [];
    const params: any[] = [];
    if (stage) { params.push(stage); where.push(`stage = $${params.length}`); }
    if (source) { params.push(source); where.push(`source = $${params.length}`); }
    if (dueToday) { where.push(`next_follow_up <= CURRENT_DATE`); }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(contact_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR notes ILIKE $${params.length})`);
    }

    const sql = `
      SELECT l.*, 
        (SELECT message FROM marketing_inbox WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM marketing_inbox WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1) AS last_message_at,
        (SELECT COUNT(*) FROM marketing_inbox WHERE phone = l.phone AND direction = 'inbound' AND is_read = FALSE) AS unread_count
      FROM marketing_leads l
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY 
        CASE 
          WHEN next_follow_up IS NOT NULL AND next_follow_up <= CURRENT_DATE THEN 0
          ELSE 1
        END,
        updated_at DESC
      LIMIT 500
    `;
    const res = await pool.query(sql, params);
    return NextResponse.json({ leads: res.rows });
  } catch (e) {
    console.error("Leads GET error:", (e as Error).message);
    return NextResponse.json({ leads: [], error: (e as Error).message });
  }
}

// ──────────────────────────────────────────────────────────────
// POST — create or upsert a lead manually (e.g. walk-in, phone call)
// Body: { phone, contact_name?, source?, service_interest?, notes?, ... }
// ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { phone, contact_name, stage, source, service_interest, tags, notes, assigned_to, next_follow_up } = body;

  if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 });

  try {
    await ensureSchema();
    const cleanPhone = String(phone).replace(/\s+/g, "");
    const validStage = STAGES.includes(stage) ? stage : "new";

    const res = await pool.query(
      `INSERT INTO marketing_leads (phone, contact_name, stage, source, service_interest, tags, notes, assigned_to, next_follow_up, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (phone) DO UPDATE SET
         contact_name = COALESCE($2, marketing_leads.contact_name),
         stage = COALESCE($3, marketing_leads.stage),
         source = COALESCE($4, marketing_leads.source),
         service_interest = COALESCE($5, marketing_leads.service_interest),
         tags = COALESCE($6, marketing_leads.tags),
         notes = COALESCE($7, marketing_leads.notes),
         assigned_to = COALESCE($8, marketing_leads.assigned_to),
         next_follow_up = COALESCE($9, marketing_leads.next_follow_up),
         updated_at = NOW()
       RETURNING *`,
      [
        cleanPhone,
        contact_name || null,
        validStage,
        source || null,
        service_interest || null,
        Array.isArray(tags) ? tags : null,
        notes || null,
        assigned_to || null,
        next_follow_up || null,
      ]
    );
    return NextResponse.json({ lead: res.rows[0] });
  } catch (e) {
    console.error("Leads POST error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
