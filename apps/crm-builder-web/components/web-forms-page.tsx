"use client";

import { useEffect, useMemo, useState } from "react";

interface WebFormRow {
  id: string;
  clientName: string;
  caseId?: string | null;
  formType: string;
  dateSubmitted: string;
  status: "pending" | "done";
  link?: string;
  assignedTo?: string;
  notes?: string;
  updatedAt: string;
}

interface CaseSuggestion {
  id: string;
  client: string;
  formType: string;
}

export default function WebFormsPage({
  apiFetch,
  cases,
  team,
}: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  cases: CaseSuggestion[];
  team: string[];
}) {
  const [rows, setRows] = useState<WebFormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "done">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<WebFormRow>>({});
  const [showClientSuggest, setShowClientSuggest] = useState(false);
  const [adding, setAdding] = useState(false);

  // Form for new row
  const [newRow, setNewRow] = useState<Partial<WebFormRow>>({
    clientName: "",
    formType: "GCMS Notes",
    dateSubmitted: new Date().toISOString().slice(0, 10),
    status: "pending",
    link: "",
    assignedTo: "",
    notes: "",
    caseId: null,
  });

  async function refresh() {
    setLoading(true);
    try {
      const res = await apiFetch("/web-forms");
      const data = await res.json().catch(() => ({ rows: [] }));
      setRows(data.rows || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      const blob = `${r.clientName} ${r.formType} ${r.notes || ""} ${r.assignedTo || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search, statusFilter]);

  async function addRow() {
    if (!newRow.clientName?.trim() && !newRow.formType?.trim()) return;
    setAdding(true);
    try {
      const res = await apiFetch("/web-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRow),
      });
      const data = await res.json().catch(() => ({}));
      if (data.entry) {
        setRows((prev) => [data.entry, ...prev]);
        setNewRow({
          clientName: "",
          formType: "GCMS Notes",
          dateSubmitted: new Date().toISOString().slice(0, 10),
          status: "pending",
          link: "",
          assignedTo: "",
          notes: "",
          caseId: null,
        });
      }
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit(id: string) {
    const patch = editValues;
    setEditingId(null);
    setEditValues({});
    try {
      const res = await apiFetch(`/web-forms/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (data.entry) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...data.entry } : r)));
      }
    } catch { /* ignore */ }
  }

  async function toggleStatus(row: WebFormRow) {
    const newStatus = row.status === "done" ? "pending" : "done";
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: newStatus } : r)));
    try {
      await apiFetch(`/web-forms/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch { /* revert on error */ }
  }

  async function deleteRow(id: string) {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await apiFetch(`/web-forms/${id}`, { method: "DELETE" });
    } catch { /* ignore */ }
  }

  function exportCsv() {
    const headers = ["Client", "Form/Type", "Case ID", "Date Submitted", "Status", "Link", "Assigned To", "Notes"];
    const lines = [headers.join(",")];
    for (const r of filteredRows) {
      const escape = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      lines.push([r.clientName, r.formType, r.caseId || "", r.dateSubmitted, r.status, r.link || "", r.assignedTo || "", r.notes || ""].map(escape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `web-forms-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Client name autocomplete from cases
  const clientSuggestions = useMemo(() => {
    const q = (newRow.clientName || "").trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return cases
      .filter((c) => c.client?.toLowerCase().includes(q))
      .slice(0, 6);
  }, [newRow.clientName, cases]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Web Forms & Reconsiderations</h2>
          <p className="text-sm text-slate-500 mt-0.5">Track GCMS notes requests, status updates, and reconsideration submissions</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{filteredRows.length} of {rows.length}</span>
          <button onClick={exportCsv} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search by client, type, notes..."
          className="flex-1 min-w-[240px] rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-2.5 text-sm focus:border-blue-300 focus:bg-white focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-300 focus:outline-none"
        >
          <option value="all">All status</option>
          <option value="pending">Pending</option>
          <option value="done">Done</option>
        </select>
      </div>

      {/* Add new row */}
      <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">+ New Entry</p>
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          <div className="md:col-span-2 relative">
            <input
              value={newRow.clientName || ""}
              onChange={(e) => { setNewRow({ ...newRow, clientName: e.target.value }); setShowClientSuggest(true); }}
              onFocus={() => setShowClientSuggest(true)}
              onBlur={() => setTimeout(() => setShowClientSuggest(false), 200)}
              placeholder="Client name (or new)"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
            />
            {showClientSuggest && clientSuggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                {clientSuggestions.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setNewRow({ ...newRow, clientName: c.client, caseId: c.id }); setShowClientSuggest(false); }}
                    className="block w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0"
                  >
                    <p className="font-semibold text-slate-900">{c.client}</p>
                    <p className="text-[10px] text-slate-500">{c.id} · {c.formType}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            value={newRow.formType || ""}
            onChange={(e) => setNewRow({ ...newRow, formType: e.target.value })}
            placeholder="Type"
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          />
          <input
            type="date"
            value={newRow.dateSubmitted || ""}
            onChange={(e) => setNewRow({ ...newRow, dateSubmitted: e.target.value })}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          />
          <input
            value={newRow.link || ""}
            onChange={(e) => setNewRow({ ...newRow, link: e.target.value })}
            placeholder="Reference link"
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          />
          <select
            value={newRow.assignedTo || ""}
            onChange={(e) => setNewRow({ ...newRow, assignedTo: e.target.value })}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          >
            <option value="">Unassigned</option>
            {team.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button
            onClick={addRow}
            disabled={adding}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {adding ? "Adding…" : "+ Add"}
          </button>
        </div>
        <input
          value={newRow.notes || ""}
          onChange={(e) => setNewRow({ ...newRow, notes: e.target.value })}
          placeholder="Notes (optional)"
          className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left">Status</th>
                <th className="px-3 py-2.5 text-left">Client</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-left">Submitted</th>
                <th className="px-3 py-2.5 text-left">Reference</th>
                <th className="px-3 py-2.5 text-left">Assigned</th>
                <th className="px-3 py-2.5 text-left">Notes</th>
                <th className="px-3 py-2.5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400">Loading…</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12">
                  <p className="text-slate-400 text-sm">No entries yet — add your first above ↑</p>
                </td></tr>
              ) : filteredRows.map((row) => {
                const isEditing = editingId === row.id;
                return (
                  <tr key={row.id} className={`hover:bg-slate-50 ${isEditing ? "bg-blue-50/30" : ""}`}>
                    <td className="px-3 py-2 align-top">
                      <button
                        onClick={() => toggleStatus(row)}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          row.status === "done"
                            ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                            : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                        }`}
                      >
                        {row.status === "done" ? "✓ Done" : "⏳ Pending"}
                      </button>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {isEditing ? (
                        <input value={editValues.clientName ?? row.clientName} onChange={(e) => setEditValues({ ...editValues, clientName: e.target.value })} className="w-full rounded border border-slate-200 px-2 py-1 text-xs" />
                      ) : (
                        <div>
                          <p className="font-semibold text-slate-900">{row.clientName || "—"}</p>
                          {row.caseId && <p className="text-[10px] text-blue-600">{row.caseId}</p>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {isEditing ? (
                        <input value={editValues.formType ?? row.formType} onChange={(e) => setEditValues({ ...editValues, formType: e.target.value })} className="w-full rounded border border-slate-200 px-2 py-1 text-xs" />
                      ) : (
                        <p className="text-slate-700">{row.formType || "—"}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {isEditing ? (
                        <input type="date" value={editValues.dateSubmitted ?? row.dateSubmitted} onChange={(e) => setEditValues({ ...editValues, dateSubmitted: e.target.value })} className="rounded border border-slate-200 px-2 py-1 text-xs" />
                      ) : (
                        <p className="text-slate-600">{row.dateSubmitted || "—"}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {isEditing ? (
                        <input value={editValues.link ?? row.link ?? ""} onChange={(e) => setEditValues({ ...editValues, link: e.target.value })} placeholder="Link" className="w-full rounded border border-slate-200 px-2 py-1 text-xs" />
                      ) : row.link ? (
                        <a href={row.link} target="_blank" rel="noreferrer" className="text-blue-600 underline truncate inline-block max-w-[160px]">{row.link.replace(/^https?:\/\//, "").slice(0, 30)}…</a>
                      ) : <p className="text-slate-300">—</p>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {isEditing ? (
                        <select value={editValues.assignedTo ?? row.assignedTo ?? ""} onChange={(e) => setEditValues({ ...editValues, assignedTo: e.target.value })} className="rounded border border-slate-200 px-2 py-1 text-xs">
                          <option value="">Unassigned</option>
                          {team.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      ) : (
                        <p className="text-slate-600">{row.assignedTo || "—"}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top max-w-[260px]">
                      {isEditing ? (
                        <input value={editValues.notes ?? row.notes ?? ""} onChange={(e) => setEditValues({ ...editValues, notes: e.target.value })} placeholder="Notes" className="w-full rounded border border-slate-200 px-2 py-1 text-xs" />
                      ) : (
                        <p className="text-slate-600 truncate">{row.notes || "—"}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => saveEdit(row.id)} className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700">Save</button>
                          <button onClick={() => { setEditingId(null); setEditValues({}); }} className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => { setEditingId(row.id); setEditValues({}); }} className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50">Edit</button>
                          <button onClick={() => deleteRow(row.id)} className="rounded border border-red-200 px-2 py-1 text-[10px] text-red-600 hover:bg-red-50">Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
