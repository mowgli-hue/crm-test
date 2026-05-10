export type DispatchChannel = "email" | "sms" | "whatsapp";

export type DispatchResult = {
  ok: boolean;
  status: "sent" | "provider_missing" | "failed";
  provider: string;
  detail?: string;
};

function hasEmailProvider() {
  return (
    String(process.env.SMTP_HOST || "").trim().length > 0 &&
    String(process.env.SMTP_USER || "").trim().length > 0 &&
    String(process.env.SMTP_PASS || "").trim().length > 0 &&
    String(process.env.SMTP_FROM || "").trim().length > 0
  );
}

function hasTwilioSmsProvider() {
  return (
    String(process.env.TWILIO_ACCOUNT_SID || "").trim().length > 0 &&
    String(process.env.TWILIO_AUTH_TOKEN || "").trim().length > 0 &&
    String(process.env.TWILIO_FROM_NUMBER || "").trim().length > 0
  );
}

function hasWhatsAppProvider() {
  return (
    String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim().length > 0 &&
    String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim().length > 0
  );
}

function useMockSend() {
  return String(process.env.COMMS_MOCK_SEND || "").toLowerCase() === "true";
}

function normalizePhoneDigits(target: string) {
  return String(target || "").replace(/[^\d]/g, "");
}

async function sendViaTwilioSms(target: string, message: string): Promise<DispatchResult> {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = String(process.env.TWILIO_FROM_NUMBER || "").trim();
  const to = target.startsWith("+") ? target : `+${normalizePhoneDigits(target)}`;
  if (!accountSid || !authToken || !from) {
    return { ok: false, status: "provider_missing", provider: "twilio_sms" };
  }
  try {
    const body = new URLSearchParams();
    body.set("To", to);
    body.set("From", from);
    body.set("Body", message);
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, status: "failed", provider: "twilio_sms", detail: `Twilio ${res.status}: ${txt.slice(0, 300)}` };
    }
    return { ok: true, status: "sent", provider: "twilio_sms" };
  } catch (e) {
    return { ok: false, status: "failed", provider: "twilio_sms", detail: String((e as Error)?.message || e) };
  }
}

async function sendViaWhatsAppCloud(target: string, message: string): Promise<DispatchResult> {
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  // Phone normalization for WhatsApp Cloud API:
  //   - Meta requires the number in international format with country code,
  //     no plus sign (e.g., 17787234546 — NOT 7787234546 or +17787234546).
  //   - Canadian/US 10-digit numbers without a country code are extremely
  //     common (staff types "778-723-4546" or "7787234546" into the phone
  //     field). Sending those without prepending "1" causes Meta to attempt
  //     delivery to a non-existent global ID, and the message just vanishes
  //     with no useful error — staff sees "sent" but client never receives.
  //   - We assume 10-digit numbers are NANP (North America). 11-digit
  //     numbers starting with 1 are passed through unchanged. Anything
  //     else (already international) is also passed through.
  const rawDigits = String(target || "").replace(/[^\d]/g, "");
  let to = rawDigits;
  if (rawDigits.length === 10) {
    to = "1" + rawDigits; // assume NANP
  }

  if (!token || !phoneNumberId) {
    return { ok: false, status: "provider_missing", provider: "whatsapp_cloud" };
  }

  // Message length: WhatsApp Cloud API hard-limits text body to 4096
  // characters. Beyond that, Meta returns HTTP 400 and the message is
  // never sent — even though our backend allows up to 5000. Long intake
  // checklists and multi-paragraph briefings hit this regularly.
  // Solution: split into chunks at paragraph/sentence boundaries and send
  // sequentially. If ANY chunk fails, return that failure (staff retries).
  const MAX_CHUNK = 3500; // safe margin under Meta's 4096
  const chunks: string[] = [];
  if (message.length <= MAX_CHUNK) {
    chunks.push(message);
  } else {
    // Prefer to split on double-newline (paragraph), then single newline,
    // then sentence boundary, only as last resort hard-split mid-word.
    let remaining = message;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_CHUNK) {
        chunks.push(remaining);
        break;
      }
      // Find best split point within MAX_CHUNK bytes
      const slice = remaining.slice(0, MAX_CHUNK);
      let cut = slice.lastIndexOf("\n\n");
      if (cut < MAX_CHUNK / 2) cut = slice.lastIndexOf("\n");
      if (cut < MAX_CHUNK / 2) cut = slice.lastIndexOf(". ");
      if (cut < MAX_CHUNK / 2) cut = MAX_CHUNK; // hard-split last resort
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
  }

  try {
    let lastMessageId: string | undefined;
    for (let i = 0; i < chunks.length; i++) {
      const body = chunks.length > 1 ? `(${i + 1}/${chunks.length}) ${chunks[i]}` : chunks[i];
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body }
        })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        // Meta error 131047: "Re-engagement message" — outside 24-hour
        // service window. Staff needs to know this isn't a transient
        // failure; client must initiate to reopen the window, or staff
        // must use an approved template message.
        const is24hWindow = txt.includes("131047") || txt.toLowerCase().includes("re-engagement");
        const detail = is24hWindow
          ? `24-hour window expired. WhatsApp doesn't allow free-form messages until the client replies again. Wait for them to message, or send an approved template.`
          : `WhatsApp ${res.status}: ${txt.slice(0, 300)}`;
        return { ok: false, status: "failed", provider: "whatsapp_cloud", detail };
      }
      const data = await res.json().catch(() => ({})) as { messages?: { id: string }[] };
      lastMessageId = data?.messages?.[0]?.id;
      // Brief pause between chunks so they arrive in order on the client side
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 400));
    }
    return { ok: true, status: "sent", provider: "whatsapp_cloud", detail: lastMessageId };
  } catch (e) {
    return { ok: false, status: "failed", provider: "whatsapp_cloud", detail: String((e as Error)?.message || e) };
  }
}

// Provider-ready dispatch. Real provider calls can be plugged in without changing API/UI contract.
export async function dispatchCommunication(input: {
  channel: DispatchChannel;
  target: string;
  message: string;
}): Promise<DispatchResult> {
  const target = String(input.target || "").trim();
  const message = String(input.message || "").trim();
  if (!target || !message) {
    return { ok: false, status: "failed", provider: "none", detail: "target and message are required" };
  }

  if (useMockSend()) {
    return { ok: true, status: "sent", provider: "mock" };
  }

  if (input.channel === "email") {
    if (!hasEmailProvider()) {
      return { ok: false, status: "provider_missing", provider: "smtp" };
    }
    // TODO: wire SMTP provider when credentials are supplied.
    return { ok: false, status: "failed", provider: "smtp", detail: "SMTP integration scaffolded but not enabled yet" };
  }

  if (input.channel === "sms") {
    if (!hasTwilioSmsProvider()) {
      return { ok: false, status: "provider_missing", provider: "twilio_sms" };
    }
    return sendViaTwilioSms(target, message);
  }

  if (input.channel === "whatsapp") {
    if (!hasWhatsAppProvider()) {
      return { ok: false, status: "provider_missing", provider: "whatsapp_cloud" };
    }
    return sendViaWhatsAppCloud(target, message);
  }

  return { ok: false, status: "failed", provider: "none", detail: "Unsupported channel" };
}
