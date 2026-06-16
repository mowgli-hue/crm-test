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
import { getActiveSession } from "@/lib/time-tracking";
import { scoreCase, isClosed, ageDays } from "@/lib/case-priority";

export const runtime = "nodejs";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

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
    .filter((c: any) => isCaseAssignedToUser(c.assignedTo, user.name));

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
