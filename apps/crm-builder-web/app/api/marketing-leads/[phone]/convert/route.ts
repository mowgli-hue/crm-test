import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { createCase } from "@/lib/store";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// POST /api/marketing-leads/[phone]/convert
// Body: { client?: string, formType: string, assignedTo?: string, leadEmail?: string }
// Creates a real Case using the lead's data, marks lead as 'converted'.
export async function POST(request: NextRequest, { params }: { params: { phone: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const phone = decodeURIComponent(params.phone).replace(/\s+/g, "");
  const body = await request.json().catch(() => ({}));

  const companyId = process.env.DEFAULT_COMPANY_ID || "newton";

  try {
    // Look up the lead row to get the contact name and other context
    const leadRes = await pool.query(`SELECT * FROM marketing_leads WHERE phone = $1`, [phone]);
    const lead = leadRes.rows[0];

    const clientName = String(body.client || lead?.contact_name || "").trim();
    const formType = String(body.formType || lead?.service_interest || "").trim();

    if (!clientName) return NextResponse.json({ error: "Client name required (pass `client` in body or set contact_name on the lead)" }, { status: 400 });
    if (!formType) return NextResponse.json({ error: "formType required (e.g. 'PGWP', 'Study Permit Extension')" }, { status: 400 });

    // Create a real Case using existing store function — wires up Drive folder, client record, etc.
    const newCase = await createCase({
      companyId,
      client: clientName,
      formType,
      leadPhone: phone,
      leadEmail: body.leadEmail || undefined,
      assignedTo: body.assignedTo || lead?.assigned_to || "Unassigned",
      additionalNotes: lead?.notes ? `Converted from marketing lead. Notes: ${lead.notes}` : "Converted from marketing lead.",
      sourceLeadKey: `marketing:${phone}`,
    });

    // Mark lead as converted and link the case ID
    await pool.query(
      `INSERT INTO marketing_leads (phone, stage, converted_case_id, ai_enabled, updated_at)
       VALUES ($1, 'converted', $2, FALSE, NOW())
       ON CONFLICT (phone) DO UPDATE SET
         stage = 'converted',
         converted_case_id = $2,
         ai_enabled = FALSE,
         updated_at = NOW()`,
      [phone, newCase.id]
    );

    return NextResponse.json({ ok: true, case: newCase });
  } catch (e) {
    console.error("Lead convert error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
