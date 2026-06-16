// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/performance-review?month=YYYY-MM
//
// A smart, all-signals performance read of the team. Pulls together, per person:
//   - volume      — cases assigned + submitted this month
//   - quality     — corrections (reviewer "changes needed") raised against them
//   - effort      — time logged (check-ins) this month
//   - efficiency  — time per submitted application
// then has the model write a fair 2-3 sentence read per person. Managers only.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listAllStaff, listAllCases } from "@/lib/store";
import { getPool } from "@/lib/postgres-store";
import { canSeeAllCases } from "@/lib/rbac";
import { teamTimeSummary } from "@/lib/time-tracking";

export const runtime = "nodejs";

function monthRange(month: string) {
  const now = new Date();
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  const mt = /^(\d{4})-(\d{2})$/.exec(month || "");
  if (mt) { y = Number(mt[1]); m = Number(mt[2]) - 1; }
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  return { start: start.toISOString(), end: end.toISOString(), label: start.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

const inWindow = (iso: string | undefined, start: string, end: string) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= Date.parse(start) && t < Date.parse(end);
};
const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

type Row = {
  name: string; role: string;
  assigned: number; submitted: number; corrections: number;
  hours: number; hoursPerSubmission: number | null;
};

async function aiReviews(rows: Row[], label: string): Promise<Record<string, string> | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || rows.length === 0) return null;
  try {
    const table = rows.map((r) =>
      `${r.name} (${r.role}): assigned ${r.assigned}, submitted ${r.submitted}, corrections ${r.corrections}, ` +
      `${r.hours}h logged${r.hoursPerSubmission !== null ? `, ${r.hoursPerSubmission}h per submission` : ""}`
    ).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1400,
        messages: [{
          role: "user",
          content:
            `You are a fair, sharp operations manager at a Canadian immigration firm reviewing ${label}.\n\n` +
            `Per team member (volume = assigned + submitted, quality = fewer corrections is better, effort = hours logged, ` +
            `efficiency = hours per submission):\n\n${table}\n\n` +
            `Write a 2-3 sentence read for EACH person: what's going well, what to watch, and one concrete suggestion. ` +
            `Be constructive and specific, never harsh. A high-volume person with few corrections is your star; ` +
            `low submissions with high hours suggests a time-management issue; high corrections suggests a quality issue. ` +
            `Reply ONLY as JSON: {"reviews":[{"name":"...","text":"..."}]}.`,
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.content?.[0]?.text || "").trim();
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const out: Record<string, string> = {};
    for (const r of json.reviews || []) if (r?.name) out[norm(r.name)] = String(r.text || "");
    return out;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || !canSeeAllCases(user.role)) {
    return NextResponse.json({ error: "Forbidden — managers only" }, { status: 403 });
  }

  const { start, end, label } = monthRange(new URL(request.url).searchParams.get("month") || "");
  const [staff, cases, time] = await Promise.all([
    listAllStaff(),
    listAllCases(),
    teamTimeSummary({ companyId: user.companyId, startISO: start, endISO: end }),
  ]);

  // Collapse assignee name variants onto the canonical staff name, so a case
  // assigned to "Sukhman" still attributes to the "Sukhman Kaur" account.
  const byFull = new Set<string>();
  const byFirst = new Map<string, string[]>();
  for (const s of staff) {
    const n = norm(s.name);
    if (!n) continue;
    byFull.add(n);
    const f = n.split(" ")[0];
    const arr = byFirst.get(f) || [];
    if (!arr.includes(n)) arr.push(n);
    byFirst.set(f, arr);
  }
  const canonical = (raw: string): string => {
    const n = norm(raw);
    if (!n || n === "unassigned") return "";
    if (byFull.has(n)) return n;
    const arr = byFirst.get(n.split(" ")[0]);
    return arr && arr.length === 1 ? arr[0] : n;
  };

  // corrections (changes-needed notes) this month, mapped case -> canonical assignee
  const caseToAssignee = new Map<string, string>();
  for (const c of cases) caseToAssignee.set(c.id, canonical(String((c as any).assignedTo || "")));
  const correctionsByPerson = new Map<string, number>();
  try {
    const r = await getPool().query(
      `SELECT case_id FROM case_notes WHERE text LIKE '⚠️ CHANGES NEEDED%' AND created_at >= $1 AND created_at < $2`,
      [start, end]
    );
    for (const row of r.rows as any[]) {
      const who = caseToAssignee.get(row.case_id);
      // Skip blank/"Unassigned" so corrections aren't bucketed under a phantom
      // person and silently dropped from real totals.
      if (who && who !== "unassigned") correctionsByPerson.set(who, (correctionsByPerson.get(who) || 0) + 1);
    }
  } catch { /* table may not exist yet */ }

  const hoursByPerson = new Map<string, number>();
  for (const p of time.perStaff) hoursByPerson.set(norm(p.staffName), Math.round((p.seconds / 3600) * 10) / 10);

  const rows: Row[] = staff
    .filter((s: any) => s.active !== false && ["Processing", "ProcessingLead", "Reviewer"].includes(s.role))
    .map((s: any) => {
      const key = norm(s.name);
      const assigned = cases.filter((c: any) => canonical(c.assignedTo) === key && String(c.processingStatus).toLowerCase() !== "submitted").length;
      // Count only by submittedAt (set on submit) — not updatedAt, which bumps on
      // any edit and would re-count old cases into this month.
      const submitted = cases.filter((c: any) => canonical(c.assignedTo) === key && String(c.processingStatus).toLowerCase() === "submitted" && inWindow((c as any).submittedAt, start, end)).length;
      const corrections = correctionsByPerson.get(key) || 0;
      const hours = hoursByPerson.get(key) || 0;
      return {
        name: s.name, role: s.role,
        assigned, submitted, corrections, hours,
        hoursPerSubmission: submitted > 0 ? Math.round((hours / submitted) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.submitted - a.submitted || a.corrections - b.corrections);

  const reviews = await aiReviews(rows, label);
  const withReviews = rows.map((r) => ({
    ...r,
    review: reviews?.[norm(r.name)] ||
      `${r.submitted} submitted, ${r.corrections} correction${r.corrections === 1 ? "" : "s"}, ${r.hours}h logged this month.`,
  }));

  return NextResponse.json({ ok: true, month: label, rows: withReviews });
}
