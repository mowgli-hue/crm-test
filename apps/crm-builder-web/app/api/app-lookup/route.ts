import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submitted_apps_lookup (
      app_num TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      app_type TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      submission_date TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// GET — lookup by app number
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const appNum = searchParams.get("appNum")?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!appNum) return NextResponse.json({ error: "appNum required" }, { status: 400 });
  await ensureTable();
  const res = await pool.query(
    `SELECT app_num, name, phone, app_type, result, submission_date FROM submitted_apps_lookup WHERE app_num = $1`,
    [appNum]
  );
  if (!res.rows.length) return NextResponse.json({ record: null });
  const row = res.rows[0];
  return NextResponse.json({ record: { appNum: row.app_num, name: row.name, phone: row.phone, appType: row.app_type } });
}

// POST — seed or upsert records (admin only)
export async function POST(request: NextRequest) {
  const token = request.headers.get("x-admin-token");
  if (!isValidSystemToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const records: Array<{ appNum: string; name: string; phone: string; appType?: string; result?: string; submissionDate?: string }> = body.records || [];
  if (!records.length) return NextResponse.json({ error: "No records" }, { status: 400 });
  await ensureTable();
  let upserted = 0;
  for (const r of records) {
    const appNum = String(r.appNum || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (!appNum) continue;
    await pool.query(
      `INSERT INTO submitted_apps_lookup (app_num, name, phone, app_type, result, submission_date, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (app_num) DO UPDATE SET
         name=EXCLUDED.name, phone=EXCLUDED.phone, app_type=EXCLUDED.app_type,
         result=EXCLUDED.result, submission_date=EXCLUDED.submission_date, updated_at=NOW()`,
      [appNum, r.name||"", r.phone||"", r.appType||"", r.result||"", r.submissionDate||""]
    );
    upserted++;
  }
  return NextResponse.json({ ok: true, upserted });
}
