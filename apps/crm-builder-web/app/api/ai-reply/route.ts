import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { listCases } from "@/lib/store";
import { Pool } from "pg";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { phone, message, caseId, action, systemToken } = body;

  // Allow system calls from webhook with system token
  const isSystemCall = isValidSystemToken(systemToken);
  if (!isSystemCall) {
    const user = await getCurrentUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get case context
  let caseContext = "";
  const companyId = process.env.DEFAULT_COMPANY_ID || "newton";
  if (caseId) {
    const cases = await listCases(companyId);
    const c = cases.find((x: any) => x.id === caseId);
    if (c) caseContext = `Client: ${c.client} | Form: ${c.formType} | Status: ${(c as any).processingStatus || "docs_pending"}`;
  }

  // Get recent conversation
  let recentMsgs = "";
  try {
    const cleanPhone = String(phone || "").replace(/\D/g, "");
    const res = await pool.query(
      `SELECT direction, message FROM whatsapp_inbox WHERE phone LIKE $1 ORDER BY created_at DESC LIMIT 10`,
      [`%${cleanPhone.slice(-9)}`]
    );
    recentMsgs = res.rows.reverse()
      .map((r: any) => `${r.direction === "outbound" ? "Newton" : "Client"}: ${r.message}`)
      .join("\n");
  } catch { /* non-fatal */ }

  const prompt = action === "suggest"
    ? `You are Newton Immigration assistant. Suggest a reply to this client message.
${caseContext}
Recent conversation:
${recentMsgs || "No previous messages"}
Latest client message: "${message}"
Write a helpful, warm WhatsApp reply in 2-3 sentences. Sign: Newton Immigration Team 🍁`
    : `You are Newton Immigration assistant. Generate an auto-reply.
${caseContext}
Client message: "${message}"
Write a brief, professional WhatsApp reply. Sign: Newton Immigration Team 🍁`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await res.json() as any;
    const text = data.content?.[0]?.text || "";

    if (action === "send" && phone && text) {
      const cleanPhone = String(phone).replace(/\D/g, "");
      await sendWhatsAppText(cleanPhone, text);
      // Save to inbox
      await pool.query(
        `INSERT INTO whatsapp_inbox (id, phone, message, direction, matched_case_id, is_read) VALUES ($1,$2,$3,'outbound',$4,TRUE)`,
        [`WA-AI-${Date.now()}`, cleanPhone, text, caseId || null]
      ).catch(() => {});
    }

    return NextResponse.json({ ok: true, text });
  } catch {
    return NextResponse.json({ error: "AI request failed" }, { status: 500 });
  }
}
