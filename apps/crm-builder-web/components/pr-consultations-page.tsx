"use client";

import { useEffect, useMemo, useState } from "react";

interface PrConsultationRow {
  id: string;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  paymentAmount: number;
  paymentReceived?: boolean;
  paymentMethod?: string;
  consultationDate: string;
  consultant?: string;
  status: "pending" | "done";
  notes?: string;
  updatedAt: string;
}

export default function PrConsultationsPage({
  apiFetch,
  team,
}: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  team: string[];
}) {
  const [rows, setRows] = useState<PrConsultationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "done">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<PrConsultationRow>>({});
  const [adding, setAdding] = useState(false);

  // Form for new row
  const [newRow, setNewRow] = useState<Partial<PrConsultationRow>>({
    clientName: "",
    clientPhone: "",
    paymentAmount: 0,
    paymentReceived: true,
    paymentMethod: "",
    consultationDate: new Date().toISOString().slice(0, 10),
    consultant: "",
    status: "pending",
    notes: "",
  });

  async function refresh() {
    setLoading(true);
    try {
      const res = await apiFetch("/pr-consultations");
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
      const blob = `${r.clientName} ${r.clientPhone || ""} ${r.consultant || ""} ${r.notes || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search, statusFilter]);

  // Stats banner — totals
  const stats = useMemo(() => {
    const total = rows.length;
    const pending = rows.filter((r) => r.status === "pending").length;
    const done = rows.filter((r) => r.status === "done").length;
    const totalRevenue = rows.reduce((s, r) => s + Number(r.paymentAmount || 0), 0);
    const collected = rows.filter((r) => r.paymentReceived).reduce((s, r) => s + Number(r.paymentAmount || 0), 0);
    // This month
    const monthPrefix = new Date().toISOString().slice(0, 7);
    const thisMonth = rows.filter((r) => (r.consultationDate || "").startsWith(monthPrefix));
    const thisMonthRevenue = thisMonth.reduce((s, r) => s + Number(r.paymentAmount || 0), 0);
    return { total, pending, done, totalRevenue, collected, thisMonth: thisMonth.length, thisMonthRevenue };
  }, [rows]);

  async function addRow() {
    if (!newRow.clientName?.trim()) {
      alert("Client name is required");
      return;
    }
    setAdding(true);
    try {
      const res = await apiFetch("/pr-consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRow),
      });
      const data = await res.json().catch(() => ({}));
      if (data.entry) {
        setRows((prev) => [data.entry, ...prev]);
        setNewRow({
          clientName: "",
          clientPhone: "",
          paymentAmount: 0,
          paymentReceived: true,
          paymentMethod: "",
          consultationDate: new Date().toISOString().slice(0, 10),
          consultant: "",
          status: "pending",
          notes: "",
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
      const res = await apiFetch(`/pr-consultations/${id}`, {
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

  async function toggleStatus(row: PrConsultationRow) {
    const newStatus = row.status === "done" ? "pending" : "done";
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: newStatus } : r)));
    try {
      await apiFetch(`/pr-consultations/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch { /* ignore */ }
  }

  async function togglePayment(row: PrConsultationRow) {
    const newPaid = !row.paymentReceived;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, paymentReceived: newPaid } : r)));
    try {
      await apiFetch(`/pr-consultations/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentReceived: newPaid }),
      });
    } catch { /* ignore */ }
  }

  async function deleteRow(id: string) {
    if (!confirm("Delete this consultation? This cannot be undone.")) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await apiFetch(`/pr-consultations/${id}`, { method: "DELETE" });
    } catch { /* ignore */ }
  }

  function exportCsv() {
    const headers = ["Client", "Phone", "Email", "Payment", "Paid?", "Method", "Date", "Consultant", "Status", "Notes"];
    const lines = [headers.join(",")];
    for (const r of filteredRows) {
      const escape = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      lines.push([
        r.clientName, r.clientPhone || "", r.clientEmail || "",
        String(r.paymentAmount || 0), r.paymentReceived ? "Yes" : "No",
        r.paymentMethod || "", r.consultationDate, r.consultant || "",
        r.status, r.notes || ""
      ].map(escape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pr-consultations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">PR Consultation</h2>
          <p className="text-sm text-slate-500 mt-0.5">Track Permanent Residency consultations · payments · consultants</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{filteredRows.length} of {rows.length}</span>
          <button onClick={exportCsv} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Stats banner */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Pending</p>
          <p className="text-2xl font-bold text-amber-800 mt-1">{stats.pending}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Completed</p>
          <p className="text-2xl font-bold text-emerald-800 mt-1">{stats.done}</p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Collected</p>
          <p className="text-xl font-bold text-blue-800 mt-1">${stats.collected.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">This Month</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{stats.thisMonth} <span className="text-sm font-medium text-slate-500">· ${stats.thisMonthRevenue.toLocaleString()}</span></p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search by client, phone, consultant..."
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
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">+ New Consultation</p>
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          <input
            value={newRow.clientName || ""}
            onChange={(e) => setNewRow({ ...newRow, clientName: e.target.value })}
            placeholder="Client name *"
            className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          />
          <input
            value={newRow.clientPhone || ""}
            onChange={(e) => setNewRow({ ...newRow, clientPhone: e.target.value })}
            placeholder="Phone"
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          />
          <input
            type="number"
            value={newRow.paymentAmount || ""}
            onChange={(e) => setNewRow({ ...newRow, paymentAmount: Number(e.target.value) })}
            placeholder="Payment $"
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          />
          <input
            type="date"
            value={newRow.consultationDate || ""}
            onChange={(e) => setNewRow({ ...newRow, consultationDate: e.target.value })}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          />
          <select
            value={newRow.consultant || ""}
            onChange={(e) => setNewRow({ ...newRow, consultant: e.target.value })}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          >
            <option value="">Consultant</option>
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
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={newRow.paymentMethod || ""}
            onChange={(e) => setNewRow({ ...newRow, paymentMethod: e.target.value })}
            placeholder="Payment method (e-transfer, cash, card...)"
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          />
          <input
            value={newRow.notes || ""}
            onChange={(e) => setNewRow({ ...newRow, notes: e.target.value })}
            placeholder="Notes (optional)"
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-blue-300 focus:bg-white focus:outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left">Status</th>
                <th className="px-3 py-2.5 text-left">Client</th>
                <th className="px-3 py-2.5 text-left">Phone</th>
                <th className="px-3 py-2.5 text-right">Payment</th>
                <th className="px-3 py-2.5 text-left">Date</th>
                <th className="px-3 py-2.5 text-left">Consultant</th>
                <th className="px-3 py-2.5 text-left">Notes</th>
                <th className="px-3 py-2.5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-8 text-slate-400">Loading…</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12">
                  <p className="text-slate-400 text-sm">No consultations yet — add your first above ↑</p>
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
                        <p className="font-semibold text-slate-900">{row.clientName || "—"}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {isEditing ? (
                        <input value={editValues.clientPhone ?? row.clientPhone ?? ""} onChange={(e) => setEditValues({ ...editValues, clientPhone: e.target.value })} className="w-full rounded border border-slate-200 px-2 py-1 text-xs" />
                      ) : row.clientPhone ? (
                        <a href={`https://wa.me/${row.clientPhone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{row.clientPhone}</a>
                      ) : <p className="text-slate-300">—</p>}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      {isEditing ? (
                        <input type="number" value={editValues.paymentAmount ?? row.paymentAmount ?? 0} onChange={(e) => setEditValues({ ...editValues, paymentAmount: Number(e.target.value) })} className="w-20 rounded border border-slate-200 px-2 py-1 text-xs text-right" />
                      ) : (
                        <button onClick={() => togglePayment(row)} className="text-right">
                          <p className={`font-bold ${row.paymentReceived ? "text-emerald-700" : "text-slate-400"}`}>
                            ${Number(row.paymentAmount || 0).toLocaleString()}
                          </p>
                          <p className="text-[9px] mt-0.5">
                            {row.paymentReceived ? "✓ Received" : "Click if received"}
                          </p>
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {isEditing ? (
                        <input type="date" value={editValues.consultationDate ?? row.consultationDate} onChange={(e) => setEditValues({ ...editValues, consultationDate: e.target.value })} className="rounded border border-slate-200 px-2 py-1 text-xs" />
                      ) : (
                        <p className="text-slate-600">{row.consultationDate || "—"}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {isEditing ? (
                        <select value={editValues.consultant ?? row.consultant ?? ""} onChange={(e) => setEditValues({ ...editValues, consultant: e.target.value })} className="rounded border border-slate-200 px-2 py-1 text-xs">
                          <option value="">—</option>
                          {team.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      ) : (
                        <p className="text-slate-600">{row.consultant || "—"}</p>
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
