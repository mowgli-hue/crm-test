import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { SUBMITTED_APPS } from "@/lib/submitted-apps";
import {
  addDocument,
  addLegacyResult,
  getCase,
  listLegacyResults,
  markLegacyResultInformed,
  resolveCaseDriveRootLink,
  updateCaseLinks
} from "@/lib/store";
import {
  buildCaseFolderNameWithApp,
  createCaseDriveStructure,
  extractDriveFolderId,
  getOrCreateDriveSubfolder,
  uploadFileToDriveFolder
} from "@/lib/google-drive";
import {
  buildS3ObjectKey,
  fromS3StoredLink,
  getSignedDownloadUrl,
  isS3StorageEnabled,
  isS3StoredLink,
  putObjectToS3,
  toS3StoredLink
} from "@/lib/object-storage";

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(0, 120) || "result.pdf";
}

function isPdfFile(file: File): boolean {
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  return mime === "application/pdf" || name.endsWith(".pdf");
}

async function ensureCaseDriveFolders(companyId: string, caseId: string) {
  const caseItem = await getCase(companyId, caseId);
  if (!caseItem) return null;
  if (
    caseItem.applicationFormsLink &&
    caseItem.submittedFolderLink &&
    caseItem.correspondenceFolderLink &&
    caseItem.docsUploadLink
  ) {
    return caseItem;
  }
  const choice = await resolveCaseDriveRootLink(companyId, caseId);
  const rootId = extractDriveFolderId(String(choice.link || "").trim());
  if (!rootId) return caseItem;
  const structure = await createCaseDriveStructure(
    rootId,
    buildCaseFolderNameWithApp(caseItem.id, caseItem.client, caseItem.formType)
  );
  await updateCaseLinks(companyId, caseId, {
    docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
    applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
    submittedFolderLink: structure.subfolders.submitted.webViewLink,
    correspondenceFolderLink: structure.subfolders.correspondence.webViewLink
  });
  return (await getCase(companyId, caseId)) || caseItem;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" && user.role === "Client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = user.companyId;
  const items = await listLegacyResults(companyId);
  const resolved = await Promise.all(
    items.map(async (item) => {
      if (!item.fileLink || !isS3StoredLink(item.fileLink)) return item;
      const key = fromS3StoredLink(item.fileLink);
      if (!key) return item;
      try {
        const signed = await getSignedDownloadUrl({ key, expiresInSeconds: 300 });
        return { ...item, fileLink: signed };
      } catch {
        return item;
      }
    })
  );
  return NextResponse.json({ items: resolved });
}

export async function POST(request: NextRequest) {
  // Allow IRCC scanner script via API key
  const irccApiKey = request.headers.get("x-ircc-api-key");
  const validApiKey = process.env.IRCC_SCANNER_API_KEY || "newton-ircc-2024";
  const isScriptUpload = irccApiKey === validApiKey;
  let user: Awaited<ReturnType<typeof getCurrentUserFromRequest>> = null;

  if (!isScriptUpload) {
    user = await getCurrentUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.userType !== "staff" && user.role === "Client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // For script uploads, use default company
  const companyId = user?.companyId || process.env.DEFAULT_COMPANY_ID || "newton";
  const actorId = user?.id || "ircc-scanner";
  const actorName = user?.name || "IRCC Scanner";

  const contentType = request.headers.get("content-type") || "";
  let clientName = "";
  let phone = "";
  let applicationNumber = "";
  let resultDate = "";
  let entryType: "result" | "submission" = "result";
  let outcome = "other";
  let notes = "";
  let selectedCaseId = "";
  let fileName = "";
  let fileLink = "";
  let uploadedBuffer: Buffer | null = null;
  let uploadedMimeType = "application/octet-stream";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    clientName = String(formData.get("clientName") || "").trim();
    phone = String(formData.get("phone") || "").trim();
    applicationNumber = String(formData.get("applicationNumber") || "").trim();
    resultDate = String(formData.get("resultDate") || "").trim();
    const rawEntryType = String(formData.get("entryType") || "").trim().toLowerCase();
    entryType = rawEntryType === "submission" ? "submission" : "result";
    outcome = String(formData.get("outcome") || "other").trim().toLowerCase();
    notes = String(formData.get("notes") || "").trim();
    selectedCaseId = String(formData.get("selectedCaseId") || "").trim();
    const maybeFile = formData.get("file");

    if (maybeFile instanceof File && maybeFile.size > 0) {
      if (!isPdfFile(maybeFile)) {
        return NextResponse.json(
          { error: "Only PDF files are allowed for results/submission upload." },
          { status: 400 }
        );
      }
      const buffer = Buffer.from(await maybeFile.arrayBuffer());
      uploadedBuffer = buffer;
      uploadedMimeType = "application/pdf";
      const rawName = String(maybeFile.name || "result.pdf");
      const normalizedName = rawName.toLowerCase().endsWith(".pdf") ? rawName : `${rawName}.pdf`;
      const safe = `${Date.now()}_${sanitizeFilename(normalizedName)}`;
      fileName = safe;
      if (isS3StorageEnabled()) {
        const objectKey = buildS3ObjectKey({
          companyId: companyId,
          caseId: "legacy-results",
          fileName: safe
        });
        await putObjectToS3({
          key: objectKey,
          content: buffer,
          contentType: uploadedMimeType
        });
        fileLink = toS3StoredLink(objectKey);
      } else {
        const dir = join(process.cwd(), "public", "uploads", "legacy-results");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, safe), buffer);
        fileLink = `/uploads/legacy-results/${safe}`;
      }
    }
  } else {
    const body = await request.json().catch(() => ({}));
    clientName = String(body.clientName || "").trim();
    phone = String(body.phone || "").trim();
    applicationNumber = String(body.applicationNumber || "").trim();
    resultDate = String(body.resultDate || "").trim();
    const rawEntryType = String(body.entryType || "").trim().toLowerCase();
    entryType = rawEntryType === "submission" ? "submission" : "result";
    outcome = String(body.outcome || "other").trim().toLowerCase();
    notes = String(body.notes || "").trim();
    selectedCaseId = String(body.selectedCaseId || "").trim();
    fileName = String(body.fileName || "").trim();
    fileLink = String(body.fileLink || "").trim();
  }

  if (!applicationNumber) {
    return NextResponse.json({ error: "applicationNumber is required" }, { status: 400 });
  }
  if (!clientName) clientName = "Legacy Client";
  if (!["approved", "refused", "request_letter", "other"].includes(outcome)) {
    return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
  }

  // Auto-lookup phone from submitted apps sheet if not provided
  if (!phone && applicationNumber) {
    const normApp = applicationNumber.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const match = SUBMITTED_APPS.find(a => a.appNum === normApp);
    if (match) {
      if (match.phone) phone = match.phone;
      if (!clientName || clientName === "Legacy Client") clientName = match.name;
    }
  }
  // Also try matching by name
  if (!phone && clientName && clientName !== "Legacy Client") {
    const nameLower = clientName.toLowerCase().trim();
    const nameMatch = SUBMITTED_APPS.find(a =>
      a.name.toLowerCase().trim() === nameLower ||
      a.name.toLowerCase().split(" ")[0] === nameLower.split(" ")[0]
    );
    if (nameMatch?.phone) phone = nameMatch.phone;
  }

  const item = await addLegacyResult({
    companyId: companyId,
    entryType,
    clientName,
    phone,
    applicationNumber,
    resultDate: resultDate || undefined,
    outcome: outcome as "approved" | "refused" | "request_letter" | "other",
    notes,
    fileName: fileName || undefined,
    fileLink: fileLink || undefined,
    forceMatchedCaseId: selectedCaseId || undefined,
    createdByUserId: actorId,
    createdByName: actorName
  });
  if (entryType === "result" && item.autoCategory === "new" && item.matchedCaseId && item.fileLink) {
    await addDocument({
      companyId: companyId,
      caseId: item.matchedCaseId,
      name: item.fileName || `Result ${item.applicationNumber}`,
      category: "result",
      status: "received",
      link: item.fileLink
    });
    if (uploadedBuffer) {
      try {
        const caseWithFolders = await ensureCaseDriveFolders(companyId, item.matchedCaseId);
        const submittedFolderId = extractDriveFolderId(
          String(caseWithFolders?.submittedFolderLink || "")
        );
        if (submittedFolderId) {
          const resultsFolder = await getOrCreateDriveSubfolder(
            submittedFolderId,
            entryType === "submission" ? "Submission" : "Results"
          );
          await uploadFileToDriveFolder({
            folderId: resultsFolder.id,
            fileName: item.fileName || `Result_${item.applicationNumber}.pdf`,
            fileBuffer: uploadedBuffer,
            mimeType: uploadedMimeType
          });
        }
      } catch {
        // Keep primary stored file available even if Drive mirror fails.
      }
    }
  }
  // ── Auto-notification for IRCC results ──
  //
  // ⚠️ IMPORTANT — this used to auto-send WhatsApp messages to clients
  // for ALL outcomes including refusals and request letters. That caused
  // a real incident (May 2026, CASE-1415 sukhmandeep): scheduled Drive
  // crawler detected her IRCC request letter, the endpoint auto-fired
  // "IRCC has sent a request letter…Newton Immigration will review and
  // contact you" — but no staff member was actually alerted. The client
  // saw the bot's confident reply and assumed Newton was on it. Request
  // letters have a 30-day IRCC deadline; a missed one can refuse the
  // application.
  //
  // New policy:
  //   - Approvals: still auto-send (low risk, client-positive news,
  //     they're going to be happy regardless of timing)
  //   - Refusals: NEVER auto-send to client. Email Sandhu + assignee
  //     immediately (urgent — appeals/restorations have hard deadlines).
  //   - Request letters: NEVER auto-send to client. Email Sandhu +
  //     assignee immediately (urgent — 30-day IRCC deadline).
  //   - Other: skip entirely (matches existing behavior).
  if (entryType === "result" && item.matchedCaseId && item.outcome !== "other") {
    try {
      const matchedCase = await getCase(companyId, item.matchedCaseId);

      // ── APPROVED: auto-send WhatsApp (low risk, positive news) ──
      if (item.outcome === "approved") {
        const clientPhone = matchedCase?.leadPhone || item.phone;
        if (clientPhone && clientPhone.replace(/\D/g, "").length >= 10) {
          const { sendWhatsAppText } = await import("@/lib/whatsapp");
          const clientName = matchedCase?.client || item.clientName || "Client";
          const firstName = clientName.split(" ")[0];
          const msg = `🎉 Great news ${firstName}! Your ${matchedCase?.formType || "application"} has been *APPROVED* by IRCC. Newton Immigration will contact you shortly with next steps.`;
          await sendWhatsAppText(clientPhone.replace(/\D/g, ""), msg).catch(() => {});
        }
      }

      // ── REFUSAL or REQUEST LETTER: alert staff, do NOT message client ──
      // These require human judgement + have hard deadlines. The bot
      // should never beat a human to the client. Staff handles the
      // outreach themselves once they've reviewed the letter.
      else if (item.outcome === "refused" || item.outcome === "request_letter") {
        try {
          const { sendEmail, isEmailConfigured } = await import("@/lib/email");
          if (isEmailConfigured()) {
            const { listUsers } = await import("@/lib/store");
            const users = await listUsers(companyId);
            const assignedToKey = String(matchedCase?.assignedTo || "").toLowerCase().trim();
            const recipients: string[] = [];
            // Always alert Sandhu (RCIC) on refusals + request letters
            const sandhu = users.find((u) =>
              u.userType === "staff" &&
              String(u.name || "").toLowerCase().includes("sandhu")
            );
            if (sandhu?.email) recipients.push(sandhu.email);
            // Also alert the case's assignee if different from Sandhu
            const assignee = users.find((u) =>
              u.userType === "staff" &&
              String(u.name || "").toLowerCase().trim() === assignedToKey
            );
            if (assignee?.email && !recipients.includes(assignee.email)) {
              recipients.push(assignee.email);
            }

            if (recipients.length > 0) {
              const baseUrl =
                process.env.PUBLIC_APP_URL ||
                process.env.NEXT_PUBLIC_APP_URL ||
                "https://crm.newtonimmigration.com";
              const caseUrl = `${baseUrl}/?case=${encodeURIComponent(item.matchedCaseId)}`;
              const clientName = matchedCase?.client || item.clientName || "Client";
              const formType = matchedCase?.formType || "application";
              const isRefusal = item.outcome === "refused";
              const headline = isRefusal
                ? `🚨 IRCC REFUSAL — ${clientName}`
                : `📨 IRCC REQUEST LETTER — ${clientName}`;
              const urgency = isRefusal
                ? "Refusals have appeal/reconsideration deadlines (typically 60-90 days for judicial review)."
                : "IRCC request letters typically require a response within 30 days.";
              const subject = `[Newton CRM] ${headline} — IMMEDIATE ACTION REQUIRED`;
              const html = `
<div style="background:#dc2626;padding:18px 24px;border-radius:8px 8px 0 0;">
  <span style="color:white;font-size:18px;font-weight:bold;letter-spacing:0.5px;">${isRefusal ? "🚨 IRCC REFUSAL" : "📨 IRCC REQUEST LETTER"}</span>
</div>
<div style="background:#fef2f2;padding:24px;border-radius:0 0 8px 8px;border:1px solid #fecaca;border-top:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#0f172a;line-height:1.6;">
  <h2 style="margin:0 0 12px;font-size:16px;color:#7f1d1d;">${headline}</h2>
  <p style="margin:0 0 12px;font-weight:600;">
    ${urgency}
  </p>
  <table style="width:100%;border-collapse:collapse;background:white;border:1px solid #fecaca;border-radius:6px;margin:16px 0;">
    <tr><td style="padding:8px 12px;border-bottom:1px solid #fecaca;font-weight:600;width:40%;">Client</td><td style="padding:8px 12px;border-bottom:1px solid #fecaca;">${clientName}</td></tr>
    <tr><td style="padding:8px 12px;border-bottom:1px solid #fecaca;font-weight:600;">Application Type</td><td style="padding:8px 12px;border-bottom:1px solid #fecaca;">${formType}</td></tr>
    <tr><td style="padding:8px 12px;border-bottom:1px solid #fecaca;font-weight:600;">Application Number</td><td style="padding:8px 12px;border-bottom:1px solid #fecaca;">${item.applicationNumber || "—"}</td></tr>
    <tr><td style="padding:8px 12px;border-bottom:1px solid #fecaca;font-weight:600;">Case ID</td><td style="padding:8px 12px;border-bottom:1px solid #fecaca;"><code>${item.matchedCaseId}</code></td></tr>
    <tr><td style="padding:8px 12px;font-weight:600;">Assigned To</td><td style="padding:8px 12px;">${matchedCase?.assignedTo || "Unassigned"}</td></tr>
  </table>
  <p style="margin:0 0 16px;color:#7f1d1d;font-weight:600;">
    ⚠️ The client has NOT been notified by the bot. Please review the letter, prepare a response strategy, and contact the client yourself.
  </p>
  <p style="margin:0;">
    <a href="${caseUrl}" style="display:inline-block;background:#dc2626;color:white;padding:12px 22px;border-radius:6px;font-weight:600;text-decoration:none;font-size:14px;">
      Open Case in CRM →
    </a>
  </p>
  <hr style="border:none;border-top:1px solid #fecaca;margin:24px 0 12px;" />
  <p style="font-size:11px;color:#94a3b8;margin:0;">
    This urgent alert was triggered automatically from a scheduled IRCC results scan.<br/>
    Newton Immigration Inc. · 8327 120 Street, Delta, BC · RCIC #R705964
  </p>
</div>`;
              await sendEmail({ to: recipients, subject, html });
              console.log(`📧 ${isRefusal ? "Refusal" : "Request letter"} alert emailed to: ${recipients.join(", ")}`);
            } else {
              console.warn(`⚠️ ${item.outcome} for ${item.matchedCaseId} — no staff emails on file to alert`);
            }
          } else {
            console.warn(`⚠️ Email not configured — staff cannot be alerted about ${item.outcome} for ${item.matchedCaseId}`);
          }
        } catch (e) {
          console.error("Staff alert email failed:", e);
        }
      }
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" && user.role === "Client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = user.companyId;
  const body = await request.json().catch(() => ({}));
  const resultId = String(body.resultId || "").trim();
  if (!resultId) {
    return NextResponse.json({ error: "resultId is required" }, { status: 400 });
  }
  const item = await markLegacyResultInformed({
    companyId: companyId,
    resultId,
    informedByName: user.name
  });
  if (!item) return NextResponse.json({ error: "Result not found" }, { status: 404 });
  return NextResponse.json({ item });
}
