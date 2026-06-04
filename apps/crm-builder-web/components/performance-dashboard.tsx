import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Row = { name: string; role: string; errors: number; flaggedCases: number; casesAssigned: number };

// Monthly team quality dashboard. Ranks preparers by "errors received" — the
// fewer review changes raised on their cases, the cleaner their work. Managers
// open this mid-month to spot and recognise the strongest performer.
export default function PerformanceDashboard() {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<{ month: string; rows: Row[]; totalErrors: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async (mk: string) => {
    setLoading(true); setErr("");
    try {
      const res = await apiFetch(`/admin/performance?month=${encodeURIComponent(mk)}`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) setData(d);
      else setErr(d.error || "Could not load performance.");
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  };
  useEffect(() => { load(month); }, [month]);

  const rows = data?.rows || [];
  // "Best" = a preparer who actually handled cases and has the fewest errors.
  const eligible = rows.filter((r) => r.casesAssigned > 0);
  const best = eligible.length > 0 ? eligible.reduce((a, b) => (a.errors <= b.errors ? a : b)) : null;
  const maxErrors = Math.max(1, ...rows.map((r) => r.errors));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-slate-900 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-white">🏆 Team performance — review quality</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Fewer review changes flagged on a preparer's cases = cleaner work. {data ? `Showing ${data.month}.` : ""}
          </p>
        </div>
        <input
          type="month"
          value={month}
          max={thisMonth}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-xs text-white [color-scheme:dark]"
        />
      </div>

      <div className="p-5 space-y-4">
        {loading ? (
          <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>
        ) : err ? (
          <p className="text-sm text-red-600">{err}</p>
        ) : (
          <>
            {best && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-sm text-emerald-900">
                  🌟 <strong>{best.name}</strong> leads this month — {best.errors} error{best.errors !== 1 ? "s" : ""} across {best.casesAssigned} case{best.casesAssigned !== 1 ? "s" : ""}.
                </p>
              </div>
            )}

            {rows.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No preparers found.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">#</th>
                      <th className="px-3 py-2 font-semibold">Preparer</th>
                      <th className="px-3 py-2 font-semibold">Role</th>
                      <th className="px-3 py-2 font-semibold">Errors received</th>
                      <th className="px-3 py-2 font-semibold">Cases flagged</th>
                      <th className="px-3 py-2 font-semibold">Cases handled</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r, i) => (
                      <tr key={r.name} className={`hover:bg-slate-50 ${best && r.name === best.name ? "bg-emerald-50/50" : ""}`}>
                        <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">
                          {best && r.name === best.name ? "🌟 " : ""}{r.name}
                        </td>
                        <td className="px-3 py-2 text-slate-500">{r.role || "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`font-bold ${r.errors === 0 ? "text-emerald-600" : r.errors >= maxErrors ? "text-red-600" : "text-amber-600"}`}>{r.errors}</span>
                            <div className="h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden">
                              <div className={`h-full ${r.errors === 0 ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `${(r.errors / maxErrors) * 100}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{r.flaggedCases}</td>
                        <td className="px-3 py-2 text-slate-600">{r.casesAssigned}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-slate-400 leading-relaxed">
              An "error" is a review change a reviewer raised on a case, counted against whoever prepared it.
              Read errors alongside cases handled — zero errors on many cases is the real win.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
