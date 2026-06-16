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
import { canSeeAllCases } from "@/lib/rbac";
import { buildCanonicalizer } from "@/lib/staff-names";

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

// Names that should NOT appear as preparers on this board (marketing / admin /
// generic accounts, and anyone the firm doesn't want ranked here). Compared
// case-insensitively against the staff display name.
const EXCLUDED_NAMES = new Set(
  ["karan", "akanksha", "neha", "lavisha", "rajwinder", "admin user", "anshika", "team", "simi das", "manisha",
   "eknoor", "aman", "simran"]
    .map((s) => s.toLowerCase().trim())
);
// Match an excluded entry against the FULL name or the FIRST name, so a list of
// first names ("rajwinder", "lavisha") still removes full-name accounts like
// "Rajwinder Kaur" / "Lavisha Dhingra".
const isExcluded = (name: string) => {
  const n = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!n) return false;
  if (EXCLUDED_NAMES.has(n)) return true;
  return EXCLUDED_NAMES.has(n.split(" ")[0]);
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Managers only — this exposes every preparer's error counts + reviewer comments.
  if (user.userType !== "staff" || !canSeeAllCases(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const month = new URL(request.url).searchParams.get("month") || "";
  const { start, end, label } = monthRange(month);

  // Top-level review comments (the flags) raised this month.
  const pool = getPool();
  let comments: Array<{ case_id: string; created_at: string; author_name: string; author_role: string; body: string; status: string }> = [];
  try {
    const res = await pool.query(
      `SELECT case_id, created_at, author_name, author_role, body, status
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

  // ALSO count the team's "⚠️ CHANGES NEEDED" flags — these are raised via the
  // Under-Review panel and saved as case_notes (NOT review_comments). Each one is
  // a round of changes a reviewer sent back, so it counts as an error on the
  // board the same way. (The review→notes mirror uses a different prefix, so
  // there's no double-counting.)
  try {
    const res2 = await pool.query(
      `SELECT case_id, created_at, added_by, text
         FROM case_notes
        WHERE text LIKE '⚠️ CHANGES NEEDED%'
          AND created_at >= $1 AND created_at < $2`,
      [start, end]
    );
    for (const r of res2.rows as any[]) {
      const clean = String(r.text || "").replace(/^⚠️ CHANGES NEEDED \(by [^)]*\):\s*/u, "").trim();
      comments.push({
        case_id: r.case_id,
        created_at: r.created_at,
        author_name: r.added_by || "Reviewer",
        author_role: "Reviewer",          // raised by a reviewer by design
        body: clean || String(r.text || ""),
        status: "open",
      });
    }
  } catch (e) {
    console.error("[performance] case_notes CHANGES NEEDED read failed:", (e as Error).message);
  }

  // ALSO count a REVIEWER's plain notes as errors — if a reviewer leaves any note
  // on a case (not just the formal "Send Changes" flag), that's a correction too.
  // Exclude the changes-needed flag (already counted), the preparer's "Changes
  // done" reply, and the review_comments mirror (NOTE-rc-). author_role is blank
  // so the reviewer check below (by canonical name/role) decides what counts.
  try {
    const res3 = await pool.query(
      `SELECT case_id, created_at, added_by, text
         FROM case_notes
        WHERE created_at >= $1 AND created_at < $2
          AND id NOT LIKE 'NOTE-rc-%'
          AND text NOT LIKE '⚠️ CHANGES NEEDED%'
          AND text NOT LIKE '✅ Changes done%'`,
      [start, end]
    );
    for (const r of res3.rows as any[]) {
      comments.push({
        case_id: r.case_id,
        created_at: r.created_at,
        author_name: r.added_by || "",
        author_role: "",
        body: String(r.text || ""),
        status: "open",
      });
    }
  } catch (e) {
    console.error("[performance] case_notes reviewer-notes read failed:", (e as Error).message);
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

  // Who counts as a "reviewer" — their flags decide the errors. Driven by role
  // so it stays correct as staff change. Newton's reviewer (Ramandeep Kaur) is a
  // ProcessingLead, and dedicated Reviewers also qualify — both roles review and
  // their flags count. Excluded accounts never count even if mis-roled.
  const REVIEWER_ROLES = new Set(["reviewer", "processinglead"]);
  const staff = await listAllStaff();

  // Removed (deactivated) staff should not appear on the board at all. Build a
  // name set (full + first name) so assignee variants also drop off.
  const inactiveNames = new Set<string>();
  for (const s of staff) {
    if ((s as any).active === false) {
      const n = String(s.name || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (n) { inactiveNames.add(n); inactiveNames.add(n.split(" ")[0]); }
    }
  }
  const isInactive = (name: string) => {
    const n = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
    return Boolean(n) && (inactiveNames.has(n) || inactiveNames.has(n.split(" ")[0]));
  };
  const isHidden = (name: string) => isExcluded(name) || isInactive(name);

  // Canonicalize assignee names onto the real staff account (shared helper with
  // conservative fuzzy matching) so variants like "sarbleen"/"Serbleen Kaur" and
  // "Sukhman"/"Sukhman Kaur" collapse to ONE row instead of fragmenting stats.
  const canonical = buildCanonicalizer(staff.map((s) => String(s.name || "")));
  // Collapse every case's assignee onto its canonical staff name.
  for (const [cid, who] of Array.from(caseToPreparer.entries())) {
    caseToPreparer.set(cid, canonical(who));
  }
  const reviewerNames = new Set(
    staff.filter((s) => REVIEWER_ROLES.has(String(s.role || "").toLowerCase()) && !isHidden(s.name))
      .map((s) => String(s.name || "").toLowerCase().trim())
  );
  const reviewerList = staff
    .filter((s) => REVIEWER_ROLES.has(String(s.role || "").toLowerCase()) && !isHidden(s.name))
    .map((s) => s.name);
  const isReviewerFlag = (cm: { author_role?: string; author_name?: string }) =>
    REVIEWER_ROLES.has(String(cm.author_role || "").toLowerCase()) ||
    reviewerNames.has(canonical(cm.author_name || "").toLowerCase().trim());

  // Role lookup by name so assignee-seeded rows still show a role label.
  const roleByName = new Map(staff.map((s) => [String(s.name || "").toLowerCase().trim(), s.role]));

  // Seed every Processing / ProcessingLead staffer at zero so a clean record
  // shows — but skip the excluded (non-preparer) accounts.
  for (const s of staff) {
    if (isHidden(s.name)) continue;
    if (["Processing", "ProcessingLead"].includes(s.role)) {
      const r = ensureRow(s.name, s.role);
      r.role = s.role;
    }
  }

  // ALSO seed anyone who is actually assigned cases (a preparer), regardless of
  // their account role — so people like Sukhman appear even if their role isn't
  // "Processing", or they're tracked only by the name on the case. Excluded
  // accounts are still skipped.
  for (const who of new Set(caseToPreparer.values())) {
    if (isHidden(who)) continue;
    const r = ensureRow(who);
    if (!r.role) r.role = roleByName.get(who.toLowerCase().trim()) || "";
  }

  let totalErrors = 0;
  for (const cm of comments) {
    // Only the reviewer's flags decide quality.
    if (!isReviewerFlag(cm)) continue;
    const preparer = caseToPreparer.get(cm.case_id);
    if (!preparer) continue; // comment on an unassigned/unknown case
    if (isHidden(preparer)) continue; // don't rank excluded or removed accounts
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
    .filter((r) => !isHidden(r.name))
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

  return NextResponse.json({
    ok: true,
    month: label,
    monthKey: month || start.slice(0, 7),
    totalErrors,
    reviewers: reviewerList,
    rows,
  });
}
