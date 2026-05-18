// components/admin-dashboard-page.tsx
//
// Admin-only overview screen. Shows KPI cards, per-staff workload, top
// stuck cases, and recent activity. Pulls from /api/admin/dashboard.

import { useEffect, useState } from "react";

type Workload = {
  name: string;
  email: string;
  role: string;
  total: number;
  urgent: number;
  stale: number;
  inProcessing: number;
  underReview: number;
};

type TopStuck = {
  id: string;
  client: string;
  formType: string;
  assignedTo: string;
  processingStatus: string;
  daysOld: number;
  daysSinceUpdate: number;
  isUrgent: boolean;
};

type Activity = {
  when: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
};

type DashboardData = {
  generatedAt: string;
  kpis: {
    total: number;
    urgent: number;
    unassigned: number;
    submittedThisMonth: number;
    createdThisWeek: number;
    stuckOver14d: number;
    stuckOver30d: number;
  };
  byStatus: Record<string, number>;
  byStage: Record<string, number>;
  workload: Workload[];
  topStuck: TopStuck[];
  recentActivity: Activity[];
};

export default function AdminDashboardPage({
  apiFetch,
  onOpenCase,
}: {
  apiFetch: (url: string, opts?: any) => Promise<Response>;
  onOpenCase?: (caseId: string) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/admin/dashboard");
      if (!res?.ok) {
        const d = await res?.json().catch(() => ({}));
        setErr(d?.error || `Failed to load (HTTP ${res?.status || "?"})`);
        return;
      }
      const d = await res.json();
      setData(d as DashboardData);
    } catch (e) {
      setErr((e as Error).message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  if (loading && !data) {
    return <div className="p-6 text-sm text-slate-500">Loading admin dashboard…</div>;
  }
  if (err) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      </div>
    );
  }
  if (!data) return null;

  // Sort workload by total cases desc
  const sortedWorkload = [...data.workload].sort((a, b) => b.total - a.total);
  const maxWorkload = Math.max(1, ...sortedWorkload.map((w) => w.total));
  const overloadThreshold = Math.max(10, Math.round(maxWorkload * 0.85));

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">🛡️ Admin Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Last refreshed {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "🔄 Refresh"}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KPICard label="Total cases" value={data.kpis.total} accent="slate" />
        <KPICard label="Urgent" value={data.kpis.urgent} accent="red" />
        <KPICard label="Unassigned" value={data.kpis.unassigned} accent="amber" hint="Need an owner" />
        <KPICard label="New this week" value={data.kpis.createdThisWeek} accent="blue" />
        <KPICard label="Submitted this month" value={data.kpis.submittedThisMonth} accent="emerald" />
        <KPICard label="Stuck >14 days" value={data.kpis.stuckOver14d} accent="amber" />
        <KPICard label="Stuck >30 days" value={data.kpis.stuckOver30d} accent="red" />
      </div>

      {/* Per-staff Workload */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-slate-900">👥 Team workload</h2>
          <span className="text-xs text-slate-500">Sorted by total cases</span>
        </div>
        {sortedWorkload.length === 0 ? (
          <p className="text-xs text-slate-500">No staff users configured. Add team members in Settings.</p>
        ) : (
          <div className="space-y-2">
            {sortedWorkload.map((w) => {
              const overloaded = w.total >= overloadThreshold && w.total >= 10;
              const pct = Math.round((w.total / maxWorkload) * 100);
              return (
                <div key={w.email || w.name} className="flex items-center gap-3">
                  <div className="w-40 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-slate-900 truncate">{w.name}</p>
                      {overloaded && (
                        <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700" title="High workload">
                          ⚠ OVERLOADED
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500">{w.role}</p>
                  </div>
                  <div className="flex-1 h-6 rounded-full bg-slate-100 overflow-hidden relative">
                    <div
                      className={`h-full ${overloaded ? "bg-red-500" : "bg-slate-700"}`}
                      style={{ width: `${pct}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-bold text-white drop-shadow">
                      {w.total}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-600 w-56 justify-end">
                    {w.urgent > 0 && <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">🔴 {w.urgent} urgent</span>}
                    {w.stale > 0 && <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">⏳ {w.stale} stale</span>}
                    {w.underReview > 0 && <span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700">👁 {w.underReview} review</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Status breakdown */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-900 mb-2">📊 By processing status</h3>
          <div className="space-y-1">
            {Object.entries(data.byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between text-xs">
                <span className="text-slate-700">{status}</span>
                <span className="font-bold text-slate-900">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-900 mb-2">📁 By stage</h3>
          <div className="space-y-1">
            {Object.entries(data.byStage).map(([stage, count]) => (
              <div key={stage} className="flex items-center justify-between text-xs">
                <span className="text-slate-700">{stage}</span>
                <span className="font-bold text-slate-900">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Top stuck cases */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-bold text-slate-900 mb-3">⏳ Oldest open cases</h2>
        {data.topStuck.length === 0 ? (
          <p className="text-xs text-slate-500">No stuck cases.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="text-left px-2 py-1.5 font-bold text-slate-600">Case</th>
                <th className="text-left px-2 py-1.5 font-bold text-slate-600">Client</th>
                <th className="text-left px-2 py-1.5 font-bold text-slate-600">Assigned</th>
                <th className="text-left px-2 py-1.5 font-bold text-slate-600">Status</th>
                <th className="text-right px-2 py-1.5 font-bold text-slate-600">Age</th>
                <th className="text-right px-2 py-1.5 font-bold text-slate-600">Last update</th>
              </tr>
            </thead>
            <tbody>
              {data.topStuck.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => onOpenCase && onOpenCase(c.id)}
                >
                  <td className="px-2 py-1.5 font-mono text-[10px] text-slate-600">{c.id}</td>
                  <td className="px-2 py-1.5">
                    <span className="font-semibold text-slate-900">{c.client}</span>
                    {c.isUrgent && <span className="ml-1.5 text-red-600">🔴</span>}
                    <div className="text-[10px] text-slate-500">{c.formType}</div>
                  </td>
                  <td className="px-2 py-1.5 text-slate-700">{c.assignedTo}</td>
                  <td className="px-2 py-1.5 text-slate-700">{c.processingStatus}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-slate-900">{c.daysOld}d</td>
                  <td className="px-2 py-1.5 text-right text-slate-600">{c.daysSinceUpdate}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Recent activity */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-bold text-slate-900 mb-3">📜 Recent activity</h2>
        {data.recentActivity.length === 0 ? (
          <p className="text-xs text-slate-500">No recent audit-log activity.</p>
        ) : (
          <div className="space-y-1.5">
            {data.recentActivity.map((a, i) => (
              <div key={i} className="text-xs text-slate-700 flex gap-2">
                <span className="text-slate-400 whitespace-nowrap">{new Date(a.when).toLocaleString()}</span>
                <span className="font-semibold">{a.actor || "system"}</span>
                <span>·</span>
                <span>{a.action}</span>
                <span className="text-slate-500">on</span>
                <span className="font-mono text-[10px]">{a.resourceId}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function KPICard({
  label,
  value,
  accent = "slate",
  hint,
}: {
  label: string;
  value: number | string;
  accent?: "slate" | "red" | "amber" | "blue" | "emerald";
  hint?: string;
}) {
  const accentClasses: Record<string, string> = {
    slate: "border-slate-200 bg-white",
    red: "border-red-200 bg-red-50",
    amber: "border-amber-200 bg-amber-50",
    blue: "border-blue-200 bg-blue-50",
    emerald: "border-emerald-200 bg-emerald-50",
  };
  return (
    <div className={`rounded-xl border ${accentClasses[accent]} p-3`}>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}
