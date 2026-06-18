// ─────────────────────────────────────────────────────────────────────
// GET /api/review-queue
//
// The reviewer's prioritized "to review" list: cases that are prepped and
// waiting for review, filtered to the reviewer's block (Serbleen → PGWP/Study,
// Parinita → TRV/Visitor Record, ProcessingLead/Admin → everything), sorted by
// permit-expiry + amount-paid + oldest-waiting. Reviewers only.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listCases, listAllDocumentsByCase } from "@/lib/store";
import { scoreReview, isClosed } from "@/lib/case-priority";
import { getCaseReadiness } from "@/lib/case-readiness";
import { isReviewer, reviewerHandles } from "@/lib/review-routing";

export const runtime = "nodejs";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isReviewer(user.role)) return NextResponse.json({ ok: true, reviewer: false, cases: [] });

  const [all, docsByCase] = await Promise.all([
    listCases(user.companyId || COMPANY_ID),
    listAllDocumentsByCase(),
  ]);

  const queue = all
    .filter((c: any) => !isClosed(c))
    // Awaiting a reviewer: under review, NOT sent back to the preparer
    // (changes_needed = with preparer) and NOT already cleared by the reviewer
    // (changes_done = approved / waiting to submit). Only genuinely-unactioned
    // cases show, so approved ones don't nag the reviewer forever.
    .filter((c: any) => {
      const st = String(c.processingStatus || "").toLowerCase();
      const rev = String(c.reviewStatus || "").toLowerCase();
      return st === "under_review" && rev !== "changes_needed" && rev !== "changes_done";
    })
    // Only the cases in this reviewer's block.
    .filter((c: any) => reviewerHandles(user.name, user.role, String(c.formType || "")))
    .map((c: any) => {
      const s = scoreReview(c);
      // How complete the package is (0-100). A reviewer should pick up the
      // packages that are actually ready FIRST — a half-built one shouldn't jump
      // the queue just because it's urgent.
      const r = getCaseReadiness(c, docsByCase.get(c.id) || []);
      const completionPct = r.submissionReady
        ? 100
        : Math.round((r.intake.complete ? 30 : 0) + (r.clientDocs.complete ? 45 : 0) + (r.forms.complete ? 25 : 0));
      const missing = [...r.intake.missing, ...r.clientDocs.missing, ...r.forms.missing].slice(0, 3);
      return {
        caseId: c.id,
        client: String(c.client || ""),
        type: String(c.formType || ""),
        preparedBy: String(c.assignedTo || ""),
        reason: s.reason,
        deadlineDays: s.deadlineDays,
        amountPaid: s.amountPaid,
        daysInSystem: s.daysInSystem,
        score: s.score,
        completionPct,
        missing,
      };
    })
    // Per office: sort by COMPLETENESS first (review the ready ones first), then
    // by URGENCY (expiry/payment/age via scoreReview). Bucket completeness into
    // 10-pt bands so a 97% and a 100% aren't reordered by a tiny diff — within a
    // band, urgency decides.
    .sort((a, b) => {
      const band = (p: number) => Math.floor(p / 10);
      if (band(b.completionPct) !== band(a.completionPct)) return band(b.completionPct) - band(a.completionPct);
      return b.score - a.score;
    });

  return NextResponse.json({ ok: true, reviewer: true, count: queue.length, cases: queue });
}
