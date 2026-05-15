// -----------------------------------------------------------------------------
// app/api/admin/send-team-announcement/route.ts
//
// One-time (or any-time) broadcast email to all staff members announcing that
// the CRM now sends per-case event emails + daily digest. Useful right after
// the email-notifications feature deploys so the team knows what to expect.
//
// Auth: same AUTH_RECOVERY_TOKEN as the digest/run endpoint. Invoke via curl:
//
//   curl -X POST https://crm.newtonimmigration.com/api/admin/send-team-announcement \
//     -H "x-admin-token: $AUTH_RECOVERY_TOKEN"
//
// Idempotent: safe to run multiple times. The email is the same every time.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { listUsers } from "@/lib/store";
import { sendEmail } from "@/lib/email";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

const COMPANY_ID = "CMP-1";

function appBaseUrl(): string {
  return process.env.PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || "https://crm.newtonimmigration.com";
}

function renderAnnouncement(firstName: string): { subject: string; html: string } {
  const baseUrl = appBaseUrl();
  const subject = "[Newton CRM] You will now receive case updates by email - here is what to expect";
  const html = `<div style="background:#0B2F5C;padding:18px 24px;border-radius:8px 8px 0 0;">
    <span style="color:white;font-size:18px;font-weight:bold;letter-spacing:0.5px;">NEWTON IMMIGRATION</span>
    <span style="color:#ef4444;font-size:18px;font-weight:bold;">.</span>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;color:#0f172a;line-height:1.6;">
    <h2 style="margin:0 0 14px;font-size:18px;color:#0B2F5C;">🔔 Hi ${firstName}, the CRM will start emailing you</h2>
    <p style="margin:0 0 16px;">We have just enabled email notifications from the Newton Immigration CRM. From now on, when something happens on a case assigned to YOU, you will get an email here. This is in addition to in-app notifications - no need to keep refreshing the dashboard.</p>

    <h3 style="margin:18px 0 8px;font-size:14px;color:#0B2F5C;">📧 Per-event emails - sent to you immediately</h3>
    <ul style="margin:0 0 12px 0;padding-left:20px;">
      <li style="margin-bottom:4px;">A new case is assigned to you</li>
      <li style="margin-bottom:4px;">Your client uploads a document on WhatsApp</li>
      <li style="margin-bottom:4px;">Your case is marked submitted to IRCC</li>
      <li style="margin-bottom:4px;">A case is reassigned to or from you</li>
      <li style="margin-bottom:4px;">The intake bot auto-skips because of a duplicate phone (needs your eyes)</li>
    </ul>

    <h3 style="margin:18px 0 8px;font-size:14px;color:#0B2F5C;">⏳ Daily digest - every morning at 9 AM</h3>
    <p style="margin:0 0 8px;">One email summarizing your cases that need attention:</p>
    <ul style="margin:0 0 12px 0;padding-left:20px;">
      <li style="margin-bottom:4px;">Stuck in Under Review for more than 3 days</li>
      <li style="margin-bottom:4px;">No activity for more than 7 days</li>
      <li style="margin-bottom:4px;">Open more than 14 days without being submitted to IRCC</li>
    </ul>

    <h3 style="margin:18px 0 8px;font-size:14px;color:#0B2F5C;">How to take action</h3>
    <p style="margin:0 0 12px;">Each email has an "Open Case in CRM" button. Click it to land directly on the case. Replying to the email does NOT update the case yet - always go via the CRM.</p>

    <p style="margin:16px 0 0;">
      <a href="${baseUrl}" style="display:inline-block;background:#0B2F5C;color:white;padding:10px 18px;border-radius:6px;font-weight:600;text-decoration:none;font-size:13px;">Open Newton CRM →</a>
    </p>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px;" />
    <p style="font-size:11px;color:#94a3b8;margin:0;">
      Questions or want to opt out of certain notifications? Reply to this email and let your admin know.<br/>
      Newton Immigration Inc. - 8327 120 Street, Delta, BC - RCIC #R705964
    </p>
  </div>`;
  return { subject, html };
}

export async function POST(req: NextRequest) {
  // Token check
  const token = req.headers.get("x-admin-token") ||
    new URL(req.url).searchParams.get("token");
  if (!isValidSystemToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await listUsers(COMPANY_ID);
  const staff = users.filter((u) => u.userType === "staff" && u.email && /@/.test(u.email));

  // Optional: dry-run mode lets the caller see who would be emailed without
  // actually sending. Useful when first wiring this up. Hit with ?dryRun=1.
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const results: Array<{ name: string; email: string; sent: boolean; error?: string }> = [];

  for (const u of staff) {
    const firstName = String(u.name || "team").split(" ")[0];
    if (dryRun) {
      results.push({ name: u.name, email: u.email, sent: false, error: "dryRun" });
      continue;
    }
    const { subject, html } = renderAnnouncement(firstName);
    const r = await sendEmail({ to: u.email, subject, html });
    results.push({ name: u.name, email: u.email, sent: r.success, error: r.error });
  }

  const sentCount = results.filter((r) => r.sent).length;
  const failCount = results.filter((r) => !r.sent && r.error && r.error !== "dryRun").length;

  return NextResponse.json({
    ok: true,
    dryRun,
    summary: {
      totalStaff: users.filter((u) => u.userType === "staff").length,
      eligibleRecipients: staff.length,
      sent: sentCount,
      failed: failCount,
    },
    results,
  });
}

// Also accept GET for convenience (curl GET is faster to type)
export async function GET(req: NextRequest) {
  return POST(req);
}