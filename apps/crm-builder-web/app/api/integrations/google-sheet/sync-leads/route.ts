import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { addNotification, createCase, listCases, listUsers } from "@/lib/store";

type LeadRow = {
  name: string;
  phone: string;
  email: string;
  formType: string;
  sourceLeadKey: string;
};

function parseCsvUrls(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((x) => String(x || "").trim()).filter(Boolean);
  }
  const raw = String(input || "").trim();
  if (!raw) return [];
  return raw
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeHeaderName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (ch !== "\r") {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

function firstMatch(headers: string[], candidates: string[]): number {
  const normalized = headers.map((h) => normalizeHeaderName(h));
  for (const candidate of candidates) {
    const idx = normalized.indexOf(normalizeHeaderName(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

function clean(value: string): string {
  return String(value ?? "").trim();
}

function normalizeApplicationType(value: string): string {
  const raw = clean(value);
  if (!raw) return "IMM5710";
  const lower = raw.toLowerCase();
  if (lower.includes("pgwp")) return "PGWP";
  if (lower.includes("work permit")) return "Work Permit";
  if (lower.includes("study permit")) return "Study Permit";
  if (lower.includes("visitor") || lower.includes("trv")) return "TRV";
  return raw;
}

function buildLeadRows(csvText: string): LeadRow[] {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0];
  const body = rows.slice(1);

  const nameIdx = firstMatch(headers, ["First name, Last Name", "Client Name", "Full Name", "Name"]);
  const phoneIdx = firstMatch(headers, ["Phone Number", "Phone", "Contact Number", "Mobile"]);
  const emailIdx = firstMatch(headers, ["Email Address", "Email"]);
  const appTypeIdx = firstMatch(headers, ["1. Application Type Selection", "Application Type", "Type"]);
  const timestampIdx = firstMatch(headers, ["Timestamp", "Created At", "Date"]);

  const result: LeadRow[] = [];
  for (const row of body) {
    const name = nameIdx >= 0 ? clean(row[nameIdx] || "") : "";
    const phone = phoneIdx >= 0 ? clean(row[phoneIdx] || "") : "";
    const email = emailIdx >= 0 ? clean(row[emailIdx] || "") : "";
    const formTypeRaw = appTypeIdx >= 0 ? clean(row[appTypeIdx] || "") : "";
    const formType = normalizeApplicationType(formTypeRaw);
    const timestamp = timestampIdx >= 0 ? clean(row[timestampIdx] || "") : "";

    if (!phone) continue;
    if (!name) continue;

    const sourceLeadKey = [timestamp, phone.toLowerCase(), email.toLowerCase(), name.toLowerCase(), formType.toLowerCase()]
      .join("|")
      .trim();

    result.push({
      name,
      phone,
      email,
      formType,
      sourceLeadKey
    });
  }

  return result;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const csvUrls = [
    ...parseCsvUrls(body?.csvUrls),
    ...parseCsvUrls(body?.csvUrl),
    ...parseCsvUrls(process.env.LEADS_SHEET_CSV_URLS),
    ...parseCsvUrls(process.env.LEADS_SHEET_CSV_URL),
    ...parseCsvUrls(process.env.NEXT_PUBLIC_LEADS_SHEET_CSV_URL)
  ];
  const uniqueCsvUrls = Array.from(new Set(csvUrls));

  if (uniqueCsvUrls.length === 0) {
    return NextResponse.json(
      { error: "CSV URL required. Set LEADS_SHEET_CSV_URL(S) or pass csvUrl/csvUrls in request body." },
      { status: 400 }
    );
  }
  const allRows: LeadRow[] = [];
  for (const csvUrl of uniqueCsvUrls) {
    try {
      const response = await fetch(csvUrl, { cache: "no-store" });
      if (!response.ok) {
        continue;
      }
      const csvText = await response.text();
      allRows.push(...buildLeadRows(csvText));
    } catch {
      continue;
    }
  }
  if (allRows.length === 0) {
    return NextResponse.json({ error: "Could not fetch any Google Sheet CSV sources." }, { status: 400 });
  }
  const dedupRows = Array.from(
    new Map(allRows.map((r) => [r.sourceLeadKey, r])).values()
  );
  const existing = await listCases(user.companyId);
  const existingKeys = new Set(existing.map((c) => c.sourceLeadKey).filter(Boolean));
  const staffUsers = await listUsers(user.companyId);
  const activeStaff = staffUsers.filter((u) => u.userType === "staff" && u.active !== false);

  let createdCount = 0;
  let skippedCount = 0;

  for (const row of dedupRows) {
    if (!row.sourceLeadKey || existingKeys.has(row.sourceLeadKey)) {
      skippedCount += 1;
      continue;
    }

    const created = await createCase({
      companyId: user.companyId,
      client: row.name,
      formType: row.formType,
      leadPhone: row.phone,
      leadEmail: row.email,
      sourceLeadKey: row.sourceLeadKey
    });
    existingKeys.add(row.sourceLeadKey);
    createdCount += 1;
    const alertMessage = `New case from Sheets: ${created.id} (${created.client} - ${created.formType}).`;
    await Promise.all(
      activeStaff.map((u) =>
        addNotification({
          companyId: user.companyId,
          userId: u.id,
          type: "ai_alert",
          message: alertMessage
        })
      )
    );

    // ── Auto-start WhatsApp intake ──
    // Without this block, leads imported from Google Sheets had cases created
    // but were never sent the intake template / questions. The case sat at 0%
    // intake until staff manually clicked "Send Intake" days later — by which
    // point the client had often forgotten about Newton.
    //
    // Same logic / skip rules as the main /api/cases POST path. We don't want
    // to fail the entire sync if intake fails for one client, so the whole
    // block is wrapped in try/catch.
    try {
      const phoneDigits = String(row.phone || "").replace(/\D/g, "");
      const skipFormTypes = ["college change", "college transfer"];
      const shouldSkip = skipFormTypes.some(t => String(row.formType || "").toLowerCase().includes(t));
      if (phoneDigits && !shouldSkip) {
        const { startIntakeSession } = await import("@/lib/whatsapp-ai-intake");
        const result = await startIntakeSession({
          caseId: created.id,
          companyId: user.companyId,
          phone: phoneDigits,
          clientName: row.name || "Client",
          formType: row.formType || "PGWP",
          existingIntake: {},
        });
        if (result.success) {
          console.log(`📱 Auto-started WhatsApp intake from Google Sheets sync: ${row.name} (${created.id})`);
        } else {
          console.error(`Auto WA intake from Sheets sync failed for ${created.id}: ${result.error}`);
        }
      } else if (!phoneDigits) {
        console.log(`⏭️  Skipped WA intake for ${created.id} (Sheets sync): no phone number`);
      } else if (shouldSkip) {
        console.log(`⏭️  Skipped WA intake for ${created.id} (Sheets sync): formType "${row.formType}" is in manual-handling list`);
      }
    } catch (e) {
      console.error(`Auto WA intake from Sheets sync failed for ${created.id}:`, (e as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    sourceRows: dedupRows.length,
    sourceCount: uniqueCsvUrls.length,
    created: createdCount,
    skipped: skippedCount
  });
}
