// ─────────────────────────────────────────────────────────────────────
// AI Operations Lead — the judgment layer.
//
// Takes the hard numbers from ops-lead.ts and produces the things a good
// operations manager would say:
//
//   • a per-person verdict (rating + one-line read + the single thing to fix)
//   • a new-hire ramp read (for anyone under NEW_HIRE_DAYS tenure)
//   • a daily leadership brief for the owner (bottleneck, who to coach, who to
//     trust with more, what only they can handle)
//
// Powered by Claude. The model is env-configurable (OPS_LEAD_MODEL) and defaults
// to a strong model because this runs at most a few times a day for a 10–25
// person team — cost is trivial next to a manager's time.
//
// CRITICAL: if there's no API key or the call fails, we fall back to a
// deterministic, rule-based verdict so the dashboard still works and never
// shows a blank. The AI makes it sharper; it is not a hard dependency.
// ─────────────────────────────────────────────────────────────────────

import type { OpsLeadData, StaffMetrics } from "@/lib/ops-lead";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Top model for judgment — this is the management brain, so it runs on Opus by
// default. Override with OPS_LEAD_MODEL (e.g. claude-sonnet-4-6) to trade cost.
const MODEL = process.env.OPS_LEAD_MODEL || "claude-opus-4-8";

export type Rating = "strong" | "solid" | "coaching" | "at_risk" | "too_new";

export interface StaffVerdict {
  staffId: string;
  name: string;
  rating: Rating;
  ratingLabel: string;     // human label
  headline: string;        // one-line read
  fix: string;             // the single most useful next step (coaching / recognition)
  rampRead?: string;       // only for new hires
}

export interface OpsLeadJudgment {
  brief: string;           // the leadership brief (plain text, short paragraphs)
  verdicts: StaffVerdict[];
  aiUsed: boolean;
  model: string;
}

const RATING_LABEL: Record<Rating, string> = {
  strong: "Strong",
  solid: "Solid",
  coaching: "Needs coaching",
  at_risk: "At risk",
  too_new: "Too new to judge",
};

// ── deterministic fallback rating (also seeds the AI with a baseline) ──
export function ruleRating(s: StaffMetrics): Rating {
  if (s.tenureDays !== null && s.tenureDays < 10 && s.submittedWindow < 2) return "too_new";
  const rework = s.reworkRate ?? 0;
  const sla = s.slaHitRate;
  const output = s.submittedWindow;

  // At risk: high rework OR poor SLA with real volume, or barely any activity.
  if ((rework >= 1 && output >= 2) || (sla !== null && sla < 0.5 && output >= 3)) return "at_risk";
  if (s.activeDays === 0 && s.casesAssigned > 0) return "at_risk";

  // Strong: real output, clean, hitting SLA.
  if (output >= 5 && rework < 0.3 && (sla === null || sla >= 0.8)) return "strong";
  // Coaching: middling rework or SLA.
  if (rework >= 0.5 || (sla !== null && sla < 0.7)) return "coaching";
  return "solid";
}

function ruleVerdict(s: StaffMetrics): StaffVerdict {
  const rating = s.isNewHire && s.submittedWindow < 2 ? "too_new" : ruleRating(s);
  const bits: string[] = [];
  bits.push(`${s.submittedWindow} submitted`);
  if (s.reworkRate !== null) bits.push(`${s.reworkRate} rework/case`);
  if (s.slaHitRate !== null) bits.push(`${Math.round(s.slaHitRate * 100)}% on-time`);
  bits.push(`${s.hoursLoggedWindow}h logged`);
  const headline = bits.join(" · ");

  let fix = "Keep going.";
  if (rating === "at_risk") fix = (s.reworkRate ?? 0) >= 1 ? "Quality is the problem — pair-review their next 3 files before submission." : "Slipping on deadlines — check workload and blockers today.";
  else if (rating === "coaching") fix = "Tighten quality — review the recurring rework reasons with them this week.";
  else if (rating === "strong") fix = "Recognise the work and give them a harder case or a mentee.";
  else if (rating === "too_new") fix = "Too early to judge — keep them on supervised files.";

  const rampRead = s.isNewHire
    ? `Week ${Math.max(1, Math.ceil((s.tenureDays ?? 0) / 7))}: ${s.submittedWindow} submitted, ${s.activeDays} active days, ${s.reworkRate ?? 0} rework/case. ${(s.reworkRate ?? 0) < 0.5 && s.submittedWindow >= 2 ? "Ramping well." : s.submittedWindow === 0 ? "No output yet — make sure they're unblocked." : "Watch quality as volume grows."}`
    : undefined;

  return { staffId: s.staffId, name: s.name, rating, ratingLabel: RATING_LABEL[rating], headline, fix, rampRead };
}

export function ruleJudgment(data: OpsLeadData): OpsLeadJudgment {
  const verdicts = data.staff.map(ruleVerdict);
  const coachNames = verdicts.filter((v) => v.rating === "coaching" || v.rating === "at_risk").map((v) => v.name);
  const trustNames = verdicts.filter((v) => v.rating === "strong").map((v) => v.name);
  const newHires = data.staff.filter((s) => s.isNewHire);
  const lines: string[] = [];
  lines.push(`Team: ${data.team.prepStaff} on prep · ${data.team.activeNow} active now, ${data.team.idleNow} idle, ${data.team.offlineNow} offline.`);
  lines.push(`Work: ${data.team.openCases} open (${data.team.unassignedCases} unassigned, ${data.team.atRiskOpen} at risk). ${data.team.submittedWindow} submitted in the ${data.windowLabel}.`);
  lines.push(`Bottleneck: ${data.team.bottleneck}.`);
  if (data.rebalance.length) lines.push(`Rebalance: ${data.rebalance.length} case(s) being moved to protect deadlines and balance load.`);
  if (coachNames.length) lines.push(`Coach today: ${coachNames.join(", ")}.`);
  if (trustNames.length) lines.push(`Trust with more: ${trustNames.join(", ")}.`);
  if (newHires.length) lines.push(`New hires: ${newHires.map((s) => `${s.name} (${s.tenureDays}d)`).join(", ")} — see ramp reads below.`);
  return { brief: lines.join("\n"), verdicts, aiUsed: false, model: "rule-based" };
}

// ── AI judgment ────────────────────────────────────────────────────────

function buildPrompt(data: OpsLeadData): string {
  // Compact, factual per-staff table — no PII beyond names already in the CRM.
  const rows = data.staff.map((s) => ({
    name: s.name,
    role: s.role,
    tenureDays: s.tenureDays,
    newHire: s.isNewHire,
    openAssigned: s.casesAssigned,
    atRiskAssigned: s.atRiskAssigned,
    submitted: s.submittedWindow,
    avgHoursToSubmit: s.avgHoursToSubmit,
    slaHitRate: s.slaHitRate,
    reworkRate: s.reworkRate,
    hoursLogged: s.hoursLoggedWindow,
    activeDays: s.activeDays,
    liveStatus: s.status,
    lanes: s.lanes,
    functions: s.functions,
    employment: s.employment,
    capacityHours: s.capacityHours,
    offToday: s.offToday,
  }));
  return [
    `You are the Operations Lead for Newton Immigration, a Canadian immigration consultancy scaling from 120 to 500 cases/day.`,
    `You ARE the management for this team — the owner is handing you day-to-day leadership of a 10-25 person case-prep team. They have weak management coverage and high, temporary-staff turnover, and they want you to run the floor better than they can: unsentimental, decisive, specific, and fair. Manage like a calm, experienced operations director who has read all the numbers and is now telling the owner exactly what's going on and what to do. Don't hedge. Name names. Cite the specific case IDs and numbers. Call out who is carrying the firm and who is dragging it. Be direct but never cruel.`,
    ``,
    `Window: ${data.windowLabel}. Generated: ${data.generatedAt}.`,
    `Definitions: "rework rate" = reviewer change-flags per submitted case (lower is better). "SLA hit rate" = share submitted before their per-case deadline. "at risk" = open case overdue or due soon.`,
    ``,
    `IMPORTANT — focus on PROCESSING THROUGHPUT, not stale-case noise. Many "at risk" cases are old files stalled WAITING ON THE CLIENT for documents (docs not in yet) — those are a follow-up/chase problem, NOT a sign the team is sitting on work, so do NOT frame them as the team's failure or fixate on their huge overdue hours. The real processing question is: of the cases where the DOCUMENTS ARE IN and it's in the team's court (the READY-TO-SUBMIT list below), which is oldest and should be submitted first. Lead the brief with that.`,
    ``,
    `TEAM SUMMARY: ${JSON.stringify(data.team)}`,
    `STAFF: ${JSON.stringify(rows)}`,
    `READY TO SUBMIT — TEAM'S COURT, SUBMIT THESE FIRST (docs are in; oldest/most-ready first): ${JSON.stringify((data.readyToSubmitCases || []).map((c) => ({ case: c.caseId, client: c.client, type: c.formType, owner: c.owner, phase: c.phase, daysOld: c.daysOld })))}`,
    `AT-RISK CASES (may include old files stalled waiting on the CLIENT for docs — treat those as chase/follow-up, not team failure): ${JSON.stringify(data.atRiskCases.map((c) => ({ case: c.caseId, client: c.client, type: c.formType, owner: c.assignee, sla: c.slaLabel })))}`,
    `PAID BUT NOT STARTED (clients who paid, work hasn't begun — money waiting; longest first): ${JSON.stringify(data.paidNotStartedCases.map((c) => ({ case: c.caseId, client: c.client, type: c.formType, daysWaiting: c.daysWaiting })))}`,
    `STUCK IN REWORK (reviewer sent these back, preparer hasn't refixed/resubmitted; longest first — name who's sitting on them): ${JSON.stringify((data.reworkStuckCases || []).map((c) => ({ case: c.caseId, owner: c.owner, type: c.formType, daysStuck: c.daysStuck })))}`,
    `PLANNED REBALANCE MOVES (about to happen): ${JSON.stringify(data.rebalance.map((m) => ({ case: m.caseId, from: m.fromName, to: m.toName, why: m.reason })))}`,
    `ALREADY REASSIGNED IN LAST 24H (you did these): ${JSON.stringify(data.recentReassignments.map((m) => ({ case: m.caseId, from: m.from, to: m.to })))}`,
    ``,
    `Return ONLY valid JSON (no markdown) of shape:`,
    `{`,
    `  "brief": "string — the owner's daily leadership brief. 5-8 short lines, plain text, newline-separated. LEAD with processing priority: name the specific READY-TO-SUBMIT cases (docs in, team's court) that are oldest and should go out first today, with their owners. Then: who to coach today and the specific quality issue; who to trust with more; how new hires are ramping; and the one thing only the owner can handle. For old cases stalled waiting on the client, frame them as 'chase the client for docs', not team failure. Be direct and specific, name people and case IDs, cite numbers. No fluff, no greetings.",`,
    `  "verdicts": [ { "name": "string (must match a STAFF name exactly)", "rating": "strong|solid|coaching|at_risk|too_new", "headline": "one factual line citing their numbers", "fix": "the single most useful next step for this person", "rampRead": "ONLY for new hires: is this person picking it up fast, are they systematic, invest or watch — one or two sentences. Omit for non-new-hires." } ]`,
    `}`,
    `Rate fairly: protect against judging someone harshly on tiny samples (low tenure or <2 submitted = likely too_new). Reward clean high-volume work. Flag high rework or missed SLAs with real volume. Every STAFF member must appear exactly once in verdicts.`,
  ].join("\n");
}

export async function aiJudgment(data: OpsLeadData): Promise<OpsLeadJudgment> {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  const fallback = ruleJudgment(data);
  if (!apiKey) return fallback;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: buildPrompt(data) }],
      }),
    });
    if (!res.ok) {
      console.error("[ops-lead-ai] API error:", res.status, await res.text().catch(() => ""));
      return fallback;
    }
    const j: any = await res.json();
    const text = String(j?.content?.[0]?.text || "").trim();
    const parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());

    // Merge AI verdicts onto the staff list, keeping the deterministic rating as a
    // backstop so every person is covered even if the model skips someone.
    const byName = new Map<string, any>();
    for (const v of parsed.verdicts || []) byName.set(String(v.name || "").toLowerCase().trim(), v);

    const verdicts: StaffVerdict[] = data.staff.map((s) => {
      const base = ruleVerdict(s);
      const v = byName.get(s.name.toLowerCase().trim());
      if (!v) return base;
      const rating = (["strong", "solid", "coaching", "at_risk", "too_new"].includes(v.rating) ? v.rating : base.rating) as Rating;
      return {
        staffId: s.staffId,
        name: s.name,
        rating,
        ratingLabel: RATING_LABEL[rating],
        headline: String(v.headline || base.headline).slice(0, 240),
        fix: String(v.fix || base.fix).slice(0, 280),
        rampRead: s.isNewHire ? String(v.rampRead || base.rampRead || "").slice(0, 320) || undefined : undefined,
      };
    });

    const brief = String(parsed.brief || fallback.brief).trim();
    return { brief, verdicts, aiUsed: true, model: MODEL };
  } catch (e) {
    console.error("[ops-lead-ai] failed, using rule-based:", (e as Error).message);
    return fallback;
  }
}
