// ─────────────────────────────────────────────────────────────────────
// POST /api/nimmi/intakes/[id]/convert
//
// Convert a Nimmi eligibility submission into a real CRM Case.
// Includes their answers as additionalNotes for context.
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
      `SELECT * FROM nimmi_intakes WHERE id = $1`,
      [id]
    );
    const intake = result.rows[0];
    if (!intake) {
      return NextResponse.json({ error: "Intake not found" }, { status: 404 });
    }

    if (intake.converted_case_id) {
      return NextResponse.json(
        { error: `Already converted to case ${intake.converted_case_id}` },
        { status: 409 }
      );
    }

    const formType =
      formTypeOverride ||
      SLUG_TO_FORM_TYPE[intake.service_slug] ||
      intake.service_slug;

    const fullName =
      [intake.first_name, intake.last_name].filter(Boolean).join(" ") ||
      intake.email ||
      "Nimmi Lead";

    // Format their eligibility answers as readable notes
    const answersFormatted = intake.answers
      ? Object.entries(intake.answers as Record<string, unknown>)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join("\n")
      : "(no answers recorded)";

    const notes = [
      `Converted from Nimmi eligibility submission.`,
      `Eligible: ${intake.eligible ? "Yes" : "No"}`,
      intake.ineligible_reason
        ? `Reason: ${intake.ineligible_reason}`
        : null,
      ``,
      `Eligibility answers:`,
      answersFormatted,
    ]
      .filter(Boolean)
      .join("\n");

    const newCase = await createCase({
      companyId: DEFAULT_COMPANY_ID,
      client: fullName,
      formType,
      leadPhone: intake.phone || undefined,
      leadEmail: intake.email || undefined,
      assignedTo,
      additionalNotes: notes,
      sourceLeadKey: `nimmi-intake:${intake.nimmi_intake_id}`,
    });

    // Mark converted
    await pool.query(
      `UPDATE nimmi_intakes SET
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
    console.error("[nimmi/intakes/convert] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
