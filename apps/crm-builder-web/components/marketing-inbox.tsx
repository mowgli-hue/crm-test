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
  // Attachment: when staff picks a file (📎 button), we stage it here. Send button
  // will include it in the POST body. Same shape as Processing inbox uses.
  const [attachment, setAttachment] = useState<{ name: string; type: string; data: string } | null>(null);
  // Quick-checklists: services pulled from /api/marketing-inbox/checklist on first
  // open. Each entry has the formatted message ready to send.
  const [services, setServices] = useState<Array<{
    key: string; displayName: string; emoji: string; category: string;
    feeText: string; needsConsultation: boolean; message: string;
  }>>([]);
  const [showSidebar, setShowSidebar] = useState(true);
  // Preview modal: when staff clicks a service, we open a modal showing the
  // exact message we're about to send (so they can review/edit before commit).
  const [previewService, setPreviewService] = useState<null | {
    key: string; displayName: string; emoji: string; message: string;
  }>(null);
  const [previewEditedMessage, setPreviewEditedMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Ref to the messages scroll container — used to check whether the user
  // is currently at/near the bottom before we auto-scroll on new messages.
  // If they've scrolled up to read history, we DON'T pull them back.
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  // Tracks whether the user is "stuck" to the bottom of the chat. We update
  // this on every scroll. Initially true (so opening a thread scrolls to
  // bottom). Only the scroll handler flips it to false.
  const isAtBottomRef = useRef(true);
  // Manual refresh button state (so we can show a spinner on click)
  const [refreshing, setRefreshing] = useState(false);
  // Payment summary indexed by last-10-digit phone — used to show "$X paid"
  // tag on each thread in the left list. Pulled from /api/marketing-inbox/payments
  // on mount + every minute. Light data (small JSON) so polling is cheap.
  const [payments, setPayments] = useState<Record<string, { paidTotal: number; outstandingTotal: number; sources: string[] }>>({});

  const load = () => apiFetch("/marketing-inbox").then((r:any)=>r?.json()).then((d:any)=>{
    if(d.messages) setMessages(d.messages);
    if(d.leads) setLeads(d.leads);
    setLoaded(true);
  }).catch(()=>setLoaded(true));

  // Manual refresh — same as `load` but with visual feedback so staff knows
  // it actually ran. Useful when polling feels stale.
  const manualRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally {
      // Tiny min-duration so the spinner doesn't flicker on fast networks
      setTimeout(() => setRefreshing(false), 250);
    }
  };

  useEffect(()=>{ load(); const t=setInterval(load,5000); return ()=>clearInterval(t); },[]);

  // ── Scroll behavior ──
  // When THREAD changes (user clicked a different conversation) → always
  // jump to bottom on initial open. Mark them as "at bottom" so the next
  // poll's auto-scroll behavior is correct.
  useEffect(() => {
    if (!thread) return;
    // Use requestAnimationFrame so DOM has time to render messages first
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
      isAtBottomRef.current = true;
    });
  }, [thread]);

  // When MESSAGES change (poll fetched new ones, or staff sent a reply):
  // ONLY auto-scroll if the user is already near the bottom. If they've
  // scrolled up to read history, leave them alone — yanking them down
  // mid-read is the bug we're fixing.
  useEffect(() => {
    if (!isAtBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Scroll handler tracks "near bottom" state. Threshold of 80px gives some
  // tolerance — if user is within 80px of bottom, treat it as "at bottom"
  // so new incoming messages will still pull them down (typical chat UX).
  const onMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < 80;
  };

  // Load checklists once on mount. Pulled from SERVICES catalog server-side
  // (single source of truth, also feeds the marketing AI's responses).
  useEffect(() => {
    apiFetch("/marketing-inbox/checklist")
      .then((r: any) => r?.json())
      .then((d: any) => { if (Array.isArray(d?.services)) setServices(d.services); })
      .catch(() => {});
  }, []);

  // Load per-phone payment summary on mount + refresh every 60 sec.
  // Used to show "$X paid" tag in left thread list. Slower poll than messages
  // since payment data changes much less frequently than messages.
  useEffect(() => {
    const loadPayments = () => {
      apiFetch("/marketing-inbox/payments")
        .then((r: any) => r?.json())
        .then((d: any) => { if (d?.summary) setPayments(d.summary); })
        .catch(() => {});
    };
    loadPayments();
    const t = setInterval(loadPayments, 60000);
    return () => clearInterval(t);
  }, []);

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

  // Re-open a closed 24h window: sends the approved re-engagement template that
  // asks the client to reply. Free-form text won't deliver outside the window;
  // this does, and the client's reply reopens the chat.
  const [reengaging, setReengaging] = useState(false);
  const reengage = async (phone: string) => {
    if (reengaging) return;
    if (!confirm("Send a re-engagement message asking the client to reply? Use this when they haven't messaged in over 24h and your normal messages aren't being delivered.")) return;
    setReengaging(true);
    const res = await apiFetch("/marketing-inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reengage", phone }),
    });
    setReengaging(false);
    if (res?.ok) {
      setMessages(prev => [...prev, {
        id: `tmp-${Date.now()}`, phone, message: "🔔 Re-engagement sent (asked client to reply to reopen the chat).",
        direction: "outbound", contact_name: null, is_read: true, created_at: new Date().toISOString(),
      }]);
    } else {
      alert(res?.error || "Could not send the re-engagement message. Check the template is approved in WhatsApp.");
    }
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
  // 24h window state for the open thread. WhatsApp only delivers a free-form
  // message within 24h of the client's LAST inbound message; outside that, the
  // re-engage TEMPLATE must be sent first. Compute from the loaded messages so
  // the moment staff open a stale chat, we can prompt them to send it.
  const lastInboundAt = thread
    ? threadMsgs.filter(m => m.direction === "inbound").reduce((mx, m) => Math.max(mx, new Date(m.created_at).getTime()), 0)
    : 0;
  const windowClosed = Boolean(thread) && !(lastInboundAt > 0 && (Date.now() - lastInboundAt) < 24 * 60 * 60 * 1000);
  // Resolve the display name for a thread by checking multiple sources in
  // priority order. Different staff actions store names in different places:
  //   - "Save Name" button updates: marketing_leads.contact_name (canonical) +
  //     messages' contact_name (denormalized for display)
  //   - Convert-to-case sets the case client name AND lead contact_name
  //   - WhatsApp's profile name auto-populates incoming message contact_name
  //
  // We check leads FIRST because it's the most reliable: saveName always
  // upserts the lead row, but message-level updates can race with polling.
  // Falls back to message-level name → in-memory edit → phone digits.
  const threadName = (phone: string) => {
    // 1. Lead row (most reliable; updated by saveName + convert)
    const leadName = leads[phone]?.contact_name;
    if (leadName && leadName.trim()) return leadName.trim();
    // 2. WhatsApp profile name on the most recent inbound message
    //    (use latest, not first — WhatsApp may update profile name over time)
    const msgs = allThreads[phone] || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const n = msgs[i]?.contact_name;
      if (n && String(n).trim()) return String(n).trim();
    }
    // 3. In-memory edit (just typed by staff, not saved yet to server)
    if (editName[phone] && editName[phone].trim()) return editName[phone].trim();
    // 4. Last resort: phone digits
    return phone;
  };

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

  // Send a reply. Optionally accepts a `messageOverride` so checklist preview
  // modal can call this with the (possibly edited) checklist text without
  // having to stuff it into the reply textarea first.
  const sendReply = async (messageOverride?: string) => {
    const text = (messageOverride !== undefined ? messageOverride : reply).trim();
    if ((!text && !attachment) || !thread) return;
    setSending(true);

    // Capture before clearing — failure path needs to restore them.
    const att = attachment;

    // Clear UI optimistically (will restore on failure).
    if (messageOverride === undefined) setReply("");
    setAttachment(null);

    const payload: any = { phone: thread };
    if (text) payload.message = text;
    if (att) payload.attachment = att;

    const res = await apiFetch("/marketing-inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res?.ok) {
      const optimisticMessage = att
        ? `[doc:tmp-${Date.now()}|kind=${att.type.startsWith("image/") ? "image" : "document"}|name=${encodeURIComponent(att.name)}|mime=${encodeURIComponent(att.type)}|pending=1${text ? `|caption=${encodeURIComponent(text)}` : ""}]`
        : text;
      setMessages(prev => [...prev, {
        id: `tmp-${Date.now()}`, phone: thread, message: optimisticMessage,
        direction: "outbound", contact_name: null, is_read: true,
        created_at: new Date().toISOString(),
      }]);
    } else {
      // Restore on failure so staff doesn't lose their content
      if (messageOverride === undefined) setReply(text);
      if (att) setAttachment(att);
    }
    setSending(false);
  };

  // Read a File into base64 for the attachment payload. Same approach as
  // Processing inbox — client-side encode, server-side decode.
  const onPickFile = async (file: File) => {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      alert("File too large (16 MB max)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      // result is "data:<mime>;base64,<data>" — strip the prefix
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      setAttachment({ name: file.name, type: file.type || "application/octet-stream", data: base64 });
    };
    reader.readAsDataURL(file);
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
    <div className="flex h-full overflow-hidden bg-white relative">
      {/* LEFT: Thread list */}
      <div className={`flex flex-col border-r border-slate-100 ${thread?"hidden md:flex md:w-80 shrink-0":"w-full md:w-80 shrink-0"}`}>
        {/* Header */}
        <div className="px-4 pt-4 pb-2 border-b border-slate-100 bg-white">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-slate-900">📣 Marketing Inbox</p>
              <p className="text-[10px] text-slate-500">+1 236-501-3524 · New inquiries</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded-full">
                {filteredPhones.filter(p=>allThreads[p].some(m=>!m.is_read&&m.direction==="inbound")).length} unread
              </span>
              {/* Manual refresh — useful when the 5-sec poll feels stale or
                  staff just sent a doc and wants confirmation immediately. */}
              <button
                onClick={manualRefresh}
                disabled={refreshing}
                title="Refresh now"
                className="rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 px-2 py-1 text-xs">
                <span className={`inline-block ${refreshing ? "animate-spin" : ""}`}>🔄</span>
              </button>
            </div>
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
                      {/* Payment tag — outside lead conditional since payment can
                          exist for cases that aren't in the leads table. Shows
                          {paid amount} or {paid /-{outstanding}}. Color = emerald
                          if fully paid, blue if balance owed. */}
                      {(() => {
                        const phoneLast10 = String(phone).replace(/\D/g, "").slice(-10);
                        const pay = payments[phoneLast10];
                        if (!pay || pay.paidTotal <= 0) return null;
                        const isFullyPaid = pay.outstandingTotal === 0;
                        return (
                          <div className="mt-0.5">
                            <span className={`inline-flex text-[9px] font-bold px-1.5 py-0.5 rounded ${isFullyPaid ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}
                                  title={`Paid: $${pay.paidTotal.toLocaleString()}${pay.outstandingTotal > 0 ? ` · Outstanding: $${pay.outstandingTotal.toLocaleString()}` : ""}`}>
                              💰 ${pay.paidTotal.toLocaleString()}
                              {pay.outstandingTotal > 0 && <span className="opacity-70"> · -${pay.outstandingTotal.toLocaleString()}</span>}
                            </span>
                          </div>
                        );
                      })()}
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

              {/* Re-engage — reopen a closed 24h window via approved template */}
              <button onClick={()=>reengage(thread)} disabled={reengaging}
                title="Client not getting your messages? If they haven't replied in 24h the chat is closed. This sends an approved 'please reply' message that always delivers and reopens the chat."
                className="rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50">
                {reengaging ? "…" : "🔔 Ask to reply"}
              </button>

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
          <div ref={messagesScrollRef} onScroll={onMessagesScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-[#f0f2f5]">
            {/* Closed-window prompt — appears the moment staff open a stale chat.
                WhatsApp won't deliver a normal message; send the re-engage
                template first and wait for the client's reply. */}
            {windowClosed && (
              <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 shadow-sm">
                <p className="text-xs font-bold text-sky-900">⏳ This chat is closed (no reply in 24h)</p>
                <p className="mt-1 text-[11px] text-sky-800 leading-snug">
                  WhatsApp won’t deliver a normal message right now. Send the re-engage template first, then wait for the client to reply — that reopens the chat and your messages go through.
                </p>
                <button
                  onClick={() => thread && reengage(thread)}
                  disabled={reengaging}
                  className="mt-2 rounded-lg bg-sky-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-sky-700 disabled:opacity-50">
                  {reengaging ? "Sending…" : "🔔 Send re-engage template"}
                </button>
              </div>
            )}
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
                      {(() => {
                        // Detect new-format doc placeholder: [doc:msgId|kind=...|name=...|s3=...]
                        // Same parser used in Processing Inbox + Case Comm tab.
                        const text = String(m.message || "");
                        if (text.startsWith("[doc:") && text.endsWith("]")) {
                          const inner = text.slice(1, -1);
                          const parts = inner.split("|");
                          if (parts.length >= 2) {
                            const obj: any = { msgId: parts[0].replace(/^doc:/, ""), pending: false };
                            for (let i = 1; i < parts.length; i++) {
                              const eq = parts[i].indexOf("=");
                              if (eq < 0) continue;
                              const k = parts[i].slice(0, eq);
                              const v = parts[i].slice(eq + 1);
                              if (k === "pending") obj.pending = v === "1" || v === "true";
                              else { try { obj[k] = decodeURIComponent(v); } catch { obj[k] = v; } }
                            }
                            const icon = obj.kind === "image" ? "🖼️" : obj.kind === "audio" ? "🎵" : "📄";
                            const label = obj.name || (obj.kind === "image" ? "Image" : obj.kind === "audio" ? "Voice message" : "Document");
                            // Image previews: render inline thumbnail rather than a download
                            // card. Click → opens full-size in new tab.
                            // The /api/inbox-attachment endpoint streams from S3 with the
                            // proper Content-Type so <img src> just works.
                            if (obj.s3 && obj.kind === "image") {
                              const src = `/api/inbox-attachment?id=${encodeURIComponent(obj.msgId)}`;
                              return (
                                <div className="flex flex-col gap-1">
                                  <a href={src} target="_blank" rel="noopener noreferrer" className="block">
                                    <img
                                      src={src}
                                      alt={label}
                                      loading="lazy"
                                      className="rounded-xl max-w-full max-h-72 object-cover border border-slate-200 hover:opacity-90 transition-opacity cursor-zoom-in"
                                    />
                                  </a>
                                  {obj.caption && obj.caption !== obj.name && (
                                    <p className="text-[11px] text-slate-600 px-1">{obj.caption}</p>
                                  )}
                                  <a
                                    href={src}
                                    download={obj.name || ""}
                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:underline px-1"
                                  >
                                    ⬇️ Download {label}
                                  </a>
                                </div>
                              );
                            }
                            if (obj.s3) {
                              return (
                                <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-2 border border-emerald-200">
                                  <span className="text-2xl">{icon}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 truncate">{label}</p>
                                    {obj.caption && obj.caption !== obj.name && (
                                      <p className="text-[11px] text-slate-600 truncate">{obj.caption}</p>
                                    )}
                                    <a
                                      href={`/api/inbox-attachment?id=${encodeURIComponent(obj.msgId)}`}
                                      download={obj.name || ""}
                                      className="inline-flex items-center gap-1 mt-0.5 text-[11px] font-bold text-emerald-700 hover:underline"
                                    >
                                      ⬇️ Download
                                    </a>
                                  </div>
                                </div>
                              );
                            }
                            if (obj.pending) {
                              return (
                                <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-2 border border-amber-200">
                                  <span className="text-2xl animate-pulse">{icon}</span>
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">{label} received</p>
                                    <p className="text-[10px] text-amber-700">Uploading… download will appear shortly.</p>
                                  </div>
                                </div>
                              );
                            }
                          }
                        }
                        return <p className="text-sm text-slate-900 whitespace-pre-wrap break-words leading-relaxed">{text}</p>;
                      })()}
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
            {/* Attachment preview chip */}
            {attachment && (
              <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-lg">{attachment.type.startsWith("image/") ? "🖼️" : attachment.type.startsWith("audio/") ? "🎵" : "📄"}</span>
                <span className="text-xs text-slate-700 truncate flex-1">{attachment.name}</span>
                <span className="text-[10px] text-slate-400">{Math.round(((attachment.data.length * 3) / 4) / 1024)} KB</span>
                <button onClick={() => setAttachment(null)} className="text-slate-400 hover:text-rose-500 text-sm leading-none">✕</button>
              </div>
            )}
            <div className="flex gap-2 items-end bg-slate-50 rounded-2xl border border-slate-200 px-3 py-2 focus-within:border-purple-400">
              {/* Hidden file input + attach button */}
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                title="Attach a file"
                className="text-slate-500 hover:text-purple-600 disabled:opacity-40 shrink-0">
                📎
              </button>
              <textarea ref={textRef} value={reply}
                onChange={e=>{setReply(e.target.value); const t=e.currentTarget; t.style.height="auto"; t.style.height=Math.min(t.scrollHeight,128)+"px";}}
                onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){e.preventDefault();sendReply();}}}
                placeholder={attachment ? "Add a caption (optional)..." : `Reply to ${threadName(thread)}... (Enter = new line, ⌘/Ctrl+Enter to send)`}
                rows={1} style={{resize:"none"}}
                className="flex-1 bg-transparent text-sm outline-none text-slate-900 placeholder-slate-400 max-h-32 overflow-y-auto" />
              <button onClick={() => sendReply()} disabled={(!reply.trim() && !attachment) || sending}
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

      {/* ── Right Sidebar: Quick Checklists ── */}
      {/* Always rendered (collapsible) so staff can browse services even with
          no thread open. Click a service → preview modal → confirm send. */}
      {showSidebar && services.length > 0 && (
        <aside className="w-64 shrink-0 border-l border-slate-200 bg-slate-50 flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">📋 Quick Checklists</p>
            <button onClick={() => setShowSidebar(false)} className="text-slate-400 hover:text-slate-700 text-xs">✕</button>
          </div>
          <div className="px-3 py-2 text-[10px] text-slate-500 leading-relaxed border-b border-slate-100 bg-amber-50">
            Click any service → preview → send to current thread.
            Updates the lead's interest field too.
          </div>

          {/* ── Re-engage client: reopen a closed 24h WhatsApp window ── */}
          {/* Outside the 24h window WhatsApp drops normal messages. This sends an
              approved template that always delivers and asks the client to reply,
              which reopens the chat so your messages go through. */}
          <div className="px-3 py-2.5 border-b border-slate-200 bg-white">
            <button
              onClick={() => thread && reengage(thread)}
              disabled={!thread || reengaging}
              title={!thread ? "Open a conversation first" : "If the client hasn't replied in 24h, WhatsApp blocks normal messages. This sends an approved 'please reply' message that always delivers and reopens the chat."}
              className="w-full rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {reengaging ? "Sending…" : "🔔 Re-engage client (ask to reply)"}
            </button>
            <p className="mt-1 text-[10px] text-slate-400 leading-snug">
              Use when your messages aren’t delivering — the chat closes 24h after the client’s last reply.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {/* Group by category for cleaner browsing */}
            {(["work", "study", "visit", "pr", "other"] as const).map(cat => {
              const inCat = services.filter(s => s.category === cat);
              if (inCat.length === 0) return null;
              const catLabel = cat === "work" ? "Work Permits"
                : cat === "study" ? "Study"
                : cat === "visit" ? "Visit / Super Visa"
                : cat === "pr" ? "PR / Sponsorship"
                : "Other";
              return (
                <div key={cat} className="mb-3">
                  <p className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{catLabel}</p>
                  {inCat.map(svc => (
                    <button
                      key={svc.key}
                      disabled={!thread || sending}
                      onClick={() => {
                        if (!thread) return;
                        setPreviewService({
                          key: svc.key,
                          displayName: svc.displayName,
                          emoji: svc.emoji,
                          message: svc.message || "",
                        });
                        setPreviewEditedMessage(svc.message || "");
                      }}
                      className="w-full px-3 py-2 text-left text-[11px] hover:bg-purple-50 disabled:opacity-50 flex items-start gap-2 group"
                      title={!thread ? "Open a conversation first" : `Send ${svc.displayName} checklist`}>
                      <span className="text-base shrink-0">{svc.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{svc.displayName.split("(")[0].trim()}</p>
                        <p className="text-[10px] text-slate-400 truncate">{svc.feeText}</p>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Sidebar collapsed → show toggle */}
      {!showSidebar && services.length > 0 && (
        <button
          onClick={() => setShowSidebar(true)}
          className="absolute right-3 top-3 z-10 rounded-lg bg-purple-600 text-white px-3 py-1.5 text-[11px] font-bold hover:bg-purple-700 shadow-md">
          📋 Checklists
        </button>
      )}

      {/* ── Preview modal: confirm-before-send for checklist quick actions ── */}
      {previewService && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => { setPreviewService(null); setPreviewEditedMessage(""); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-purple-700 px-4 py-3 flex items-center justify-between">
              <p className="text-sm font-bold text-white">
                {previewService.emoji} Send "{previewService.displayName.split("(")[0].trim()}" Checklist
              </p>
              <button onClick={() => { setPreviewService(null); setPreviewEditedMessage(""); }} className="text-white/70 hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-[11px] text-slate-600">
                Preview the message below. Edit anything you want, then click <strong>Send</strong> to deliver it to <strong>{thread ? threadName(thread) : "this client"}</strong>.
              </p>
              <textarea
                value={previewEditedMessage}
                onChange={e => setPreviewEditedMessage(e.target.value)}
                rows={16}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:border-purple-400 bg-slate-50"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => { setPreviewService(null); setPreviewEditedMessage(""); }}
                  disabled={sending}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const text = previewEditedMessage.trim();
                    if (!text || !thread) return;
                    setPreviewService(null);
                    setPreviewEditedMessage("");
                    await sendReply(text);
                  }}
                  disabled={sending || !previewEditedMessage.trim()}
                  className="rounded-lg bg-purple-600 text-white px-4 py-1.5 text-xs font-bold hover:bg-purple-700 disabled:opacity-50">
                  💬 Send to Client
                </button>
              </div>
            </div>
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
