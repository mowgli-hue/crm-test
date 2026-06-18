"use client";

// ─────────────────────────────────────────────────────────────────────
// Case check-in panel + per-application work log.
//
//   <CaseTimeCheckin caseId={c.id} apiFetch={apiFetch} />
//
// Anyone who can open the case can check in (processing, reviewer, lead) and
// must report a status + note when they check out. The work log below shows
// what everyone did on THIS application — who, how long, what status, what note.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";

type ActiveSession = { id: string; caseId: string; startedAt: string };
type PerStaff = { staffName: string; seconds: number; sessions: number };
type Entry = { id: string; staffName: string; durationSeconds: number | null; outcome: string; note: string; startedAt: string; endedAt: string | null; source: string };

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

const OUTCOMES: Array<{ key: string; label: string; tone: string }> = [
  { key: "ready_for_review", label: "✅ Ready for review", tone: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  { key: "in_progress", label: "⏳ Still in progress", tone: "border-slate-300 bg-slate-50 text-slate-700" },
  { key: "waiting_client", label: "📩 Waiting on client", tone: "border-amber-300 bg-amber-50 text-amber-800" },
  { key: "blocked", label: "⛔ Blocked — need help", tone: "border-red-300 bg-red-50 text-red-700" },
  { key: "submitted", label: "📤 Submitted to IRCC", tone: "border-indigo-300 bg-indigo-50 text-indigo-800" },
  { key: "handed_off", label: "🔁 Handed off", tone: "border-slate-300 bg-slate-50 text-slate-700" },
];
const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(
  OUTCOMES.map((o) => [o.key, o.label.replace(/^[^ ]+ /, "")])
);

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}
function dayTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function CaseTimeCheckin({ caseId, apiFetch }: { caseId: string; apiFetch: ApiFetch }) {
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [elsewhereCase, setElsewhereCase] = useState<string | null>(null);
  const [perStaff, setPerStaff] = useState<PerStaff[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // strict check-out
  const [stopping, setStopping] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/cases/${caseId}/time`);
      if (!res.ok) return;
      const d = await res.json();
      setActive(d.active || null);
      setElsewhereCase(d.activeElsewhere?.caseId || null);
      setPerStaff(d.summary?.perStaff || []);
      setTotalSeconds(d.summary?.totalSeconds || 0);
      setEntries(d.entries || []);
    } catch { /* ignore transient */ }
  }, [apiFetch, caseId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (active) {
      tickRef.current = setInterval(() => setNow(Date.now()), 1000);
      return () => { if (tickRef.current) clearInterval(tickRef.current); };
    }
  }, [active]);

  const checkIn = async () => {
    setBusy(true);
    try {
      await apiFetch(`/cases/${caseId}/time`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "in" }),
      });
      await load();
    } finally { setBusy(false); }
  };

  const confirmCheckOut = async () => {
    if (!outcome || !note.trim()) return; // status AND note required
    setBusy(true);
    try {
      await apiFetch(`/cases/${caseId}/time`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "out", outcome, note: note.trim() }),
      });
      setStopping(false); setOutcome(""); setNote("");
      await load();
    } finally { setBusy(false); }
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
          <button onClick={() => { setStopping(true); setOutcome(""); setNote(""); }} disabled={busy}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            Check out
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={checkIn} disabled={busy}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            Check in
          </button>
          {elsewhereCase && (
            <span className="text-xs text-amber-600">You're checked in to {elsewhereCase} — checking in here moves you over.</span>
          )}
        </div>
      )}

      {/* Strict check-out: status + note required */}
      {stopping && (
        <div className="rounded-lg border-2 border-blue-200 bg-blue-50/40 p-3">
          <p className="text-xs font-bold text-slate-800">Before you check out — where does this stand?</p>
          <p className="text-[11px] text-slate-500">Pick a status and write a note. Both required.</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {OUTCOMES.map((o) => (
              <button key={o.key} type="button" onClick={() => setOutcome(o.key)}
                className={`rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold ${outcome === o.key ? o.tone + " ring-2 ring-offset-1 ring-slate-400" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                {o.label}
              </button>
            ))}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoFocus
            placeholder="Required note — what you did and what's left…"
            className={`mt-2 w-full rounded-lg border px-2.5 py-1.5 text-xs ${note.trim() ? "border-slate-200" : "border-red-300 bg-red-50/40"}`} />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setStopping(false)} className="text-[11px] font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
            <button type="button" disabled={!outcome || !note.trim() || busy} onClick={confirmCheckOut}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-40">Save &amp; check out</button>
          </div>
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

      {/* Work log — what each person did on this application */}
      {entries.length > 0 && (
        <div className="border-t border-slate-100 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Work log</p>
          <div className="mt-1 max-h-72 space-y-1 overflow-y-auto">
            {entries.map((e) => (
              <div key={e.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-700">{e.staffName || "—"}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">
                    {fmtDuration(e.durationSeconds || 0)} · {e.endedAt ? dayTime(e.endedAt) : ""}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {e.outcome && <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{OUTCOME_LABEL[e.outcome] || e.outcome}</span>}
                  {e.source === "auto_closed" && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">auto-closed</span>}
                  {e.note && <span className="text-[11px] italic text-slate-500">“{e.note}”</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
