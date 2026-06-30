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
  // Passwordless morning check-in (office code + personal PIN).
  // Default to password/code mode (always works). Check-in mode (office code +
  // PIN) is opt-in via the toggle and only succeeds once CHECKIN_PIN_LOGIN is on.
  const [mode, setMode] = useState<"password" | "checkin">("password");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  // First-time PIN setup (server returned mustSetPin after a valid code).
  const [needPinSetup, setNeedPinSetup] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");

  async function handleSetPin(event: FormEvent) {
    event.preventDefault();
    setError("");
    const clean = newPin.replace(/\D/g, "");
    if (clean.length < 4 || clean.length > 6) { setError("PIN must be 4–6 digits."); return; }
    if (clean !== newPin2.replace(/\D/g, "")) { setError("PINs don't match."); return; }
    setLoading(true);
    try {
      const res = await apiFetch("/me/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: clean }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        setError(p.error ?? "Could not set PIN.");
        return;
      }
      setNeedPinSetup(false);
      await onLoginSuccess();
    } finally { setLoading(false); }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const loginBody = mode === "checkin"
        ? { email, code, pin }
        : { email, password };
      const response = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginBody)
      });

      if (response.ok) {
        const okPayload = await response.json().catch(() => ({}));
        if (okPayload.mustSetPin) {
          // Signed in on a valid code but no PIN yet — force them to set one.
          setNeedPinSetup(true);
          setError("");
          return;
        }
        await onLoginSuccess();
        return;
      }

      {
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

  const greetHour = new Date().getHours();
  const greeting = greetHour < 12 ? "Good morning" : greetHour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-4xl ring-1 ring-white/20">🍁</div>
          <h1 className="text-2xl font-bold text-white">{greeting} 👋</h1>
          <p className="mt-1 text-sm text-slate-300">Welcome to <span className="font-semibold text-white">Newton Agent</span> — your immigration workspace. How are you today? Let's get the day started.</p>
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <h2 className="text-base font-bold text-slate-900">Check in to start your day</h2>
          <p className="mt-1 text-xs text-slate-500">Sign in with your own account so your work is tracked to you.</p>

      {/* First-time PIN setup (signed in on a valid code, no PIN yet) */}
      {needPinSetup ? (
        <form className="mt-4 space-y-3" onSubmit={handleSetPin}>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800">
            ✅ You're checked in. Set a personal 4–6 digit PIN — you'll use it with the daily office code to check in each morning. Keep it private.
          </div>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">New PIN (4–6 digits)</span>
            <input value={newPin} onChange={(e) => setNewPin(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" inputMode="numeric" type="password" required />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Confirm PIN</span>
            <input value={newPin2} onChange={(e) => setNewPin2(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" inputMode="numeric" type="password" required />
          </label>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <button disabled={loading} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60" type="submit">
            {loading ? "Saving…" : "Save PIN & continue"}
          </button>
        </form>
      ) : mfaStep === "none" ? (
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

          {mode === "checkin" ? (
            <>
              <label className="block text-sm">
                <span className="text-xs font-medium text-slate-600">Today's office code</span>
                <input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" inputMode="numeric" required />
              </label>
              <label className="block text-sm">
                <span className="text-xs font-medium text-slate-600">Your PIN</span>
                <input value={pin} onChange={(e) => setPin(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" inputMode="numeric" type="password" />
                <span className="mt-1 block text-[11px] text-slate-400">First time? Leave PIN blank — you'll set one after the code checks out.</span>
              </label>
            </>
          ) : (
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Password or today's access code</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                type="password"
                required
              />
              <span className="mt-1 block text-[11px] text-slate-400">Sign in with your own email so your work is tracked to you.</span>
            </label>
          )}

          {error ? <p className="text-xs text-danger">{error}</p> : null}

          <button
            disabled={loading}
            className="w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            type="submit"
          >
            {loading ? "Signing in..." : mode === "checkin" ? "Check in" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => { setMode(mode === "checkin" ? "password" : "checkin"); setError(""); }}
            className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600"
          >
            {mode === "checkin" ? "Use password instead" : "Check in with office code + PIN"}
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
        <p className="mt-4 text-center text-[11px] text-slate-400">Newton Immigration · RCIC R-705964</p>
      </div>
    </div>
  );
}
