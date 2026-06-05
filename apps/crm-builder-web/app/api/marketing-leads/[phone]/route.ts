import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// PATCH /api/marketing-leads/[phone] — partial update
export async function PATCH(request: NextRequest, { params }: { params: { phone: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const phone = decodeURIComponent(params.phone).replace(/\s+/g, "");
  const body = await request.json().catch(() => ({}));

  const allowed = ["contact_name", "stage", "source", "service_interest", "tags", "notes", "assigned_to", "next_follow_up", "consultation_paid", "ai_enabled"];
  const sets: string[] = [];
  const vals: any[] = [phone];
  let i = 2;
  for (const key of allowed) {
    if (body[key] !== undefined) {
      sets.push(`${key} = $${i}`);
      vals.push(body[key]);
      i++;
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  try {
    const sql = `
      INSERT INTO marketing_leads (phone, ${allowed.filter(k => body[k] !== undefined).join(", ")}, updated_at)
      VALUES ($1, ${allowed.filter(k => body[k] !== undefined).map((_, idx) => `$${idx + 2}`).join(", ")}, NOW())
      ON CONFLICT (phone) DO UPDATE SET ${sets.join(", ")}, updated_at = NOW()
      RETURNING *
    `;
    const res = await pool.query(sql, vals);
    return NextResponse.json({ lead: res.rows[0] });
  } catch (e) {
    console.error("Lead PATCH error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/marketing-leads/[phone] — remove lead (does not delete chat history)
export async function DELETE(request: NextRequest, { params }: { params: { phone: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Deleting a lead is destructive — restrict to Admin / Marketing / ProcessingLead.
  if (user.userType !== "staff" || !["Admin", "Marketing", "ProcessingLead"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const phone = decodeURIComponent(params.phone).replace(/\s+/g, "");
  try {
    await pool.query(`DELETE FROM marketing_leads WHERE phone = $1`, [phone]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
