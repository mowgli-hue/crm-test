"use client";

// ─────────────────────────────────────────────────────────────────────
// "My Day" dashboard widget: the user's applications, prioritized, with a
// strict "Work Now" punch-in directive, an hours-based SLA clock per case, an
// AI "do this first today" focus, and one-tap check-in (start timing) per case.
//
//   <MyDay apiFetch={apiFetch} onOpenCase={(id) => selectCase(id)} />
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Sla = {
  stage: string; status: "on_track" | "due_soon" | "breached" | "done";
  submitDueISO: string; remainingMs: number; remainingHours: number;
  totalBudgetHours: number; label: string;
};
type NextAction = { key: string; step: string; owner: string; how: string };
type DayCase = {
  caseId: string; client: string; type: string; status: string;
  reviewStatus: string; ageDays: number; reason: string;
  completionPct?: number; daysInSystem?: number;
  sla?: Sla; nextAction?: NextAction;
};
type WorkNow = {
  caseId: string; client: string; type: string;
  step: string; owner: string; how: string; sla: Sla; reason: string;
  sop?: { title: string; steps: string[] };
};
type TodayEntry = { caseId: string; durationSeconds: number | null; outcome: string; note: string; endedAt: string | null };

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

// Live SLA countdown from a due-by ISO. Negative = overdue.
function fmtSla(dueISO: string, now: number): string {
  const ms = Date.parse(dueISO) - now;
  const over = ms < 0;
  const mins = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return over ? `${span} overdue` : `${span} left`;
}

const SLA_STYLE: Record<string, string> = {
  breached: "bg-red-100 text-red-700 border-red-300",
  due_soon: "bg-amber-100 text-amber-800 border-amber-300",
  on_track: "bg-emerald-50 text-emerald-700 border-emerald-200",
  done: "bg-slate-100 text-slate-500 border-slate-200",
};
const WORKNOW_FRAME: Record<string, string> = {
  breached: "border-red-400 bg-red-50",
  due_soon: "border-amber-400 bg-amber-50",
  on_track: "border-indigo-300 bg-indigo-50",
  done: "border-slate-200 bg-slate-50",
};

// What the member reports when they STOP a timer (mandatory).
const OUTCOMES: Array<{ key: string; label: string; tone: string }> = [
  { key: "ready_for_review", label: "✅ Ready for review", tone: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  { key: "in_progress", label: "⏳ Still in progress", tone: "border-slate-300 bg-slate-50 text-slate-700" },
  { key: "waiting_client", label: "📩 Waiting on client", tone: "border-amber-300 bg-amber-50 text-amber-800" },
  { key: "blocked", label: "⛔ Blocked — need help", tone: "border-red-300 bg-red-50 text-red-700" },
  { key: "submitted", label: "📤 Submitted to IRCC", tone: "border-indigo-300 bg-indigo-50 text-indigo-800" },
  { key: "handed_off", label: "🔁 Handed off", tone: "border-slate-300 bg-slate-50 text-slate-700" },
];
const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label]));

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
  const [workNow, setWorkNow] = useState<WorkNow | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [activeStartedAt, setActiveStartedAt] = useState<string | null>(null);
  const [todayLog, setTodayLog] = useState<TodayEntry[]>([]);
  const [todaySeconds, setTodaySeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  // Mandatory check-out: stopping a timer opens this modal to capture status.
  const [stopFor, setStopFor] = useState<string | null>(null);
  const [stopOutcome, setStopOutcome] = useState<string>("");
  const [stopNote, setStopNote] = useState<string>("");
  const [showSop, setShowSop] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/my-day`);
      if (res.ok) {
        const d = await res.json();
        setCases(d.cases || []);
        setFocus(d.focus || "");
        setTopPicks(d.topPickIds || []);
        setWorkNow(d.workNow || null);
        setActiveCaseId(d.activeCaseId || null);
        setActiveStartedAt(d.activeStartedAt || null);
        setTodayLog(d.todayLog || []);
        setTodaySeconds(d.todaySeconds || 0);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // Always tick every second — drives both the live check-in timer and the
  // live SLA countdowns (so the hours-clock visibly ticks down on screen).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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

  // Stopping a timer is a mandatory check-out: open the status modal.
  const requestStop = (caseId: string) => {
    setStopFor(caseId);
    setStopOutcome("");
    setStopNote("");
  };
  const confirmStop = async () => {
    if (!stopFor || !stopOutcome || !stopNote.trim()) return; // status AND note required
    setBusyId(stopFor);
    try {
      await apiFetch(`/cases/${stopFor}/time`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "out", outcome: stopOutcome, note: stopNote.trim() }),
      });
      setStopFor(null); setStopOutcome(""); setStopNote("");
      await load();
    } finally { setBusyId(null); }
  };

  // Strict punch-in: start the timer AND open the case in one action.
  const punchInAndOpen = async (caseId: string) => {
    setBusyId(caseId);
    try {
      await apiFetch(`/cases/${caseId}/time`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "in" }),
      });
      await load();
      onOpenCase?.(caseId);
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

      {/* ── WORK NOW — the strict punch-in directive ── */}
      {!loading && workNow && (
        <div className={`rounded-xl border-2 px-3 py-3 ${WORKNOW_FRAME[workNow.sla.status] || WORKNOW_FRAME.on_track}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">▶ Work now</p>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${SLA_STYLE[workNow.sla.status] || SLA_STYLE.on_track}`}>
              {workNow.sla.status === "breached" ? "⏰ " : ""}{fmtSla(workNow.sla.submitDueISO, now)}
            </span>
          </div>
          <div className="mt-1 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-slate-900">{workNow.caseId} · {workNow.client || "—"}</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-800">
                {workNow.step}
                <span className="ml-1 rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">{workNow.owner}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">{workNow.how}</p>
              {workNow.sop && workNow.sop.steps.length > 0 && (
                <div className="mt-1.5">
                  <button type="button" onClick={() => setShowSop((v) => !v)}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800">
                    {showSop ? "▾ Hide how-to" : "▸ How to do this"}
                  </button>
                  {showSop && (
                    <ol className="mt-1 ml-1 list-decimal space-y-1 pl-4 text-[11px] text-slate-600">
                      {workNow.sop.steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  )}
                </div>
              )}
              <p className="mt-0.5 text-[11px] text-slate-400">{workNow.type} · target {workNow.sla.totalBudgetHours}h to submit</p>
            </div>
            <div className="shrink-0">
              {activeCaseId === workNow.caseId ? (
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-bold tabular-nums text-blue-700">{fmtDuration(liveSeconds)}</span>
                  <button disabled={busyId === workNow.caseId} onClick={() => onOpenCase?.(workNow.caseId)}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">Open case</button>
                  <button disabled={busyId === workNow.caseId} onClick={() => requestStop(workNow.caseId)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-700">Stop timer</button>
                </div>
              ) : (
                <button disabled={busyId === workNow.caseId} onClick={() => punchInAndOpen(workNow.caseId)}
                  className="rounded-lg bg-slate-900 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-black disabled:opacity-50">
                  Punch in &amp; start
                </button>
              )}
            </div>
          </div>
          {activeCaseId && activeCaseId !== workNow.caseId && (
            <p className="mt-2 text-[11px] font-semibold text-amber-700">
              You're punched into {activeCaseId}. Punching in here will switch your timer to this case.
            </p>
          )}
        </div>
      )}

      {/* AI focus */}
      {focus && (
        <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-500">Do this first today</p>
          <p className="text-sm text-indigo-900 mt-0.5">{focus}</p>
        </div>
      )}

      {/* End-of-day wrap-up (from ~5pm) — review your work before logging off */}
      {!loading && new Date().getHours() >= 17 && cases.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-600">Wrap-up time</p>
          <p className="text-sm text-amber-900 mt-0.5">
            {cases.length} application{cases.length === 1 ? "" : "s"} still open. Give each a quick check, finish what you can,
            and leave a note on anything you're handing over before you log off.
          </p>
        </div>
      )}

      {/* Appreciation — cleared the list */}
      {!loading && cases.length === 0 && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2">
          <p className="text-sm text-emerald-900">All clear — lovely work today. Nothing left on your plate. 🎉</p>
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
                className={`rounded-xl border px-3 py-2 ${active ? "border-blue-300 bg-blue-50/40" : isTop(c.caseId) ? "border-indigo-300 bg-indigo-50/40" : "border-slate-200 bg-white"}`}>
                <div className="flex items-center gap-2">
                  <button onClick={() => onOpenCase?.(c.caseId)}
                    className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      {isTop(c.caseId) && <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">DO FIRST</span>}
                      <span className="truncate text-sm font-bold text-slate-800">{c.caseId} · {c.client || "—"}</span>
                      {c.sla && (
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${SLA_STYLE[c.sla.status] || SLA_STYLE.on_track}`}>
                          {c.sla.status === "breached" ? "⏰ " : ""}{fmtSla(c.sla.submitDueISO, now)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-slate-400">{c.type}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[c.reviewStatus === "changes_needed" ? "changes_needed" : c.status] || "bg-slate-100 text-slate-600"}`}>
                        {c.reviewStatus === "changes_needed" ? "changes needed" : c.status.replace(/_/g, " ")}
                      </span>
                      {typeof c.completionPct === "number" && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                          <span className="inline-block h-1 w-10 rounded-full bg-slate-100 overflow-hidden align-middle">
                            <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${c.completionPct}%` }} />
                          </span>
                          {c.completionPct}%
                        </span>
                      )}
                    </div>
                    {c.nextAction ? (
                      <p className="mt-1 text-xs text-slate-600"><span className="font-semibold">Next:</span> {c.nextAction.step} <span className="text-slate-400">· {c.nextAction.owner}</span></p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">{c.reason}</p>
                    )}
                  </button>

                  {active ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold tabular-nums text-blue-700">{fmtDuration(liveSeconds)}</span>
                      <button disabled={busyId === c.caseId} onClick={() => requestStop(c.caseId)}
                        className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">Stop</button>
                    </div>
                  ) : (
                    <button disabled={busyId === c.caseId} onClick={() => punchInAndOpen(c.caseId)}
                      className="shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">Punch in</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Today — what you did (auto report from your check-ins) ── */}
      {!loading && todayLog.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Today — what you did</p>
            <span className="text-xs font-semibold text-slate-600">{fmtDuration(todaySeconds)} total</span>
          </div>
          <div className="mt-1.5 space-y-1.5">
            {todayLog.map((e, i) => (
              <div key={i} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <span className="font-semibold text-slate-700">{e.caseId}</span>
                  {e.outcome && <span className="ml-1.5 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{OUTCOME_LABEL[e.outcome] || e.outcome}</span>}
                  {e.note && <p className="truncate text-[11px] italic text-slate-500">“{e.note}”</p>}
                </div>
                <span className="shrink-0 tabular-nums text-slate-400">{fmtDuration(e.durationSeconds || 0)}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-slate-400">Your auto-built day report — from your check-ins. Nothing extra to fill in.</p>
        </div>
      )}

      {/* ── Mandatory check-out status modal ── */}
      {stopFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setStopFor(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-slate-900">Before you stop — where does {stopFor} stand?</p>
            <p className="mt-0.5 text-xs text-slate-500">Pick a status <span className="font-semibold">and</span> write a note. Both required.</p>
            <div className="mt-3 grid grid-cols-1 gap-1.5">
              {OUTCOMES.map((o) => (
                <button key={o.key} type="button" onClick={() => setStopOutcome(o.key)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold ${stopOutcome === o.key ? o.tone + " ring-2 ring-offset-1 ring-slate-400" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                  {o.label}
                </button>
              ))}
            </div>
            <textarea value={stopNote} onChange={(e) => setStopNote(e.target.value)} autoFocus rows={2}
              placeholder="Required note — what you did and what's left…"
              className={`mt-3 w-full rounded-lg border px-3 py-2 text-sm ${stopNote.trim() ? "border-slate-200" : "border-red-300 bg-red-50/40"}`} />
            {!stopNote.trim() && <p className="mt-1 text-[11px] font-semibold text-red-500">A note is required to stop the timer.</p>}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setStopFor(null)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
              <button type="button" disabled={!stopOutcome || !stopNote.trim() || busyId === stopFor} onClick={confirmStop}
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40">Save &amp; stop</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
