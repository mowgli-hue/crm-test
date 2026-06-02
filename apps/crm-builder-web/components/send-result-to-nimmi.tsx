"use client";

// ─────────────────────────────────────────────────────────────────────
// Send Result to Nimmi
//
// Staff workflow:
//   1. Type the application number → the form looks up the case and shows the
//      matched CLIENT NAME + masked phone so staff can confirm who it goes to.
//   2. If the client is older / not in the CRM (no match), staff enter the
//      phone number manually.
//   3. Attach the result PDF, pick the result type, hit Send.
//
// The real phone is re-fetched server-side at send time (the masked preview is
// only for confirmation). A manually-typed phone overrides the lookup.
//
// Self-contained: posts multipart/form-data to /api/results/send-to-nimmi with
// the session cookie (same-origin). Inline styles, no CSS dependency.
// ─────────────────────────────────────────────────────────────────────

import React, { useState } from "react";

const RESULT_TYPES: { value: string; label: string }[] = [
  { value: "approval", label: "Approval 🎉" },
  { value: "refusal", label: "Refusal" },
  { value: "submission", label: "Submission confirmation" },
  { value: "request_letter", label: "Request / extension letter" },
  { value: "passport_request", label: "Passport request" },
  { value: "biometrics", label: "Biometrics" },
  { value: "medical", label: "Medical" },
  { value: "aor", label: "AOR (acknowledgement of receipt)" },
  { value: "additional_docs", label: "Additional documents requested" },
  { value: "other", label: "Other update" },
];

type SendResult = {
  ok: boolean;
  shareUrl?: string;
  whatsappSent?: boolean;
  matchedToUser?: boolean;
  error?: string;
};

type Lookup =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "error"; message: string }
  | { status: "found"; clientName: string; formType: string; hasPhone: boolean; phone: string; phoneLast4: string; matchedBy: string };

const box: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, background: "#fff", maxWidth: 560 };
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#475569", margin: "10px 0 4px" };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };

export default function SendResultToNimmi() {
  const [file, setFile] = useState<File | null>(null);
  const [clientName, setClientName] = useState("");
  const [appNumber, setAppNumber] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [resultType, setResultType] = useState("approval");
  const [rcicNote, setRcicNote] = useState("");
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });

  // Look the case up so staff can confirm the client + see if a phone is on file.
  async function doLookup() {
    const app = appNumber.trim();
    const nm = clientName.trim();
    if (!app && !nm) { setLookup({ status: "idle" }); return; }
    setLookup({ status: "loading" });
    try {
      const qs = new URLSearchParams();
      if (app) qs.set("appNumber", app);
      if (nm) qs.set("name", nm);
      const res = await fetch(`/api/results/lookup-case?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setLookup({ status: "error", message: data.error || `Lookup failed (${res.status})` }); return; }
      if (!data.found) { setLookup({ status: "notfound" }); return; }
      // Auto-fill the client name from the matched case if staff left it blank.
      if (!nm && data.clientName) setClientName(data.clientName);
      setLookup({
        status: "found",
        clientName: data.clientName || "",
        formType: data.formType || "",
        hasPhone: Boolean(data.hasPhone),
        phone: data.phone || "",
        phoneLast4: data.phoneLast4 || "",
        matchedBy: data.matchedBy || "",
      });
    } catch (e) {
      setLookup({ status: "error", message: (e as Error).message });
    }
  }

  // Do we have a way to reach the client? Either a matched case with a phone, or
  // a manually-typed phone. Used to guard against sending into the void.
  const hasReachableContact = manualPhone.trim().length > 0 || (lookup.status === "found" && lookup.hasPhone);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!file) { setResult({ ok: false, error: "Attach the result file (PDF or image)." }); return; }
    if (!clientName.trim() && !appNumber.trim()) {
      setResult({ ok: false, error: "Enter the application number (or the client name)." });
      return;
    }
    if (!hasReachableContact) {
      setResult({ ok: false, error: "No phone found for this client. Type the client's phone in the 'Client phone' field below, then send." });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("clientName", clientName.trim());
      fd.append("appNumber", appNumber.trim());
      if (manualPhone.trim()) fd.append("phone", manualPhone.trim());
      fd.append("resultType", resultType);
      if (rcicNote.trim()) fd.append("rcicNote", rcicNote.trim());
      fd.append("sendWhatsApp", sendWhatsApp ? "true" : "false");

      const res = await fetch("/api/results/send-to-nimmi", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setResult({ ok: false, error: data.error || `Failed (HTTP ${res.status})` });
      } else {
        setResult({ ok: true, shareUrl: data.shareUrl, whatsappSent: data.whatsappSent, matchedToUser: data.matchedToUser });
        setFile(null); setClientName(""); setAppNumber(""); setManualPhone(""); setRcicNote("");
        setLookup({ status: "idle" });
        const el = document.getElementById("nimmi-result-file") as HTMLInputElement | null;
        if (el) el.value = "";
      }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={box}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>📨 Send result to client (via Nimmi)</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
        Enter the application number — we find the client and confirm their phone. For older clients we don't have on file, type the phone manually.
      </div>

      <form onSubmit={handleSubmit}>
        <label style={label}>Application number</label>
        <input
          style={input}
          value={appNumber}
          onChange={(e) => { setAppNumber(e.target.value); setLookup({ status: "idle" }); }}
          onBlur={doLookup}
          placeholder="e.g. W123456789"
        />

        <label style={label}>Client name {lookup.status === "found" ? "(matched ✓)" : "(or look up by name)"}</label>
        <input
          style={input}
          value={clientName}
          onChange={(e) => { setClientName(e.target.value); }}
          onBlur={() => { if (!appNumber.trim()) doLookup(); }}
          placeholder="e.g. Lavisha Singh"
        />

        {/* Match preview — careful confirmation of who this goes to */}
        {lookup.status === "loading" && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>Looking up case…</div>
        )}
        {lookup.status === "found" && (
          <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", fontSize: 13, color: "#166534" }}>
            ✓ Matched <strong>{lookup.clientName}</strong>{lookup.formType ? ` · ${lookup.formType}` : ""}
            {" · "}
            {lookup.hasPhone
              ? <>📱 <strong>+{lookup.phone || lookup.phoneLast4}</strong></>
              : <span style={{ color: "#b45309" }}>⚠️ no phone on file — enter one below</span>}
            <div style={{ fontSize: 11, color: "#15803d", marginTop: 2 }}>Matched by {lookup.matchedBy === "name" ? "client name" : "application number"}. Confirm this is the right person before sending.</div>
          </div>
        )}
        {lookup.status === "notfound" && (
          <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", fontSize: 13, color: "#92400e" }}>
            ⚠️ No case found in the CRM for that application number / name. This client may be older — <strong>enter their phone number manually</strong> below.
          </div>
        )}
        {lookup.status === "error" && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#b91c1c" }}>Lookup error: {lookup.message}. You can still enter a phone manually and send.</div>
        )}

        <label style={label}>Client phone {lookup.status === "found" && lookup.hasPhone ? "(optional — leave blank to use the one on file)" : "(required for older clients not in the CRM)"}</label>
        <input
          style={input}
          value={manualPhone}
          onChange={(e) => setManualPhone(e.target.value)}
          placeholder="e.g. +1 778 999 8888"
        />

        <label style={label}>Result type</label>
        <select style={input} value={resultType} onChange={(e) => setResultType(e.target.value)}>
          {RESULT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        <label style={label}>Result file (PDF / image)</label>
        <input
          id="nimmi-result-file"
          type="file"
          accept=".pdf,image/jpeg,image/png,image/heic"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={input}
        />

        <label style={label}>Note to client (optional)</label>
        <input style={input} value={rcicNote} onChange={(e) => setRcicNote(e.target.value)} placeholder="e.g. Congratulations on your approval!" />

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155", margin: "12px 0 4px" }}>
          <input type="checkbox" checked={sendWhatsApp} onChange={(e) => setSendWhatsApp(e.target.checked)} />
          Also text the link to the client over WhatsApp
        </label>

        <button
          type="submit"
          disabled={busy}
          style={{ marginTop: 10, padding: "9px 18px", background: busy ? "#94a3b8" : "#dc2626", color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 14, cursor: busy ? "default" : "pointer" }}
        >
          {busy ? "Sending…" : "Send result"}
        </button>
      </form>

      {result && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 8, fontSize: 13, background: result.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`, color: result.ok ? "#166534" : "#991b1b", wordBreak: "break-word" }}>
          {result.ok ? (
            <>
              <div style={{ fontWeight: 700 }}>✅ Sent to Nimmi.</div>
              <div style={{ marginTop: 4 }}>Link: <a href={result.shareUrl} target="_blank" rel="noreferrer" style={{ color: "#0369a1" }}>{result.shareUrl}</a></div>
              <div style={{ marginTop: 4 }}>WhatsApp: {result.whatsappSent ? "sent to client ✓" : "not sent"} · Nimmi account match: {result.matchedToUser ? "yes" : "not yet (they'll claim it after sign-up)"}</div>
            </>
          ) : (
            <div><strong>Couldn't send:</strong> {result.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
