// app/api/cases/[id]/fill-forms/route.ts
//
// Fill the IRCC XFA forms a case needs from its intake data, save them to the
// case's Drive folder, and register them as documents. DRAFTS for staff to
// verify + sign — never submitted.
//
//   POST            → fill every mappable required form for this case
//   POST {only:[…]} → fill just the named forms (e.g. ["imm5710"])
//
// Auth: staff (with access to the case) OR an internal systemToken.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { canStaffAccessCase } from "@/lib/rbac";
import { getCase, addDocument, updateCaseLinks } from "@/lib/store";
import { getRequiredForms } from "@/lib/application-forms";
import { buildFormData, fillFormViaService, MAPPABLE_FORMS } from "@/lib/form-fill";
import { extractDriveFolderId, uploadFileToDriveFolder, createCaseDriveStructure } from "@/lib/google-drive";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

export const runtime = "nodejs";

function splitClient(name: string) {
  const p = String(name || "Client").trim().split(/\s+/).filter(Boolean);
  return p.length <= 1 ? { first: p[0] || "Client", last: "" } : { first: p.slice(0, -1).join(" "), last: p[p.length - 1] };
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({})) as { systemToken?: string; only?: string[] };
  const isSystem = isValidSystemToken(body?.systemToken);

  const companyId = process.env.DEFAULT_COMPANY_ID || "newton";
  let actor = "system";
  if (!isSystem) {
    const user = await getCurrentUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    actor = user.name || user.id;
  }

  const caseItem = await getCase(companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  if (!isSystem) {
    const user = await getCurrentUserFromRequest(request);
    if (user && user.userType === "staff" && !canStaffAccessCase(user.role, user.name, caseItem.assignedTo)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Resolve a Drive folder for the forms (the case's application-forms folder,
  // else its docs folder, else create the structure).
  let folderId =
    extractDriveFolderId(String((caseItem as any).applicationFormsLink || "")) ||
    extractDriveFolderId(String((caseItem as any).docsUploadLink || ""));
  const rootId = extractDriveFolderId(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "");
  if (folderId && rootId && folderId === rootId) folderId = null; // never the shared root
  if (!folderId && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
    try {
      const { first, last } = splitClient(String((caseItem as any).client));
      const structure = await createCaseDriveStructure(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID, `${first} ${last} (${caseItem.id})`);
      folderId = structure.subfolders.applicationForms.id;
      await updateCaseLinks(companyId, caseItem.id, {
        applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
        docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
        submittedFolderLink: structure.subfolders.submitted.webViewLink,
        correspondenceFolderLink: structure.subfolders.correspondence.webViewLink,
      });
    } catch (e) {
      return NextResponse.json({ error: `Could not set up a Drive folder for forms: ${(e as Error).message}` }, { status: 500 });
    }
  }
  if (!folderId) return NextResponse.json({ error: "No Drive folder available for this case." }, { status: 400 });

  const { first, last } = splitClient(String((caseItem as any).client));
  const required = getRequiredForms(String((caseItem as any).formType || ""));
  const want = (body?.only && body.only.length) ? new Set(body.only.map((x) => x.toLowerCase())) : null;

  const filled: Array<{ form: string; link: string }> = [];
  const skipped: Array<{ form: string; reason: string }> = [];

  for (const f of required) {
    const formId = f.id.toLowerCase(); // "IMM5710" → "imm5710"
    if (f.online) { skipped.push({ form: f.id, reason: "online portal — no PDF to fill" }); continue; }
    if (want && !want.has(formId)) continue;
    if (!MAPPABLE_FORMS.has(formId)) { skipped.push({ form: f.id, reason: "mapper not built yet — fill manually" }); continue; }

    try {
      const data = buildFormData(formId, caseItem) || {};
      const bytes = await fillFormViaService(formId, data);
      const fileName = `${f.id}e_${first}_${last} (DRAFT).pdf`.replace(/\s+/g, "_");
      const up = await uploadFileToDriveFolder({ folderId, fileName, fileBuffer: bytes, mimeType: "application/pdf" });
      await addDocument({
        companyId, caseId: caseItem.id, name: fileName, category: "general",
        status: "received", link: up.webViewLink || "",
        sourceMsgId: `form-${formId}`, // one record per form per case (idempotent)
      });
      filled.push({ form: f.id, link: up.webViewLink || "" });
    } catch (e) {
      skipped.push({ form: f.id, reason: (e as Error).message.slice(0, 140) });
    }
  }

  console.log(`[fill-forms] ${actor} filled ${filled.length} form(s) for ${caseItem.id} (${filled.map((x) => x.form).join(", ") || "none"})`);
  return NextResponse.json({
    ok: true,
    caseId: caseItem.id,
    filled,
    skipped,
    note: "Drafts only — staff must verify every field and sign. Not submitted to IRCC.",
  });
}
