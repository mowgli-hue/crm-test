"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type LoginViewProps = {
  onLoginSuccess: () => Promise<void>;
};

export function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [preAuthToken, setPreAuthToken] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [manualMfaKey, setManualMfaKey] = useState("");
  const [otpAuthUrl, setOtpAuthUrl] = useState("");
  const [mfaStep, setMfaStep] = useState<"none" | "setup" | "verify">("none");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteToken, setInviteToken] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload.mfaSetupRequired && payload.preAuthToken) {
          setPreAuthToken(String(payload.preAuthToken));
          const setupRes = await apiFetch("/auth/mfa/setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preAuthToken: String(payload.preAuthToken) })
          });
          const setupPayload = await setupRes.json().catch(() => ({}));
          if (!setupRes.ok) {
            setError(setupPayload.error ?? "MFA setup failed");
            return;
          }
          setSetupToken(String(setupPayload.setupToken || ""));
          setManualMfaKey(String(setupPayload.manualKey || ""));
          setOtpAuthUrl(String(setupPayload.otpauthUrl || ""));
          setMfaStep("setup");
          setError("");
          return;
        }
        if (payload.mfaRequired && payload.preAuthToken) {
          setPreAuthToken(String(payload.preAuthToken));
          setMfaStep("verify");
          setError("Enter your authenticator code to continue.");
          return;
        }
        setError(payload.error ?? "Login failed");
        return;
      }

      await onLoginSuccess();
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaEnable(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await apiFetch("/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupToken, code: mfaCode })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not enable MFA.");
        return;
      }
      setMfaCode("");
      setMfaStep("none");
      await onLoginSuccess();
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaVerify(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await apiFetch("/auth/mfa/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preAuthToken, code: mfaCode })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "MFA verification failed.");
        return;
      }
      setMfaCode("");
      setMfaStep("none");
      await onLoginSuccess();
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <h1 className="text-xl font-semibold text-ink">Sign In</h1>
      <p className="mt-1 text-sm text-slate-600">Use your workspace account to open CRM simple mode.</p>

      {mfaStep === "none" ? (
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="email"
              required
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Password or today's access code</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="password"
              required
            />
            <span className="mt-1 block text-[11px] text-slate-400">Staff: enter today's office access code. Sign in with your own email so your work is tracked to you.</span>
          </label>

          {error ? <p className="text-xs text-danger">{error}</p> : null}

          <button
            disabled={loading}
            className="w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            type="submit"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      ) : null}

      {mfaStep === "setup" ? (
        <form className="mt-4 space-y-3" onSubmit={handleMfaEnable}>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-800">Set up MFA (Authenticator app)</p>
            <p className="mt-1">1. Open Google Authenticator / Microsoft Authenticator.</p>
            <p>2. Add account manually with this key:</p>
            <p className="mt-1 break-all rounded bg-white p-2 font-mono text-[11px]">{manualMfaKey || "-"}</p>
            {otpAuthUrl ? (
              <a href={otpAuthUrl} className="mt-2 inline-block text-blue-700 underline">
                Open Authenticator Link
              </a>
            ) : null}
          </div>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Enter 6-digit code</span>
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              inputMode="numeric"
              required
            />
          </label>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <button
            disabled={loading}
            className="w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            type="submit"
          >
            {loading ? "Enabling MFA..." : "Enable MFA and Continue"}
          </button>
        </form>
      ) : null}

      {mfaStep === "verify" ? (
        <form className="mt-4 space-y-3" onSubmit={handleMfaVerify}>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Authenticator code</span>
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              inputMode="numeric"
              required
            />
          </label>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <button
            disabled={loading}
            className="w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            type="submit"
          >
            {loading ? "Verifying..." : "Verify and Sign In"}
          </button>
        </form>
      ) : null}

      <div className="mt-3 rounded-lg border border-slate-200 p-3">
        <p className="text-xs font-semibold text-slate-600">Have client invite token?</p>
        <div className="mt-2 flex gap-2">
          <input
            value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Paste invite token"
          />
          <a
            href={inviteToken.trim() ? `/invite/${inviteToken.trim()}` : "#"}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
          >
            Open
          </a>
        </div>
      </div>
    </section>
  );
}
