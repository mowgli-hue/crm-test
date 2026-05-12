import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { canCreateCase, canStaffAccessCase } from "@/lib/rbac";
import {
  addAuditLog,
  addNotification,
  createCase,
  listCases,
  listUsers,
  resolveCaseDriveRootLink,
  updateCaseLinks
} from "@/lib/store";
import { buildCaseFolderNameWithApp, createCaseDriveStructure, extractDriveFolderId, appendToAllCasesSheet } from "@/lib/google-drive";
import { boundedText, isReasonablePhone, isValidEmail, normalizeEmail, normalizePhone } from "@/lib/validation";
import { startIntakeSession } from "@/lib/whatsapp-ai-intake";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.userType === "client" && user.caseId) {
    const all = await listCases(user.companyId);
    const onlyOwn = all.filter((c) => c.id === user.caseId);
    return NextResponse.json({
      cases: onlyOwn,
      user: { id: user.id, role: user.role, name: user.name, userType: user.userType }
    });
  }

  const cases = await listCases(user.companyId);
  const scopedCases =
    user.userType === "staff"
      ? cases.filter((c) => canStaffAccessCase(user.role, user.name, c.assignedTo))
      : cases;
  return NextResponse.json({
    cases: scopedCases,
    user: { id: user.id, role: user.role, name: user.name, userType: user.userType }
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isStaffLike = user.userType === "staff" || user.role !== "Client";
  if (!isStaffLike) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canCreateCase(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const client = boundedText(body.client, 120);
  const formType = boundedText(body.formType, 120);
  const leadPhone = body?.leadPhone !== undefined ? normalizePhone(body.leadPhone) : undefined;
  const leadEmail = body?.leadEmail !== undefined ? normalizeEmail(body.leadEmail) : undefined;
  const additionalNotes =
    body?.additionalNotes !== undefined ? boundedText(body.additionalNotes, 1000) : undefined;
  const isUrgent = Boolean(body?.isUrgent);
  const permitExpiryDateRaw =
    body?.permitExpiryDate !== undefined ? String(body.permitExpiryDate).trim() : undefined;
  const permitExpiryDate = permitExpiryDateRaw || undefined;
  const totalCharges = body?.totalCharges !== undefined ? Number(body.totalCharges) : undefined;
  const irccFees = body?.irccFees !== undefined ? Number(body.irccFees) : undefined;
  const irccFeePayerRaw = body?.irccFeePayer !== undefined ? String(body.irccFeePayer) : undefined;
  const familyMembers = body?.familyMembers !== undefined ? boundedText(body.familyMembers, 600) : undefined;
  const familyTotalCharges =
    body?.familyTotalCharges !== undefined ? Number(body.familyTotalCharges) : undefined;
  const assignedTo =
    body?.assignedTo !== undefined ? boundedText(body.assignedTo, 120) || undefined : undefined;
  const irccFeePayer =
    irccFeePayerRaw === "sir_card" || irccFeePayerRaw === "client_card"
      ? (irccFeePayerRaw as "sir_card" | "client_card")
      : undefined;
  const dueInDays =
    body?.dueInDays !== undefined && Number.isFinite(Number(body.dueInDays))
      ? Number(body.dueInDays)
      : undefined;

  if (!client || !formType) {
    return NextResponse.json({ error: "client and formType are required" }, { status: 400 });
  }
  if (leadEmail && !isValidEmail(leadEmail)) {
    return NextResponse.json({ error: "Invalid leadEmail format" }, { status: 400 });
  }
  if (leadPhone && !isReasonablePhone(leadPhone)) {
    return NextResponse.json({ error: "Invalid leadPhone format" }, { status: 400 });
  }
  if (permitExpiryDate) {
    const parsed = new Date(permitExpiryDate);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid permitExpiryDate" }, { status: 400 });
    }
  }
  if (totalCharges !== undefined && (!Number.isFinite(totalCharges) || totalCharges < 0)) {
    return NextResponse.json({ error: "Invalid totalCharges" }, { status: 400 });
  }
  if (irccFees !== undefined && (!Number.isFinite(irccFees) || irccFees < 0)) {
    return NextResponse.json({ error: "Invalid irccFees" }, { status: 400 });
  }
  if (irccFeePayerRaw !== undefined && !irccFeePayer) {
    return NextResponse.json({ error: "Invalid irccFeePayer" }, { status: 400 });
  }
  if (familyTotalCharges !== undefined && (!Number.isFinite(familyTotalCharges) || familyTotalCharges < 0)) {
    return NextResponse.json({ error: "Invalid familyTotalCharges" }, { status: 400 });
  }

  // ── Duplicate-phone warning (May 2026) ──
  //
  // Common scenario: staff is asked about a client who already has a case
  // (maybe handed off from a colleague, maybe the client called twice and
  // it wasn't logged). Without this check, staff creates a new case, the
  // bot auto-fires intake again, and the client gets re-greeted in the
  // middle of an ongoing conversation (Harpreet bug).
  //
  // We do a soft check: warn the staff member that another case exists
  // for this phone, but let them override with `?force=true` if they
  // explicitly want to proceed (e.g., it really IS a different family
  // member sharing a phone, or the old case is closed and this is a new
  // application).
  //
  // The frontend should call this without `force`, get the 409 if duplicates
  // exist, show a confirmation modal listing the existing cases, and then
  // retry with `force=true` if the user confirms.
  if (leadPhone && body?.force !== true) {
    try {
      const { listCases } = await import("@/lib/store");
      const phoneDigits = String(leadPhone).replace(/\D/g, "");
      const last9 = phoneDigits.slice(-9);
      const existingCases = await listCases(user.companyId);
      const conflicts = existingCases
        .filter((c) => {
          const cp = (c.leadPhone || "").replace(/\D/g, "");
          return cp && cp.slice(-9) === last9;
        })
        .map((c) => ({
          id: c.id,
          client: c.client,
          formType: c.formType,
          assignedTo: c.assignedTo || null,
          processingStatus: c.processingStatus || null,
          updatedAt: c.updatedAt || null,
        }));
      if (conflicts.length > 0) {
        return NextResponse.json(
          {
            error: "duplicate_phone",
            message: `This phone is already associated with ${conflicts.length} other case${conflicts.length > 1 ? "s" : ""}.`,
            conflicts,
            hint: "Pass force=true in the request body to create this case anyway (e.g., if it's a different family member or a returning client for a new service).",
          },
          { status: 409 },
        );
      }
    } catch (e) {
      // Non-fatal — if duplicate check fails, fall through to normal create.
      console.warn(`Duplicate-phone check failed: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  const created = await createCase({
    companyId: user.companyId,
    client,
    formType,
    leadPhone,
    leadEmail,
    additionalNotes,
    isUrgent,
    dueInDays,
    permitExpiryDate,
    totalCharges,
    irccFees,
    irccFeePayer,
    familyMembers,
    familyTotalCharges,
    assignedTo
  });
  // Sync to client sheet
  appendToAllCasesSheet({
    caseId: created.id,
    name: created.client,
    formType: created.formType,
    phone: created.leadPhone || "",
  }).catch(e => console.error("Client sheet sync failed:", e.message));

  await addAuditLog({
    companyId: user.companyId,
    actorUserId: user.id,
    actorName: user.name,
    action: "case.create",
    resourceType: "case",
    resourceId: created.id,
    metadata: {
      formType: created.formType,
      client: created.client
    }
  });
  const staffUsers = await listUsers(user.companyId);
  const alertMessage = `New case created: ${created.id} (${created.client} - ${created.formType}).`;
  await Promise.all(
    staffUsers
      .filter((u) => u.userType === "staff" && u.active !== false)
      .map((u) =>
        addNotification({
          companyId: user.companyId,
          userId: u.id,
          type: "ai_alert",
          message: alertMessage
        })
      )
  );
  const driveRootChoice = await resolveCaseDriveRootLink(user.companyId, created.id);
  const driveRoot = driveRootChoice.link || "";
  let drive: { linked: boolean; reason?: string; error?: string } = {
    linked: false,
    reason: "drive_root_missing"
  };

  if (driveRoot) {
    const rootId = extractDriveFolderId(driveRoot);
    if (rootId) {
      try {
        const structure = await createCaseDriveStructure(
          rootId,
          buildCaseFolderNameWithApp(created.id, created.client, created.formType)
        );
        const withDrive = await updateCaseLinks(user.companyId, created.id, {
          docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
          applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
          submittedFolderLink: structure.subfolders.submitted.webViewLink,
          correspondenceFolderLink: structure.subfolders.correspondence.webViewLink
        });
        drive = { linked: true, reason: driveRootChoice.source };
        return NextResponse.json({ case: withDrive ?? created, drive }, { status: 201 });
      } catch (error) {
        drive = { linked: false, reason: "drive_create_failed", error: (error as Error).message };
      }
    } else {
      drive = { linked: false, reason: "drive_root_invalid" };
    }
  }

  // Auto: generate AI summary, register in All Cases sheet, and start WhatsApp
  // intake. All three of these used to run inside a `setTimeout(() => {...}, 3000)`
  // which doesn't survive serverless function termination — when this POST
  // returned its NextResponse, the runtime would tear down before the timer
  // fired, dropping the work silently. Fixed by running them inline (awaited)
  // so they complete before the response is returned. Each is wrapped in
  // try/catch so partial failures don't block case creation.

  // Auto AI summary note
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://crm.newtonimmigration.com";
    const summaryRes = await fetch(`${appUrl}/api/cases/${created.id}/ai-smart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "summary" })
    });
    if (summaryRes.ok) {
      const summaryData = await summaryRes.json();
      if (summaryData.text) {
        await fetch(`${appUrl}/api/cases/${created.id}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `🤖 AI Case Summary (auto-generated):
${summaryData.text}`,
            addedBy: "AI"
          })
        });
      }
    }
  } catch (e) { console.error("Auto AI summary failed:", (e as Error).message); }

  // Add to All Cases tracking sheet
  try {
    const { appendToAllCasesSheet } = await import("@/lib/google-drive");
    await appendToAllCasesSheet({
      caseId: created.id,
      name: created.client,
      phone: String(created.leadPhone || ""),
      formType: created.formType,
      permitExpiry: String((created as any).permitExpiryDate || ""),
      uci: "",
      isUrgent: created.isUrgent || false,
      amountPaid: created.amountPaid || 0,
    });
  } catch(e) { console.error("All Cases sheet failed:", (e as Error).message); }

  // Auto-start WhatsApp intake (in-process, not via HTTP fetch — fetching
  // ourselves from inside a serverless function with setTimeout was unreliable).
  try {
    const phone = String(created.leadPhone || "").replace(/\D/g, "");

    // ── Mark any matching marketing lead as converted ──
    // Without this, when staff creates a case via the CRM "Add Case" button
    // for someone who messaged the marketing bot earlier, the marketing bot
    // continues responding to that phone (because lead.stage stays "new").
    // The intake template gets sent but the client's reply is intercepted
    // by the marketing bot before the case-intake bot can pick it up. Real
    // bug from CASE-1399 (Ramandeep): she received the intake template but
    // her "Hi" reply was answered by the marketing bot.
    if (phone) {
      try {
        await pool.query(
          `INSERT INTO marketing_leads (phone, stage, converted_case_id, ai_enabled, updated_at)
           VALUES ($1, 'converted', $2, FALSE, NOW())
           ON CONFLICT (phone) DO UPDATE SET
             stage = 'converted',
             converted_case_id = $2,
             ai_enabled = FALSE,
             updated_at = NOW()`,
          [phone, created.id]
        );
        console.log(`✅ Marketing lead ${phone} marked converted to ${created.id}`);
      } catch (e) {
        // Non-fatal — marketing_leads table might not exist yet, or no row
        // for this phone. We still want intake to proceed.
        console.warn(`Failed to mark marketing lead converted for ${created.id}: ${(e as Error).message.slice(0, 100)}`);
      }
    }

    // Skip auto-intake only for advisory/non-processing case types where
    // Newton doesn't actually file an application (so the bot asking intake
    // questions would be confusing for the client). Everything else —
    // PGWP, work permits, study permit new/extension, TRV, visitor visas,
    // sponsorship, etc. — runs auto-intake.
    const skipFormTypes = ["college change", "college transfer"];
    const shouldSkip = skipFormTypes.some(t => created.formType.toLowerCase().includes(t));

    // Helper: when auto-intake is skipped or fails, leave a visible note on
    // the case so staff can see WHY without having to grep Railway logs.
    // Most "auto-intake didn't trigger" complaints from staff are actually
    // explainable (no phone / wrong format / template send failed) but the
    // reason was buried in logs nobody reads.
    const { addMessage } = await import("@/lib/store");
    const writeIntakeNote = async (text: string) => {
      try {
        await addMessage({
          companyId: created.companyId,
          caseId: created.id,
          senderType: "ai",
          senderName: "Auto-Intake",
          text,
        });
      } catch (e) {
        // Note-writing failure is non-fatal — don't block case creation
        console.warn(`Could not write intake note: ${(e as Error).message.slice(0, 80)}`);
      }
    };

    if (phone && !shouldSkip) {
      const { startIntakeSession } = await import("@/lib/whatsapp-ai-intake");
      const result = await startIntakeSession({
        caseId: created.id,
        companyId: created.companyId,
        phone,
        clientName: created.client || "Client",
        formType: created.formType || "PGWP",
        existingIntake: ((created as any).pgwpIntake as Record<string, any>) || {},
      });
      if (result.success) {
        // Differentiate between started fresh vs blocked due to existing session
        // on a different case (Harpreet-style duplicate-case scenario).
        if (result.mode === "skip-other-case-has-active-session") {
          console.warn(`🛑 Skipped auto-intake for ${created.id} — duplicate phone has active session on another case. ${result.error}`);
          await writeIntakeNote(
            `🛑 Auto-intake SKIPPED — duplicate phone detected.\n\n` +
            `${result.error || ""}\n\n` +
            `What happened: this client's phone number is already associated with another case that has an active or completed intake. To avoid confusing the client with a second intake, the bot did NOT start a new one for this case.\n\n` +
            `Staff options:\n` +
            `1. If this case is the correct one and you want to continue: handle the client conversation manually in the inbox.\n` +
            `2. If the OTHER case is stale and should be replaced: use the "Reset Intake" admin endpoint on it first, then click "Send Intake" here.\n` +
            `3. If this case is a duplicate created in error: delete it.`
          );
        } else {
          console.log(`📱 Auto-started WhatsApp intake for ${created.client} (${created.id}) — mode=${result.mode || "?"}`);
          await writeIntakeNote(`✅ Auto-intake started (mode: ${result.mode || "?"})${result.skippedCount ? ` · ${result.skippedCount} questions pre-filled from passport/case data` : ""}`);
        }
      } else {
        console.error(`Auto WA intake failed for ${created.id}: ${result.error}`);
        await writeIntakeNote(`⚠️ Auto-intake FAILED: ${result.error || "unknown error"}\n\nStaff: send a manual greeting from the case (👋 Send Greeting button), or click Send Intake to retry.`);
      }
    } else if (!phone) {
      console.log(`⏭️  Skipped WA intake for ${created.id}: no phone number`);
      await writeIntakeNote(`⏭️ Auto-intake skipped: case has no phone number (leadPhone is empty).\n\nStaff: add a phone number to the case, then click Send Intake.`);
    } else if (shouldSkip) {
      console.log(`⏭️  Skipped WA intake for ${created.id}: formType "${created.formType}" is in manual-handling list`);
      await writeIntakeNote(`⏭️ Auto-intake skipped: formType "${created.formType}" is in the manual-handling list (advisory cases — Newton doesn't file an application). No bot intake will run for this case.`);
    }
  } catch (e) {
    // Top-level catch: auto-intake should NEVER block case creation. Log
    // the actual error so staff can diagnose, and try to leave a note on
    // the case if possible (best-effort — case might already be saved).
    const errMsg = (e as Error).message;
    console.error(`Auto WA intake failed (top-level catch): ${errMsg}`);
    try {
      const { addMessage } = await import("@/lib/store");
      await addMessage({
        companyId: created.companyId,
        caseId: created.id,
        senderType: "ai",
        senderName: "Auto-Intake",
        text: `❌ Auto-intake CRASHED: ${errMsg}\n\nStaff: send a manual greeting, or click Send Intake to retry. Engineering: check Railway logs around case creation timestamp.`,
      });
    } catch { /* ignore — we did our best */ }
  }

  return NextResponse.json({ case: created, drive }, { status: 201 });
}
