// lib/whatsapp-ai-intake.ts
// AI-powered conversational intake — Claude chats with client naturally

import { getQuestionFlowForFormType, getQuestionPromptsForFormType, getQuestionBatchesForFormType } from "@/lib/application-question-flows";
import { resolveApplicationChecklistKey } from "@/lib/application-checklists";
import { sendWhatsAppText, sendWhatsAppTemplate, sendDocumentChecklist } from "@/lib/whatsapp";
import { getCase, updateCaseProcessing, addMessage } from "@/lib/store";
import { Pool } from "pg";

// ── Pre-answer detection ──
// Returns a map of { questionIndex (0-based) → already-known answer } for
// questions whose answers we can derive from the passport scan / existing intake data.
// This lets the WhatsApp bot SKIP asking these questions.
//
// Each prompt string has identifying keywords; we match against them so this works
// across all 17 form types without per-form mapping.
function getPreAnsweredQuestions(
  prompts: string[],
  intake: Record<string, any>
): Record<number, string> {
  const known: Record<number, string> = {};
  if (!intake) return known;

  // Helper: does the prompt mention any of these keywords (case-insensitive)?
  const matchesAny = (prompt: string, keywords: string[]) => {
    const lower = prompt.toLowerCase();
    return keywords.some(k => lower.includes(k.toLowerCase()));
  };

  // Build the auto-answers from intake data
  const fullName = String(intake.fullName || "").trim();
  const dob = String(intake.dateOfBirth || "").trim();
  const sex = String(intake.sex || intake.gender || "").trim();
  const cityOfBirth = String(intake.cityOfBirth || "").trim();
  const countryOfBirth = String(intake.countryOfBirth || "").trim();
  const citizenship = String(intake.citizenship || countryOfBirth).trim();
  const passportNumber = String(intake.passportNumber || "").trim();
  const passportIssue = String(intake.passportIssueDate || "").trim();
  const passportExpiry = String(intake.passportExpiryDate || "").trim();

  prompts.forEach((prompt, i) => {
    // Skip if the prompt is asking specifically about a CHILD or SPOUSE name — those
    // aren't on the principal applicant's passport
    if (/spouse|partner|child|parent|sibling|father|mother/i.test(prompt)) return;

    // Q: "Full name as on passport"
    if (fullName && matchesAny(prompt, ["full name", "name as on passport", "name on passport"])) {
      known[i] = fullName;
    }
    // Q: "Date of birth"
    else if (dob && /YYYY-MM-DD/.test(prompt) && matchesAny(prompt, ["date of birth", "dob"])) {
      known[i] = dob;
    }
    // Q: "Gender / Sex"
    else if (sex && matchesAny(prompt, ["gender", "sex (m"]) && /male|female/i.test(prompt)) {
      const s = sex.toLowerCase();
      known[i] = s.startsWith("f") ? "Female" : s.startsWith("m") ? "Male" : sex;
    }
    // Q: "Country of birth and city of birth"
    else if ((countryOfBirth || cityOfBirth) && matchesAny(prompt, ["country of birth", "place of birth", "country and city of birth"])) {
      const parts = [countryOfBirth, cityOfBirth].filter(Boolean);
      if (parts.length >= 1) known[i] = parts.join(", ");
    }
    // Q: "Country of citizenship"
    else if (citizenship && matchesAny(prompt, ["country of citizenship", "citizenship"]) && !matchesAny(prompt, ["spouse", "partner"])) {
      known[i] = citizenship;
    }
    // Q: "Passport number, issuing country, issue date and expiry date"
    else if (passportNumber && matchesAny(prompt, ["passport number"])) {
      const parts = [passportNumber, citizenship, passportIssue, passportExpiry].filter(Boolean);
      known[i] = parts.join(", ");
    }
  });

  return known;
}

// ── Inbox recovery helper ──
// Look for the most recent inbound message from this phone that LOOKS like a
// numbered batch reply (e.g. "1. No\n2. single\n3. NA"). If found, parse it
// using the same multi-numbered parser used for live replies, and return
// a {q1: ..., q2: ...} map. This is what saves Vishal-style cases where the
// client answered to an old template that didn't have a parser.
async function scanInboxForBatchedAnswers(phone: string, maxQuestions: number): Promise<Record<string, string> | null> {
  if (!process.env.DATABASE_URL) return null;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const cleanPhone = phone.replace(/\D/g, "");
    const last9 = cleanPhone.slice(-9);
    // Get most recent inbound messages — look at last 30 days
    const res = await pool.query(
      `SELECT message, created_at
       FROM whatsapp_inbox
       WHERE direction = 'inbound'
         AND (phone = $1 OR phone LIKE $2)
         AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 50`,
      [phone, `%${last9}`]
    );
    if (res.rows.length === 0) return null;

    // Find the message with the most numbered markers (likely the batch reply)
    let bestMessage: string | null = null;
    let bestCount = 0;
    for (const row of res.rows) {
      const text = String(row.message || "");
      // Quick filter — needs at least 3 numbered markers to be considered a batch
      const markers = (text.match(/(?:^|\n|\s)(\d{1,2})[.)\:]+\s/g) || []).length;
      if (markers > bestCount && markers >= 3) {
        bestCount = markers;
        bestMessage = text;
      }
    }
    if (!bestMessage) return null;

    // Parse using same logic as the live batch parser
    // Markers like "1.", "1)", "1.)", "1:" with or without spaces
    const markerRegex = /(?:^|\s)(\d{1,2})[.)\:]+\s*/g;
    const positions: Array<{ num: number; start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = markerRegex.exec(bestMessage)) !== null) {
      positions.push({
        num: parseInt(m[1], 10),
        start: m.index + (m[0].length - m[0].trimStart().length),
        end: markerRegex.lastIndex,
      });
    }
    if (positions.length < 2) return null;

    const answers: Record<string, string> = {};
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const nextStart = i + 1 < positions.length ? positions[i + 1].start : bestMessage.length;
      const answerText = bestMessage.substring(pos.end, nextStart).trim();
      if (!answerText) continue;
      // The number in the reply IS the question number (1-indexed) — keep as-is
      if (pos.num >= 1 && pos.num <= maxQuestions) {
        answers[`q${pos.num}`] = answerText;
      }
    }
    return Object.keys(answers).length > 0 ? answers : null;
  } finally {
    await pool.end().catch(() => {});
  }
}

// Send message AND save to inbox so it shows in chat
async function sendAndSave(phone: string, message: string, caseId: string | null, caseName: string | null): Promise<void> {
  await sendWhatsAppText(phone, message);
  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query(
      `INSERT INTO whatsapp_inbox (id, phone, message, direction, matched_case_id, matched_case_name, is_read, created_at)
       VALUES ($1, $2, $3, 'outbound', $4, $5, TRUE, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [`WA-OUT-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, phone, message, caseId, caseName]
    );
    await pool.end();
  } catch { /* non-fatal */ }
}

export type IntakeSession = {
  caseId: string;
  companyId: string;
  phone: string;
  clientName: string;
  formType: string;
  questions: string[];
  currentIndex: number;
  answers: Record<string, string>;
  phase: "intake" | "awaiting_template_reply" | "ai_chat" | "awaiting_bulk" | "complete";
  batches?: string[][];
  batchTitles?: string[];
  currentBatch?: number;
  conversationHistory: Array<{ role: "assistant" | "user"; content: string }>;
  collectedFields: Record<string, string>;
  chatTurns: number;
  // Map of question index → pre-known answer from passport / case data.
  // Skipped during the WhatsApp Q&A; pre-filled into answers automatically.
  preAnswered?: Record<number, string>;
  // Per-question validation retry counter. Lets the bot re-ask once on
  // clearly wrong answers (e.g., "punjabi" for employment) but not loop
  // forever — after 1 retry, accept and flag for staff review (Smart mode).
  // Keyed by question index as string.
  validationRetries?: Record<string, number>;
  // Audit trail of validation flags — answers that passed validation but
  // looked borderline. Surfaced to staff via the form mapper's _review_flags.
  validationFlags?: Array<{ qIndex: number; reason: string }>;
  // ISO timestamp of last "take your time" delay-ack we sent. Used to
  // throttle so we don't reply with the same "no rush" message every time
  // the client says "still working on it" several times in a row.
  ackedDelayAt?: string;
};

// Check if `text` is a "delay phrase" — client saying they'll reply later.
// We do NOT advance the session state when this fires, just acknowledge so
// they don't feel ignored. Examples: "working on it", "give me 5 min",
// "will reply soon", "later", "in a bit", "tomorrow morning", etc.
//
// Important: this must NOT match real answers. "I'll send the docs later" is
// a delay; "I will be in Canada later this year" is NOT (it answers a date
// question). To handle this we require the message to be SHORT (<= 15 words)
// and not contain a digit or question-style content.
function isDelayPhrase(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  // Reject if too long — delays are short. Real answers can be long.
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount > 15) return false;
  // Reject if contains 4+ digits (years, IDs, dates) — likely a real answer
  if (/\d{4,}/.test(t)) return false;
  // Reject if contains common form values — likely an answer to a question.
  // Use word boundaries on both sides so "not" doesn't match "no".
  if (/\b(yes|no|n\/a|single|married|common-law|widow|separated)\b/i.test(t) && wordCount <= 5) {
    return false;
  }

  // Patterns matching "I'll reply later" style. Each line is one phrase
  // family, kept loose to catch typos and variants.
  const patterns: RegExp[] = [
    /\b(working|workin)\s+on\s+(it|this)\b/,           // "working on it"
    /\bwill\s+(text|reply|send|do|get|update|come)\b/, // "will text you", "will reply soon"
    /\b(give\s+me|gimme)\s+(\d+\s+|some\s+|a\s+)?(time|min|minute|hour|sec|moment)/, // "give me 5 min" / "gimme 10 minutes"
    /\bin\s+(a\s+)?(bit|min|minute|sec|moment|while)\b/, // "in a bit", "in a min"
    /\b(text|reply|message|msg|send|update)\s+(you\s+)?(later|soon|in\s+a\s+bit|tomorrow|tmrw|tmr|in\s+\d+|shortly)/, // "text you later"
    /\b(later|soon|tomorrow|tmrw|tmr|tonight|shortly|asap)\b\s*(today|morn|morning|after|afternoon|even|evening|night|please)?\s*[!?.\s]*$/, // "later", "tomorrow morning"
    /\b(busy|on\s+the\s+way|driving|at\s+work|in\s+a\s+meeting|one\s+min|hold\s+on|wait|moment)/, // "busy", "in a meeting"
    /\b(checking|finding|looking|getting)\s+(it|this|the|my|info|details|docs?)/, // "checking my docs"
    /\bnot\s+now\b/,                                   // "not now"
    /\b(will|gonna|going\s+to)\s+(check|look|find|get|gather|fill)/, // "will check", "going to gather"
    /\b(give\s+me\s+a\s+sec|one\s+sec|hold\s+on)/,     // "one sec"
  ];
  return patterns.some((re) => re.test(t));
}

// Session store in case DB
export async function getActiveSession(phone: string, companyId?: string) {
  return getSession(phone, companyId);
}

export async function getSession(phone: string, companyId?: string): Promise<IntakeSession | undefined> {
  try {
    const { listCases } = await import("@/lib/store");
    const cId = companyId || process.env.DEFAULT_COMPANY_ID || "newton";
    const cases = await listCases(cId);
    const n = phone.replace(/\D/g, "");
    const matched = cases.find((c) => {
      const cp = (c.leadPhone || "").replace(/\D/g, "");
      return cp && (n.endsWith(cp) || cp.endsWith(n));
    });
    console.log(`🔍 getSession: phone=${n} | matched=${matched?.client || "NONE"} | hasPgwpIntake=${!!matched?.pgwpIntake} | hasSession=${!!(matched?.pgwpIntake as any)?.whatsappSession}`);
    if (!matched) return undefined;
    const intake = (matched.pgwpIntake || {}) as Record<string, string>;
    const raw = intake.whatsappSession;
    if (!raw) return undefined;
    const session = JSON.parse(raw) as IntakeSession;
    console.log(`✅ Session found: phase=${session.phase} caseId=${session.caseId} chatTurns=${session.chatTurns} currentBatch=${session.currentBatch ?? 0}`);
    return session;
  } catch (e) { 
    console.error("getSession error:", e);
    return undefined; 
  }
}

/**
 * Find ANY active or completed intake session across ALL cases sharing this
 * phone number. Returns the highest-priority session found, with its caseId.
 *
 * Bug fixed (CASE-1430 Harpreet, May 2026): the basic getSession() returns the
 * session for the FIRST case found by leadPhone match. If a client has more
 * than one case (e.g., a Study Permit Extension already done + a new Study
 * Permit case just created), getSession may return the new case's empty
 * session, the startIntakeSession idempotency guard sees no existing session,
 * and a fresh intake fires — re-greeting the client and confusing them.
 *
 * Priority order (highest first):
 *   1. complete       — fully done intake (don't re-trigger)
 *   2. ai_chat        — mid-intake (don't re-trigger)
 *   3. awaiting_template_reply with chatTurns > 0 — already engaged
 *   4. awaiting_template_reply with chatTurns = 0 — fresh template (OK to retry)
 *
 * Returns undefined only if NO case for this phone has any session at all.
 */
export async function findHighestPrioritySessionForPhone(
  phone: string,
  companyId?: string,
): Promise<{ session: IntakeSession; caseId: string; clientName: string; formType: string } | undefined> {
  try {
    const { listCases } = await import("@/lib/store");
    const cId = companyId || process.env.DEFAULT_COMPANY_ID || "newton";
    const cases = await listCases(cId);
    const n = phone.replace(/\D/g, "");
    const matched = cases.filter((c) => {
      const cp = (c.leadPhone || "").replace(/\D/g, "");
      return cp && (n.endsWith(cp) || cp.endsWith(n));
    });
    if (matched.length === 0) return undefined;

    // Collect all sessions across all matching cases
    const candidates: Array<{ session: IntakeSession; caseId: string; clientName: string; formType: string; priority: number }> = [];
    for (const c of matched) {
      const intake = (c.pgwpIntake || {}) as Record<string, string>;
      const raw = intake.whatsappSession;
      if (!raw) continue;
      let session: IntakeSession;
      try {
        session = JSON.parse(raw) as IntakeSession;
      } catch { continue; }
      // Higher number = higher priority
      let priority = 0;
      if (session.phase === "complete") priority = 4;
      else if (session.phase === "ai_chat") priority = 3;
      else if (session.phase === "awaiting_template_reply" && (session.chatTurns || 0) > 0) priority = 2;
      else if (session.phase === "awaiting_template_reply") priority = 1;
      candidates.push({
        session,
        caseId: c.id,
        clientName: c.client || "",
        formType: c.formType || "",
        priority,
      });
    }
    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => b.priority - a.priority);
    const best = candidates[0];
    if (candidates.length > 1) {
      console.log(
        `🔍 findHighestPrioritySessionForPhone: phone=${n} matched ${matched.length} cases, ` +
        `${candidates.length} had sessions. Highest = ${best.caseId} (${best.formType}, phase=${best.session.phase}).`,
      );
    }
    return { session: best.session, caseId: best.caseId, clientName: best.clientName, formType: best.formType };
  } catch (e) {
    console.error("findHighestPrioritySessionForPhone error:", e);
    return undefined;
  }
}

export async function setSession(phone: string, session: IntakeSession): Promise<void> {
  try {
    const { updateCasePgwpIntake, getCase, readStore, writeStore } = await import("@/lib/store");
    
    // First try updateCasePgwpIntake
    const result = await updateCasePgwpIntake(session.companyId, session.caseId, {
      whatsappSession: JSON.stringify(session),
    });
    
    // If case not found or pgwpIntake still null, force it via store
    if (!result || !result.pgwpIntake) {
      const store = await readStore();
      const idx = store.cases.findIndex((c: any) => c.companyId === session.companyId && c.id === session.caseId);
      if (idx !== -1) {
        store.cases[idx] = {
          ...store.cases[idx],
          updatedAt: new Date().toISOString(),
          pgwpIntake: {
            ...(store.cases[idx].pgwpIntake || {}),
            whatsappSession: JSON.stringify(session),
          }
        };
        await writeStore(store);
        console.log(`💾 Session saved (fallback): caseId=${session.caseId} phase=${session.phase}`);
        return;
      }
    }
    
    console.log(`💾 Session saved: caseId=${session.caseId} phase=${session.phase} chatTurns=${session.chatTurns} currentBatch=${session.currentBatch ?? 0}`);
  } catch (e) { console.error("setSession error:", e); }
}

export async function clearSession(phone: string): Promise<void> {
  try {
    const { listCases, getCase, updateCasePgwpIntake } = await import("@/lib/store");
    const cId = process.env.DEFAULT_COMPANY_ID || "newton";
    const cases = await listCases(cId);
    const n = phone.replace(/\D/g, "");
    const matched = cases.find((c) => {
      const cp = (c.leadPhone || "").replace(/\D/g, "");
      return cp && (n.endsWith(cp) || cp.endsWith(n));
    });
    if (!matched) return;
    // Clear whatsappSession from intake — use updateCasePgwpIntake (dedicated
    // function for pgwpIntake mutations; updateCaseProcessing rejects pgwpIntake
    // since that's a workflow-status function, not an intake-data function).
    await updateCasePgwpIntake(cId, matched.id, { whatsappSession: "" });
  } catch { /* non-fatal */ }
}

// Extracts the "send the first batch of questions" logic that's needed from
// two call sites:
//   1. handleIncomingReply when phase advances awaiting_template_reply → ai_chat
//   2. startIntakeSession's directStart path (no template, jump straight to Q1)
//
// Mutates the session in place (sets phase=ai_chat, currentBatch=0, etc.) and
// SAVES it before sending. Returns nothing — sends WhatsApp message via
// sendAndSave so the message also lands in the inbox.
async function sendFirstBatchAndAdvance(session: IntakeSession): Promise<void> {
  const { phone, clientName, formType, batches: maybeBatches, batchTitles: maybeTitles, questions: allQuestions, preAnswered: maybePreAns, caseId } = session;
  session.phase = "ai_chat";
  session.chatTurns = 0;
  session.currentBatch = 0;
  await setSession(phone, session);

  const firstName = clientName.split(" ")[0];
  const batches = maybeBatches || [allQuestions];
  const batchTitles = maybeTitles || [];
  const totalBatches = batches.length;
  const firstTitle = batchTitles[0] || "Part 1";
  const preAnswered = maybePreAns || {};

  // Find which absolute question indices belong to the first batch.
  // We figure this out by matching prompt text since `batches` stores strings.
  const firstBatchPrompts = batches[0];
  const firstBatchIndices: number[] = firstBatchPrompts
    .map(prompt => allQuestions.findIndex(q => q === prompt))
    .filter(i => i >= 0);

  // Filter out pre-answered ones
  const askIndices = firstBatchIndices.filter(i => preAnswered[i] === undefined);
  const askPrompts = askIndices.map(i => allQuestions[i]);
  const skippedCount = firstBatchIndices.length - askPrompts.length;

  // If ALL questions in this batch are pre-answered, skip to next batch.
  if (askPrompts.length === 0 && totalBatches > 1) {
    session.chatTurns = firstBatchIndices[firstBatchIndices.length - 1] + 1;
    session.currentBatch = 1;
    await setSession(phone, session);
    const intro = [
      `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${firstName} ਜੀ! 🙏 Hi *${firstName}*!`,
      ``,
      `Great news — we already have all your passport details on file ✓`,
      ``,
      `Just a few quick questions to complete your *${formType}* application 🙏`,
    ].join("\n");
    await sendAndSave(phone, intro, caseId, clientName);
    await new Promise(r => setTimeout(r, 600));
    await sendNextBatchAfterPreAnswers(session);
    return;
  }

  // Build the questions list with renumbered display (1, 2, 3...) for the client
  const questionsText = askPrompts.map((q, i) => `*${i + 1}.* ${q}`).join("\n\n");

  // Friendly preamble — varies based on whether we skipped anything
  const preambleLines: string[] = [
    `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${firstName} ਜੀ! 🙏 Hi *${firstName}*!`,
    ``,
  ];
  if (skippedCount > 0) {
    preambleLines.push(`Great news — we already have your passport details on file ✓`);
    preambleLines.push(``);
    preambleLines.push(`To complete your *${formType}* application, I just need answers to *${totalBatches} short sections*.`);
  } else {
    preambleLines.push(`To prepare your *${formType}* application, I have *${totalBatches} sections* of questions.`);
  }
  preambleLines.push(`Please answer each section before I send the next one.`);

  const firstMsg = [
    ...preambleLines,
    ``,
    `${firstTitle} *(Section 1 of ${totalBatches})*`,
    `━━━━━━━━━━━━━━━`,
    questionsText,
    `━━━━━━━━━━━━━━━`,
    ``,
    `Please reply with all answers numbered (1. answer, 2. answer...) 🙏`,
  ].join("\n");

  await sendAndSave(phone, firstMsg, caseId, clientName);
}

// Check if we have an active 24-hour conversation window with this client.
// WhatsApp Business policy: free-form messages can only be sent within 24h
// of the client's last inbound message. After that, we MUST use a template.
//
// Returns true if there's an inbound message from this phone within last 24h.
async function hasOpen24hWindow(phone: string): Promise<boolean> {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const last10 = String(phone).replace(/\D/g, "").slice(-10);
    const r = await pool.query(
      `SELECT 1 FROM whatsapp_inbox
       WHERE direction = 'inbound'
         AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = $1
         AND created_at > NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [last10]
    );
    await pool.end();
    return r.rows.length > 0;
  } catch (e) {
    // If lookup fails, conservatively return false — better to send template
    // (which always works) than fail to send anything at all.
    console.warn(`[hasOpen24hWindow] check failed for ${phone}: ${(e as Error).message.slice(0, 100)}`);
    return false;
  }
}

// Start AI chat intake
export async function startIntakeSession(params: {
  caseId: string;
  companyId: string;
  phone: string;
  clientName: string;
  formType: string;
  // Optional — case's existing intake data (passport scan, manual entries).
  // When provided, questions whose answers are already known will be SKIPPED,
  // saving the client from having to retype passport details.
  existingIntake?: Record<string, any>;
}): Promise<{ success: boolean; error?: string; skippedCount?: number; recoveredCount?: number; mode?: string }> {
  const { caseId, companyId, phone, clientName, formType, existingIntake } = params;
  console.log(`▶️  startIntakeSession ENTRY: caseId=${caseId} phone=${phone} client="${clientName}" formType="${formType}"`);

  // ── PRIMARY guard (NEW, May 2026 after CASE-1430 Harpreet bug): ──
  // Check if ANY OTHER case sharing this phone has an active session that
  // would be disrupted by a fresh intake.
  //
  // This is nuanced — we want to BLOCK these scenarios:
  //   - Harpreet bug: client mid-conversation on case A, new duplicate case B
  //     created, fresh intake would re-greet and confuse them
  //   - True duplicates: same form type case created twice (Study Permit
  //     Extension on case A, Study Permit Extension on case B again)
  //
  // But we want to ALLOW these legitimate scenarios:
  //   - Returning client: completed PGWP intake months ago on case A,
  //     today applies for Spousal Sponsorship → new case B → intake SHOULD
  //     start fresh
  //   - Different family member: same phone number used by multiple family
  //     members (parent's phone for child's case)
  //
  // Decision matrix:
  //   - Other case has phase=ai_chat (mid-conversation)           → BLOCK
  //   - Other case has phase=awaiting_template_reply, >0 turns    → BLOCK
  //   - Other case has phase=complete, SAME formType as new case  → BLOCK (likely duplicate)
  //   - Other case has phase=complete, DIFFERENT formType         → ALLOW (new service)
  //   - Other case has phase=awaiting_template_reply, 0 turns     → ALLOW (template was sent but no reply, this is a retry)
  try {
    const otherCaseSession = await findHighestPrioritySessionForPhone(phone, companyId);
    if (otherCaseSession && otherCaseSession.caseId !== caseId) {
      const otherPhase = otherCaseSession.session.phase;
      const otherTurns = otherCaseSession.session.chatTurns || 0;
      const otherFormType = otherCaseSession.formType || "";

      // Normalize form types for comparison: lowercase, trim, collapse spaces.
      // Different wordings of the same form should still match (e.g.,
      // "Study Permit Extension" vs "Study Permit Extension (Inside Canada)"
      // are considered the same family).
      const norm = (s: string) =>
        s.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").replace(/\s+/g, " ").trim();
      const sameFormType = norm(otherFormType) === norm(formType);

      const isMidConversation = otherPhase === "ai_chat";
      const isAlreadyGreeted = otherPhase === "awaiting_template_reply" && otherTurns > 0;
      const isCompletedDuplicate = otherPhase === "complete" && sameFormType;

      const shouldBlock = isMidConversation || isAlreadyGreeted || isCompletedDuplicate;

      if (shouldBlock) {
        const reason = isMidConversation
          ? `client is mid-conversation on another case (${otherCaseSession.caseId}, phase=${otherPhase})`
          : isAlreadyGreeted
            ? `client was already greeted on another case (${otherCaseSession.caseId})`
            : `client already has a completed ${otherFormType} intake on case ${otherCaseSession.caseId} — this looks like a duplicate case`;
        console.warn(
          `🛑 BLOCKING new intake for ${phone} on ${caseId} (${formType}) — ${reason}. ` +
          `To start fresh, use the admin "Reset Intake" endpoint on ${otherCaseSession.caseId} first.`,
        );
        return {
          success: true,
          skippedCount: 0,
          recoveredCount: 0,
          mode: "skip-other-case-has-active-session",
          error: `Skipped: ${reason}. New case is ${formType}; existing case ${otherCaseSession.caseId} is ${otherFormType}.`,
        };
      } else if (otherPhase === "complete" && !sameFormType) {
        // Legitimate new intake for a returning client applying for a
        // different service. Log it so staff can see the pattern, but allow.
        console.log(
          `✅ Allowing new intake for ${phone} on ${caseId} (${formType}) — ` +
          `returning client (previous case ${otherCaseSession.caseId} completed for different service: ${otherFormType}).`,
        );
      }
    }
  } catch (e) {
    // Non-fatal — fall through to the existing same-case guard below.
    console.warn(`[startIntakeSession] cross-case session check failed for ${phone}: ${(e as Error).message.slice(0, 100)}`);
  }

  // ── SECONDARY guard (same-case re-trigger, original Ramandeep fix): ──
  //
  // Real bug from CASE-1399 (Ramandeep): staff clicked "Send Intake" multiple
  // times, AND auto-intake fired again on re-save. Each call here was creating
  // a fresh session and OVERWRITING her progress — chatTurns went 0 → 0 → 0
  // because every call reset her back to "awaiting_template_reply".
  //
  // If a session already exists and is past the template phase (i.e., the
  // client has already engaged), skip re-creating it. Just no-op and return
  // success. Staff who really want to restart the intake can use the dedicated
  // "Reset Intake" admin endpoint, which clears the session first.
  //
  // We DO allow overwriting if the existing session is still stuck at
  // "awaiting_template_reply" with 0 turns — that means the template was sent
  // but client never replied, and a re-send is a legitimate retry.
  //
  // Special unstuck case: if session is awaiting_template_reply BUT the 24h
  // window has since opened (client did reply, just hit auto-greeting first),
  // upgrade to ai_chat and send first batch directly. Unsticks Ramandeep-type
  // cases without staff needing to do anything else.
  try {
    const existing = await getSession(phone, companyId);
    if (existing && existing.phase !== "awaiting_template_reply") {
      console.log(`🔁 Skipping startIntakeSession for ${phone} — session already active (phase=${existing.phase} chatTurns=${existing.chatTurns}). Use admin reset endpoint to start over.`);
      return { success: true, skippedCount: 0, recoveredCount: 0, mode: "skip-already-active" };
    }
    if (existing && existing.phase === "awaiting_template_reply") {
      const windowOpen = await hasOpen24hWindow(phone);
      if (windowOpen) {
        // Client already replied (or sent some inbound), but session got stuck
        // at template-reply phase. Advance and send first batch now.
        console.log(`🔓 Unsticking ${phone} — session was at awaiting_template_reply but 24h window is open. Sending first batch.`);
        try {
          await sendFirstBatchAndAdvance(existing);
          return { success: true, skippedCount: 0, recoveredCount: 0, mode: "unstuck" };
        } catch (e) {
          console.error(`Unstick failed for ${phone}: ${(e as Error).message}`);
          // fall through to normal start (which itself will try direct-start)
        }
      }
      if ((existing.chatTurns || 0) > 0) {
        console.log(`🔁 Skipping startIntakeSession for ${phone} — already greeted (chatTurns=${existing.chatTurns}).`);
        return { success: true, skippedCount: 0, recoveredCount: 0, mode: "skip-already-greeted" };
      }
    }
  } catch (e) {
    // Non-fatal — if session lookup fails, fall through and start fresh.
    console.warn(`[startIntakeSession] existing session check failed for ${phone}: ${(e as Error).message.slice(0, 100)}`);
  }

  const questions = getQuestionPromptsForFormType(formType);
  const rawBatches = getQuestionBatchesForFormType(formType);
  const firstName = clientName.split(" ")[0];

  // Detect which questions are already answered by passport/case data
  const preAnswered = existingIntake ? getPreAnsweredQuestions(questions, existingIntake) : {};
  const skippedCount = Object.keys(preAnswered).length;

  // Pre-fill answers slot for skipped questions, so they're saved in `session.answers`
  // and the form mapper can read them later
  const seedAnswers: Record<string, string> = {};
  Object.entries(preAnswered).forEach(([idx, val]) => {
    const i = parseInt(idx, 10);
    seedAnswers[`q${i + 1}`] = val;
    seedAnswers[questions[i].slice(0, 50)] = val;
  });

  // ── Inbox recovery ──
  // Before starting a new session, check if the client has already sent a batched
  // numbered reply (e.g. "1. Yes\n2. Single\n3. NA...") to a previous intake template.
  // This is what happened with Vishal — answered to old flat template, his answers
  // were saved to inbox but never parsed. Pull them now.
  let recoveredCount = 0;
  try {
    const recovered = await scanInboxForBatchedAnswers(phone, questions.length);
    if (recovered && Object.keys(recovered).length > 0) {
      for (const [k, v] of Object.entries(recovered)) {
        // Don't overwrite passport-derived pre-answers
        const idx = parseInt(k.replace("q", ""), 10) - 1;
        if (preAnswered[idx] !== undefined) continue;
        if (!seedAnswers[k]) {
          seedAnswers[k] = v as string;
          if (questions[idx]) seedAnswers[questions[idx].slice(0, 50)] = v as string;
          recoveredCount++;
        }
      }
      if (recoveredCount > 0) {
        console.log(`✅ Recovered ${recoveredCount} answer(s) from inbox for ${phone}`);
      }
    }
  } catch (e) {
    console.warn(`[startIntakeSession] inbox recovery failed:`, (e as Error).message);
  }

  const session: IntakeSession = {
    caseId, companyId, phone, clientName, formType,
    questions,
    batches: rawBatches.map(b => b.questions),
    batchTitles: rawBatches.map(b => b.title),
    currentBatch: 0,
    currentIndex: 0,
    answers: seedAnswers,
    phase: "awaiting_template_reply",
    conversationHistory: [],
    collectedFields: {},
    chatTurns: 0,
    preAnswered,
  };

  await setSession(phone, session);

  if (skippedCount > 0) {
    console.log(`✅ Pre-answered ${skippedCount} question(s) from passport/case data for ${phone}`);
  }

  // ── Smart send: direct-start if 24h window is open, template otherwise ──
  //
  // WhatsApp Business policy: free-form messages can ONLY be sent within 24h
  // of the client's last inbound message. After that, only pre-approved
  // templates work.
  //
  // For most cases at Newton, clients have just messaged the marketing bot
  // before being converted to a case — the 24h window is open. In that case
  // we skip the template (which feels formal and adds a step) and send the
  // first batch of questions DIRECTLY. Client gets a faster experience and
  // staff doesn't have to wait for the template-tap step.
  //
  // For cold-contact cases (no recent inbound from this client), we MUST
  // still use the template — there's no other way to message them per Meta
  // policy.
  const hasOpenWindow = await hasOpen24hWindow(phone);
  if (hasOpenWindow) {
    console.log(`📩 24h window OPEN for ${phone} — direct-start mode (skipping template)`);
    try {
      await sendFirstBatchAndAdvance(session);
      return { success: true, skippedCount, mode: "direct" };
    } catch (e) {
      console.error(`Direct-start failed for ${phone}: ${(e as Error).message}. Falling back to template.`);
      // fall through to template send below
    }
  }

  // Send template greeting (cold contact OR direct-start failed)
  console.log(`📤 Sending newton_intake template to ${phone} (firstName=${firstName}, formType=${formType})`);
  const templateResult = await sendWhatsAppTemplate({
    to: phone,
    templateName: "newton_intake",
    languageCode: "en",
    components: [{
      type: "body",
      parameters: [
        { type: "text", text: firstName },
        { type: "text", text: formType }
      ]
    }]
  });

  if (templateResult.success) {
    console.log(`✅ Template sent to ${phone} — waiting for reply to start AI chat`);
    return { success: true, skippedCount, mode: "template" };
  }

  // Template send failed — log the actual reason instead of silently falling back
  console.error(`❌ Template send FAILED for ${phone}: ${templateResult.error || "unknown error"}. Falling back to direct AI chat.`);

  // Fallback — start AI chat immediately
  session.phase = "ai_chat";
  await setSession(phone, session);
  const firstMsg = await getAiNextMessage(session, null);
  const fallbackResult = await sendWhatsAppText(phone, firstMsg);
  if (fallbackResult && (fallbackResult as any).success === false) {
    console.error(`❌ Fallback direct text ALSO failed for ${phone}: ${(fallbackResult as any).error || "unknown"}. Client will receive nothing — staff must message manually.`);
    return { success: false, error: `Both template and direct send failed for ${phone}. Staff: send a manual greeting from the case.` };
  }
  console.log(`📨 Fallback direct text sent to ${phone} (template failed, used ai_chat fallback)`);
  return { success: true, skippedCount, mode: "fallback" };
}

// Get AI's next message based on conversation history
async function getAiNextMessage(session: IntakeSession, clientMessage: string | null): Promise<string> {
  const { formType, clientName, questions, collectedFields, conversationHistory, chatTurns } = session;
  const firstName = clientName.split(" ")[0];

  // Build what's been collected so far
  const collectedCount = Object.keys(collectedFields).length;
  const totalNeeded = Math.min(questions.length, 15);
  const remaining = questions.filter(q => {
    const key = q.slice(0, 30).toLowerCase();
    return !Object.keys(collectedFields).some(k => k.includes(key.slice(0, 15)));
  });

  // Check if we have enough info
  const isDone = collectedCount >= totalNeeded || chatTurns >= 20 || remaining.length === 0;

  if (isDone) {
    return `Thank you ${firstName}! 🙏 I have collected all the information needed for your ${formType} application.\n\nOur team will now review everything and prepare your application forms. We'll be in touch shortly!\n\n— Newton Immigration Team 🍁`;
  }

  // Build system prompt for Claude
  const systemPrompt = `You are a friendly immigration consultant at Newton Immigration helping ${firstName} with their ${formType} application.

Your job is to collect the following information through natural conversation:
${questions.map((q, i) => `${i+1}. ${q}`).join("\n")}

Already collected (${collectedCount}/${totalNeeded}):
${Object.entries(collectedFields).map(([k,v]) => `✓ ${k}: ${v}`).join("\n") || "Nothing yet"}

Rules:
- Be warm, friendly, and professional
- Ask ONE question at a time in plain conversational language
- After each client answer, acknowledge it briefly then ask the next question
- Don't number the questions - make it feel like natural conversation
- If answer is unclear, politely ask to clarify
- Keep messages SHORT (2-3 sentences max)
- Use simple English, avoid legal jargon
- Never ask for documents — only ask for information
- Focus on the next UNANSWERED question from the list above
${chatTurns === 0 ? "\n- This is the FIRST message — introduce yourself briefly and ask the first question" : ""}`;

  const messages: Array<{role: string; content: string}> = [
    ...conversationHistory,
    ...(clientMessage ? [{ role: "user" as const, content: clientMessage }] : [])
  ];

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: systemPrompt,
        messages: messages.length > 0 ? messages : [{ role: "user", content: "Please start the intake conversation." }]
      })
    });
    const data = await res.json() as any;
    return data.content?.[0]?.text || `Hi ${firstName}! To process your ${formType} application, I need to ask you a few questions. What is your current marital status?`;
  } catch (e) {
    console.error("AI message failed:", e);
    return `Hi ${firstName}! I'm here to help with your ${formType} application. Could you please tell me your full current mailing address including postal code?`;
  }
}

// Extract info from client's answer using AI
async function extractInfo(question: string, answer: string, formType: string): Promise<Record<string, string>> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: `Extract the key information from this immigration intake answer.

Question asked: "${question}"
Client answered: "${answer}"
Application type: ${formType}

Return ONLY a JSON object with key-value pairs of extracted info. Keys should be short snake_case field names. Example: {"marital_status": "Single", "address": "123 Main St, Surrey BC V3S 1A1"}

If the answer is unclear or evasive return: {"raw_answer": "${answer.slice(0,100)}"}`
        }]
      })
    });
    const data = await res.json() as any;
    const text = data.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { raw_answer: answer.slice(0, 200) };
  }
}

// Helper — send the next batch of questions starting from session.currentBatch.
//
// Used in two places:
//   1. After initial template-reply: when intake first starts and batch 0 was
//      handled, send batch 1, etc.
//   2. After per-batch answers received: if the client answered ALL questions
//      in the current batch (or skipped some via "no" / "n/a"), advance to
//      the next batch and send it as a section instead of dropping back to
//      one-by-one. This preserves the section-batched flow throughout intake.
//
// Returns:
//   true  — a new batch was sent; caller should NOT also send a single-question
//   false — there were no more batches to send (intake is done or stuck in
//           same-batch-leftover mode); caller falls back to single-question.
async function sendNextBatchIfReady(session: IntakeSession): Promise<boolean> {
  const batches = session.batches || [session.questions];
  const batchTitles = session.batchTitles || [];
  const totalBatches = batches.length;
  const allQuestions = session.questions;
  const preAnswered = session.preAnswered || {};
  const answers = session.answers || {};

  // ── Decide which batch to send next ──
  // We want to advance past any batch where every question is already
  // covered (either pre-answered from passport data, or already answered by
  // the client in a previous reply).
  const isQuestionAnswered = (qIdx: number): boolean => {
    if (preAnswered[qIdx] !== undefined) return true;
    // session.answers stores answers under keys like `q${idx+1}` — check both forms
    if (answers[`q${qIdx + 1}`] !== undefined && String(answers[`q${qIdx + 1}`]).trim() !== "") return true;
    const q = allQuestions[qIdx];
    if (q && answers[q.slice(0, 50)] !== undefined && String(answers[q.slice(0, 50)]).trim() !== "") return true;
    return false;
  };

  let batchIdx = session.currentBatch || 0;
  // Advance batchIdx if current batch is fully answered
  while (batchIdx < totalBatches) {
    const batchPrompts = batches[batchIdx];
    const batchIndices = batchPrompts
      .map(prompt => allQuestions.findIndex(q => q === prompt))
      .filter(i => i >= 0);
    const unanswered = batchIndices.filter(i => !isQuestionAnswered(i));

    if (unanswered.length === 0) {
      // Whole batch covered — advance to next
      batchIdx++;
      continue;
    }

    // ── Found a batch with unanswered questions → send it as a section ──
    const askPrompts = unanswered.map(i => allQuestions[i]);
    const sectionTitle = batchTitles[batchIdx] || `Part ${batchIdx + 1}`;
    const questionsText = askPrompts.map((q, i) => `*${i + 1}.* ${q}`).join("\n\n");
    const msg = [
      `${sectionTitle} *(Section ${batchIdx + 1} of ${totalBatches})*`,
      `━━━━━━━━━━━━━━━`,
      questionsText,
      `━━━━━━━━━━━━━━━`,
      ``,
      `Please reply with all answers numbered 🙏`,
    ].join("\n");

    session.chatTurns = unanswered[0];
    session.currentBatch = batchIdx;
    await setSession(session.phone, session);
    await sendAndSave(session.phone, msg, session.caseId, session.clientName);
    return true;
  }

  return false;  // no more batches — caller decides what to do (intake complete)
}

// Backwards-compat alias (older callers used the old name).
async function sendNextBatchAfterPreAnswers(session: IntakeSession): Promise<void> {
  const sent = await sendNextBatchIfReady(session);
  if (!sent) {
    // All batches pre-answered — mark session complete (preserve old behavior)
    session.phase = "complete";
    await setSession(session.phone, session);
    const firstName = session.clientName.split(" ")[0];
    const doneMsg = [
      `✅ *Thank you ${firstName}!*`,
      ``,
      `Based on your passport and case details, we already have everything we need.`,
      ``,
      `Our team will prepare your forms and be in touch shortly! 🙏`,
      ``,
      `— Newton Immigration Team 🍁`,
    ].join("\n");
    await sendAndSave(session.phone, doneMsg, session.caseId, session.clientName);
  }
}

// Handle incoming reply from client
export async function handleIncomingReply(params: {
  phone: string;
  message: string;
  companyId: string;
}): Promise<void> {
  const { phone, message, companyId } = params;
  const session = await getSession(phone, companyId);
  if (!session) return;

  const text = message.trim();

  // Phase: waiting for template reply → send first batch via shared helper
  if (session.phase === "awaiting_template_reply") {
    await sendFirstBatchAndAdvance(session);
    return;
  }

  // Phase: AI chat — ask questions one by one based on chatTurns index
  if (session.phase === "ai_chat") {
    const qIndex = session.chatTurns;
    const currentQuestion = session.questions[qIndex];
    const firstName = session.clientName.split(" ")[0];

    // ── Delay-phrase short-circuit ──
    //
    // Real bug from RUBEN (Citizenship): client replied "Working on it, will
    // text you in a bit" and the bot treated that as the answer to Q1 then
    // re-asked the rest of the batch. Felt robotic and lost his actual answer.
    //
    // If the client is just saying "I'll get back to you soon", we
    // acknowledge politely and DO NOT advance the session state. They'll
    // reply with the real answer later, and the bot picks up where it was.
    //
    // We throttle the ack to once per 30 minutes per session so a client
    // saying "still working on it" three times doesn't get the same canned
    // reply three times.
    if (isDelayPhrase(text)) {
      const lastAck = session.ackedDelayAt ? new Date(session.ackedDelayAt).getTime() : 0;
      const minutesSince = (Date.now() - lastAck) / 60000;
      if (minutesSince > 30) {
        session.ackedDelayAt = new Date().toISOString();
        await setSession(phone, session);
        const reply = [
          `Take your time ${firstName}! 🙏`,
          ``,
          `Whenever you're ready, just reply with the numbered answers and I'll continue.`,
        ].join("\n");
        await sendAndSave(phone, reply, session.caseId, session.clientName);
      } else {
        // Already acked recently — just stay quiet so we don't pester them
        console.log(`[delay-phrase] Skipping repeat ack for ${phone} (last ack ${minutesSince.toFixed(1)} min ago)`);
      }
      return;
    }

    // ── Smart intent detection — handle non-answer replies gracefully ──
    //
    // Real bug from RUBEN's intake: he said "Working on it, will text you in
    // a bit" and the bot stored that as his Q1 answer (Address history) and
    // pestered him for Q2. Same problem for questions like "what do you mean?"
    // or "can I get back to you tomorrow?" — none of those are answers.
    //
    // Detect three categories of non-answer replies:
    //   1. DELAY  — "I'll send later", "working on it", "give me a min"
    //   2. ASK    — "what do you mean?", "can you explain?"
    //   3. EMOJI/STICKER-only — "👍", "ok ok"
    //
    // For all three: don't consume the question, send a friendly response,
    // wait for an actual answer.
    if (text && text.length < 200) {
      const lower = text.toLowerCase().trim();

      // Single-emoji or super-short ack replies — friendly nudge, don't consume Q
      const emojiOnly = /^[\p{Emoji}\s]+$/u.test(text) && text.replace(/[\p{Emoji}\s]/gu, "").length === 0;
      const isShortAck = /^(ok|okay|k|kk|sure|alright|yes|yeah|👍|👌|🙏)\s*[!.]*$/i.test(lower);

      // Delay/postpone phrases
      const delayPatterns = [
        /\b(working on it|i.{0,3}ll (text|send|reply|get back|do it)|give me (a )?(min|minute|sec|moment|hour|day))\b/i,
        /\b(later|tomorrow|tonight|in a bit|in a (min|minute|sec|moment|while)|after work|bit busy)\b/i,
        /\b(can.{0,3}t now|busy|not now|hold on|one (sec|moment|minute))\b/i,
        /\b(will (do|send|reply|get back to you))\b/i,
        /\b(getting (it|them|these)|gathering|collecting|finding)\b/i,
        // Punjabi/Hindi delay phrases (romanized)
        /\b(thoda time|thoda samay|baad mein|kal|abhi nahi)\b/i,
      ];
      const isDelay = delayPatterns.some(re => re.test(lower)) && !/[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(text);

      // Question/clarification asking (ends with ?, or starts with "what/why/how/when/where/can you/could you")
      const isQuestion = /\?\s*$/.test(text.trim()) ||
        /^(what|why|how|when|where|can you|could you|do you|does this|is this|i don.{0,3}t (understand|get))/i.test(lower);

      if (emojiOnly || isShortAck || isDelay) {
        // Don't consume a question — acknowledge and wait.
        const reply = isDelay
          ? `No problem ${firstName}! 🙏 Take your time. Whenever you're ready, just send your answers numbered (1. answer, 2. answer...). I'll be here.`
          : `👍 Whenever you're ready, please send your answers numbered (1. answer, 2. answer...) 🙏`;
        await sendAndSave(phone, reply, session.caseId, session.clientName);
        return;
      }

      if (isQuestion && !/[0-9]\s*[.)]/.test(text)) {
        // Client is asking US something instead of answering — let Claude write
        // a brief helpful reply, but don't store anything as their Q answer.
        try {
          const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
          if (apiKey) {
            const sys = [
              `You are a friendly immigration intake assistant at Newton Immigration helping ${firstName} with their ${session.formType} application.`,
              `The client just asked you a question instead of answering the questions you sent them.`,
              `Currently they need to answer this question: "${currentQuestion}"`,
              ``,
              `Rules for your reply:`,
              `1. Briefly answer their question if you can (1-2 short sentences).`,
              `2. NEVER quote fees, dates, or processing times.`,
              `3. NEVER promise outcomes.`,
              `4. After your brief answer, gently re-share what you need from them.`,
              `5. Keep total reply under 60 words.`,
              `6. Match their language (English / Hindi / Punjabi).`,
              `7. Return ONLY the reply text — no labels.`,
            ].join("\n");
            const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
                max_tokens: 150,
                system: sys,
                messages: [{ role: "user", content: text }],
              }),
            });
            if (aiRes.ok) {
              const data: any = await aiRes.json();
              const out = String(data?.content?.[0]?.text || "").trim();
              if (out && out.length < 600) {
                // Filter for forbidden content (fees, timing promises)
                const banned = [/\$\s*\d/, /\bcad\b\s*\d/i, /\b\d{1,3}\s*(days?|weeks?|months?)\b/i, /\b(approved|guaranteed|will be)\b/i];
                if (!banned.some(re => re.test(out))) {
                  await sendAndSave(phone, out, session.caseId, session.clientName);
                  return;
                }
              }
            }
          }
        } catch (e) {
          // Fall through to default response
        }
        // Fallback if AI failed
        await sendAndSave(
          phone,
          `Good question ${firstName}! For your *${session.formType}* application, I just need: ${currentQuestion}\n\nIf you're unsure how to answer, give your best understanding or reply "skip" to come back to it later.`,
          session.caseId,
          session.clientName
        );
        return;
      }
    }

    // ── Smart batch detection ──
    // The question prompt explicitly asks the client to "reply with all answers numbered (1. answer, 2. answer...)"
    // so we must honor that format. Detect numbered answers in the reply and assign each to the
    // corresponding question.
    //
    // Two marker shapes accepted:
    //   (A) Punctuated:    "1." / "1)" / "1.)" / "1:"  with or without trailing space
    //   (B) Space-only:    "1 yes 2 no 3 NA"           (no punctuation, just digit + space)
    //
    // Real bug from Harwinder (CASE-1394): she replied
    //     "1 no 2 Separated buy not officially we have filed our taxes Separated for 2025 4 no"
    // The OLD regex (\d{1,2})[.)\:]+ required at least one of . ) : after the digit, so it
    // matched ZERO markers and dumped her entire reply as a single answer to Q1, then re-asked
    // the whole batch. With permissive markers we now correctly extract Q1=no, Q2="Separated...",
    // (Q3 missing → handled separately), Q4=no.
    //
    // Year-filter: a digit like "2025" inside answer text must NOT be treated as marker 2.
    // We protect against this by:
    //   (i)  Numbers ≤ 20 only (we never ask >20 Qs in a single batch)
    //   (ii) Digit must NOT be preceded OR followed by another digit (so "2025" is one chunk
    //        that the regex skips)
    //   (iii) Marker followed by a SPACE must lead with a non-digit answer character.
    let answersCaptured = 0;
    if (text) {
      const positions: Array<{ num: number; start: number; end: number }> = [];

      // Pattern A — punctuated: keep the original behavior, this is unambiguous.
      //
      // BUG FIX (sukhmandeep CASE-1415): the original regex only matched
      // `1.` `1)` `1:` but NOT `1-` — which is the second-most common format
      // clients use ("1- No, 2- Single, 3- NA"). Without the dash matching,
      // the parser fell through to single-answer mode and saved only ONE
      // answer per reply, causing infinite "I still need answers" loops.
      // Added: `-` (regular dash), `–` (en-dash, sometimes auto-corrected
      // by mobile keyboards), `—` (em-dash, less common but seen).
      // Also allow optional whitespace BETWEEN digit and punct so "1 - No"
      // (space-dash) works too.
      const punctuatedRegex = /(?:^|\s)(\d{1,2})\s*[.)\:\-–—]+\s*/g;
      let m: RegExpExecArray | null;
      while ((m = punctuatedRegex.exec(text)) !== null) {
        const num = parseInt(m[1], 10);
        if (num >= 1 && num <= 20) {
          positions.push({
            num,
            start: m.index + (m[0].length - m[0].trimStart().length),
            end: punctuatedRegex.lastIndex,
          });
        }
      }

      // Pattern B — space-only: "1 no 2 yes 3 NA". Only fire if Pattern A found
      // fewer than 2 markers (i.e. client likely didn't use punctuation at all).
      // This avoids double-matching when the client did use "1." style.
      if (positions.length < 2) {
        // Match: (start of text OR whitespace) + 1-2 digit number + whitespace + non-digit char
        // The lookahead `(?=\s+[^\d\s])` ensures the next thing after the digit is whitespace
        // followed by an actual answer character (not another digit, not just more whitespace).
        // The lookbehind `(?<![\d.])` ensures we're not in the middle of a longer number like
        // "2025" or "1.5" — important to avoid false matches inside answer text.
        const spaceOnlyRegex = /(?:^|\s)(?<![\d.])(\d{1,2})(?=\s+[^\d\s])/g;
        positions.length = 0; // reset — use space-only path exclusively
        while ((m = spaceOnlyRegex.exec(text)) !== null) {
          const num = parseInt(m[1], 10);
          if (num < 1 || num > 20) continue;
          // The marker END is right after the digit; whitespace+answer follows
          const matchEnd = m.index + m[0].length;
          // Skip past the whitespace to where the answer text actually begins
          let answerStart = matchEnd;
          while (answerStart < text.length && /\s/.test(text[answerStart])) answerStart++;
          positions.push({
            num,
            start: m.index + (m[0].length - m[0].trimStart().length),
            end: answerStart,
          });
        }

        // Sanity check on space-only matches: the captured numbers should be roughly
        // sequential (1, 2, 3, 4 — possibly skipping). If we got [1, 4, 7, 19] that's
        // probably noise; if we got [1, 2, 4] that's legitimate (client skipped Q3).
        // Keep only if first marker is small (≤3) and numbers are mostly increasing.
        if (positions.length >= 2) {
          const sortedAsc = positions.slice().sort((a, b) => a.start - b.start);
          const numsInOrder = sortedAsc.map(p => p.num);
          const looksOrdered = numsInOrder.every((n, i) => i === 0 || n > numsInOrder[i - 1]);
          if (!looksOrdered || numsInOrder[0] > 3) {
            // Doesn't look like clean numbered answers — probably noise. Drop them.
            positions.length = 0;
          }
        }
      }

      // Need at least 2 markers to qualify as a multi-answer reply
      if (positions.length >= 2) {
        // ── Map client's marker numbers to ACTUAL question indices ──
        //
        // CRITICAL: Don't assume questions in a batch are contiguous in
        // session.questions. PGWP Section 5's batch is [Q11, Q12, Q13, Q16,
        // Q17, Q18] — Q14 and Q15 belong to Section 4. The bot prompts
        // these renumbered "1." through "6.", and the client replies with
        // matching numbers. The OLD code used `qIndex + (pos.num - 1)`,
        // which silently mismapped "4. Punjabi" to Q14 (employment) instead
        // of Q16 (native language) — wrecking q14/q15 storage for every
        // PGWP intake.
        //
        // Correct behavior: build the same prompted-order list the bot used
        // (= batch's questions filtered to the still-missing ones) and use
        // `promptedIndices[pos.num - 1]` as the target index.
        const batches = session.batches || [session.questions];
        const batchIdx = session.currentBatch ?? 0;
        const batchPrompts = batches[batchIdx] || [];
        const batchIndices = batchPrompts
          .map(p => session.questions.indexOf(p))
          .filter(i => i >= 0);
        const isAlreadyAnswered = (i: number): boolean => {
          if (session.preAnswered && session.preAnswered[i] !== undefined) return true;
          const v = session.answers[`q${i + 1}`];
          if (v !== undefined && String(v).trim() !== "") return true;
          const q = session.questions[i];
          if (q && session.answers[q.slice(0, 50)] !== undefined &&
              String(session.answers[q.slice(0, 50)]).trim() !== "") return true;
          return false;
        };
        // The bot's most recent prompt only included questions that were
        // still missing (see sendNextBatchIfReady line ~526 and the re-ask
        // flow line ~889). Match that filter so client's "1." maps to the
        // FIRST question the bot just asked, regardless of where it sits
        // in the master question list.
        const promptedIndices = batchIndices.filter(i => !isAlreadyAnswered(i));

        // ── Detect global numbering (Bug #5 fix) ──
        //
        // Real bug from CASE-1415: client looked at the original full intake
        // template (which numbered 1-19 across all sections) and replied with
        // ALL 16 answers in one message using global numbers. The bot was at
        // Section 5 with only 5 questions in the current batch, so markers
        // 6-16 got dropped via "out of range" branch below — leaving the
        // bot still asking for Q12/Q13/Q17/Q18/Q19.
        //
        // Heuristic: if at least 3 markers exceed the current batch size AND
        // they fit within the total question count, treat the WHOLE reply as
        // global-numbered and map by global question index. This matches what
        // the client actually meant.
        const totalQuestions = session.questions.length;
        const markersExceedingBatch = positions.filter(
          p => p.num > promptedIndices.length && p.num >= 1 && p.num <= totalQuestions
        ).length;
        const useGlobalNumbering = markersExceedingBatch >= 3 && totalQuestions > 0;

        for (let i = 0; i < positions.length; i++) {
          const pos = positions[i];
          const nextStart = i + 1 < positions.length ? positions[i + 1].start : text.length;
          const answerText = text.substring(pos.end, nextStart).trim();
          if (!answerText) continue;

          let targetIdx: number;
          if (useGlobalNumbering && pos.num >= 1 && pos.num <= totalQuestions) {
            // Global numbering — client is answering the original 1-N intake
            // template numbers. Map directly to question index N-1.
            targetIdx = pos.num - 1;
          } else if (pos.num >= 1 && pos.num <= promptedIndices.length) {
            targetIdx = promptedIndices[pos.num - 1];
          } else if (promptedIndices.length === 0 && batchIndices.length > 0 &&
                     pos.num >= 1 && pos.num <= batchIndices.length) {
            // Defensive: if every batch question is somehow already marked
            // answered (shouldn't normally happen on an active reply), fall
            // back to the full batch order so we don't drop the answer.
            targetIdx = batchIndices[pos.num - 1];
          } else if (pos.num >= 1 && pos.num <= totalQuestions) {
            // Last-resort fallback: marker number is out of current-batch
            // range BUT it's still a valid global question index. Save it
            // there rather than dropping the client's answer entirely. This
            // covers single stray over-numbered markers in mostly-batch
            // replies (e.g., 1-5 in batch + one stray "8-").
            targetIdx = pos.num - 1;
          } else {
            // Client's marker number is out of range entirely.
            // Skip rather than misalign — better to drop one stray answer
            // than to land it on the wrong question.
            continue;
          }

          if (targetIdx >= 0 && targetIdx < session.questions.length) {
            const q = session.questions[targetIdx];
            session.answers[`q${targetIdx + 1}`] = answerText;
            session.answers[q.slice(0, 50)] = answerText;
            answersCaptured++;
          }
        }
      }
    }

    // Fall back to single-answer save if batch detection didn't fire
    if (answersCaptured === 0 && currentQuestion && text) {
      // Strip a leading "N." / "N)" / "N:" / "N-" / "N–" / "N—" prefix if
      // present (e.g. "4) No" → "No", "1- No" → "No"). Includes dash variants
      // — without these, "1- No" was being saved verbatim and failing
      // downstream validators that parsed for Yes/No or a date.
      const cleaned = text.replace(/^\s*\d{1,2}\s*[.)\:\-–—]+\s*/, "").trim() || text.trim();
      session.answers[`q${qIndex + 1}`] = cleaned;
      session.answers[currentQuestion.slice(0, 50)] = cleaned;
      answersCaptured = 1;
    }

    // ─── Validation ────────────────────────────────────────────────
    //
    // After capturing answers, check the CURRENT-question answer (the one
    // we're about to "leave"). If it's clearly wrong (e.g., "punjabi" for
    // employment), re-ask the client. After 1 retry, accept + flag.
    //
    // We deliberately validate ONLY the current question, not earlier ones
    // in a batch — once the client moves past a question, we trust them.
    // Going back to re-ask question 1 when they've already answered 5 is
    // confusing. Better to flag earlier ones for staff review at form-gen.
    if (answersCaptured > 0 && currentQuestion) {
      try {
        const { validateAnswer } = await import("@/lib/intake-validators");
        const currentAnswer = session.answers[`q${qIndex + 1}`] || "";
        const retries = session.validationRetries || {};
        const retryCount = retries[String(qIndex)] || 0;
        const result = validateAnswer(currentQuestion, currentAnswer, retryCount);

        if (result.ok === false) {
          // Re-ask. Don't advance chatTurns. Bump retry counter.
          retries[String(qIndex)] = retryCount + 1;
          session.validationRetries = retries;
          // Roll back the captured answer so the bot doesn't keep the bad one
          delete session.answers[`q${qIndex + 1}`];
          delete session.answers[currentQuestion.slice(0, 50)];
          await setSession(phone, session);
          await sendAndSave(phone, result.hint, session.caseId, session.clientName);
          return;
        }

        if (result.ok === "flag") {
          // Accept the answer but record the concern for staff
          const flags = session.validationFlags || [];
          flags.push({ qIndex, reason: result.reason });
          session.validationFlags = flags;
          console.log(`⚠️  Intake validation flag for ${phone} q${qIndex + 1}: ${result.reason}`);
        }
        // result.ok === true → just continue normally
      } catch (e) {
        // Validator threw — never block intake. Log and continue.
        console.error(`Intake validator error (non-fatal):`, (e as Error).message);
      }
    }

    // Advance the question pointer by however many answers we just captured
    session.chatTurns += answersCaptured;

    // Skip past any pre-answered questions (passport-derivable ones we already know)
    while (session.preAnswered && session.preAnswered[session.chatTurns] !== undefined) {
      session.chatTurns++;
    }

    const nextIndex = session.chatTurns;
    const isDone = nextIndex >= session.questions.length;

    if (isDone) {
      session.phase = "complete";
      await setSession(phone, session);

      const doneMsg = [
        `✅ *Thank you ${firstName}!*`,
        ``,
        `I have all the information needed for your *${session.formType}* application.`,
        ``,
        `If you need to correct any answer, simply reply with the question number and your new answer (e.g. "Q3: Updated answer").`,
        ``,
        `Our team will prepare your forms and be in touch shortly! 🙏`,
        ``,
        `— Newton Immigration Team 🍁`,
      ].join("\n");
      await sendAndSave(phone, doneMsg, session.caseId, session.clientName);

      // Save all answers to case
      const { updateCasePgwpIntake: savePgwp } = await import("@/lib/store");
      await savePgwp(session.companyId, session.caseId, {
        ...session.answers as any,
        whatsappIntakePhase: "complete",
        whatsappIntakeCompletedAt: new Date().toISOString(),
        // Surface validation flags to staff via the case data. Form mapper
        // can read these and merge into _review_flags on the form output.
        ...(session.validationFlags && session.validationFlags.length > 0
          ? { _intakeValidationFlags: session.validationFlags }
          : {}),
      });
      await completeIntake(session);
    } else {
      // ── Section-batched flow ──
      //
      // After capturing the client's answers, try to send the NEXT BATCH as a
      // section (5-6 questions at once with a section title), instead of
      // dropping back to one-question-at-a-time.
      //
      // Three cases:
      //   1. All questions in the current batch are now answered → send next batch
      //   2. Current batch still has unanswered questions → send a short
      //      "I still need answer to Q4 + Q5" prompt for the missing ones
      //   3. No more batches → intake is done (handled by isDone above)
      //
      // The `sendNextBatchIfReady` helper handles the bookkeeping of figuring
      // out which batch we're in and which questions are still unanswered.
      const ackPhrases = ["Got it! ✓", "Perfect! ✓", "Thank you! ✓", "Noted! ✓", "Great! ✓"];
      let ackPrefix: string;
      if (answersCaptured >= 3) {
        ackPrefix = `🎉 Got all ${answersCaptured} answers! ✓\n\n`;
      } else if (answersCaptured === 2) {
        ackPrefix = "Got both answers! ✓\n\n";
      } else {
        ackPrefix = `${ackPhrases[qIndex % ackPhrases.length]}\n\n`;
      }

      // Determine if all questions in the current batch are now answered.
      const batches = session.batches || [session.questions];
      const batchIdx = session.currentBatch || 0;
      const currentBatchPrompts = batches[batchIdx] || [];
      const currentBatchIndices = currentBatchPrompts
        .map(prompt => session.questions.findIndex(q => q === prompt))
        .filter(i => i >= 0);
      const stillMissingInBatch = currentBatchIndices.filter(i => {
        if (session.preAnswered && session.preAnswered[i] !== undefined) return false;
        if (session.answers[`q${i + 1}`] !== undefined && String(session.answers[`q${i + 1}`]).trim() !== "") return false;
        const q = session.questions[i];
        if (q && session.answers[q.slice(0, 50)] !== undefined && String(session.answers[q.slice(0, 50)]).trim() !== "") return false;
        return true;
      });

      if (stillMissingInBatch.length === 0) {
        // ── Case 1: current batch fully answered → advance to next batch ──
        session.currentBatch = batchIdx + 1;
        await setSession(phone, session);

        // Send the ack as a separate message so the next-batch message stays
        // clean (the next batch already has its own section title + framing).
        await sendAndSave(phone, ackPrefix.trim(), session.caseId, session.clientName);

        const sent = await sendNextBatchIfReady(session);
        if (!sent) {
          // No more batches with unanswered Qs — intake is effectively complete.
          // Mark complete + save.
          session.phase = "complete";
          await setSession(phone, session);
          const doneMsg = [
            `✅ *Thank you ${firstName}!*`,
            ``,
            `I have all the information needed for your *${session.formType}* application.`,
            ``,
            `If you need to correct any answer, simply reply with the question number and your new answer (e.g. "Q3: Updated answer").`,
            ``,
            `Our team will prepare your forms and be in touch shortly! 🙏`,
            ``,
            `— Newton Immigration Team 🍁`,
          ].join("\n");
          await sendAndSave(phone, doneMsg, session.caseId, session.clientName);
          const { updateCasePgwpIntake: savePgwp } = await import("@/lib/store");
          await savePgwp(session.companyId, session.caseId, {
            ...session.answers as any,
            whatsappIntakePhase: "complete",
            whatsappIntakeCompletedAt: new Date().toISOString(),
          });
          await completeIntake(session);
        }
      } else {
        // ── Case 2: current batch still has unanswered → re-prompt for those ──
        // Renumber starting from 1 so the client's reply maps cleanly.
        // (We point session.chatTurns at the first missing question so the
        // batch-reply parser at the top of this function picks the right
        // mapping for client's "1. xxx 2. yyy" replies.)
        session.chatTurns = stillMissingInBatch[0];
        await setSession(phone, session);
        const missingPrompts = stillMissingInBatch.map(i => session.questions[i]);
        const questionsText = missingPrompts.map((q, i) => `*${i + 1}.* ${q}`).join("\n\n");
        const msg = [
          `${ackPrefix}I still need answers for these:`,
          `━━━━━━━━━━━━━━━`,
          questionsText,
          `━━━━━━━━━━━━━━━`,
          ``,
          `Please reply with all answers numbered 🙏`,
        ].join("\n");
        await sendAndSave(phone, msg, session.caseId, session.clientName);
      }
    }

    return;
  }

  // Fallback for old bulk phase
  if (session.phase === "awaiting_bulk") {
    // Parse numbered answers
    const lines = text.split(/\n+/);
    const answers: Record<string, string> = {};
    for (const line of lines) {
      const m = line.match(/^(\d+)[.):\s]+(.+)/);
      if (m) {
        const idx = parseInt(m[1]) - 1;
        if (idx >= 0 && idx < session.questions.length) {
          answers[session.questions[idx]] = m[2].trim();
          answers[`q${idx + 1}`] = m[2].trim();
        }
      }
    }
    session.answers = { ...session.answers, ...answers };
    session.collectedFields = { ...session.collectedFields, ...answers };

    const answered = Object.keys(answers).filter(k => !k.startsWith("q")).length;
    if (answered >= 5 || Object.keys(session.answers).length >= 10) {
      session.phase = "complete";
      await setSession(phone, session);
      await sendWhatsAppText(phone, `Thank you ${session.clientName.split(" ")[0]}! 🙏 Your answers have been saved.\n\nPlease send photos of:\n📄 *Your current permit* (Study/Work Permit)\n🛂 *Your passport bio page*\n\nThis helps us auto-fill your forms accurately.\n\n— Newton Immigration Team 🍁`);
      // updateCaseProcessing handles workflow-status (aiStatus) only.
      // pgwpIntake mutations must go through updateCasePgwpIntake.
      const { updateCasePgwpIntake } = await import("@/lib/store");
      await updateCasePgwpIntake(session.companyId, session.caseId, {
        ...session.answers,
        whatsappIntakePhase: "complete",
        whatsappIntakeCompletedAt: new Date().toISOString(),
        ...(session.validationFlags && session.validationFlags.length > 0
          ? { _intakeValidationFlags: session.validationFlags }
          : {}),
      });
      await updateCaseProcessing(session.companyId, session.caseId, {
        aiStatus: "intake_complete"
      });
      await completeIntake(session);
    } else {
      await sendWhatsAppText(phone, `Thank you for your answers! Please also provide answers for the remaining questions if you haven't already. 🙏`);
    }
    return;
  }
}

async function completeIntake(session: IntakeSession): Promise<void> {
  try {
    const caseItem = await getCase(session.companyId, session.caseId);

    // Get document checklist
    const checklistKey = resolveApplicationChecklistKey(session.formType);
    const { getChecklistForFormType } = await import("@/lib/application-checklists");
    const checklist = getChecklistForFormType(session.formType);
    const requiredDocs = checklist.filter(i => i.required).map(i => i.label);

    // Send document checklist after intake complete
    const { getChecklistForFormType: getChecklist } = await import("@/lib/application-checklists");
    const docChecklist = getChecklist(session.formType);
    const required = docChecklist.filter(i => i.required);
    const optional = docChecklist.filter(i => !i.required);
    
    const checklistMsg = [
      `📋 *Documents needed for your ${session.formType} application:*`,
      ``,
      `*Required:*`,
      ...required.map((item, i) => `${i+1}. ${item.label}`),
      ...(optional.length ? [
        ``,
        `*Additional (if applicable):*`,
        ...optional.map(item => `• ${item.label}`)
      ] : []),
      ``,
      `Please send clear photos or scans directly here on WhatsApp. 📸`,
      ``,
      `— Newton Immigration Team 🍁`,
    ].join("\n");

    await sendAndSave(session.phone, checklistMsg, session.caseId, session.clientName);
    await clearSession(session.phone);
    console.log(`✅ WhatsApp intake complete for case ${session.caseId}`);

    // Save intake answers as PDF in Drive
    try {
      const appUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "https://junglecrm-builder-web-production-d358.up.railway.app";
      
      // Generate forms PDF
      fetch(`${appUrl}/api/cases/${session.caseId}/generate-forms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemToken: process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024" })
      }).catch(e => console.error("Auto PDF failed:", e));

      // Save intake answers as a text PDF in Drive
      const answersText = Object.entries(session.answers)
        .filter(([k]) => k.startsWith("q") && !isNaN(Number(k.slice(1))))
        .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))
        .map(([k, v], i) => `Q${i+1}: ${session.questions[i] || k}\nA: ${v}`)
        .join("\n\n");

      // Upload answers to Drive as text file
      const { uploadFileToDriveFolder, extractDriveFolderId } = await import("@/lib/google-drive");
      const { getCase } = await import("@/lib/store");
      const caseItem2 = await getCase(session.companyId, session.caseId);
      const folderId = extractDriveFolderId(caseItem2?.docsUploadLink || "");
      if (folderId && answersText) {
        const answersBuffer = Buffer.from(`WHATSAPP INTAKE ANSWERS
Case: ${session.caseId}
Client: ${session.clientName}
Form: ${session.formType}
Date: ${new Date().toLocaleDateString("en-CA", {timeZone: "America/Vancouver"})}

${answersText}`, "utf-8");
        await uploadFileToDriveFolder({
          folderId,
          fileName: `${session.clientName} - Intake Answers.txt`,
          fileBuffer: answersBuffer,
          mimeType: "text/plain"
        });
        console.log(`📄 Intake answers saved to Drive for ${session.clientName}`);
      }
    } catch(e) { console.error("Intake PDF save failed:", e); }

    // Auto-generate AI notes
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://junglecrm-builder-web-production-d358.up.railway.app";
      const aiRes = await fetch(`${appUrl}/api/cases/${session.caseId}/ai-smart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_notes", systemToken: process.env.AUTH_RECOVERY_TOKEN })
      });
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        if (aiData.text) {
          await fetch(`${appUrl}/api/cases/${session.caseId}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `🤖 AI Draft Notes (from WhatsApp conversation):\n${aiData.text}`,
              addedBy: "AI"
            })
          });
        }
      }
    } catch { /* non-fatal */ }

    // Auto-generate IRCC forms
    try {
      const imm5710Types = ["pgwp", "owp", "sowp", "bowp", "vowp", "open work permit", "work permit", "restoration"];
      const ft = session.formType.toLowerCase();
      const needsForm = imm5710Types.some(t => ft.includes(t));
      if (needsForm) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://junglecrm-builder-web-production-d358.up.railway.app";
        const res = await fetch(`${appUrl}/api/cases/${session.caseId}/generate-forms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ systemToken: process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024" })
        });
        if (res.ok) {
          const d = await res.json();
          console.log(`📄 Auto-generated forms for ${session.caseId}:`, d.generated);
        }
      }
    } catch (e) {
      console.error("Auto-generate form error:", (e as Error).message);
    }
  } catch (err) {
    console.error("Error completing intake:", err);
  }
}
