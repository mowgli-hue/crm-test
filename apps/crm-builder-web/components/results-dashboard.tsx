"use client";

// ─────────────────────────────────────────────────────────────────────
// Results Dashboard — Newton's Daily Pulse
//
// What this is: a rich, exciting dashboard at the top of the Results
// screen that turns RepTrack's daily IRCC scan output into a real
// performance view. Staff opens this page and sees:
//
//   1. HERO METRICS — approval rate, pending decisions, wins this week,
//      red flags this week. Big numbers, color-coded, with trend arrows.
//   2. MONTHLY TREND — line chart of approvals/refusals over last 6 months
//   3. OUTCOMES BY APPLICATION TYPE — bar chart showing which programs
//      are doing well (PGWP vs SOWP vs Spousal etc)
//   4. WINS WALL — recent approvals (last 7 days), celebration mode
//   5. RED FLAGS — refusals (separate, never auto-send)
//
// All of this is computed CLIENT-SIDE from the existing legacyResults
// array — no backend changes needed beyond what was already there. The
// component is purely presentational; clicking through to send results
// stays in the existing list view below.
// ─────────────────────────────────────────────────────────────────────

import React, { useMemo } from "react";

interface LegacyResultItem {
  id: string;
  applicationNumber: string;
  clientName: string;
  resultDate: string;
  outcome: "approved" | "refused" | "request_letter" | "other";
  notes?: string;
  matchedCaseId?: string;
  informedToClient?: boolean;
  createdAt: string;
}

interface CaseSummary {
  id: string;
  client: string;
  formType: string;
  leadPhone?: string;
  applicationNumber?: string;
  assignedTo?: string;
}

interface Props {
  results: LegacyResultItem[];
  cases: CaseSummary[];
  // Used for clickthrough — opens the result row below in the list
  onScrollToList?: () => void;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

// Parse a date string flexibly — accepts "2026-05-08", "May 8, 2026",
// or anything Date can parse. Returns null on failure rather than NaN
// so consumers can guard.
function parseFlex(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-CA", { month: "short", year: "2-digit" });
}

function daysAgo(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

// "PGWP" / "Post-Graduation Work Permit (PGWP)" → "PGWP"
function shortFormType(formType: string): string {
  const t = (formType || "").trim();
  // Pull parenthetical abbrev if present
  const paren = t.match(/\(([A-Z]{2,6})\)/);
  if (paren) return paren[1];
  // Common shortenings
  const lc = t.toLowerCase();
  if (lc.includes("post-graduation") || lc.includes("pgwp")) return "PGWP";
  if (lc.includes("spousal open work") || lc.includes("sowp")) return "SOWP";
  if (lc.includes("study permit extension") || lc.includes("spe")) return "SPE";
  if (lc.includes("study permit")) return "Study Permit";
  if (lc.includes("visitor") || lc.includes("trv")) return "TRV";
  if (lc.includes("super visa")) return "Super Visa";
  if (lc.includes("citizenship")) return "Citizenship";
  if (lc.includes("pr card")) return "PR Card";
  if (lc.includes("spousal sponsorship") || lc.includes("sponsorship")) return "Sponsorship";
  if (lc.includes("express entry")) return "EE";
  if (lc.includes("lmia")) return "LMIA";
  // Default: take first 2-3 words
  return t.split(/\s+/).slice(0, 2).join(" ") || "Other";
}

// ─────────────────────────────────────────────────────────────────────
// Subject parsing — RepTrack's `subjects` field contains the IRCC letter
// types separated by " | ". This extracts a human-friendly label so we
// can show "Biometrics Request", "Passport Request", etc. rather than
// just the generic "request_letter" outcome bucket.
// ─────────────────────────────────────────────────────────────────────
export function classifyLetterType(subjects: string): string {
  const s = (subjects || "").toLowerCase();
  if (s.includes("biometrics collection") || s.includes("biometrics letter")) return "Biometrics Request";
  if (s.includes("original passport request") || s.includes("passport request")) return "Passport Request";
  if (s.includes("approval letter") || s.includes("approval for")) return "Approval";
  if (s.includes("refusal letter")) return "Refusal";
  if (s.includes("withdrawal letter")) return "Withdrawal";
  if (s.includes("information letter")) return "Information Letter";
  if (s.includes("correspondence letter")) return "Correspondence";
  if (s.includes("officer decision note") || s.includes("odn")) return "Officer Decision Note";
  if (s.includes("submission confirmation")) return "Submission Confirmation";
  return "Other";
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export default function ResultsDashboard({ results, cases, onScrollToList }: Props) {
  // Build a quick lookup: appNum → case (for showing form type in metrics)
  const caseByAppNum = useMemo(() => {
    const m = new Map<string, CaseSummary>();
    for (const c of cases) {
      const a = String(c.applicationNumber || "").trim().toUpperCase();
      if (a) m.set(a, c);
    }
    return m;
  }, [cases]);

  // Annotate each result with: parsed date, matched case, short form type
  const annotated = useMemo(() => {
    return results.map((r) => {
      const date = parseFlex(r.resultDate) || parseFlex(r.createdAt);
      const matched = caseByAppNum.get(String(r.applicationNumber || "").trim().toUpperCase()) || null;
      return { ...r, date, matched, formType: matched ? shortFormType(matched.formType) : "Unmatched" };
    });
  }, [results, caseByAppNum]);

  // ── Compute hero metrics ──
  const metrics = useMemo(() => {
    const now = new Date();
    const thisMonth = startOfMonth(now);
    const lastMonth = new Date(thisMonth);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const inThisMonth = (r: typeof annotated[0]) => r.date && r.date >= thisMonth;
    const inLastMonth = (r: typeof annotated[0]) =>
      r.date && r.date >= lastMonth && r.date < thisMonth;
    const inLast7Days = (r: typeof annotated[0]) => r.date && r.date >= sevenDaysAgo;

    const thisMonthDecided = annotated.filter(
      (r) => inThisMonth(r) && (r.outcome === "approved" || r.outcome === "refused")
    );
    const thisMonthApproved = thisMonthDecided.filter((r) => r.outcome === "approved");
    const thisMonthApprovalRate = thisMonthDecided.length > 0
      ? Math.round((thisMonthApproved.length / thisMonthDecided.length) * 100)
      : null;

    const lastMonthDecided = annotated.filter(
      (r) => inLastMonth(r) && (r.outcome === "approved" || r.outcome === "refused")
    );
    const lastMonthApproved = lastMonthDecided.filter((r) => r.outcome === "approved");
    const lastMonthApprovalRate = lastMonthDecided.length > 0
      ? Math.round((lastMonthApproved.length / lastMonthDecided.length) * 100)
      : null;

    const trendDelta = thisMonthApprovalRate !== null && lastMonthApprovalRate !== null
      ? thisMonthApprovalRate - lastMonthApprovalRate
      : null;

    // Pending = request_letter or other (not yet decided)
    const pendingDecisions = annotated.filter(
      (r) => r.outcome === "request_letter" || r.outcome === "other"
    ).length;

    const winsThisWeek = annotated.filter(
      (r) => inLast7Days(r) && r.outcome === "approved"
    ).length;
    const refusalsThisWeek = annotated.filter(
      (r) => inLast7Days(r) && r.outcome === "refused"
    ).length;

    // Outreach pending — results not yet marked informedToClient
    const outreachPending = annotated.filter(
      (r) => !r.informedToClient && (r.outcome === "approved" || r.outcome === "request_letter")
    ).length;

    return {
      thisMonthApprovalRate,
      lastMonthApprovalRate,
      trendDelta,
      thisMonthApproved: thisMonthApproved.length,
      thisMonthDecided: thisMonthDecided.length,
      pendingDecisions,
      winsThisWeek,
      refusalsThisWeek,
      outreachPending,
    };
  }, [annotated]);

  // ── 6-month trend data (line chart) ──
  const monthlyTrend = useMemo(() => {
    const now = new Date();
    const months: { date: Date; label: string; approved: number; refused: number; total: number; rate: number | null }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ date: d, label: monthLabel(d), approved: 0, refused: 0, total: 0, rate: null });
    }
    for (const r of annotated) {
      if (!r.date) continue;
      const monthIdx = months.findIndex((m, i) => {
        const next = i < months.length - 1 ? months[i + 1].date : new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return r.date! >= m.date && r.date! < next;
      });
      if (monthIdx === -1) continue;
      if (r.outcome === "approved") months[monthIdx].approved++;
      else if (r.outcome === "refused") months[monthIdx].refused++;
    }
    for (const m of months) {
      m.total = m.approved + m.refused;
      m.rate = m.total > 0 ? Math.round((m.approved / m.total) * 100) : null;
    }
    return months;
  }, [annotated]);

  // ── Outcomes by application type ──
  const byFormType = useMemo(() => {
    const map = new Map<string, { approved: number; refused: number; pending: number }>();
    for (const r of annotated) {
      const ft = r.formType;
      if (!map.has(ft)) map.set(ft, { approved: 0, refused: 0, pending: 0 });
      const b = map.get(ft)!;
      if (r.outcome === "approved") b.approved++;
      else if (r.outcome === "refused") b.refused++;
      else b.pending++;
    }
    // Sort by total volume, take top 8
    return Array.from(map.entries())
      .map(([formType, counts]) => ({
        formType,
        ...counts,
        total: counts.approved + counts.refused + counts.pending,
        rate: counts.approved + counts.refused > 0
          ? Math.round((counts.approved / (counts.approved + counts.refused)) * 100)
          : null,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [annotated]);

  // ── Wins (last 7 days approvals, newest first) ──
  const recentWins = useMemo(() => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return annotated
      .filter((r) => r.outcome === "approved" && r.date && r.date >= sevenDaysAgo)
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
      .slice(0, 8);
  }, [annotated]);

  // ── Red flags (refusals — never auto-send) ──
  const redFlags = useMemo(() => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return annotated
      .filter((r) => r.outcome === "refused" && r.date && r.date >= sevenDaysAgo)
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  }, [annotated]);

  // Empty state
  if (annotated.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
        <p className="text-4xl mb-2">📊</p>
        <p className="text-sm font-bold text-slate-700">No results yet</p>
        <p className="text-xs text-slate-500 mt-1">Upload a RepTrack JSON file above to see your dashboard.</p>
      </div>
    );
  }

  // ── Render ──
  return (
    <div className="space-y-4">
      {/* ════════════════════════════════════════════════════════════
           HERO METRICS — 4 big stat cards
         ════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Approval rate this month */}
        <MetricCard
          label="Approval Rate"
          subtitle="this month"
          value={
            metrics.thisMonthApprovalRate !== null
              ? `${metrics.thisMonthApprovalRate}%`
              : "—"
          }
          subValue={
            metrics.thisMonthDecided > 0
              ? `${metrics.thisMonthApproved} of ${metrics.thisMonthDecided} decisions`
              : "no decisions yet"
          }
          trendDelta={metrics.trendDelta}
          gradient="from-emerald-50 to-teal-50"
          accent="emerald"
          emoji={
            metrics.thisMonthApprovalRate !== null && metrics.thisMonthApprovalRate >= 80
              ? "🎯"
              : metrics.thisMonthApprovalRate !== null && metrics.thisMonthApprovalRate >= 60
              ? "👍"
              : "📊"
          }
        />

        {/* Pending decisions */}
        <MetricCard
          label="Pending"
          subtitle="awaiting IRCC decision"
          value={String(metrics.pendingDecisions)}
          subValue={metrics.pendingDecisions === 0 ? "all caught up!" : "in flight"}
          gradient="from-amber-50 to-yellow-50"
          accent="amber"
          emoji="⏳"
        />

        {/* Wins this week */}
        <MetricCard
          label="Approvals"
          subtitle="last 7 days"
          value={String(metrics.winsThisWeek)}
          subValue={metrics.winsThisWeek === 0 ? "—" : metrics.winsThisWeek >= 10 ? "🔥 hot week!" : "keep going"}
          gradient="from-blue-50 to-indigo-50"
          accent="blue"
          emoji="🎉"
        />

        {/* Refusals this week */}
        <MetricCard
          label="Refusals"
          subtitle="last 7 days"
          value={String(metrics.refusalsThisWeek)}
          subValue={metrics.refusalsThisWeek === 0 ? "✅ none this week" : "needs review"}
          gradient={metrics.refusalsThisWeek === 0 ? "from-slate-50 to-slate-50" : "from-red-50 to-rose-50"}
          accent={metrics.refusalsThisWeek === 0 ? "slate" : "red"}
          emoji={metrics.refusalsThisWeek === 0 ? "🎌" : "🚨"}
        />
      </div>

      {/* Outreach pending banner — the action queue */}
      {metrics.outreachPending > 0 && (
        <div className="rounded-xl border-2 border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📤</span>
              <div>
                <p className="text-sm font-bold text-purple-900">
                  {metrics.outreachPending} {metrics.outreachPending === 1 ? "result needs" : "results need"} to be sent to clients
                </p>
                <p className="text-xs text-purple-700 mt-0.5">
                  Approvals + request letters not yet shared. Scroll down to send.
                </p>
              </div>
            </div>
            {onScrollToList && (
              <button
                onClick={onScrollToList}
                className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700"
              >
                View Queue →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
           CHARTS ROW — monthly trend + by-form-type
         ════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 6-month trend */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-slate-900">📈 6-Month Trend</p>
              <p className="text-[11px] text-slate-500">Decisions per month + approval rate</p>
            </div>
          </div>
          <MonthlyTrendChart data={monthlyTrend} />
        </div>

        {/* By form type */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-slate-900">🎯 Outcomes by Application Type</p>
              <p className="text-[11px] text-slate-500">Top 8 by volume</p>
            </div>
          </div>
          <ByFormTypeChart data={byFormType} />
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
           WINS WALL + RED FLAGS — bottom row
         ════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Wins wall */}
        <div className="rounded-xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-emerald-900">🎉 Recent Wins</p>
            <span className="text-[10px] font-semibold text-emerald-700 bg-white px-2 py-0.5 rounded-full">
              last 7 days
            </span>
          </div>
          {recentWins.length === 0 ? (
            <div className="rounded-lg bg-white/60 p-4 text-center">
              <p className="text-xs text-emerald-700">No approvals this week — let's change that next week 💪</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {recentWins.map((w) => (
                <div key={w.id} className="rounded-lg bg-white/80 backdrop-blur px-3 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base shrink-0">✅</span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">{w.clientName || "Unknown"}</p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {w.formType !== "Unmatched" ? `${w.formType} · ` : ""}
                        {w.applicationNumber}
                        {w.date && ` · ${w.date.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`}
                      </p>
                    </div>
                  </div>
                  {!w.informedToClient && (
                    <span className="text-[9px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded shrink-0">
                      📤 not sent
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Red flags */}
        <div className={`rounded-xl border-2 ${redFlags.length === 0 ? "border-slate-200 bg-slate-50" : "border-red-200 bg-gradient-to-br from-red-50 to-rose-50"} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <p className={`text-sm font-bold ${redFlags.length === 0 ? "text-slate-600" : "text-red-900"}`}>
              {redFlags.length === 0 ? "🎌 No Red Flags" : "🚨 Refusals — Need Sandhu's Eyes"}
            </p>
            {redFlags.length > 0 && (
              <span className="text-[10px] font-semibold text-red-700 bg-white px-2 py-0.5 rounded-full">
                last 7 days
              </span>
            )}
          </div>
          {redFlags.length === 0 ? (
            <div className="rounded-lg bg-white/60 p-4 text-center">
              <p className="text-xs text-slate-600">No refusals this week — quality processing is paying off 🎯</p>
            </div>
          ) : (
            <>
              <p className="text-[10px] text-red-800 mb-2 italic">
                ⚠️ Never auto-message refusals. Call client first — discuss path forward (reapply, judicial review, withdrawal).
              </p>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {redFlags.map((r) => (
                  <div key={r.id} className="rounded-lg bg-white/80 backdrop-blur px-3 py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base shrink-0">❌</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{r.clientName || "Unknown"}</p>
                        <p className="text-[10px] text-slate-500 truncate">
                          {r.formType !== "Unmatched" ? `${r.formType} · ` : ""}
                          {r.applicationNumber}
                          {r.date && ` · ${daysAgo(r.date)}d ago`}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function MetricCard({
  label,
  subtitle,
  value,
  subValue,
  trendDelta,
  gradient,
  accent,
  emoji,
}: {
  label: string;
  subtitle: string;
  value: string;
  subValue?: string;
  trendDelta?: number | null;
  gradient: string;
  accent: "emerald" | "amber" | "blue" | "red" | "slate";
  emoji: string;
}) {
  const accentText = {
    emerald: "text-emerald-900",
    amber: "text-amber-900",
    blue: "text-blue-900",
    red: "text-red-900",
    slate: "text-slate-700",
  }[accent];
  const accentMuted = {
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    blue: "text-blue-700",
    red: "text-red-700",
    slate: "text-slate-500",
  }[accent];

  return (
    <div className={`rounded-2xl border border-slate-200 bg-gradient-to-br ${gradient} p-4 relative overflow-hidden`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-wide ${accentMuted}`}>{label}</p>
          <p className={`text-[10px] ${accentMuted} opacity-80`}>{subtitle}</p>
        </div>
        <span className="text-2xl opacity-90">{emoji}</span>
      </div>
      <p className={`text-3xl font-bold ${accentText} leading-none`}>{value}</p>
      <div className="flex items-center justify-between mt-2 gap-2">
        {subValue && <p className={`text-[10px] ${accentMuted} truncate`}>{subValue}</p>}
        {trendDelta !== null && trendDelta !== undefined && (
          <span
            className={`text-[10px] font-bold shrink-0 ${
              trendDelta > 0 ? "text-emerald-700" : trendDelta < 0 ? "text-red-600" : "text-slate-500"
            }`}
          >
            {trendDelta > 0 ? "▲" : trendDelta < 0 ? "▼" : "·"} {Math.abs(trendDelta)}pt
          </span>
        )}
      </div>
    </div>
  );
}

function MonthlyTrendChart({
  data,
}: {
  data: { label: string; approved: number; refused: number; total: number; rate: number | null }[];
}) {
  const maxBar = Math.max(1, ...data.map((d) => d.total));
  const hasAny = data.some((d) => d.total > 0);

  if (!hasAny) {
    return (
      <div className="py-8 text-center">
        <p className="text-xs text-slate-400">No decisions in the last 6 months yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Bars */}
      <div className="flex items-end gap-2 h-32 px-1">
        {data.map((d, i) => {
          const approvedH = (d.approved / maxBar) * 100;
          const refusedH = (d.refused / maxBar) * 100;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex flex-col-reverse h-28 relative" title={`${d.label}: ${d.approved} approved, ${d.refused} refused`}>
                {d.refused > 0 && (
                  <div
                    className="w-full bg-red-300 hover:bg-red-400 transition-colors rounded-b"
                    style={{ height: `${refusedH}%` }}
                  />
                )}
                {d.approved > 0 && (
                  <div
                    className={`w-full bg-emerald-400 hover:bg-emerald-500 transition-colors ${d.refused === 0 ? "rounded" : "rounded-t"}`}
                    style={{ height: `${approvedH}%` }}
                  />
                )}
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-900">
                  {d.rate !== null ? `${d.rate}%` : "—"}
                </p>
                <p className="text-[9px] text-slate-500">{d.label}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
        <span className="flex items-center gap-1 text-[10px] text-slate-600">
          <span className="w-2 h-2 bg-emerald-400 rounded-sm" /> Approved
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-600">
          <span className="w-2 h-2 bg-red-300 rounded-sm" /> Refused
        </span>
        <span className="ml-auto text-[10px] text-slate-400 italic">% = approval rate</span>
      </div>
    </div>
  );
}

function ByFormTypeChart({
  data,
}: {
  data: { formType: string; approved: number; refused: number; pending: number; total: number; rate: number | null }[];
}) {
  if (data.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-xs text-slate-400">No data yet</p>
      </div>
    );
  }

  const maxTotal = Math.max(1, ...data.map((d) => d.total));

  return (
    <div className="space-y-2">
      {data.map((d, i) => {
        const approvedW = (d.approved / maxTotal) * 100;
        const refusedW = (d.refused / maxTotal) * 100;
        const pendingW = (d.pending / maxTotal) * 100;
        return (
          <div key={i} className="space-y-0.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-slate-700 truncate">{d.formType}</span>
              <span className="text-slate-500 shrink-0">
                {d.rate !== null && (
                  <span className={`font-bold ${d.rate >= 80 ? "text-emerald-700" : d.rate >= 60 ? "text-amber-700" : "text-red-700"}`}>
                    {d.rate}%
                  </span>
                )}
                <span className="ml-1.5 text-slate-400">
                  ({d.approved}✓ {d.refused}✗ {d.pending}⏳)
                </span>
              </span>
            </div>
            <div className="flex h-2 rounded-full bg-slate-100 overflow-hidden">
              {d.approved > 0 && (
                <div className="bg-emerald-400" style={{ width: `${approvedW}%` }} title={`${d.approved} approved`} />
              )}
              {d.refused > 0 && (
                <div className="bg-red-300" style={{ width: `${refusedW}%` }} title={`${d.refused} refused`} />
              )}
              {d.pending > 0 && (
                <div className="bg-amber-300" style={{ width: `${pendingW}%` }} title={`${d.pending} pending`} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
