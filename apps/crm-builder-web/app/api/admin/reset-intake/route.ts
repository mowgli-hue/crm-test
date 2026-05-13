import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listCases, updateCasePgwpIntake } from "@/lib/store";
import { getQuestionPromptsForFormType } from "@/lib/application-question-flows";
import { setSession } from "@/lib/whatsapp-ai-intake";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request).catch(() => null);
  const body = await request.json().catch(() => ({}));
  const isSystem = isValidSystemToken(body.systemToken);
  if (!user && !isSystem) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = user?.companyId || process.env.DEFAULT_COMPANY_ID || "newton";
  const cases = await listCases(companyId);

  // Find cases with old bulk sessions OR no session but have a phone
  const toReset = cases.filter((c: any) => {
    const phone = String(c.leadPhone || "").replace(/\D/g, "");
    if (!phone) return false;
    if (c.processingStatus === "submitted") return false; // skip submitted
    try {
      const session = c.pgwpIntake?.whatsappSession
        ? JSON.parse(c.pgwpIntake.whatsappSession)
        : null;
      // Reset if: old bulk phase, or no session at all
      return !session || session.phase === "awaiting_bulk" || session.phase === "intake";
    } catch { return true; }
  });

  let reset = 0;
  for (const c of toReset) {
    try {
      const phone = String(c.leadPhone || "").replace(/\D/g, "");
      // Clear old session from intake — must use updateCasePgwpIntake (the dedicated
      // function for editing pgwpIntake), NOT updateCaseProcessing which is for
      // workflow status and rejects pgwpIntake fields. Setting whatsappSession to
      // empty string is the convention used elsewhere to mean "cleared" while
      // preserving the surrounding intake answers.
      await updateCasePgwpIntake(companyId, c.id, { whatsappSession: "" });

      // Set new AI session
      const questions = getQuestionPromptsForFormType(c.formType);
      await setSession(phone, {
        caseId: c.id,
        companyId,
        phone,
        clientName: c.client || "Client",
        formType: c.formType || "PGWP",
        questions,
        currentIndex: 0,
        answers: {},
        phase: "awaiting_template_reply",
        conversationHistory: [],
        collectedFields: {},
        chatTurns: 0,
      });
      reset++;
    } catch (e) {
      console.error(`Reset failed for ${c.id}:`, e);
    }
  }

  return NextResponse.json({ ok: true, reset, total: toReset.length });
}
