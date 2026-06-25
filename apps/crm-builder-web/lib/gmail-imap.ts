// ─────────────────────────────────────────────────────────────────────
// Gmail inbox reader (IMAP) — read-only.
//
// Reuses the SAME Gmail account + app password already used for SENDING
// (GMAIL_FROM_EMAIL + GMAIL_APP_PASSWORD). No OAuth needed. The account owner
// must have IMAP enabled in Gmail (Settings → Forwarding and POP/IMAP →
// Enable IMAP) — it usually is.
//
// We only READ. We never delete or move mail. The tracker sync is idempotent
// (forward-only stage advance), so re-reading the same email is harmless.
// ─────────────────────────────────────────────────────────────────────

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface InboxEmail {
  uid: number;
  from: string;
  subject: string;
  text: string;       // plain-text body (HTML stripped by mailparser)
  date: string;       // ISO
}

export function imapConfigured(): boolean {
  return Boolean(
    (process.env.GMAIL_FROM_EMAIL || process.env.GMAIL_USER) &&
    (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD)
  );
}

// Fetch recent inbox emails (last `sinceDays`, capped at `max`, newest first).
export async function fetchRecentInbox(opts?: { sinceDays?: number; max?: number }): Promise<InboxEmail[]> {
  const user = (process.env.GMAIL_FROM_EMAIL || process.env.GMAIL_USER || "").trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) throw new Error("Gmail IMAP not configured (GMAIL_FROM_EMAIL / GMAIL_APP_PASSWORD)");

  const sinceDays = opts?.sinceDays ?? 5;
  const max = opts?.max ?? 60;
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
    // Gmail is fine with a short socket timeout for a quick poll.
    socketTimeout: 30_000,
  });

  const out: InboxEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Search recent messages by date, then fetch source and parse.
      const uids = await client.search({ since }, { uid: true });
      if (!uids || uids.length === 0) return [];
      // Newest first, cap the volume.
      const pick = uids.slice(-max);
      for await (const msg of client.fetch(pick, { uid: true, source: true }, { uid: true })) {
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          out.push({
            uid: Number(msg.uid),
            from: parsed.from?.text || "",
            subject: parsed.subject || "",
            text: (parsed.text || parsed.html || "").toString().slice(0, 20_000),
            date: (parsed.date || new Date()).toISOString(),
          });
        } catch { /* skip unparseable message */ }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  // Newest first.
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
