"use client";
import { useState, useEffect, useRef } from "react";

type Msg = {
  id: string; phone: string; message: string; direction: string;
  contact_name: string | null; is_read: boolean; created_at: string;
};

type Lead = {
  phone: string;
  contact_name: string | null;
  stage: string;
  source: string | null;
  service_interest: string | null;
  ai_enabled: boolean;
  consultation_paid: boolean;
  next_follow_up: string | null;
  converted_case_id: string | null;
};

const STAGE_PILLS: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-blue-100 text-blue-700" },
  contacted: { label: "Contacted", cls: "bg-amber-100 text-amber-700" },
  consultation_booked: { label: "Consult Booked", cls: "bg-purple-100 text-purple-700" },
  consultation_done: { label: "Consult Done", cls: "bg-indigo-100 text-indigo-700" },
  converted: { label: "✅ Converted", cls: "bg-emerald-100 text-emerald-700" },
  lost: { label: "Lost", cls: "bg-slate-100 text-slate-500" },
};

const FORM_TYPES = [
  "PGWP", "SOWP", "BOWP", "VOWP", "Study Permit", "Study Permit Extension",
  "Visitor Visa", "TRV Inside", "Visitor Record", "Super Visa",
  "Spousal Sponsorship", "Family Sponsorship", "Express Entry", "PR",
  "PR Card Renewal", "Citizenship", "LMIA Work Permit", "Work Permit",
];

export function MarketingInbox({ sessionUser, apiFetch, onNewChat }: { sessionUser: any; apiFetch: any; onNewChat?: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [leads, setLeads] = useState<Record<string, Lead>>({});
  const [thread, setThread] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editName, setEditName] = useState<Record<string, string>>({});
  const [showNameInput, setShowNameInput] = useState<string | null>(null);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all"|"unread"|"read"|"archived">("all");
  const [sending, setSending] = useState(false);
  const [convertingPhone, setConvertingPhone] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState<{ formType: string; assignedTo: string; leadEmail: string }>({ formType: "", assignedTo: "", leadEmail: "" });
  const bottomRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const load = () => apiFetch("/marketing-inbox").then((r:any)=>r?.json()).then((d:any)=>{
    if(d.messages) setMessages(d.messages);
    if(d.leads) setLeads(d.leads);
    setLoaded(true);
  }).catch(()=>setLoaded(true));

  useEffect(()=>{ load(); const t=setInterval(load,5000); return ()=>clearInterval(t); },[]);
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[thread,messages]);

  // Mark as read when opening a thread
  useEffect(() => {
    if (thread) {
      apiFetch("/marketing-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markRead", phone: thread })
      }).catch(() => {});
    }
  }, [thread]);

  const toggleAI = async (phone: string, enabled: boolean) => {
    await apiFetch("/marketing-inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggleAI", phone, enabled })
    });
    setLeads(prev => ({ ...prev, [phone]: { ...(prev[phone] || {}), phone, ai_enabled: enabled } as Lead }));
  };

  const updateLeadStage = async (phone: string, stage: string) => {
    await apiFetch(`/marketing-leads/${encodeURIComponent(phone)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage })
    });
    setLeads(prev => ({ ...prev, [phone]: { ...(prev[phone] || {}), phone, stage } as Lead }));
  };

  const convertToCase = async () => {
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

  // Build threads
  const allThreads: Record<string,Msg[]> = {};
  messages.forEach(m=>{ if(!allThreads[m.phone]) allThreads[m.phone]=[]; allThreads[m.phone].push(m); });

  const filteredPhones = Object.keys(allThreads).filter(phone => {
    if(filter==="archived") return archived.has(phone);
    if(filter==="all" && archived.has(phone)) return false;
    const msgs = allThreads[phone];
    const q = search.toLowerCase();
    const matchSearch = !q || phone.includes(q) || 
      msgs.some(m=>m.message.toLowerCase().includes(q)) ||
      (msgs[0]?.contact_name||"").toLowerCase().includes(q);
    if(!matchSearch) return false;
    if(filter==="unread") return msgs.some(m=>!m.is_read&&m.direction==="inbound");
    if(filter==="read") return !msgs.some(m=>!m.is_read&&m.direction==="inbound");
    return true;
  }).sort((a,b)=>{
    // Pinned always first
    if(pinned.has(a)&&!pinned.has(b)) return -1;
    if(!pinned.has(a)&&pinned.has(b)) return 1;
    // Sort by latest message time (WhatsApp style)
    const aLast = Math.max(...allThreads[a].map(m=>new Date(m.created_at).getTime()));
    const bLast = Math.max(...allThreads[b].map(m=>new Date(m.created_at).getTime()));
    return bLast - aLast;
  });

  const threadMsgs = thread ? [...(allThreads[thread]||[])].sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()) : [];
  const threadName = (phone: string) => allThreads[phone]?.[0]?.contact_name || editName[phone] || phone;

  const saveName = async (phone: string, name: string) => {
    await apiFetch("/marketing-inbox", {
      method: "POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({action:"saveName", phone, name})
    });
    setMessages(prev=>prev.map(m=>m.phone===phone?{...m,contact_name:name}:m));
    setEditName(prev=>({...prev,[phone]:name}));
    setShowNameInput(null);
  };

  const sendReply = async () => {
    if(!reply.trim()||!thread) return;
    setSending(true);
    const text = reply.trim();
    setReply("");
    const res = await apiFetch("/marketing-inbox",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({phone:thread,message:text})
    });
    if(res?.ok){
      setMessages(prev=>[...prev,{
        id:`tmp-${Date.now()}`,phone:thread,message:text,
        direction:"outbound",contact_name:null,is_read:true,
        created_at:new Date().toISOString()
      }]);
    }
    setSending(false);
  };

  const quickReplies = [
    "Thank you for contacting Newton Immigration! 🍁 How can we help you today?",
    "Our consultation fee is $52.50 including taxes (15 min). Payment via Interac: newtonimmigration@gmail.com",
    "Please send your documents to our processing team on WhatsApp: *+1 604-779-5700* 📁",
    "You can reach us at: Surrey: +1 604-897-5894 | Calgary: +1 604-907-0314",
    "One of our team members will call you shortly! 📞",
  ];

  const getWaitInfo = (phone: string) => {
    const msgs = allThreads[phone] || [];
    const lastIn = [...msgs].filter(m=>m.direction==="inbound").sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0];
    const lastOut = [...msgs].filter(m=>m.direction==="outbound").sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0];
    const simple = /^(ok|okay|yes|no|k|👍|thanks|thank you|sure|noted|ji|haa|✅|👌|🙏|hmm)$/i;
    if(!lastIn||simple.test(lastIn.message.trim())) return null;
    if(lastOut&&new Date(lastOut.created_at)>new Date(lastIn.created_at)) return null;
    return Math.floor((Date.now()-new Date(lastIn.created_at).getTime())/60000);
  };

  return (
    <div className="flex h-full overflow-hidden bg-white">
      {/* LEFT: Thread list */}
      <div className={`flex flex-col border-r border-slate-100 ${thread?"hidden md:flex md:w-80 shrink-0":"w-full md:w-80 shrink-0"}`}>
        {/* Header */}
        <div className="px-4 pt-4 pb-2 border-b border-slate-100 bg-white">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-slate-900">📣 Marketing Inbox</p>
              <p className="text-[10px] text-slate-500">+1 236-501-3524 · New inquiries</p>
            </div>
            <span className="text-[10px] bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded-full">
              {filteredPhones.filter(p=>allThreads[p].some(m=>!m.is_read&&m.direction==="inbound")).length} unread
            </span>
          </div>
          {/* Search + New Chat */}
          <div className="flex gap-2 mb-2">
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="🔍 Search name, message, phone..."
              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:outline-none focus:border-purple-400" />
            {onNewChat && (
              <button
                onClick={onNewChat}
                className="rounded-lg bg-purple-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-purple-700 shrink-0"
                title="Start a new conversation">
                + New Chat
              </button>
            )}
          </div>
          {/* Filter tabs */}
          <div className="flex gap-1">
            {(["all","unread","read","archived"] as const).map(f=>(
              <button key={f} onClick={()=>setFilter(f)}
                className={`flex-1 py-1 rounded-lg text-[11px] font-semibold ${filter===f?"bg-slate-900 text-white":"text-slate-500 hover:bg-slate-100"}`}>
                {f.charAt(0).toUpperCase()+f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {!loaded && <p className="text-center text-xs text-slate-400 py-8">Loading...</p>}
          {loaded && filteredPhones.length===0 && (
            <p className="text-center text-xs text-slate-400 py-8">
              {filter==="archived"?"No archived chats":"No inquiries yet"}
            </p>
          )}
          {filteredPhones.map(phone=>{
            const msgs = allThreads[phone];
            const lastMsg = [...msgs].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0];
            const unread = msgs.filter(m=>!m.is_read&&m.direction==="inbound").length;
            const name = threadName(phone);
            const isActive = thread===phone;
            const waitMins = getWaitInfo(phone);
            const isPinned = pinned.has(phone);

            return (
              <div key={phone} className={`relative border-b border-slate-50 ${isActive?"bg-purple-50 border-l-2 border-l-purple-500":""}`}>
                <button onClick={()=>setThread(phone)} className="w-full text-left px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${isPinned?"bg-purple-600 text-white":"bg-purple-100 text-purple-700"}`}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      {isPinned && <span className="absolute -top-1 -right-1 text-[8px]">📌</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          {waitMins!==null && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${waitMins>=60?"bg-red-100 text-red-600":"bg-amber-100 text-amber-600"}`}>
                              {waitMins>=60?`${Math.floor(waitMins/60)}h`:`${waitMins}m`}
                            </span>
                          )}
                          {unread>0 && <span className="h-4 w-4 rounded-full bg-purple-500 text-white text-[9px] font-bold flex items-center justify-center">{unread}</span>}
                        </div>
                      </div>
                      {/* Stage pill + service interest */}
                      {leads[phone] && (
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          {STAGE_PILLS[leads[phone].stage] && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${STAGE_PILLS[leads[phone].stage].cls}`}>
                              {STAGE_PILLS[leads[phone].stage].label}
                            </span>
                          )}
                          {leads[phone].service_interest && (
                            <span className="text-[9px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-semibold">
                              {leads[phone].service_interest}
                            </span>
                          )}
                          {leads[phone].ai_enabled === false && (
                            <span className="text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">🤚 Manual</span>
                          )}
                        </div>
                      )}
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {waitMins!==null?"⚠️ Needs reply · ":lastMsg?.direction==="outbound"?"You: ":""}{lastMsg?.message?.slice(0,45)}
                      </p>
                    </div>
                  </div>
                </button>
                {/* Action buttons on hover */}
                <div className="absolute right-2 top-2 hidden group-hover:flex gap-1">
                </div>
                {isActive && (
                  <div className="flex gap-1 px-4 pb-2">
                    <button onClick={()=>setPinned(prev=>{const n=new Set(prev);n.has(phone)?n.delete(phone):n.add(phone);return n;})}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">
                      {pinned.has(phone)?"📌 Unpin":"📌 Pin"}
                    </button>
                    <button onClick={()=>setShowNameInput(showNameInput===phone?null:phone)}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">
                      ✏️ Name
                    </button>
                    <button onClick={()=>setArchived(prev=>{const n=new Set(prev);n.has(phone)?n.delete(phone):n.add(phone);return n;})}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">
                      {archived.has(phone)?"📥 Unarchive":"📦 Archive"}
                    </button>
                  </div>
                )}
                {showNameInput===phone && (
                  <div className="px-4 pb-2 flex gap-1">
                    <input autoFocus placeholder="Enter name..."
                      className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:border-purple-400"
                      onKeyDown={async e=>{if(e.key==="Enter"){await saveName(phone,(e.target as HTMLInputElement).value.trim());}}}
                    />
                    <button onClick={()=>setShowNameInput(null)} className="text-[10px] text-slate-400 px-1">✕</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT: Chat */}
      {thread ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white shrink-0">
            <button onClick={()=>setThread(null)} className="md:hidden rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold">← Back</button>
            <div className="h-9 w-9 rounded-full bg-purple-100 flex items-center justify-center text-sm font-bold text-purple-700">
              {threadName(thread).charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-slate-900 truncate">{threadName(thread)}</p>
                {leads[thread] && STAGE_PILLS[leads[thread].stage] && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STAGE_PILLS[leads[thread].stage].cls}`}>
                    {STAGE_PILLS[leads[thread].stage].label}
                  </span>
                )}
                {leads[thread]?.service_interest && (
                  <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-semibold">
                    {leads[thread].service_interest}
                  </span>
                )}
                {leads[thread]?.converted_case_id && (
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-mono font-semibold">
                    → {leads[thread].converted_case_id}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400">{thread} · Marketing inquiry</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {/* AI toggle */}
              <button onClick={()=>toggleAI(thread, !(leads[thread]?.ai_enabled !== false))}
                title={leads[thread]?.ai_enabled === false ? "AI auto-reply OFF — turn on" : "AI auto-reply ON — turn off"}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${leads[thread]?.ai_enabled === false ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100" : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                {leads[thread]?.ai_enabled === false ? "🤚 Manual" : "🤖 AI On"}
              </button>
              {/* Stage selector */}
              {leads[thread] && leads[thread].stage !== "converted" && (
                <select
                  value={leads[thread]?.stage || "new"}
                  onChange={e => updateLeadStage(thread, e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold hover:bg-slate-50">
                  {Object.entries(STAGE_PILLS).map(([id, p]) => (
                    <option key={id} value={id}>{p.label}</option>
                  ))}
                </select>
              )}
              {/* Convert to case */}
              {!leads[thread]?.converted_case_id && (
                <button onClick={() => { setConvertingPhone(thread); setConvertForm({ formType: leads[thread]?.service_interest || "", assignedTo: "", leadEmail: "" }); }}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                  → Case
                </button>
              )}
              <button onClick={()=>setShowNameInput(showNameInput===thread?null:thread)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50">✏️ Name</button>

              {/* WhatsApp call — opens WhatsApp on staff's device, ready to dial */}
              <a
                href={`https://wa.me/${thread.replace(/\D/g,"")}`}
                target="_blank"
                rel="noreferrer"
                title="Open in WhatsApp (call from there)"
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                💬 Open WA
              </a>

              <button onClick={()=>setPinned(prev=>{const n=new Set(prev);n.has(thread)?n.delete(thread):n.add(thread);return n;})}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50">
                {pinned.has(thread)?"📌":"📌"}
              </button>
              <button onClick={()=>setArchived(prev=>{const n=new Set(prev);n.has(thread)?n.delete(thread):n.add(thread);return n;})}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50">
                {archived.has(thread)?"📥":"📦"}
              </button>
            </div>
          </div>

          {/* Save contact panel — opens with proper save button + phone display + lead promotion */}
          {showNameInput===thread && (
            <div className="px-4 py-3 bg-purple-50 border-b border-purple-100 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-purple-900 font-bold">💾 Save Contact</span>
                <span className="text-purple-600">{thread}</span>
                <button onClick={()=>setShowNameInput(null)} className="ml-auto text-slate-400 hover:text-slate-600 text-base leading-none">✕</button>
              </div>
              <div className="flex gap-2 items-center">
                <input
                  id={`name-input-${thread}`}
                  autoFocus
                  placeholder="Client name (e.g. Raj Sharma)"
                  defaultValue={threadName(thread)!==thread?threadName(thread):""}
                  className="flex-1 rounded-lg border border-purple-200 px-3 py-1.5 text-xs focus:outline-none focus:border-purple-500"
                  onKeyDown={async e=>{
                    if(e.key==="Enter"){
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val) { await saveName(thread, val); setShowNameInput(null); }
                    }
                  }}
                />
                <button
                  onClick={async ()=>{
                    const input = document.getElementById(`name-input-${thread}`) as HTMLInputElement;
                    const val = input?.value?.trim();
                    if (!val) { alert("Please enter a name first."); return; }
                    await saveName(thread, val);
                    setShowNameInput(null);
                  }}
                  className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700"
                >
                  💾 Save
                </button>
              </div>
              <p className="text-[10px] text-purple-600">
                💡 Tip: After saving, this contact appears in <strong>Lead Pipeline</strong> with the phone number {thread}. You can add more details (service interest, follow-up date, notes) there.
              </p>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-[#f0f2f5]">
            {threadMsgs.map((m,idx)=>{
              const isOut = m.direction==="outbound";
              const time = new Date(m.created_at).toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit",timeZone:"America/Vancouver"});
              // Date separator
              const prevMsg = threadMsgs[idx-1];
              const showDate = !prevMsg || new Date(m.created_at).toDateString()!==new Date(prevMsg.created_at).toDateString();
              const dateLabel = new Date(m.created_at).toDateString()===new Date().toDateString()?"Today":
                new Date(m.created_at).toDateString()===new Date(Date.now()-86400000).toDateString()?"Yesterday":
                new Date(m.created_at).toLocaleDateString("en-CA",{month:"long",day:"numeric",timeZone:"America/Vancouver"});
              return (
                <div key={m.id||idx}>
                  {showDate && (
                    <div className="flex justify-center my-3">
                      <span className="bg-white text-slate-500 text-[11px] font-medium px-3 py-1 rounded-full shadow-sm border border-slate-200">{dateLabel}</span>
                    </div>
                  )}
                  <div className={`flex ${isOut?"justify-end":"justify-start"} mb-1`}>
                    <div className={`max-w-[72%] rounded-2xl px-3.5 py-2 shadow-sm ${isOut?"bg-[#d9fdd3] rounded-br-sm":"bg-white rounded-bl-sm border border-slate-100"}`}>
                      <p className="text-sm text-slate-900 whitespace-pre-wrap break-words leading-relaxed">{m.message}</p>
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        <span className="text-[10px] text-slate-400">{time}</span>
                        {isOut && <span className="text-[11px] text-blue-500">✓✓</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Quick replies */}
          <div className="px-4 pt-2 flex gap-2 overflow-x-auto shrink-0 bg-white border-t border-slate-100">
            {quickReplies.map((q,i)=>(
              <button key={i} onClick={()=>{setReply(q);textRef.current?.focus();}}
                className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600 hover:border-purple-300 hover:text-purple-700 whitespace-nowrap">
                {q.slice(0,35)}...
              </button>
            ))}
          </div>

          {/* Reply box */}
          <div className="px-4 py-3 bg-white shrink-0">
            <div className="flex gap-2 items-end bg-slate-50 rounded-2xl border border-slate-200 px-3 py-2 focus-within:border-purple-400">
              <textarea ref={textRef} value={reply} onChange={e=>setReply(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendReply();}}}
                placeholder={`Reply to ${threadName(thread)}...`}
                rows={1} style={{resize:"none"}}
                className="flex-1 bg-transparent text-sm outline-none text-slate-900 placeholder-slate-400 max-h-32" />
              <button onClick={sendReply} disabled={!reply.trim()||sending}
                className="bg-purple-600 text-white rounded-xl p-2 hover:bg-purple-700 disabled:opacity-40 shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-slate-50">
          <div className="text-center">
            <p className="text-4xl mb-3">📣</p>
            <p className="text-sm font-semibold text-slate-600">Marketing Inbox</p>
            <p className="text-xs text-slate-400 mt-1">New client inquiries via +1 236-501-3524</p>
          </div>
        </div>
      )}

      {/* Convert-to-Case modal */}
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
              <button onClick={convertToCase} disabled={!convertForm.formType}
                className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">→ Create Case</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
