import { Pool } from "pg";

type LimitResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining?: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __crmAuthRateLimitMemory: Map<string, Bucket> | undefined;
}

let pool: Pool | null = null;

function isPgEnabled() {
  return String(process.env.DATA_BACKEND || "file").toLowerCase() === "postgres";
}

function getPool() {
  const dbUrl = String(process.env.DATABASE_URL || "").trim();
  if (!dbUrl) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: dbUrl,
      max: 3,
      ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

// Self-heal: the auth_rate_limits table must exist or every login query throws
// `relation "auth_rate_limits" does not exist` — which (without the fail-open
// guard below) blocked ALL logins. Create it on demand; cached after first run.
let __rateLimitTableReady = false;
async function ensureRateLimitTable(db: Pool): Promise<void> {
  if (__rateLimitTableReady) return;
  await db.query(`
    create table if not exists auth_rate_limits (
      key text primary key,
      attempts integer not null default 0,
      window_started_at timestamptz not null default now(),
      blocked_until timestamptz
    )
  `);
  __rateLimitTableReady = true;
}

export async function consumeAuthRateLimit(input: {
  key: string;
  maxAttempts: number;
  windowSeconds: number;
}): Promise<LimitResult> {
  const maxAttempts = Math.max(1, Number(input.maxAttempts || 8));
  const windowSeconds = Math.max(30, Number(input.windowSeconds || 300));
  const now = Date.now();

  if (!isPgEnabled()) {
    if (!global.__crmAuthRateLimitMemory) global.__crmAuthRateLimitMemory = new Map<string, Bucket>();
    const store = global.__crmAuthRateLimitMemory;
    const key = String(input.key || "");
    const current = store.get(key);
    if (!current || current.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: maxAttempts - 1 };
    }
    current.count += 1;
    store.set(key, current);
    const remaining = Math.max(0, maxAttempts - current.count);
    if (current.count > maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        remaining
      };
    }
    return { allowed: true, remaining };
  }

  const db = getPool();
  if (!db) return { allowed: true };
  const key = String(input.key || "");
  try {
  await ensureRateLimitTable(db);
  const result = await db.query(
    `
    insert into auth_rate_limits (key, attempts, window_started_at, blocked_until)
    values ($1, 1, now(), null)
    on conflict (key) do update set
      attempts = case
        when auth_rate_limits.window_started_at < (now() - make_interval(secs => $3::int))
          then 1
        else auth_rate_limits.attempts + 1
      end,
      window_started_at = case
        when auth_rate_limits.window_started_at < (now() - make_interval(secs => $3::int))
          then now()
        else auth_rate_limits.window_started_at
      end,
      blocked_until = case
        when auth_rate_limits.blocked_until is not null and auth_rate_limits.blocked_until > now()
          then auth_rate_limits.blocked_until
        when auth_rate_limits.window_started_at < (now() - make_interval(secs => $3::int))
          then null
        when auth_rate_limits.attempts + 1 > $2::int
          then now() + make_interval(secs => $3::int)
        else auth_rate_limits.blocked_until
      end
    returning attempts, extract(epoch from window_started_at)::bigint as window_started_epoch,
              extract(epoch from blocked_until)::bigint as blocked_until_epoch
    `,
    [key, maxAttempts, windowSeconds]
  );

  const row = result.rows[0] || {};
  const attempts = Number(row.attempts || 1);
  const blockedUntilEpoch = Number(row.blocked_until_epoch || 0);
  if (blockedUntilEpoch && blockedUntilEpoch > Math.floor(now / 1000)) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, blockedUntilEpoch - Math.floor(now / 1000)),
      remaining: 0
    };
  }
  return {
    allowed: attempts <= maxAttempts,
    remaining: Math.max(0, maxAttempts - attempts)
  };
  } catch (e) {
    // FAIL-OPEN: a rate-limiter must NEVER block login because of a DB problem.
    // A missing table or transient DB error here previously threw all the way up
    // and broke every login. Allow the attempt through and log it instead.
    console.error("auth rate-limit check failed — allowing login:", (e as Error).message);
    return { allowed: true };
  }
}

export async function clearAuthRateLimit(key: string): Promise<void> {
  if (!key) return;
  if (!isPgEnabled()) {
    global.__crmAuthRateLimitMemory?.delete(key);
    return;
  }
  const db = getPool();
  if (!db) return;
  try {
    await ensureRateLimitTable(db);
    await db.query("delete from auth_rate_limits where key = $1", [key]);
  } catch (e) {
    // Non-fatal: clearing the limiter must never block a successful login.
    console.error("auth rate-limit clear failed (ignored):", (e as Error).message);
  }
}
