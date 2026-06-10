// app/api/admin/case-agent/route.ts
//
// The Case Agent. Crawls every active case, works out the next action for each,
// and (optionally) does the safe ones automatically.
//
//   GET                     → prioritized assessment of all active cases
//                             { summary, actionable, cases }
//   POST { act:true, max? } → assemble files that are READY (auto-prepare only).
//                             Never messages clients, never submits to IRCC —
//                             those stay human-gated. Doc-chasing is reported,
//                             not auto-sent.
//
// Auth: staff Admin / ProcessingLead, or an internal systemToken (for a
// scheduled run).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listAllCases, listAllDocumentsByCase } from "@/lib/store";
import { assessAll, type CaseAssessment } from "@/lib/case-agent";
import { isValidSystemToken, getAuthRecoveryToken } from "@/lib/auth-recovery-token";

export const runtime = "nodejs";

function baseUrl(): string {
  return process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL || "https://crm.newtonimmigration.com";
}

async function gate(request: NextRequest, systemToken?: string) {
  if (isValidSystemToken(systemToken)) return { ok: true as const };
  const user = await getCurrentUserFromRequest(request);
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" };
  if (user.userType !== "staff" || !["Admin", "ProcessingLead"].includes(user.role)) {
    return { ok: false as const, status: 403, error: "Forbidden — managers only" };
  }
  return { ok: true as const };
}

function summarize(cases: CaseAssessment[]) {
  const byStage: Record<string, number> = {};
  for (const c of cases) byStage[c.stage] = (byStage[c.stage] || 0) + 1;
  return {
    total: cases.length,
    byStage,
    readyToPrepare: cases.filter((c) => c.autoActionKey === "auto_prepare").length,
    awaitingDocs: cases.filter((c) => c.stage === "awaiting_docs").length,
    needsOwner: cases.filter((c) => c.stage === "needs_owner").length,
    changesNeeded: cases.filter((c) => c.stage === "changes_needed").length,
    formsOutstanding: cases.filter((c) => c.formsMissing.length > 0 && c.stage !== "submitted").length,
  };
}

export async function GET(request: NextRequest) {
  const g = await gate(request, request.nextUrl.searchParams.get("systemToken") || undefined);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });

  const [cases, docsByCase] = await Promise.all([listAllCases(), listAllDocumentsByCase()]);
  const assessed = assessAll(cases as any, docsByCase as any);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: summarize(assessed),
    actionable: assessed.filter((c) => c.autoDoable).slice(0, 50),
    cases: assessed.slice(0, 200),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const g = await gate(request, body?.systemToken);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  if (body?.act !== true) {
    return NextResponse.json(
      { error: "Send { act: true } to let the agent assemble files that are ready. It only runs auto-prepare (no client messages, no IRCC submission)." },
      { status: 400 }
    );
  }
  const max = Math.min(Math.max(Number(body?.max) || 5, 1), 25);

  const [cases, docsByCase] = await Promise.all([listAllCases(), listAllDocumentsByCase()]);
  const assessed = assessAll(cases as any, docsByCase as any);
  const ready = assessed.filter((c) => c.autoActionKey === "auto_prepare").slice(0, max);

  const token = getAuthRecoveryToken();
  const done: Array<{ caseId: string; client: string; ok: boolean; result?: string; error?: string }> = [];
  for (const c of ready) {
    try {
      const res = await fetch(`${baseUrl()}/api/cases/${c.caseId}/auto-prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemToken: token }),
      });
      const data = await res.json().catch(() => ({}));
      done.push({
        caseId: c.caseId, client: c.client,
        ok: res.ok && data?.ok !== false && !data?.error,
        result: data?.message || (data?.prepared ? "prepared" : data?.reason),
        error: data?.error,
      });
    } catch (e) {
      done.push({ caseId: c.caseId, client: c.client, ok: false, error: (e as Error).message });
    }
  }
  console.log(`[case-agent] assembled ${done.filter((d) => d.ok).length}/${ready.length} ready files`);
  return NextResponse.json({ ok: true, attempted: ready.length, assembled: done.filter((d) => d.ok).length, results: done });
}
