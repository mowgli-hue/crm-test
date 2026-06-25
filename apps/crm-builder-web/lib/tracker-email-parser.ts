// ─────────────────────────────────────────────────────────────────────
// IRCC email → tracker stage parser.
//
// Pure functions (no I/O) so they're easy to test. Given an email's subject
// and body, detect (a) which application number(s) it references and (b) which
// tracker stage it implies. The sync job uses this to advance the matching
// tracker entry — forward-only, so a re-read of the same email never regresses
// or double-fires.
// ─────────────────────────────────────────────────────────────────────

import { TRACKER_STAGES } from "@/lib/models";

// Ordered most-specific → least, because we want the FURTHEST stage an email
// implies. Each rule: a stage label (must exist in TRACKER_STAGES) + matchers.
// Matchers run against the lowercased subject + body.
const STAGE_RULES: Array<{ stage: string; any: RegExp[] }> = [
  { stage: "PR Card Received", any: [/pr card.*(mailed|sent|produced|ready)/, /permanent resident card.*(mailed|produced)/] },
  { stage: "Landed (PR Confirmed)", any: [/confirmation of permanent residence.*(complete|landed)/, /\blanded\b/, /welcome to canada/, /your pr (status|landing) is confirmed/] },
  { stage: "COPR Issued", any: [/copr/, /confirmation of permanent residence/, /\be-?copr\b/] },
  { stage: "PPR / Passport Request", any: [/passport request/, /\bppr\b/, /submit your passport/, /request for your passport/, /ready for visa/] },
  { stage: "Interview Requested", any: [/interview (is )?(required|requested|scheduled)/, /you are invited.*interview/] },
  { stage: "Background / Security Check", any: [/background check/, /security (check|screening)/, /your application is in progress.*background/] },
  { stage: "Additional Documents Requested", any: [/additional document/, /request for additional/, /please (provide|submit).*document/, /we require the following/, /(^|\b)request letter\b/] },
  { stage: "Sponsorship Approved (SA)", any: [/sponsorship (application )?(has been )?approved/, /approved as a sponsor/, /\bsa\b.*approved/] },
  { stage: "Medical Passed", any: [/medical.*(passed|met the requirements|complete|cleared)/, /upfront medical.*received/, /imm 1017.*(complete|received)/] },
  { stage: "Medical Requested", any: [/medical exam(ination)? (is )?(required|requested)/, /complete a medical/, /imm ?1017/, /request for a medical/] },
  { stage: "Biometrics Completed", any: [/biometrics.*(received|collected|complete|provided)/, /your biometrics have been/] },
  { stage: "Biometrics Requested", any: [/biometric instruction/, /\bbil\b/, /provide your biometrics/, /request for biometrics/, /biometrics? (are |is )?required/] },
  { stage: "AOR Received", any: [/acknowledgement of receipt/, /\baor\b/, /we have received your application/, /your application has been received/] },
  { stage: "e-APR / Application Submitted", any: [/application submitted/, /you have submitted your application/, /e-?apr/] },
  { stage: "ITA Received", any: [/invitation to apply/, /\bita\b/, /you have been invited to apply/] },
  { stage: "Refused / Withdrawn", any: [/your application (has been |was )?refused/, /we are unable to approve/, /application.*withdrawn/] },
];

const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  TRACKER_STAGES.map((s, i) => [s, i])
);

export function stageIndex(stage: string): number {
  return STAGE_INDEX[stage] ?? -1;
}

// IRCC application / file numbers come in a few shapes. Be generous but anchored
// so we don't grab random digits. Examples: W313624333, E004994953, V123456789,
// F000123456 (sponsorship), and "Application number: 1234567890".
const APP_NUM_PATTERNS: RegExp[] = [
  /\b([EWVF]\d{9})\b/gi,                              // EE/work/visitor/family file
  /\bapplication (?:number|no\.?|#)\s*:?\s*([A-Z0-9]{6,15})\b/gi,
  /\b(IRCC[-\s]?\d{6,12})\b/gi,
  /\b([A-Z]\d{6,10})\b/g,                            // generic letter + digits
];

export function extractAppNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const re of APP_NUM_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const v = (m[1] || "").toUpperCase().replace(/\s+/g, "");
      if (v.length >= 6) found.add(v);
      if (re.lastIndex === m.index) re.lastIndex++; // guard zero-width
    }
  }
  return [...found];
}

export interface ParsedIrccEmail {
  detectedStage: string | null;   // furthest stage the email implies
  stageIdx: number;               // index in TRACKER_STAGES (-1 if none)
  appNumbers: string[];           // candidate application numbers
  matchedRule: string | null;
}

// Detect the furthest (highest-index) stage the email implies.
export function parseIrccEmail(subject: string, body: string): ParsedIrccEmail {
  const hay = `${subject || ""}\n${body || ""}`.toLowerCase();
  let best: { stage: string; idx: number } | null = null;
  for (const rule of STAGE_RULES) {
    if (rule.any.some((re) => re.test(hay))) {
      const idx = stageIndex(rule.stage);
      // Refused is special — always wins if present (terminal negative).
      if (rule.stage === "Refused / Withdrawn") {
        best = { stage: rule.stage, idx };
        break;
      }
      if (!best || idx > best.idx) best = { stage: rule.stage, idx };
    }
  }
  return {
    detectedStage: best?.stage ?? null,
    stageIdx: best?.idx ?? -1,
    appNumbers: extractAppNumbers(`${subject || ""}\n${body || ""}`),
    matchedRule: best?.stage ?? null,
  };
}

// Is the sender an IRCC / Canada immigration address? Used to ignore noise.
export function looksLikeIrcc(from: string): boolean {
  const f = (from || "").toLowerCase();
  return /cic\.gc\.ca|ircc\.gc\.ca|canada\.ca|noreply.*(cic|ircc)|do-?not-?reply.*(cic|ircc)/.test(f);
}
