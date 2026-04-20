// lib/whatsapp-ai-intake.ts
// AI-powered conversational intake — Claude chats with client naturally

import { getQuestionFlowForFormType, getQuestionPromptsForFormType } from "@/lib/application-question-flows";
import { resolveApplicationChecklistKey } from "@/lib/application-checklists";
import { sendWhatsAppText, sendWhatsAppTemplate, sendDocumentChecklist } from "@/lib/whatsapp";
import { getCase, updateCaseProcessing, addMessage } from "@/lib/store";
import { Pool } from "pg";

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
  conversationHistory: Array<{ role: "assistant" | "user"; content: string }>;
  collectedFields: Record<string, string>;
  chatTurns: number;
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
    console.log(`✅ Session found: phase=${session.phase} caseId=${session.caseId}`);
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
    
    console.log(`💾 Session saved: caseId=${session.caseId} phase=${session.phase}`);
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
}): Promise<{ success: boolean; error?: string }> {
  const { caseId, companyId, phone, clientName, formType } = params;
  const questions = getQuestionPromptsForFormType(formType);
  const firstName = clientName.split(" ")[0];

  const session: IntakeSession = {
    caseId, companyId, phone, clientName, formType,
    questions,
    currentIndex: 0,
    answers: {},
    phase: "awaiting_template_reply",
    conversationHistory: [],
    collectedFields: {},
    chatTurns: 0,
  };

  await setSession(phone, session);

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
    return { success: true };
  }

  // Fallback — start AI chat immediately
  session.phase = "ai_chat";
  await setSession(phone, session);
  const firstMsg = await getAiNextMessage(session, null);
  await sendWhatsAppText(phone, firstMsg);
  return { success: true };
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

  // Phase: waiting for template reply → start questions directly
  if (session.phase === "awaiting_template_reply") {
    session.phase = "ai_chat";
    session.chatTurns = 0;
    await setSession(phone, session);

    const firstName = session.clientName.split(" ")[0];
    const firstQuestion = session.questions[0];
    const firstMsg = `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${firstName} ਜੀ! 🙏 Hi *${firstName}*!\n\nTo prepare your *${session.formType}* application, I need to ask you ${session.questions.length} questions. Please reply to each one.\n\n*(1/${session.questions.length})* ${firstQuestion}`;
    await sendAndSave(phone, firstMsg, session.caseId, session.clientName);
    return;
  }

  // Phase: AI chat — ask questions one by one based on chatTurns index
  if (session.phase === "ai_chat") {
    const qIndex = session.chatTurns;
    const currentQuestion = session.questions[qIndex];
    const firstName = session.clientName.split(" ")[0];

    // Save this answer
    if (currentQuestion && text) {
      session.answers[`q${qIndex + 1}`] = text;
      session.answers[currentQuestion.slice(0, 50)] = text;
    }

    session.chatTurns++;
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
      });
      await completeIntake(session);
    } else {
      await setSession(phone, session);
      const nextQuestion = session.questions[nextIndex];
      const ackPhrases = ["Got it! ✓", "Perfect! ✓", "Thank you! ✓", "Noted! ✓", "Great! ✓"];
      const ack = ackPhrases[qIndex % ackPhrases.length];
      const msg = `${ack}\n\n*(${nextIndex + 1}/${session.questions.length})* ${nextQuestion}`;
      await sendAndSave(phone, msg, session.caseId, session.clientName);
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
        pgwpIntake: { ...session.answers, whatsappIntakePhase: "complete", whatsappIntakeCompletedAt: new Date().toISOString() },
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
