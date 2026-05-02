// ─────────────────────────────────────────────────────────────────────
// /api/accounting/manual-entry — Manual income entries in Accounting
//
// Use cases:
//   - One-off cash receipts not tied to a case
//   - Payment for non-case services
//   - Misc income / corrections
//
// Schema (manual_payments table):
//   id            TEXT PK
//   company_id    TEXT
//   payment_date  DATE   — the date the payment was received
//   amount        NUMERIC(10,2)
//   client_name   TEXT   — free-text, doesn't have to match an existing case
//   description   TEXT
//   method        TEXT   — Interac / Cash / Cheque / Card / etc.
//   added_by      TEXT
//   case_id       TEXT   — optional link, NULL when not tied to a case
//   created_at    TIMESTAMPTZ
//
// All entries are income only (no negative amounts). If you ever need
// expense tracking, add a `kind` column ('income' | 'expense'). For now
// this stays simple.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS manual_payments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      payment_date DATE NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      client_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL DEFAULT '',
      added_by TEXT NOT NULL DEFAULT '',
      case_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_manual_payments_company_date ON manual_payments (company_id, payment_date DESC)`);
}

// ─── GET: list all manual entries for company ───
export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  const r = await pool.query(
    `SELECT id, payment_date, amount, client_name, description, method, added_by, case_id, created_at
     FROM manual_payments
     WHERE company_id = $1
     ORDER BY payment_date DESC, created_at DESC`,
    [user.companyId]
  );
  return NextResponse.json({ entries: r.rows });
}

// ─── POST: create a new manual entry ───
//
// Body: { payment_date: "YYYY-MM-DD", amount: number, client_name: string,
//         description?: string, method?: string, case_id?: string }
//
// Validation:
//   - payment_date required, must be parseable
//   - amount required, must be > 0 (income only)
//   - client_name required (so it's findable later)
//   - description, method, case_id optional
export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const paymentDate = String(body?.payment_date || body?.paymentDate || "").trim();
  const amount = Number(body?.amount || 0);
  const clientName = String(body?.client_name || body?.clientName || "").trim();
  const description = String(body?.description || "").trim();
  const method = String(body?.method || "").trim();
  const caseId = body?.case_id || body?.caseId || null;

  // Validate
  if (!paymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    return NextResponse.json({ error: "payment_date required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (amount > 1_000_000) {
    return NextResponse.json({ error: "amount too large (suspected typo)" }, { status: 400 });
  }
  if (!clientName) {
    return NextResponse.json({ error: "client_name required" }, { status: 400 });
  }

  await ensureSchema();
  const id = `MP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await pool.query(
    `INSERT INTO manual_payments (id, company_id, payment_date, amount, client_name, description, method, added_by, case_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, user.companyId, paymentDate, amount, clientName, description, method, user.name, caseId]
  );
  return NextResponse.json({ ok: true, id });
}

// ─── DELETE: remove a manual entry (in case staff fat-fingered) ───
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await pool.query(
    `DELETE FROM manual_payments WHERE id = $1 AND company_id = $2`,
    [id, user.companyId]
  );
  return NextResponse.json({ ok: true });
}
