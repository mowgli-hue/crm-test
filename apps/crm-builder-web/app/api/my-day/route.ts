// ─────────────────────────────────────────────────────────────────────
// GET /api/my-day
//
// The logged-in staff member's prioritized application list for today:
//   - their accessible, still-active cases (RBAC-scoped)
//   - priority + reason per case (shared lib/case-priority: deadlines +
//     document-readiness + status)
//   - an AI "do this first today" focus, with a safe deterministic fallback
//   - the user's active check-in timer
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listCases, listAllDocumentsByCase } from "@/lib/store";
import { isCaseAssignedToUser } from "@/lib/rbac";
import { getActiveSession, myDayLog } from "@/lib/time-tracking";
import { scoreCase, isClosed, ageDays } from "@/lib/case-priority";
import { computeSla } from "@/lib/case-sla";
import { nextActionFor } from "@/lib/next-action";
import { getSop } from "@/lib/sops";
import { profileForName } from "@/lib/team-config";

export const runtime = "nodejs";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

// Rough hours a typical application takes to prepare/submit end-to-end. Used to
// turn a person's weekly capacity into a realistic per-day completion target.
const HOURS_PER_APP = 2.5;

// How many applications THIS person should aim to complete today, from their
// weekly-hours capacity (team-config), minus their scheduled off-days.
function dailyTargetFor(name: string): number {
  const prof = profileForName(name);
  const weekly = prof?.weeklyHours ?? 35;
  // spread the week over the days they actually work
  const offDays = prof?.offDays?.length ?? 0;
  const workDays = Math.max(1, 5 - Math.min(offDays, 4));
  const perDay = (weekly / workDays) / HOURS_PER_APP;
  return Math.max(1, Math.min(6, Math.round(perDay)));
}

function isTodayPacific(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const fmt = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
  return fmt(d) === fmt(new Date());
}

async function aiFocus(items: Array<{ caseId: string; client: string; type: string; reason: string }>): Promise<{ focus: string; topPickIds: string[] } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || items.length === 0) return null;
  try {
    const list = items.slice(0, 25).map((x, i) => `${i + 1}. ${x.caseId} — ${x.client} — ${x.type} — ${x.reason}`).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{
          role: "user",
          content:
            `You are a Canadian immigration case manager helping a colleague plan their day. ` +
            `Here are their open applications, already roughly sorted by urgency:\n\n${list}\n\n` +
            `Reply ONLY with JSON: {"topPickIds":["CASE-...","CASE-..."],"focus":"2-3 sentence plan for today, concrete and encouraging"}. ` +
            `Pick the 1-3 cases to do FIRST today. Prefer rework (changes sent back), expired status / restoration windows, and anything due soon.`,
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.content?.[0]?.text || "").trim();
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return { focus: String(json.focus || ""), topPickIds: Array.isArray(json.topPickIds) ? json.topPickIds.slice(0, 3) : [] };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [all, docsByCase] = await Promise.all([
    listCases(user.companyId || COMPANY_ID),
    listAllDocumentsByCase(),
  ]);
  // My Day is PERSONAL: only cases assigned to me, for everyone (managers included).
  // The whole-firm view lives in /api/admin/at-risk, not here.
  const mine = all
    .filter((c: any) => !isClosed(c))
    .filter((c: any) => isCaseAssignedToUser(c.assignedTo, user.name))
    // A case that's under review is with the REVIEWER, not the processing member —
    // so it doesn't belong in their priorities. The exception: the reviewer sent
    // it back (changes_needed), which is the processing member's to fix.
    // (The reviewer's own review queue is a separate view, built later.)
    .filter((c: any) => {
      const st = String(c.processingStatus || "").toLowerCase();
      const rev = String(c.reviewStatus || "").toLowerCase();
      return !(st === "under_review" && rev !== "changes_needed");
    });

  const ranked = mine
    .map((c: any) => {
      const s = scoreCase(c, docsByCase.get(c.id) || []);
      const sla = computeSla(c.formType, c.createdAt, s.ready, c.processingStatus);
      const nextAction = nextActionFor(s.ready, c.reviewStatus);
      return {
        caseId: c.id,
        client: String(c.client || ""),
        type: String(c.formType || ""),
        status: String(c.processingStatus || "docs_pending"),
        reviewStatus: String(c.reviewStatus || ""),
        // When the reviewer last sent it back — used to show "waiting Xh" on the
        // changes-needed nudge. updatedAt is set when reviewStatus flips.
        changesSince: String(c.reviewStatus || "").toLowerCase() === "changes_needed" ? String((c as any).updatedAt || (c as any).createdAt || "") : "",
        ageDays: Math.round(ageDays(c)),
        ready: s.ready,
        deadlineDays: s.deadlineDays,
        completionPct: s.completionPct,
        daysInSystem: s.daysInSystem,
        score: s.score,
        reason: s.reason,
        // Phase 1 — strict ops layer:
        sla,            // hours-to-submit clock (status: on_track | due_soon | breached | done)
        nextAction,     // the single next step + owner + how
      };
    })
    // Order by SLA urgency first (breached, then least time left), then by the
    // existing priority score. A case about to blow its hours-deadline jumps the
    // queue over a higher-scored one that still has runway.
    .sort((a, b) => {
      const rank = (x: any) => (x.sla.status === "breached" ? 0 : x.sla.status === "due_soon" ? 1 : 2);
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra < 2 && a.sla.remainingMs !== b.sla.remainingMs) return a.sla.remainingMs - b.sla.remainingMs;
      return b.score - a.score;
    });

  // ── Capacity-driven daily plan ──
  // The person gets a TARGET (sized to their weekly capacity) and a top-N
  // "complete these today" list. The queue is already sorted SLA-first / oldest
  // first, so anything not finished today is older tomorrow and naturally rises
  // to the top — yesterday's leftovers lead the next day automatically. We also
  // tag carryover = cases already past their submit deadline (overdue), which is
  // exactly the "didn't get done, do it first" set.
  const dailyTarget = dailyTargetFor(user.name);
  const submittedTodayCount = all.filter(
    (c: any) => isCaseAssignedToUser(c.assignedTo, user.name) && isTodayPacific((c as any).submittedAt),
  ).length;
  const remainingToday = Math.max(0, dailyTarget - submittedTodayCount);
  const todaysPlan = ranked.slice(0, Math.max(dailyTarget, 1)).map((r) => ({
    caseId: r.caseId,
    client: r.client,
    type: r.type,
    nextStep: r.nextAction?.step || "",
    sla: r.sla,
    // Overdue (past submit deadline) or sent back for changes = a leftover that
    // should have been done already → do it FIRST today.
    carryover: r.sla.status === "breached" || String(r.reviewStatus || "").toLowerCase() === "changes_needed",
  }));

  const ai = await aiFocus(ranked.map((r) => ({ caseId: r.caseId, client: r.client, type: r.type, reason: r.reason })));
  const topPickIds = ai?.topPickIds?.length ? ai.topPickIds : ranked.slice(0, 1).map((r) => r.caseId);
  const active = await getActiveSession(user.id);
  // The person's own completed sessions today — their auto-built "what I did
  // today" report (works for processing, reviewer, lead — everyone checks in).
  const todayLog = await myDayLog(user.id);
  const todaySeconds = todayLog.reduce((a, e) => a + (e.durationSeconds || 0), 0);

  // Work Now — the single directive: the top of the (SLA-first) queue. This is
  // what the strict punch-in card points at when the person opens the CRM. If
  // they're already punched into a case, the UI keeps showing that one as active.
  const top = ranked[0] || null;
  const workNow = top
    ? {
        caseId: top.caseId,
        client: top.client,
        type: top.type,
        step: top.nextAction.step,
        owner: top.nextAction.owner,
        how: top.nextAction.how,
        sop: getSop(top.nextAction.key, top.type), // full step-by-step procedure
        sla: top.sla,
        reason: top.reason,
      }
    : null;

  return NextResponse.json({
    ok: true,
    count: ranked.length,
    // Capacity-driven plan for today.
    plan: {
      dailyTarget,
      submittedToday: submittedTodayCount,
      remainingToday,
      carryoverCount: todaysPlan.filter((p) => p.carryover).length,
      cases: todaysPlan,
    },
    focus: ai?.focus || (ranked[0] ? `Start with ${ranked[0].caseId} (${ranked[0].client}) — ${ranked[0].reason.toLowerCase()}.` : "No open applications assigned to you. Nice and clear."),
    topPickIds,
    workNow,
    activeCaseId: active?.caseId || null,
    activeStartedAt: active?.startedAt || null,
    cases: ranked,
    todaySeconds,
    todayLog: todayLog.map((e) => ({
      caseId: e.caseId, durationSeconds: e.durationSeconds, outcome: e.outcome, note: e.note, endedAt: e.endedAt,
    })),
  });
}
