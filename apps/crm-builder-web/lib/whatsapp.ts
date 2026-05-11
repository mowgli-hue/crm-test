// lib/whatsapp.ts
// Sends WhatsApp messages via Meta Cloud API

const WHATSAPP_API_URL = "https://graph.facebook.com/v18.0";

function getPhoneNumberId(): string {
  return process.env.WHATSAPP_PHONE_NUMBER_ID || "";
}

function getAccessToken(): string {
  return process.env.WHATSAPP_ACCESS_TOKEN || "";
}

export function isWhatsAppConfigured(): boolean {
  return !!getPhoneNumberId() && !!getAccessToken();
}

// Normalize phone: strip non-digits, ensure no leading +
export function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // If Canadian number without country code (10 digits starting with area code)
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

export async function sendWhatsAppTemplate(params: {
  to: string;
  templateName: string;
  languageCode: string;
  components?: Array<{
    type: string;
    parameters: Array<{ type: string; text?: string }>;
  }>;
  phoneNumberId?: string;          // optional override — pass Marketing WABA's ID to send via marketing number
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // If caller passed a phone ID explicitly, use it. Otherwise default to
  // Processing WABA (WHATSAPP_PHONE_NUMBER_ID). This lets the same function
  // serve both inboxes — Processing-side calls use the default, Marketing-
  // side calls pass `WHATSAPP_MARKETING_PHONE_ID` from env.
  const phoneId = params.phoneNumberId || getPhoneNumberId();
  const token = getAccessToken();
  if (!phoneId || !token) return { success: false, error: "WhatsApp not configured" };

  const phone = normalizeWhatsAppPhone(params.to);
  if (!phone || phone.length < 10) return { success: false, error: "Invalid phone number" };

  try {
    console.log(`📤 WA Template Send: to=${phone} | phoneId=${phoneId ? phoneId.slice(0,6)+"..." : "MISSING"} | template=${params.templateName} | lang=${params.languageCode} | hasParams=${(params.components?.length || 0) > 0}`);
    const res = await fetch(`${WHATSAPP_API_URL}/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "template",
        template: {
          name: params.templateName,
          language: { code: params.languageCode },
          ...(params.components && params.components.length > 0 ? { components: params.components } : {})
        }
      })
    });
    const data = await res.json() as { messages?: { id: string }[]; error?: { message: string } };
    console.log(`📬 WA Template response: status=${res.status} | ${JSON.stringify(data).slice(0,150)}`);
    if (!res.ok) return { success: false, error: data?.error?.message || "API error" };
    return { success: true, messageId: data?.messages?.[0]?.id };
  } catch (err) {
    console.error("WA template send error:", err);
    return { success: false, error: String(err) };
  }
}

export async function deleteWhatsAppMessage(messageId: string): Promise<boolean> {
  const phoneId = getPhoneNumberId();
  const token = getAccessToken();
  if (!phoneId || !token) return false;
  try {
    const res = await fetch(`${WHATSAPP_API_URL}/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "",
        type: "template",
        biz_opaque_callback_data: messageId,
        status: "deleted"
      })
    });
    // Actually use the correct delete endpoint
    const delRes = await fetch(`${WHATSAPP_API_URL}/${messageId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    return delRes.ok;
  } catch { return false; }
}

export async function sendWhatsAppText(to: string, message: string, phoneNumberId?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // phoneNumberId override allows callers to send from a different WABA
  // (e.g., Marketing). Defaults to Processing's WHATSAPP_PHONE_NUMBER_ID.
  const phoneId = phoneNumberId || getPhoneNumberId();
  const token = getAccessToken();
  console.log(`📤 WA Send: to=${to} | phoneId=${phoneId ? phoneId.slice(0,6)+"..." : "MISSING"} | token=${token ? "SET" : "MISSING"}`);

  if (!phoneId || !token) {
    console.error("❌ WhatsApp not configured — PHONE_NUMBER_ID or ACCESS_TOKEN missing");
    return { success: false, error: "WhatsApp not configured" };
  }

  const phone = normalizeWhatsAppPhone(to);
  console.log(`📱 Normalized phone: ${phone}`);
  if (!phone || phone.length < 10) {
    console.error(`❌ Invalid phone: "${to}" → "${phone}"`);
    return { success: false, error: "Invalid phone number" };
  }

  try {
    // 15-second timeout. Meta's API normally responds in <2s. If we
    // wait more than 15s the connection is hung — surface that as a
    // clean failure instead of holding the request for the Node default
    // (~120s) which would tie up route handlers and cascade into 502s.
    // ETIMEDOUT errors from Railway → graph.facebook.com (May 2026
    // incident) used to hang webhook handlers for two minutes each.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(`${WHATSAPP_API_URL}/${phoneId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "text",
          text: { body: message }
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await res.json() as { messages?: { id: string }[]; error?: { message: string } };

    console.log(`📬 WA API response: status=${res.status} | data=${JSON.stringify(data).slice(0,200)}`);

    if (!res.ok) {
      console.error("❌ WhatsApp API error:", JSON.stringify(data));
      return { success: false, error: data?.error?.message || "API error" };
    }

    console.log(`✅ WA message sent! messageId=${data?.messages?.[0]?.id}`);
    return { success: true, messageId: data?.messages?.[0]?.id };
  } catch (err) {
    // Distinguish timeout from other failures so logs are clearer
    const isTimeout = (err as Error)?.name === "AbortError" ||
      String(err).includes("ETIMEDOUT") ||
      String(err).includes("aborted");
    if (isTimeout) {
      console.error(`⏱️ WhatsApp send TIMED OUT after 15s for ${phone}. Likely Meta API blip or Railway network — message NOT sent.`);
    } else {
      console.error("WhatsApp send error:", err);
    }
    return { success: false, error: isTimeout ? "Network timeout — Meta API unreachable" : String(err) };
  }
}

// ─── Media: upload file to Meta + send to client ───
//
// WhatsApp media flow is two API calls:
//   1) POST /<phoneId>/media — upload binary, get back a media_id
//   2) POST /<phoneId>/messages — send a message of type "document" / "image" /
//      "video" / "audio" referencing that media_id
//
// Caller passes the file as a Buffer + the file's MIME type + a name. We pick
// the right WhatsApp `type` based on the MIME (image/* → image, audio/* → audio,
// video/* → video, everything else → document).
//
// Optional `caption` shows under image/video/document in the client's chat.
export async function sendWhatsAppMedia(params: {
  to: string;
  fileBuffer: Buffer;
  mimeType: string;
  filename: string;
  caption?: string;
  phoneNumberId?: string;          // optional override — see sendWhatsAppText
}): Promise<{ success: boolean; messageId?: string; mediaId?: string; whatsappType?: string; error?: string }> {
  const phoneId = params.phoneNumberId || getPhoneNumberId();
  const token = getAccessToken();
  if (!phoneId || !token) {
    return { success: false, error: "WhatsApp not configured" };
  }
  const phone = normalizeWhatsAppPhone(params.to);
  if (!phone || phone.length < 10) {
    return { success: false, error: "Invalid phone number" };
  }

  // Pick the WhatsApp message type based on MIME.
  const mime = String(params.mimeType || "application/octet-stream").toLowerCase();
  const whatsappType =
    mime.startsWith("image/") ? "image" :
    mime.startsWith("audio/") ? "audio" :
    mime.startsWith("video/") ? "video" :
    "document";

  // Step 1 — Upload the file to Meta's media endpoint. Multipart form data.
  let mediaId = "";
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mime);
    // Convert Buffer → Blob for FormData (Node 18+ supports this natively).
    form.append("file", new Blob([new Uint8Array(params.fileBuffer)], { type: mime }), params.filename);

    const uploadRes = await fetch(`${WHATSAPP_API_URL}/${phoneId}/media`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },  // do NOT set Content-Type — Blob auto-sets boundary
      body: form,
    });
    const uploadData: any = await uploadRes.json().catch(() => ({}));
    console.log(`📤 WA media upload: status=${uploadRes.status} | data=${JSON.stringify(uploadData).slice(0, 200)}`);
    if (!uploadRes.ok) {
      return { success: false, error: uploadData?.error?.message || `Media upload HTTP ${uploadRes.status}` };
    }
    mediaId = String(uploadData?.id || "");
    if (!mediaId) {
      return { success: false, error: "Media upload returned no id" };
    }
  } catch (err) {
    return { success: false, error: `Media upload failed: ${String(err)}` };
  }

  // Step 2 — Send the message that references the uploaded media.
  // image/video/document support `caption`; audio does not.
  const mediaPayload: any = { id: mediaId };
  if (whatsappType !== "audio" && params.caption) {
    mediaPayload.caption = params.caption;
  }
  // Documents also support a filename hint so the client sees a nice name.
  if (whatsappType === "document") {
    mediaPayload.filename = params.filename;
  }

  try {
    const sendRes = await fetch(`${WHATSAPP_API_URL}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: whatsappType,
        [whatsappType]: mediaPayload,
      }),
    });
    const sendData: any = await sendRes.json().catch(() => ({}));
    console.log(`📬 WA media send: status=${sendRes.status} | type=${whatsappType} | data=${JSON.stringify(sendData).slice(0, 200)}`);
    if (!sendRes.ok) {
      return { success: false, error: sendData?.error?.message || `Send HTTP ${sendRes.status}`, mediaId, whatsappType };
    }
    return {
      success: true,
      messageId: sendData?.messages?.[0]?.id,
      mediaId,
      whatsappType,
    };
  } catch (err) {
    return { success: false, error: `Send failed: ${String(err)}`, mediaId, whatsappType };
  }
}

// Send welcome + first question when case is created
export async function sendCaseWelcomeMessage(params: {
  clientName: string;
  phone: string;
  formType: string;
  firstQuestion: string;
  portalUrl?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { clientName, phone, formType, firstQuestion } = params;
  const firstName = clientName.split(" ")[0];

  const message = `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${firstName} ਜੀ! 🙏

Hi ${firstName}! Welcome to Newton Immigration.

We've opened your file for *${formType}*. To get started, I'll ask you a few quick questions. Please reply in English or Punjabi — whichever is easier for you.

ਅਸੀਂ ਤੁਹਾਡੀ ${formType} ਅਰਜ਼ੀ ਲਈ ਤੁਹਾਡੀ ਫਾਈਲ ਖੋਲ੍ਹ ਦਿੱਤੀ ਹੈ। ਮੈਂ ਤੁਹਾਨੂੰ ਕੁਝ ਸਵਾਲ ਪੁੱਛਾਂਗਾ।

━━━━━━━━━━━━━━━
*Question 1:* ${firstQuestion}`;

  return sendWhatsAppText(phone, message);
}

// Send document checklist when all questions are answered
export async function sendDocumentChecklist(params: {
  clientName: string;
  phone: string;
  checklistItems: string[];
  portalUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  const { clientName, phone, checklistItems, portalUrl } = params;
  const firstName = clientName.split(" ")[0];

  const docList = checklistItems
    .slice(0, 15)
    .map((item, i) => `${i + 1}. ${item}`)
    .join("\n");

  const message = `Great work ${firstName}! ✅

All your information has been collected. Now please gather and upload the following documents:

ਬਹੁਤ ਵਧੀਆ! ਹੁਣ ਕਿਰਪਾ ਕਰਕੇ ਇਹ ਦਸਤਾਵੇਜ਼ ਅਪਲੋਡ ਕਰੋ:

━━━━━━━━━━━━━━━
*Documents Required:*
${docList}

📎 Upload here: ${portalUrl}

Our team will review everything and be in touch soon. / ਸਾਡੀ ਟੀਮ ਜਲਦੀ ਤੁਹਾਡੇ ਨਾਲ ਸੰਪਰਕ ਕਰੇਗੀ।`;

  return sendWhatsAppText(phone, message);
}

// Notify processing team via WhatsApp (optional — to their phones)
export async function sendStaffNotification(params: {
  staffPhone: string;
  caseId: string;
  clientName: string;
  formType: string;
  message: string;
}): Promise<{ success: boolean; error?: string }> {
  const { staffPhone, caseId, clientName, formType, message } = params;

  const text = `🔔 *Newton CRM Alert*

Case: ${caseId}
Client: ${clientName}
Type: ${formType}

${message}`;

  return sendWhatsAppText(staffPhone, text);
}
