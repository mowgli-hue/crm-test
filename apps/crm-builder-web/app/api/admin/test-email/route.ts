// app/api/admin/test-email/route.ts
//
// One-click check that Gmail SMTP is actually working. Sends a test email and
// returns the real result (success or the exact SMTP error), so configuring
// GMAIL_APP_PASSWORD can be verified without hunting through logs.
//
//   POST { to?: string }  → sends to `to` (or the admin's own email)
//
// Auth: Admin only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { sendEmail, isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json({
      ok: false,
      error: "Email is not configured — set GMAIL_APP_PASSWORD on the CRM service in Railway and redeploy.",
    });
  }

  const body = await request.json().catch(() => ({}));
  const to = String(body?.to || user.email || "").trim();
  if (!to || !to.includes("@")) {
    return NextResponse.json({ error: "No valid recipient. Pass { to } or set your account email." }, { status: 400 });
  }

  const res = await sendEmail({
    to: [to],
    subject: "✅ Newton CRM — email test",
    html: `<p>This is a test email from your Newton CRM.</p><p>If you're reading this, Gmail SMTP is working and the review-flow notifications will email correctly.</p><p style="color:#888;font-size:12px">Sent by ${user.name || "Admin"}.</p>`,
  });

  if (res.success) {
    return NextResponse.json({ ok: true, to, messageId: res.messageId, message: `Test email sent to ${to}. Check the inbox (and spam).` });
  }
  return NextResponse.json({ ok: false, to, error: res.error || "Send failed" });
}
