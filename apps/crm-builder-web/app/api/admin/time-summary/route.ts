// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/time-summary?date=YYYY-MM-DD  (or ?range=week)
//
// Team application-time rollup for a day (default today) or the last 7 days:
// time per staff member and time per application. Visible to all staff so the
// whole team can see where the day's hours went. See lib/time-tracking.ts.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { teamTimeSummary } from "@/lib/time-tracking";
import { listAllCases } from "@/lib/store";

export const runtime = "nodejs";

// Day window in UTC. Good enough for a daily rollup; refine to a firm timezone later.
function windowFor(dateStr: string, range: string): { start: string; end: string; label: string } {
  const now = new Date();
  let base = now;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (m) base = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dayStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  if (range === "week") {
    const start = new Date(dayStart);
    start.setUTCDate(start.getUTCDate() - 6);
    const end = new Date(dayStart);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start: start.toISOString(), end: end.toISOString(), label: "last 7 days" };
  }
  const end = new Date(dayStart);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    start: dayStart.toISOString(),
    end: end.toISOString(),
    label: dayStart.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const { start, end, label } = windowFor(url.searchParams.get("date") || "", url.searchParams.get("range") || "");

  try {
    const summary = await teamTimeSummary({ companyId: user.companyId, startISO: start, endISO: end });

    // Resolve each case to its client + form type so the UI can show WHICH
    // client (not just a case number), and roll up applications per client.
    const cases = await listAllCases();
    const byId = new Map(cases.map((c) => [c.id, { client: String((c as any).client || ""), formType: String((c as any).formType || "") }]));

    const perCase = summary.perCase.map((pc) => ({
      ...pc,
      client: byId.get(pc.caseId)?.client || "",
      formType: byId.get(pc.caseId)?.formType || "",
    }));

    // Per client: how many applications (distinct cases) and total time.
    const clientAgg = new Map<string, { client: string; caseIds: Set<string>; seconds: number }>();
    for (const pc of perCase) {
      const key = (pc.client || "(unknown)").toLowerCase();
      const row = clientAgg.get(key) || { client: pc.client || "(unknown)", caseIds: new Set<string>(), seconds: 0 };
      row.caseIds.add(pc.caseId);
      row.seconds += pc.seconds;
      clientAgg.set(key, row);
    }
    const perClient = Array.from(clientAgg.values())
      .map((r) => ({ client: r.client, applications: r.caseIds.size, seconds: r.seconds }))
      .sort((a, b) => b.applications - a.applications || b.seconds - a.seconds);

    return NextResponse.json({ ok: true, label, start, end, perStaff: summary.perStaff, perCase, perClient });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
