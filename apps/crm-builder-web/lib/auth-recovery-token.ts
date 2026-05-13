/**
 * Centralized handling of AUTH_RECOVERY_TOKEN.
 *
 * Previously, every call site used the pattern:
 *   process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024"
 * which meant: if the env var was ever unset in production, the literal
 * string "newton-recovery-2024" - which is in the source code - became a
 * valid token for every admin/system endpoint. That is an auth bypass.
 *
 * This module replaces that pattern with two strict helpers:
 *
 *   getAuthRecoveryToken()     - for OUTBOUND calls (one server hitting
 *                                another internal endpoint). Throws if the
 *                                env var is missing so the failure is loud
 *                                rather than silent.
 *
 *   isValidSystemToken(token)  - for INBOUND validation (an endpoint
 *                                checking a token in a request). Returns
 *                                false if the env var is missing, so the
 *                                endpoint rejects rather than accepts a
 *                                hardcoded string.
 *
 * Deployment note: AUTH_RECOVERY_TOKEN MUST be set in Railway env config
 * before deploying this change. Rotate to a fresh secret value as part
 * of the deploy.
 */

let cachedToken: string | null | undefined;

function readToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  const raw = process.env.AUTH_RECOVERY_TOKEN;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  cachedToken = trimmed.length > 0 ? trimmed : null;
  return cachedToken;
}

/**
 * Returns the AUTH_RECOVERY_TOKEN for outbound internal calls.
 * Throws if the env var is not set - fail loud, never silently send a
 * known-public fallback.
 */
export function getAuthRecoveryToken(): string {
  const t = readToken();
  if (!t) {
    throw new Error(
      "AUTH_RECOVERY_TOKEN is not set in environment. " +
      "This is required for internal system calls. " +
      "Set it in Railway and redeploy."
    );
  }
  return t;
}

/**
 * Returns the AUTH_RECOVERY_TOKEN if set, otherwise null. Use for outbound
 * calls where the caller wants to handle the missing-token case explicitly
 * rather than throwing.
 */
export function getAuthRecoveryTokenOrNull(): string | null {
  return readToken();
}

/**
 * Validates an incoming token against AUTH_RECOVERY_TOKEN.
 * Returns false if the env var is unset (so missing config rejects rather
 * than accepting a public fallback). Returns false for non-string input.
 */
export function isValidSystemToken(candidate: unknown): boolean {
  const expected = readToken();
  if (!expected) return false;
  if (typeof candidate !== "string") return false;
  return candidate.trim() === expected;
}

/**
 * Test-only: clear the cached token so tests can mutate process.env between
 * cases. Not exported via index.
 */
export function __resetAuthRecoveryTokenCacheForTests(): void {
  cachedToken = undefined;
}
