import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type VoiceRow = { id: number; guide: string; status: string; sampleCount: number; createdAt: string; approvedBy: string | null };

// Admin screen: teach the marketing bot how the office talks. "Learn" analyses
// past human-typed replies and drafts a voice guide; you review/edit it, then
// "Approve & apply" bakes it into the bot's prompt. Self-contained.
export default function OfficeVoiceManager() {
  const [active, setActive] = useState<VoiceRow | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftMeta, setDraftMeta] = useState<{ sampleCount: number; createdAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const res = await apiFetch("/admin/office-voice");
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setActive(d.active || null);
        if (d.draft) { setDraftText(d.draft.guide || ""); setDraftMeta({ sampleCount: d.draft.sampleCount, createdAt: d.draft.createdAt }); }
        else if (d.active && !draftText) { setDraftText(d.active.guide || ""); }
      }
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []);

  const learn = async () => {
    setBusy(true); setMsg(""); setErr("");
    try {
      const res = await apiFetch("/admin/office-voice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "learn" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.draft) {
        setDraftText(d.draft.guide || "");
        setDraftMeta({ sampleCount: d.draft.sampleCount, createdAt: d.draft.createdAt });
        setMsg(`Drafted from ${d.sampleCount} human replies — review below, edit if needed, then Approve & apply.`);
      } else {
        setErr(d.error || "Could not learn from conversations.");
      }
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  const approve = async () => {
    setBusy(true); setMsg(""); setErr("");
    try {
      const res = await apiFetch("/admin/office-voice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", guide: draftText, sampleCount: draftMeta?.sampleCount || 0 }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setActive(d.active || null); setMsg("✓ Approved — the bot now talks in this voice (live within ~5 min)."); }
      else setErr(d.error || "Could not approve.");
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-slate-900">
        <h2 className="text-base font-bold text-white">🗣️ Office voice (teach the bot how you talk)</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Learns from your team's own WhatsApp replies — language mix, tone, length,
          greetings — and makes the marketing bot sound like the office, not a chatbot.
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={learn}
            disabled={busy}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? "Working…" : "🔍 Learn office voice"}
          </button>
          {active && (
            <span className="text-[11px] text-emerald-600 font-medium">
              Active voice applied{active.approvedBy ? ` by ${active.approvedBy}` : ""} · {new Date(active.createdAt).toLocaleDateString()}
            </span>
          )}
          {!active && <span className="text-[11px] text-slate-400">No voice applied yet — bot uses default tone.</span>}
        </div>

        {msg && <p className="text-xs font-semibold text-emerald-700">{msg}</p>}
        {err && <p className="text-xs font-semibold text-red-600">{err}</p>}

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Voice guide {draftMeta ? `(drafted from ${draftMeta.sampleCount} replies — edit freely)` : "(edit, then approve)"}
          </label>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={16}
            placeholder="Click “Learn office voice” to draft this from past conversations…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono leading-relaxed focus:border-slate-400 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={approve}
            disabled={busy || draftText.trim().length < 20}
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            ✓ Approve &amp; apply
          </button>
          <span className="text-[11px] text-slate-400">
            Approving makes this the bot's live voice. It only changes HOW it talks — fees, safety, and stage rules stay enforced.
          </span>
        </div>
      </div>
    </div>
  );
}
