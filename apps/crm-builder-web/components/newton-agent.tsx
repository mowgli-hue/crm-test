"use client";
import { useState, useRef, useEffect } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; type: string; data: string }[];
  timestamp: Date;
};

export function NewtonAgent({ sessionUser }: { sessionUser: any }) {
  const [messages, setMessages] = useState<Message[]>([{
    id: "welcome",
    role: "assistant",
    content: `Hi ${sessionUser?.name?.split(" ")[0] || "there"}! 👋 I'm Newton AI — your immigration expert assistant.\n\nI know all your active cases, IRCC rules, fees, processing times, and can help you:\n\n• 📋 Draft rep letters, LOEs, cover letters\n• 🔍 Check case status and flag urgent ones\n• 📱 Write WhatsApp messages to clients (English & Punjabi)\n• ✅ Generate document checklists\n• 📰 Get latest IRCC news\n• 💡 Strategy for refusals\n\nWhat do you need help with?`,
    timestamp: new Date()
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<{ name: string; type: string; data: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const processFile = async (file: File) => {
    return new Promise<{ name: string; type: string; data: string }>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = (e.target?.result as string).split(",")[1] || "";
        resolve({ name: file.name, type: file.type, data });
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const processed = await Promise.all(Array.from(files).map(processFile));
    setAttachments(prev => [...prev, ...processed]);
  };

  const sendMessage = async () => {
    if (!input.trim() && attachments.length === 0) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setAttachments([]);
    setLoading(true);

    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const messageContent: any[] = [];
      if (userMsg.attachments) {
        for (const att of userMsg.attachments) {
          if (att.type.includes("image")) {
            messageContent.push({ type: "image", source: { type: "base64", media_type: att.type, data: att.data } });
          } else if (att.type.includes("pdf")) {
            messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: att.data } });
          }
        }
      }
      if (userMsg.content) messageContent.push({ type: "text", text: userMsg.content });

      const res = await fetch("/api/newton-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageContent.length === 1 && messageContent[0].type === "text"
            ? userMsg.content
            : messageContent,
          history
        })
      });
      const data = await res.json() as any;
      setMessages(prev => [...prev, {
        id: Date.now().toString() + "r",
        role: "assistant",
        content: data.reply || data.error || "Something went wrong.",
        timestamp: new Date()
      }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: "err", role: "assistant", content: "Connection error. Please try again.", timestamp: new Date() }]);
    }
    setLoading(false);
  };

  const quickActions = [
    { label: "🚨 Urgent cases", msg: "Show me all urgent cases and permits expiring soon" },
    { label: "📰 IRCC news", msg: "What are the latest IRCC immigration updates today?" },
    { label: "✉️ Draft LOE", msg: "Help me draft a Letter of Explanation for a TRV refusal" },
    { label: "📋 PGWP checklist", msg: "Generate a complete PGWP document checklist" },
    { label: "📱 Client message", msg: "Write a WhatsApp message asking client for missing documents" },
    { label: "ਪੰਜਾਬੀ", msg: "ਕਿਰਪਾ ਕਰਕੇ ਮੈਨੂੰ ਇੱਕ ਕੇਸ ਬਾਰੇ ਦੱਸੋ" },
  ];

  const formatMessage = (content: string) => {
    return content.split("\n").map((line, i) => {
      if (line.startsWith("## ")) return <h3 key={i} className="text-sm font-bold mt-3 mb-1">{line.replace("## ", "")}</h3>;
      if (line.startsWith("### ")) return <h4 key={i} className="text-sm font-semibold mt-2">{line.replace("### ", "")}</h4>;
      if (line.match(/^[•\-\*]\s/)) return <div key={i} className="flex gap-2 text-sm"><span className="text-slate-400 mt-0.5">•</span><span>{line.replace(/^[•\-\*]\s/, "")}</span></div>;
      if (line.match(/^\d+\./)) return <div key={i} className="text-sm ml-2">{line}</div>;
      if (!line.trim()) return <div key={i} className="h-2" />;
      const parts = line.split(/\*\*([^*]+)\*\*/g);
      if (parts.length > 1) return <p key={i} className="text-sm">{parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}</p>;
      return <p key={i} className="text-sm">{line}</p>;
    });
  };

  return (
    <div className="flex flex-col h-full bg-white relative"
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}>

      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-900 text-white shrink-0">
        <div className="h-8 w-8 rounded-full bg-red-600 flex items-center justify-center text-sm font-bold">N</div>
        <div>
          <p className="text-sm font-bold">Newton AI</p>
          <p className="text-[10px] text-slate-400">Immigration Expert · RCIC Knowledge Base</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-slate-400">Online</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            {msg.role === "assistant" && (
              <div className="h-7 w-7 rounded-full bg-red-600 flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5">N</div>
            )}
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${msg.role === "user" ? "bg-slate-900 text-white rounded-br-sm" : "bg-slate-50 text-slate-900 rounded-bl-sm border border-slate-100"}`}>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {msg.attachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-white/10 rounded-lg px-2 py-1">
                      <span className="text-xs">{att.type.includes("image") ? "🖼️" : "📄"}</span>
                      <span className="text-xs truncate max-w-[120px]">{att.name}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className={`${msg.role === "user" ? "text-sm text-white" : "text-slate-800"} leading-relaxed`}>
                {msg.role === "assistant" ? formatMessage(msg.content) : <p className="text-sm">{msg.content}</p>}
              </div>
              <p className={`text-[10px] mt-1.5 ${msg.role === "user" ? "text-slate-400 text-right" : "text-slate-400"}`}>
                {msg.timestamp.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="h-7 w-7 rounded-full bg-red-600 flex items-center justify-center text-xs font-bold text-white shrink-0">N</div>
            <div className="bg-slate-50 border border-slate-100 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1.5 items-center h-5">
                {[0,150,300].map(d => <div key={d} className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{animationDelay:`${d}ms`}} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2 shrink-0">
          {quickActions.map(a => (
            <button key={a.label} onClick={() => { setInput(a.msg); textareaRef.current?.focus(); }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-red-300 hover:text-red-600 transition-colors">
              {a.label}
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2 shrink-0">
          {attachments.map((att, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2 py-1">
              <span className="text-xs">{att.type.includes("image") ? "🖼️" : "📄"}</span>
              <span className="text-xs text-slate-600 truncate max-w-[100px]">{att.name}</span>
              <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500 text-xs ml-1">✕</button>
            </div>
          ))}
        </div>
      )}

      {dragOver && (
        <div className="absolute inset-0 bg-red-50 border-2 border-dashed border-red-400 z-10 flex items-center justify-center">
          <p className="text-red-600 font-semibold">Drop files here to attach</p>
        </div>
      )}

      <div className="px-4 py-3 border-t border-slate-100 bg-white shrink-0">
        <div className="flex gap-2 items-end bg-slate-50 rounded-2xl border border-slate-200 px-3 py-2 focus-within:border-red-400 transition-colors">
          <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt" className="hidden"
            onChange={e => handleFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} className="text-slate-400 hover:text-red-500 transition-colors shrink-0 mb-1" title="Attach file">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask Newton anything... (Shift+Enter for new line)"
            rows={1} style={{ resize: "none" }}
            className="flex-1 bg-transparent text-sm outline-none text-slate-900 placeholder-slate-400 max-h-32" />
          <button onClick={sendMessage} disabled={loading || (!input.trim() && attachments.length === 0)}
            className="bg-red-600 text-white rounded-xl p-2 hover:bg-red-700 disabled:opacity-40 shrink-0 transition-colors mb-0.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-slate-400 text-center mt-1.5">Attach passports, refusal letters, docs — Newton can read them</p>
      </div>
    </div>
  );
}
