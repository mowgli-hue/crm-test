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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

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

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch("/admin/alert-recipients/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setTestResult(d);
    } catch (e) { setTestResult({ ok: false, summary: String(e) }); }
    setTesting(false);
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

        {/* Test button — fires a real alert and reports exactly what WhatsApp said */}
        <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
          <button
            onClick={sendTest}
            disabled={testing || recipients.length === 0}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            {testing ? "Sending…" : "🧪 Send test alert"}
          </button>
          <span className="text-[11px] text-slate-400">
            Sends a real test ping to everyone above and shows what happened.
          </span>
        </div>

        {testResult && (
          <div className={`rounded-xl border p-3 text-xs ${testResult.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
            <p className={`font-bold ${testResult.ok ? "text-emerald-700" : "text-red-700"}`}>
              {testResult.summary || testResult.reason || (testResult.ok ? "Sent" : "Failed")}
            </p>
            {testResult.config && (
              <p className="mt-1 text-slate-500">
                Recipients: {testResult.config.totalRecipients ?? 0} · Template:{" "}
                {testResult.config.templateConfigured
                  ? <span className="text-emerald-700 font-medium">{testResult.config.templateName} ✓</span>
                  : <span className="text-red-600 font-medium">not configured — alerts can only use free-form text (24h window)</span>}
              </p>
            )}
            {Array.isArray(testResult.results) && testResult.results.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {testResult.results.map((r: any, i: number) => (
                  <li key={i} className="rounded-lg bg-white/70 px-2 py-1.5">
                    <span className="font-semibold text-slate-700">+{r.to}</span>{" "}
                    {r.delivered
                      ? <span className="text-emerald-700">delivered{r.template?.sent ? " (template)" : " (text)"}</span>
                      : <span className="text-red-600">not delivered</span>}
                    {r.template?.error && <div className="text-slate-500">template: {r.template.error}</div>}
                    {r.freeFormText?.error && <div className="text-slate-500">text: {r.freeFormText.error}</div>}
                    {r.note && <div className="text-amber-700 mt-0.5">{r.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
