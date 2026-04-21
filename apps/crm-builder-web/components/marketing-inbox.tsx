"use client";
import { useState, useEffect, useRef } from "react";

type MarketingMessage = {
  id: string;
  phone: string;
  message: string;
  direction: string;
  contact_name: string | null;
  is_read: boolean;
  created_at: string;
};

export function MarketingInbox({ sessionUser, apiFetch }: { sessionUser: any; apiFetch: any }) {
  const [messages, setMessages] = useState<MarketingMessage[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch("/marketing-inbox").then((r: any) => r?.json()).then((d: any) => {
      setMessages(d.messages || []);
      setLoaded(true);
    }).catch(() => setLoaded(true));

    const timer = setInterval(() => {
      apiFetch("/marketing-inbox").then((r: any) => r?.json()).then((d: any) => {
        if (d.messages) setMessages(d.messages);
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread, messages]);

  // Build threads
  const threads: Record<string, MarketingMessage[]> = {};
  messages.forEach(m => {
    if (!threads[m.phone]) threads[m.phone] = [];
    threads[m.phone].push(m);
  });

  // Filter by search
  const filteredThreads = Object.entries(threads).filter(([phone, msgs]) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return phone.includes(q) || 
      msgs.some(m => m.message.toLowerCase().includes(q)) ||
      (msgs[0]?.contact_name || "").toLowerCase().includes(q);
  }).sort(([, a], [, b]) => {
    const aLast = new Date(a[a.length-1]?.created_at || 0).getTime();
    const bLast = new Date(b[b.length-1]?.created_at || 0).getTime();
    const aUnread = a.filter(m => !m.is_read && m.direction === "inbound").length;
    const bUnread = b.filter(m => !m.is_read && m.direction === "inbound").length;
    if (bUnread !== aUnread) return bUnread - aUnread;
    return bLast - aLast;
  });

  const activeMessages = activeThread ? 
    (threads[activeThread] || []).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) 
    : [];
  
  const activeName = activeThread ? 
    (threads[activeThread]?.[0]?.contact_name || activeThread) 
    : "";

  const sendReply = async () => {
    if (!reply.trim() || !activeThread) return;
    const text = reply.trim();
    setReply("");
    const res = await apiFetch("/marketing-inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: activeThread, message: text })
    });
    if (res?.ok) {
      setMessages(prev => [...prev, {
        id: `tmp-${Date.now()}`,
        phone: activeThread,
        message: text,
        direction: "outbound",
        contact_name: null,
        is_read: true,
        created_at: new Date().toISOString()
      }]);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Thread list */}
      <div className={`flex flex-col border-r border-slate-100 bg-white ${activeThread ? "hidden md:flex w-72 shrink-0" : "w-full md:w-72 shrink-0"}`}>
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-bold text-slate-900">📣 Marketing Inbox</p>
              <p className="text-[10px] text-slate-400">+1 236-501-3524 · New inquiries</p>
            </div>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search inquiries..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-400" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {!loaded && <p className="text-center text-xs text-slate-400 py-8">Loading...</p>}
          {loaded && filteredThreads.length === 0 && (
            <p className="text-center text-xs text-slate-400 py-8">No inquiries yet</p>
          )}
          {filteredThreads.map(([phone, msgs]) => {
            const lastMsg = [...msgs].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
            const unread = msgs.filter(m => !m.is_read && m.direction === "inbound").length;
            const name = msgs[0]?.contact_name || phone;
            const isActive = activeThread === phone;
            const lastIn = [...msgs].filter(m => m.direction === "inbound").sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
            const lastOut = [...msgs].filter(m => m.direction === "outbound").sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
            const needsReply = lastIn && (!lastOut || new Date(lastIn.created_at) > new Date(lastOut.created_at));
            const waitMins = needsReply ? Math.floor((Date.now() - new Date(lastIn.created_at).getTime()) / 60000) : null;
            const waitLabel = waitMins !== null ? (waitMins >= 60 ? `${Math.floor(waitMins/60)}h` : `${waitMins}m`) : null;

            return (
              <button key={phone} onClick={() => setActiveThread(phone)}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 ${isActive ? "bg-emerald-50 border-l-2 border-l-emerald-500" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-purple-100 flex items-center justify-center text-sm font-bold text-purple-700 shrink-0">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        {waitLabel && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${waitMins && waitMins >= 60 ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>{waitLabel}</span>}
                        {unread > 0 && <span className="h-4 w-4 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center">{unread}</span>}
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">
                      {needsReply ? "⚠️ Needs reply · " : lastMsg?.direction === "outbound" ? "You: " : ""}{lastMsg?.message?.slice(0, 40)}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat window */}
      {activeThread ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white shrink-0">
            <button onClick={() => setActiveThread(null)} className="md:hidden rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold">← Back</button>
            <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-sm font-bold text-purple-700">
              {activeName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">{activeName}</p>
              <p className="text-[10px] text-slate-400">{activeThread} · Marketing inquiry</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-[#f0f2f5]">
            {activeMessages.map((m, idx) => (
              <div key={m.id || idx} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[72%] rounded-2xl px-3.5 py-2.5 shadow-sm ${m.direction === "outbound" ? "bg-[#d9fdd3] rounded-br-sm" : "bg-white rounded-bl-sm border border-slate-100"}`}>
                  <p className="text-sm text-slate-900 whitespace-pre-wrap break-words">{m.message}</p>
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[10px] text-slate-400">
                      {new Date(m.created_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: "America/Vancouver" })}
                    </span>
                    {m.direction === "outbound" && <span className="text-[11px] text-blue-500">✓✓</span>}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Reply */}
          <div className="px-4 py-3 border-t border-slate-100 bg-white shrink-0">
            <div className="flex gap-2 items-end bg-slate-50 rounded-2xl border border-slate-200 px-3 py-2 focus-within:border-emerald-400">
              <textarea value={reply} onChange={e => setReply(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                placeholder={`Reply to ${activeName}...`}
                rows={1} style={{ resize: "none" }}
                className="flex-1 bg-transparent text-sm outline-none text-slate-900 placeholder-slate-400 max-h-32" />
              <button onClick={sendReply} disabled={!reply.trim()}
                className="bg-emerald-600 text-white rounded-xl p-2 hover:bg-emerald-700 disabled:opacity-40 shrink-0">
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
            <p className="text-2xl mb-2">📣</p>
            <p className="text-sm font-semibold text-slate-600">Select an inquiry</p>
            <p className="text-xs text-slate-400 mt-1">Marketing inquiries from +1 236-501-3524</p>
          </div>
        </div>
      )}
    </div>
  );
}
