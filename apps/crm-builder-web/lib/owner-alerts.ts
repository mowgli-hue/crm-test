// lib/owner-alerts.ts
//
// Ping the firm's alert recipients (the Settings "Alert recipients" list + any
// OWNER_ALERT_WHATSAPP env numbers) on important moments — office visits, blocked
// fabrications, frustrated clients, and PAYMENTS (incl. paid-on-Nimmi). Prefers
// an approved WhatsApp template so it lands regardless of the 24h window; falls
// back to free-form text. Debounced per key to avoid spamming.

const __alertAt = new Map<string, number>();
const sanitize = (s: string) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 200) || "—";

export async function notifyAlertRecipients(opts: {
  key: string;          // debounce key (usually the client's phone)
  clientName: string;
  clientPhone: string;
  context: string;      // what happened
}): Promise<void> {
  // Recipients = CRM-managed list (Settings) + env list.
  const envNumbers = String(process.env.OWNER_ALERT_WHATSAPP || "")
    .split(",").map((s) => s.replace(/\D/g, "")).filter((n) => n.length >= 10);
  let storeNumbers: string[] = [];
  try {
    const { listAlertRecipients } = await import("@/lib/store");
    storeNumbers = (await listAlertRecipients()).filter((r) => r.active).map((r) => r.phone);
  } catch { /* non-fatal */ }
  const numbers = Array.from(new Set([...storeNumbers, ...envNumbers]));
  if (numbers.length === 0) return;

  const now = Date.now();
  if (now - (__alertAt.get(opts.key) || 0) < 10 * 60 * 1000) return;
  __alertAt.set(opts.key, now);

  const templateName = String(process.env.OWNER_ALERT_TEMPLATE_NAME || "").trim();
  const templateLang = String(process.env.OWNER_ALERT_TEMPLATE_LANG || "en").trim();
  const fromPhoneId = process.env.OWNER_ALERT_PHONE_ID || process.env.WHATSAPP_MARKETING_PHONE_ID || undefined;
  const fallback = `🚨 Newton alert\nClient: ${opts.clientName} (${opts.clientPhone})\n${opts.context}\nPlease follow up.`;

  try {
    const { sendWhatsAppTemplate, sendWhatsAppText } = await import("@/lib/whatsapp");
    for (const n of numbers) {
      let ok = false;
      if (templateName) {
        const t = await sendWhatsAppTemplate({
          to: n,
          templateName,
          languageCode: templateLang,
          phoneNumberId: fromPhoneId,
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: sanitize(opts.clientName || opts.clientPhone) },
              { type: "text", text: sanitize(opts.clientPhone) },
              { type: "text", text: sanitize(opts.context) },
            ],
          }],
        }).catch(() => ({ success: false }));
        ok = Boolean((t as { success?: boolean }).success);
      }
      if (!ok) await sendWhatsAppText(n, fallback).catch(() => {});
    }
  } catch { /* non-fatal */ }
}
