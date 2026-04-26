import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_log (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL DEFAULT 'inbound',
      phone TEXT,
      contact_name TEXT,
      duration_minutes INTEGER,
      outcome TEXT,
      service_interest TEXT,
      notes TEXT,
      ai_summary TEXT,
      logged_by TEXT,
      logged_by_name TEXT,
      linked_lead_phone TEXT,
      linked_case_id TEXT,
      called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_log_phone ON call_log(phone)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_log_called_at ON call_log(called_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_log_outcome ON call_log(outcome)`);
}

// ── GET: list calls with filters ──
// ?phone=&outcome=&limit=&search=
export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureSchema();
    const url = new URL(request.url);
    const phone = url.searchParams.get("phone");
    const outcome = url.searchParams.get("outcome");
    const search = url.searchParams.get("search");
    const limit = Math.min(500, parseInt(url.searchParams.get("limit") || "200", 10));

    const where: string[] = [];
    const params: any[] = [];
    if (phone) { params.push(phone.replace(/\s+/g, "")); where.push(`phone = $${params.length}`); }
    if (outcome) { params.push(outcome); where.push(`outcome = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(contact_name ILIKE $${params.length} OR notes ILIKE $${params.length} OR ai_summary ILIKE $${params.length} OR phone ILIKE $${params.length})`);
    }
    params.push(limit);

    const sql = `
      SELECT * FROM call_log
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY called_at DESC
      LIMIT $${params.length}
    `;
    const res = await pool.query(sql, params);
    return NextResponse.json({ calls: res.rows });
  } catch (e) {
    console.error("Call log GET error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message, calls: [] }, { status: 500 });
  }
}

// ── POST: create a new call log entry ──
// Body: { direction, phone, contact_name, duration_minutes, outcome, service_interest, notes, called_at?, useAI? }
// If useAI=true and ANTHROPIC_API_KEY set, runs notes through Claude Haiku to generate a clean ai_summary
export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const {
    direction = "inbound",
    phone,
    contact_name,
    duration_minutes,
    outcome,
    service_interest,
    notes,
    called_at,
    useAI,
    linked_lead_phone,
    linked_case_id,
  } = body;

  if (!notes && !contact_name && !phone) {
    return NextResponse.json({ error: "At least one of notes / contact_name / phone is required" }, { status: 400 });
  }

  try {
    await ensureSchema();

    let aiSummary: string | null = null;
    if (useAI && notes && process.env.ANTHROPIC_API_KEY && String(notes).trim().length >= 15) {
      try {
        aiSummary = await summarizeCallWithAI({
          rawNotes: notes,
          direction,
          contactName: contact_name,
          phone,
          duration: duration_minutes,
          outcome,
          serviceInterest: service_interest,
        });
      } catch (e) {
        console.warn("Call AI summary failed:", (e as Error).message);
      }
    }

    const cleanPhone = phone ? String(phone).replace(/\s+/g, "") : null;
    const id = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const res = await pool.query(
      `INSERT INTO call_log
        (id, direction, phone, contact_name, duration_minutes, outcome, service_interest,
         notes, ai_summary, logged_by, logged_by_name, linked_lead_phone, linked_case_id, called_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz, NOW()))
       RETURNING *`,
      [
        id,
        direction,
        cleanPhone,
        contact_name || null,
        duration_minutes || null,
        outcome || null,
        service_interest || null,
        notes || null,
        aiSummary,
        user.id || null,
        user.name || null,
        linked_lead_phone || null,
        linked_case_id || null,
        called_at || null,
      ]
    );

    // If linked to a lead, bump the lead's updated_at and add the call summary to lead notes
    if (cleanPhone) {
      try {
        await pool.query(
          `UPDATE marketing_leads SET updated_at = NOW() WHERE phone = $1`,
          [cleanPhone]
        );
      } catch (e) { /* table may not exist yet */ }
    }

    return NextResponse.json({ call: res.rows[0] });
  } catch (e) {
    console.error("Call log POST error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// ── AI summarizer ──
async function summarizeCallWithAI(p: {
  rawNotes: string;
  direction: string;
  contactName?: string;
  phone?: string;
  duration?: number;
  outcome?: string;
  serviceInterest?: string;
}): Promise<string> {
  const systemPrompt = `You are a CRM assistant for Newton Immigration. A staff member just finished a phone call and typed quick rough notes. Your job: turn them into a clean, professional 2-4 sentence call log summary.

OUTPUT RULES:
- 2-4 sentences total. Concise.
- Plain text, no markdown, no bullets.
- Capture: who called or was called about what, key facts (service interest, status, decisions made), next steps if mentioned.
- Use third person ("Client called about...", "Staff explained...", "Client agreed to...").
- Don't invent details that aren't in the notes.
- Don't add boilerplate ("This call was..." etc). Just the summary content.
- If outcome mentions consultation booked, payment promised, or callback scheduled, highlight that.

Return ONLY the summary text. No prefix, no quotation marks, no explanation.`;

  const context: string[] = [];
  context.push(`Direction: ${p.direction}`);
  if (p.contactName) context.push(`Contact: ${p.contactName}`);
  if (p.phone) context.push(`Phone: ${p.phone}`);
  if (p.duration) context.push(`Duration: ${p.duration} min`);
  if (p.outcome) context.push(`Outcome: ${p.outcome}`);
  if (p.serviceInterest) context.push(`Service interest: ${p.serviceInterest}`);

  const userPrompt = `${context.join(" · ")}\n\nROUGH NOTES FROM STAFF:\n${p.rawNotes}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}`);
  }
  const data = (await res.json()) as any;
  return (data?.content?.[0]?.text || "").trim();
}
