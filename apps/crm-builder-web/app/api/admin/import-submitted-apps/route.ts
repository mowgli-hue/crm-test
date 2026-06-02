// app/api/admin/import-submitted-apps/route.ts
//
// Import the firm's "Submitted applications" sheet (CSV) into the submitted_apps
// lookup table, so sharing a result/letter by IRCC application number can find a
// client's phone even for older clients who aren't cases in the CRM.
//
// Upload the CSV as multipart form field "file". Columns expected (by position):
//   0 Name, 1 Application Type, 2 Contact Number, 3 Application Number, 4 Submission Date
//
// Idempotent: upserts by application number, so re-importing an updated sheet is
// safe. Junk app numbers (DONE, SUBMITTED, blanks, short codes) are skipped.
//
// Auth: Admin only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { upsertSubmittedApp, countSubmittedApps } from "@/lib/postgres-store";

// Minimal RFC-4180-ish CSV parser (handles quoted fields with commas/newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Digits only; NA numbers get a leading 1; international kept as-is; too short = none.
function normPhone(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10) return "1" + d;
  if (d.length === 11 && d.startsWith("1")) return d;
  if (d.length >= 10) return d;
  return "";
}

// A real IRCC number is a letter + 6+ digits (W/V/S/E/F/C…) or a long pure-digit
// string. Everything else (DONE, SUBMITTED, 1234, S123, blanks) is skipped.
function validAppNumbers(raw: string): string[] {
  return String(raw || "")
    .split(/[\/,]/)
    .map((s) => s.replace(/[^a-z0-9]/gi, "").toUpperCase())
    .filter((n) => /^[A-Z]\d{6,}$/.test(n) || /^\d{8,}$/.test(n));
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }

  let csv = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (file && typeof (file as Blob).text === "function") csv = await (file as Blob).text();
  } catch { /* fall through to body */ }
  if (!csv) csv = await request.text().catch(() => "");
  if (!csv.trim()) return NextResponse.json({ error: "No CSV provided (upload as form field 'file')." }, { status: 400 });

  const rows = parseCsv(csv);
  if (rows.length < 2) return NextResponse.json({ error: "CSV has no data rows." }, { status: 400 });

  let imported = 0, skipped = 0, withPhone = 0;
  const failures: string[] = [];
  // Skip the header row.
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[0] || "").trim();
    const appType = String(r[1] || "").trim();
    const contact = String(r[2] || "").trim();
    const appNumbers = validAppNumbers(String(r[3] || ""));
    const submissionDate = String(r[4] || "").trim();
    if (appNumbers.length === 0) { skipped++; continue; }
    const phone = normPhone(contact);
    for (const appNumber of appNumbers) {
      try {
        await upsertSubmittedApp({ appNumber, name, phone, appType, submissionDate, rawContact: contact });
        imported++;
        if (phone) withPhone++;
      } catch (e) {
        failures.push(`${appNumber}: ${(e as Error).message}`);
      }
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    imported,
    withPhone,
    skipped,
    totalInTable: await countSubmittedApps().catch(() => -1),
    sampleErrors: failures.slice(0, 5),
    message: `Imported ${imported} application rows (${withPhone} with a usable phone). Skipped ${skipped} rows without a valid application number.`,
  });
}
