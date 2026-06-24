// ─────────────────────────────────────────────────────────────────────
// AI Operations Lead — the management brain.
//
// This is the *data layer* for the Ops Lead: it reads the signals the CRM
// already records (work sessions, case assignments, submissions, reviewer
// change-flags, the SLA clock) and turns them into:
//
//   1. Per-staff metrics — output, speed, quality, reliability, tenure.
//   2. A team summary — who's on, what's at risk, where the bottleneck is.
//   3. A rebalance plan — concrete case moves that protect SLAs and survive
//      churn (when someone goes offline or leaves, their at-risk work is
//      caught and handed to whoever has room).
//
// NO AI here and NO writes here — this module is pure measurement + a proposed
// plan. The AI narration lives in ops-lead-ai.ts; applying the plan lives in
// the rebalance/apply route (so the side-effecting code is small and auditable).
// ─────────────────────────────────────────────────────────────────────

import { listAllStaff, listAllCases } from "@/lib/store";
import { getPool } from "@/lib/postgres-store";
import { buildCanonicalizer } from "@/lib/staff-names";
import { computeSla } from "@/lib/case-sla";
import { teamActivity } from "@/lib/time-tracking";
import { profileForName, laneHandlesType, type OpsProfile } from "@/lib/team-config";
import type { ReadyKind } from "@/lib/case-priority";
import type { AppUser, CaseItem } from "@/lib/models";

// Someone with under this many days of tenure is judged on RAMP, not output.
export const NEW_HIRE_DAYS = 45;

// Roles that actually carry case-prep load (targets for rebalancing + the
// people whose output we score). Leads also prep + review.
const PREP_ROLES = new Set(["processing", "processinglead"]);

// Accounts we never rank or auto-assign to (marketing / generic / admin).
// Mirrors the exclusion list the existing performance board uses.
const EXCLUDED_NAMES = new Set(
  ["karan", "akanksha", "neha", "lavisha", "rajwinder", "admin user", "anshika",
   "team", "simi das", "manisha", "eknoor", "aman"].map((s) => s.toLowerCase().trim())
);
const isExcluded = (name: string) => {
  const n = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!n) return false;
  return EXCLUDED_NAMES.has(n) || EXCLUDED_NAMES.has(n.split(" ")[0]);
};

export type LiveStatus = "active" | "idle" | "offline";

export interface StaffMetrics {
  staffId: string;
  name: string;
  role: string;
  active: boolean;            // account enabled (false = departed/disabled)
  // tenure
  tenureDays: number | null;  // derived from earliest work session; null = never logged
  isNewHire: boolean;
  // output
  casesAssigned: number;      // open cases on their plate now
  submittedWindow: number;    // submitted in the window
  // speed
  avgHoursToSubmit: number | null;
  slaHits: number;
  slaMisses: number;
  slaHitRate: number | null;  // hits / (hits+misses)
  // quality
  reworkFlags: number;        // reviewer change-flags on their cases (window)
  reworkRate: number | null;  // flags / submittedWindow
  // reliability / effort
  hoursLoggedWindow: number;
  activeDays: number;         // distinct days worked in window
  sessions: number;
  lastActiveISO: string | null;
  // live
  status: LiveStatus;
  idleMinutes: number;
  activeCaseId: string | null;
  // risk on their plate now
  atRiskAssigned: number;     // open cases breached / due_soon
  // operating profile (from team-config)
  lanes: string[] | "all";
  functions: string[];
  employment: "full_time" | "part_time";
  capacityHours: number;      // hours/week available (capacity seed)
  offToday: boolean;          // it's their scheduled off-day
  laneLead: boolean;
}

export interface TeamSummary {
  staffCount: number;
  prepStaff: number;
  activeNow: number;
  idleNow: number;
  offlineNow: number;
  openCases: number;
  unassignedCases: number;
  atRiskOpen: number;
  submittedWindow: number;
  totalReworkFlags: number;
  medianLoad: number;
  paidNotStarted: number;   // retainer paid, work not yet started (money waiting)
  bottleneck: string;
}

export interface PaidCase {
  caseId: string;
  client: string;
  formType: string;
  assignee: string;
  daysWaiting: number;
}

export interface ReworkStuckCase {
  caseId: string;
  client: string;
  formType: string;
  owner: string;       // who has to fix it
  daysStuck: number;   // how long since the reviewer sent it back
}

export type RebalanceRule =
  | "departed"
  | "orphaned_inactive"
  | "unassigned_at_risk"
  | "overloaded_at_risk"
  | "wrong_lane";

export interface RebalanceMove {
  caseId: string;
  client: string;
  formType: string;
  fromName: string;
  toName: string;
  toStaffId: string;
  rule: RebalanceRule;
  reason: string;
  slaStatus: string;
}

export interface AtRiskCase {
  caseId: string;
  client: string;
  formType: string;
  assignee: string;      // "Unassigned" if none
  slaStatus: string;     // breached | due_soon
  slaLabel: string;      // e.g. "2h 5m overdue"
  remainingHours: number;
}

export interface ReassignEvent {
  caseId: string;
  from: string;
  to: string;
  reason: string;
  at: string;            // ISO
}

export interface OpsLeadData {
  generatedAt: string;
  windowDays: number;
  windowLabel: string;
  team: TeamSummary;
  staff: StaffMetrics[];
  rebalance: RebalanceMove[];
  atRiskCases: AtRiskCase[];        // open & slipping now (worst first)
  recentReassignments: ReassignEvent[]; // what the Ops Lead moved in the last 24h
  paidNotStartedCases: PaidCase[];  // paid clients whose work hasn't started (longest-waiting first)
  reworkStuckCases: ReworkStuckCase[]; // sent back by review, not yet refixed (longest-stuck first)
}

// ── helpers ──────────────────────────────────────────────────────────

const lc = (s: unknown) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// "Active" = a case actually in the working pipeline, matching the dashboard's
// "active cases" KPI (Assigned + Under Review + Intake). We exclude:
//   • submitted / closed / decision — work is done
//   • Lead — a marketing lead, not an engaged client (not operational work)
//   • Paid — retainer paid but not yet started (pre-work; surfaced separately)
// Without these exclusions the Ops Lead counted ~209 ("everything not submitted")
// while the dashboard showed ~124, which made the AI look wrong.
function isOpenCase(c: CaseItem): boolean {
  if (isSubmittedCase(c)) return false;
  const st = lc((c as any).processingStatus);
  const stage = lc((c as any).stage);
  if (st === "closed") return false;
  if (stage === "decision") return false;
  if (stage === "lead" || stage === "paid") return false;
  return true;
}

// A case is "submitted" if ANY submission signal is present. The `stage` field
// often drifts (stays "Paid") after a case is submitted, so we must also honour
// processingStatus and submittedAt — otherwise a submitted case wrongly shows up
// as "paid, not started" or "at risk". Single source of truth for submitted-ness.
function isSubmittedCase(c: CaseItem): boolean {
  const st = lc((c as any).processingStatus);
  const stage = lc((c as any).stage);
  return (
    st === "submitted" ||
    stage === "submitted" ||
    stage === "decision" ||
    Boolean((c as any).submittedAt)
  );
}

// Coarse stage signal without loading documents — good enough for the SLA
// deadline (which depends on createdAt + total budget, not the exact stage).
function coarseReady(c: CaseItem): ReadyKind {
  const review = lc((c as any).reviewStatus);
  const st = lc((c as any).processingStatus);
  if (review === "changes_needed" || st === "under_review") return "review";
  return "docs";
}

function slaFor(c: CaseItem, now: number) {
  return computeSla(String(c.formType || ""), (c as any).createdAt, coarseReady(c), (c as any).processingStatus, now);
}

// ── main gather ──────────────────────────────────────────────────────

// The company id that owns the most cases — the firm's primary company. Used to
// scope the Ops Lead to the SAME case set the dashboard / Cases tab show, so the
// AI's counts match what the team sees (instead of summing across drifted/legacy
// company ids).
function primaryCompanyId(cases: CaseItem[]): string {
  const counts = new Map<string, number>();
  for (const c of cases) {
    const id = String((c as any).companyId || "");
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  let best = "", bestN = -1;
  for (const [id, n] of counts) if (n > bestN) { best = id; bestN = n; }
  return best;
}

export async function gatherOpsData(opts?: {
  windowDays?: number;
  idleThresholdMin?: number;
  now?: number;
  companyId?: string;
}): Promise<OpsLeadData> {
  const windowDays = opts?.windowDays ?? 30;
  const idleThresholdMin = opts?.idleThresholdMin ?? 30;
  const now = opts?.now ?? Date.now();
  const sinceISO = new Date(now - windowDays * 86_400_000).toISOString();

  const [staffAll, allCases] = await Promise.all([listAllStaff(), listAllCases()]);
  // Scope to one company so "open cases" matches the dashboard's "active cases".
  const companyId = String(opts?.companyId || "").trim() || primaryCompanyId(allCases);
  const cases = companyId ? allCases.filter((c) => String((c as any).companyId || "") === companyId) : allCases;

  // ── Operating roster from the team-config (not the crude CRM access role) ──
  // A person is in scope if their operating profile is active and they prep or
  // review. We match the profile to a real CRM account to get the stable id used
  // by time-tracking; new hires without a login yet simply aren't scored.
  const profileByUserId = new Map<string, OpsProfile>();
  const roster: AppUser[] = [];
  for (const u of staffAll) {
    if (u.userType !== "staff") continue;
    const prof = profileForName(u.name);
    if (!prof || !prof.active) continue;
    if (!(prof.functions.includes("prep") || prof.functions.includes("review"))) continue;
    roster.push(u);
    profileByUserId.set(u.id, prof);
  }
  // Safety net: if the config matched nobody (names drifted), fall back to the
  // old role-based roster so the dashboard never goes blank.
  if (roster.length === 0) {
    for (const s of staffAll.filter((s) => s.userType === "staff" && !isExcluded(s.name) && PREP_ROLES.has(lc(s.role)))) roster.push(s);
  }

  // Today's weekday in Pacific time — for off-day awareness.
  const todayDow = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Vancouver" })).getDay();

  const canonical = buildCanonicalizer(staffAll.map((s) => String(s.name || "")));

  // Map canonical staff-name → AppUser (for resolving case.assignedTo → person).
  const userByCanonName = new Map<string, AppUser>();
  for (const s of staffAll) userByCanonName.set(lc(canonical(s.name)), s);

  // ── live status (reuse the floor-view engine) ──
  let activity: Awaited<ReturnType<typeof teamActivity>> = [];
  try {
    activity = await teamActivity(roster.map((s) => ({ id: s.id, name: s.name, role: s.role })), idleThresholdMin);
  } catch { activity = []; }
  const liveById = new Map(activity.map((a) => [a.staffId, a]));

  // ── time metrics from case_time_logs ──
  const timeWindow = new Map<string, { sessions: number; seconds: number; activeDays: number; lastEnded: string | null }>();
  const firstSeen = new Map<string, string>();
  const openCaseIds = new Set<string>(); // cases someone is punched into RIGHT NOW
  try {
    const pool = getPool();
    const w = await pool.query(
      `SELECT staff_id,
              COUNT(*)::int AS sessions,
              COALESCE(SUM(duration_seconds),0)::int AS seconds,
              COUNT(DISTINCT date_trunc('day', started_at))::int AS active_days,
              MAX(ended_at) AS last_ended
         FROM case_time_logs
        WHERE ended_at IS NOT NULL AND started_at >= $1
     GROUP BY staff_id`,
      [sinceISO]
    );
    for (const r of w.rows as any[]) {
      timeWindow.set(r.staff_id, { sessions: r.sessions, seconds: r.seconds, activeDays: r.active_days, lastEnded: r.last_ended });
    }
    const fs = await pool.query(`SELECT staff_id, MIN(started_at) AS first_at FROM case_time_logs GROUP BY staff_id`);
    for (const r of fs.rows as any[]) if (r.first_at) firstSeen.set(r.staff_id, r.first_at);
    const op = await pool.query(`SELECT DISTINCT case_id FROM case_time_logs WHERE ended_at IS NULL`);
    for (const r of op.rows as any[]) openCaseIds.add(r.case_id);
  } catch (e) {
    console.error("[ops-lead] time metrics read failed:", (e as Error).message);
  }

  // ── reviewer change-flags in the window → per case ──
  const flagsByCase = new Map<string, number>();
  try {
    const pool = getPool();
    const rc = await pool.query(
      `SELECT case_id FROM review_comments WHERE parent_id IS NULL AND created_at >= $1`,
      [sinceISO]
    );
    for (const r of rc.rows as any[]) flagsByCase.set(r.case_id, (flagsByCase.get(r.case_id) || 0) + 1);
    const cn = await pool.query(
      `SELECT case_id FROM case_notes
        WHERE created_at >= $1
          AND ( text ILIKE '⚠️%CHANGES NEEDED%' OR text ILIKE 'CHANGES NEEDED%'
             OR text ILIKE 'CHANGE NEEDED%' OR text ILIKE 'CHANGES HIGHLIGHTED%'
             OR text ILIKE 'CHANGES REQUIRED%' )`,
      [sinceISO]
    );
    for (const r of cn.rows as any[]) flagsByCase.set(r.case_id, (flagsByCase.get(r.case_id) || 0) + 1);
  } catch (e) {
    console.error("[ops-lead] rework-flag read failed:", (e as Error).message);
  }

  // ── per-case derived: canonical assignee, open?, sla, submitted-in-window ──
  const assigneeOf = (c: CaseItem) => {
    const who = String((c as any).assignedTo || "").trim();
    if (!who || lc(who) === "unassigned") return "";
    return canonical(who);
  };

  // Accumulators keyed by canonical staff name.
  type Acc = {
    casesAssigned: number; atRiskAssigned: number;
    submittedWindow: number; sumHoursToSubmit: number; submitTimedCount: number;
    slaHits: number; slaMisses: number; reworkFlags: number;
  };
  const acc = new Map<string, Acc>();
  const ensureAcc = (name: string) => {
    const k = lc(name);
    if (!acc.has(k)) acc.set(k, { casesAssigned: 0, atRiskAssigned: 0, submittedWindow: 0, sumHoursToSubmit: 0, submitTimedCount: 0, slaHits: 0, slaMisses: 0, reworkFlags: 0 });
    return acc.get(k)!;
  };

  let openCases = 0, unassignedCases = 0, atRiskOpen = 0, submittedWindow = 0, totalReworkFlags = 0;
  const openAtRiskUnassigned: CaseItem[] = [];
  const atRiskList: AtRiskCase[] = [];
  const paidList: PaidCase[] = [];
  const reworkList: ReworkStuckCase[] = [];

  for (const c of cases) {
    const who = assigneeOf(c);
    const open = isOpenCase(c);
    const sla = slaFor(c, now);

    // Sent back by review and not yet refixed — the rework bottleneck. Tracked
    // separately so the manager sees who's sitting on changes and for how long.
    if (open && lc((c as any).reviewStatus) === "changes_needed") {
      const upMs = Date.parse((c as any).updatedAt || "");
      reworkList.push({
        caseId: c.id,
        client: String((c as any).client || ""),
        formType: String(c.formType || ""),
        owner: who || "Unassigned",
        daysStuck: Number.isNaN(upMs) ? 0 : Math.max(0, Math.floor((now - upMs) / 86_400_000)),
      });
    }

    // Paid retainer but work not started — surfaced separately (it's excluded
    // from "active", but it's money waiting and must not be invisible).
    // Guard: a SUBMITTED case often still has stage "Paid" (stage drifts), so we
    // must skip anything already submitted — otherwise submitted files wrongly
    // appear as "paid, not started".
    if (lc((c as any).stage) === "paid" && !isSubmittedCase(c)) {
      const createdMs = Date.parse((c as any).createdAt || "");
      paidList.push({
        caseId: c.id,
        client: String((c as any).client || ""),
        formType: String(c.formType || ""),
        assignee: who || "Unassigned",
        daysWaiting: Number.isNaN(createdMs) ? 0 : Math.max(0, Math.floor((now - createdMs) / 86_400_000)),
      });
    }
    const atRisk = sla.status === "breached" || sla.status === "due_soon";

    if (open) {
      openCases++;
      if (!who) { unassignedCases++; if (atRisk) openAtRiskUnassigned.push(c); }
      if (atRisk) {
        atRiskOpen++;
        atRiskList.push({
          caseId: c.id,
          client: String((c as any).client || ""),
          formType: String(c.formType || ""),
          assignee: who || "Unassigned",
          slaStatus: sla.status,
          slaLabel: sla.label,
          remainingHours: sla.remainingHours,
        });
      }
      if (who) {
        const a = ensureAcc(who);
        a.casesAssigned++;
        if (atRisk) a.atRiskAssigned++;
      }
    }

    // Submitted-in-window quality + speed (attributed to assignee).
    const submittedAt = (c as any).submittedAt as string | undefined;
    if (submittedAt) {
      const subMs = Date.parse(submittedAt);
      if (!Number.isNaN(subMs) && subMs >= Date.parse(sinceISO)) {
        submittedWindow++;
        if (who) {
          const a = ensureAcc(who);
          a.submittedWindow++;
          const createdMs = Date.parse((c as any).createdAt || "");
          if (!Number.isNaN(createdMs) && subMs >= createdMs) {
            a.sumHoursToSubmit += (subMs - createdMs) / 3_600_000;
            a.submitTimedCount++;
            // SLA hit = submitted on/before the submit-due deadline.
            const due = Date.parse(computeSla(String(c.formType || ""), (c as any).createdAt, "submit", undefined, now).submitDueISO);
            if (!Number.isNaN(due)) { if (subMs <= due) a.slaHits++; else a.slaMisses++; }
          }
        }
      }
    }

    // Rework flags this case collected → attribute to its assignee.
    const flags = flagsByCase.get(c.id) || 0;
    if (flags > 0) {
      totalReworkFlags += flags;
      if (who) ensureAcc(who).reworkFlags += flags;
    }
  }

  // ── assemble per-staff metrics ──
  const staff: StaffMetrics[] = roster.map((s) => {
    const a = acc.get(lc(canonical(s.name)));
    const tw = timeWindow.get(s.id);
    const live = liveById.get(s.id);
    const fseen = firstSeen.get(s.id);
    const prof = profileByUserId.get(s.id);
    const tenureDays = fseen ? Math.max(0, Math.floor((now - Date.parse(fseen)) / 86_400_000)) : null;
    const submitted = a?.submittedWindow ?? 0;
    const slaTotal = (a?.slaHits ?? 0) + (a?.slaMisses ?? 0);
    return {
      staffId: s.id,
      name: s.name,
      role: s.role,
      active: s.active !== false,
      lanes: prof?.lanes ?? "all",
      functions: prof?.functions ?? ["prep"],
      employment: prof?.employment ?? "full_time",
      capacityHours: prof?.weeklyHours ?? 35,
      offToday: prof?.offDays ? prof.offDays.includes(todayDow) : false,
      laneLead: prof?.laneLead ?? false,
      tenureDays,
      // Trust the explicit config flag when the person is in team-config (so
      // veterans aren't mislabeled "new" just because tracking started recently);
      // fall back to tenure only for people without a profile.
      isNewHire: prof ? prof.isNewHire === true : (tenureDays !== null && tenureDays < NEW_HIRE_DAYS),
      casesAssigned: a?.casesAssigned ?? 0,
      submittedWindow: submitted,
      avgHoursToSubmit: a && a.submitTimedCount > 0 ? Math.round((a.sumHoursToSubmit / a.submitTimedCount) * 10) / 10 : null,
      slaHits: a?.slaHits ?? 0,
      slaMisses: a?.slaMisses ?? 0,
      slaHitRate: slaTotal > 0 ? Math.round(((a!.slaHits) / slaTotal) * 100) / 100 : null,
      reworkFlags: a?.reworkFlags ?? 0,
      reworkRate: submitted > 0 ? Math.round(((a?.reworkFlags ?? 0) / submitted) * 100) / 100 : null,
      hoursLoggedWindow: tw ? Math.round((tw.seconds / 3600) * 10) / 10 : 0,
      activeDays: tw?.activeDays ?? 0,
      sessions: tw?.sessions ?? 0,
      lastActiveISO: tw?.lastEnded ?? (live?.lastActivityAt ?? null),
      status: (live?.status ?? "offline") as LiveStatus,
      idleMinutes: live?.idleMinutes ?? 0,
      activeCaseId: live?.activeCaseId ?? null,
      atRiskAssigned: a?.atRiskAssigned ?? 0,
    };
  });

  // ── team summary ──
  const loads = staff.map((s) => s.casesAssigned).sort((x, y) => x - y);
  const medianLoad = loads.length ? loads[Math.floor(loads.length / 2)] : 0;
  const activeNow = staff.filter((s) => s.status === "active").length;
  const idleNow = staff.filter((s) => s.status === "idle").length;
  const offlineNow = staff.filter((s) => s.status === "offline").length;

  const bottleneck = pickBottleneck({ atRiskOpen, unassignedCases, totalReworkFlags, staff, openCases });

  const team: TeamSummary = {
    staffCount: staffAll.filter((s) => s.userType === "staff" && !isExcluded(s.name)).length,
    prepStaff: roster.length,
    activeNow, idleNow, offlineNow,
    openCases, unassignedCases, atRiskOpen, submittedWindow, totalReworkFlags,
    medianLoad,
    paidNotStarted: paidList.length,
    bottleneck,
  };

  // ── rebalance plan ──
  const rebalance = computeRebalanceMoves({
    cases, staff, roster, canonical, userByCanonName, openCaseIds,
    openAtRiskUnassigned, now,
  });

  // Worst-first at-risk list (most overdue at the top), capped for readability.
  atRiskList.sort((a, b) => a.remainingHours - b.remainingHours);
  const atRiskCases = atRiskList.slice(0, 30);

  // What the Ops Lead has already moved in the last 24h (from the audit trail) —
  // so the brief can tell the owner what happened while they weren't looking.
  const recentReassignments: ReassignEvent[] = [];
  try {
    const pool = getPool();
    const since = new Date(now - 86_400_000).toISOString();
    const r = await pool.query(
      `SELECT resource_id, metadata, created_at
         FROM audit_logs
        WHERE action = 'reassign_case' AND created_at >= $1
     ORDER BY created_at DESC LIMIT 40`,
      [since]
    );
    for (const x of r.rows as any[]) {
      const md = x.metadata || {};
      recentReassignments.push({
        caseId: x.resource_id,
        from: String(md.from || ""),
        to: String(md.to || ""),
        reason: String(md.reason || ""),
        at: x.created_at,
      });
    }
  } catch { /* audit table may not exist yet */ }

  paidList.sort((a, b) => b.daysWaiting - a.daysWaiting);
  const paidNotStartedCases = paidList.slice(0, 30);

  reworkList.sort((a, b) => b.daysStuck - a.daysStuck);
  const reworkStuckCases = reworkList.slice(0, 30);

  const windowLabel = `last ${windowDays} days`;
  return { generatedAt: new Date(now).toISOString(), windowDays, windowLabel, team, staff, rebalance, atRiskCases, recentReassignments, paidNotStartedCases, reworkStuckCases };
}

function pickBottleneck(args: { atRiskOpen: number; unassignedCases: number; totalReworkFlags: number; staff: StaffMetrics[]; openCases: number }): string {
  if (args.unassignedCases > 0 && args.unassignedCases >= args.atRiskOpen) return `${args.unassignedCases} unassigned case(s) need an owner`;
  if (args.atRiskOpen > 0) return `${args.atRiskOpen} open case(s) at risk of missing SLA`;
  if (args.totalReworkFlags > 0) return `${args.totalReworkFlags} rework flag(s) — quality is the constraint`;
  return "No bottleneck — team is on track";
}

// ── rebalance engine (pure) ──────────────────────────────────────────
// Proposes moves under strict rules. The apply route enforces these again
// before writing, so this can be shown as a preview safely.

export function computeRebalanceMoves(args: {
  cases: CaseItem[];
  staff: StaffMetrics[];
  roster: AppUser[];
  canonical: (n: string) => string;
  userByCanonName: Map<string, AppUser>;
  openCaseIds: Set<string>;     // cases someone is punched into NOW — never move
  openAtRiskUnassigned: CaseItem[];
  now: number;
  maxMoves?: number;
  maxIntakePerPerson?: number;
}): RebalanceMove[] {
  const maxMoves = args.maxMoves ?? 12;
  const maxIntake = args.maxIntakePerPerson ?? 3;

  // Eligible targets: enabled prep staff. Projected load starts at current load.
  const targets = args.staff
    .filter((s) => s.active)
    .map((s) => ({ ...s, projLoad: s.casesAssigned, intake: 0 }));
  if (targets.length === 0) return [];

  const rank = (a: typeof targets[number], b: typeof targets[number]) => {
    // Off-day people sink (still eligible as a last resort), then prefer people
    // online now, then lighter projected load, then fewer at-risk.
    const offRank = (t: typeof targets[number]) => (t.offToday ? 1 : 0);
    const liveRank = (st: LiveStatus) => (st === "active" ? 0 : st === "idle" ? 1 : 2);
    return offRank(a) - offRank(b) || liveRank(a.status) - liveRank(b.status) || a.projLoad - b.projLoad || a.atRiskAssigned - b.atRiskAssigned;
  };

  const moves: RebalanceMove[] = [];
  const movedCaseIds = new Set<string>();

  const assigneeOf = (c: CaseItem) => {
    const who = String((c as any).assignedTo || "").trim();
    if (!who || who.toLowerCase() === "unassigned") return "";
    return args.canonical(who);
  };
  const open = (c: CaseItem) => isOpenCase(c);
  const sla = (c: CaseItem) => slaFor(c, args.now);
  const atRisk = (c: CaseItem) => { const s = sla(c).status; return s === "breached" || s === "due_soon"; };

  const enabledCanonNames = new Set(
    args.roster.filter((s) => s.active !== false).map((s) => args.canonical(s.name).toLowerCase())
  );

  // Lane-aware target pick: prefer people whose lane handles this app type; only
  // fall back to anyone if no lane-owner has room.
  const pickTarget = (excludeName: string, formType: string): typeof targets[number] | null => {
    const ex = excludeName.toLowerCase();
    const eligible = targets.filter((t) => t.name.toLowerCase() !== ex && t.intake < maxIntake);
    if (eligible.length === 0) return null;
    const laneMatch = eligible.filter((t) => laneHandlesType(t.lanes, formType));
    const pool = laneMatch.length ? laneMatch : eligible;
    pool.sort(rank);
    return pool[0];
  };

  const addMove = (c: CaseItem, rule: RebalanceRule, reason: string) => {
    if (moves.length >= maxMoves) return;
    if (movedCaseIds.has(c.id)) return;
    if (args.openCaseIds.has(c.id)) return; // someone is working it right now — hands off
    const from = assigneeOf(c);
    const t = pickTarget(from, String(c.formType || ""));
    if (!t) return;
    t.projLoad++; t.intake++;
    movedCaseIds.add(c.id);
    moves.push({
      caseId: c.id,
      client: String((c as any).client || ""),
      formType: String(c.formType || ""),
      fromName: from || "Unassigned",
      toName: t.name,
      toStaffId: t.staffId,
      rule,
      reason,
      slaStatus: sla(c).status,
    });
  };

  // RULE 1 — departed/disabled owner: any open case whose assignee isn't an
  // enabled staff member. Always reassign (work would otherwise be orphaned).
  for (const c of args.cases) {
    if (!open(c)) continue;
    const who = assigneeOf(c);
    if (!who) continue; // unassigned handled below
    if (!enabledCanonNames.has(who.toLowerCase())) {
      addMove(c, "departed", `Owner "${who}" is no longer active — reassigning so it isn't dropped`);
    }
  }

  // RULE 2 — unassigned & at risk: give it an owner before it breaches.
  for (const c of args.openAtRiskUnassigned) {
    addMove(c, "unassigned_at_risk", `Unassigned and ${sla(c).status === "breached" ? "already overdue" : "due soon"} — needs an owner now`);
  }

  // RULE 3 — owner offline today & case at risk: catch it for someone online.
  const statusByName = new Map(args.staff.map((s) => [s.name.toLowerCase(), s]));
  for (const c of args.cases) {
    if (!open(c) || !atRisk(c)) continue;
    const who = assigneeOf(c);
    if (!who) continue;
    const owner = statusByName.get(who.toLowerCase());
    if (owner && owner.status === "offline") {
      addMove(c, "orphaned_inactive", `Owner offline today and case ${sla(c).status === "breached" ? "overdue" : "due soon"}`);
    }
  }

  // RULE 4 — overloaded owner: pull at-risk cases off anyone carrying well above
  // the median, handing them to people with room. Most-overloaded first.
  const median = (() => { const l = args.staff.map((s) => s.casesAssigned).sort((a, b) => a - b); return l.length ? l[Math.floor(l.length / 2)] : 0; })();
  const overloadThreshold = Math.max(median * 1.5, median + 3);
  const overloaded = [...args.staff].filter((s) => s.casesAssigned > overloadThreshold).sort((a, b) => b.casesAssigned - a.casesAssigned);
  for (const o of overloaded) {
    const theirAtRisk = args.cases.filter((c) => open(c) && atRisk(c) && assigneeOf(c).toLowerCase() === o.name.toLowerCase() && !movedCaseIds.has(c.id) && c.id !== o.activeCaseId);
    // Move at most 2 from any one person per run to avoid thrash.
    for (const c of theirAtRisk.slice(0, 2)) {
      addMove(c, "overloaded_at_risk", `${o.name} is carrying ${o.casesAssigned} (median ${median}); moving an at-risk case to balance load`);
    }
  }

  // RULE 5 — wrong lane: a case sitting with a lane-restricted owner who doesn't
  // handle that application type goes to someone whose lane does. This is how
  // "give Avneet only PGWP/VR/SP-ext/TRV; move her other files out" happens.
  // Naturally gradual — capped by maxMoves, so it corrects a few per run.
  const laneByName = new Map(args.staff.map((s) => [s.name.toLowerCase(), s.lanes] as const));
  for (const c of args.cases) {
    if (!open(c)) continue;
    const who = assigneeOf(c);
    if (!who) continue;
    const ownerLanes = laneByName.get(who.toLowerCase());
    // Only lane-restricted owners (not "all"-lane reviewers/generalists/trainees).
    if (!ownerLanes || ownerLanes === "all") continue;
    if (laneHandlesType(ownerLanes, String(c.formType || ""))) continue; // already right lane
    // Only move if some OTHER active person actually handles this lane.
    const hasLaneOwner = args.staff.some((s) => s.active && s.name.toLowerCase() !== who.toLowerCase() && laneHandlesType(s.lanes, String(c.formType || "")));
    if (!hasLaneOwner) continue;
    addMove(c, "wrong_lane", `${c.formType} isn't ${who}'s lane — routing to the right lane owner`);
  }

  return moves;
}
