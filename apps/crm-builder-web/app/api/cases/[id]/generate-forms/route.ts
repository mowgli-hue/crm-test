import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase, addDocument, updateCaseLinks } from "@/lib/store";
import { mapIntakeToForm } from "@/lib/intake-to-form-mappers";
import { parseIntakeWithAI, mergeAIIntoFormData } from "@/lib/intake-ai-parser";
import { uploadFileToDriveFolder, getOrCreateDriveSubfolder } from "@/lib/google-drive";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const isSystemCall = isValidSystemToken(body.systemToken);
    if (!isSystemCall) {
      const user = await getCurrentUserFromRequest(request);
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const companyId = process.env.DEFAULT_COMPANY_ID || "newton";
    const caseItem = await getCase(companyId, params.id);
    if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

    const intake = (caseItem.pgwpIntake as Record<string, unknown>) || {};
    const formType = caseItem.formType || "PGWP";
    const clientName = (caseItem.client as string) || "Client";

    // Step 1: Run regex mapper (always, never fails) — produces a baseline form data object
    const regexMapped = mapIntakeToForm(intake, formType);

    // Step 2: Run AI parser in parallel for the messy fields. If body has skipAI=true,
    //   skip this step (used by the review UI when user has already verified the data).
    //   AI failure is non-fatal — falls back to regex output.
    let clientData = regexMapped;
    let aiStatus: { used: boolean; error?: string } = { used: false };
    if (!body.skipAI) {
      try {
        const ai = await parseIntakeWithAI(intake, formType);
        if (ai._ai_used) {
          clientData = mergeAIIntoFormData(regexMapped, ai);
          aiStatus = { used: true };
        } else {
          aiStatus = { used: false, error: ai._ai_error };
        }
      } catch (e) {
        aiStatus = { used: false, error: (e as Error).message };
      }
    }

    // Step 3: If body has overrides, apply them last (these come from the review UI's edits)
    if (body.overrides && typeof body.overrides === "object") {
      Object.assign(clientData, body.overrides);
    }

    // Step 4: If body.previewOnly = true, return the parsed data WITHOUT generating PDF.
    //   This is what the review UI uses to show staff what's about to go into the form.
    if (body.previewOnly) {
      return NextResponse.json({
        ok: true,
        previewOnly: true,
        clientData,
        aiStatus,
        formType,
        clientName,
      });
    }

    const ft = formType.toLowerCase();

    let formId = "imm5710"; let formLabel = "IMM5710E";
    if (ft.includes("visitor visa") || ft.includes("trv")) { formId = "imm5257"; formLabel = "IMM5257E"; }
    else if (ft.includes("visitor record")) { formId = "imm5708"; formLabel = "IMM5708E"; }
    else if (ft.includes("study permit")) { formId = "imm5709"; formLabel = "IMM5709E"; }

    const pdfServiceUrl = process.env.PDF_SERVICE_URL || "https://crm-test-production-b755.up.railway.app";
    const pdfRes = await fetch(`${pdfServiceUrl}/fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId, data: clientData }),
    });

    if (!pdfRes.ok) {
      const err = await pdfRes.json().catch(() => ({}));
      return NextResponse.json({ ok: false, error: err.error || "PDF service failed" });
    }

    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    const clientNameClean = clientName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
    const fileName = `${clientNameClean} - ${formLabel}.pdf`;
    const errors: string[] = [];

    let folderId: string | undefined;
    const appFormsLink = caseItem.applicationFormsLink;
    if (appFormsLink) { const m = appFormsLink.match(/\/folders\/([-\w]{25,})/); if (m) folderId = m[1]; }
    if (!folderId) {
      const docsLink = caseItem.docsUploadLink;
      if (docsLink) {
        const m = docsLink.match(/\/folders\/([-\w]{25,})/);
        if (m) {
          const sub = await getOrCreateDriveSubfolder(m[1], "Application Forms");
          folderId = sub.id;
          await updateCaseLinks(companyId, params.id, { applicationFormsLink: sub.webViewLink });
        }
      }
    }

    if (!folderId && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
      try {
        const { createCaseDriveStructure, buildCaseFolderNameWithApp } = await import("@/lib/google-drive");
        const structure = await createCaseDriveStructure(
          process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
          // Case id keeps the folder unique per case (avoids cross-case reuse).
          buildCaseFolderNameWithApp(params.id, clientName || "", formType || "")
        );
        folderId = structure.subfolders.applicationForms.id;
        await updateCaseLinks(companyId, params.id, {
          docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
          applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
          submittedFolderLink: structure.subfolders.submitted.webViewLink,
          correspondenceFolderLink: structure.subfolders.correspondence.webViewLink,
        });
        console.log(`📁 Auto-created Drive folders for ${clientName}`);
      } catch(e) { console.error("Auto Drive folder creation failed:", e); }
    }

    if (!folderId) {
      errors.push("no Drive folder — open case and set up Drive folders first");
    } else {
      const driveFile = await uploadFileToDriveFolder({ folderId, fileName, fileBuffer: buffer, mimeType: "application/pdf" });
      await addDocument({ companyId, caseId: params.id, name: fileName, category: "form", uploadedBy: "AI Autofill", status: "generated", link: driveFile.webViewLink });
      console.log(`📁 Uploaded to Drive: ${driveFile.webViewLink}`);
    }

    return NextResponse.json({ ok: true, generated: [formId], errors });
  } catch (e) {
    console.error("generate-forms error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
