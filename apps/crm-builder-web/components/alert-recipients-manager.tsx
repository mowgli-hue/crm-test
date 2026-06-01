import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Recipient = { id: string; phone: string; label: string; active: boolean; createdAt: string };

// Admin screen to manage who gets a WhatsApp ping when the marketing bot hits an
// important moment (office visit, blocked office-presence fabrication, frustrated
// client, ready-to-pay lead). Self-contained — drop it anywhere in the admin UI.
export default function AlertRecipientsManager() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await apiFetch("/admin/alert-recipients");
      const d = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(d.recipients)) setRecipients(d.recipients);
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    setError("");
    const p = phone.replace(/\D/g, "");
    if (p.length < 10) { setError("Enter the full number with country code — e.g. 16049071276"); return; }
    setBusy(true);
    try {
      const res = await apiFetch("/admin/alert-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: p, label }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setRecipients(d.recipients || []); setPhone(""); setLabel(""); }
      else setError(d.error || "Could not add recipient");
    } catch (e) { setError(String(e)); }
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/admin/alert-recipients?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setRecipients(d.recipients || []);
    } catch { /* ignore */ }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-slate-900">
        <h2 className="text-base font-bold text-white">🔔 Alert recipients</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Who gets a WhatsApp ping when the bot hits an important moment — an office
          visit, a frustrated client, or someone ready to pay.
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* List */}
        {recipients.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No recipients yet. Add a number below.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {recipients.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{r.label}</p>
                  <p className="text-xs text-slate-500">+{r.phone}{r.active ? "" : " · (inactive)"}</p>
                </div>
                <button
                  onClick={() => remove(r.id)}
                  disabled={busy}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Add form */}
        <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr_auto] items-start">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name (e.g. Navdeep)"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-slate-400 focus:bg-white focus:outline-none"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Number with country code (16049071276)"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-slate-400 focus:bg-white focus:outline-none"
          />
          <button
            onClick={add}
            disabled={busy}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap"
          >
            + Add
          </button>
        </div>
        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Tip: for guaranteed delivery regardless of the 24-hour window, set up the
          approved <code className="text-slate-500">owner_office_alert</code> template
          (env <code className="text-slate-500">OWNER_ALERT_TEMPLATE_NAME</code>).
          Without it, alerts fall back to a normal message.
        </p>
      </div>
    </div>
  );
}
