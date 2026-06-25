"use client";
import { useEffect, useMemo, useState } from "react";
import { TRACKER_STAGES, type TrackerEntry } from "@/lib/models";

const APP_TYPES = ["Express Entry (PR)", "PR Sponsorship", "Other"];

// Stages that mean the file is finished — used to grey the row + offer archive.
const TERMINAL = new Set(["Landed (PR Confirmed)", "PR Card Received", "Refused / Withdrawn"]);

interface Props {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  sessionUser?: { name?: string } | null;
}

export default function TrackingSheet({ apiFetch }: Props) {
  const [rows, setRows] = useState<TrackerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  // add-row state
  const [nAppNo, setNAppNo] = useState("");
  const [nName, setNName] = useState("");
  const [nPhone, setNPhone] = useState("");
  const [nType, setNType] = useState(APP_TYPES[0]);
  const [nStage, setNStage] = useState(TRACKER_STAGES[0]);
  const [nNotes, setNNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function syncEmails() {
    setSyncing(true); setStatus("Reading IRCC emails…");
    try {
      const r = await apiFetch("/admin/tracker-email-sync", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setStatus(`✅ Scanned ${d.emailsScanned ?? 0} emails (${d.irccEmails ?? 0} from IRCC). Advanced ${d.advancedCount ?? 0} file(s).`);
        if ((d.advancedCount ?? 0) > 0) void load();
      } else {
        setStatus(`⚠️ ${d.error || "Sync failed."}`);
      }
    } catch { setStatus("Network error during sync."); }
    finally { setSyncing(false); }
  }

  async function load() {
    setLoading(true);
    try {
      const r = await apiFetch("/tracking");
      const d = await r.json().catch(() => ({}));
      if (r.ok) setRows((d.trackers || []) as TrackerEntry[]);
      else setStatus(d.error || "Could not load tracker.");
    } catch {
      setStatus("Network error loading tracker.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function addRow() {
    if (!nName.trim() && !nAppNo.trim()) { setStatus("Enter a client name or application number."); return; }
    setSaving(true); setStatus("");
    try {
      const r = await apiFetch("/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationNumber: nAppNo, clientName: nName, clientPhone: nPhone, applicationType: nType, stage: nStage, notes: nNotes }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.tracker) {
        setRows((prev) => [d.tracker as TrackerEntry, ...prev]);
        setNAppNo(""); setNName(""); setNPhone(""); setNNotes(""); setNStage(TRACKER_STAGES[0]);
        setStatus("✅ Added.");
      } else setStatus(d.error || "Could not add.");
    } catch { setStatus("Network error."); }
    finally { setSaving(false); }
  }

  async function patchRow(id: string, patch: Partial<TrackerEntry>) {
    // optimistic
    setRows((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } as TrackerEntry : t)));
    try {
      const r = await apiFetch(`/tracking/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.tracker) setRows((prev) => prev.map((t) => (t.id === id ? d.tracker as TrackerEntry : t)));
    } catch { /* keep optimistic */ }
  }

  async function removeRow(id: string, name: string) {
    if (!confirm(`Remove ${name || "this entry"} from the tracker? This cannot be undone.`)) return;
    setRows((prev) => prev.filter((t) => t.id !== id));
    try { await apiFetch(`/tracking/${id}`, { method: "DELETE" }); } catch { /* noop */ }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((t) => {
      if (!showArchived && t.archived) return false;
      if (typeFilter && t.applicationType !== typeFilter) return false;
      if (stageFilter && t.stage !== stageFilter) return false;
      if (q && !(`${t.clientName} ${t.applicationNumber} ${t.notes || ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, typeFilter, stageFilter, showArchived]);

  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.filter((t) => !t.archived).forEach((t) => { m[t.stage] = (m[t.stage] || 0) + 1; });
    return m;
  }, [rows]);

  const daysIn = (iso?: string) => {
    if (!iso) return null;
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return null;
    return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">📋 PR / Express Entry Tracker</h2>
          <p className="text-xs text-slate-500">Post-submission milestone tracking — AOR, biometrics, medical, PPR, landing. Move the stage as IRCC emails arrive.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">{rows.filter(t=>!t.archived).length} active</span>
          <button onClick={() => void syncEmails()} disabled={syncing}
            title="Read IRCC emails from the Newton inbox and auto-advance matching files"
            className="rounded-lg bg-indigo-600 px-2.5 py-1 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {syncing ? "Syncing…" : "✉️ Sync IRCC emails"}
          </button>
          <button onClick={() => void load()} className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-50">↻ Refresh</button>
        </div>
      </div>

      {/* Add row */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
          <input value={nName} onChange={(e)=>setNName(e.target.value)} placeholder="Client name" className="sm:col-span-3 rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none" />
          <input value={nAppNo} onChange={(e)=>setNAppNo(e.target.value)} placeholder="Application / file #" className="sm:col-span-2 rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:border-emerald-400 focus:outline-none" />
          <input value={nPhone} onChange={(e)=>setNPhone(e.target.value)} placeholder="Client phone (for updates)" className="sm:col-span-2 rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:border-emerald-400 focus:outline-none" />
          <select value={nStage} onChange={(e)=>setNStage(e.target.value as any)} className="sm:col-span-3 rounded-xl border-2 border-slate-200 bg-white px-2 py-2 text-sm focus:border-emerald-400 focus:outline-none">
            {TRACKER_STAGES.map((s)=> <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={()=>void addRow()} disabled={saving} className="sm:col-span-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "Adding…" : "+ Add"}
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <select value={nType} onChange={(e)=>setNType(e.target.value)} className="rounded-xl border-2 border-slate-200 bg-white px-2 py-2 text-sm focus:border-emerald-400 focus:outline-none">
            {APP_TYPES.map((t)=> <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={nNotes} onChange={(e)=>setNNotes(e.target.value)} placeholder="Notes (optional)" className="flex-1 rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search name / app # / notes" className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-400 min-w-[220px]" />
        <select value={typeFilter} onChange={(e)=>setTypeFilter(e.target.value)} className="rounded-xl border border-slate-200 px-2 py-1.5 text-sm">
          <option value="">All types</option>
          {APP_TYPES.map((t)=><option key={t} value={t}>{t}</option>)}
        </select>
        <select value={stageFilter} onChange={(e)=>setStageFilter(e.target.value)} className="rounded-xl border border-slate-200 px-2 py-1.5 text-sm">
          <option value="">All stages</option>
          {TRACKER_STAGES.map((s)=><option key={s} value={s}>{s}{stageCounts[s]?` (${stageCounts[s]})`:""}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={showArchived} onChange={(e)=>setShowArchived(e.target.checked)} /> show archived
        </label>
      </div>

      {status && <p className="text-xs font-semibold text-slate-600">{status}</p>}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-bold text-slate-500">
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">App #</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 w-64">Stage</th>
              <th className="px-3 py-2">Days in stage</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">No entries yet. Add one above.</td></tr>
            ) : filtered.map((t) => {
              const d = daysIn(t.stageUpdatedAt);
              const terminal = TERMINAL.has(t.stage);
              return (
                <tr key={t.id} className={`border-t border-slate-100 ${t.archived ? "opacity-50" : ""} ${t.pendingReview ? "bg-indigo-50" : ""}`}>
                  <td className="px-3 py-2 font-semibold text-slate-800">
                    {t.clientName || "—"}
                    {t.pendingReview && (
                      <span title={t.pendingReviewNote || "New IRCC update — check the portal"}
                        className="ml-1 inline-flex items-center gap-1 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white align-middle">
                        📬 update
                        <button onClick={()=>void patchRow(t.id, { pendingReview: false } as any)} title="Mark reviewed" className="hover:text-indigo-200">✓</button>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{t.applicationNumber || "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{t.applicationType}</td>
                  <td className="px-3 py-2">
                    <select value={t.stage} onChange={(e)=>void patchRow(t.id, { stage: e.target.value })}
                      className={`w-full rounded-lg border px-2 py-1.5 text-xs font-semibold focus:outline-none ${
                        t.stage === "Refused / Withdrawn" ? "border-red-300 bg-red-50 text-red-800"
                        : terminal ? "border-green-300 bg-green-50 text-green-800"
                        : "border-amber-300 bg-amber-50 text-amber-900"}`}>
                      {TRACKER_STAGES.map((s)=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className={`px-3 py-2 text-xs ${d!=null && d>30 && !terminal ? "font-bold text-red-600" : "text-slate-500"}`}>{d!=null?`${d}d`:"—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 max-w-[220px]">
                    <input defaultValue={t.notes || ""} placeholder="add note…"
                      onBlur={(e)=>{ if (e.target.value !== (t.notes||"")) void patchRow(t.id, { notes: e.target.value }); }}
                      className="w-full rounded border border-transparent px-1 py-0.5 text-xs hover:border-slate-200 focus:border-emerald-300 focus:outline-none" />
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-400">{(t.updatedAt||"").slice(0,10)}{t.updatedBy?` · ${t.updatedBy}`:""}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={()=>void patchRow(t.id, { archived: !t.archived })} title={t.archived?"Unarchive":"Archive"}
                      className="text-xs text-slate-400 hover:text-slate-700 px-1">{t.archived?"↩":"📦"}</button>
                    <button onClick={()=>void removeRow(t.id, t.clientName)} title="Delete"
                      className="text-xs text-slate-400 hover:text-red-600 px-1">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
