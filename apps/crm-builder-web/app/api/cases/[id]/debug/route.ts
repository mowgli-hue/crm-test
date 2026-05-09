// ─────────────────────────────────────────────────────────────────────
// GET /api/cases/[id]/debug
//
// Comprehensive diagnostic for "why isn't intake starting" / "why is the
// checklist not showing" / "why is the bot not responding". Returns
// everything we know about the case in one JSON blob:
//
//   - Case row (form type, phone, intake fields populated, etc.)
//   - Intake session (phase, chatTurns, lastBotAt, last message exchanged)
//   - Checklist resolution (which application key, what items)
//   - Recent inbox messages (last 10 inbound + outbound, last 24h)
//   - 24h window status (can we send free-form?)
//   - Documents count + most recent
//   - Stuck uploads count for this case
//
// Use this when staff says "intake isn't working" — instead of guessing,
// run this and the bug usually jumps out.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase } from "@/lib/store";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const caseId = params.id;
  const caseItem = await getCase(user.companyId, caseId);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const phone = (caseItem.leadPhone || "").replace(/\D/g, "");
  const last10 = phone.slice(-10);
  const result: any = {
    ok: true,
    caseId,
    caseSummary: {
      client: caseItem.client,
      formType: caseItem.formType,
      leadPhone: caseItem.leadPhone,
      docsUploadLink: caseItem.docsUploadLink || "(empty)",
      assignedTo: caseItem.assignedTo,
      processingStatus: caseItem.processingStatus,
      createdAt: caseItem.createdAt,
      intakeFieldCount: Object.keys(caseItem.pgwpIntake || {}).length,
    },
  };

  // 1. Intake session state
  try {
    const sessRes = await pool.query(
      `SELECT * FROM intake_sessions WHERE phone = $1 AND company_id = $2 ORDER BY updated_at DESC LIMIT 1`,
      [phone, user.companyId]
    );
    if (sessRes.rows.length === 0) {
      result.intakeSession = {
        status: "NO_SESSION",
        diagnosis:
          "No intake session row exists for this phone. Possible reasons:\n" +
          "  (a) Staff never clicked Start Intake\n" +
          "  (b) Case was created but auto-intake failed silently\n" +
          "  (c) Phone number on the case doesn't match what was used at intake start\n" +
          "Action: click Start Intake button on the case",
      };
    } else {
      const s = sessRes.rows[0];
      result.intakeSession = {
        phase: s.phase,
        chatTurns: s.chat_turns,
        questionsAnswered: Object.keys(s.collected_fields || {}).length,
        questionsTotal: (s.questions || []).length,
        lastUpdate: s.updated_at,
        ageMinutes: Math.round((Date.now() - new Date(s.updated_at).getTime()) / 60000),
        diagnosis: (() => {
          const ageMin = Math.round((Date.now() - new Date(s.updated_at).getTime()) / 60000);
          if (s.phase === "awaiting_template_reply" && s.chat_turns === 0) {
            return ageMin > 60
              ? "Stuck at awaiting_template_reply for >1h with no chatTurns. Either template never delivered, OR client hasn't replied yet. Try clicking Start Intake again — the unstick logic will check 24h window and skip template if window is open."
              : "Recently sent template — waiting for client to reply. Normal state if just clicked Start.";
          }
          if (s.phase === "ai_chat" && ageMin > 1440 && s.chat_turns < 5) {
            return "AI chat started but client hasn't engaged in 24h+. Bot may need staff to send a nudge.";
          }
          if (s.phase === "complete") return "✅ Intake complete";
          return "Active session — appears healthy";
        })(),
      };
    }
  } catch (e) {
    result.intakeSession = { error: (e as Error).message };
  }

  // 2. 24h window check
  try {
    const lastInbound = await pool.query(
      `SELECT created_at FROM whatsapp_inbox
        WHERE direction = 'inbound'
          AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = $1
        ORDER BY created_at DESC LIMIT 1`,
      [last10]
    );
    if (lastInbound.rows.length === 0) {
      result.window24h = {
        status: "NEVER_REPLIED",
        diagnosis: "Client has never sent ANY inbound message. Free-form messages will be rejected by Meta — must use template. If template isn't being delivered, staff should manually contact the client first.",
      };
    } else {
      const lastInboundAt = new Date(lastInbound.rows[0].created_at);
      const ageHours = (Date.now() - lastInboundAt.getTime()) / 3600000;
      result.window24h = {
        lastInboundAt: lastInboundAt.toISOString(),
        ageHours: Math.round(ageHours * 10) / 10,
        isOpen: ageHours < 24,
        diagnosis: ageHours < 24
          ? "✅ Window OPEN — free-form messages will work. If intake still not starting, problem is elsewhere."
          : `❌ Window CLOSED (last reply ${Math.round(ageHours)}h ago). Free-form sends will fail. Must use template — verify template send is working.`,
      };
    }
  } catch (e) {
    result.window24h = { error: (e as Error).message };
  }

  // 3. Recent messages (last 10, both directions)
  try {
    const msgRes = await pool.query(
      `SELECT id, direction, message, is_read, created_at
         FROM whatsapp_inbox
        WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [last10]
    );
    result.recentMessages = msgRes.rows.map((r) => ({
      direction: r.direction,
      isRead: r.is_read,
      createdAt: r.created_at,
      ageMinutes: Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000),
      preview: String(r.message || "").slice(0, 120),
    }));
    if (msgRes.rows.length === 0) {
      result.recentMessages = {
        status: "NO_MESSAGES",
        diagnosis: "No WhatsApp messages at all for this phone — either phone is wrong on the case, or no template/intake has ever been attempted.",
      };
    }
  } catch (e) {
    result.recentMessages = { error: (e as Error).message };
  }

  // 4. Checklist resolution
  try {
    const { resolveApplicationChecklistKey, getChecklistForFormType } = await import("@/lib/application-checklists");
    const { getQuestionPromptsForFormType } = await import("@/lib/application-question-flows");
    const ft = caseItem.formType.toLowerCase();
    const checklistKey = resolveApplicationChecklistKey(ft);
    const checklistItems = getChecklistForFormType(ft);
    const flowQuestions = getQuestionPromptsForFormType(ft);
    const isGeneric = checklistKey === "generic";
    result.checklist = {
      formType: caseItem.formType,
      resolvedKey: checklistKey,
      checklistItemCount: checklistItems.length,
      intakeQuestionCount: flowQuestions.length,
      diagnosis: isGeneric
        ? `⚠️ Form type "${caseItem.formType}" did NOT match any specific checklist — fell back to "generic". This is the most likely cause of "no checklist showing" / "intake not starting properly" reports. ` +
          `Action: Either rename the case form type to one of the supported labels (e.g., "PGWP", "TRV", "Visitor Visa", "Study Permit", "Spousal Sponsorship", "PR Card Renewal", "Citizenship", "SOWP", "Express Entry"), OR add a new branch in resolveApplicationChecklistKey to recognize this form type.`
        : `Form type maps to "${checklistKey}" with ${checklistItems.length} checklist items + ${flowQuestions.length} intake questions. If checklist isn't rendering in UI, frontend issue.`,
    };
  } catch (e) {
    result.checklist = { error: (e as Error).message };
  }

  // 5. Documents
  try {
    const docRes = await pool.query(
      `SELECT id, file_name, mime_type, created_at
         FROM documents
        WHERE case_id = $1
        ORDER BY created_at DESC
        LIMIT 5`,
      [caseId]
    );
    result.documents = {
      count: docRes.rows.length,
      mostRecent: docRes.rows.map((d) => ({
        name: d.file_name,
        mime: d.mime_type,
        createdAt: d.created_at,
      })),
    };
  } catch {
    result.documents = { error: "documents table query failed" };
  }

  // 6. Stuck uploads for this case
  try {
    const stuckRes = await pool.query(
      `SELECT id, message, created_at
         FROM whatsapp_inbox
        WHERE matched_case_id = $1
          AND message LIKE '%pending=1%'`,
      [caseId]
    );
    result.stuckUploadCount = stuckRes.rows.length;
    if (stuckRes.rows.length > 0) {
      result.stuckUploadHint = `This case has ${stuckRes.rows.length} stuck upload(s). Use POST /api/admin/stuck-uploads/action to dismiss/retry.`;
    }
  } catch {
    /* ignore */
  }

  // 7. Phone format validity (Meta requires E.164 — country code, no + or spaces)
  // This is the most common cause of "client never received message" — staff edits
  // the phone in the CRM and adds a "+" or dashes, Meta rejects every send.
  result.phoneFormat = (() => {
    const raw = caseItem.leadPhone || "";
    const digits = String(raw).replace(/\D/g, "");
    if (!digits) {
      return {
        status: "MISSING",
        diagnosis: "❌ No phone number on this case. All sends will fail. Action: edit case and add the client's WhatsApp number.",
      };
    }
    if (digits.length < 10) {
      return {
        status: "TOO_SHORT",
        digits,
        diagnosis: `❌ Phone "${raw}" → ${digits.length} digits (need ≥10). Likely missing country code or partial. Meta will reject.`,
      };
    }
    if (digits.length > 15) {
      return {
        status: "TOO_LONG",
        digits,
        diagnosis: `❌ Phone "${raw}" → ${digits.length} digits (max 15 per E.164). Meta will reject.`,
      };
    }
    // Most clients are Canada (1) or India (91)
    const startsWithCanada = digits.startsWith("1") && digits.length === 11;
    const startsWithIndia = digits.startsWith("91") && digits.length === 12;
    return {
      status: "OK",
      digits,
      e164: `+${digits}`,
      diagnosis: `✅ Phone format valid${startsWithCanada ? " (Canada)" : startsWithIndia ? " (India)" : ""} — Meta should accept.`,
    };
  })();

  // 8. Marketing-bot interception check
  // Real bug from CASE-1399 (Ramandeep): she received the intake template but
  // her reply was answered by the marketing bot because marketing_leads.stage
  // wasn't flipped to "converted" + ai_enabled wasn't false. The fix was added
  // to /api/cases/route.ts but old leads might still have stale state. This
  // diagnostic surfaces it so staff can fix manually.
  if (phone) {
    try {
      const leadRes = await pool.query(
        `SELECT phone, stage, converted_case_id, ai_enabled, updated_at
           FROM marketing_leads WHERE phone = $1`,
        [phone]
      );
      if (leadRes.rows.length === 0) {
        result.marketingBotStatus = {
          status: "NO_LEAD_ROW",
          diagnosis: "No marketing_leads row — marketing bot won't intercept. ✅ Safe.",
        };
      } else {
        const lead = leadRes.rows[0];
        const wouldIntercept = lead.ai_enabled === true && lead.stage !== "converted";
        result.marketingBotStatus = {
          stage: lead.stage,
          aiEnabled: lead.ai_enabled,
          convertedCaseId: lead.converted_case_id,
          updatedAt: lead.updated_at,
          diagnosis: wouldIntercept
            ? `❌ MARKETING BOT WILL INTERCEPT! lead.ai_enabled=true and stage="${lead.stage}" (not "converted"). Client's reply will be answered by marketing bot, not the case-intake bot. Fix: UPDATE marketing_leads SET stage='converted', ai_enabled=FALSE, converted_case_id='${caseId}' WHERE phone='${phone}';`
            : lead.converted_case_id && lead.converted_case_id !== caseId
              ? `⚠️ marketing_leads.converted_case_id="${lead.converted_case_id}" but this case is ${caseId}. Old conversion pointer — usually harmless but staff should verify.`
              : "✅ Marketing bot disabled for this lead — case-intake bot owns this conversation.",
        };
      }
    } catch (e) {
      result.marketingBotStatus = { error: (e as Error).message.slice(0, 100) };
    }
  }

  // 9. Last 5 outbound message delivery statuses
  // Outbound rows in whatsapp_inbox have direction='outbound'. There's no
  // delivery-receipt status stored at the moment, but knowing that recent
  // outbounds EXIST tells us the bot tried to send. If staff says "client
  // didn't receive", checking this confirms the send happened.
  try {
    const outRes = await pool.query(
      `SELECT message, created_at
         FROM whatsapp_inbox
        WHERE direction = 'outbound'
          AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = $1
        ORDER BY created_at DESC
        LIMIT 5`,
      [last10]
    );
    result.recentOutbound = {
      count: outRes.rows.length,
      messages: outRes.rows.map((r) => ({
        createdAt: r.created_at,
        ageMinutes: Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000),
        preview: String(r.message || "").slice(0, 100),
      })),
      diagnosis:
        outRes.rows.length === 0
          ? "❌ No outbound messages ever sent to this phone. Either case is fresh and intake hasn't started, OR all sends are silently failing."
          : `✅ ${outRes.rows.length} recent outbound(s). If client says they didn't receive, possible causes: (a) blocked Newton's number, (b) phone format wrong [check #7 above], (c) WhatsApp inactive on this number — try SMS or call.`,
    };
  } catch (e) {
    result.recentOutbound = { error: (e as Error).message.slice(0, 100) };
  }

  // 10. Top-level summary
  result.summary = (() => {
    const issues: string[] = [];
    // Phone format issues come first — always the prerequisite
    if (result.phoneFormat?.status === "MISSING") {
      issues.push("❌ No phone number on case — fix this first");
    } else if (result.phoneFormat?.status === "TOO_SHORT" || result.phoneFormat?.status === "TOO_LONG") {
      issues.push(`❌ Phone format invalid (${result.phoneFormat.digits?.length || 0} digits) — Meta will reject`);
    }
    // Marketing bot interception
    if (result.marketingBotStatus?.diagnosis?.startsWith("❌")) {
      issues.push("❌ Marketing bot will intercept replies — flip lead stage to 'converted'");
    }
    if (result.intakeSession?.status === "NO_SESSION") {
      issues.push("⚠️ No intake session — click Start Intake");
    }
    if (result.intakeSession?.phase === "awaiting_template_reply" && result.intakeSession?.chatTurns === 0 && result.intakeSession?.ageMinutes > 60) {
      issues.push("⚠️ Stuck at awaiting_template_reply — client never tapped/replied to template, OR template never delivered");
    }
    if (result.window24h?.status === "NEVER_REPLIED") {
      issues.push("⚠️ Client has never replied — only templates work");
    }
    if (result.window24h?.isOpen === false) {
      issues.push("⚠️ 24h window CLOSED — free-form sends will fail");
    }
    if (result.checklist?.resolvedKey === "generic") {
      issues.push("⚠️ Form type fell back to 'generic' — checklist + intake questions will be wrong/missing. Most likely root cause.");
    }
    if (result.recentOutbound?.count === 0 && result.intakeSession?.status !== "NO_SESSION") {
      issues.push("⚠️ No outbound messages ever sent — sends may be silently failing");
    }
    if (result.stuckUploadCount > 0) {
      issues.push(`⚠️ ${result.stuckUploadCount} stuck upload(s) for this case`);
    }
    return issues.length > 0
      ? { status: "ISSUES_FOUND", issues }
      : { status: "HEALTHY", message: "✅ No obvious issues — phone format, 24h window, intake session, and bot ownership all look good" };
  })();

  return NextResponse.json(result);
}
