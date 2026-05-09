// ─────────────────────────────────────────────────────────────────────
// POST /api/admin/unarchive-submitted
//
// One-shot recovery for the auto-archive-on-submit bug (May 2026, fixed
// in commit ebaae5e+). When staff marked cases as Submitted, the
// previous submit handler ran:
//   UPDATE whatsapp_inbox SET is_archived = TRUE WHERE phone LIKE ...
// silently moving every WhatsApp thread for that phone into Archived.
// Staff couldn't see those clients in Active inbox anymore — the most
// confusing example being CASE-1415 (sukhmandeep), whose long ongoing
// conversation "vanished" after she was submitted.
//
// This endpoint flips is_archived=FALSE for every inbox row whose phone
// matches a case that has processingStatus="submitted". After running
// it, those threads reappear in the Active inbox (or, with the new
// 3-tab system, the Submitted tab specifically).
//
// READ-ONLY for non-archive fields. Doesn't change matched_case_id,
// doesn't touch any case data, doesn't send anything. Safe to run
// multiple times — already-unarchived rows stay unarchived.
//
// Returns count of rows un-archived so staff knows the impact.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listCases } from "@/lib/store";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  // Find all submitted-case phones (last-9-digit canonical form).
  const cases = await listCases(user.companyId);
  const submittedPhones = cases
    .filter((c) => c.processingStatus === "submitted")
    .map((c) => String(c.leadPhone || "").replace(/\D/g, ""))
    .filter((p) => p.length >= 9)
    .map((p) => p.slice(-9));

  if (submittedPhones.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No submitted cases with phones — nothing to unarchive",
      unarchived: 0,
      affectedPhones: 0,
    });
  }

  // Build OR-list query — match each submitted phone via last-9-digits to
  // catch every format variant Meta has stored (with/without country code,
  // with/without +, etc.). LIKE patterns are anchored at the end.
  const conditions: string[] = [];
  const params: string[] = [];
  submittedPhones.forEach((p, i) => {
    conditions.push(`RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $${i + 1}`);
    params.push(p);
  });
  const sql = `UPDATE whatsapp_inbox SET is_archived = FALSE
                WHERE is_archived = TRUE AND (${conditions.join(" OR ")})
                RETURNING id`;

  try {
    const res = await pool.query(sql, params);
    return NextResponse.json({
      ok: true,
      unarchived: res.rowCount ?? 0,
      affectedPhones: submittedPhones.length,
      message: `Unarchived ${res.rowCount ?? 0} message rows across ${submittedPhones.length} submitted-case phone(s). Threads are now visible in the Submitted tab of the Inbox.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Database error: ${(e as Error).message.slice(0, 200)}` },
      { status: 500 }
    );
  }
}
