// app/api/admin/agent-cron/route.ts
//
// The daily agent loop. Meant to be hit once a day by a scheduler (Railway cron
// or any external cron service) with the system token:
//
//   GET/POST /api/admin/agent-cron?systemToken=XXX
//     1. Runs the Case Agent's safe auto-actions (assemble ready files + fill
//        IRCC form drafts). Never messages clients, never submits.
//     2. Builds the manager briefing.
//     3. Emails the briefing (+ what the agent just did) to the manager, if an
//        address is configured (AGENT_BRIEFING_EMAIL, else GMAIL_FROM_EMAIL).
//
// Returns JSON so a manual run / cron log shows exactly what happened.

import { NextRequest, NextResponse } from "next/server";
import { isValidSystemToken, getAuthRecoveryToken } from "@/lib/auth-recovery-token";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { sendEmail, isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";

function baseUrl(): string {
  return process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL || "https://crm.newtonimmigration.com";
}

async function run(request: NextRequest) {
  // Auth: system token (cron) OR a logged-in Admin (manual "run now").
  const url = new URL(request.url);
  const token = url.searchParams.get("systemToken") || "";
  if (!isValidSystemToken(token)) {
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff" || !["Admin", "ProcessingLead"].includes(user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const sys = getAuthRecoveryToken();

  // 1. Run the agent's safe actions.
  let agent: any = {};
  try {
    const res = await fetch(`${baseUrl()}/api/admin/case-agent`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemToken: sys, act: true, max: 25 }),
    });
    agent = await res.json().catch(() => ({}));
  } catch (e) { agent = { error: (e as Error).message }; }

  // 1b. Self-heal any WhatsApp uploads stuck at "Uploading…" (download torn
  // down inline). Safety net — ideally a dedicated cron hits
  // /api/admin/stuck-uploads/sweep every few minutes; running it here too means
  // even a daily-only schedule recovers stranded client docs.
  let swept: any = {};
  try {
    const res = await fetch(`${baseUrl()}/api/admin/stuck-uploads/sweep?systemToken=${encodeURIComponent(sys)}&limit=50`, { method: "POST" });
    swept = await res.json().catch(() => ({}));
  } catch (e) { swept = { error: (e as Error).message }; }

  // 2. Build the manager briefing (plain text).
  let briefing = "";
  try {
    const res = await fetch(`${baseUrl()}/api/admin/manager-briefing?format=text&systemToken=${encodeURIComponent(sys)}`);
    briefing = await res.text();
  } catch (e) { briefing = `Briefing unavailable: ${(e as Error).message}`; }

  const assembled = agent?.assembled?.succeeded ?? 0;
  const formsFilled = agent?.formsFilled?.succeeded ?? 0;
  const agentLine = `🤖 Agent run: assembled ${assembled} file(s), filled forms on ${formsFilled} case(s).`;

  // 3. Email it to the manager.
  const to = (process.env.AGENT_BRIEFING_EMAIL || process.env.GMAIL_FROM_EMAIL || "newtonimmigration@gmail.com").trim();
  let emailed = false, emailError: string | undefined;
  if (isEmailConfigured() && to) {
    const html =
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">` +
      `<p style="font-weight:bold;color:#C0392B">${agentLine}</p>` +
      `<pre style="white-space:pre-wrap;font-family:inherit;background:#f7f7f7;padding:12px;border-radius:8px">${briefing.replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m] as string))}</pre>` +
      `<p style="color:#888;font-size:12px">Automated by the Newton CRM Case Agent. It assembled files and filled form drafts only — nothing was sent to clients or submitted to IRCC.</p></div>`;
    const r = await sendEmail({ to, subject: `Newton CRM — Daily Briefing (${new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })})`, html, text: `${agentLine}\n\n${briefing}` });
    emailed = r.success; emailError = r.error;
  }

  console.log(`[agent-cron] ${agentLine} | emailed=${emailed ? to : "no"}`);
  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    agent: { assembled, formsFilled, raw: agent },
    stuckUploadsSwept: { recovered: swept?.recovered ?? 0, scanned: swept?.scanned ?? 0, raw: swept },
    briefing,
    email: { to: emailed ? to : null, sent: emailed, error: emailError },
  });
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
