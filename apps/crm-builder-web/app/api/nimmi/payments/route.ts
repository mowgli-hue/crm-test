// CRM payments admin API
// File path: app/api/nimmi/payments/route.ts
// GET = list, PATCH = verify/reject

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

// Staff-only gate for this payments admin API (lists + verifies/rejects payment
// records — financial data + PII). Returns a 401 response when not staff, else null.
async function requireStaff(req: NextRequest): Promise<NextResponse | null> {
  const user = await getCurrentUserFromRequest(req);
  if (!user || user.userType !== "staff") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

let _pool: Pool | null = null;
function getNimmiPool(): Pool {
  if (_pool) return _pool;
  const connString = process.env.DATABASE_URL || process.env.PG_URL;
  if (!connString) throw new Error("DATABASE_URL not set");
  _pool = new Pool({
    connectionString: connString,
    ssl: { rejectUnauthorized: false },
  });
  return _pool;
}

export async function GET(req: NextRequest) {
  const authErr = await requireStaff(req);
  if (authErr) return authErr;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  try {
    const pool = getNimmiPool();
    let query = `SELECT * FROM nimmi_payments`;
    const params: unknown[] = [];

    if (status === "pending" || status === "verified" || status === "rejected") {
      query += ` WHERE newton_status = $1`;
      params.push(status);
    }

    query += ` ORDER BY received_at DESC LIMIT 100`;

    const result = await pool.query(query, params);
    return NextResponse.json({ rows: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const authErr = await requireStaff(req);
  if (authErr) return authErr;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { newton_status, newton_notes, verified_by } = body;
  if (!newton_status || !["verified", "rejected", "refunded", "pending"].includes(newton_status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const pool = getNimmiPool();
    const result = await pool.query(
      `UPDATE nimmi_payments SET
        newton_status = $1,
        newton_verified_by = $2,
        newton_verified_at = NOW(),
        newton_notes = COALESCE($3, newton_notes),
        updated_at = NOW()
      WHERE id = $4
      RETURNING *`,
      [newton_status, verified_by || "newton", newton_notes || null, id]
    );

    return NextResponse.json({ ok: true, row: result.rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
