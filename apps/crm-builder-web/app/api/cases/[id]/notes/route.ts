import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_notes (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      text TEXT NOT NULL,
      added_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureTable();
  // Read by case_id ONLY (not company_id). Case IDs are globally unique in this
  // single-firm deployment, and staff accounts have drifted between two company
  // IDs ("CMP-1" vs "newton") over time — filtering by company_id made one
  // teammate's notes invisible to another. case_id alone fixes that.
  //
  // We also merge in REVIEW CHANGES (top-level review comments) directly, so the
  // Notes tab ALWAYS shows them regardless of whether they were added before or
  // after the review→Notes mirror feature shipped. We skip the mirror's own
  // copies (id starts with 'NOTE-rc-') to avoid showing each change twice.
  const notesRes = await pool.query(
    `SELECT id, text, added_by, created_at FROM case_notes
      WHERE case_id = $1 AND id NOT LIKE 'NOTE-rc-%'`,
    [params.id]
  );
  const rows: Array<{ id: string; text: string; added_by: string; created_at: string }> = notesRes.rows as any;

  try {
    const rc = await pool.query(
      `SELECT id, body, author_name, created_at FROM review_comments
        WHERE case_id = $1 AND parent_id IS NULL
        ORDER BY created_at ASC`,
      [params.id]
    );
    for (const r of rc.rows as any[]) {
      rows.push({
        id: `rc-${r.id}`,
        text: `🔎 Review change: ${r.body}`,
        added_by: r.author_name || "Reviewer",
        created_at: r.created_at,
      });
    }
  } catch { /* review_comments table may not exist yet — ignore */ }

  rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return NextResponse.json({ notes: rows });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { text, addedBy } = await request.json().catch(() => ({}));
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  await ensureTable();
  const id = `NOTE-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  await pool.query(
    `INSERT INTO case_notes (id, case_id, company_id, text, added_by) VALUES ($1,$2,$3,$4,$5)`,
    [id, params.id, user.companyId, text, addedBy || user.name]
  );
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { noteId } = await request.json().catch(() => ({}));
  if (!noteId) return NextResponse.json({ error: "noteId required" }, { status: 400 });
  // Delete by note id + case id (both unique); company_id intentionally omitted
  // to avoid the same companyId-drift mismatch blocking legitimate deletes.
  await pool.query(
    `DELETE FROM case_notes WHERE id = $1 AND case_id = $2`,
    [noteId, params.id]
  );
  return NextResponse.json({ ok: true });
}
