"use client";
import { useState, useEffect, useMemo } from "react";

const STAGES: { id: string; label: string; color: string; bgLight: string }[] = [
  { id: "new", label: "New", color: "bg-blue-100 text-blue-700 border-blue-200", bgLight: "bg-blue-50" },
  { id: "contacted", label: "Contacted", color: "bg-amber-100 text-amber-700 border-amber-200", bgLight: "bg-amber-50" },
  { id: "consultation_booked", label: "Consult Booked", color: "bg-purple-100 text-purple-700 border-purple-200", bgLight: "bg-purple-50" },
  { id: "consultation_done", label: "Consult Done", color: "bg-indigo-100 text-indigo-700 border-indigo-200", bgLight: "bg-indigo-50" },
  { id: "converted", label: "Converted", color: "bg-emerald-100 text-emerald-700 border-emerald-200", bgLight: "bg-emerald-50" },
  { id: "lost", label: "Lost", color: "bg-slate-100 text-slate-500 border-slate-200", bgLight: "bg-slate-50" },
];

const SOURCES = ["whatsapp", "facebook", "instagram", "tiktok", "referral", "walk_in", "google", "website", "other"];

const FORM_TYPES = [
  "PGWP", "SOWP", "BOWP", "VOWP", "Study Permit", "Study Permit Extension",
  "Visitor Visa", "TRV Inside", "Visitor Record", "Super Visa",
  "Spousal Sponsorship", "Family Sponsorship", "Express Entry", "PR",
  "PR Card Renewal", "Citizenship", "LMIA Work Permit", "Work Permit",
];

type Lead = {
  phone: string;
  contact_name: string | null;
  stage: string;
  source: string | null;
  service_interest: string | null;
  tags: string[] | null;
  notes: string | null;
  assigned_to: string | null;
  next_follow_up: string | null;
  consultation_paid: boolean;
  converted_case_id: string | null;
  ai_enabled: boolean;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
};

export function MarketingLeads({ sessionUser, apiFetch }: { sessionUser: any; apiFetch: any }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<string>("");
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Lead>>({});
  const [convertingPhone, setConvertingPhone] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState<{ formType: string; assignedTo: string; leadEmail: string }>({ formType: "", assignedTo: "", leadEmail: "" });
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastFilter, setBroadcastFilter] = useState<{ stage?: string; source?: string }>({});
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<string | null>(null);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (filterSource) params.set("source", filterSource);
      if (search) params.set("q", search);
      const url = `/marketing-leads${params.toString() ? "?" + params.toString() : ""}`;
      const r = await apiFetch(url);
      const d = await r?.json();
      setLeads(d?.leads || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterSource, search]);
  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, []);

  // Group leads by stage
  const byStage = useMemo(() => {
    const grouped: Record<string, Lead[]> = {};
    for (const s of STAGES) grouped[s.id] = [];
    for (const lead of leads) {
      if (grouped[lead.stage]) grouped[lead.stage].push(lead);
      else grouped.new.push(lead);
    }
    return grouped;
  }, [leads]);

  const totalLeads = leads.length;
  const dueToday = leads.filter(l => l.next_follow_up && new Date(l.next_follow_up) <= new Date() && l.stage !== "converted" && l.stage !== "lost").length;

  const updateLead = async (phone: string, updates: Partial<Lead>) => {
    await apiFetch(`/marketing-leads/${encodeURIComponent(phone)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    load();
  };

  const moveLead = (phone: string, newStage: string) => updateLead(phone, { stage: newStage });

  const saveEdit = async () => {
    if (!editingPhone) return;
    await updateLead(editingPhone, editing);
    setEditingPhone(null);
    setEditing({});
  };

  const convertLead = async () => {
    if (!convertingPhone || !convertForm.formType) return;
    const r = await apiFetch(`/marketing-leads/${encodeURIComponent(convertingPhone)}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formType: convertForm.formType,
        assignedTo: convertForm.assignedTo || undefined,
        leadEmail: convertForm.leadEmail || undefined,
      }),
    });
    if (r?.ok) {
      const d = await r.json();
      alert(`✅ Converted to case ${d.case?.id || ""}`);
      setConvertingPhone(null);
      setConvertForm({ formType: "", assignedTo: "", leadEmail: "" });
      load();
    } else {
      const err = await r?.json().catch(() => ({}));
      alert(`Failed to convert: ${err.error || "unknown error"}`);
    }
  };

  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    if (!confirm(`Send this message to all leads matching the filter?\n\n"${broadcastMsg.slice(0, 100)}${broadcastMsg.length > 100 ? "..." : ""}"\n\nThis cannot be undone.`)) return;
    setBroadcasting(true);
    setBroadcastResult(null);
    const r = await apiFetch(`/marketing-broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: broadcastMsg,
        filter: {
          stage: broadcastFilter.stage || undefined,
          source: broadcastFilter.source || undefined,
        },
      }),
    });
    const d = await r?.json();
    if (r?.ok) {
      setBroadcastResult(`✅ Sent ${d.sent} of ${d.recipients}. Failed: ${d.failed}`);
      setBroadcastMsg("");
      setTimeout(() => { setShowBroadcast(false); setBroadcastResult(null); }, 3000);
      load();
    } else {
      setBroadcastResult(`❌ ${d?.error || "Failed"}`);
    }
    setBroadcasting(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="px-5 py-4 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">📊 Marketing Pipeline</h1>
            <p className="text-xs text-slate-500">{totalLeads} leads · {dueToday} due today</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowBroadcast(true)}
              className="rounded-lg bg-purple-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-purple-700">
              📢 Broadcast
            </button>
            <button onClick={load}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
              🔄 Refresh
            </button>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search name, phone, notes..."
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:outline-none focus:border-purple-400" />
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs focus:outline-none focus:border-purple-400">
            <option value="">All sources</option>
            {SOURCES.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </div>
      </div>

      {/* Kanban */}
      {loading && leads.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Loading leads...</div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 p-4 h-full min-w-max">
            {STAGES.map(stage => (
              <div key={stage.id} className={`w-72 shrink-0 flex flex-col rounded-xl ${stage.bgLight} border border-slate-200`}>
                {/* Column header */}
                <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${stage.color}`}>{stage.label}</span>
                    <span className="text-xs text-slate-500">{byStage[stage.id]?.length || 0}</span>
                  </div>
                </div>
                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {(byStage[stage.id] || []).map(lead => (
                    <div key={lead.phone} className="bg-white rounded-lg p-3 border border-slate-200 shadow-sm hover:border-purple-300 transition-colors">
                      <div className="flex items-start justify-between mb-1">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{lead.contact_name || lead.phone}</p>
                          <p className="text-[10px] text-slate-400 truncate">{lead.phone}</p>
                        </div>
                        {lead.unread_count > 0 && (
                          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                            {lead.unread_count}
                          </span>
                        )}
                      </div>

                      {lead.service_interest && (
                        <div className="text-[10px] text-purple-700 bg-purple-50 px-2 py-0.5 rounded inline-block mb-1.5 font-semibold">
                          {lead.service_interest}
                        </div>
                      )}

                      {lead.last_message && (
                        <p className="text-[11px] text-slate-600 line-clamp-2 mb-1.5 leading-snug">
                          {lead.last_message}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-1 text-[10px] mb-2">
                        {lead.source && <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{lead.source}</span>}
                        {lead.next_follow_up && (
                          <span className={`px-1.5 py-0.5 rounded ${new Date(lead.next_follow_up) <= new Date() ? "bg-red-100 text-red-700 font-bold" : "bg-blue-100 text-blue-700"}`}>
                            ⏰ {new Date(lead.next_follow_up).toLocaleDateString("en-CA")}
                          </span>
                        )}
                        {lead.consultation_paid && <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded">💰 Paid</span>}
                        {!lead.ai_enabled && <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">🤚 Manual</span>}
                      </div>

                      {/* Quick actions */}
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={() => { setEditingPhone(lead.phone); setEditing(lead); }}
                          className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200">✏️ Edit</button>
                        {lead.stage !== "converted" && (
                          <button onClick={() => { setConvertingPhone(lead.phone); setConvertForm({ ...convertForm, formType: lead.service_interest || "" }); }}
                            className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-semibold">→ Case</button>
                        )}
                        {lead.converted_case_id && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono">{lead.converted_case_id}</span>
                        )}
                        {/* Move to next stage */}
                        <select value={lead.stage} onChange={e => moveLead(lead.phone, e.target.value)}
                          className="text-[10px] px-1 py-0.5 rounded border border-slate-200 bg-white">
                          {STAGES.map(s => <option key={s.id} value={s.id}>→ {s.label}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                  {(byStage[stage.id] || []).length === 0 && (
                    <div className="text-center text-[11px] text-slate-400 py-6">No leads</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingPhone && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditingPhone(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900 mb-3">Edit Lead</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-600">Name</label>
                <input value={editing.contact_name || ""} onChange={e => setEditing({ ...editing, contact_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Source</label>
                  <select value={editing.source || ""} onChange={e => setEditing({ ...editing, source: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-purple-400">
                    <option value="">—</option>
                    {SOURCES.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Service Interest</label>
                  <select value={editing.service_interest || ""} onChange={e => setEditing({ ...editing, service_interest: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-purple-400">
                    <option value="">—</option>
                    {FORM_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600">Assigned To</label>
                <input value={editing.assigned_to || ""} onChange={e => setEditing({ ...editing, assigned_to: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600">Next Follow-up</label>
                <input type="date" value={editing.next_follow_up?.toString().slice(0, 10) || ""} onChange={e => setEditing({ ...editing, next_follow_up: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600">Notes</label>
                <textarea value={editing.notes || ""} onChange={e => setEditing({ ...editing, notes: e.target.value })}
                  rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400" />
              </div>
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={!!editing.consultation_paid} onChange={e => setEditing({ ...editing, consultation_paid: e.target.checked })} />
                  💰 Consultation paid
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={editing.ai_enabled !== false} onChange={e => setEditing({ ...editing, ai_enabled: e.target.checked })} />
                  🤖 AI auto-reply on
                </label>
              </div>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setEditingPhone(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={saveEdit}
                className="rounded-lg bg-purple-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-purple-700">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Convert modal */}
      {convertingPhone && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setConvertingPhone(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900 mb-1">Convert to Case</h2>
            <p className="text-xs text-slate-500 mb-3">Creates a real case in the CRM with this lead's contact info.</p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-600">Form Type *</label>
                <select value={convertForm.formType} onChange={e => setConvertForm({ ...convertForm, formType: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400">
                  <option value="">— Select —</option>
                  {FORM_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600">Email (optional)</label>
                <input type="email" value={convertForm.leadEmail} onChange={e => setConvertForm({ ...convertForm, leadEmail: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600">Assign To (optional)</label>
                <input value={convertForm.assignedTo} onChange={e => setConvertForm({ ...convertForm, assignedTo: e.target.value })}
                  placeholder="Staff name"
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400" />
              </div>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setConvertingPhone(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Cancel</button>
              <button onClick={convertLead} disabled={!convertForm.formType}
                className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">→ Create Case</button>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast modal */}
      {showBroadcast && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowBroadcast(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900 mb-1">📢 Broadcast Message</h2>
            <p className="text-xs text-slate-500 mb-3">Send to leads matching the filter. Use <code className="bg-slate-100 px-1 rounded">{"{name}"}</code> as a placeholder.</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Stage</label>
                  <select value={broadcastFilter.stage || ""} onChange={e => setBroadcastFilter({ ...broadcastFilter, stage: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-purple-400">
                    <option value="">All (except converted/lost)</option>
                    {STAGES.filter(s => s.id !== "converted" && s.id !== "lost").map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Source</label>
                  <select value={broadcastFilter.source || ""} onChange={e => setBroadcastFilter({ ...broadcastFilter, source: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-purple-400">
                    <option value="">All sources</option>
                    {SOURCES.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600">Message</label>
                <textarea value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)}
                  rows={5} maxLength={4000}
                  placeholder="Hi {name}! Reminder about your consultation..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-purple-400 font-mono" />
                <p className="text-[10px] text-slate-400 mt-1">{broadcastMsg.length} / 4000 chars</p>
              </div>
              {broadcastResult && (
                <div className="text-xs p-2 rounded bg-slate-50 border border-slate-200">{broadcastResult}</div>
              )}
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setShowBroadcast(false)} disabled={broadcasting}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button onClick={sendBroadcast} disabled={broadcasting || !broadcastMsg.trim()}
                className="rounded-lg bg-purple-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-purple-700 disabled:opacity-50">
                {broadcasting ? "Sending..." : "📤 Send Broadcast"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
