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
import { listCases } from "@/lib/store";
import { canStaffAccessCase } from "@/lib/rbac";
import { getActiveSession } from "@/lib/time-tracking";

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

// Deterministic priority: rework first, then review, then aging doc-chases.
function scoreCase(c: any): { score: number; reason: string } {
  const st = String(c.processingStatus || "").toLowerCase();
  const review = String(c.reviewStatus || "").toLowerCase();
  const age = ageDays(c);
  if (review === "changes_needed") return { score: 1000 - age, reason: "Reviewer sent changes back — fix and resubmit" };
  if (st === "under_review") return { score: 800 - age, reason: "In review — keep it moving" };
  if (st === "ready" || st === "ready_to_submit") return { score: 700 - age, reason: "Ready — review and submit" };
  if (st === "docs_pending" || st === "" ) return { score: 400 + age, reason: `Waiting on documents — ${Math.round(age)}d old, chase the client` };
  return { score: 300 + age, reason: `In progress — ${Math.round(age)}d since last update` };
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

  const all = await listCases(user.companyId || COMPANY_ID);
  const mine = all
    .filter((c: any) => !isClosed(c))
    .filter((c: any) => canStaffAccessCase(user.role, user.name, c.assignedTo));

  const ranked = mine
    .map((c: any) => {
      const { score, reason } = scoreCase(c);
      return {
        caseId: c.id,
        client: String(c.client || ""),
        type: String(c.formType || ""),
        status: String(c.processingStatus || "docs_pending"),
        reviewStatus: String(c.reviewStatus || ""),
        ageDays: Math.round(ageDays(c)),
        score,
        reason,
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
