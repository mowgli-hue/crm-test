// ─────────────────────────────────────────────────────────────────────
// Morning check-in / attendance.
//
// When a staff member logs in (passwordless: today's office code + their PIN),
// we stamp a day-check-in. The roster shows who started their day and who
// hasn't — surfaced on the Team screen, the morning brief, and a WhatsApp ping.
//
// Stored in Postgres so it's queryable and survives JSON-store snapshots. One
// row per (user, Pacific day); the FIRST login of the day is the check-in time.
// ─────────────────────────────────────────────────────────────────────

import { Pool } from "pg";
import { pacificDayKey } from "@/lib/daily-code";
import { listAllStaff } from "@/lib/store";

let _pool: Pool | null = null;
function pool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  return _pool;
}

async function ensureTable() {
  await pool().query(`
    CREATE TABLE IF NOT EXISTS day_checkins (
      user_id TEXT NOT NULL,
      day_key TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      method TEXT NOT NULL DEFAULT 'pin',
      PRIMARY KEY (user_id, day_key)
    )
  `);
}

// Idempotent: only the first check-in of the day is kept.
export async function recordDayCheckIn(userId: string, name: string, method = "pin"): Promise<void> {
  try {
    await ensureTable();
    await pool().query(
      `INSERT INTO day_checkins (user_id, day_key, name, method)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, day_key) DO NOTHING`,
      [userId, pacificDayKey(), name || "", method],
    );
  } catch (e) {
    console.error("[checkin] record failed:", (e as Error).message);
  }
}

export interface RosterEntry { userId: string; name: string; role?: string; checkedInAt?: string }
export interface Roster { dayKey: string; checkedIn: RosterEntry[]; notYet: RosterEntry[] }

// Who has started their day vs who hasn't (active staff only).
export async function getTodayRoster(companyId: string): Promise<Roster> {
  const dayKey = pacificDayKey();
  let rows: Array<{ user_id: string; name: string; checked_in_at: string }> = [];
  try {
    await ensureTable();
    const r = await pool().query(
      `SELECT user_id, name, checked_in_at FROM day_checkins WHERE day_key = $1 ORDER BY checked_in_at ASC`,
      [dayKey],
    );
    rows = r.rows as any[];
  } catch (e) {
    console.error("[checkin] roster query failed:", (e as Error).message);
  }
  const inById = new Map(rows.map((x) => [x.user_id, x]));

  const staff = (await listAllStaff(companyId)).filter(
    (u: any) => u.active !== false && u.userType === "staff" && u.role !== "Client",
  );
  const checkedIn: RosterEntry[] = [];
  const notYet: RosterEntry[] = [];
  for (const u of staff) {
    const hit = inById.get(u.id);
    if (hit) checkedIn.push({ userId: u.id, name: u.name, role: u.role, checkedInAt: hit.checked_in_at });
    else notYet.push({ userId: u.id, name: u.name, role: u.role });
  }
  // Anyone who checked in but isn't in the active-staff list (edge case) still shows.
  for (const x of rows) {
    if (!staff.find((u: any) => u.id === x.user_id)) {
      checkedIn.push({ userId: x.user_id, name: x.name || x.user_id, checkedInAt: x.checked_in_at });
    }
  }
  checkedIn.sort((a, b) => String(a.checkedInAt).localeCompare(String(b.checkedInAt)));
  return { dayKey, checkedIn, notYet };
}
