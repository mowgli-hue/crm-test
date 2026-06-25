// ─────────────────────────────────────────────────────────────────────
// POST /api/admin/tracker-email-sync
//
// Reads Newton's Gmail inbox (IMAP, read-only), finds IRCC stage-update emails,
// matches each to a tracker entry by application number, and advances the
// stage FORWARD-ONLY. On every advance it notifies the client via WhatsApp.
//
// Idempotent: advancing is monotonic (only moves forward), so re-reading the
// same email never advances twice or double-notifies.
//
// Auth: admin session OR ?systemToken= (so the cron can call it).
// Query: ?dry=1 to preview without writing/notifying. ?days=N lookback.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listTrackers, updateTracker } from "@/lib/store";
import { fetchRecentInbox, imapConfigured } from "@/lib/gmail-imap";
import { parseIrccEmail, looksLikeIrcc, stageIndex } from "@/lib/tracker-email-parser";
import { sendWhatsAppText } from "@/lib/whatsapp";
import type { TrackerEntry } from "@/lib/models";

const norm = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function clientMessage(name: string, stage: string): string {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const friendly: Record<string, string> = {
    "AOR Received": "IRCC has acknowledged receipt of your application (AOR).",
    "Biometrics Requested": "IRCC has requested your biometrics. Please book and complete them at your earliest convenience.",
    "Biometrics Completed": "Your biometrics have been received by IRCC.",
    "Medical Requested": "IRCC has requested your medical exam. Please complete it soon.",
    "Medical Passed": "Your medical results have been accepted by IRCC. ✅",
    "Sponsorship Approved (SA)": "Your sponsorship has been approved by IRCC. ✅",
    "Additional Documents Requested": "IRCC has requested additional documents. We'll be in touch about what's needed.",
    "Background / Security Check": "Your application has moved into background/security checks.",
    "Interview Requested": "IRCC has requested an interview. We'll help you prepare.",
    "PPR / Passport Request": "🎉 Great news — IRCC has issued a passport request (PPR)! Your application is approved in principle.",
    "COPR Issued": "🎉 Your Confirmation of Permanent Residence (COPR) has been issued!",
    "Landed (PR Confirmed)": "🎉 Congratulations — your permanent residence is confirmed!",
    "PR Card Received": "Your PR card has been produced and is on its way. 🍁",
    "Refused / Withdrawn": "There's an update on your application that we need to discuss. We'll reach out shortly.",
  };
  const line = friendly[stage] || `Your application has moved to a new stage: ${stage}.`;
  return `Hi ${first}, an update on your immigration application:\n\n${line}\n\n— Newton Immigration Team 🍁`;
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("systemToken") || "";
  const sysOk = Boolean(process.env.AUTH_RECOVERY_TOKEN) && token === process.env.AUTH_RECOVERY_TOKEN;
  let companyId = "";
  if (sysOk) {
    companyId = url.searchParams.get("companyId") || "newton";
  } else {
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff" || !["Admin", "ProcessingLead"].includes(user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    companyId = user.companyId;
  }

  if (!imapConfigured()) {
    return NextResponse.json({ error: "Gmail IMAP not configured (need GMAIL_FROM_EMAIL + GMAIL_APP_PASSWORD, and IMAP enabled in Gmail)." }, { status: 503 });
  }

  const dry = url.searchParams.get("dry") === "1";
  const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days") || 5)));

  const trackers = await listTrackers(companyId);
  // Index trackers by normalized application number for fast matching.
  const byApp = new Map<string, TrackerEntry>();
  for (const t of trackers) {
    if (t.archived) continue;
    const k = norm(t.applicationNumber);
    if (k) byApp.set(k, t);
  }

  let emails: Awaited<ReturnType<typeof fetchRecentInbox>> = [];
  try {
    emails = await fetchRecentInbox({ sinceDays: days, max: 80 });
  } catch (e) {
    return NextResponse.json({ error: `IMAP read failed: ${(e as Error).message}` }, { status: 502 });
  }

  const advanced: any[] = [];
  const skipped: any[] = [];
  let scannedIrcc = 0;

  for (const em of emails) {
    if (!looksLikeIrcc(em.from)) continue;
    const parsed = parseIrccEmail(em.subject, em.text);
    if (!parsed.detectedStage || parsed.appNumbers.length === 0) continue;
    scannedIrcc++;

    // Find a tracker whose app number matches any candidate in the email.
    let match: TrackerEntry | undefined;
    for (const cand of parsed.appNumbers) {
      const hit = byApp.get(norm(cand));
      if (hit) { match = hit; break; }
    }
    if (!match) { skipped.push({ subject: em.subject.slice(0, 70), reason: "no matching tracker", apps: parsed.appNumbers }); continue; }

    const curIdx = stageIndex(match.stage);
    const newIdx = parsed.stageIdx;
    const isRefusal = parsed.detectedStage === "Refused / Withdrawn";
    // Forward-only: advance only if the email implies a later stage (refusal always applies).
    if (!isRefusal && newIdx <= curIdx) {
      skipped.push({ subject: em.subject.slice(0, 70), reason: `already at/after (${match.stage})`, client: match.clientName });
      continue;
    }

    const note = `Auto: "${em.subject.slice(0, 80)}" (${em.date.slice(0, 10)})`;
    if (!dry) {
      await updateTracker(companyId, match.id, {
        stage: parsed.detectedStage,
        notes: match.notes ? `${match.notes} | ${note}` : note,
        updatedBy: "Auto (IRCC email)",
      } as any);
      // keep our in-memory copy current so two emails in one run chain correctly
      match.stage = parsed.detectedStage;
    }

    // Notify the client (every stage change).
    let notified = false, notifyErr: string | undefined;
    if (!dry && match.clientPhone) {
      try {
        const res = await sendWhatsAppText(match.clientPhone, clientMessage(match.clientName, parsed.detectedStage));
        notified = Boolean(res?.success);
        if (!notified) notifyErr = res?.error;
      } catch (e) { notifyErr = (e as Error).message; }
    }

    advanced.push({
      tracker: match.id,
      client: match.clientName,
      app: match.applicationNumber,
      from: `${match.stage}`,
      to: parsed.detectedStage,
      subject: em.subject.slice(0, 70),
      clientNotified: notified,
      notifyError: notifyErr,
      noPhone: !match.clientPhone || undefined,
    });
  }

  return NextResponse.json({
    ok: true,
    dryRun: dry,
    emailsScanned: emails.length,
    irccEmails: scannedIrcc,
    advancedCount: advanced.length,
    advanced,
    skipped: skipped.slice(0, 20),
  });
}
