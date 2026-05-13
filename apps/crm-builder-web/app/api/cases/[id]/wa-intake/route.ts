import { NextRequest, NextResponse } from "next/server";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { getCurrentUserFromRequest } = await import("@/lib/auth");
    const { getCase } = await import("@/lib/store");

    let companyId = "newton";
    try {
      const user = await getCurrentUserFromRequest(request);
      if (user) companyId = user.companyId;
    } catch { /* allow system calls */ }

    const caseItem = await getCase(companyId, params.id);
    if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

    const phone = String(caseItem.leadPhone || "").replace(/\D/g, "");
    if (!phone) return NextResponse.json({ error: "No phone number on this case" }, { status: 400 });

    // Skip WhatsApp intake for College Change / SPE cases - handled manually
    const skipFormTypes = ["college change", "college transfer"];
    const formTypeLower = String(caseItem.formType || "").toLowerCase();
    if (skipFormTypes.some(t => formTypeLower.includes(t))) {
      return NextResponse.json({ ok: false, message: `WhatsApp intake skipped for ${caseItem.formType} — handled manually by team` });
    }

    console.log(`📱 WA Intake: ${caseItem.client} | formType: ${caseItem.formType} | phone: ${phone}`);

    // Use the AI conversational intake
    const { startIntakeSession } = await import("@/lib/whatsapp-ai-intake");
    const result = await startIntakeSession({
      caseId: params.id,
      companyId,
      phone,
      clientName: caseItem.client || "Client",
      formType: caseItem.formType || "PGWP",
      // Pass existing intake (passport scan data + manual fields). Pre-answers any questions
      // we can derive from this — saves the client from re-typing passport details.
      existingIntake: (caseItem.pgwpIntake as Record<string, any>) || {},
    });

    return NextResponse.json({ 
      ok: result.success, 
      message: result.success 
        ? `AI intake started for ${caseItem.client} — waiting for client reply${result.skippedCount ? ` (${result.skippedCount} questions pre-answered from passport)` : ""}${result.recoveredCount ? ` (${result.recoveredCount} answer(s) recovered from previous WhatsApp reply)` : ""}`
        : `Failed: ${result.error}` 
    });
  } catch (e) {
    console.error("wa-intake error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const systemToken = body?.systemToken;
    const isSystem = isValidSystemToken(systemToken);

    if (!isSystem) {
      const user = await getCurrentUserFromRequest(request);
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const companyId = process.env.DEFAULT_COMPANY_ID || "newton";
    const { updateCasePgwpIntake } = await import("@/lib/store");

    // Clear the WhatsApp session from the case
    await updateCasePgwpIntake(companyId, params.id, {
      whatsappSession: "",
      whatsappIntakePhase: "stopped",
      whatsappIntakeStoppedAt: new Date().toISOString(),
    } as any);

    console.log(`⛔ WA Intake stopped for case ${params.id}`);
    return NextResponse.json({ ok: true, message: "Intake stopped" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
