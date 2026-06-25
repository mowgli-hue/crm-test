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

  // ── Pass 1: collect NEW IRCC emails grouped by the tracker they match ──
  // "New" = newer than the last IRCC email we already processed for that file
  // (lastEmailAt), so the 30-min poll never re-acts on the same message.
  type Hit = { em: (typeof emails)[number]; parsed: ReturnType<typeof parseIrccEmail> };
  const byTracker = new Map<string, Hit[]>();
  const unmatched: any[] = [];
  let scannedIrcc = 0;

  for (const em of emails) {
    if (!looksLikeIrcc(em.from)) continue;
    const parsed = parseIrccEmail(em.subject, em.text);
    if (parsed.appNumbers.length === 0) continue; // can't tie it to a file
    scannedIrcc++;

    let match: TrackerEntry | undefined;
    for (const cand of parsed.appNumbers) {
      const hit = byApp.get(norm(cand));
      if (hit) { match = hit; break; }
    }
    if (!match) { unmatched.push({ subject: em.subject.slice(0, 70), apps: parsed.appNumbers }); continue; }
    if (match.lastEmailAt && em.date <= match.lastEmailAt) continue; // already processed

    const arr = byTracker.get(match.id) || [];
    arr.push({ em, parsed });
    byTracker.set(match.id, arr);
  }

  // ── Pass 2: per file, advance if any email names a later stage, else flag ──
  const advanced: any[] = [];
  const flagged: any[] = [];

  for (const [tid, hits] of byTracker) {
    const match = trackers.find((t) => t.id === tid)!;
    const newestDate = hits.reduce((mx, h) => (h.em.date > mx ? h.em.date : mx), match.lastEmailAt || "");
    const curIdx = stageIndex(match.stage);

    // Pick the furthest forward stage any new email implies (refusal always applies).
    let apply: Hit | null = null;
    for (const h of hits) {
      if (!h.parsed.detectedStage) continue;
      if (h.parsed.detectedStage === "Refused / Withdrawn") { apply = h; break; }
      if (h.parsed.stageIdx > curIdx && (!apply || h.parsed.stageIdx > apply.parsed.stageIdx)) apply = h;
    }

    if (apply) {
      const stage = apply.parsed.detectedStage as string;
      const note = `Auto: "${apply.em.subject.slice(0, 80)}" (${apply.em.date.slice(0, 10)})`;
      let notified = false, notifyErr: string | undefined;
      if (!dry) {
        await updateTracker(companyId, match.id, {
          stage,
          lastEmailAt: newestDate,
          pendingReview: false,
          pendingReviewNote: undefined,
          notes: match.notes ? `${match.notes} | ${note}` : note,
          updatedBy: "Auto (IRCC email)",
        } as any);
        if (match.clientPhone) {
          try {
            const res = await sendWhatsAppText(match.clientPhone, clientMessage(match.clientName, stage));
            notified = Boolean(res?.success);
            if (!notified) notifyErr = res?.error;
          } catch (e) { notifyErr = (e as Error).message; }
        }
      }
      advanced.push({
        tracker: match.id, client: match.clientName, app: match.applicationNumber,
        from: match.stage, to: stage, subject: apply.em.subject.slice(0, 70),
        clientNotified: notified, notifyError: notifyErr, noPhone: !match.clientPhone || undefined,
      });
    } else {
      // IRCC contacted us about this file but didn't name a step (generic
      // "sign in to your account" notice). Flag for a human to check the portal.
      const newest = hits.reduce((a, b) => (b.em.date > a.em.date ? b : a));
      const reviewNote = `📬 IRCC update ${newest.em.date.slice(0, 10)}: ${newest.em.subject.slice(0, 90)} — check the IRCC account`;
      if (!dry) {
        await updateTracker(companyId, match.id, {
          lastEmailAt: newestDate,
          pendingReview: true,
          pendingReviewNote: reviewNote,
          notes: match.notes ? `${match.notes} | ${reviewNote}` : reviewNote,
          updatedBy: "Auto (IRCC email)",
        } as any);
      }
      flagged.push({ tracker: match.id, client: match.clientName, app: match.applicationNumber, note: reviewNote });
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: dry,
    emailsScanned: emails.length,
    irccEmails: scannedIrcc,
    advancedCount: advanced.length,
    advanced,
    flaggedCount: flagged.length,
    flagged,
    unmatched: unmatched.slice(0, 20),
  });
}
