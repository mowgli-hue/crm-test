import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { stageOrder } from "@/lib/data";
import { canStaffAccessCase } from "@/lib/rbac";
import { buildCaseFolderNameWithApp, createCaseDriveStructure, extractDriveFolderId, syncCaseToUnderReviewSheet } from "@/lib/google-drive";
import { addAuditLog, deleteCase, getCase, resolveCaseDriveRootLink, updateCaseLinks, updateCaseProcessing, updateCaseProfile, updateCaseStage } from "@/lib/store";
import { boundedText } from "@/lib/validation";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isStaffLike = user.userType === "staff" || user.role !== "Client";
  if (!isStaffLike) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const currentCase = await getCase(user.companyId, params.id);
  if (!currentCase) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  if (!canStaffAccessCase(user.role, user.name, currentCase.assignedTo)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Profile-edit branch ──
  // If the body contains any of the original case-creation fields (client name, formType, leadPhone, etc.),
  // route to updateCaseProfile. Restricted to Marketing + Admin (creators-only rule).
  const isProfileEdit =
    body?.client !== undefined ||
    body?.leadPhone !== undefined ||
    body?.leadEmail !== undefined ||
    body?.totalCharges !== undefined ||
    body?.irccFees !== undefined ||
    body?.irccFeePayer !== undefined ||
    body?.familyMembers !== undefined ||
    body?.familyTotalCharges !== undefined ||
    body?.additionalNotes !== undefined ||
    body?.isUrgent !== undefined ||
    body?.dueInDays !== undefined ||
    body?.permitExpiryDate !== undefined ||
    // formType alone is workflow OR profile — only treat as profile if not paired with workflow fields
    (body?.formType !== undefined && body?.processingStatus === undefined && body?.applicationNumber === undefined);

  if (isProfileEdit) {
    if (user.role !== "Admin" && user.role !== "Marketing") {
      return NextResponse.json({ error: "Only Marketing and Admin can edit case details." }, { status: 403 });
    }
    const totalCharges = body?.totalCharges !== undefined ? Number(body.totalCharges) : undefined;
    const irccFees = body?.irccFees !== undefined ? Number(body.irccFees) : undefined;
    const familyTotalCharges = body?.familyTotalCharges !== undefined ? Number(body.familyTotalCharges) : undefined;
    const dueInDays = body?.dueInDays !== undefined ? Number(body.dueInDays) : undefined;
    if (totalCharges !== undefined && (!Number.isFinite(totalCharges) || totalCharges < 0)) {
      return NextResponse.json({ error: "Invalid totalCharges" }, { status: 400 });
    }
    if (irccFees !== undefined && (!Number.isFinite(irccFees) || irccFees < 0)) {
      return NextResponse.json({ error: "Invalid irccFees" }, { status: 400 });
    }
    const profilePatch: any = {};
    if (body?.client !== undefined) profilePatch.client = String(body.client).trim();
    if (body?.formType !== undefined) profilePatch.formType = String(body.formType).trim();
    if (body?.leadPhone !== undefined) profilePatch.leadPhone = String(body.leadPhone).trim();
    if (body?.leadEmail !== undefined) profilePatch.leadEmail = String(body.leadEmail).trim();
    if (totalCharges !== undefined) profilePatch.totalCharges = totalCharges;
    if (irccFees !== undefined) profilePatch.irccFees = irccFees;
    if (body?.irccFeePayer !== undefined) profilePatch.irccFeePayer = body.irccFeePayer === "sir_card" ? "sir_card" : "client_card";
    if (body?.familyMembers !== undefined) profilePatch.familyMembers = String(body.familyMembers || "");
    if (familyTotalCharges !== undefined) profilePatch.familyTotalCharges = familyTotalCharges;
    if (body?.assignedTo !== undefined) profilePatch.assignedTo = String(body.assignedTo);
    if (body?.additionalNotes !== undefined) profilePatch.additionalNotes = boundedText(String(body.additionalNotes), 2000);
    if (body?.isUrgent !== undefined) profilePatch.isUrgent = Boolean(body.isUrgent);
    if (dueInDays !== undefined) profilePatch.dueInDays = dueInDays;
    if (body?.permitExpiryDate !== undefined) profilePatch.permitExpiryDate = String(body.permitExpiryDate);

    const updated = await updateCaseProfile(user.companyId, params.id, profilePatch);
    if (!updated) return NextResponse.json({ error: "Could not update" }, { status: 500 });

    await addAuditLog({
      companyId: user.companyId,
      actorUserId: user.id,
      actorName: user.name,
      action: "case.update.profile",
      resourceType: "case",
      resourceId: updated.id,
      metadata: { fieldsChanged: Object.keys(profilePatch) }
    });

    return NextResponse.json({ case: updated });
  }

  const stage = String(body.stage ?? "");
  const assignedTo = body?.assignedTo !== undefined ? String(body.assignedTo) : undefined;
  const processingStatusRaw = body?.processingStatus !== undefined ? String(body.processingStatus) : undefined;
  const processingStatus = (
    processingStatusRaw &&
    ["docs_pending", "under_review", "submitted", "other"].includes(processingStatusRaw)
      ? processingStatusRaw
      : undefined
  ) as "docs_pending" | "under_review" | "submitted" | "other" | undefined;
  const processingStatusOther =
    body?.processingStatusOther !== undefined ? boundedText(body.processingStatusOther, 200) : undefined;
  const paymentMethodRaw = body?.paymentMethod !== undefined ? String(body.paymentMethod).trim().toLowerCase() : undefined;
  const paymentMethod = (
    paymentMethodRaw &&
    ["interac", "cash", "card", "bank_transfer", "other"].includes(paymentMethodRaw)
      ? paymentMethodRaw
      : undefined
  ) as "interac" | "cash" | "card" | "bank_transfer" | "other" | undefined;
  const applicationNumber =
    body?.applicationNumber !== undefined ? boundedText(body.applicationNumber, 120) : undefined;
  const submittedAt =
    body?.submittedAt !== undefined ? String(body.submittedAt) : undefined;
  const submissionDocumentUploadedAt =
    body?.submissionDocumentUploadedAt !== undefined ? String(body.submissionDocumentUploadedAt) : undefined;
  const finalOutcomeRaw = body?.finalOutcome !== undefined ? String(body.finalOutcome).trim().toLowerCase() : undefined;
  const finalOutcome = (
    finalOutcomeRaw &&
    ["approved", "refused", "request_letter", "withdrawn"].includes(finalOutcomeRaw)
      ? finalOutcomeRaw
      : undefined
  ) as "approved" | "refused" | "request_letter" | "withdrawn" | undefined;
  const decisionDate =
    body?.decisionDate !== undefined ? String(body.decisionDate) : undefined;
  const remarks = body?.remarks !== undefined ? boundedText(body.remarks, 1000) : undefined;
  const reviewedBy = body?.reviewedBy !== undefined ? String(body.reviewedBy) : undefined;
  const reviewNotes = body?.reviewNotes !== undefined ? boundedText(body.reviewNotes, 2000) : undefined;
  const reviewStatus = body?.reviewStatus !== undefined ? String(body.reviewStatus) : undefined;

  if (
    assignedTo !== undefined ||
    processingStatus !== undefined ||
    processingStatusOther !== undefined ||
    paymentMethod !== undefined ||
    applicationNumber !== undefined ||
    submittedAt !== undefined ||
    submissionDocumentUploadedAt !== undefined ||
    finalOutcome !== undefined ||
    decisionDate !== undefined ||
    remarks !== undefined ||
    reviewedBy !== undefined ||
    reviewNotes !== undefined ||
    reviewStatus !== undefined
  ) {
    if (processingStatus === "submitted") {
      const safeAppNo = String(applicationNumber || currentCase.applicationNumber || "").trim();
      const safeSubmissionDocTs = String(submissionDocumentUploadedAt || currentCase.submissionDocumentUploadedAt || "").trim();
      if (!safeAppNo) {
        return NextResponse.json(
          { error: "Application number is required before marking submitted." },
          { status: 400 }
        );
      }
      if (!safeSubmissionDocTs) {
        return NextResponse.json(
          { error: "Submission document is required before marking submitted." },
          { status: 400 }
        );
      }
    }

    const updated = await updateCaseProcessing(user.companyId, params.id, {
      assignedTo,
      processingStatus,
      processingStatusOther,
      paymentMethod,
      applicationNumber,
      submittedAt,
      submissionDocumentUploadedAt,
      finalOutcome,
      decisionDate,
      remarks,
      reviewedBy,
      reviewNotes,
      reviewStatus
    } as any);
    if (!updated) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    await addAuditLog({
      companyId: user.companyId,
      actorUserId: user.id,
      actorName: user.name,
      action: "case.update.processing",
      resourceType: "case",
      resourceId: updated.id,
      metadata: {
        assignedTo: String(updated.assignedTo || ""),
        processingStatus: String(updated.processingStatus || "")
      }
    });
    // Notify when case is reassigned
    if (assignedTo && assignedTo !== (currentCase as any).assignedTo) {
      try {
        const { listUsers, addNotification } = await import("@/lib/store");
        const allUsers = await listUsers(user.companyId);
        const assignedUser = allUsers.find(u => u.name === assignedTo);
        if (assignedUser && assignedUser.id !== user.id) {
          await addNotification({
            companyId: user.companyId,
            userId: assignedUser.id,
            type: "ai_alert",
            message: `📌 You have been assigned to ${updated.client} (${updated.id} — ${updated.formType}) by ${user.name}`,
            caseId: updated.id,
          } as any);
        }
      } catch(e) { console.error("Assignment notification failed:", e); }
    }

    // Sync to Under Review sheet (non-fatal)
    syncCaseToUnderReviewSheet({
      client: updated.client,
      formType: updated.formType,
      assignedTo: updated.assignedTo,
      reviewedBy: (updated as any).reviewedBy,
      processingStatus: updated.processingStatus,
      reviewStatus: (updated as any).reviewStatus,
      reviewNotes: (updated as any).reviewNotes,
      applicationNumber: (updated as any).applicationNumber,
    }).catch(e => console.error("Sheet sync error:", e.message));
    let driveReroute: { updated: boolean; reason?: string; error?: string } = { updated: false };
    if (assignedTo !== undefined) {
      try {
        const root = await resolveCaseDriveRootLink(user.companyId, updated.id);
        const rootId = extractDriveFolderId(root.link || "");
        if (rootId) {
          const structure = await createCaseDriveStructure(
            rootId,
            buildCaseFolderNameWithApp(updated.id, updated.client, updated.formType)
          );
          const withDrive = await updateCaseLinks(user.companyId, updated.id, {
            docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
            applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
            submittedFolderLink: structure.subfolders.submitted.webViewLink,
            correspondenceFolderLink: structure.subfolders.correspondence.webViewLink
          });
          driveReroute = { updated: true, reason: root.source };
          return NextResponse.json({ case: withDrive ?? updated, driveReroute });
        }
        driveReroute = { updated: false, reason: "drive_root_missing" };
      } catch (error) {
        driveReroute = { updated: false, error: (error as Error).message };
      }
    }
    return NextResponse.json({ case: updated, driveReroute });
  }

  if (!stageOrder.includes(stage as (typeof stageOrder)[number])) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  const updated = await updateCaseStage(user.companyId, params.id, stage as (typeof stageOrder)[number]);
  if (!updated) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  await addAuditLog({
    companyId: user.companyId,
    actorUserId: user.id,
    actorName: user.name,
    action: "case.update.stage",
    resourceType: "case",
    resourceId: updated.id,
    metadata: { stage: updated.stage }
  });

  return NextResponse.json({ case: updated });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const found = await getCase(user.companyId, params.id);
  if (!found) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const isClientOnly = user.userType === "client" && user.role === "Client";
  if (isClientOnly && user.caseId !== found.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isClientOnly && !canStaffAccessCase(user.role, user.name, found.assignedTo)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ case: found });
}

// ─────────────────────────────────────────────────────────────────────
// DELETE — permanently remove a case + cascade-delete related data
//
// Admin-only. Use sparingly. Leaves Google Drive folder + WhatsApp inbox
// history INTACT (those are recoverable signals if a case was deleted by
// mistake) but removes the case row, all messages, tasks, and submissions.
//
// Audit log records who deleted what and when, so any complaint about a
// missing case can be traced back.
// ─────────────────────────────────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Admin-only — case deletion is destructive and should never be in the
  // hands of regular processing staff. Even if Marketing/Admin can edit,
  // only Admin can delete.
  if (user.role !== "Admin") {
    return NextResponse.json(
      { error: "Forbidden — only Admins can delete cases" },
      { status: 403 }
    );
  }

  // Look up first so we have details for the audit log even after delete
  const caseToDelete = await getCase(user.companyId, params.id);
  if (!caseToDelete) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  // Defensive: caller must include `confirm: true` in the request body. The
  // frontend modal sets this after a typed-name confirmation. Prevents an
  // accidental DELETE from a misbehaving script or curl mistake.
  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return NextResponse.json(
      {
        error: "Deletion requires explicit confirmation. Pass {\"confirm\": true} in the request body.",
      },
      { status: 400 }
    );
  }

  // ── Best-effort cleanup of marketing_leads pointer + case_notes (PG) ──
  // marketing_leads.converted_case_id: reset to NULL if it points at the
  //   case being deleted. Lead row itself is preserved for history.
  // case_notes: case notes live in a separate PG table, not the JSON
  //   store. Cascade them here.
  // Both wrapped in try/catch so a PG failure (e.g. missing DATABASE_URL,
  // table doesn't exist yet) doesn't block the case delete from completing.
  try {
    const phoneDigits = String(caseToDelete.leadPhone || "").replace(/\D/g, "");
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    if (phoneDigits) {
      await pool.query(
        `UPDATE marketing_leads SET converted_case_id = NULL, updated_at = NOW()
         WHERE phone = $1 AND converted_case_id = $2`,
        [phoneDigits, params.id]
      );
    }
    // Cascade case_notes
    await pool.query(
      `DELETE FROM case_notes WHERE case_id = $1 AND company_id = $2`,
      [params.id, user.companyId]
    );
    await pool.end();
  } catch (e) {
    // Non-fatal — proceed with deletion even if PG cleanup fails.
    console.warn(`PG cascade cleanup partial-fail for ${params.id}: ${(e as Error).message.slice(0, 100)}`);
  }

  // ── Perform the cascade delete ──
  const result = await deleteCase(user.companyId, params.id);
  if (!result.ok) {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  // ── Audit log ──
  // Captures: who deleted it, when, what was removed (counts), and the
  // case's identifying details so it can be referenced even after the
  // row is gone.
  try {
    await addAuditLog({
      companyId: user.companyId,
      actorUserId: user.id,
      actorName: user.name,
      action: "case_deleted",
      resourceType: "case",
      resourceId: params.id,
      metadata: {
        client: String(caseToDelete.client || ""),
        formType: String(caseToDelete.formType || ""),
        leadPhone: String(caseToDelete.leadPhone || ""),
        assignedTo: String(caseToDelete.assignedTo || ""),
        processingStatus: String(caseToDelete.processingStatus || ""),
        removedSummary: JSON.stringify(result.removed || {}),
      },
    });
  } catch (e) {
    // Audit failure is non-fatal — the delete already happened and we
    // don't want to roll back. Log to Railway so engineering can see.
    console.warn(`Audit log failed for case_deleted ${params.id}: ${(e as Error).message.slice(0, 100)}`);
  }

  return NextResponse.json({
    ok: true,
    deleted: params.id,
    removed: result.removed,
  });
}
