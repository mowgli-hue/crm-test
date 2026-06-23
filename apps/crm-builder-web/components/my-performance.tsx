"use client";

// ─────────────────────────────────────────────────────────────────────
// "My performance" — a personal, day-by-day performance calendar for EACH
// staff member's own dashboard. Transparent and fair: everyone sees their own
// output (submitted), accuracy (rework/errors), and effort (hours), coloured
// per day so they can see how they did over time — the same factors the manager
// sees, but for themselves.
//   <MyPerformance apiFetch={apiFetch} />
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Rating = "strong" | "good" | "flagged" | "progress" | "off";
interface DayRow { date: string; hours: number; sessions: number; cases: number; submitted: number; errors: number; rating: Rating; }
interface Totals { submitted: number; errors: number; accuracyPct: number | null; activeDays: number; totalHours: number; avgHoursPerActiveDay: number; submittedPerActiveDay: number; }

const CELL: Record<Rating, string> = {
  strong: "bg-emerald-500", good: "bg-emerald-400", flagged: "bg-rose-500",
  progress: "bg-sky-400", off: "bg-slate-100",
};
const fmtDay = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };

export default function MyPerformance({ apiFetch }: { apiFetch: ApiFetch }) {
  const [days, setDays] = useState<DayRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<DayRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/me/performance?days=63`);
      if (res.ok) { const d = await res.json(); setDays(d.days || []); setTotals(d.totals || null); }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  // Build a Sun→Sat week-column heatmap from the oldest day through today.
  const weeks = useMemo(() => {
    if (days.length === 0) return [] as Array<Array<DayRow | null>>;
    const iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(days[0].date + "T00:00:00");
    start.setDate(start.getDate() - start.getDay()); // back to Sunday
    const cols: Array<Array<DayRow | null>> = [];
    let cur = new Date(start);
    while (cur <= today) {
      const col: Array<DayRow | null> = [];
      for (let i = 0; i < 7; i++) {
        const key = iso(cur);
        col.push(cur > today ? null : (byDate.get(key) || { date: key, hours: 0, sessions: 0, cases: 0, submitted: 0, errors: 0, rating: "off" }));
        cur.setDate(cur.getDate() + 1);
      }
      cols.push(col);
    }
    return cols;
  }, [days, byDate]);

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-400">Loading your performance…</div>;
  if (!totals) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">📈 My performance</h2>
        <span className="text-[11px] text-slate-400">last 9 weeks</span>
      </div>

      {/* Summary factors */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Submitted" value={`${totals.submitted}`} sub="applications" />
        <Stat label="Accuracy" value={totals.accuracyPct === null ? "—" : `${totals.accuracyPct}%`} sub="clean of rework" tone={totals.accuracyPct !== null && totals.accuracyPct < 70 ? "warn" : "ok"} />
        <Stat label="Rework flags" value={`${totals.errors}`} sub="from review" tone={totals.errors > 0 ? "warn" : "ok"} />
        <Stat label="Active days" value={`${totals.activeDays}`} sub={`${totals.avgHoursPerActiveDay}h avg`} />
        <Stat label="Efficiency" value={`${totals.submittedPerActiveDay}`} sub="subs / active day" />
      </div>

      {/* Heatmap calendar */}
      <div className="overflow-x-auto">
        <div className="flex gap-1">
          {weeks.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-1">
              {col.map((d, ri) => d ? (
                <button key={ri} onClick={() => setSel(d)} title={`${fmtDay(d.date)} · ${d.hours}h · ${d.submitted} submitted · ${d.errors} flag(s)`}
                  className={`h-3.5 w-3.5 rounded-sm ${CELL[d.rating]} ${sel?.date === d.date ? "ring-2 ring-slate-800" : ""}`} />
              ) : <div key={ri} className="h-3.5 w-3.5" />)}
            </div>
          ))}
        </div>
      </div>

      {/* Legend + selected day */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-emerald-500" /> clean + submitted</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-sky-400" /> worked</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-rose-500" /> got rework</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-slate-100 ring-1 ring-slate-200" /> off</span>
        </div>
        {sel && (
          <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
            <b>{fmtDay(sel.date)}</b> — {sel.hours}h · {sel.cases} case(s) · {sel.submitted} submitted · {sel.errors > 0 ? <span className="font-semibold text-rose-600">{sel.errors} rework flag(s)</span> : "no flags"}
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400">Your own view — output (submitted), accuracy (rework from review), and effort (hours). Click any day for detail.</p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`rounded-xl border p-2 ${tone === "warn" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${tone === "warn" ? "text-amber-700" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
