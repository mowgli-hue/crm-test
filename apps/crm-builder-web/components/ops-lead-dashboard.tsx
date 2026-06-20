"use client";

// ─────────────────────────────────────────────────────────────────────
// AI Operations Lead — the management dashboard (Admin only).
//
// One screen that replaces the missing day-to-day manager:
//   • Leadership Brief — what to do today, in plain language.
//   • Rebalance plan — case moves the AI is making / proposing to protect
//     deadlines and balance load (auto-applied nightly; "Apply now" button
//     here for on-demand).
//   • Scorecards — an AI verdict per person (rating + read + the one fix).
//   • New-hire ramp reads — how each recent hire is picking it up.
//
//   <OpsLeadDashboard apiFetch={apiFetch} />
// The endpoint is Admin-gated and self-hides for everyone else.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

type Rating = "strong" | "solid" | "coaching" | "at_risk" | "too_new";
type LiveStatus = "active" | "idle" | "offline";

interface StaffMetrics {
  staffId: string; name: string; role: string; active: boolean;
  tenureDays: number | null; isNewHire: boolean;
  casesAssigned: number; submittedWindow: number;
  avgHoursToSubmit: number | null; slaHits: number; slaMisses: number; slaHitRate: number | null;
  reworkFlags: number; reworkRate: number | null;
  hoursLoggedWindow: number; activeDays: number; sessions: number; lastActiveISO: string | null;
  status: LiveStatus; idleMinutes: number; activeCaseId: string | null; atRiskAssigned: number;
}
interface TeamSummary {
  staffCount: number; prepStaff: number; activeNow: number; idleNow: number; offlineNow: number;
  openCases: number; unassignedCases: number; atRiskOpen: number; submittedWindow: number;
  totalReworkFlags: number; medianLoad: number; paidNotStarted: number; bottleneck: string;
}
interface PaidCase { caseId: string; client: string; formType: string; assignee: string; daysWaiting: number; }
interface RebalanceMove {
  caseId: string; client: string; formType: string; fromName: string; toName: string;
  rule: string; reason: string; slaStatus: string;
}
interface StaffVerdict {
  staffId: string; name: string; rating: Rating; ratingLabel: string;
  headline: string; fix: string; rampRead?: string;
}
interface Payload {
  data: { generatedAt: string; windowLabel: string; team: TeamSummary; staff: StaffMetrics[]; rebalance: RebalanceMove[]; paidNotStartedCases?: PaidCase[] };
  judgment: { brief: string; verdicts: StaffVerdict[]; aiUsed: boolean; model: string };
}

const RATING_STYLE: Record<Rating, { dot: string; chip: string }> = {
  strong:   { dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800" },
  solid:    { dot: "bg-sky-500",     chip: "bg-sky-100 text-sky-800" },
  coaching: { dot: "bg-amber-500",   chip: "bg-amber-100 text-amber-800" },
  at_risk:  { dot: "bg-rose-500",    chip: "bg-rose-100 text-rose-800" },
  too_new:  { dot: "bg-slate-400",   chip: "bg-slate-100 text-slate-700" },
};
const LIVE_DOT: Record<LiveStatus, string> = { active: "bg-emerald-500", idle: "bg-amber-500", offline: "bg-slate-300" };
const SLA_CHIP: Record<string, string> = {
  breached: "bg-rose-100 text-rose-700", due_soon: "bg-amber-100 text-amber-800",
  on_track: "bg-emerald-100 text-emerald-700", done: "bg-slate-100 text-slate-600",
};
const RULE_LABEL: Record<string, string> = {
  departed: "owner left", orphaned_inactive: "owner offline",
  unassigned_at_risk: "was unassigned", overloaded_at_risk: "load balancing",
  wrong_lane: "wrong lane",
};

export default function OpsLeadDashboard({ apiFetch }: { apiFetch: ApiFetch }) {
  const [p, setP] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [err, setErr] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const [showScorecards, setShowScorecards] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/admin/ops-lead`);
      if (res.status === 403) { setForbidden(true); return; }
      if (!res.ok) { setErr(`Couldn't load (${res.status})`); return; }
      setP(await res.json());
      setErr("");
    } catch (e: any) { setErr(e?.message || "Failed to load"); }
    finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const applyRebalance = useCallback(async () => {
    if (!p?.data.rebalance.length) return;
    setApplying(true); setApplyMsg("");
    try {
      const res = await apiFetch(`/admin/ops-lead/rebalance/apply`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setApplyMsg(`✅ Applied ${d.appliedCount} move(s)${d.skippedCount ? `, skipped ${d.skippedCount}` : ""}.`); await load(); }
      else setApplyMsg(`⚠️ ${d.error || "Failed"}`);
    } catch (e: any) { setApplyMsg(`⚠️ ${e?.message || "Failed"}`); }
    finally { setApplying(false); }
  }, [apiFetch, p, load]);

  if (forbidden) return null;
  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-400">Loading AI Operations Lead…</div>;
  if (err) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{err}</div>;
  if (!p) return null;

  const { data, judgment } = p;
  const verdictByName = new Map(judgment.verdicts.map((v) => [v.name.toLowerCase(), v]));
  const newHires = data.staff.filter((s) => s.isNewHire);
  const ranked = [...data.staff].sort((a, b) => {
    const order: Record<Rating, number> = { at_risk: 0, coaching: 1, too_new: 2, solid: 3, strong: 4 };
    const ra = verdictByName.get(a.name.toLowerCase())?.rating ?? "solid";
    const rb = verdictByName.get(b.name.toLowerCase())?.rating ?? "solid";
    return order[ra] - order[rb] || b.submittedWindow - a.submittedWindow;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">🧭 AI Operations Lead</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Your management layer · {data.windowLabel} · {judgment.aiUsed ? `judged by ${judgment.model}` : "rule-based read"}
            </p>
          </div>
          <button onClick={load} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">↻ Refresh</button>
        </div>

        {/* Team stat strip */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Active now" value={`${data.team.activeNow}`} sub={`${data.team.idleNow} idle · ${data.team.offlineNow} off`} />
          <Stat label="Open cases" value={`${data.team.openCases}`} sub={`${data.team.unassignedCases} unassigned`} />
          <Stat label="At risk" value={`${data.team.atRiskOpen}`} tone={data.team.atRiskOpen > 0 ? "warn" : "ok"} sub="open & slipping" />
          <Stat label="Submitted" value={`${data.team.submittedWindow}`} sub={data.windowLabel} />
          <Stat label="Rework flags" value={`${data.team.totalReworkFlags}`} tone={data.team.totalReworkFlags > 0 ? "warn" : "ok"} sub="reviewer changes" />
          <Stat label="Paid · not started" value={`${data.team.paidNotStarted ?? 0}`} tone={(data.team.paidNotStarted ?? 0) > 0 ? "warn" : "ok"} sub="money waiting" />
          <Stat label="Median load" value={`${data.team.medianLoad}`} sub="cases/person" />
        </div>
      </div>

      {/* Leadership brief */}
      <div className="rounded-2xl border border-slate-900/10 bg-slate-900 p-4 text-slate-50 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-bold">📋 Today's leadership brief</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/70">for the owner</span>
        </div>
        <div className="space-y-1.5 text-[13px] leading-relaxed text-slate-100">
          {judgment.brief.split("\n").filter(Boolean).map((line, i) => (
            <p key={i} className="flex gap-2"><span className="text-indigo-300">›</span><span>{line}</span></p>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-white/50">Bottleneck: {data.team.bottleneck}</p>
      </div>

      {/* Rebalance plan */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">🔁 Work distribution</h3>
            <p className="text-xs text-slate-500">
              {data.rebalance.length === 0
                ? "Balanced — no moves needed right now."
                : `${data.rebalance.length} case(s) to move so nothing's dropped and load stays even. Runs automatically each night; apply now if you want it immediately.`}
            </p>
          </div>
          {data.rebalance.length > 0 && (
            <button
              onClick={applyRebalance}
              disabled={applying}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {applying ? "Applying…" : `Apply ${data.rebalance.length} move(s) now`}
            </button>
          )}
        </div>
        {applyMsg && <p className="mt-2 text-xs font-semibold text-slate-700">{applyMsg}</p>}
        {data.rebalance.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {data.rebalance.map((m) => (
              <div key={m.caseId} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                <span className="font-mono text-slate-400">{m.caseId}</span>
                <span className="font-semibold text-slate-700">{m.client || "—"}</span>
                <span className="text-slate-400">{m.formType}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${SLA_CHIP[m.slaStatus] || "bg-slate-100 text-slate-600"}`}>{m.slaStatus.replace("_", " ")}</span>
                <span className="ml-auto flex items-center gap-1.5 text-slate-600">
                  <span className="text-slate-400 line-through">{m.fromName}</span>
                  <span>→</span>
                  <span className="font-bold text-indigo-700">{m.toName}</span>
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">{RULE_LABEL[m.rule] || m.rule}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Paid but not started — money waiting */}
      {(p.data.paidNotStartedCases?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <h3 className="text-sm font-bold text-slate-900">💸 Paid — work not started ({p.data.paidNotStartedCases!.length})</h3>
          <p className="text-xs text-slate-500">Clients who paid but whose case hasn't begun. Assign and start these — it's revenue already in the door.</p>
          <div className="mt-2 space-y-1">
            {p.data.paidNotStartedCases!.slice(0, 12).map((c) => (
              <div key={c.caseId} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-100 bg-white px-3 py-1.5 text-xs">
                <span className="font-mono text-slate-400">{c.caseId}</span>
                <span className="font-semibold text-slate-700">{c.client || "—"}</span>
                <span className="text-slate-400">{c.formType}</span>
                <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{c.daysWaiting}d waiting</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New-hire ramp reads */}
      {newHires.length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
          <h3 className="text-sm font-bold text-slate-900">🌱 New hires — how they're ramping</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {newHires.map((s) => {
              const v = verdictByName.get(s.name.toLowerCase());
              return (
                <div key={s.staffId} className="rounded-xl border border-violet-100 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">{s.name}</span>
                    <span className="text-[11px] text-slate-500">{s.tenureDays}d · wk {Math.max(1, Math.ceil((s.tenureDays ?? 0) / 7))}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{v?.rampRead || v?.headline}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
                    <Pill>{s.submittedWindow} submitted</Pill>
                    <Pill>{s.activeDays} active days</Pill>
                    {s.reworkRate !== null && <Pill>{s.reworkRate} rework/case</Pill>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scorecards */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <button onClick={() => setShowScorecards((v) => !v)} className="flex w-full items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">📊 Scorecards — {data.staff.length} people</h3>
          <span className="text-xs text-slate-400">{showScorecards ? "Hide" : "Show"}</span>
        </button>
        {showScorecards && (
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {ranked.map((s) => {
              const v = verdictByName.get(s.name.toLowerCase());
              const rating = v?.rating ?? "solid";
              const rs = RATING_STYLE[rating];
              return (
                <div key={s.staffId} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${LIVE_DOT[s.status]}`} title={s.status} />
                      <span className="text-sm font-bold text-slate-900">{s.name}</span>
                      <span className="text-[10px] text-slate-400">{s.role}</span>
                      {!s.active && <span className="rounded bg-rose-100 px-1 text-[10px] font-semibold text-rose-700">disabled</span>}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${rs.chip}`}>{v?.ratingLabel || "Solid"}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{v?.headline}</p>
                  {v?.fix && (
                    <p className="mt-1.5 flex gap-1 text-[11px] text-slate-700">
                      <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${rs.dot}`} />
                      <span><span className="font-semibold">Do:</span> {v.fix}</span>
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-slate-500">
                    <Pill>{s.casesAssigned} on plate{s.atRiskAssigned > 0 ? ` · ${s.atRiskAssigned} at risk` : ""}</Pill>
                    <Pill>{s.submittedWindow} submitted</Pill>
                    {s.slaHitRate !== null && <Pill>{Math.round(s.slaHitRate * 100)}% on-time</Pill>}
                    {s.reworkRate !== null && <Pill>{s.reworkRate} rework/case</Pill>}
                    <Pill>{s.hoursLoggedWindow}h · {s.activeDays}d</Pill>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="px-1 text-[11px] text-slate-400">
        Reads only the data already in the CRM (work sessions, assignments, submissions, reviewer flags, SLA clock). Reassignments are logged on each case and in the audit trail. Verdicts are guidance for the owner, not automated employment decisions.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`rounded-xl border p-2 ${tone === "warn" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${tone === "warn" ? "text-amber-700" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-white px-1.5 py-0.5 ring-1 ring-slate-200">{children}</span>;
}
