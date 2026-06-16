"use client";

// ─────────────────────────────────────────────────────────────────────
// "My Day" dashboard widget: the user's applications, prioritized, with an AI
// "do this first today" focus and one-tap check-in (start timing) per case.
//
//   <MyDay apiFetch={apiFetch} onOpenCase={(id) => selectCase(id)} />
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type DayCase = {
  caseId: string; client: string; type: string; status: string;
  reviewStatus: string; ageDays: number; reason: string;
};

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

const STATUS_STYLE: Record<string, string> = {
  changes_needed: "bg-red-100 text-red-700",
  under_review: "bg-amber-100 text-amber-700",
  ready: "bg-emerald-100 text-emerald-700",
  ready_to_submit: "bg-emerald-100 text-emerald-700",
  docs_pending: "bg-slate-100 text-slate-600",
};

export default function MyDay({ apiFetch, onOpenCase }: { apiFetch: ApiFetch; onOpenCase?: (caseId: string) => void }) {
  const [cases, setCases] = useState<DayCase[]>([]);
  const [focus, setFocus] = useState("");
  const [topPicks, setTopPicks] = useState<string[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [activeStartedAt, setActiveStartedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/my-day`);
      if (res.ok) {
        const d = await res.json();
        setCases(d.cases || []);
        setFocus(d.focus || "");
        setTopPicks(d.topPickIds || []);
        setActiveCaseId(d.activeCaseId || null);
        setActiveStartedAt(d.activeStartedAt || null);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (activeCaseId) {
      tickRef.current = setInterval(() => setNow(Date.now()), 1000);
      return () => { if (tickRef.current) clearInterval(tickRef.current); };
    }
  }, [activeCaseId]);

  const toggleTimer = async (caseId: string, action: "in" | "out") => {
    setBusyId(caseId);
    try {
      await apiFetch(`/cases/${caseId}/time`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally { setBusyId(null); }
  };

  const liveSeconds = activeStartedAt ? (now - new Date(activeStartedAt).getTime()) / 1000 : 0;
  const isTop = (id: string) => topPicks.includes(id);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">My day</h2>
        <button onClick={() => { setLoading(true); load(); }} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Refresh</button>
      </div>

      {/* AI focus */}
      {focus && (
        <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-500">Do this first today</p>
          <p className="text-sm text-indigo-900 mt-0.5">{focus}</p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : cases.length === 0 ? (
        <p className="text-sm text-slate-400">No open applications assigned to you — you're all clear.</p>
      ) : (
        <div className="space-y-2">
          {cases.map((c) => {
            const active = activeCaseId === c.caseId;
            return (
              <div key={c.caseId}
                className={`rounded-xl border px-3 py-2 ${isTop(c.caseId) ? "border-indigo-300 bg-indigo-50/40" : "border-slate-200 bg-white"}`}>
                <div className="flex items-center gap-2">
                  <button onClick={() => onOpenCase?.(c.caseId)}
                    className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      {isTop(c.caseId) && <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">DO FIRST</span>}
                      <span className="truncate text-sm font-bold text-slate-800">{c.caseId} · {c.client || "—"}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-slate-400">{c.type}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[c.reviewStatus === "changes_needed" ? "changes_needed" : c.status] || "bg-slate-100 text-slate-600"}`}>
                        {c.reviewStatus === "changes_needed" ? "changes needed" : c.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{c.reason}</p>
                  </button>

                  {active ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold tabular-nums text-blue-700">{fmtDuration(liveSeconds)}</span>
                      <button disabled={busyId === c.caseId} onClick={() => toggleTimer(c.caseId, "out")}
                        className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">Stop</button>
                    </div>
                  ) : (
                    <button disabled={busyId === c.caseId} onClick={() => toggleTimer(c.caseId, "in")}
                      className="shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">Start</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
