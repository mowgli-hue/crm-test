// ─────────────────────────────────────────────────────────────────────
// POST /api/admin/decision-email-sync
//
// Reads Newton's Gmail inbox, finds IRCC emails that reference a CASE's
// application number, and acts on any DECISION so nothing is missed:
//   • refused           → record the result (reopens the file + creates the
//                         "investigate & decide reconsideration/re-apply" task)
//   • approved          → record the approval on the case
//   • fairness/request  → record + create a "respond before deadline" task
//   • decision unclear  → create a "check the portal & record the result" task
//
// Idempotent: each case is marked decisionFlaggedAt once handled, so the 30-min
// poll never re-records or re-flags it.
//
// Auth: admin session OR ?systemToken= (for the cron).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listAllCases, addLegacyResult, addTask, markCaseDecisionFlagged } from "@/lib/store";
import { fetchRecentInbox, imapConfigured } from "@/lib/gmail-imap";
import { looksLikeIrcc, extractAppNumbers, detectDecision } from "@/lib/tracker-email-parser";

const norm = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("systemToken") || "";
  const sysOk = Boolean(process.env.AUTH_RECOVERY_TOKEN) && token === process.env.AUTH_RECOVERY_TOKEN;
  let companyId = url.searchParams.get("companyId") || "newton";
  if (!sysOk) {
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff" || !["Admin", "ProcessingLead"].includes(user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    companyId = user.companyId;
  }
  if (!imapConfigured()) {
    return NextResponse.json({ error: "Gmail IMAP not configured." }, { status: 503 });
  }
  const dry = url.searchParams.get("dry") === "1";
  const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days") || 5)));

  // Index submitted cases by normalized application number.
  const cases = (await listAllCases()).filter((c) => c.companyId === companyId);
  const byApp = new Map<string, (typeof cases)[number]>();
  for (const c of cases) {
    const k = norm((c as any).applicationNumber);
    if (k) byApp.set(k, c);
  }

  let emails: Awaited<ReturnType<typeof fetchRecentInbox>> = [];
  try {
    emails = await fetchRecentInbox({ sinceDays: days, max: 80 });
  } catch (e) {
    return NextResponse.json({ error: `IMAP read failed: ${(e as Error).message}` }, { status: 502 });
  }

  const acted: any[] = [];
  const seen = new Set<string>(); // one action per case per run

  for (const em of emails) {
    if (!looksLikeIrcc(em.from)) continue;
    const decision = detectDecision(em.subject, em.text);
    if (!decision) continue;
    const apps = extractAppNumbers(`${em.subject}\n${em.text}`);
    let match: (typeof cases)[number] | undefined;
    for (const a of apps) { const hit = byApp.get(norm(a)); if (hit) { match = hit; break; } }
    if (!match || seen.has(match.id)) continue;
    if ((match as any).decisionFlaggedAt) continue; // already handled

    seen.add(match.id);
    const date = em.date.slice(0, 10);
    const owner = String((match as any).reviewedBy || match.assignedTo || "Unassigned");

    if (dry) { acted.push({ case: match.id, client: match.client, decision, dryRun: true }); continue; }

    try {
      if (decision === "refused" || decision === "approved" || decision === "fairness") {
        await addLegacyResult({
          companyId,
          clientName: match.client,
          applicationNumber: String((match as any).applicationNumber || ""),
          resultDate: date,
          outcome: decision === "fairness" ? "request_letter" : decision,
          notes: `Auto-detected from IRCC email "${em.subject.slice(0, 90)}" (${date}).`,
          forceMatchedCaseId: match.id,
          createdByUserId: "system",
          createdByName: "IRCC Email Auto",
        });
        // addLegacyResult records the decision, reopens on refusal, and creates
        // the follow-up task + sets decisionFlaggedAt.
      } else {
        // "check" — IRCC sent a decision/correspondence but didn't state the
        // outcome. Flag a task so a human reads the portal and records it.
        await addTask({
          companyId,
          caseId: match.id,
          title: "📬 IRCC decision/correspondence — check the portal & record the result",
          description: `An IRCC email referenced this file ("${em.subject.slice(0, 90)}", ${date}) but didn't state the outcome. Sign in to the IRCC account, see if it's an approval / refusal / request, and record the result so the right follow-up fires.`,
          createdBy: "ai",
          assignedTo: owner,
          priority: "high",
        });
        await markCaseDecisionFlagged(companyId, match.id);
      }
      acted.push({ case: match.id, client: match.client, app: (match as any).applicationNumber, decision, owner });
    } catch (e) {
      acted.push({ case: match.id, decision, error: (e as Error).message.slice(0, 120) });
    }
  }

  return NextResponse.json({ ok: true, dryRun: dry, emailsScanned: emails.length, actedCount: acted.length, acted });
}
