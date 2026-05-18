// ─────────────────────────────────────────────────────────────────────
// POST /api/nimmi/signups/[id]/convert
//
// Convert a Nimmi signup into a real CRM Case.
// Uses the existing createCase() helper from lib/store so all existing
// integrations (Drive folder, client record, audit log) wire up.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { createCase } from "@/lib/store";
import { getNimmiPool } from "@/lib/nimmi/webhook-utils";

const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const formType = String(body.formType || "").trim();
  const assignedTo = String(body.assignedTo || "").trim() || "Unassigned";

  if (!formType) {
    return NextResponse.json(
      { error: "formType is required (e.g. 'PGWP', 'Study Permit Extension')" },
      { status: 400 }
    );
  }

  try {
    const pool = getNimmiPool();
    const result = await pool.query(
      `SELECT * FROM nimmi_signups WHERE id = $1`,
      [id]
    );
    const signup = result.rows[0];
    if (!signup) {
      return NextResponse.json({ error: "Signup not found" }, { status: 404 });
    }

    if (signup.converted_case_id) {
      return NextResponse.json(
        { error: `Already converted to case ${signup.converted_case_id}` },
        { status: 409 }
      );
    }

    const fullName =
      [signup.first_name, signup.last_name].filter(Boolean).join(" ") ||
      signup.email ||
      "Nimmi User";

    const newCase = await createCase({
      companyId: DEFAULT_COMPANY_ID,
      client: fullName,
      formType,
      leadPhone: signup.phone || undefined,
      leadEmail: signup.email || undefined,
      assignedTo,
      additionalNotes: `Converted from Nimmi signup. Signed up: ${signup.signed_up_at}`,
      sourceLeadKey: `nimmi-signup:${signup.nimmi_user_id}`,
    });

    // Mark as converted
    await pool.query(
      `UPDATE nimmi_signups SET
         converted_case_id = $1,
         handled = TRUE,
         handled_by = $2,
         handled_at = NOW()
       WHERE id = $3`,
      [newCase.id, user.name || "staff", id]
    );

    return NextResponse.json({
      ok: true,
      case_id: newCase.id,
      message: `Created case ${newCase.id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[nimmi/signups/convert] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
