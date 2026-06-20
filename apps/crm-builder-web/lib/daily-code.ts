// ─────────────────────────────────────────────────────────────────────
// Daily office access code.
//
// A single shared code per calendar day (Pacific time). Staff enter it in place
// of a password to open the CRM; it rotates every day, so access doesn't linger
// indefinitely. The owner's own password still works (no lockout), and per-user
// identity is preserved because the user still logs in with their own email.
//
// Enabled by env DAILY_CODE_LOGIN=true. When off, none of this is consulted and
// login behaves exactly as before.
//
// The code is intentionally low-sensitivity (it changes daily and only gets you
// to the password-equivalent step for an already-known staff email), so it's
// stored in plain text — the owner needs to SEE it to share it each morning.
// ─────────────────────────────────────────────────────────────────────

import { getPool } from "@/lib/postgres-store";

export function dailyCodeLoginEnabled(): boolean {
  return String(process.env.DAILY_CODE_LOGIN || "").toLowerCase() === "true";
}

// Pacific-time calendar day key, e.g. "2026-06-19". One code per this key.
export function pacificDayKey(now: number = Date.now()): string {
  // en-CA gives YYYY-MM-DD; pin to America/Vancouver so the day flips at local
  // midnight regardless of server timezone.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(now));
}

// ISO timestamp of the next Pacific midnight — used as the session expiry for
// daily-code logins so access lapses overnight.
export function endOfPacificDayISO(now: number = Date.now()): string {
  const key = pacificDayKey(now);            // today's Pacific date
  // Midnight Pacific the FOLLOWING day. Build from the date parts; Pacific is
  // UTC-7 (PDT) for the operating months — using 07:00Z next-day midnight is a
  // safe approximation that always lands after local midnight.
  const [y, m, d] = key.split("-").map(Number);
  // Next day 08:00 UTC = 00:00 Pacific (PST) / 01:00 Pacific (PDT) — always just
  // AFTER local midnight in both DST states, so the session covers the full
  // Pacific day and lapses overnight.
  const nextMidnightUtc = Date.UTC(y, m - 1, d + 1, 8, 0, 0);
  return new Date(nextMidnightUtc).toISOString();
}

function genCode(): string {
  // 6 digits, no leading-zero ambiguity issues since we keep it as text.
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function ensureTable(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_access_codes (
      day_key    TEXT PRIMARY KEY,
      code       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// Today's code, creating it if it doesn't exist yet. Idempotent and race-safe
// (ON CONFLICT keeps the first writer's code).
export async function getOrCreateTodayCode(now: number = Date.now()): Promise<{ dayKey: string; code: string }> {
  await ensureTable();
  const pool = getPool();
  const dayKey = pacificDayKey(now);
  const code = genCode();
  await pool.query(
    `INSERT INTO daily_access_codes (day_key, code) VALUES ($1, $2) ON CONFLICT (day_key) DO NOTHING`,
    [dayKey, code]
  );
  const r = await pool.query(`SELECT code FROM daily_access_codes WHERE day_key = $1`, [dayKey]);
  return { dayKey, code: String(r.rows[0]?.code || code) };
}

// Force a new code for today (owner action — e.g. if the old one leaked).
export async function regenerateTodayCode(now: number = Date.now()): Promise<{ dayKey: string; code: string }> {
  await ensureTable();
  const pool = getPool();
  const dayKey = pacificDayKey(now);
  const code = genCode();
  await pool.query(
    `INSERT INTO daily_access_codes (day_key, code, created_at) VALUES ($1, $2, NOW())
       ON CONFLICT (day_key) DO UPDATE SET code = EXCLUDED.code, created_at = NOW()`,
    [dayKey, code]
  );
  return { dayKey, code };
}

// Constant-ish-time compare of an entered code against today's code.
export async function verifyTodayCode(input: string, now: number = Date.now()): Promise<boolean> {
  const entered = String(input || "").trim();
  if (!/^\d{4,8}$/.test(entered)) return false;
  try {
    const { code } = await getOrCreateTodayCode(now);
    if (entered.length !== code.length) return false;
    let diff = 0;
    for (let i = 0; i < code.length; i++) diff |= entered.charCodeAt(i) ^ code.charCodeAt(i);
    return diff === 0;
  } catch (e) {
    console.error("[daily-code] verify failed:", (e as Error).message);
    return false;
  }
}
