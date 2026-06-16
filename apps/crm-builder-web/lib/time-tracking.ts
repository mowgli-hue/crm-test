// ─────────────────────────────────────────────────────────────────────
// Application check-in time tracking.
//
// A team member "checks in" to a case, the clock runs, they "check out".
// Each check-in/out is one immutable row in `case_time_logs`. Totals are just
// the sum of finished rows. Design rules that keep the numbers honest:
//
//   1. ONE open session per person at a time — checking into a new case
//      auto-closes the previous one (you can only work one file at a time).
//   2. AUTO-CLOSE stale sessions — if someone forgets to check out, an open
//      session older than MAX_OPEN_HOURS is closed and capped at that many
//      hours, flagged `auto_closed`, so it never logs a fake 9-hour day.
//   3. MANUAL entries are allowed but flagged `manual` so they're distinct
//      from a real live check-in.
//
// All times are UTC in the DB; callers format for display.
// ─────────────────────────────────────────────────────────────────────

import { getPool } from "@/lib/postgres-store";

export const MAX_OPEN_HOURS = 4; // a single live session is capped at this

export type TimeSource = "live" | "manual" | "auto_closed";

export interface TimeLogRow {
  id: string;
  caseId: string;
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
      staff_name       TEXT NOT NULL,
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at         TIMESTAMPTZ,
      duration_seconds INTEGER,
      source           TEXT NOT NULL DEFAULT 'live',
      note             TEXT NOT NULL DEFAULT ''
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_time_logs_staff_open ON case_time_logs (staff_name) WHERE ended_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_time_logs_case ON case_time_logs (case_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_time_logs_started ON case_time_logs (started_at)`);
  tableReady = true;
}

const newId = () => `TL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const normName = (s: string) => String(s || "").trim();

// Close every open session for this staff member. Sessions open longer than
// MAX_OPEN_HOURS are capped (auto_closed); normal closes use NOW().
async function closeOpenSessionsForStaff(staffName: string, opts?: { onlyCaseId?: string; reason?: "switch" | "manual" }): Promise<number> {
  const pool = getPool();
  const caseFilter = opts?.onlyCaseId ? `AND case_id = $2` : "";
  const params: unknown[] = [normName(staffName)];
  if (opts?.onlyCaseId) params.push(opts.onlyCaseId);
  // Cap the end time at started_at + MAX_OPEN_HOURS so a forgotten timer can
  // never bill more than the cap; flag those rows auto_closed.
  const res = await pool.query(
    `UPDATE case_time_logs
        SET ended_at = LEAST(NOW(), started_at + INTERVAL '${MAX_OPEN_HOURS} hours'),
            duration_seconds = EXTRACT(EPOCH FROM (LEAST(NOW(), started_at + INTERVAL '${MAX_OPEN_HOURS} hours') - started_at))::int,
            source = CASE
              WHEN NOW() > started_at + INTERVAL '${MAX_OPEN_HOURS} hours' THEN 'auto_closed'
              ELSE source
            END
      WHERE staff_name = $1 AND ended_at IS NULL ${caseFilter}`,
    params
  );
  return res.rowCount || 0;
}

// Lazily close anyone's stale open sessions (forgotten check-outs). Safe to call
// on every read; only touches sessions past the cap.
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

// Check a staff member into a case. Auto-closes any other open session first
// (one-at-a-time rule). Returns the new active session.
export async function checkIn(args: { companyId: string; caseId: string; staffName: string; note?: string }): Promise<TimeLogRow> {
  await ensureTable();
  await autoCloseStaleSessions();
  await closeOpenSessionsForStaff(args.staffName, { reason: "switch" });
  const pool = getPool();
  const id = newId();
  await pool.query(
    `INSERT INTO case_time_logs (id, case_id, company_id, staff_name, source) VALUES ($1,$2,$3,$4,'live')`,
    [id, args.caseId, args.companyId, normName(args.staffName)]
  );
  const r = await pool.query(`SELECT * FROM case_time_logs WHERE id = $1`, [id]);
  return mapRow(r.rows[0]);
}

// Check a staff member out of a case (closes their open session on it).
export async function checkOut(args: { caseId: string; staffName: string }): Promise<{ closed: number }> {
  await ensureTable();
  const closed = await closeOpenSessionsForStaff(args.staffName, { onlyCaseId: args.caseId, reason: "manual" });
  return { closed };
}

// Add a manual time entry (work done off-system / forgotten to track).
export async function addManualEntry(args: {
  companyId: string; caseId: string; staffName: string; minutes: number; note?: string; when?: string;
}): Promise<TimeLogRow> {
  await ensureTable();
  const pool = getPool();
  const id = newId();
  const seconds = Math.max(1, Math.round(args.minutes * 60));
  const startedAt = args.when || new Date(Date.now() - seconds * 1000).toISOString();
  await pool.query(
    `INSERT INTO case_time_logs (id, case_id, company_id, staff_name, started_at, ended_at, duration_seconds, source, note)
     VALUES ($1,$2,$3,$4,$5, ($5::timestamptz + ($6 || ' seconds')::interval), $6, 'manual', $7)`,
    [id, args.caseId, args.companyId, normName(args.staffName), startedAt, seconds, args.note || ""]
  );
  const r = await pool.query(`SELECT * FROM case_time_logs WHERE id = $1`, [id]);
  return mapRow(r.rows[0]);
}

// The staff member's currently-open session, if any (across all cases).
export async function getActiveSession(staffName: string): Promise<TimeLogRow | null> {
  await ensureTable();
  await autoCloseStaleSessions();
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM case_time_logs WHERE staff_name = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [normName(staffName)]
  );
  return r.rows[0] ? mapRow(r.rows[0]) : null;
}

// Total + per-staff seconds for one case.
export async function caseTimeSummary(caseId: string): Promise<{ totalSeconds: number; perStaff: Array<{ staffName: string; seconds: number; sessions: number }> }> {
  await ensureTable();
  await autoCloseStaleSessions();
  const pool = getPool();
  const r = await pool.query(
    `SELECT staff_name,
            COALESCE(SUM(duration_seconds), 0)::int AS seconds,
            COUNT(*)::int AS sessions
       FROM case_time_logs
      WHERE case_id = $1 AND ended_at IS NOT NULL
   GROUP BY staff_name
   ORDER BY seconds DESC`,
    [caseId]
  );
  const perStaff = r.rows.map((x: any) => ({ staffName: x.staff_name, seconds: x.seconds, sessions: x.sessions }));
  const totalSeconds = perStaff.reduce((a: number, x: { seconds: number }) => a + x.seconds, 0);
  return { totalSeconds, perStaff };
}

// Team summary for a date window [startISO, endISO): per-staff and per-case.
export async function teamTimeSummary(args: { companyId?: string; startISO: string; endISO: string }): Promise<{
  perStaff: Array<{ staffName: string; seconds: number; sessions: number }>;
  perCase: Array<{ caseId: string; seconds: number; staff: string[] }>;
}> {
  await ensureTable();
  await autoCloseStaleSessions();
  const pool = getPool();
  const companyFilter = args.companyId ? `AND company_id = $3` : "";
  const params: unknown[] = [args.startISO, args.endISO];
  if (args.companyId) params.push(args.companyId);

  const staffRes = await pool.query(
    `SELECT staff_name,
            COALESCE(SUM(duration_seconds), 0)::int AS seconds,
            COUNT(*)::int AS sessions
       FROM case_time_logs
      WHERE ended_at IS NOT NULL AND started_at >= $1 AND started_at < $2 ${companyFilter}
   GROUP BY staff_name
   ORDER BY seconds DESC`,
    params
  );
  const caseRes = await pool.query(
    `SELECT case_id,
            COALESCE(SUM(duration_seconds), 0)::int AS seconds,
            ARRAY_AGG(DISTINCT staff_name) AS staff
       FROM case_time_logs
      WHERE ended_at IS NOT NULL AND started_at >= $1 AND started_at < $2 ${companyFilter}
   GROUP BY case_id
   ORDER BY seconds DESC`,
    params
  );
  return {
    perStaff: staffRes.rows.map((x: any) => ({ staffName: x.staff_name, seconds: x.seconds, sessions: x.sessions })),
    perCase: caseRes.rows.map((x: any) => ({ caseId: x.case_id, seconds: x.seconds, staff: (x.staff || []).filter(Boolean) })),
  };
}

function mapRow(row: any): TimeLogRow {
  return {
    id: row.id,
    caseId: row.case_id,
    staffName: row.staff_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    source: row.source,
    note: row.note || "",
  };
}
