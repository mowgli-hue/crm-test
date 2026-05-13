import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase } from "@/lib/store";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request).catch(() => null);
  const body = await request.json().catch(() => ({}));
  const isSystemCall = isValidSystemToken(body.systemToken);
  if (!user && !isSystemCall) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const { action, context } = body;
  const companyId = user?.companyId || process.env.DEFAULT_COMPANY_ID || "newton";
  const caseItem = await getCase(companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const intake = (caseItem as any).pgwpIntake || (caseItem as any).intake || {};
  const intakeText = Object.entries(intake)
    .filter(([,v]) => v)
    .map(([k,v]) => `${k}: ${v}`)
    .join("\n") || "No intake data yet";

  const prompts: Record<string, string> = {
    summary: `You are an immigration case manager. Summarize this case for the team in 3-4 sentences.
Client: ${caseItem.client} | Form: ${caseItem.formType} | Status: ${(caseItem as any).processingStatus || "docs_pending"} | Assigned: ${caseItem.assignedTo || "Unassigned"}
Intake: ${intakeText}
Cover: who the client is, what they applied for, current status, what needs to happen next.`,

    intake_check: `You are an immigration expert. Review these ${caseItem.formType} intake answers for ${caseItem.client}.
${intakeText}
List: 1) Incomplete/unclear answers 2) Red flags (refusals/criminal/medical) 3) Missing info 4) Readiness: Ready/Needs Work/Missing Key Info`,

    smart_reply: `You are Newton Immigration consultant. Client: ${caseItem.client} (${caseItem.formType}).
Client message: "${context || ""}"
Write a warm professional WhatsApp reply in 2-3 sentences. Sign: Newton Immigration Team`,

    overdue_check: `Review this case urgency. Client: ${caseItem.client} | Form: ${caseItem.formType} | Status: ${(caseItem as any).processingStatus || "docs_pending"} | Assigned: ${caseItem.assignedTo || "Unassigned"} | Created: ${(caseItem as any).createdAt || "Unknown"}
Is this overdue or at risk? What immediate action needed? 2-3 sentences.`,

    draft_notes: `You are an immigration consultant. Write internal case notes for ${caseItem.client}'s ${caseItem.formType} application based on this intake data:
${intakeText}
Write 3-4 bullet points of key facts for the processing team. Be factual and concise.`
  };

  const prompt = prompts[action];
  if (!prompt) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

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
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await res.json() as any;
    const text = data.content?.[0]?.text || "Could not generate response";
    return NextResponse.json({ ok: true, text, action });
  } catch {
    return NextResponse.json({ error: "AI request failed" }, { status: 500 });
  }
}
