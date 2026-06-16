"use client";

// ─────────────────────────────────────────────────────────────────────
// Team time overview. Shows where the team's hours went — per person and per
// application — for today (default) or the last 7 days. Reads /admin/time-summary.
//
//   <TeamTimeOverview apiFetch={apiFetch} />
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type PerStaff = { staffName: string; seconds: number; sessions: number };
type PerCase = { caseId: string; seconds: number; staff: string[]; client?: string; formType?: string };
type PerClient = { client: string; applications: number; seconds: number };

function fmt(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

export default function TeamTimeOverview({ apiFetch }: { apiFetch: ApiFetch }) {
  const [range, setRange] = useState<"day" | "week">("day");
  const [scope, setScope] = useState<"team" | "self">("team");
  const [label, setLabel] = useState("");
  const [perStaff, setPerStaff] = useState<PerStaff[]>([]);
  const [perCase, setPerCase] = useState<PerCase[]>([]);
  const [perClient, setPerClient] = useState<PerClient[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/admin/time-summary?range=${range === "week" ? "week" : "day"}`);
      if (res.ok) {
        const d = await res.json();
        setScope(d.scope === "self" ? "self" : "team");
        setLabel(d.label || "");
        setPerStaff(d.perStaff || []);
        setPerCase(d.perCase || []);
        setPerClient(d.perClient || []);
      }
    } catch { /* ignore transient */ } finally {
      setLoading(false);
    }
  }, [apiFetch, range]);

  useEffect(() => { load(); }, [load]);

  const teamTotal = perStaff.reduce((a, p) => a + p.seconds, 0);
  const maxStaff = Math.max(1, ...perStaff.map((p) => p.seconds));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{scope === "self" ? "My time" : "Team time"}</h2>
          <p className="text-xs text-slate-500">{label} · {fmt(teamTotal)} total · {perCase.length} applications · {perClient.length} clients</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button onClick={() => setRange("day")}
            className={`px-3 py-1.5 text-xs font-bold ${range === "day" ? "bg-slate-800 text-white" : "bg-white text-slate-600"}`}>Today</button>
          <button onClick={() => setRange("week")}
            className={`px-3 py-1.5 text-xs font-bold ${range === "week" ? "bg-slate-800 text-white" : "bg-white text-slate-600"}`}>Last 7 days</button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : perStaff.length === 0 ? (
        <p className="text-sm text-slate-400">No check-ins logged yet for this period.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Per person — only meaningful in team scope (self scope = just you) */}
          {scope === "team" && (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-bold text-slate-700 mb-2">By person</p>
            <div className="space-y-2">
              {perStaff.map((p) => (
                <div key={p.staffName}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-semibold text-slate-700">{p.staffName}</span>
                    <span className="tabular-nums text-slate-600">{fmt(p.seconds)} <span className="text-slate-400">· {p.sessions}</span></span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round((p.seconds / maxStaff) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Per client — how many applications each client has + time */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-bold text-slate-700 mb-2">By client</p>
            <div className="space-y-1.5">
              {perClient.slice(0, 12).map((c) => (
                <div key={c.client} className="flex items-center justify-between text-xs">
                  <span className="min-w-0 truncate text-slate-700">
                    {c.client}
                    <span className="text-slate-400"> · {c.applications} application{c.applications === 1 ? "" : "s"}</span>
                  </span>
                  <span className="tabular-nums font-semibold text-slate-700 shrink-0 ml-2">{fmt(c.seconds)}</span>
                </div>
              ))}
              {perClient.length > 12 && <p className="text-[11px] text-slate-400">+ {perClient.length - 12} more</p>}
            </div>
          </div>

          {/* Per application — which client each case belongs to */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 md:col-span-2">
            <p className="text-sm font-bold text-slate-700 mb-2">By application</p>
            <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {perCase.slice(0, 20).map((c) => (
                <div key={c.caseId} className="flex items-center justify-between text-xs">
                  <span className="min-w-0 truncate text-slate-700">
                    {c.caseId}{c.client ? " · " + c.client : ""}
                    <span className="text-slate-400">{c.formType ? " · " + c.formType : ""}</span>
                  </span>
                  <span className="tabular-nums font-semibold text-slate-700 shrink-0 ml-2">{fmt(c.seconds)}</span>
                </div>
              ))}
            </div>
            {perCase.length > 20 && <p className="text-[11px] text-slate-400 mt-1">+ {perCase.length - 20} more</p>}
          </div>
        </div>
      )}
    </div>
  );
}
