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

export async function sendWhatsAppText(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isWhatsAppConfigured()) {
    console.warn("WhatsApp not configured — skipping message send");
    return { success: false, error: "WhatsApp not configured" };
  }

  const phone = normalizeWhatsAppPhone(to);
  if (!phone || phone.length < 10) {
    return { success: false, error: "Invalid phone number" };
  }

  try {
    const res = await fetch(`${WHATSAPP_API_URL}/${getPhoneNumberId()}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getAccessToken()}`
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "text",
        text: { body: message }
      })
    });

    const data = await res.json() as { messages?: { id: string }[]; error?: { message: string } };

    if (!res.ok) {
      console.error("WhatsApp API error:", data);
      return { success: false, error: data?.error?.message || "API error" };
    }

    return { success: true, messageId: data?.messages?.[0]?.id };
  } catch (err) {
    console.error("WhatsApp send error:", err);
    return { success: false, error: String(err) };
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
