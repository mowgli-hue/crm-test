// ─────────────────────────────────────────────────────────────────────
// POST /api/nimmi/callbacks/[id]/convert
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { createCase } from "@/lib/store";
import { getNimmiPool } from "@/lib/nimmi/webhook-utils";

const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

const SLUG_TO_FORM_TYPE: Record<string, string> = {
  pgwp: "PGWP",
  "study-permit-extension": "Study Permit Extension",
  "express-entry": "Express Entry",
  pnp: "PNP",
  "spousal-sponsorship-inside": "Spousal Sponsorship",
  "visitor-visa": "Visitor Visa",
  "pr-card-renewal": "PR Card Renewal",
  citizenship: "Citizenship",
  consultation: "PR Strategy Consultation",
};

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
  const formTypeOverride = String(body.formType || "").trim();
  const assignedTo = String(body.assignedTo || "").trim() || "Unassigned";

  try {
    const pool = getNimmiPool();
    const result = await pool.query(
      `SELECT * FROM nimmi_callbacks WHERE id = $1`,
      [id]
    );
    const callback = result.rows[0];
    if (!callback) {
      return NextResponse.json({ error: "Callback not found" }, { status: 404 });
    }

    if (callback.converted_case_id) {
      return NextResponse.json(
        { error: `Already converted to case ${callback.converted_case_id}` },
        { status: 409 }
      );
    }

    const formType =
      formTypeOverride ||
      SLUG_TO_FORM_TYPE[callback.service_slug] ||
      callback.service_slug ||
      "Consultation";

    const fullName =
      [callback.first_name, callback.last_name].filter(Boolean).join(" ") ||
      callback.email ||
      callback.phone ||
      "Nimmi Lead";

    const notes = [
      `Converted from Nimmi callback.`,
      callback.message ? `Message: ${callback.message}` : null,
      callback.preferred_time ? `Preferred time: ${callback.preferred_time}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const newCase = await createCase({
      companyId: DEFAULT_COMPANY_ID,
      client: fullName,
      formType,
      leadPhone: callback.phone || undefined,
      leadEmail: callback.email || undefined,
      assignedTo,
      additionalNotes: notes,
      sourceLeadKey: `nimmi-callback:${callback.nimmi_callback_id}`,
    });

    // Mark converted + status done
    await pool.query(
      `UPDATE nimmi_callbacks SET
         converted_case_id = $1,
         status = 'done',
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
    console.error("[nimmi/callbacks/convert] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
