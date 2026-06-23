// app/api/admin/daily-team-reports/route.ts
//
// End-of-day reports:
//   1. To EACH team member who worked today → their own activity (cases worked,
//      hours, what they left each in, their notes).
//   2. To the MANAGER → a "who did how much" table across the whole team.
//
//   POST ?systemToken=XXX            → run for real, send the emails (cron path)
//   POST ?systemToken=XXX&dry=1      → compute only, send nothing (preview)
//   POST  (logged-in Admin)          → run for real (manual "send now")
//
// Meant to be hit once at end of the Pacific work day by a scheduler.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { isValidSystemToken } from "@/lib/auth-recovery-token";
import { listAllStaff, listAllCases } from "@/lib/store";
import { myDayLog } from "@/lib/time-tracking";
import { sendEmail, isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTCOME_LABEL: Record<string, string> = {
  ready_for_review: "ready for review", in_progress: "in progress",
  waiting_client: "waiting on client", blocked: "blocked",
  submitted: "submitted", handed_off: "handed off",
};
const esc = (s: string) => String(s || "").replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m] as string));
const hm = (sec: number) => { const m = Math.round((sec || 0) / 60); const h = Math.floor(m / 60); return h > 0 ? `${h}h ${m % 60}m` : `${m}m`; };
const pacificDate = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("systemToken") || "";
  if (!isValidSystemToken(token)) {
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff" || user.role !== "Admin") {
      return NextResponse.json({ error: "Forbidden — admins only" }, { status: 403 });
    }
  }
  const dry = url.searchParams.get("dry") === "1";
  const emailOk = isEmailConfigured();
  const today = pacificDate();
  const dateLabel = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver", weekday: "long", month: "long", day: "numeric" });

  const [staff, cases] = await Promise.all([listAllStaff(), listAllCases()]);
  const clientByCase = new Map(cases.map((c) => [c.id, String((c as any).client || "")]));

  // Submissions today, per (lowercased) assignee name.
  const submittedTodayBy = new Map<string, number>();
  for (const c of cases) {
    const sub = (c as any).submittedAt as string | undefined;
    if (sub && pacificDate(Date.parse(sub)) === today) {
      const who = String((c as any).assignedTo || "").trim().toLowerCase();
      if (who && who !== "unassigned") submittedTodayBy.set(who, (submittedTodayBy.get(who) || 0) + 1);
    }
  }

  const perStaff: Array<{ name: string; email: string; seconds: number; sessions: number; cases: number; submissions: number; emailed: boolean }> = [];

  for (const s of staff) {
    if (s.userType !== "staff" || s.active === false) continue;
    let sessions: Awaited<ReturnType<typeof myDayLog>> = [];
    try { sessions = await myDayLog(s.id); } catch { sessions = []; }
    if (sessions.length === 0) continue; // didn't work today — no report

    const totalSeconds = sessions.reduce((a, x) => a + (x.durationSeconds || 0), 0);
    const distinctCases = new Set(sessions.map((x) => x.caseId)).size;
    const submissions = submittedTodayBy.get(s.name.toLowerCase()) || 0;

    // ── Personal email to the staff member ──
    let emailed = false;
    if (emailOk && !dry && s.email) {
      const rows = sessions.map((x) => `
        <tr>
          <td style="padding:4px 8px;border-bottom:1px solid #eee"><b>${esc(x.caseId)}</b>${clientByCase.get(x.caseId) ? ` · ${esc(clientByCase.get(x.caseId)!)}` : ""}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;white-space:nowrap">${hm(x.durationSeconds || 0)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(OUTCOME_LABEL[x.outcome] || x.outcome || "—")}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;color:#555">${esc(x.note || "")}</td>
        </tr>`).join("");
      const html =
        `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:680px">` +
        `<div style="font-size:18px;font-weight:bold;color:#0B2F5C">Your day at Newton — ${esc(dateLabel)}</div>` +
        `<p>Hi ${esc(s.name)}, here's what you logged today:</p>` +
        `<p><b>${hm(totalSeconds)}</b> across <b>${distinctCases}</b> case(s)${submissions ? ` · <b>${submissions}</b> submitted` : ""}.</p>` +
        `<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#f3f4f6">` +
        `<th style="text-align:left;padding:4px 8px">Case</th><th style="text-align:left;padding:4px 8px">Time</th><th style="text-align:left;padding:4px 8px">Left as</th><th style="text-align:left;padding:4px 8px">Note</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>` +
        `<p style="color:#999;font-size:12px;margin-top:12px">Automated end-of-day summary from the Newton CRM. If anything looks off, check you punched in/out on each case.</p></div>`;
      const text = `Your day at Newton — ${dateLabel}\n${hm(totalSeconds)} across ${distinctCases} case(s)${submissions ? `, ${submissions} submitted` : ""}.\n\n` +
        sessions.map((x) => `• ${x.caseId}${clientByCase.get(x.caseId) ? ` (${clientByCase.get(x.caseId)})` : ""} — ${hm(x.durationSeconds || 0)} — ${OUTCOME_LABEL[x.outcome] || x.outcome || "—"}${x.note ? ` — "${x.note}"` : ""}`).join("\n");
      try { const r = await sendEmail({ to: s.email, subject: `Your day at Newton — ${today}`, html, text }); emailed = r.success; } catch { emailed = false; }
    }

    perStaff.push({ name: s.name, email: s.email || "", seconds: totalSeconds, sessions: sessions.length, cases: distinctCases, submissions, emailed });
  }

  perStaff.sort((a, b) => b.seconds - a.seconds);

  // ── Manager email: who did how much ──
  const to = (process.env.AGENT_BRIEFING_EMAIL || process.env.GMAIL_FROM_EMAIL || "newtonimmigration@gmail.com").trim();
  let managerEmailed = false;
  if (emailOk && !dry && to && perStaff.length) {
    const totalH = hm(perStaff.reduce((a, x) => a + x.seconds, 0));
    const totalSub = perStaff.reduce((a, x) => a + x.submissions, 0);
    const rows = perStaff.map((p, i) => `
      <tr>
        <td style="padding:5px 8px;border-bottom:1px solid #eee">${i + 1}. <b>${esc(p.name)}</b></td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;white-space:nowrap"><b>${hm(p.seconds)}</b></td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee">${p.cases} case(s)</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee">${p.sessions} session(s)</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee">${p.submissions || "—"}</td>
      </tr>`).join("");
    const html =
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:720px">` +
      `<div style="font-size:18px;font-weight:bold;color:#0B2F5C">Team activity — ${esc(dateLabel)}</div>` +
      `<p>${perStaff.length} people worked today · <b>${totalH}</b> total · <b>${totalSub}</b> submitted.</p>` +
      `<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#0B2F5C;color:#fff">` +
      `<th style="text-align:left;padding:5px 8px">Who</th><th style="text-align:left;padding:5px 8px">Hours</th><th style="text-align:left;padding:5px 8px">Cases</th><th style="text-align:left;padding:5px 8px">Sessions</th><th style="text-align:left;padding:5px 8px">Submitted</th>` +
      `</tr></thead><tbody>${rows}</tbody></table>` +
      `<p style="color:#999;font-size:12px;margin-top:12px">Automated end-of-day team report from the Newton CRM. Hours are logged check-in/out time (Pacific). People with no logged time aren't shown.</p></div>`;
    const text = `Team activity — ${dateLabel}\n${perStaff.length} worked · ${totalH} total · ${totalSub} submitted\n\n` +
      perStaff.map((p, i) => `${i + 1}. ${p.name} — ${hm(p.seconds)} — ${p.cases} cases — ${p.submissions} submitted`).join("\n");
    try { const r = await sendEmail({ to, subject: `Newton — team activity ${today}`, html, text }); managerEmailed = r.success; } catch { managerEmailed = false; }
  }

  return NextResponse.json({
    ok: true, date: today, dry, emailConfigured: emailOk,
    staffReported: perStaff.length,
    staffEmailed: perStaff.filter((p) => p.emailed).length,
    managerEmailed,
    summary: perStaff.map((p) => ({ name: p.name, hours: hm(p.seconds), cases: p.cases, submissions: p.submissions, emailed: p.emailed })),
  });
}
