// ─────────────────────────────────────────────────────────────────────
// Post-Intake AI Auto-Reply
//
// Purpose: When a matched-case client messages us AFTER their intake
// session is complete, decide whether to auto-reply with Claude or defer
// to staff.
//
// Two-step flow:
//   1) classifyMessage() — fast cheap LLM call asks: is this SAFE for AI
//      to handle, or should staff handle it?
//   2) generateReply() — if safe, write a short, careful reply
//
// Strict guardrails inside the prompts:
//   - No fees/dollar amounts
//   - No timing/processing-time guarantees
//   - No legal advice / outcome predictions
//   - 1-3 sentences max
//   - Defer to "our team will follow up shortly" on uncertainty
//
// What this module does NOT do:
//   - Does NOT handle intake bot questions (that's whatsapp-ai-intake.ts)
//   - Does NOT handle unknown numbers (separate auto-replies elsewhere)
//   - Does NOT modify case data
// ─────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

export type ClassifyResult =
  | { route: "ai"; reason: string }
  | { route: "staff"; reason: string }
  | { route: "ignore"; reason: string };

// Classify: should AI auto-reply, should staff handle, or should we just
// stay silent (e.g. for raw acknowledgements that don't need a reply)?
export async function classifyMessage(input: {
  clientName: string;
  formType: string;
  caseStage: string;
  message: string;
}): Promise<ClassifyResult> {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return { route: "staff", reason: "no API key" };

  const text = String(input.message || "").trim();
  if (!text) return { route: "ignore", reason: "empty message" };

  // Fast pre-checks before paying for an LLM call.
  // Pure acks/emojis: ignore (don't reply at all — would be spammy).
  const tinyAcks = /^(hi|hello|hey|good morning|good evening|good afternoon|hola|salam|sat sri akal|ssa|ok|okay|k|kk|hmm|hm|👍|🙏|✅|👌|thanks|thank you|thx|ty|noted|got it|sure|yep|yup|done|received|ji|haa|ਹਾਂ|ਜੀ|ਠੀਕ|ji|theek)!?\.?\s*$/i;
  if (tinyAcks.test(text)) {
    return { route: "ignore", reason: "tiny acknowledgement — no reply needed" };
  }

  // Anything explicitly RISKY by keyword we route to staff regardless of LLM
  // opinion. Belt-and-suspenders safety.
  const riskyPatterns = [
    /\b(refus|reject|denied|denial)/i,                            // refusal/rejection
    /\bircc\b/i,                                                  // IRCC notices
    /\bappeal\b|\bjudicial review\b/i,                            // legal escalation
    /\$|\bfee\b|\bcost|how much|kitne ka|kinne ke/i,              // money
    /\bwhen will|kab tak|kitne din|how long|how many days/i,      // timing
    /\bemerg|urgent|asap|deport|removal/i,                        // urgency
    /\blawyer|legal advice|complaint/i,                           // legal
    /\bvisitor record\b|\brestoration\b|\bpgwp\b|\bsowp\b/i,      // these need actual case-specific work
  ];
  if (riskyPatterns.some((re) => re.test(text))) {
    return { route: "staff", reason: "matched risky keyword — staff handles" };
  }

  // Long messages (likely complex) → staff
  if (text.length > 280) {
    return { route: "staff", reason: "message too long for safe auto-reply" };
  }

  // Otherwise ask Claude to classify.
  const sys = [
    "You classify incoming WhatsApp messages from immigration clients into one of three buckets:",
    "  ai     → small talk, simple update acks, brief polite questions, intake updates like 'Q14 update answer ...', short status pings",
    "  staff  → anything involving fees, timing/dates/deadlines, eligibility, legal advice, IRCC notices, refusals, complaints, document specifics, anything requiring real case knowledge",
    "  ignore → silent acks where no reply is appropriate (a single emoji, 'ok', 'thanks', 'received')",
    "",
    "Default to 'staff' when uncertain. It is SAFER to defer to a human than to auto-reply incorrectly.",
    "Respond with EXACTLY one word: ai | staff | ignore",
  ].join("\n");
  const usr = [
    `Client: ${input.clientName || "Unknown"}`,
    `Application: ${input.formType || "Unknown"}`,
    `Stage: ${input.caseStage || "Unknown"}`,
    `Message: ${text}`,
  ].join("\n");

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8,
        system: sys,
        messages: [{ role: "user", content: usr }],
      }),
    });
    if (!res.ok) return { route: "staff", reason: `classifier HTTP ${res.status}` };
    const data: any = await res.json();
    const out = String(data?.content?.[0]?.text || "").trim().toLowerCase();
    if (out.startsWith("ignore")) return { route: "ignore", reason: "classifier: ignore" };
    if (out.startsWith("ai")) return { route: "ai", reason: "classifier: ai" };
    return { route: "staff", reason: `classifier: ${out || "unknown"}` };
  } catch (e) {
    return { route: "staff", reason: `classifier error: ${(e as Error).message}` };
  }
}

// Generate a short, careful reply. Returns null on any failure — caller
// must fall through to staff handoff in that case.
export async function generateReply(input: {
  clientName: string;
  formType: string;
  caseStage: string;
  missingDocs: string[];
  recentConversation: Array<{ role: "client" | "staff" | "ai"; text: string }>;
  message: string;
}): Promise<string | null> {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return null;

  const transcript = input.recentConversation
    .slice(-8)
    .map((m) => {
      const label = m.role === "client" ? "Client" : m.role === "ai" ? "Bot" : "Staff";
      return `${label}: ${m.text}`;
    })
    .join("\n");

  const missingDocsLine =
    input.missingDocs.length > 0
      ? `Documents still needed (${input.missingDocs.length}): ${input.missingDocs.slice(0, 5).join(", ")}${input.missingDocs.length > 5 ? ", …" : ""}`
      : `All required documents received.`;

  const sys = [
    "You are a helper assistant for Newton Immigration Inc., a Canadian immigration consulting firm. You write SHORT, friendly WhatsApp replies on behalf of the team.",
    "",
    "RULES — these are not flexible:",
    "1. Keep replies to 1-3 short sentences. No paragraphs.",
    "2. NEVER quote or invent specific dollar amounts, fees, or IRCC fees.",
    "3. NEVER promise specific timing, processing times, deadlines, or outcomes.",
    "4. NEVER give legal advice or eligibility opinions.",
    "5. If you would need to say anything covered by rules 2-4, write instead: 'Let me check with our team and get back to you shortly.'",
    "6. If client is sending an intake update (e.g. 'Q14 update answer ...', 'q3 update marriage date 10 june 2024'), reply: 'Got it — I've noted your update. Our team will update your file shortly.'",
    "7. If client says they sent a document or attached one, reply: 'Thanks, we'll review and let you know if anything else is needed.'",
    "8. Match the client's language. If they wrote in English, reply in English. If they wrote in Punjabi, you may use simple Punjabi/English mix. Don't switch languages on them.",
    "9. Do NOT use emojis unless the client used one in their last message.",
    "10. Tone: warm, professional, plain. No robotic phrasing like 'Thank you for your message'. Just write like a friendly team member.",
    "11. Sign off ONLY when it feels natural (don't always add '— Newton Team'). For short acks, no sign-off.",
    "12. DO NOT ask the client unsolicited questions about their application status, progress, documents, or timeline. NEVER write things like 'How is it going with your application?' or 'Any questions about your case?' or 'How can we help?'. The client reached out to US, not the other way around. Respond to what they said, then stop.",
    "13. If the client message is small talk (greetings, well wishes, casual remarks) and there is nothing actionable to respond to, write a single short acknowledgement (e.g. 'Hi! Hope you are doing well.' or 'Thanks for the message, our team is on it.') and STOP. No follow-up question.",
    "14. NEVER suggest the client do something, send something, check something, or update something unless they explicitly asked what to do next. The team decides next steps, not the bot.",
    "",
    "Return ONLY the reply text. No labels, no quotes, no preamble.",
  ].join("\n");

  const usr = [
    `Case context:`,
    `Client name: ${input.clientName || "Unknown"}`,
    `Application: ${input.formType || "Unknown"}`,
    `Stage: ${input.caseStage || "Unknown"}`,
    missingDocsLine,
    ``,
    `Recent conversation (most recent at bottom):`,
    transcript || "(no prior messages)",
    ``,
    `Latest message from client:`,
    input.message,
    ``,
    `Write a short reply.`,
  ].join("\n");

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 220,
        system: sys,
        messages: [{ role: "user", content: usr }],
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    let out = String(data?.content?.[0]?.text || "").trim();
    if (!out) return null;
    // Strip common preambles even though we asked the model not to add them.
    out = out.replace(/^(reply|here'?s? (a |the )?reply|draft)[:\s]+/i, "").trim();

    // Final paranoid filter — if the model snuck in a fee or dollar amount
    // or a timing claim despite our rules, drop the reply rather than risk it.
    const banned = [
      /\$\s*\d/,                                  // $300 etc
      /\bcad\b\s*\d/i,                            // CAD 300
      /\bircc\b\s*fee/i,                          // IRCC fee with number
      /\b\d{1,3}\s*(days?|weeks?|months?)\b/i,    // "30 days", "2 weeks"
      /\b(approved|guaranteed|will be)\b/i,       // outcome claims
    ];
    if (banned.some((re) => re.test(out))) return null;
    return out;
  } catch {
    return null;
  }
}
