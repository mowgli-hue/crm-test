"use client";

// ─────────────────────────────────────────────────────────────────────
// Case check-in panel. Drop into the case view / dashboard.
//
//   <CaseTimeCheckin caseId={c.id} apiFetch={apiFetch} />
//
// apiFetch(path, init?) must be the app's authenticated fetch (same one used
// elsewhere in simple-shell) — it prefixes /api and sends the session cookie.
// The logged-in user is always the person being checked in (enforced server-side).
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";

type ActiveSession = { id: string; caseId: string; startedAt: string };
type PerStaff = { staffName: string; seconds: number; sessions: number };

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

export default function CaseTimeCheckin({ caseId, apiFetch }: { caseId: string; apiFetch: ApiFetch }) {
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [elsewhereCase, setElsewhereCase] = useState<string | null>(null);
  const [perStaff, setPerStaff] = useState<PerStaff[]>([]);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/cases/${caseId}/time`);
      if (!res.ok) return;
      const d = await res.json();
      setActive(d.active || null);
      setElsewhereCase(d.activeElsewhere?.caseId || null);
      setPerStaff(d.summary?.perStaff || []);
      setTotalSeconds(d.summary?.totalSeconds || 0);
    } catch { /* ignore transient */ }
  }, [apiFetch, caseId]);

  useEffect(() => { load(); }, [load]);

  // Live ticking only while checked in here.
  useEffect(() => {
    if (active) {
      tickRef.current = setInterval(() => setNow(Date.now()), 1000);
      return () => { if (tickRef.current) clearInterval(tickRef.current); };
    }
  }, [active]);

  const act = async (action: "in" | "out") => {
    setBusy(true);
    try {
      await apiFetch(`/cases/${caseId}/time`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const liveSeconds = active ? (now - new Date(active.startedAt).getTime()) / 1000 : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-slate-700">Time on this application</span>
        <span className="text-sm font-semibold text-slate-500">{fmtDuration(totalSeconds)} logged</span>
      </div>

      {active ? (
        <div className="flex items-center gap-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <span className="text-xs font-bold text-blue-700">You're checked in</span>
          <span className="ml-auto text-lg font-semibold tabular-nums text-blue-800">{fmtDuration(liveSeconds)}</span>
          <button
            onClick={() => act("out")}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Check out
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            onClick={() => act("in")}
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Check in
          </button>
          {elsewhereCase && (
            <span className="text-xs text-amber-600">
              You're checked in to {elsewhereCase} — checking in here moves you over.
            </span>
          )}
        </div>
      )}

      {perStaff.length > 0 && (
        <div className="space-y-1 border-t border-slate-100 pt-2">
          {perStaff.map((p) => (
            <div key={p.staffName} className="flex items-center justify-between text-xs">
              <span className="text-slate-600">{p.staffName}</span>
              <span className="font-semibold tabular-nums text-slate-700">
                {fmtDuration(p.seconds)} <span className="font-normal text-slate-400">· {p.sessions} check-ins</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
