"use client";

// ─────────────────────────────────────────────────────────────────────
// Reviewer's "To review" queue (dashboard). Prepped cases waiting for review,
// filtered to the reviewer's block, sorted by expiry + amount paid + oldest.
// Renders nothing for non-reviewers (API returns reviewer:false).
//
//   <ReviewQueue apiFetch={apiFetch} onOpenCase={(id) => selectCase(id)} />
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Row = {
  caseId: string; client: string; type: string; preparedBy: string;
  reason: string; deadlineDays: number | null; amountPaid: number; daysInSystem: number;
};

export default function ReviewQueue({ apiFetch, onOpenCase }: { apiFetch: ApiFetch; onOpenCase?: (caseId: string) => void }) {
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<Row[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/review-queue`);
      if (res.ok) {
        const d = await res.json();
        if (d.reviewer) { setShow(true); setCases(d.cases || []); }
        else setShow(false);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  if (!show) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">To review <span className="text-amber-600">· {cases.length}</span></h2>
        <button onClick={() => { setLoading(true); load(); }} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Refresh</button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : cases.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing waiting for your review — all clear.</p>
      ) : (
        <div className="space-y-2">
          {cases.map((c, i) => (
            <button key={c.caseId} onClick={() => onOpenCase?.(c.caseId)}
              className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-left hover:bg-amber-50">
              <div className="flex items-center gap-2">
                {i === 0 && <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">NEXT</span>}
                <span className="truncate text-sm font-bold text-slate-800">{c.caseId} · {c.client || "—"}</span>
                <span className="ml-auto shrink-0 text-[11px] text-slate-400">prep: {c.preparedBy || "—"}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-slate-400">{c.type}</span>
                {c.deadlineDays !== null && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.deadlineDays < 0 ? "bg-red-100 text-red-700" : c.deadlineDays <= 7 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                    {c.deadlineDays < 0 ? `expired ${Math.abs(c.deadlineDays)}d` : `${c.deadlineDays}d`}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">{c.reason}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
