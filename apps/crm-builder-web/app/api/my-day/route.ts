// ─────────────────────────────────────────────────────────────────────
// GET /api/my-day
//
// The logged-in staff member's prioritized application list for today:
//   - their accessible, still-active cases (RBAC-scoped)
//   - a deterministic priority score + one-line reason per case
//   - an AI "do this first today" focus (top picks + short rationale), with a
//     safe deterministic fallback if the model is unavailable
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listCases, listAllDocumentsByCase } from "@/lib/store";
import { canStaffAccessCase } from "@/lib/rbac";
import { getActiveSession } from "@/lib/time-tracking";
import { getCaseReadiness } from "@/lib/case-readiness";
import type { DocumentItem } from "@/lib/models";

export const runtime = "nodejs";

const DAY = 86_400_000;
const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

// Cases that are finished / not part of the working pipeline.
function isClosed(c: any): boolean {
  const ft = String(c.formType || "").toLowerCase();
  const st = String(c.processingStatus || "").toLowerCase();
  return st === "submitted" || st === "closed" || ft.includes("not for processing") || ft.includes("consultation");
}

function ageDays(c: any): number {
  const t = Date.parse(c.updatedAt || c.createdAt || "") || Date.now();
  return Math.max(0, (Date.now() - t) / DAY);
}

// Days until a date (negative = already passed). null if unknown.
function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / DAY);
}

// The most urgent real deadline we know about: an explicit dueInDays, or the
// client's current-status/permit expiry (from the case or intake).
function deadlineDays(c: any): number | null {
  const intake = c.pgwpIntake || {};
  const candidates: Array<number | null> = [
    Number.isFinite(Number(c.dueInDays)) ? Number(c.dueInDays) : null,
    daysUntil(c.permitExpiryDate),
    daysUntil(intake.studyPermitExpiryDate),
    daysUntil(intake.workPermitExpiryDate),
  ];
  const known = candidates.filter((x): x is number => x !== null);
  return known.length ? Math.min(...known) : null;
}

function deadlineBoost(d: number | null): number {
  if (d === null) return 0;
  if (d < 0) return 460;     // expired — restoration / overdue, most urgent
  if (d <= 3) return 400;
  if (d <= 7) return 300;
  if (d <= 14) return 180;
  if (d <= 30) return 90;
  return 0;
}

type Scored = { score: number; reason: string; ready: "submit" | "assemble" | "docs" | "review" | "progress"; deadlineDays: number | null };

// Priority from real signals: rework/review, document-readiness, and deadlines.
function scoreCase(c: any, docs: DocumentItem[]): Scored {
  const st = String(c.processingStatus || "").toLowerCase();
  const review = String(c.reviewStatus || "").toLowerCase();
  const age = ageDays(c);
  const d = deadlineDays(c);
  const dBoost = deadlineBoost(d);
  const r = getCaseReadiness(c, docs);

  // Deadline phrase appended to whatever the main driver is.
  const dueNote =
    d === null ? "" :
    d < 0 ? ` · status expired ${Math.abs(d)}d ago — restoration window` :
    d <= 30 ? ` · due in ${d}d` : "";

  let base: number, reason: string, ready: Scored["ready"];
  if (review === "changes_needed") {
    base = 1000; ready = "review"; reason = "Reviewer sent changes back — fix and resubmit";
  } else if (st === "under_review") {
    base = 820; ready = "review"; reason = "In review";
  } else if (r.submissionReady || st === "ready" || st === "ready_to_submit") {
    base = 760; ready = "submit"; reason = "Ready to submit";
  } else if (r.intake.complete && r.clientDocs.complete && !r.forms.complete) {
    base = 640; ready = "assemble"; reason = "Docs complete — assemble forms";
  } else if (!r.clientDocs.complete || !r.intake.complete) {
    const miss = [...r.clientDocs.missing, ...r.intake.missing].slice(0, 3).join(", ");
    base = 380 + age; ready = "docs"; reason = miss ? `Waiting on: ${miss}` : `Waiting on documents — ${Math.round(age)}d old`;
  } else {
    base = 300 + age; ready = "progress"; reason = `In progress — ${Math.round(age)}d since last update`;
  }

  return { score: base + dBoost + age * 0.1, reason: reason + dueNote, ready, deadlineDays: d };
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
            `Pick the 1-3 cases to do FIRST today. Prefer rework (changes sent back) and anything time-sensitive.`,
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
  const mine = all
    .filter((c: any) => !isClosed(c))
    .filter((c: any) => canStaffAccessCase(user.role, user.name, c.assignedTo));

  const ranked = mine
    .map((c: any) => {
      const s = scoreCase(c, docsByCase.get(c.id) || []);
      return {
        caseId: c.id,
        client: String(c.client || ""),
        type: String(c.formType || ""),
        status: String(c.processingStatus || "docs_pending"),
        reviewStatus: String(c.reviewStatus || ""),
        ageDays: Math.round(ageDays(c)),
        ready: s.ready,
        deadlineDays: s.deadlineDays,
        score: s.score,
        reason: s.reason,
      };
    })
    .sort((a, b) => b.score - a.score);

  const ai = await aiFocus(ranked.map((r) => ({ caseId: r.caseId, client: r.client, type: r.type, reason: r.reason })));
  const topPickIds = ai?.topPickIds?.length ? ai.topPickIds : ranked.slice(0, 1).map((r) => r.caseId);

  const active = await getActiveSession(user.name);

  return NextResponse.json({
    ok: true,
    count: ranked.length,
    focus: ai?.focus || (ranked[0] ? `Start with ${ranked[0].caseId} (${ranked[0].client}) — ${ranked[0].reason.toLowerCase()}.` : "No open applications assigned to you. Nice and clear."),
    topPickIds,
    activeCaseId: active?.caseId || null,
    activeStartedAt: active?.startedAt || null,
    cases: ranked,
  });
}
