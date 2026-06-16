"use client";

// ─────────────────────────────────────────────────────────────────────
// Manager firm-wide "at-risk" view (Team tab). Same priority signals as My Day,
// grouped by risk. Renders nothing for non-managers (API returns 403).
//
//   <TeamAtRisk apiFetch={apiFetch} onOpenCase={(id) => selectCase(id)} />
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Row = { caseId: string; client: string; type: string; assignedTo: string; reason: string; ready: string; deadlineDays: number | null };
type Buckets = Record<string, Row[]>;
type Counts = { overdue: number; due_soon: number; ready: number; assemble: number; stalled: number };

const CHIP: Array<{ key: keyof Counts; label: string; cls: string }> = [
  { key: "overdue", label: "Overdue", cls: "bg-red-100 text-red-700" },
  { key: "due_soon", label: "Due ≤7d", cls: "bg-amber-100 text-amber-700" },
  { key: "stalled", label: "Stalled docs", cls: "bg-orange-100 text-orange-700" },
  { key: "ready", label: "Ready/review", cls: "bg-emerald-100 text-emerald-700" },
  { key: "assemble", label: "Assemble", cls: "bg-indigo-100 text-indigo-700" },
];

export default function TeamAtRisk({ apiFetch, onOpenCase }: { apiFetch: ApiFetch; onOpenCase?: (caseId: string) => void }) {
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [buckets, setBuckets] = useState<Buckets>({});
  const [perAssignee, setPerAssignee] = useState<Array<{ name: string; atRisk: number }>>([]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/admin/at-risk`);
      if (res.status === 403) { setHidden(true); return; }
      if (res.ok) {
        const d = await res.json();
        setCounts(d.counts || null);
        setBuckets(d.buckets || {});
        setPerAssignee(d.perAssignee || []);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  if (hidden) return null;

  const Section = ({ title, rows, accent }: { title: string; rows: Row[]; accent: string }) => {
    if (!rows || rows.length === 0) return null;
    return (
      <div>
        <p className={`text-xs font-bold uppercase tracking-wide ${accent} mb-1.5`}>{title} · {rows.length}</p>
        <div className="space-y-1">
          {rows.slice(0, 10).map((r) => (
            <button key={r.caseId} onClick={() => onOpenCase?.(r.caseId)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left hover:bg-slate-50">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-slate-800">{r.caseId} · {r.client || "—"}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{r.assignedTo}</span>
              </div>
              <p className="text-xs text-slate-500 truncate">{r.reason}</p>
            </button>
          ))}
          {rows.length > 10 && <p className="text-[11px] text-slate-400">+ {rows.length - 10} more</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-slate-800">Firm at-risk</h2>
        <div className="flex flex-wrap gap-1.5">
          {counts && CHIP.map((c) => (
            <span key={c.key} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.cls}`}>
              {counts[c.key]} {c.label}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <Section title="Overdue / expired" rows={buckets.overdue} accent="text-red-600" />
            <Section title="Due soon" rows={buckets.due_soon} accent="text-amber-600" />
            <Section title="Stalled — waiting on docs" rows={buckets.stalled} accent="text-orange-600" />
          </div>
          <div className="space-y-4">
            <Section title="Ready / in review" rows={buckets.ready} accent="text-emerald-600" />
            <Section title="Docs complete — assemble" rows={buckets.assemble} accent="text-indigo-600" />
            {perAssignee.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">At-risk by person</p>
                <div className="space-y-1">
                  {perAssignee.map((p) => (
                    <div key={p.name} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                      <span className="text-slate-700">{p.name}</span>
                      <span className="font-bold text-slate-800">{p.atRisk}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
