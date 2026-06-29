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
import { gatherOpsData } from "@/lib/ops-lead";
import { aiJudgment } from "@/lib/ops-lead-ai";
import { dailyCodeLoginEnabled, getOrCreateTodayCode } from "@/lib/daily-code";

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

  // 1c. AI Operations Lead — work rebalancing.
  // OBSERVE MODE (default): we do NOT auto-move cases. The Ops Lead still computes
  // and SHOWS the suggested moves (in the dashboard + this brief), but a human
  // decides. This is the "watch the team for a week, learn who's good at what,
  // then assign by capacity + skill" period. Flip OPS_AUTO_REBALANCE=true later to
  // let it apply automatically within its rules.
  let rebalanced: any = { mode: "observe", appliedCount: 0 };
  if (String(process.env.OPS_AUTO_REBALANCE || "").toLowerCase() === "true") {
    try {
      const res = await fetch(`${baseUrl()}/api/admin/ops-lead/rebalance/apply?systemToken=${encodeURIComponent(sys)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      rebalanced = await res.json().catch(() => ({}));
    } catch (e) { rebalanced = { error: (e as Error).message }; }
  }

  // 2. THE OPERATIONS LEAD — read the team + cases (post-rebalance) and have
  // the management brain write the owner's personal briefing.
  let ops: any = null, judgment: any = null;
  try {
    ops = await gatherOpsData({ windowDays: 30 });
    judgment = await aiJudgment(ops);
  } catch (e) { console.error("[agent-cron] ops-lead failed:", (e as Error).message); }

  // Pipeline detail (existing manager briefing) kept as a secondary section.
  let briefing = "";
  try {
    const res = await fetch(`${baseUrl()}/api/admin/manager-briefing?format=text&systemToken=${encodeURIComponent(sys)}`);
    briefing = await res.text();
  } catch (e) { briefing = `Briefing unavailable: ${(e as Error).message}`; }

  const assembled = agent?.assembled?.succeeded ?? 0;
  const formsFilled = agent?.formsFilled?.succeeded ?? 0;
  const reassigned = rebalanced?.appliedCount ?? 0;
  const agentLine = `🤖 Agent run: assembled ${assembled} file(s), filled forms on ${formsFilled} case(s)` +
    (reassigned > 0 ? `, reassigned ${reassigned} case(s) to balance load / protect deadlines.` : ".");

  // ── Compose the personal Operations Lead briefing ──
  const esc = (s: string) => String(s || "").replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m] as string));
  const dateLabel = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver", weekday: "long", month: "long", day: "numeric" });

  const briefLines: string[] = judgment?.brief ? String(judgment.brief).split("\n").filter(Boolean) : [];
  const verdicts: any[] = judgment?.verdicts || [];
  const needAttention = verdicts.filter((v) => v.rating === "at_risk" || v.rating === "coaching");
  const strong = verdicts.filter((v) => v.rating === "strong");
  const newHireReads = (ops?.staff || []).filter((s: any) => s.isNewHire)
    .map((s: any) => ({ name: s.name, read: (verdicts.find((v) => v.name.toLowerCase() === s.name.toLowerCase())?.rampRead) || "" }))
    .filter((x: any) => x.read);
  const moved: any[] = rebalanced?.applied || [];

  // ── Per-person scorecard: what each person did, their errors, what's on their plate ──
  const scoreStaff = (ops?.staff || [])
    .filter((s: any) => s.active !== false && (Array.isArray(s.functions) ? s.functions.some((f: string) => f === "prep" || f === "review") : true))
    .sort((a: any, b: any) => (b.submittedToday - a.submittedToday) || (b.casesAssigned - a.casesAssigned));
  const statusIcon = (st: string) => (st === "active" ? "🟢" : st === "idle" ? "🟡" : "⚪");
  const didText = (s: any) => s.submittedToday > 0 ? `${s.submittedToday} submitted today` : (s.submittedWindow > 0 ? `${s.submittedWindow} submitted/30d` : "nothing submitted yet");
  const qualText = (s: any) => s.reworkFlags > 0 ? `${s.reworkFlags} review errors${s.reworkRate != null ? ` (rate ${s.reworkRate})` : ""}` : "clean";
  const scoreLineText = (s: any) => `  ${statusIcon(s.status)} ${s.name} — did ${didText(s)}; plate ${s.casesAssigned} active (${s.stuckAssigned} stuck, ${s.inReviewAssigned} in review, ${s.readyAssigned} ready); quality ${qualText(s)}${s.offToday ? "; OFF today" : ""}`;

  // Today's shared office access code (only when daily-code login is enabled) —
  // put it at the top of the briefing so the owner has it each morning to share.
  let accessCode: { dayKey: string; code: string } | null = null;
  if (dailyCodeLoginEnabled()) {
    try { accessCode = await getOrCreateTodayCode(); } catch (e) { console.error("[agent-cron] daily code failed:", (e as Error).message); }
  }

  const subjectLine = `Newton — Operations Lead briefing (${new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })})`;

  // Plain-text version (always sent alongside HTML).
  const textParts: string[] = [];
  textParts.push(`OPERATIONS LEAD — ${dateLabel}`, "");
  if (accessCode) textParts.push(`TODAY'S OFFICE ACCESS CODE: ${accessCode.code} (share with the team)`, "");
  if (briefLines.length) textParts.push(...briefLines, "");
  if (scoreStaff.length) {
    textParts.push("TEAM TODAY — each person: what they did · plate · errors:");
    scoreStaff.forEach((s: any) => textParts.push(scoreLineText(s)));
    textParts.push("");
  }
  if (moved.length) { textParts.push("WHAT I MOVED WHILE YOU WERE AWAY:"); moved.forEach((m) => textParts.push(`  • ${m.caseId}: ${m.from} → ${m.to}`)); textParts.push(""); }
  if (needAttention.length) { textParts.push("COACH / WATCH:"); needAttention.forEach((v) => textParts.push(`  • ${v.name} (${v.ratingLabel}): ${v.fix}`)); textParts.push(""); }
  if (strong.length) textParts.push(`CARRYING THE FIRM: ${strong.map((v) => v.name).join(", ")}`, "");
  if (newHireReads.length) { textParts.push("NEW HIRES:"); newHireReads.forEach((x: any) => textParts.push(`  • ${x.name}: ${x.read}`)); textParts.push(""); }
  textParts.push(agentLine, "", "— PIPELINE DETAIL —", briefing);
  const text = textParts.join("\n");

  // HTML version.
  const chip = (txt: string, bg: string, fg: string) => `<span style="display:inline-block;background:${bg};color:${fg};border-radius:10px;padding:1px 8px;font-size:11px;font-weight:bold">${esc(txt)}</span>`;
  const section = (title: string, inner: string) => inner ? `<div style="margin:14px 0"><div style="font-size:12px;font-weight:bold;color:#0B2F5C;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">${title}</div>${inner}</div>` : "";

  const briefHtml = briefLines.length
    ? `<div style="background:#0f172a;color:#e2e8f0;border-radius:12px;padding:14px 16px;line-height:1.6;font-size:14px">${briefLines.map((l) => `<div style="margin:3px 0">${esc(l)}</div>`).join("")}</div>`
    : `<p style="color:#888">Operations Lead read unavailable today — see pipeline detail below.</p>`;
  const movedHtml = moved.length ? `<ul style="margin:4px 0 0;padding-left:18px">${moved.map((m) => `<li><b>${esc(m.caseId)}</b>: ${esc(m.from)} → <b>${esc(m.to)}</b></li>`).join("")}</ul>` : "";
  const attnHtml = needAttention.length ? needAttention.map((v) => `<div style="margin:4px 0">${chip(v.ratingLabel, v.rating === "at_risk" ? "#fee2e2" : "#fef3c7", v.rating === "at_risk" ? "#b91c1c" : "#92400e")} <b>${esc(v.name)}</b> — ${esc(v.fix)}</div>`).join("") : "";
  const strongHtml = strong.length ? `<div>${strong.map((v) => chip(v.name, "#dcfce7", "#166534")).join(" ")}</div>` : "";
  const newHireHtml = newHireReads.length ? newHireReads.map((x: any) => `<div style="margin:4px 0"><b>${esc(x.name)}</b> — ${esc(x.read)}</div>`).join("") : "";

  const accessCodeHtml = accessCode
    ? `<div style="margin:12px 0;background:#0f172a;border-radius:12px;padding:12px 16px;color:#fff;display:flex;align-items:center;justify-content:space-between">` +
      `<span style="font-size:12px;color:#cbd5e1">🔑 Today's office access code (share with the team)</span>` +
      `<span style="font-size:26px;font-weight:bold;letter-spacing:4px">${esc(accessCode.code)}</span></div>`
    : "";

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5;max-width:680px">` +
    `<div style="font-size:18px;font-weight:bold;color:#0B2F5C">🧭 Your Operations Lead</div>` +
    `<div style="color:#888;font-size:12px;margin-bottom:10px">${dateLabel}${judgment?.aiUsed ? ` · ${esc(judgment.model)}` : ""}</div>` +
    accessCodeHtml +
    briefHtml +
    section("Team today — what each person did, errors & plate",
      scoreStaff.length
        ? `<table style="width:100%;border-collapse:collapse;font-size:12px">` +
          `<tr style="text-align:left;color:#64748b"><th style="padding:4px 6px">Person</th><th>Did</th><th>Active</th><th>Stuck</th><th>Review</th><th>Ready</th><th>Errors</th></tr>` +
          scoreStaff.map((s: any) =>
            `<tr style="border-top:1px solid #eee"><td style="padding:4px 6px">${statusIcon(s.status)} <b>${esc(s.name)}</b>${s.offToday ? ` ${chip("off", "#e2e8f0", "#475569")}` : ""}</td>` +
            `<td>${esc(didText(s))}</td>` +
            `<td style="text-align:center">${s.casesAssigned}</td>` +
            `<td style="text-align:center">${s.stuckAssigned ? `<b style="color:#b91c1c">${s.stuckAssigned}</b>` : 0}</td>` +
            `<td style="text-align:center">${s.inReviewAssigned}</td>` +
            `<td style="text-align:center">${s.readyAssigned ? `<b style="color:#166534">${s.readyAssigned}</b>` : 0}</td>` +
            `<td style="text-align:center">${s.reworkFlags ? `<span style="color:#b91c1c">${s.reworkFlags}${s.reworkRate != null ? ` (${s.reworkRate})` : ""}</span>` : "—"}</td></tr>`
          ).join("") +
          `</table>`
        : "") +
    section("What I moved while you were away", movedHtml) +
    section("Coach / watch today", attnHtml) +
    section("Carrying the firm", strongHtml) +
    section("New hires — ramp", newHireHtml) +
    `<div style="margin:14px 0;color:#C0392B;font-weight:bold">${esc(agentLine)}</div>` +
    `<details style="margin-top:10px"><summary style="cursor:pointer;color:#0B2F5C;font-weight:bold;font-size:12px">Pipeline detail</summary>` +
    `<pre style="white-space:pre-wrap;font-family:inherit;background:#f7f7f7;padding:12px;border-radius:8px;font-size:13px">${esc(briefing)}</pre></details>` +
    `<p style="color:#999;font-size:11px;margin-top:14px">Automated by the Newton CRM Operations Lead. It assembled files, filled form drafts, and reassigned cases within strict rules — nothing was sent to clients or submitted to IRCC. Verdicts are guidance, not automated employment decisions.</p></div>`;

  // 3. Email it to the owner.
  const to = (process.env.AGENT_BRIEFING_EMAIL || process.env.GMAIL_FROM_EMAIL || "newtonimmigration@gmail.com").trim();
  let emailed = false, emailError: string | undefined;
  if (isEmailConfigured() && to) {
    const r = await sendEmail({ to, subject: subjectLine, html, text });
    emailed = r.success; emailError = r.error;
  }

  console.log(`[agent-cron] ${agentLine} | emailed=${emailed ? to : "no"}`);
  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    agent: { assembled, formsFilled, raw: agent },
    opsLeadRebalance: { reassigned, raw: rebalanced },
    opsLead: judgment ? { brief: judgment.brief, model: judgment.model, aiUsed: judgment.aiUsed } : null,
    stuckUploadsSwept: { recovered: swept?.recovered ?? 0, scanned: swept?.scanned ?? 0, raw: swept },
    briefing,
    email: { to: emailed ? to : null, sent: emailed, error: emailError },
  });
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
