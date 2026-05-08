// ─────────────────────────────────────────────────────────────────────
// GET /api/cases/[id]/folder-diagnostic
//
// Diagnostic endpoint for "why is Scan Now showing N docs when I uploaded
// more than that?". Returns:
//   - The Drive folder ID + URL the case is linked to
//   - Every file in that folder
//   - For each file: whether it WOULD be scanned, skipped, or filtered
//   - Reason for skip if applicable
//
// Use this when:
//   - Scan Now reports lower count than expected
//   - Client uploaded docs but they're not appearing in Submission Package
//   - Need to confirm staff-uploaded docs are in the right folder
//
// Usage:
//   curl https://crm.newtonimmigration.com/api/cases/CASE-1400/folder-diagnostic
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth-session";
import { getCase } from "@/lib/cases-store";
import { listFilesInFolder, extractDriveFolderId } from "@/lib/google-drive";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const caseItem = await getCase(user.companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const docsLink = caseItem.docsUploadLink || "";
  const folderId = extractDriveFolderId(docsLink);

  if (!folderId) {
    return NextResponse.json({
      ok: false,
      caseId: params.id,
      client: caseItem.client,
      issue: "No Drive folder linked to this case",
      docsUploadLink: docsLink || "(empty)",
      hint:
        "Open the case → Edit → set 'Docs Upload Link' to the Drive folder URL. " +
        "URL format: https://drive.google.com/drive/folders/<FOLDER_ID>",
    });
  }

  // List all files in the folder
  let files: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string; size?: string }> = [];
  let listError: string | null = null;
  try {
    files = await listFilesInFolder(folderId) as any;
  } catch (e) {
    listError = (e as Error).message;
  }

  if (listError) {
    return NextResponse.json({
      ok: false,
      caseId: params.id,
      client: caseItem.client,
      folderId,
      folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
      issue: `Cannot read Drive folder: ${listError}`,
      hint:
        "Drive folder may have been deleted, or Newton's service account doesn't have access. " +
        "Verify the folder exists and the service account has Editor access.",
    });
  }

  // For each file, classify what scan-docs would do with it
  // (Pattern must match scan-docs/route.ts exactly)
  const isGeneratedDocPattern = (name: string) =>
    /^IMM\d{4}[a-z]?_/i.test(name) ||
    /Representative.Submission.Letter/i.test(name) ||
    /^Client_Info_/i.test(name) ||
    /^Application_Forms/i.test(name) ||
    /^Submission.Package/i.test(name);

  const classification = files.map((f) => {
    const isImage = f.mimeType.startsWith("image/");
    const isPdf = f.mimeType.includes("pdf");
    const isScannable = isImage || isPdf;
    const matchesSkip = isGeneratedDocPattern(f.name);

    let action: "WILL_SCAN" | "SKIP_NOT_IMAGE_OR_PDF" | "SKIP_GENERATED_DOC_PATTERN";
    let reason: string;

    if (!isScannable) {
      action = "SKIP_NOT_IMAGE_OR_PDF";
      reason = `MIME type "${f.mimeType}" — only images and PDFs are scannable. Convert to PDF.`;
    } else if (matchesSkip) {
      action = "SKIP_GENERATED_DOC_PATTERN";
      reason =
        `Filename looks like a Newton-generated doc (IMM#### / Submission Letter / Client_Info / ` +
        `Application_Forms). If this is actually a CLIENT upload, rename it.`;
    } else {
      action = "WILL_SCAN";
      reason = "OCR will run on this file";
    }

    return {
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      size: f.size,
      action,
      reason,
    };
  });

  const summary = {
    total: classification.length,
    willScan: classification.filter((c) => c.action === "WILL_SCAN").length,
    skipped_not_pdf_or_image: classification.filter((c) => c.action === "SKIP_NOT_IMAGE_OR_PDF").length,
    skipped_pattern_match: classification.filter((c) => c.action === "SKIP_GENERATED_DOC_PATTERN").length,
  };

  return NextResponse.json({
    ok: true,
    caseId: params.id,
    client: caseItem.client,
    formType: caseItem.formType,
    folderId,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    docsUploadLink: docsLink,
    summary,
    files: classification,
    hint:
      summary.skipped_pattern_match > 0
        ? `${summary.skipped_pattern_match} file(s) being skipped due to filename pattern. Rename them in Drive to bypass — e.g., remove the word "Letter" / "Submission" / "Client_Info".`
        : summary.skipped_not_pdf_or_image > 0
        ? `${summary.skipped_not_pdf_or_image} file(s) skipped because they're not PDF or image. Convert Word/Excel/etc. to PDF.`
        : "All files in folder will be scanned.",
  });
}
