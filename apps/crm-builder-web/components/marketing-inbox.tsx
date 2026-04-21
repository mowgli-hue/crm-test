"use client";
import { useState, useEffect, useRef } from "react";

type Msg = {
  id: string; phone: string; message: string; direction: string;
  contact_name: string | null; is_read: boolean; created_at: string;
};

export function MarketingInbox({ sessionUser, apiFetch }: { sessionUser: any; apiFetch: any }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [thread, setThread] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editName, setEditName] = useState<Record<string, string>>({});
  const [showNameInput, setShowNameInput] = useState<string | null>(null);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all"|"unread"|"archived">("all");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const load = () => apiFetch("/marketing-inbox").then((r:any)=>r?.json()).then((d:any)=>{
    if(d.messages) setMessages(d.messages);
    setLoaded(true);
  }).catch(()=>setLoaded(true));

  useEffect(()=>{ load(); const t=setInterval(load,5000); return ()=>clearInterval(t); },[]);
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[thread,messages]);

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
          {/* Search */}
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="🔍 Search name, message, phone..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:outline-none focus:border-purple-400 mb-2" />
          {/* Filter tabs */}
          <div className="flex gap-1">
            {(["all","unread","archived"] as const).map(f=>(
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
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-900">{threadName(thread)}</p>
              <p className="text-[10px] text-slate-400">{thread} · Marketing inquiry</p>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>setShowNameInput(showNameInput===thread?null:thread)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50">✏️ Save Name</button>
              <button onClick={()=>setPinned(prev=>{const n=new Set(prev);n.has(thread)?n.delete(thread):n.add(thread);return n;})}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50">
                {pinned.has(thread)?"📌 Pinned":"📌 Pin"}
              </button>
              <button onClick={()=>setArchived(prev=>{const n=new Set(prev);n.has(thread)?n.delete(thread):n.add(thread);return n;})}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50">
                {archived.has(thread)?"📥 Unarchive":"📦 Archive"}
              </button>
            </div>
          </div>

          {/* Save name inline */}
          {showNameInput===thread && (
            <div className="px-4 py-2 bg-purple-50 border-b border-purple-100 flex gap-2 items-center">
              <span className="text-xs text-purple-700 font-semibold">Save name:</span>
              <input autoFocus placeholder="Client name..." defaultValue={threadName(thread)!==thread?threadName(thread):""}
                className="flex-1 rounded-lg border border-purple-200 px-2 py-1 text-xs focus:outline-none"
                onKeyDown={async e=>{if(e.key==="Enter"){await saveName(thread,(e.target as HTMLInputElement).value.trim());}}}
              />
              <button onClick={()=>setShowNameInput(null)} className="text-xs text-slate-400">✕</button>
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
    </div>
  );
}
