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
};
type Summary = { active: number; idle: number; offline: number; idleThresholdMin: number };

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

export default function TeamActivity({ apiFetch }: { apiFetch: ApiFetch }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/admin/team-activity`);
      if (res.ok) {
        const d = await res.json();
        setMembers(d.members || []);
        setSummary(d.summary || null);
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

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-slate-400">No team members found.</p>
      ) : (
        <div className="space-y-1.5">
          {members.map((m) => (
            <div key={m.staffId} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${ROW[m.status]}`}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[m.status]}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold text-slate-800">{m.staffName}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">{m.role}</span>
                </div>
                <p className="text-xs text-slate-500">
                  {m.status === "active" && (
                    <>On <span className="font-semibold text-slate-700">{m.activeCaseId}</span> · {mins(m.activeMinutes)} this session</>
                  )}
                  {m.status === "idle" && (
                    <span className="font-semibold text-amber-700">
                      Not in any application — idle {mins(m.idleMinutes)}
                      {m.lastCaseId ? <span className="font-normal text-slate-500"> · last: {m.lastCaseId}{m.lastOutcome ? ` (${OUTCOME_LABEL[m.lastOutcome] || m.lastOutcome})` : ""}</span> : null}
                    </span>
                  )}
                  {m.status === "offline" && <span className="text-slate-400">Hasn't started today</span>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-semibold tabular-nums text-slate-600">{hrs(m.todaySeconds)}</p>
                <p className="text-[10px] text-slate-400">today</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {summary && (
        <p className="text-[11px] text-slate-400">Idle = punched out but active earlier today. Auto-refreshes every 20s.</p>
      )}
    </div>
  );
}
