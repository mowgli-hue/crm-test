"use client";
import { useState, useEffect } from "react";

const OUTCOMES = [
  { id: "consultation_booked", label: "✅ Consultation Booked", color: "bg-emerald-100 text-emerald-700" },
  { id: "info_provided", label: "ℹ️ Info Provided", color: "bg-blue-100 text-blue-700" },
  { id: "callback_scheduled", label: "📞 Callback Scheduled", color: "bg-purple-100 text-purple-700" },
  { id: "fee_quoted", label: "💰 Fee Quoted", color: "bg-amber-100 text-amber-700" },
  { id: "not_interested", label: "❌ Not Interested", color: "bg-slate-100 text-slate-500" },
  { id: "no_answer", label: "📵 No Answer / VM", color: "bg-slate-100 text-slate-500" },
  { id: "wrong_number", label: "🚫 Wrong Number", color: "bg-red-100 text-red-700" },
  { id: "other", label: "Other", color: "bg-slate-100 text-slate-600" },
];

const SERVICE_TYPES = [
  "PGWP", "SOWP", "BOWP", "VOWP", "Study Permit", "Study Permit Extension",
  "Visitor Visa", "TRV Inside", "Visitor Record", "Super Visa",
  "Spousal Sponsorship", "Family Sponsorship", "Express Entry", "PR",
  "PR Card Renewal", "Citizenship", "LMIA Work Permit", "Work Permit",
  "Consultation", "General Inquiry",
];

type Call = {
  id: string;
  direction: string;
  phone: string | null;
  contact_name: string | null;
  duration_minutes: number | null;
  outcome: string | null;
  service_interest: string | null;
  notes: string | null;
  ai_summary: string | null;
  logged_by: string | null;
  logged_by_name: string | null;
  linked_lead_phone: string | null;
  linked_case_id: string | null;
  called_at: string;
  created_at: string;
};

export function CallLog({ sessionUser, apiFetch }: { sessionUser: any; apiFetch: any }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("");
  const [showLogModal, setShowLogModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Modal form state
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [duration, setDuration] = useState("");
  const [outcome, setOutcome] = useState("");
  const [serviceInterest, setServiceInterest] = useState("");
  const [rawNotes, setRawNotes] = useState("");
  const [useAI, setUseAI] = useState(true);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (filterOutcome) params.set("outcome", filterOutcome);
      if (search) params.set("search", search);
      const url = `/call-log${params.toString() ? "?" + params.toString() : ""}`;
      const r = await apiFetch(url);
      const d = await r?.json();
      setCalls(d?.calls || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterOutcome, search]);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, []);

  const resetForm = () => {
    setDirection("inbound");
    setPhone("");
    setContactName("");
    setDuration("");
    setOutcome("");
    setServiceInterest("");
    setRawNotes("");
    setUseAI(true);
  };

  const submitCall = async () => {
    if (!rawNotes.trim() && !contactName.trim() && !phone.trim()) {
      alert("Please add at least notes, a name, or a phone number.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await apiFetch("/call-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          phone: phone.trim() || undefined,
          contact_name: contactName.trim() || undefined,
          duration_minutes: duration ? parseInt(duration, 10) : undefined,
          outcome: outcome || undefined,
          service_interest: serviceInterest || undefined,
          notes: rawNotes.trim() || undefined,
          useAI,
        }),
      });
      if (r?.ok) {
        resetForm();
        setShowLogModal(false);
        load();
      } else {
        const err = await r?.json().catch(() => ({}));
        alert(`Failed: ${err.error || "Unknown error"}`);
      }
    } catch (e) {
      alert("Error logging call");
    }
    setSubmitting(false);
  };

  const deleteCall = async (id: string) => {
    if (!confirm("Delete this call log entry? This cannot be undone.")) return;
    await apiFetch(`/call-log/${id}`, { method: "DELETE" });
    load();
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = (now.getTime() - d.getTime()) / 60000;
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${Math.floor(diffMin)} min ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
    if (diffMin < 10080) return `${Math.floor(diffMin / 1440)}d ago`;
    return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  };

  const todayCount = calls.filter(c => new Date(c.called_at).toDateString() === new Date().toDateString()).length;
  const consultBookedCount = calls.filter(c => c.outcome === "consultation_booked").length;

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="px-5 py-4 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h1 className="text-lg font-bold text-slate-900">📞 Call Log</h1>
            <p className="text-xs text-slate-500">{calls.length} calls · {todayCount} today · {consultBookedCount} consultations booked</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
              🔄 Refresh
            </button>
            <button onClick={() => { resetForm(); setShowLogModal(true); }}
              className="rounded-lg bg-purple-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-purple-700">
              ➕ Log Call
            </button>
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search name, phone, notes..."
            className="flex-1 min-w-[200px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:outline-none focus:border-purple-400" />
          <select value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs focus:outline-none focus:border-purple-400">
            <option value="">All outcomes</option>
            {OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && calls.length === 0 ? (
          <div className="text-center text-sm text-slate-400 py-8">Loading calls...</div>
        ) : calls.length === 0 ? (
          <div className="text-center text-sm text-slate-400 py-12">
            <p className="mb-2">📞 No call logs yet</p>
            <p className="text-xs">Click "Log Call" to add the first one.</p>
          </div>
        ) : (
          calls.map(call => {
            const outcomeData = OUTCOMES.find(o => o.id === call.outcome);
            return (
              <div key={call.id} className="bg-white rounded-xl border border-slate-200 p-3 hover:border-purple-300 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs">{call.direction === "inbound" ? "📥" : "📤"}</span>
                    <span className="text-sm font-bold text-slate-900">
                      {call.contact_name || call.phone || "Unknown"}
                    </span>
                    {call.contact_name && call.phone && (
                      <span className="text-[11px] text-slate-400">{call.phone}</span>
                    )}
                    {outcomeData && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${outcomeData.color}`}>
                        {outcomeData.label}
                      </span>
                    )}
                    {call.service_interest && (
                      <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-semibold">
                        {call.service_interest}
                      </span>
                    )}
                    {call.duration_minutes && (
                      <span className="text-[10px] text-slate-500">⏱ {call.duration_minutes}m</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[11px] text-slate-400">{formatTime(call.called_at)}</span>
                    <button onClick={() => deleteCall(call.id)}
                      className="text-slate-300 hover:text-red-500 text-xs ml-1" title="Delete">✕</button>
                  </div>
                </div>

                {call.ai_summary ? (
                  <div className="bg-purple-50 border-l-2 border-purple-300 px-2.5 py-1.5 mb-1.5 rounded">
                    <p className="text-[10px] text-purple-600 font-semibold mb-0.5">🤖 AI Summary</p>
                    <p className="text-sm text-slate-800 leading-relaxed">{call.ai_summary}</p>
                  </div>
                ) : null}

                {call.notes && (
                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{call.notes}</p>
                )}

                <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-400">
                  {call.logged_by_name && <span>by {call.logged_by_name}</span>}
                  {call.linked_case_id && (
                    <span className="text-emerald-600 font-mono">→ {call.linked_case_id}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Log Call modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !submitting && setShowLogModal(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">📞 Log a Call</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Quick notes — AI will polish them into a summary if you let it.</p>
              </div>
              {!submitting && (
                <button onClick={() => setShowLogModal(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
              )}
            </div>

            <div className="space-y-3">
              {/* Direction toggle */}
              <div className="flex gap-2">
                {(["inbound", "outbound"] as const).map(d => (
                  <button key={d} onClick={() => setDirection(d)} disabled={submitting}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${direction === d ? "border-purple-500 bg-purple-50 text-purple-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                    {d === "inbound" ? "📥 Incoming" : "📤 Outgoing"}
                  </button>
                ))}
              </div>

              {/* Name + phone */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700">Contact name</label>
                  <input value={contactName} onChange={e => setContactName(e.target.value)} disabled={submitting}
                    placeholder="e.g. Raj Sharma"
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400 disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700">Phone</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)} disabled={submitting}
                    placeholder="+1 604-555-1234"
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400 disabled:bg-slate-50" />
                </div>
              </div>

              {/* Duration + outcome + service */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700">Duration (min)</label>
                  <input type="number" value={duration} onChange={e => setDuration(e.target.value)} disabled={submitting}
                    placeholder="5"
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400 disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700">Outcome</label>
                  <select value={outcome} onChange={e => setOutcome(e.target.value)} disabled={submitting}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-purple-400 disabled:bg-slate-50">
                    <option value="">—</option>
                    {OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700">Service interest</label>
                  <select value={serviceInterest} onChange={e => setServiceInterest(e.target.value)} disabled={submitting}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-purple-400 disabled:bg-slate-50">
                    <option value="">—</option>
                    {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Rough notes */}
              <div>
                <label className="text-[11px] font-semibold text-slate-700">
                  Notes <span className="text-slate-400 font-normal">(rough is fine — AI cleans up)</span>
                </label>
                <textarea value={rawNotes} onChange={e => setRawNotes(e.target.value)} disabled={submitting}
                  rows={5}
                  placeholder="e.g. wants pgwp, finished diploma at vcc dec 2024, has all docs ready, will send via wa later today, said his cousin referred him"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-purple-400 disabled:bg-slate-50" />
              </div>

              {/* AI toggle */}
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                <input type="checkbox" checked={useAI} onChange={e => setUseAI(e.target.checked)} disabled={submitting} />
                <span>🤖 <strong>Use AI</strong> to polish my rough notes into a clean summary</span>
              </label>
            </div>

            <div className="mt-5 flex gap-2 justify-end items-center">
              {submitting && <span className="text-xs text-purple-600 font-semibold mr-auto">⏳ Saving…</span>}
              <button onClick={() => setShowLogModal(false)} disabled={submitting}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submitCall} disabled={submitting}
                className="rounded-lg bg-purple-600 text-white px-4 py-1.5 text-xs font-bold hover:bg-purple-700 disabled:opacity-50">
                {submitting ? "Saving…" : "💾 Save Call"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
