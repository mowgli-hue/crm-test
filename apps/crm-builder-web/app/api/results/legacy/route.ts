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
  // ── Auto-notification policy: ALL ALERTS GO TO STAFF, NEVER CLIENTS ──
  //
  // ⚠️ HISTORY: this code used to auto-send WhatsApp to clients on IRCC
  // outcomes. That caused two real incidents:
  //
  //   1. (May 2026) Sukhmandeep (CASE-1415) received an automated "IRCC
  //      has sent a request letter…Newton Immigration will review and
  //      contact you" message before any staff member knew about it.
  //      30-day IRCC deadline could have been missed silently.
  //
  //   2. (May 2026) Reasoning that even "approved" auto-sends are risky:
  //      wrong-client matches (auto-linker damage), outdated app numbers,
  //      misclassified outcomes, or duplicate scans could all cause the
  //      bot to congratulate a client for someone else's approval, or
  //      worse, congratulate a refused client.
  //
  // New policy (firm — do not loosen without owner sign-off):
  //   - The bot NEVER talks to clients about IRCC outcomes.
  //   - Every detected IRCC outcome triggers an email alert to Sandhu
  //     (RCIC) + the case's assignee.
  //   - Staff reviews the letter, verifies the match is correct, and
  //     contacts the client themselves — using their voice, their
  //     timing, with the right context.
  //   - The CRM's job is to surface, not to speak.
  //
  // The Wins Wall + Results dashboard already exist for staff-initiated
  // outreach (one-click Send to Client). That stays under human control.
  if (entryType === "result" && item.matchedCaseId && item.outcome !== "other") {
    try {
      const matchedCase = await getCase(companyId, item.matchedCaseId);
      const { sendEmail, isEmailConfigured } = await import("@/lib/email");
      if (!isEmailConfigured()) {
        console.warn(`⚠️ Email not configured — staff cannot be alerted about ${item.outcome} for ${item.matchedCaseId}`);
      } else {
        const { listUsers } = await import("@/lib/store");
        const users = await listUsers(companyId);
        const assignedToKey = String(matchedCase?.assignedTo || "").toLowerCase().trim();
        const recipients: string[] = [];
        // Always alert Sandhu (RCIC) for every IRCC outcome
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

          // Per-outcome framing — color, headline, urgency reminder
          let bannerColor = "#0B2F5C"; // default Newton navy
          let bannerBg = "#f8fafc";
          let bannerBorder = "#e2e8f0";
          let bannerTextColor = "#0f172a";
          let headline = "";
          let urgency = "";
          if (item.outcome === "approved") {
            bannerColor = "#059669"; // green
            bannerBg = "#f0fdf4";
            bannerBorder = "#bbf7d0";
            headline = `🎉 IRCC APPROVED — ${clientName}`;
            urgency = "Verify the match before contacting the client. Send the approval message manually from the Wins Wall when ready.";
          } else if (item.outcome === "refused") {
            bannerColor = "#dc2626"; // red
            bannerBg = "#fef2f2";
            bannerBorder = "#fecaca";
            bannerTextColor = "#7f1d1d";
            headline = `🚨 IRCC REFUSAL — ${clientName}`;
            urgency = "Refusals have appeal/reconsideration deadlines (typically 60-90 days for judicial review). Review the letter and call the client — do not send a written message first.";
          } else if (item.outcome === "request_letter") {
            bannerColor = "#dc2626"; // red
            bannerBg = "#fef2f2";
            bannerBorder = "#fecaca";
            bannerTextColor = "#7f1d1d";
            headline = `📨 IRCC REQUEST LETTER — ${clientName}`;
            urgency = "IRCC request letters typically require a response within 30 days. Review the specific request and contact the client to gather what's needed.";
          } else {
            // Unknown outcome — still alert, just less colored
            headline = `IRCC OUTCOME (${item.outcome}) — ${clientName}`;
            urgency = "Unknown outcome type detected — please review.";
          }

          const subject = `[Newton CRM] ${headline} — STAFF ACTION REQUIRED`;
          const html = `
<div style="background:${bannerColor};padding:18px 24px;border-radius:8px 8px 0 0;">
  <span style="color:white;font-size:18px;font-weight:bold;letter-spacing:0.5px;">${headline}</span>
</div>
<div style="background:${bannerBg};padding:24px;border-radius:0 0 8px 8px;border:1px solid ${bannerBorder};border-top:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:${bannerTextColor};line-height:1.6;">
  <p style="margin:0 0 12px;font-weight:600;">
    ${urgency}
  </p>
  <table style="width:100%;border-collapse:collapse;background:white;border:1px solid ${bannerBorder};border-radius:6px;margin:16px 0;">
    <tr><td style="padding:8px 12px;border-bottom:1px solid ${bannerBorder};font-weight:600;width:40%;">Client</td><td style="padding:8px 12px;border-bottom:1px solid ${bannerBorder};">${clientName}</td></tr>
    <tr><td style="padding:8px 12px;border-bottom:1px solid ${bannerBorder};font-weight:600;">Application Type</td><td style="padding:8px 12px;border-bottom:1px solid ${bannerBorder};">${formType}</td></tr>
    <tr><td style="padding:8px 12px;border-bottom:1px solid ${bannerBorder};font-weight:600;">Application Number</td><td style="padding:8px 12px;border-bottom:1px solid ${bannerBorder};">${item.applicationNumber || "—"}</td></tr>
    <tr><td style="padding:8px 12px;border-bottom:1px solid ${bannerBorder};font-weight:600;">Case ID</td><td style="padding:8px 12px;border-bottom:1px solid ${bannerBorder};"><code>${item.matchedCaseId}</code></td></tr>
    <tr><td style="padding:8px 12px;font-weight:600;">Assigned To</td><td style="padding:8px 12px;">${matchedCase?.assignedTo || "Unassigned"}</td></tr>
  </table>
  <p style="margin:0 0 16px;font-weight:600;">
    ⚠️ The client has NOT been notified by the system. Verify the case match is correct, then reach out to the client yourself.
  </p>
  <p style="margin:0;">
    <a href="${caseUrl}" style="display:inline-block;background:${bannerColor};color:white;padding:12px 22px;border-radius:6px;font-weight:600;text-decoration:none;font-size:14px;">
      Open Case in CRM →
    </a>
  </p>
  <hr style="border:none;border-top:1px solid ${bannerBorder};margin:24px 0 12px;" />
  <p style="font-size:11px;color:#94a3b8;margin:0;">
    Triggered automatically from a scheduled IRCC results scan.<br/>
    Newton Immigration Inc. · 8327 120 Street, Delta, BC · RCIC #R705964
  </p>
</div>`;
          await sendEmail({ to: recipients, subject, html });
          console.log(`📧 ${item.outcome} alert emailed to: ${recipients.join(", ")} for ${item.matchedCaseId}`);
        } else {
          console.warn(`⚠️ ${item.outcome} for ${item.matchedCaseId} — no staff emails on file to alert`);
        }
      }
    } catch (e) {
      console.error("Staff alert email failed:", e);
    }
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
