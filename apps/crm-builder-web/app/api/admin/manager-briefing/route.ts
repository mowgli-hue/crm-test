// app/api/admin/manager-briefing/route.ts
//
// "Manager watch" — an at-a-glance read of what needs the manager's attention
// across the whole CRM. Read-only: it never changes anything, it just looks at
// cases + review flags + leads + submissions and reports.
//
//   GET                 → { ok, generatedAt, summary (text), sections {...} }
//   GET ?format=text    → plain-text briefing only (handy for WhatsApp/email)
//
// Auth: staff, Admin / ProcessingLead (managers).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listAllCases } from "@/lib/store";
import { getPool } from "@/lib/postgres-store";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

export const runtime = "nodejs";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (iso?: string) => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / DAY : Infinity;
};
const daysUntil = (iso?: string) => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (t - Date.now()) / DAY : Infinity;
};
const isToday = (iso?: string) => daysAgo(iso) >= 0 && daysAgo(iso) < 1;

export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const isSystem = isValidSystemToken(sp.get("systemToken") || "");
  if (!isSystem) {
    const user = await getCurrentUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.userType !== "staff" || !["Admin", "ProcessingLead"].includes(user.role)) {
      return NextResponse.json({ error: "Forbidden — managers only" }, { status: 403 });
    }
  }

  const cases = await listAllCases();
  const active = cases.filter((c) => {
    const st = String((c as any).caseStatus || "");
    return st !== "archived" && st !== "closed";
  });

  // ── Cases needing attention ──
  // Refusals reopened for follow-up — investigate & decide reconsideration/re-apply.
  const refusalsToAction = active
    .filter((c: any) => c.finalOutcome === "refused" && c.reopenedForReconsideration)
    .map((c: any) => ({ id: c.id, client: c.client, formType: c.formType, assignedTo: c.assignedTo, when: String(c.decisionDate || "").slice(0, 10) }))
    .sort((a, b) => String(b.when).localeCompare(String(a.when)));

  const unassigned = active
    .filter((c) => {
      const a = String((c as any).assignedTo || "").trim();
      return (!a || a === "Unassigned") && (c as any).processingStatus !== "submitted";
    })
    .map((c) => ({ id: c.id, client: (c as any).client, formType: (c as any).formType }));

  const stuckInReview = active
    .filter((c) => (c as any).processingStatus === "under_review" && daysAgo((c as any).reviewStartedAt) > 3)
    .map((c) => ({ id: c.id, client: (c as any).client, assignedTo: (c as any).assignedTo, days: Math.floor(daysAgo((c as any).reviewStartedAt)) }));

  const docsPendingLong = active
    .filter((c) => (c as any).processingStatus === "docs_pending" && daysAgo((c as any).createdAt) > 7)
    .map((c) => ({ id: c.id, client: (c as any).client, assignedTo: (c as any).assignedTo, days: Math.floor(daysAgo((c as any).createdAt)) }))
    .sort((a, b) => b.days - a.days);

  // The processing priority the owner actually wants: cases where the DOCS ARE IN
  // and it's in the team's court (being prepped / reviewed / fixed) — i.e. things
  // that can actually be SUBMITTED. Oldest first. Excludes non-application admin
  // types and anything already submitted.
  const NON_APP = ["not for processing", "college change", "webform", "web form", "pr consultation", "consultation", "atip"];
  const isRealApp = (c: any) => { const ft = String(c.formType || "").toLowerCase(); return Boolean(ft) && !NON_APP.some((t) => ft.includes(t)); };
  const readyToSubmit = active
    .filter((c: any) => {
      if (!isRealApp(c)) return false;
      if (c.processingStatus === "submitted" || c.submittedAt) return false;
      const st = String(c.processingStatus || "");
      const rv = String(c.reviewStatus || "").toLowerCase();
      return st === "under_review" || rv === "changes_needed" || rv === "changes_done";
    })
    .map((c: any) => {
      const rv = String(c.reviewStatus || "").toLowerCase();
      const phase = rv === "changes_done" ? "ready to submit" : rv === "changes_needed" ? "changes to fix" : "in review";
      return { id: c.id, client: c.client, formType: c.formType, assignedTo: c.assignedTo, phase, days: Math.floor(daysAgo(c.createdAt)), delayReason: String(c.delayReason || "").trim() };
    })
    .sort((a, b) => b.days - a.days);

  const expiringPermits = active
    .filter((c) => { const d = daysUntil((c as any).permitExpiryDate); return d >= 0 && d <= 30; })
    .map((c) => ({ id: c.id, client: (c as any).client, daysLeft: Math.ceil(daysUntil((c as any).permitExpiryDate)) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const submittedToday = active
    .filter((c) => isToday((c as any).submittedAt))
    .map((c) => ({ id: c.id, client: (c as any).client, formType: (c as any).formType }));

  // Status counts
  const counts: Record<string, number> = { docs_pending: 0, under_review: 0, submitted: 0, other: 0 };
  for (const c of active) {
    const k = String((c as any).processingStatus || "docs_pending");
    counts[k] = (counts[k] || 0) + 1;
  }

  // ── Review flags raised in the last 48h ──
  const pool = getPool();
  const since = new Date(Date.now() - 2 * DAY).toISOString();
  let recentFlags: Array<{ caseId: string; reviewer: string; text: string; at: string }> = [];
  try {
    const rc = await pool.query(
      `SELECT case_id, author_name, body, created_at FROM review_comments
        WHERE parent_id IS NULL AND created_at >= $1 ORDER BY created_at DESC LIMIT 50`, [since]);
    for (const r of rc.rows as any[]) recentFlags.push({ caseId: r.case_id, reviewer: r.author_name || "Reviewer", text: String(r.body || "").replace(/\s+/g, " ").slice(0, 120), at: r.created_at });
  } catch { /* table may not exist */ }
  try {
    const cn = await pool.query(
      `SELECT case_id, added_by, text, created_at FROM case_notes
        WHERE text LIKE '⚠️ CHANGES NEEDED%' AND created_at >= $1 ORDER BY created_at DESC LIMIT 50`, [since]);
    for (const r of cn.rows as any[]) recentFlags.push({ caseId: r.case_id, reviewer: r.added_by || "Reviewer", text: String(r.text || "").replace(/^⚠️ CHANGES NEEDED \(by [^)]*\):\s*/u, "").replace(/\s+/g, " ").slice(0, 120), at: r.created_at });
  } catch { /* table may not exist */ }
  recentFlags.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // ── Marketing inbox + leads ──
  let unreadInbox = 0, newLeadsToday = 0;
  try {
    const u = await pool.query(`SELECT COUNT(*)::int n FROM marketing_inbox WHERE direction='inbound' AND is_read=FALSE`);
    unreadInbox = u.rows[0]?.n ?? 0;
  } catch { /* */ }
  try {
    const l = await pool.query(`SELECT COUNT(*)::int n FROM marketing_leads WHERE created_at >= NOW() - INTERVAL '1 day'`);
    newLeadsToday = l.rows[0]?.n ?? 0;
  } catch { /* */ }

  // ── Results sent today ──
  let resultsSentToday = 0;
  try {
    const r = await pool.query(`SELECT COUNT(*)::int n FROM sent_results_log WHERE created_at >= NOW() - INTERVAL '1 day'`);
    resultsSentToday = r.rows[0]?.n ?? 0;
  } catch { /* */ }

  const sections = {
    pipeline: counts,
    needsAttention: {
      readyToSubmit,
      unassigned,
      stuckInReview,
      docsPendingLong,
      expiringPermits,
    },
    activityToday: { submittedToday, resultsSentToday, newLeadsToday },
    recentReviewFlags: recentFlags.slice(0, 15),
    inbox: { unread: unreadInbox },
  };

  // ── Plain-text briefing ──
  const L: string[] = [];
  const now = new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" });
  L.push(`📋 Newton CRM — Manager Briefing (${now})`);
  L.push("");
  L.push(`Pipeline: ${counts.docs_pending} docs-pending · ${counts.under_review} in review · ${counts.submitted} submitted`);
  L.push("");
  if (refusalsToAction.length) {
    L.push(`🔴 ${refusalsToAction.length} REFUSAL(S) to action — investigate the grounds & decide reconsideration / re-apply / appeal:`);
    for (const c of refusalsToAction.slice(0, 12)) L.push(`   • ${c.id} ${c.client} (${c.formType}) — refused ${c.when || "?"} · ${c.assignedTo || "Unassigned"}`);
    L.push("");
  }
  if (readyToSubmit.length) {
    L.push(`🟢 SUBMIT FIRST — ${readyToSubmit.length} case(s) in the team's court (docs in), oldest first:`);
    for (const c of readyToSubmit) {
      // Full list (no truncation). For old files, show the recorded delay reason,
      // or flag that none was given so the owner can ask.
      const why = c.delayReason
        ? `  ↳ why: ${c.delayReason}`
        : (c.days >= 21 ? `  ↳ ⚠️ no reason on file — ask ${c.assignedTo || "owner"} why it's ${c.days}d old` : "");
      L.push(`   • ${c.id} ${c.client} (${c.formType}) — ${c.days}d · ${c.phase} · ${c.assignedTo || "Unassigned"}`);
      if (why) L.push(why);
    }
    L.push("");
  }
  if (unassigned.length) {
    L.push(`🟠 ${unassigned.length} unassigned case(s) — need an owner:`);
    for (const c of unassigned.slice(0, 8)) L.push(`   • ${c.id} ${c.client} (${c.formType})`);
    if (unassigned.length > 8) L.push(`   • …and ${unassigned.length - 8} more`);
    L.push("");
  }
  if (stuckInReview.length) {
    L.push(`🔵 ${stuckInReview.length} case(s) in review over 3 days:`);
    for (const c of stuckInReview.slice(0, 6)) L.push(`   • ${c.id} ${c.client} — ${c.days}d (${c.assignedTo || "?"})`);
    L.push("");
  }
  if (expiringPermits.length) {
    L.push(`⏰ ${expiringPermits.length} permit(s) expiring within 30 days:`);
    for (const c of expiringPermits.slice(0, 6)) L.push(`   • ${c.id} ${c.client} — ${c.daysLeft}d left`);
    L.push("");
  }
  if (docsPendingLong.length) {
    L.push(`📂 ${docsPendingLong.length} case(s) stalled waiting on CLIENT docs over a week (chase the client — not team's court):`);
    for (const c of docsPendingLong.slice(0, 6)) L.push(`   • ${c.id} ${c.client} — ${c.days}d (${c.assignedTo || "?"})`);
    L.push("");
  }
  if (recentFlags.length) {
    L.push(`📝 ${recentFlags.length} review change(s) raised in the last 48h:`);
    for (const f of recentFlags.slice(0, 6)) L.push(`   • ${f.caseId} (by ${f.reviewer}): ${f.text}`);
    L.push("");
  }
  L.push(`Today: ${submittedToday.length} submitted · ${resultsSentToday} results sent · ${newLeadsToday} new leads · ${unreadInbox} unread inbox`);
  const summary = L.join("\n");

  if (sp.get("format") === "text") {
    return new NextResponse(summary, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), summary, sections });
}
