"use client";
import { useState, useEffect } from "react";

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  consultation_booked: "Consult Booked",
  consultation_done: "Consult Done",
  converted: "Converted",
  lost: "Lost",
};

const STAGE_COLORS: Record<string, string> = {
  new: "bg-blue-500",
  contacted: "bg-amber-500",
  consultation_booked: "bg-purple-500",
  consultation_done: "bg-indigo-500",
  converted: "bg-emerald-500",
  lost: "bg-slate-400",
};

type Stats = {
  byStage: Record<string, number>;
  bySource: { source: string; count: number }[];
  today: { new_today: number; due_followups: number; converted_today: number; unread_messages: number; inbound_today: number };
  conversionRate: number;
  total: number;
  trend: { day: string; count: number }[];
};

export function MarketingDashboard({ apiFetch, onNavigate }: { apiFetch: any; onNavigate?: (screen: string) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await apiFetch("/marketing-stats");
      const d = await r?.json();
      if (d && !d.error) setStats(d);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, []);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading dashboard...</div>;
  if (!stats) return <div className="p-6 text-sm text-slate-400">Dashboard data unavailable.</div>;

  const maxTrend = Math.max(1, ...stats.trend.map(t => t.count));

  return (
    <div className="p-5 space-y-5 overflow-y-auto h-full bg-slate-50">
      {/* Top stats */}
      <div>
        <h1 className="text-lg font-bold text-slate-900 mb-1">📊 Marketing Dashboard</h1>
        <p className="text-xs text-slate-500 mb-4">Lead pipeline & inquiry overview</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard icon="🆕" label="New today" value={stats.today.new_today} accent="blue" onClick={() => onNavigate?.("marketing-leads")} />
          <StatCard icon="📩" label="Inbound today" value={stats.today.inbound_today} accent="purple" onClick={() => onNavigate?.("marketing-inbox")} />
          <StatCard icon="🔴" label="Unread" value={stats.today.unread_messages} accent="red" onClick={() => onNavigate?.("marketing-inbox")} />
          <StatCard icon="⏰" label="Follow-ups due" value={stats.today.due_followups} accent="amber" onClick={() => onNavigate?.("marketing-leads")} />
          <StatCard icon="✅" label="Converted today" value={stats.today.converted_today} accent="emerald" onClick={() => onNavigate?.("cases")} />
        </div>
      </div>

      {/* Pipeline + sources */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Pipeline */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900">Pipeline</h2>
            <span className="text-xs text-slate-500">{stats.total} total · {stats.conversionRate}% conv.</span>
          </div>
          <div className="space-y-2">
            {Object.entries(stats.byStage).map(([stage, count]) => {
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
              return (
                <div key={stage}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="font-medium text-slate-700">{STAGE_LABELS[stage] || stage}</span>
                    <span className="text-slate-500">{count}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${STAGE_COLORS[stage] || "bg-slate-400"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sources */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Lead sources</h2>
          {stats.bySource.length === 0 ? (
            <p className="text-xs text-slate-400">No source data yet</p>
          ) : (
            <div className="space-y-1.5">
              {stats.bySource.map(({ source, count }) => {
                const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
                return (
                  <div key={source} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-700 w-24 truncate capitalize">{source.replace("_", " ")}</span>
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500" style={{ width: `${Math.max(pct, 2)}%` }} />
                    </div>
                    <span className="text-xs text-slate-500 w-8 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Trend chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-sm font-bold text-slate-900 mb-3">New leads · last 14 days</h2>
        {stats.trend.length === 0 ? (
          <p className="text-xs text-slate-400">No data yet</p>
        ) : (
          <div className="flex items-end gap-1 h-24">
            {stats.trend.map(t => {
              const h = (t.count / maxTrend) * 100;
              const date = new Date(t.day).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
              return (
                <div key={t.day} className="flex-1 flex flex-col items-center gap-1" title={`${date}: ${t.count}`}>
                  <div className="w-full bg-purple-500 rounded-t hover:bg-purple-700 transition-colors" style={{ height: `${Math.max(h, 4)}%` }} />
                  <span className="text-[9px] text-slate-400">{date}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, accent, onClick }: { icon: string; label: string; value: number; accent: string; onClick?: () => void }) {
  const accentColors: Record<string, string> = {
    blue: "border-blue-200 bg-blue-50",
    purple: "border-purple-200 bg-purple-50",
    red: "border-red-200 bg-red-50",
    amber: "border-amber-200 bg-amber-50",
    emerald: "border-emerald-200 bg-emerald-50",
  };
  return (
    <button onClick={onClick}
      className={`text-left rounded-xl border ${accentColors[accent] || "border-slate-200 bg-white"} p-3 hover:shadow-sm transition-shadow ${onClick ? "cursor-pointer" : ""}`}>
      <div className="text-lg mb-0.5">{icon}</div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">{label}</div>
    </button>
  );
}
