"use client";

// ─────────────────────────────────────────────────────────────────────
// Today's shared office access code — Admin only.
// Shows the code so the owner can read it out / share it, plus a one-click
// regenerate (if it leaks) and re-email. Self-hides for non-admins and when
// daily-code login isn't enabled.
//   <DailyCodeCard apiFetch={apiFetch} />
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export default function DailyCodeCard({ apiFetch }: { apiFetch: ApiFetch }) {
  const [code, setCode] = useState("");
  const [dayKey, setDayKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/admin/daily-code`);
      if (res.status === 403) { setForbidden(true); return; }
      if (!res.ok) return;
      const d = await res.json();
      setCode(d.code || ""); setDayKey(d.dayKey || ""); setEnabled(!!d.enabled);
    } catch { /* ignore */ }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (body: any, okMsg: string) => {
    setBusy(true); setMsg("");
    try {
      const res = await apiFetch(`/admin/daily-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setCode(d.code || code); setDayKey(d.dayKey || dayKey); setMsg(okMsg + (d.email?.sent ? " · emailed" : "")); }
      else setMsg(d.error || "Failed");
    } catch (e: any) { setMsg(e?.message || "Failed"); }
    finally { setBusy(false); }
  }, [apiFetch, code, dayKey]);

  if (forbidden) return null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold">🔑 Today's office access code
            {!enabled && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">not enforced yet</span>}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">{dayKey} · staff sign in with their own email + this code, instead of a password. Expires tonight.</p>
        </div>
        <div className="text-3xl font-bold tracking-[0.3em] tabular-nums">{code || "······"}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => act({ email: true }, "Sent")} disabled={busy} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 disabled:opacity-50">Email it to me</button>
        <button onClick={() => act({ regenerate: true, email: true }, "New code issued")} disabled={busy} className="rounded-lg bg-rose-500/80 px-3 py-1.5 text-xs font-semibold hover:bg-rose-500 disabled:opacity-50">Regenerate (if leaked)</button>
        {msg && <span className="text-xs text-slate-300">{msg}</span>}
      </div>
      {!enabled && (
        <p className="mt-2 text-[11px] text-amber-300/90">To turn this on for everyone, set <code className="rounded bg-black/30 px-1">DAILY_CODE_LOGIN=true</code> in the server env. Until then, normal password login is unchanged and this code does nothing.</p>
      )}
    </div>
  );
}
