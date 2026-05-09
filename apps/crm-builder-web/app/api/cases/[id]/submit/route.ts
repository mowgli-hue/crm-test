import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase, updateCaseProcessing } from "@/lib/store";
import { appendToSubmittedSheet, syncCaseToUnderReviewSheet } from "@/lib/google-drive";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function syncToLookup(caseItem: any, applicationNumber: string, date: string) {
  try {
    const phone = String(caseItem.leadPhone || "").replace(/\D/g, "");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS submitted_apps_lookup (
        app_num TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '', app_type TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT '', submission_date TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      INSERT INTO submitted_apps_lookup (app_num, name, phone, app_type, result, submission_date)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (app_num) DO UPDATE SET
        name=excluded.name, phone=excluded.phone,
        app_type=excluded.app_type, submission_date=excluded.submission_date, updated_at=NOW()
    `, [applicationNumber, caseItem.client, phone, caseItem.formType, "", date]);
  } catch (e) {
    console.error("Lookup sync failed:", (e as Error).message);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const applicationNumber = String(body.applicationNumber || "").trim().toUpperCase();
  if (!applicationNumber) return NextResponse.json({ error: "applicationNumber required" }, { status: 400 });

  const caseItem = await getCase(user.companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const date = body.submittedAt
    ? new Date(body.submittedAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const updated = await updateCaseProcessing(user.companyId, params.id, {
    processingStatus: "submitted",
    applicationNumber,
    submittedAt: body.submittedAt || new Date().toISOString(),
  } as any);

  // Non-fatal: sync to lookup table and Google Sheet
  await syncToLookup(caseItem, applicationNumber, date);
  syncCaseToUnderReviewSheet({
    client: caseItem.client,
    formType: caseItem.formType,
    assignedTo: caseItem.assignedTo,
    reviewedBy: (caseItem as any).reviewedBy,
    processingStatus: "submitted",
    applicationNumber,
  }).catch(e => console.error("Sheet sync error:", e.message));
  try {
    await appendToSubmittedSheet({
      name: caseItem.client,
      appType: caseItem.formType,
      phone: caseItem.leadPhone ? "+" + String(caseItem.leadPhone).replace(/\D/g, "").replace(/^1/, "1") : "",
      appNumber: applicationNumber,
      submissionDate: date,
    });
  } catch (e) {
    console.error("🔴 Sheet sync FAILED:", (e as Error).message, (e as Error).stack);
  }

  // Note: we used to auto-archive the WhatsApp inbox thread on submission
  // here. Removed May 2026 — was hiding active conversations silently.
  // Staff submitted CASE-1415 (sukhmandeep) and her entire WhatsApp thread
  // disappeared from the Active inbox view, even though she was still
  // actively replying. Auto-archive felt invisible — staff didn't know
  // why the thread was gone, then thought it was lost.
  // Now staff archives manually via the 📦 button on the thread when they
  // genuinely want it out of the way. Submission of the IRCC application
  // and archival of the chat are independent concerns.

  return NextResponse.json({ ok: true, case: updated });
}
