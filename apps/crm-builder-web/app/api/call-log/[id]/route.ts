import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// PATCH /api/call-log/[id] — update fields
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const allowed = ["direction", "phone", "contact_name", "duration_minutes", "outcome",
                   "service_interest", "notes", "ai_summary", "linked_lead_phone", "linked_case_id"];
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const key of allowed) {
    if (body[key] !== undefined) {
      sets.push(`${key} = $${i}`);
      vals.push(body[key]);
      i++;
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  vals.push(params.id);

  try {
    const sql = `UPDATE call_log SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${i} RETURNING *`;
    const res = await pool.query(sql, vals);
    if (res.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ call: res.rows[0] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/call-log/[id]
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await pool.query(`DELETE FROM call_log WHERE id = $1`, [params.id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
