"use client";

// ─────────────────────────────────────────────────────────────────────
// Send Result to Nimmi
//
// Staff workflow: attach the IRCC result PDF, type the client's name and/or
// application number, pick the result type, hit Send. The CRM looks up the
// case (by application number, then name) to auto-fill the client's phone, then
// pushes the result to Nimmi, gets back a secure magic link, and (by default)
// texts it to the client over WhatsApp.
//
// Self-contained: posts multipart/form-data to /api/results/send-to-nimmi with
// the session cookie (same-origin). Inline styles so it has no CSS dependency.
// ─────────────────────────────────────────────────────────────────────

import React, { useState } from "react";

const RESULT_TYPES: { value: string; label: string }[] = [
  { value: "approval", label: "Approval 🎉" },
  { value: "refusal", label: "Refusal" },
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

const box: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: 16,
  background: "#fff",
  maxWidth: 560,
};
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#475569", margin: "10px 0 4px" };
const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

export default function SendResultToNimmi() {
  const [file, setFile] = useState<File | null>(null);
  const [clientName, setClientName] = useState("");
  const [appNumber, setAppNumber] = useState("");
  const [resultType, setResultType] = useState("approval");
  const [rcicNote, setRcicNote] = useState("");
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!file) { setResult({ ok: false, error: "Attach the result file (PDF or image)." }); return; }
    if (!clientName.trim() && !appNumber.trim()) {
      setResult({ ok: false, error: "Enter the client name and/or the application number." });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("clientName", clientName.trim());
      fd.append("appNumber", appNumber.trim());
      fd.append("resultType", resultType);
      if (rcicNote.trim()) fd.append("rcicNote", rcicNote.trim());
      fd.append("sendWhatsApp", sendWhatsApp ? "true" : "false");

      const res = await fetch("/api/results/send-to-nimmi", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setResult({ ok: false, error: data.error || `Failed (HTTP ${res.status})` });
      } else {
        setResult({ ok: true, shareUrl: data.shareUrl, whatsappSent: data.whatsappSent, matchedToUser: data.matchedToUser });
        setFile(null);
        setClientName("");
        setAppNumber("");
        setRcicNote("");
        // reset the native file input
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
        Attach the result, enter the name and/or application number — we fetch the client's contact from the case and text them a secure link.
      </div>

      <form onSubmit={handleSubmit}>
        <label style={label}>Result file (PDF / image)</label>
        <input
          id="nimmi-result-file"
          type="file"
          accept=".pdf,image/jpeg,image/png,image/heic"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={input}
        />

        <label style={label}>Client name</label>
        <input style={input} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Lavisha Singh" />

        <label style={label}>Application number</label>
        <input style={input} value={appNumber} onChange={(e) => setAppNumber(e.target.value)} placeholder="e.g. W123456789" />

        <label style={label}>Result type</label>
        <select style={input} value={resultType} onChange={(e) => setResultType(e.target.value)}>
          {RESULT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <label style={label}>Note to client (optional)</label>
        <input style={input} value={rcicNote} onChange={(e) => setRcicNote(e.target.value)} placeholder="e.g. Congratulations on your approval!" />

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155", margin: "12px 0 4px" }}>
          <input type="checkbox" checked={sendWhatsApp} onChange={(e) => setSendWhatsApp(e.target.checked)} />
          Also send the link to the client over WhatsApp
        </label>

        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 10,
            padding: "9px 18px",
            background: busy ? "#94a3b8" : "#dc2626",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 14,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Sending…" : "Send result"}
        </button>
      </form>

      {result && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 8,
            fontSize: 13,
            background: result.ok ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`,
            color: result.ok ? "#166534" : "#991b1b",
            wordBreak: "break-word",
          }}
        >
          {result.ok ? (
            <>
              <div style={{ fontWeight: 700 }}>✅ Sent to Nimmi.</div>
              <div style={{ marginTop: 4 }}>
                Link: <a href={result.shareUrl} target="_blank" rel="noreferrer" style={{ color: "#0369a1" }}>{result.shareUrl}</a>
              </div>
              <div style={{ marginTop: 4 }}>
                WhatsApp: {result.whatsappSent ? "sent to client ✓" : "not sent (no phone on file, or WhatsApp send off)"} ·{" "}
                Matched to a Nimmi account: {result.matchedToUser ? "yes" : "not yet (they'll claim it after sign-up)"}
              </div>
            </>
          ) : (
            <div><strong>Couldn't send:</strong> {result.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
