// ─────────────────────────────────────────────────────────────────────
// POST /api/admin/tracker-email-discover?days=120&create=0
//
// Mines the WHOLE recent inbox for IRCC correspondence and reports every
// application number it finds, grouped, with the furthest stage detected and
// the latest email date — so the team can see all in-flight files at once and
// import the ones not yet in the tracker.
//
// ?create=1  → also create tracker rows for application numbers not already
//              tracked (stage = furthest detected, else "AOR Received";
//              pendingReview if only generic notices were seen).
//
// Auth: admin session OR ?systemToken=.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listTrackers, createTracker } from "@/lib/store";
import { fetchRecentInbox, imapConfigured } from "@/lib/gmail-imap";
import { parseIrccEmail, looksLikeIrcc, stageIndex } from "@/lib/tracker-email-parser";

const norm = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Best-effort client name from an IRCC email body ("Dear First Last,").
function guessName(text: string): string {
  const m = (text || "").match(/\bDear\s+((?:[A-Z][a-z'’-]+\s+){0,3}[A-Z][a-z'’-]+)\s*[,\n]/);
  const n = (m?.[1] || "").trim();
  // Filter generic salutations.
  if (!n || /client|applicant|sir|madam|customer/i.test(n)) return "";
  return n;
}

interface Discovered {
  appNumber: string;
  furthestStage: string | null;
  latestDate: string;
  emailCount: number;
  clientName: string;
  genericOnly: boolean;
  alreadyTracked: boolean;
  sampleSubject: string;
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
    return NextResponse.json({ error: "Gmail IMAP not configured." }, { status: 503 });
  }

  const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days") || 120)));
  const create = url.searchParams.get("create") === "1";

  let emails: Awaited<ReturnType<typeof fetchRecentInbox>> = [];
  try {
    emails = await fetchRecentInbox({ sinceDays: days, max: 300 });
  } catch (e) {
    return NextResponse.json({ error: `IMAP read failed: ${(e as Error).message}` }, { status: 502 });
  }

  const trackers = await listTrackers(companyId);
  const trackedApps = new Set(trackers.map((t) => norm(t.applicationNumber)).filter(Boolean));

  // Group every IRCC email by application number.
  const groups = new Map<string, Discovered>();
  for (const em of emails) {
    if (!looksLikeIrcc(em.from)) continue;
    const parsed = parseIrccEmail(em.subject, em.text);
    if (parsed.appNumbers.length === 0) continue;
    const name = guessName(em.text);
    for (const raw of parsed.appNumbers) {
      const app = norm(raw);
      if (app.length < 6) continue;
      const g = groups.get(app) || {
        appNumber: raw.toUpperCase(),
        furthestStage: null as string | null,
        latestDate: "",
        emailCount: 0,
        clientName: "",
        genericOnly: true,
        alreadyTracked: trackedApps.has(app),
        sampleSubject: em.subject.slice(0, 80),
      };
      g.emailCount += 1;
      if (em.date > g.latestDate) { g.latestDate = em.date; g.sampleSubject = em.subject.slice(0, 80); }
      if (parsed.detectedStage) {
        g.genericOnly = false;
        if (g.furthestStage === null || stageIndex(parsed.detectedStage) > stageIndex(g.furthestStage)) {
          g.furthestStage = parsed.detectedStage;
        }
      }
      if (!g.clientName && name) g.clientName = name;
      groups.set(app, g);
    }
  }

  const discovered = [...groups.values()].sort((a, b) => b.latestDate.localeCompare(a.latestDate));
  const newOnes = discovered.filter((d) => !d.alreadyTracked);

  let created = 0;
  const createdRows: string[] = [];
  if (create) {
    for (const d of newOnes) {
      await createTracker({
        companyId,
        applicationNumber: d.appNumber,
        clientName: d.clientName,
        applicationType: "Express Entry (PR)",
        stage: d.furthestStage || "AOR Received",
        notes: `Imported from inbox — latest: "${d.sampleSubject}" (${d.latestDate.slice(0, 10)})`,
      });
      created += 1;
      createdRows.push(d.appNumber);
    }
  }

  return NextResponse.json({
    ok: true,
    windowDays: days,
    emailsScanned: emails.length,
    applicationsFound: discovered.length,
    newCount: newOnes.length,
    created,
    createdRows,
    discovered,
  });
}
