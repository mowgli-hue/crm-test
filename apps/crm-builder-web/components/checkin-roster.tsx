"use client";
import { useEffect, useState } from "react";

interface Entry { userId: string; name: string; role?: string; checkedInAt?: string }
interface Props { apiFetch: (p: string, init?: RequestInit) => Promise<Response> }

export default function CheckinRoster({ apiFetch }: Props) {
  const [checkedIn, setCheckedIn] = useState<Entry[]>([]);
  const [notYet, setNotYet] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const r = await apiFetch("/admin/checkin-roster");
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setCheckedIn(d.checkedIn || []); setNotYet(d.notYet || []); }
    } catch { /* noop */ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); const t = setInterval(load, 120000); return () => clearInterval(t); /* eslint-disable-next-line */ }, []);

  const time = (iso?: string) => iso ? new Date(iso).toLocaleTimeString("en-CA", { timeZone: "America/Vancouver", hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800">🕘 Morning check-in — today</h3>
        <span className="text-xs font-semibold text-slate-500">{checkedIn.length} in · {notYet.length} not yet</span>
      </div>
      {loading ? (
        <p className="mt-2 text-xs text-slate-400">Loading…</p>
      ) : (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">✅ Checked in</p>
            <ul className="mt-1 space-y-0.5">
              {checkedIn.length === 0 ? <li className="text-xs text-slate-400">No one yet.</li> :
                checkedIn.map((e) => (
                  <li key={e.userId} className="flex justify-between text-sm"><span className="font-semibold text-slate-700">{e.name}</span><span className="text-xs text-slate-400">{time(e.checkedInAt)}</span></li>
                ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-rose-700">⛔ Not yet</p>
            <ul className="mt-1 space-y-0.5">
              {notYet.length === 0 ? <li className="text-xs text-emerald-600">Everyone's in 🎉</li> :
                notYet.map((e) => (
                  <li key={e.userId} className="text-sm font-semibold text-slate-500">{e.name}{e.role ? <span className="text-[11px] text-slate-400"> · {e.role}</span> : null}</li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
