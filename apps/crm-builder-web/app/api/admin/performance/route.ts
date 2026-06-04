// app/api/admin/performance/route.ts
//
// Monthly team performance — "errors received per preparer". An error = a
// top-level Review comment a reviewer raised on a case, counted against the
// staff member who prepared that case. Fewer errors (relative to volume) = a
// cleaner preparer. Managers use this mid-month to see who's doing the best
// quality work and recognise them.
//
//   GET ?month=YYYY-MM   → { month, rows: [...], totalErrors }
//                          (defaults to the current month, Pacific time)
//
// Auth: staff, Admin or ProcessingLead only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listAllStaff, listAllCases } from "@/lib/store";
import { getPool } from "@/lib/postgres-store";

export const runtime = "nodejs";

// "YYYY-MM" → [startISO, endISO) covering that calendar month in UTC. Good
// enough for monthly buckets; review timestamps are stored in UTC.
function monthRange(month: string): { start: string; end: string; label: string } {
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-based
  const match = /^(\d{4})-(\d{2})$/.exec(month || "");
  if (match) { y = Number(match[1]); m = Number(match[2]) - 1; }
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  const label = start.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start: start.toISOString(), end: end.toISOString(), label };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || !["Admin", "ProcessingLead"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden — managers only" }, { status: 403 });
  }

  const month = new URL(request.url).searchParams.get("month") || "";
  const { start, end, label } = monthRange(month);

  // Top-level review comments (the flags) raised this month.
  const pool = getPool();
  let comments: Array<{ case_id: string; created_at: string; author_name: string; body: string; status: string }> = [];
  try {
    const res = await pool.query(
      `SELECT case_id, created_at, author_name, body, status
         FROM review_comments
        WHERE parent_id IS NULL
          AND created_at >= $1 AND created_at < $2
        ORDER BY created_at DESC`,
      [start, end]
    );
    comments = res.rows as any;
  } catch (e) {
    // review_comments table may not exist yet on a fresh DB — treat as zero.
    console.error("[performance] review_comments read failed:", (e as Error).message);
  }

  // Map case → assigned preparer (company-agnostic) + client name for display.
  const cases = await listAllCases();
  const caseToPreparer = new Map<string, string>();
  const caseToClient = new Map<string, string>();
  for (const c of cases) {
    const who = String((c as any).assignedTo || "").trim();
    if (who && who !== "Unassigned") caseToPreparer.set(c.id, who);
    caseToClient.set(c.id, String((c as any).client || ""));
  }

  // One error detail = a single review flag, so the dashboard can drill down
  // from a preparer's count to the actual comments behind it.
  type ErrorDetail = { caseId: string; client: string; reviewer: string; text: string; date: string; status: string };

  // Aggregate errors per preparer.
  type Row = { name: string; role: string; errors: number; flaggedCases: Set<string>; details: ErrorDetail[] };
  const byName = new Map<string, Row>();
  const ensureRow = (name: string, role = "") => {
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name, role, errors: 0, flaggedCases: new Set(), details: [] });
    return byName.get(key)!;
  };

  // Seed every preparer/processing staffer at zero so a clean record shows.
  const staff = await listAllStaff();
  for (const s of staff) {
    if (["Processing", "ProcessingLead", "Admin"].includes(s.role)) {
      const r = ensureRow(s.name, s.role);
      r.role = s.role;
    }
  }

  let totalErrors = 0;
  for (const cm of comments) {
    const preparer = caseToPreparer.get(cm.case_id);
    if (!preparer) continue; // comment on an unassigned/unknown case
    const r = ensureRow(preparer);
    r.errors += 1;
    r.flaggedCases.add(cm.case_id);
    r.details.push({
      caseId: cm.case_id,
      client: caseToClient.get(cm.case_id) || "",
      reviewer: cm.author_name || "",
      text: String(cm.body || "").replace(/\s+/g, " ").trim().slice(0, 280),
      date: cm.created_at,
      status: cm.status || "open",
    });
    totalErrors += 1;
  }

  // Volume context: cases currently assigned to each preparer (so "0 errors"
  // on someone who handled 30 cases reads very differently from 0 on 0).
  const casesAssigned = new Map<string, number>();
  for (const who of caseToPreparer.values()) {
    casesAssigned.set(who.toLowerCase(), (casesAssigned.get(who.toLowerCase()) || 0) + 1);
  }

  const rows = Array.from(byName.values())
    .map((r) => ({
      name: r.name,
      role: r.role,
      errors: r.errors,
      flaggedCases: r.flaggedCases.size,
      casesAssigned: casesAssigned.get(r.name.toLowerCase()) || 0,
      details: r.details,
    }))
    // Best first: fewest errors, then most cases handled (more work + clean = better).
    .sort((a, b) => a.errors - b.errors || b.casesAssigned - a.casesAssigned);

  return NextResponse.json({ ok: true, month: label, monthKey: month || start.slice(0, 7), totalErrors, rows });
}
