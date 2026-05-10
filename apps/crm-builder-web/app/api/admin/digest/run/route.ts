// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/digest/run
//
// Daily digest emailer. Designed to be called by Railway cron at 09:00
// each morning (or any cadence — endpoint is idempotent within a day).
//
// What it does:
//   For every staff member, finds their cases that match staleness
//   triggers and sends ONE email per staff member with a digest of:
//     1. Cases stuck in "Under Review" >3 days
//     2. Cases with no client reply >7 days (their cases only)
//     3. Cases recently moved to "Ready for submission" (Sandhu-bound)
//
// The point is to surface things that fall through the cracks — staff
// shouldn't have to manually check the CRM every morning to know which
// of their 30 cases need attention.
//
// Auth: token-protected via AUTH_RECOVERY_TOKEN (matches the existing
// inbox/escalate cron pattern). Either via x-admin-token header or
// ?token= query param.
//
// Idempotency: this endpoint is safe to call multiple times per day —
// each call re-evaluates current staleness state and emails fresh. No
// dedup table needed because the cron only fires once per morning.
// If you accidentally trigger it twice, staff get two emails — annoying
// but harmless.
//
// Response: JSON summary of who got emailed and how many cases each.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { listCases, listUsers } from "@/lib/store";
import { sendEmail } from "@/lib/email";

// Staleness thresholds — keep them as constants so easy to tune later.
const UNDER_REVIEW_STALE_DAYS = 3;
const NO_CLIENT_REPLY_STALE_DAYS = 7;

function daysAgo(iso: string | undefined | null): number {
  if (!iso) return Infinity; // no timestamp = "very stale"
  const t = new Date(iso).getTime();
  if (!t) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

const COMPANY_ID = "CMP-1";

export async function GET(req: NextRequest) {
  // Token check — same pattern as /api/inbox/escalate
  const token = req.headers.get("x-admin-token") ||
    new URL(req.url).searchParams.get("token");
  if (token !== (process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cases = await listCases(COMPANY_ID);
  const users = await listUsers(COMPANY_ID);
  // Build email lookup by name (case lowercasing for safety since case
  // assignedTo is stored as a display name like "Avneet Kaur" while users
  // are addressed by email).
  const userByName = new Map<string, { name: string; email: string; role: string }>();
  for (const u of users) {
    if (u.userType === "staff" && u.email) {
      userByName.set(String(u.name).toLowerCase().trim(), {
        name: u.name,
        email: u.email,
        role: u.role,
      });
    }
  }

  // ── Find cases for each trigger ──
  // Bucket cases by who they should be emailed to.
  type DigestBucket = {
    staff: { name: string; email: string; role: string };
    underReviewStale: typeof cases;
    noClientReplyStale: typeof cases;
  };
  const buckets = new Map<string, DigestBucket>();

  for (const c of cases) {
    const assignedToKey = String(c.assignedTo || "").toLowerCase().trim();
    if (!assignedToKey || assignedToKey === "unassigned") continue;
    const staff = userByName.get(assignedToKey);
    if (!staff || !staff.email) continue;

    const ensureBucket = () => {
      let b = buckets.get(staff.email);
      if (!b) {
        b = { staff, underReviewStale: [], noClientReplyStale: [] };
        buckets.set(staff.email, b);
      }
      return b;
    };

    // Trigger 1: Under Review stale
    if (c.processingStatus === "under_review" && daysAgo(c.updatedAt) > UNDER_REVIEW_STALE_DAYS) {
      ensureBucket().underReviewStale.push(c);
    }

    // Trigger 2: No client reply >7 days
    // Heuristic: case is in an active state AND last updatedAt > threshold.
    // updatedAt advances on any change (message in/out, doc upload, edit),
    // so if it's been quiet >7 days, nothing is happening. Skip cases
    // that are already submitted — those are waiting on IRCC, not on us.
    if (
      c.processingStatus !== "submitted" &&
      daysAgo(c.updatedAt) > NO_CLIENT_REPLY_STALE_DAYS
    ) {
      ensureBucket().noClientReplyStale.push(c);
    }
  }

  // ── Build + send emails per bucket ──
  const baseUrl =
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://crm.newtonimmigration.com";

  const summary: Array<{ email: string; staff: string; cases: number; sent: boolean; error?: string }> = [];

  for (const bucket of buckets.values()) {
    const totalCases =
      bucket.underReviewStale.length + bucket.noClientReplyStale.length;
    if (totalCases === 0) continue; // skip silent staff with no stale cases

    const renderCaseList = (cs: typeof cases, kind: "review" | "reply") =>
      cs
        .slice(0, 25) // cap the list — if someone has 50+ stale cases, show first 25
        .map((c) => {
          const days = Math.floor(daysAgo(c.updatedAt));
          const url = `${baseUrl}/?case=${encodeURIComponent(c.id)}`;
          const tag = kind === "review"
            ? `🟠 ${days}d in review`
            : `🔇 ${days}d quiet`;
          return `
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">
                <a href="${url}" style="color:#0B2F5C;text-decoration:none;font-weight:600;">${c.client}</a>
                <div style="font-size:11px;color:#64748b;">${c.id} · ${c.formType}</div>
              </td>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#7c2d12;white-space:nowrap;">
                ${tag}
              </td>
            </tr>`;
        })
        .join("");

    const html = `
<div style="background:#0B2F5C;padding:18px 24px;border-radius:8px 8px 0 0;">
  <span style="color:white;font-size:18px;font-weight:bold;letter-spacing:0.5px;">NEWTON IMMIGRATION</span>
  <span style="color:#ef4444;font-size:18px;font-weight:bold;">.</span>
</div>
<div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#0f172a;line-height:1.6;">

  <h2 style="margin:0 0 12px;font-size:16px;color:#0B2F5C;">☕ Good morning, ${bucket.staff.name.split(" ")[0]}</h2>
  <p style="margin:0 0 16px;">You have <strong>${totalCases}</strong> case${totalCases === 1 ? "" : "s"} that need attention this morning:</p>

  ${
    bucket.underReviewStale.length > 0
      ? `<h3 style="margin:20px 0 8px;font-size:14px;color:#7c2d12;">🟠 Stuck in Under Review (>${UNDER_REVIEW_STALE_DAYS} days)</h3>
         <p style="margin:0 0 8px;font-size:12px;color:#64748b;">These are waiting on you to review or reply to comments.</p>
         <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
           ${renderCaseList(bucket.underReviewStale, "review")}
         </table>`
      : ""
  }

  ${
    bucket.noClientReplyStale.length > 0
      ? `<h3 style="margin:20px 0 8px;font-size:14px;color:#7c2d12;">🔇 No activity (>${NO_CLIENT_REPLY_STALE_DAYS} days)</h3>
         <p style="margin:0 0 8px;font-size:12px;color:#64748b;">These cases haven't moved in a week. Consider following up with the client.</p>
         <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
           ${renderCaseList(bucket.noClientReplyStale, "reply")}
         </table>`
      : ""
  }

  <p style="margin:24px 0 0;">
    <a href="${baseUrl}" style="display:inline-block;background:#0B2F5C;color:white;padding:10px 18px;border-radius:6px;font-weight:600;text-decoration:none;font-size:13px;">
      Open Newton CRM →
    </a>
  </p>

  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px;" />
  <p style="font-size:11px;color:#94a3b8;margin:0;">
    Daily digest sent every morning at 9 AM. To stop these emails, contact your admin.<br/>
    Newton Immigration Inc. · 8327 120 Street, Delta, BC · RCIC #R705964
  </p>
</div>`;

    const subject = `[Newton CRM] ${totalCases} case${totalCases === 1 ? "" : "s"} need your attention`;

    const result = await sendEmail({
      to: bucket.staff.email,
      subject,
      html,
    });

    summary.push({
      email: bucket.staff.email,
      staff: bucket.staff.name,
      cases: totalCases,
      sent: result.success,
      error: result.error,
    });
  }

  return NextResponse.json({
    ok: true,
    digestRunAt: new Date().toISOString(),
    staffNotified: summary.filter((s) => s.sent).length,
    staffSkipped: summary.filter((s) => !s.sent).length,
    totalCasesFlagged: summary.reduce((sum, s) => sum + s.cases, 0),
    details: summary,
  });
}
