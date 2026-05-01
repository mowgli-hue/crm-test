// ─────────────────────────────────────────────────────────────────────
// lib/email.ts — Sending transactional emails from the CRM
//
// Sends via Gmail SMTP using an app password. Set up:
//   1) Enable 2FA on the Gmail account (newtonimmigration@gmail.com)
//   2) Generate an "App Password" at https://myaccount.google.com/apppasswords
//      (pick "Mail" → "Other" → name it "Newton CRM")
//   3) Add to Railway env:
//        GMAIL_APP_PASSWORD=<the 16-char password>
//        GMAIL_FROM_EMAIL=newtonimmigration@gmail.com
//
// Why Gmail SMTP:
//   - Free (Gmail is already paid for at Newton)
//   - ~500 emails/day cap (we send ~10-50/day for review notifications)
//   - "From" is a real Newton address — staff trusts it
//   - 5-min setup, no third-party signup, no monthly fee
//
// If we ever exceed the daily cap or need analytics, swap nodemailer's
// transport from `gmail` → Resend/SendGrid/Mailgun. Code change is local
// to `getTransport()` below.
// ─────────────────────────────────────────────────────────────────────

import nodemailer from "nodemailer";

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getFromAddress(): string {
  return process.env.GMAIL_FROM_EMAIL
    || process.env.EMAIL_FROM
    || "newtonimmigration@gmail.com";
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD);
}

function getTransport() {
  if (cachedTransport) return cachedTransport;
  const password = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD;
  if (!password) {
    throw new Error("Email not configured — set GMAIL_APP_PASSWORD env var");
  }
  cachedTransport = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: getFromAddress(),
      pass: password,
    },
  });
  return cachedTransport;
}

export type SendEmailParams = {
  to: string | string[];           // single or multiple recipients
  subject: string;
  html: string;
  text?: string;                   // optional plaintext fallback (auto-derived if omitted)
  replyTo?: string;
};

export type SendEmailResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

// Strip HTML to make a simple plaintext fallback if caller didn't provide one.
// Email clients always require BOTH html + text for best deliverability.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    console.warn("📧 Email skipped — GMAIL_APP_PASSWORD not set");
    return { success: false, error: "Email not configured" };
  }

  const recipients = Array.isArray(params.to) ? params.to : [params.to];
  const validRecipients = recipients.filter(r => r && /@/.test(r));
  if (validRecipients.length === 0) {
    return { success: false, error: "No valid recipients" };
  }

  try {
    const transport = getTransport();
    const info = await transport.sendMail({
      from: `"Newton Immigration" <${getFromAddress()}>`,
      to: validRecipients.join(", "),
      subject: params.subject,
      html: params.html,
      text: params.text || htmlToText(params.html),
      replyTo: params.replyTo,
    });
    console.log(`📧 Email sent: ${params.subject.slice(0, 50)} → ${validRecipients.join(", ")} | id=${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("📧 Email send error:", err);
    return { success: false, error: String(err) };
  }
}

// ── Branded templates ──
//
// Keep templates here so all CRM emails look consistent. Each template is a
// pure function: takes data → returns { subject, html }. Caller passes the
// result to sendEmail().

const EMAIL_HEADER = `
<div style="background:#0B2F5C;padding:18px 24px;border-radius:8px 8px 0 0;">
  <span style="color:white;font-size:18px;font-weight:bold;letter-spacing:0.5px;">NEWTON IMMIGRATION</span>
  <span style="color:#ef4444;font-size:18px;font-weight:bold;">.</span>
</div>
<div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#0f172a;line-height:1.6;">
`;

const EMAIL_FOOTER = `
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px;" />
  <p style="font-size:11px;color:#94a3b8;margin:0;">
    This is an automated notification from the Newton Immigration CRM.<br/>
    Newton Immigration Inc. · 8327 120 Street, Delta, BC · RCIC #R705964
  </p>
</div>
`;

function buildBaseUrl(): string {
  return process.env.PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || "https://crm.newtonimmigration.com";
}

// ─── Template: Review Comment Posted ───
//
// Fired when reviewer adds a new review comment on a case. Goes to assigned
// staff + their lead. Includes a deep link back to the case in CRM.
export function reviewCommentEmail(params: {
  caseId: string;
  caseClient: string;
  caseFormType: string;
  reviewerName: string;
  commentText: string;
  isReply: boolean;        // true = reply to existing thread, false = new comment
}): { subject: string; html: string } {
  const baseUrl = buildBaseUrl();
  const caseUrl = `${baseUrl}/?case=${encodeURIComponent(params.caseId)}#review-comments`;
  const verb = params.isReply ? "replied to a comment" : "left a review comment";
  const subject = `[Newton CRM] ${params.reviewerName} ${verb} on ${params.caseClient} (${params.caseId})`;
  const safeText = String(params.commentText || "").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");

  const html = `${EMAIL_HEADER}
    <h2 style="margin:0 0 12px;font-size:16px;color:#0B2F5C;">📝 Review Comment</h2>
    <p style="margin:0 0 8px;">
      <strong>${params.reviewerName}</strong> ${verb} on
      <strong>${params.caseClient}</strong> · ${params.caseFormType} (<code style="font-size:12px;">${params.caseId}</code>)
    </p>
    <div style="background:white;border:1px solid #e2e8f0;border-left:4px solid #0B2F5C;padding:14px 16px;border-radius:6px;margin:14px 0;font-size:13px;color:#1e293b;">
      ${safeText}
    </div>
    <p style="margin:18px 0 0;">
      <a href="${caseUrl}" style="display:inline-block;background:#0B2F5C;color:white;padding:10px 18px;border-radius:6px;font-weight:600;text-decoration:none;font-size:13px;">
        Open Case in CRM →
      </a>
    </p>
    <p style="margin:14px 0 0;font-size:12px;color:#64748b;">
      Or reply directly to this email — your reply will be added to the case automatically.
      <em>(Coming soon — for now, please open the case to reply.)</em>
    </p>
  ${EMAIL_FOOTER}`;

  return { subject, html };
}
