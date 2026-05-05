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
};

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
    const { listCases, getCase, updateCaseProcessing } = await import("@/lib/store");
    const cId = process.env.DEFAULT_COMPANY_ID || "newton";
    const cases = await listCases(cId);
    const n = phone.replace(/\D/g, "");
    const matched = cases.find((c) => {
      const cp = (c.leadPhone || "").replace(/\D/g, "");
      return cp && (n.endsWith(cp) || cp.endsWith(n));
    });
    if (!matched) return;
    const intake = (matched.pgwpIntake as Record<string, string>) || {};
    delete intake.whatsappSession;
    await updateCaseProcessing(cId, matched.id, { pgwpIntake: intake });
  } catch { /* non-fatal */ }
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
}): Promise<{ success: boolean; error?: string; skippedCount?: number; recoveredCount?: number }> {
  const { caseId, companyId, phone, clientName, formType, existingIntake } = params;
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

  // Send template greeting first
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
    return { success: true, skippedCount };
  }

  // Fallback — start AI chat immediately
  session.phase = "ai_chat";
  await setSession(phone, session);
  const firstMsg = await getAiNextMessage(session, null);
  await sendWhatsAppText(phone, firstMsg);
  return { success: true, skippedCount };
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

  // Phase: waiting for template reply → send first batch
  if (session.phase === "awaiting_template_reply") {
    session.phase = "ai_chat";
    session.chatTurns = 0;
    session.currentBatch = 0;
    await setSession(phone, session);

    const firstName = session.clientName.split(" ")[0];
    const batches = session.batches || [session.questions];
    const batchTitles = session.batchTitles || [];
    const totalBatches = batches.length;
    const firstTitle = batchTitles[0] || "Part 1";
    const preAnswered = session.preAnswered || {};

    // Find which absolute question indices belong to the first batch.
    // We figure this out by matching prompt text since `batches` stores strings,
    // not original indices.
    const allQuestions = session.questions;
    const firstBatchPrompts = batches[0];
    const firstBatchIndices: number[] = firstBatchPrompts
      .map(prompt => allQuestions.findIndex(q => q === prompt))
      .filter(i => i >= 0);

    // Filter out pre-answered ones
    const askIndices = firstBatchIndices.filter(i => preAnswered[i] === undefined);
    const askPrompts = askIndices.map(i => allQuestions[i]);
    const skippedCount = firstBatchIndices.length - askPrompts.length;

    // If ALL questions in this batch are pre-answered, skip to next batch
    if (askPrompts.length === 0 && totalBatches > 1) {
      session.chatTurns = firstBatchIndices[firstBatchIndices.length - 1] + 1;
      session.currentBatch = 1;
      await setSession(phone, session);
      // Recursively trigger next batch handling — easiest: send the next batch directly
      const intro = [
        `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${firstName} ਜੀ! 🙏 Hi *${firstName}*!`,
        ``,
        `Great news — we already have all your passport details on file ✓`,
        ``,
        `Just a few quick questions to complete your *${session.formType}* application 🙏`,
      ].join("\n");
      await sendAndSave(phone, intro, session.caseId, session.clientName);
      // Fall through to send the second batch — exit early and let the next-batch handler take over
      // We do this by calling ourselves recursively after small delay
      session.phase = "ai_chat";
      await setSession(phone, session);
      // Trigger sending the next batch by simulating a "ready" reply
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
      preambleLines.push(`To complete your *${session.formType}* application, I just need answers to *${totalBatches} short sections*.`);
    } else {
      preambleLines.push(`To prepare your *${session.formType}* application, I have *${totalBatches} sections* of questions.`);
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

    await sendAndSave(phone, firstMsg, session.caseId, session.clientName);
    return;
  }

  // Phase: AI chat — ask questions one by one based on chatTurns index
  if (session.phase === "ai_chat") {
    const qIndex = session.chatTurns;
    const currentQuestion = session.questions[qIndex];
    const firstName = session.clientName.split(" ")[0];

    // ── Smart batch detection ──
    // The question prompt explicitly asks the client to "reply with all answers numbered (1. answer, 2. answer...)"
    // so we must honor that format. Detect numbered answers in the reply and assign each to the
    // corresponding question. Handles separators "1.", "1)", "1.)", "1:" with or without spaces,
    // and answers separated by either newlines or just spaces.
    let answersCaptured = 0;
    if (text) {
      // Find all positions of number markers like "1.", "2)", "3.)", "4:" — at start OR after whitespace
      const markerRegex = /(?:^|\s)(\d{1,2})[.)\:]+\s*/g;
      const positions: Array<{ num: number; start: number; end: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = markerRegex.exec(text)) !== null) {
        // Capture position right after the marker so we can extract the answer text
        positions.push({
          num: parseInt(m[1], 10),
          start: m.index + (m[0].length - m[0].trimStart().length),
          end: markerRegex.lastIndex,
        });
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

        for (let i = 0; i < positions.length; i++) {
          const pos = positions[i];
          const nextStart = i + 1 < positions.length ? positions[i + 1].start : text.length;
          const answerText = text.substring(pos.end, nextStart).trim();
          if (!answerText) continue;

          let targetIdx: number;
          if (pos.num >= 1 && pos.num <= promptedIndices.length) {
            targetIdx = promptedIndices[pos.num - 1];
          } else if (promptedIndices.length === 0 && batchIndices.length > 0 &&
                     pos.num >= 1 && pos.num <= batchIndices.length) {
            // Defensive: if every batch question is somehow already marked
            // answered (shouldn't normally happen on an active reply), fall
            // back to the full batch order so we don't drop the answer.
            targetIdx = batchIndices[pos.num - 1];
          } else {
            // Client's marker number is out of range for the current prompt.
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
      // Strip a leading "N." / "N)" / "N.)" prefix if present (e.g. "4.) No" → "No")
      const cleaned = text.replace(/^\s*\d{1,2}[.)\:]+\s*/, "").trim() || text.trim();
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
      await updateCaseProcessing(session.companyId, session.caseId, {
        pgwpIntake: {
          ...session.answers,
          whatsappIntakePhase: "complete",
          whatsappIntakeCompletedAt: new Date().toISOString(),
          ...(session.validationFlags && session.validationFlags.length > 0
            ? { _intakeValidationFlags: session.validationFlags }
            : {}),
        },
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
