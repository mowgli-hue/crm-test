// app/api/admin/daily-code/route.ts
//
// View or rotate today's shared office access code.
//
//   GET                      → { enabled, dayKey, code }   (Admin only)
//   POST { regenerate:true } → issues a new code for today  (Admin only)
//   POST ?systemToken=XXX&email=1 → ensures today's code exists and emails it
//                                   to the owner (morning cron path)
//
// The code lets staff open the CRM in place of a password (see lib/daily-code).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { isValidSystemToken } from "@/lib/auth-recovery-token";
import { dailyCodeLoginEnabled, getOrCreateTodayCode, regenerateTodayCode } from "@/lib/daily-code";
import { sendEmail, isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerEmail(): string {
  return (process.env.AGENT_BRIEFING_EMAIL || process.env.GMAIL_FROM_EMAIL || "newtonimmigration@gmail.com").trim();
}

async function emailCode(code: string, dayKey: string): Promise<{ sent: boolean; to: string | null; error?: string }> {
  const to = ownerEmail();
  if (!isEmailConfigured() || !to) return { sent: false, to: null };
  const niceDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver", weekday: "long", month: "long", day: "numeric" });
  const html =
    `<div style="font-family:Arial,sans-serif;color:#222;font-size:14px;line-height:1.5">` +
    `<div style="font-size:16px;font-weight:bold;color:#0B2F5C">Newton CRM — today's access code</div>` +
    `<div style="color:#888;font-size:12px;margin-bottom:10px">${niceDate}</div>` +
    `<div style="font-size:34px;font-weight:bold;letter-spacing:6px;background:#0f172a;color:#fff;border-radius:12px;padding:16px;text-align:center">${code}</div>` +
    `<p>Share this with whoever is working today. Each person signs in with <b>their own email</b> and this code in place of a password. It expires tonight; a new code is issued tomorrow morning.</p>` +
    `<p style="color:#999;font-size:11px">If this code leaks, regenerate it from the CRM (Team → Access code).</p></div>`;
  const r = await sendEmail({ to, subject: `Newton CRM — access code for ${dayKey}: ${code}`, html, text: `Newton CRM access code for ${dayKey}: ${code}\nShare with today's team. Sign in with your own email + this code. Expires tonight.` });
  return { sent: r.success, to: r.success ? to : null, error: r.error };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — admins only" }, { status: 403 });
  }
  const { dayKey, code } = await getOrCreateTodayCode();
  return NextResponse.json({ ok: true, enabled: dailyCodeLoginEnabled(), dayKey, code });
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("systemToken") || "";
  const isSystem = isValidSystemToken(token);

  if (!isSystem) {
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff" || user.role !== "Admin") {
      return NextResponse.json({ error: "Forbidden — admins only" }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => ({} as any));
  const wantEmail = url.searchParams.get("email") === "1" || body?.email === true;
  const wantRegen = body?.regenerate === true;

  const { dayKey, code } = wantRegen ? await regenerateTodayCode() : await getOrCreateTodayCode();
  let email: Awaited<ReturnType<typeof emailCode>> | undefined;
  if (wantEmail || isSystem) email = await emailCode(code, dayKey);

  return NextResponse.json({ ok: true, dayKey, code, regenerated: wantRegen, email });
}
