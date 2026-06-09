// app/api/admin/fix-duplicate-cases/route.ts
//
// Diagnose + repair duplicate CASE-ids caused by company_id drift.
//
//   GET  ?phone=4376607947            → report only (no changes): duplicate ids,
//                                        company distribution, phone matches.
//   POST { confirm: true, alignCompanyId?: "newton" }
//                                      → keep the oldest case for each colliding
//                                        id, give every newer duplicate a fresh
//                                        unique CASE number; optionally re-point
//                                        repaired cases to alignCompanyId so the
//                                        processing team can see them.
//
// Admin only. The repair is reversible in spirit (it only renames/moves the
// duplicate, never deletes) but still gated behind an explicit confirm.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { inspectCaseData, repairDuplicateCaseIds } from "@/lib/store";
import { Pool } from "pg";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }
  const sp = request.nextUrl.searchParams;
  const phone = sp.get("phone") || undefined;
  const caseId = sp.get("caseId") || undefined;
  const name = sp.get("name") || undefined;
  const report = await inspectCaseData({ phone, caseId, name });

  // Also pull the marketing-lead row for this phone so we can see where its
  // converted_case_id points (this is what makes a lead LOOK converted while no
  // real case exists for them).
  let marketingLead: any = null;
  if (phone) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
    try {
      const digits = String(phone).replace(/\D/g, "");
      const r = await pool.query(
        `SELECT phone, contact_name, stage, service_interest, converted_case_id, assigned_to, updated_at
           FROM marketing_leads
          WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = RIGHT($1, 10)`,
        [digits]
      );
      marketingLead = r.rows;
    } catch (e) {
      marketingLead = { error: (e as Error).message };
    } finally {
      await pool.end().catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, report, marketingLead });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return NextResponse.json(
      { error: "Confirmation required. Re-send with { confirm: true }. Actions: omit `action` to repair duplicate ids; or { action:'relinkLead', phone, caseId } to point a marketing lead's converted_case_id at the right case (caseId empty/null clears it)." },
      { status: 400 }
    );
  }

  // ── action: relinkLead ──
  // Repoint a marketing lead's converted_case_id at the correct case (or clear
  // it). Use this when a lead got stamped onto the wrong person's case.
  if (body?.action === "relinkLead") {
    const phone = String(body?.phone || "").replace(/\D/g, "");
    if (!phone) return NextResponse.json({ error: "phone is required for relinkLead" }, { status: 400 });
    const caseId = body?.caseId == null || String(body.caseId).trim() === "" ? null : String(body.caseId).trim();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
    try {
      const r = await pool.query(
        `UPDATE marketing_leads
            SET converted_case_id = $2::text,
                stage = CASE WHEN $2::text IS NULL THEN stage ELSE 'converted' END,
                updated_at = NOW()
          WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = RIGHT($1::text, 10)
          RETURNING phone, contact_name, stage, converted_case_id`,
        [phone, caseId]
      );
      console.log(`[fix-duplicate-cases] ${user.name || user.id} relinked lead ${phone} -> ${caseId || "NULL"}`);
      return NextResponse.json({ ok: true, action: "relinkLead", updated: r.rows });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    } finally {
      await pool.end().catch(() => {});
    }
  }

  const alignCompanyId = typeof body?.alignCompanyId === "string" && body.alignCompanyId.trim()
    ? body.alignCompanyId.trim()
    : undefined;

  const { changes } = await repairDuplicateCaseIds({ alignCompanyId });
  console.log(`[fix-duplicate-cases] ${user.name || user.id} repaired ${changes.length} duplicate case id(s)`, changes);
  return NextResponse.json({ ok: true, repaired: changes.length, changes });
}
