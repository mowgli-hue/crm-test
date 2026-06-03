// app/api/admin/alert-recipients/test/route.ts
//
// Fire a REAL alert to every configured recipient and report back exactly what
// WhatsApp said for each one — so we can see *why* alerts aren't landing instead
// of failing silently. Diagnoses the three usual culprits:
//   1) no recipients configured (list empty + no OWNER_ALERT_WHATSAPP)
//   2) no approved template → free-form text blocked by the 24h window
//   3) template name/lang wrong or not approved (Meta returns an error)
//
// Auth: Admin only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listAlertRecipients } from "@/lib/store";
import { sendWhatsAppTemplate, sendWhatsAppText } from "@/lib/whatsapp";

export const runtime = "nodejs";

const sanitize = (s: string) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 200) || "—";

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }

  // Resolve recipients exactly like the real alert path does.
  const envNumbers = String(process.env.OWNER_ALERT_WHATSAPP || "")
    .split(",").map((s) => s.replace(/\D/g, "")).filter((n) => n.length >= 10);
  let storeNumbers: string[] = [];
  try {
    storeNumbers = (await listAlertRecipients()).filter((r) => r.active).map((r) => r.phone);
  } catch { /* non-fatal */ }
  const numbers = Array.from(new Set([...storeNumbers, ...envNumbers]));

  const templateName = String(process.env.OWNER_ALERT_TEMPLATE_NAME || "").trim();
  const templateLang = String(process.env.OWNER_ALERT_TEMPLATE_LANG || "en").trim();
  const fromPhoneId = process.env.OWNER_ALERT_PHONE_ID || process.env.WHATSAPP_MARKETING_PHONE_ID || undefined;

  const config = {
    recipientsFromList: storeNumbers,
    recipientsFromEnv: envNumbers,
    totalRecipients: numbers.length,
    templateConfigured: Boolean(templateName),
    templateName: templateName || null,
    templateLang,
    sendingFromPhoneId: fromPhoneId ? fromPhoneId.slice(0, 6) + "…" : null,
  };

  if (numbers.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: "No recipients configured. Add your number under Alert recipients (include country code, e.g. 16049071276) or set OWNER_ALERT_WHATSAPP.",
      config,
    });
  }

  const ctx = `✅ TEST alert from your CRM — if you can read this, alerts work. (sent by ${user.name || "Admin"})`;
  const fallback = `🚨 Newton alert (TEST)\nClient: Test Client (—)\n${ctx}\nThis is only a test.`;

  const results: Array<Record<string, unknown>> = [];
  for (const n of numbers) {
    const r: Record<string, unknown> = { to: n };
    if (templateName) {
      const t = await sendWhatsAppTemplate({
        to: n,
        templateName,
        languageCode: templateLang,
        phoneNumberId: fromPhoneId,
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: sanitize("Test Client") },
            { type: "text", text: sanitize("—") },
            { type: "text", text: sanitize(ctx) },
          ],
        }],
      }).catch((e) => ({ success: false, error: String(e) }));
      r.template = { sent: Boolean((t as any).success), error: (t as any).error || null };
    } else {
      r.template = { sent: false, error: "No template configured (OWNER_ALERT_TEMPLATE_NAME not set)" };
    }

    if (!(r.template as any).sent) {
      const f = await sendWhatsAppText(n, fallback, fromPhoneId).catch((e) => ({ success: false, error: String(e) }));
      r.freeFormText = { sent: Boolean((f as any).success), error: (f as any).error || null };
      if (!(f as any).success) {
        r.note = "Free-form text needs you to have messaged the WhatsApp business number within the last 24h. An approved template avoids this — that's the reliable path for alerts.";
      }
    }

    r.delivered = Boolean((r.template as any)?.sent || (r.freeFormText as any)?.sent);
    results.push(r);
  }

  const anyDelivered = results.some((r) => r.delivered);
  return NextResponse.json({
    ok: anyDelivered,
    summary: anyDelivered
      ? "Sent — check your WhatsApp. If a template was used it lands anytime; free-form only lands inside the 24h window."
      : "Could NOT deliver to anyone. See per-recipient errors below.",
    config,
    results,
  });
}
