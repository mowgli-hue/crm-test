// ─────────────────────────────────────────────────────────────────────
// SLA calibration — set the hours targets from REAL data, not guesses.
//
// The punch-in timers (case_time_logs) capture actual hands-on time per case.
// This rolls that up per application family so we can see, for each type:
//   - how many cases we have timing data for
//   - average / median / best-realistic (p25) / fastest / slowest hands-on time
//   - a RECOMMENDED target = best-realistic time + a buffer (the 5:1 idea)
//   - the CURRENTLY configured target, for comparison
//
// "Hands-on" = summed timer time across everyone who worked the case. It's the
// EFFORT a type takes. It is a floor for the calendar SLA (the case can't ship
// faster than the work) and the most reliable signal we have from day one.
// (Calendar turnaround — incl. time waiting on the client — needs a submit
// timestamp, which we can start capturing next.)
//
// Needs accumulated data: until the team has been punching in for a while,
// sampleCases will be small and the numbers noisy. Treat <5 samples as a hint,
// not a target.
// ─────────────────────────────────────────────────────────────────────

import { getPool } from "@/lib/postgres-store";
import { listCases } from "@/lib/store";
import { resolveApplicationChecklistKey } from "@/lib/application-checklists";
import { totalBudgetForKey } from "@/lib/case-sla";

export interface TypeCalibration {
  key: string;                     // application family
  sampleCases: number;             // cases with logged time
  avgHandsOnHours: number;
  medianHandsOnHours: number;
  bestHandsOnHours: number;        // p25 — a good-but-realistic time, not a fluke
  fastestHours: number;
  slowestHours: number;
  recommendedTargetHours: number;  // bestRealistic × (1 + buffer)
  currentTargetHours: number;      // what case-sla uses today
  confidence: "low" | "medium" | "high";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round((p / 100) * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

/**
 * Roll up hands-on time per application family.
 *
 * @param opts.bufferRatio headroom added to the best-realistic time to form the
 *   recommended target. 0.2 = the 25:5 / 50:10 (5:1) idea — 20% buffer.
 */
export async function slaCalibration(
  opts: { companyId?: string; bufferRatio?: number } = {},
): Promise<{ bufferRatio: number; types: TypeCalibration[] }> {
  const bufferRatio = typeof opts.bufferRatio === "number" && opts.bufferRatio >= 0 ? opts.bufferRatio : 0.2;
  const pool = getPool();

  // Hands-on seconds per case = sum of every staff member's sessions on it.
  const res = await pool.query(
    `SELECT case_id, SUM(duration_seconds)::bigint AS hands_on
       FROM case_time_logs
      WHERE ended_at IS NOT NULL AND duration_seconds > 0
   GROUP BY case_id`,
  );

  const cases = await listCases(opts.companyId || process.env.DEFAULT_COMPANY_ID || "newton");
  const typeByCase = new Map<string, string>();
  for (const c of cases as any[]) typeByCase.set(c.id, String(c.formType || "generic"));

  // Bucket per-case hands-on HOURS by application family.
  const buckets = new Map<string, number[]>();
  for (const row of res.rows as Array<{ case_id: string; hands_on: string }>) {
    const ft = typeByCase.get(row.case_id);
    if (!ft) continue; // time log for a case we can't classify
    const key = resolveApplicationChecklistKey(ft);
    const hours = Number(row.hands_on) / 3600;
    if (!Number.isFinite(hours) || hours <= 0) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(hours);
  }

  const types: TypeCalibration[] = [];
  for (const [key, arr] of buckets) {
    const sorted = [...arr].sort((a, b) => a - b);
    const n = sorted.length;
    const avg = sorted.reduce((a, b) => a + b, 0) / n;
    const median = percentile(sorted, 50);
    const best = percentile(sorted, 25);
    types.push({
      key,
      sampleCases: n,
      avgHandsOnHours: round1(avg),
      medianHandsOnHours: round1(median),
      bestHandsOnHours: round1(best),
      fastestHours: round1(sorted[0]),
      slowestHours: round1(sorted[n - 1]),
      recommendedTargetHours: round1(best * (1 + bufferRatio)),
      currentTargetHours: totalBudgetForKey(key),
      confidence: n >= 20 ? "high" : n >= 5 ? "medium" : "low",
    });
  }

  types.sort((a, b) => b.sampleCases - a.sampleCases);
  return { bufferRatio, types };
}
