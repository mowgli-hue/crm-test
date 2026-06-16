// ─────────────────────────────────────────────────────────────────────
// Application check-in time tracking.
//
// Identity is the stable user ID (staff_id) — NOT the display name — so a
// rename never splits a person's history and two people who share a name don't
// merge. staff_name is stored only for display in summaries.
//
// Rules that keep the numbers honest:
//   1. ONE open session per person at a time — checking into a new case
//      auto-closes the previous one. Enforced atomically (txn + advisory lock).
//   2. AUTO-CLOSE stale sessions — an open session older than MAX_OPEN_HOURS is
//      closed and capped at that many hours, flagged `auto_closed`, so a
//      forgotten timer never logs a fake long day.
//   3. MANUAL entries are flagged `manual`.
// ─────────────────────────────────────────────────────────────────────

import { getPool } from "@/lib/postgres-store";

export const MAX_OPEN_HOURS = 4; // a single live session is capped at this

export type TimeSource = "live" | "manual" | "auto_closed";

export interface TimeLogRow {
  id: string;
  caseId: string;
  staffId: string;
  staffName: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  source: TimeSource;
  note: string;
}

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_time_logs (
      id               TEXT PRIMARY KEY,
      case_id          TEXT NOT NULL,
      company_id       TEXT NOT NULL,
      staff_id         TEXT NOT NULL DEFAULT '',
      staff_name       TEXT NOT NULL DEFAULT '',
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at         TIMESTAMPTZ,
      duration_seconds INTEGER,
      source           TEXT NOT NULL DEFAULT 'live',
      note             TEXT NOT NULL DEFAULT ''
    )
  `);
  // staff_id was added after first release — backfill for older deployments.
  await pool.query(`ALTER TABLE case_time_logs ADD COLUMN IF NOT EXISTS staff_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_time_logs_staffid_open ON case_time_logs (staff_id) WHERE ended_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_time_logs_case ON case_time_logs (case_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_time_logs_started ON case_time_logs (started_at)`);
  tableReady = true;
}

const newId = () => `TL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const clean = (s: string) => String(s || "").trim();

const CAP = `LEAST(NOW(), started_at + INTERVAL '${MAX_OPEN_HOURS} hours')`;

// Close every open session for this staff id (capped at MAX_OPEN_HOURS).
async function closeOpenForStaff(staffId: string, onlyCaseId?: string): Promise<number> {
  const pool = getPool();
  const params: unknown[] = [staffId];
  let caseFilter = "";
  if (onlyCaseId) { params.push(onlyCaseId); caseFilter = `AND case_id = $${params.length}`; }
  const res = await pool.query(
    `UPDATE case_time_logs
        SET ended_at = ${CAP},
            duration_seconds = EXTRACT(EPOCH FROM (${CAP} - started_at))::int,
            source = CASE WHEN NOW() > started_at + INTERVAL '${MAX_OPEN_HOURS} hours' THEN 'auto_closed' ELSE source END
      WHERE staff_id = $1 AND ended_at IS NULL ${caseFilter}`,
    params
  );
  return res.rowCount || 0;
}

// Lazily close anyone's stale open sessions (forgotten check-outs).
export async function autoCloseStaleSessions(): Promise<number> {
  await ensureTable();
  const pool = getPool();
  const res = await pool.query(
    `UPDATE case_time_logs
        SET ended_at = started_at + INTERVAL '${MAX_OPEN_HOURS} hours',
            duration_seconds = ${MAX_OPEN_HOURS * 3600},
            source = 'auto_closed'
      WHERE ended_at IS NULL AND started_at < NOW() - INTERVAL '${MAX_OPEN_HOURS} hours'`
  );
  return res.rowCount || 0;
}

// Check a staff member into a case. Atomic (txn + per-staff advisory lock) so
// two rapid check-ins can't both leave an open session.
export async function checkIn(args: { companyId: string; caseId: string; staffId: string; staffName: string; note?: string }): Promise<TimeLogRow> {
  await ensureTable();
  await autoCloseStaleSessions();
  const staffId = clean(args.staffId);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [staffId]);
    await client.query(
      `UPDATE case_time_logs
          SET ended_at = ${CAP},
              duration_seconds = EXTRACT(EPOCH FROM (${CAP} - started_at))::int,
              source = CASE WHEN NOW() > started_at + INTERVAL '${MAX_OPEN_HOURS} hours' THEN 'auto_closed' ELSE source END
        WHERE staff_id = $1 AND ended_at IS NULL`,
      [staffId]
    );
    const id = newId();
    await client.query(
      `INSERT INTO case_time_logs (id, case_id, company_id, staff_id, staff_name, source) VALUES ($1,$2,$3,$4,$5,'live')`,
      [id, args.caseId, args.companyId, staffId, clean(args.staffName)]
    );
    await client.query("COMMIT");
    const r = await client.query(`SELECT * FROM case_time_logs WHERE id = $1`, [id]);
    return mapRow(r.rows[0]);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function checkOut(args: { caseId: string; staffId: string }): Promise<{ closed: number }> {
  await ensureTable();
  const closed = await closeOpenForStaff(clean(args.staffId), args.caseId);
  return { closed };
}

export async function addManualEntry(args: {
  companyId: string; caseId: string; staffId: string; staffName: string; minutes: number; note?: string;
}): Promise<TimeLogRow> {
  await ensureTable();
  const pool = getPool();
  const id = newId();
  const seconds = Math.max(1, Math.round(args.minutes * 60));
  const startedAt = new Date(Date.now() - seconds * 1000).toISOString();
  await pool.query(
    `INSERT INTO case_time_logs (id, case_id, company_id, staff_id, staff_name, started_at, ended_at, duration_seconds, source, note)
     VALUES ($1,$2,$3,$4,$5,$6, ($6::timestamptz + ($7 || ' seconds')::interval), $7, 'manual', $8)`,
    [id, args.caseId, args.companyId, clean(args.staffId), clean(args.staffName), startedAt, seconds, args.note || ""]
  );
  const r = await pool.query(`SELECT * FROM case_time_logs WHERE id = $1`, [id]);
  return mapRow(r.rows[0]);
}

// The staff member's currently-open session, if any (across all cases).
export async function getActiveSession(staffId: string): Promise<TimeLogRow | null> {
  await ensureTable();
  await autoCloseStaleSessions();
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM case_time_logs WHERE staff_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [clean(staffId)]
  );
  return r.rows[0] ? mapRow(r.rows[0]) : null;
}

// Total + per-staff seconds for one case (grouped by stable id, name for display).
export async function caseTimeSummary(caseId: string): Promise<{ totalSeconds: number; perStaff: Array<{ staffId: string; staffName: string; seconds: number; sessions: number }> }> {
  await ensureTable();
  await autoCloseStaleSessions();
  const pool = getPool();
  const r = await pool.query(
    `SELECT staff_id,
            MAX(staff_name) AS staff_name,
            COALESCE(SUM(duration_seconds), 0)::int AS seconds,
            COUNT(*)::int AS sessions
       FROM case_time_logs
      WHERE case_id = $1 AND ended_at IS NOT NULL
   GROUP BY staff_id
   ORDER BY seconds DESC`,
    [caseId]
  );
  const perStaff = r.rows.map((x: any) => ({ staffId: x.staff_id, staffName: x.staff_name, seconds: x.seconds, sessions: x.sessions }));
  const totalSeconds = perStaff.reduce((a: number, x: { seconds: number }) => a + x.seconds, 0);
  return { totalSeconds, perStaff };
}

// Team summary for a date window. Pass `staffId` to scope to one person (RBAC).
export async function teamTimeSummary(args: { companyId?: string; startISO: string; endISO: string; staffId?: string }): Promise<{
  perStaff: Array<{ staffId: string; staffName: string; seconds: number; sessions: number }>;
  perCase: Array<{ caseId: string; seconds: number; staff: string[] }>;
}> {
  await ensureTable();
  await autoCloseStaleSessions();
  const pool = getPool();
  const params: unknown[] = [args.startISO, args.endISO];
  let scope = "";
  if (args.companyId) { params.push(args.companyId); scope += ` AND company_id = $${params.length}`; }
  if (args.staffId) { params.push(clean(args.staffId)); scope += ` AND staff_id = $${params.length}`; }

  const staffRes = await pool.query(
    `SELECT staff_id,
            MAX(staff_name) AS staff_name,
            COALESCE(SUM(duration_seconds), 0)::int AS seconds,
            COUNT(*)::int AS sessions
       FROM case_time_logs
      WHERE ended_at IS NOT NULL AND started_at >= $1 AND started_at < $2 ${scope}
   GROUP BY staff_id
   ORDER BY seconds DESC`,
    params
  );
  const caseRes = await pool.query(
    `SELECT case_id,
            COALESCE(SUM(duration_seconds), 0)::int AS seconds,
            ARRAY_AGG(DISTINCT staff_name) AS staff
       FROM case_time_logs
      WHERE ended_at IS NOT NULL AND started_at >= $1 AND started_at < $2 ${scope}
   GROUP BY case_id
   ORDER BY seconds DESC`,
    params
  );
  return {
    perStaff: staffRes.rows.map((x: any) => ({ staffId: x.staff_id, staffName: x.staff_name, seconds: x.seconds, sessions: x.sessions })),
    perCase: caseRes.rows.map((x: any) => ({ caseId: x.case_id, seconds: x.seconds, staff: (x.staff || []).filter(Boolean) })),
  };
}

function mapRow(row: any): TimeLogRow {
  return {
    id: row.id,
    caseId: row.case_id,
    staffId: row.staff_id || "",
    staffName: row.staff_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    source: row.source,
    note: row.note || "",
  };
}
