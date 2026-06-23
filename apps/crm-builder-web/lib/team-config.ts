// ─────────────────────────────────────────────────────────────────────
// Team operating profiles — the "who does what" layer.
//
// This is SEPARATE from the CRM access role (Admin/Staff/etc). Access roles stay
// small and fixed for security; this file customises each person's OPERATING
// reality — which application lanes they handle, whether they prep/review/lead,
// how many hours they have, their off-days, and whether they're still on.
//
// The AI Operations Lead reads this to assign work by real capability + capacity
// instead of a crude role guess. Editing a person = edit one entry here. New
// hires only start being scored/assigned once they also have a CRM login.
//
// Lanes are matched as case-insensitive substrings against the case's form type
// (e.g. "pgwp" matches "Post-Graduation Work Permit (PGWP)"). "all" = handles any
// type (reviewers, generalists, trainees).
// ─────────────────────────────────────────────────────────────────────

export type OpsFunction = "prep" | "review" | "lead" | "intake" | "marketing";

export interface OpsProfile {
  name: string;                 // display name
  match: string[];              // name variants to match against CRM accounts
  access?: "admin" | "staff";   // informational only — we never change CRM roles
  functions: OpsFunction[];
  lanes: string[] | "all";      // form-type substrings they handle
  employment: "full_time" | "part_time";
  temporary?: boolean;
  offDays?: number[];           // 0=Sun … 6=Sat (Pacific)
  weeklyHours: number;          // capacity seed (hours/week) — tune later
  takesComplex?: boolean;       // can own escalations / hard files
  needsSupervision?: boolean;
  laneLead?: boolean;
  worksUnder?: string;
  // Explicit new-hire flag. Without this the Ops Lead guessed tenure from the
  // earliest work-session, which (time-tracking started recently) mislabeled
  // veterans as new. Set true ONLY for genuine recent hires.
  isNewHire?: boolean;
  active: boolean;
  notes?: string;
}

// Automation lane = the types the case agent already auto-drafts/assembles.
const AUTOMATION_LANES = ["pgwp", "visitor record", "study permit ext", "trv", "visitor visa"];
// Manual / complex lane.
const MANUAL_LANES = ["sowp", "spousal", "lmia", "work permit", "vowp", "sponsor"];

export const TEAM: OpsProfile[] = [
  {
    name: "Avneet Kaur",
    match: ["avneet kaur", "avneet"],
    access: "staff",
    functions: ["prep", "review"],
    lanes: AUTOMATION_LANES,
    employment: "part_time",
    offDays: [2, 4], // off Tuesday & Thursday
    weeklyHours: 21,
    takesComplex: false,
    laneLead: true,
    active: true,
    notes: "Automation-lane LEAD: PGWP, Visitor Record, Study Permit Extension, TRV. Part-time (off Tue/Thu). Slow but capable. Show her only these types and notify her. Her non-lane cases should be reassigned out.",
  },
  {
    name: "Hemany",
    match: ["hemany", "hemany kaur", "hemany kaur kumar"],
    functions: ["prep"],
    lanes: AUTOMATION_LANES,
    employment: "full_time",
    temporary: true,
    weeklyHours: 35,
    worksUnder: "Avneet Kaur",
    active: true,
    notes: "Works with Avneet on the automation lane. Good speed. Watch quality (highest rework) — coach on a checklist.",
  },
  {
    name: "Parinita",
    match: ["parinita"],
    functions: ["prep"],
    lanes: AUTOMATION_LANES,
    employment: "full_time",
    temporary: true,
    weeklyHours: 35,
    worksUnder: "Avneet Kaur",
    active: true,
    notes: "Works with Avneet on the automation lane. Intelligent, full-time temp. Watch quality (rework).",
  },
  {
    name: "Manila Khati",
    match: ["manila khati", "manila"],
    functions: ["prep"],
    lanes: MANUAL_LANES,
    employment: "full_time",
    weeklyHours: 35,
    takesComplex: true,
    active: true,
    notes: "Manual/complex lane: spousal/SOWP, LMIA, VOWP, future PR sponsorship. Full-time, can be very active.",
  },
  {
    name: "Ramandeep Kaur",
    match: ["ramandeep kaur", "ramandeep"],
    functions: ["review", "lead", "prep"],
    lanes: "all",
    employment: "full_time",
    weeklyHours: 35,
    takesComplex: true,
    active: true,
    notes: "Reviewer for ALL applications; particularly PR sponsorships / other. Team lead.",
  },
  {
    name: "Serbleen Kaur",
    match: ["serbleen kaur", "serbleen", "sarbleen"],
    functions: ["review", "prep"],
    lanes: "all",
    employment: "full_time",
    weeklyHours: 30,
    needsSupervision: true,
    active: true,
    notes: "Review + prep. Active but needs supervision.",
  },
  {
    name: "Sukhman Kaur",
    match: ["sukhman kaur", "sukhman"],
    functions: ["prep", "intake"],
    lanes: "all",
    employment: "full_time",
    weeklyHours: 35,
    active: true,
    notes: "Prep + communicator (client intake / follow-up). Tagged Admin in CRM but actually preps — handled here, no access change needed.",
  },
  {
    name: "Rapneet Kaur",
    match: ["rapneet kaur", "rapneet"],
    functions: ["prep"],
    lanes: [],
    employment: "full_time",
    weeklyHours: 0,
    active: false,
    notes: "Departed — no longer on the team. Her open cases should be reassigned.",
  },
  {
    name: "Jinia",
    isNewHire: true,
    match: ["jinia", "jinai", "jeenia", "jeena"],
    functions: ["prep"],
    lanes: "all",
    employment: "full_time",
    weeklyHours: 35,
    active: true,
    notes: "New (~3 days), fast. Ramp by giving a good volume across ALL types and train. PR sponsorship planned later. Needs a CRM login to start being tracked.",
  },
  {
    name: "Simran",
    isNewHire: true,
    match: ["simran"],
    functions: ["prep"],
    lanes: "all",
    employment: "full_time",
    weeklyHours: 35,
    active: true,
    notes: "New (~2 days), doing fine. Move into VOWP/LMIA/SOWP in future. Needs a CRM login to start being tracked.",
  },
  {
    name: "Venus",
    match: ["venus"],
    functions: ["marketing"],
    lanes: [],
    employment: "full_time",
    weeklyHours: 35,
    active: true,
    notes: "Marketing (replacing Akanksha). Not case prep.",
  },
];

const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Resolve a CRM account name to its operating profile (full-name first, then
// first-name). Applied to staff accounts only, so collision risk is low.
export function profileForName(name: string): OpsProfile | null {
  const n = norm(name);
  if (!n) return null;
  for (const p of TEAM) if (p.match.some((m) => norm(m) === n)) return p;
  const first = n.split(" ")[0];
  for (const p of TEAM) if (p.match.some((m) => norm(m) === first || norm(m).split(" ")[0] === first)) return p;
  return null;
}

// Does this person's lane set handle the given case form type?
export function laneHandlesType(lanes: string[] | "all", formType: string): boolean {
  if (lanes === "all") return true;
  if (!lanes.length) return false;
  const ft = norm(formType);
  return lanes.some((tag) => ft.includes(norm(tag)));
}

// Is this profile an active person who preps or reviews (so we score + assign)?
export function isActiveOps(p: OpsProfile): boolean {
  return p.active && (p.functions.includes("prep") || p.functions.includes("review"));
}
