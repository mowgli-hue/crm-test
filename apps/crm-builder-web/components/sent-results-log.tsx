import { useEffect, useState } from "react";
import { apiFetch, apiUrl } from "@/lib/api-client";

type Row = {
  id: string; caseId?: string; clientName?: string; firstName?: string;
  phone?: string; email?: string; appNumber?: string; resultType?: string;
  serviceSlug?: string; shareUrl?: string; templateName?: string;
  delivered: boolean; deliveryError?: string; sentBy?: string; createdAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  approval: "Approval", refusal: "Refusal", submission: "Submission",
  request_letter: "Request/letter", passport_request: "Passport request",
  biometrics: "Biometrics", medical: "Medical", aor: "AOR",
  additional_docs: "Additional docs", other: "Other",
};

// Record of every result/submission/letter sent to a client over WhatsApp,
// captured at send time so there's a trail even before the client replies.
export default function SentResultsLog() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/results/sent-log");
      const d = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(d.rows)) setRows(d.rows);
    } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const hay = `${r.clientName || ""} ${r.phone || ""} ${r.appNumber || ""} ${r.resultType || ""} ${r.sentBy || ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  const fmtDate = (s: string) => {
    try { return new Date(s).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return s; }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-slate-900 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-white">📤 Sent results &amp; submissions</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Every result / submission / letter sent to a client — logged the moment it goes out, phone and all.
          </p>
        </div>
        <a
          href={apiUrl("/results/sent-log?format=csv")}
          className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20 whitespace-nowrap"
        >
          ⬇ Download CSV
        </a>
      </div>

      <div className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, phone, app number…"
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-slate-400 focus:bg-white focus:outline-none"
          />
          <button onClick={load} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">{rows.length === 0 ? "No sends logged yet." : "No matches."}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Sent</th>
                  <th className="px-3 py-2 font-semibold">Client</th>
                  <th className="px-3 py-2 font-semibold">Phone</th>
                  <th className="px-3 py-2 font-semibold">App #</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Delivered</th>
                  <th className="px-3 py-2 font-semibold">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{r.clientName || "—"}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.phone ? `+${r.phone}` : "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{r.appNumber || "—"}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                        {TYPE_LABEL[r.resultType || ""] || r.resultType || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {r.delivered
                        ? <span className="text-emerald-600 font-semibold">✓ yes</span>
                        : <span className="text-amber-600 font-semibold" title={r.deliveryError || ""}>⚠ no</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.sentBy || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <p className="text-[11px] text-slate-400">{filtered.length} of {rows.length} sends shown.</p>
        )}
      </div>
    </div>
  );
}
