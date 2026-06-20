"use client";

// ─────────────────────────────────────────────────────────────────────
// Manager live floor view: who's punched into a case right now, who's idle
// (and for how long), and who hasn't started today — plus each person's last
// reported status. Polls every 20s. Managers only (endpoint is RBAC-gated).
//
//   <TeamActivity apiFetch={apiFetch} />
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

type Member = {
  staffId: string; staffName: string; role: string;
  status: "active" | "idle" | "offline";
  activeCaseId: string | null; activeMinutes: number;
  idleMinutes: number; todaySeconds: number;
  lastCaseId: string | null; lastOutcome: string;
  lastNote: string; needsAttention: boolean;
};
type Summary = { active: number; idle: number; offline: number; idleThresholdMin: number; flaggedCount: number };
type Flagged = { staffName: string; idleMinutes: number; lastCaseId: string | null };
type Recent = { staffId: string; staffName: string; caseId: string; durationSeconds: number; outcome: string; note: string; endedAt: string };

const OUTCOME_LABEL: Record<string, string> = {
  ready_for_review: "ready for review",
  in_progress: "in progress",
  waiting_client: "waiting on client",
  blocked: "blocked",
  submitted: "submitted",
  handed_off: "handed off",
};
const DOT: Record<string, string> = { active: "bg-emerald-500", idle: "bg-amber-500", offline: "bg-slate-300" };
const ROW: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50/40",
  idle: "border-amber-300 bg-amber-50",
  offline: "border-slate-200 bg-white",
};

function mins(m: number): string {
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}
function hrs(seconds: number): string {
  const m = Math.round(seconds / 60);
  return mins(m);
}
// Time-of-day in Pacific (the team's timezone), e.g. "9:34 AM".
function clockPT(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/Vancouver", hour: "numeric", minute: "2-digit" });
}
function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export default function TeamActivity({ apiFetch }: { apiFetch: ApiFetch }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [flagged, setFlagged] = useState<Flagged[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // Click-a-name → that person's day (Pacific) history.
  const [openStaff, setOpenStaff] = useState<string | null>(null);
  const [day, setDay] = useState<any | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  const toggleDay = useCallback(async (staffId: string) => {
    if (openStaff === staffId) { setOpenStaff(null); setDay(null); return; }
    setOpenStaff(staffId); setDay(null); setDayLoading(true);
    try {
      const res = await apiFetch(`/admin/staff-day?staffId=${encodeURIComponent(staffId)}`);
      if (res.ok) setDay(await res.json());
    } catch { /* ignore */ } finally { setDayLoading(false); }
  }, [apiFetch, openStaff]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/admin/team-activity`);
      if (res.ok) {
        const d = await res.json();
        setMembers(d.members || []);
        setSummary(d.summary || null);
        setFlagged(d.flagged || []);
        setRecent(d.recent || []);
        setErr("");
      } else if (res.status === 403) {
        setErr("forbidden");
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  if (err === "forbidden") return null; // not a manager — hide entirely

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">Team activity — right now</h2>
        {summary && (
          <div className="flex items-center gap-2 text-[11px] font-semibold">
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">{summary.active} active</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{summary.idle} idle</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{summary.offline} offline</span>
          </div>
        )}
      </div>

      {/* Idle alert — people parked past the threshold */}
      {summary && summary.flaggedCount > 0 && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 px-3 py-2">
          <p className="text-sm font-bold text-red-700">⚠️ {summary.flaggedCount} idle {summary.idleThresholdMin}m+</p>
          <p className="mt-0.5 text-xs text-red-600">
            {flagged.map((f) => `${f.staffName} (${mins(f.idleMinutes)}${f.lastCaseId ? `, last ${f.lastCaseId}` : ""})`).join(" · ")}
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-slate-400">No team members found.</p>
      ) : (
        <div className="space-y-1.5">
          {members.map((m) => (
            <div key={m.staffId}>
            <div className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${m.needsAttention ? "border-red-300 bg-red-50" : ROW[m.status]}`}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${m.needsAttention ? "bg-red-500" : DOT[m.status]}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleDay(m.staffId)} className="truncate text-left text-sm font-bold text-slate-800 hover:text-indigo-700 hover:underline" title="See today's history">
                    {m.staffName}
                  </button>
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">{m.role}</span>
                  <span className="text-[10px] text-indigo-400">{openStaff === m.staffId ? "▲" : "▾"}</span>
                </div>
                <p className="text-xs text-slate-500">
                  {m.status === "active" && (
                    <>On <span className="font-semibold text-slate-700">{m.activeCaseId}</span> · {mins(m.activeMinutes)} this session</>
                  )}
                  {m.status === "idle" && (
                    <span className={m.needsAttention ? "font-semibold text-red-700" : "font-semibold text-amber-700"}>
                      Not in any application — idle {mins(m.idleMinutes)}
                      {m.lastCaseId ? <span className="font-normal text-slate-500"> · last: {m.lastCaseId}{m.lastOutcome ? ` (${OUTCOME_LABEL[m.lastOutcome] || m.lastOutcome})` : ""}</span> : null}
                    </span>
                  )}
                  {m.status === "offline" && <span className="text-slate-400">Hasn't started today</span>}
                </p>
                {m.lastNote && m.status !== "active" && (
                  <p className="mt-0.5 truncate text-[11px] italic text-slate-500">“{m.lastNote}”</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-semibold tabular-nums text-slate-600">{hrs(m.todaySeconds)}</p>
                <p className="text-[10px] text-slate-400">today</p>
              </div>
            </div>

            {/* Click-to-expand: this person's day (Pacific) */}
            {openStaff === m.staffId && (
              <div className="mt-1 ml-5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-2.5">
                {dayLoading ? (
                  <p className="text-xs text-slate-400">Loading {m.staffName}'s day…</p>
                ) : !day || (!day.sessions?.length && !day.active) ? (
                  <p className="text-xs text-slate-400">No work logged today.</p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-500">
                      {m.staffName}'s day · {hrs(day.totalSeconds || 0)} total
                    </p>
                    {day.active && (
                      <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-2 py-1 text-xs">
                        <span className="font-semibold text-emerald-700">▶ Now: {day.active.caseId}{day.active.client ? ` · ${day.active.client}` : ""}</span>
                        <span className="text-[10px] text-emerald-600">since {clockPT(day.active.startedAt)}</span>
                      </div>
                    )}
                    {(day.sessions || []).map((s: any, i: number) => (
                      <div key={i} className="rounded-lg bg-white px-2 py-1 ring-1 ring-slate-100">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-slate-700">{s.caseId}{s.client ? ` · ${s.client}` : ""}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{clockPT(s.startedAt)}–{clockPT(s.endedAt)} · {hrs(s.durationSeconds)}</span>
                        </div>
                        {(s.outcome || s.note) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {s.outcome && <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{OUTCOME_LABEL[s.outcome] || s.outcome}</span>}
                            {s.note && <span className="truncate text-[11px] italic text-slate-500">“{s.note}”</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            </div>
          ))}
        </div>
      )}
      {/* Recent check-outs — what people reported when they stopped */}
      {recent.length > 0 && (
        <div className="border-t border-slate-100 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Recent check-outs</p>
          <div className="mt-1 max-h-64 space-y-1 overflow-y-auto">
            {recent.map((r, i) => (
              <div key={`${r.staffId}-${i}`} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-700">{r.staffName} · {r.caseId}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(r.endedAt)} · {hrs(r.durationSeconds)}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {r.outcome && <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{OUTCOME_LABEL[r.outcome] || r.outcome}</span>}
                  {r.note && <span className="truncate text-[11px] italic text-slate-500">“{r.note}”</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary && (
        <p className="text-[11px] text-slate-400">Idle = punched out but active earlier today. Auto-refreshes every 20s.</p>
      )}
    </div>
  );
}
