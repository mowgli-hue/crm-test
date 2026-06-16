"use client";

// ─────────────────────────────────────────────────────────────────────
// AI team performance review (Team tab, managers only). Per person: volume,
// quality (corrections), effort (hours), efficiency — plus an AI read.
// Self-hides for non-managers (API returns 403).
//
//   <TeamPerformanceReview apiFetch={apiFetch} />
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Row = {
  name: string; role: string; assigned: number; submitted: number;
  corrections: number; hours: number; hoursPerSubmission: number | null; review: string;
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-center">
      <div className={`text-sm font-bold ${tone || "text-slate-800"}`}>{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}

export default function TeamPerformanceReview({ apiFetch }: { apiFetch: ApiFetch }) {
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/admin/performance-review`);
      if (res.status === 403) { setHidden(true); return; }
      if (res.ok) { const d = await res.json(); setMonth(d.month || ""); setRows(d.rows || []); }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  if (hidden) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Performance review</h2>
          <p className="text-xs text-slate-500">{month} · AI read across volume, quality, time &amp; efficiency</p>
        </div>
        <button onClick={load} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Refresh</button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Analyzing the month…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">No team activity to review yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.name} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm font-bold text-slate-800">{r.name} <span className="font-normal text-slate-400">· {r.role}</span></span>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-2">
                <Stat label="submitted" value={r.submitted} tone="text-emerald-700" />
                <Stat label="assigned" value={r.assigned} />
                <Stat label="corrections" value={r.corrections} tone={r.corrections > 0 ? "text-red-600" : "text-slate-800"} />
                <Stat label="hours" value={r.hours} />
              </div>
              <p className="text-sm text-slate-600">{r.review}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
