"use client";

import { useEffect, useMemo, useState } from "react";

interface SubmissionRow {
  id: string;
  caseId?: string | null;
  clientName: string;
  clientPhone?: string;
  appType: string;
  submittedDate: string;
  irccReference?: string;
  status: "submitted" | "aor_received" | "decision_pending" | "approved" | "refused";
  notes?: string;
  submittedBy?: string;
  updatedAt: string;
}

interface CaseSuggestion {
  id: string;
  client: string;
  formType: string;
  leadPhone?: string;
}

const STATUS_LABELS: Record<SubmissionRow["status"], string> = {
  submitted: "Submitted",
  aor_received: "AOR Received",
  decision_pending: "Decision Pending",
  approved: "Approved",
  refused: "Refused",
};

const STATUS_COLORS: Record<SubmissionRow["status"], string> = {
  submitted: "bg-blue-100 text-blue-800",
  aor_received: "bg-cyan-100 text-cyan-800",
  decision_pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  refused: "bg-red-100 text-red-800",
};

// Format any phone input → +1 604-722-4151 style
// Handles: "6047224151", "604.722.4151", "(604) 722-4151", "+1 604 722 4151", "16047224151"
function formatPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  // 10 digits: assume NA
  if (digits.length === 10) return `+1 ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  // 11 digits starting with 1: NA with country code
  if (digits.length === 11 && digits.startsWith("1")) return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  // Otherwise: keep raw with +
  return `+${digits}`;
}

export default function SubmissionLogPage({
  apiFetch,
  cases,
  team,
  currentUser,
}: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  cases: CaseSuggestion[];
  team: string[];
  currentUser?: string;
}) {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SubmissionRow["status"]>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<SubmissionRow>>({});
  const [adding, setAdding] = useState(false);
  const [showClientSuggest, setShowClientSuggest] = useState(false);

  const [newRow, setNewRow] = useState<Partial<SubmissionRow>>({
    clientName: "",
    clientPhone: "",
    appType: "",
    submittedDate: new Date().toISOString().slice(0, 10),
    irccReference: "",
    status: "submitted",
    notes: "",
    submittedBy: currentUser || "",
  });

  async function refresh() {
    setLoading(true);
    try {
      const res = await apiFetch("/submissions");
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
      const blob = `${r.clientName} ${r.clientPhone || ""} ${r.appType} ${r.irccReference || ""} ${r.notes || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search, statusFilter]);

  const stats = useMemo(() => ({
    total: rows.length,
    submitted: rows.filter((r) => r.status === "submitted").length,
    pending: rows.filter((r) => r.status === "aor_received" || r.status === "decision_pending").length,
    approved: rows.filter((r) => r.status === "approved").length,
    refused: rows.filter((r) => r.status === "refused").length,
  }), [rows]);

  // Client autocomplete from cases
  const clientSuggestions = useMemo(() => {
    const q = (newRow.clientName || "").trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return cases.filter((c) => c.client?.toLowerCase().includes(q)).slice(0, 6);
  }, [newRow.clientName, cases]);

  async function addRow() {
    if (!newRow.clientName?.trim()) {
      alert("Client name is required");
      return;
    }
    setAdding(true);
    try {
      // Apply phone formatting before save
      const payload = { ...newRow, clientPhone: formatPhone(newRow.clientPhone || "") };
      const res = await apiFetch("/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (data.entry) {
        setRows((prev) => [data.entry, ...prev]);
        setNewRow({
          clientName: "",
          clientPhone: "",
          appType: "",
          submittedDate: new Date().toISOString().slice(0, 10),
          irccReference: "",
          status: "submitted",
          notes: "",
          submittedBy: currentUser || "",
        });
      }
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit(id: string) {
    const patch = { ...editValues };
    // Apply phone formatting if phone is being edited
    if (patch.clientPhone !== undefined) patch.clientPhone = formatPhone(patch.clientPhone);
    setEditingId(null);
    setEditValues({});
    try {
      const res = await apiFetch(`/submissions/${id}`, {
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

  async function changeStatus(row: SubmissionRow, newStatus: SubmissionRow["status"]) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: newStatus } : r)));
    try {
      await apiFetch(`/submissions/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch { /* ignore */ }
  }

  async function deleteRow(id: string) {
    if (!confirm("Delete this submission record? This cannot be undone.")) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await apiFetch(`/submissions/${id}`, { method: "DELETE" });
    } catch { /* ignore */ }
  }

  function exportCsv() {
    const headers = ["Client", "Phone", "App Type", "Submitted Date", "IRCC Reference", "Status", "Submitted By", "Notes"];
    const lines = [headers.join(",")];
    for (const r of filteredRows) {
      const escape = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      lines.push([
        r.clientName, r.clientPhone || "", r.appType, r.submittedDate,
        r.irccReference || "", STATUS_LABELS[r.status], r.submittedBy || "", r.notes || ""
      ].map(escape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `submissions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">📋 Submission Log</h3>
          <p className="text-xs text-slate-500 mt-0.5">All cases submitted to IRCC · auto-tracked + manual entries</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{filteredRows.length} of {rows.length}</span>
          <button onClick={exportCsv} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Stats banner */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="rounded-lg border border-slate-200 bg-white p-2.5">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Total</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{stats.total}</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5">
          <p className="text-[9px] font-bold uppercase tracking-wide text-blue-700">Just Submitted</p>
          <p className="text-xl font-bold text-blue-800 mt-0.5">{stats.submitted}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <p className="text-[9px] font-bold uppercase tracking-wide text-amber-700">In Progress</p>
          <p className="text-xl font-bold text-amber-800 mt-0.5">{stats.pending}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
          <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-700">Approved</p>
          <p className="text-xl font-bold text-emerald-800 mt-0.5">{stats.approved}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5">
          <p className="text-[9px] font-bold uppercase tracking-wide text-red-700">Refused</p>
          <p className="text-xl font-bold text-red-800 mt-0.5">{stats.refused}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search by client, phone, reference, app type..."
          className="flex-1 min-w-[240px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:outline-none"
        >
          <option value="all">All status</option>
          <option value="submitted">Submitted</option>
          <option value="aor_received">AOR Received</option>
          <option value="decision_pending">Decision Pending</option>
          <option value="approved">Approved</option>
          <option value="refused">Refused</option>
        </select>
      </div>

      {/* Add new row */}
      <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">+ Add Manual Entry</p>
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          <div className="md:col-span-2 relative">
            <input
              value={newRow.clientName || ""}
              onChange={(e) => { setNewRow({ ...newRow, clientName: e.target.value }); setShowClientSuggest(true); }}
              onFocus={() => setShowClientSuggest(true)}
              onBlur={() => setTimeout(() => setShowClientSuggest(false), 200)}
              placeholder="Client name *"
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-blue-300 focus:outline-none"
            />
            {showClientSuggest && clientSuggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto">
                {clientSuggestions.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setNewRow({
                        ...newRow,
                        clientName: c.client,
                        clientPhone: formatPhone(c.leadPhone || ""),
                        appType: c.formType,
                      });
                      setShowClientSuggest(false);
                    }}
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
            value={newRow.clientPhone || ""}
            onChange={(e) => setNewRow({ ...newRow, clientPhone: e.target.value })}
            onBlur={(e) => setNewRow({ ...newRow, clientPhone: formatPhone(e.target.value) })}
            placeholder="Phone (auto-format)"
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-blue-300 focus:outline-none"
          />
          <input
            value={newRow.appType || ""}
            onChange={(e) => setNewRow({ ...newRow, appType: e.target.value })}
            placeholder="App type"
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-blue-300 focus:outline-none"
          />
          <input
            type="date"
            value={newRow.submittedDate || ""}
            onChange={(e) => setNewRow({ ...newRow, submittedDate: e.target.value })}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-blue-300 focus:outline-none"
          />
          <input
            value={newRow.irccReference || ""}
            onChange={(e) => setNewRow({ ...newRow, irccReference: e.target.value })}
            placeholder="IRCC ref #"
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-blue-300 focus:outline-none"
          />
          <button
            onClick={addRow}
            disabled={adding}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {adding ? "…" : "+ Add"}
          </button>
        </div>
        <input
          value={newRow.notes || ""}
          onChange={(e) => setNewRow({ ...newRow, notes: e.target.value })}
          placeholder="Notes (optional)"
          className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-blue-300 focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">App Type</th>
                <th className="px-3 py-2 text-left">Submitted</th>
                <th className="px-3 py-2 text-left">IRCC Ref</th>
                <th className="px-3 py-2 text-left">Notes</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-6 text-slate-400">Loading…</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10">
                  <p className="text-slate-400 text-sm">No submissions yet — they'll appear here when cases are submitted, or you can add manually above ↑</p>
                </td></tr>
              ) : filteredRows.map((row) => {
                const isEditing = editingId === row.id;
                return (
                  <tr key={row.id} className={`hover:bg-slate-50 ${isEditing ? "bg-blue-50/30" : ""}`}>
                    <td className="px-3 py-2 align-top">
                      <select
                        value={row.status}
                        onChange={(e) => changeStatus(row, e.target.value as any)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold border-0 focus:outline-none cursor-pointer ${STATUS_COLORS[row.status]}`}
                      >
                        {(["submitted", "aor_received", "decision_pending", "approved", "refused"] as const).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
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
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {isEditing ? (
                        <input
                          value={editValues.clientPhone ?? row.clientPhone ?? ""}
                          onChange={(e) => setEditValues({ ...editValues, clientPhone: e.target.value })}
                          onBlur={(e) => setEditValues({ ...editValues, clientPhone: formatPhone(e.target.value) })}
                          className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                        />
                      ) : row.clientPhone ? (
                        <a href={`https://wa.me/${row.clientPhone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{row.clientPhone}</a>
                      ) : <p className="text-slate-300">—</p>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {isEditing ? (
                        <input value={editValues.appType ?? row.appType} onChange={(e) => setEditValues({ ...editValues, appType: e.target.value })} className="w-full rounded border border-slate-200 px-2 py-1 text-xs" />
                      ) : (
                        <p className="text-slate-700">{row.appType || "—"}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {isEditing ? (
                        <input type="date" value={editValues.submittedDate ?? row.submittedDate} onChange={(e) => setEditValues({ ...editValues, submittedDate: e.target.value })} className="rounded border border-slate-200 px-2 py-1 text-xs" />
                      ) : (
                        <p className="text-slate-600">{row.submittedDate || "—"}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {isEditing ? (
                        <input value={editValues.irccReference ?? row.irccReference ?? ""} onChange={(e) => setEditValues({ ...editValues, irccReference: e.target.value })} className="w-full rounded border border-slate-200 px-2 py-1 text-xs font-mono" />
                      ) : (
                        <p className="text-slate-600 font-mono text-[11px]">{row.irccReference || "—"}</p>
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
