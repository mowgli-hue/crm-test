// ─────────────────────────────────────────────────────────────────────
// POST /api/cases/[id]/scan-docs
//
// Staff-triggered document scan. Reads every file in the case's Drive
// folder, runs Claude vision OCR on each, and merges extracted fields
// into the case's pgwpIntake.
//
// Why we need this: the WhatsApp inbound webhook already runs OCR on
// uploads from clients, but if staff uploads a passport directly to
// Drive, no OCR fires and the intake stays blank. This endpoint plugs
// that gap.
//
// Existing intake values are preserved — OCR only fills BLANK fields.
// Staff-entered data always wins over machine-extracted data.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase, updateCasePgwpIntake } from "@/lib/store";
import {
  extractDriveFolderId,
  listFilesInFolder,
  downloadDriveFileBytes,
} from "@/lib/google-drive";
import { extractDocumentFields, mapExtractedToIntake } from "@/lib/doc-ocr";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const caseItem = await getCase(user.companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const docsLink = caseItem.docsUploadLink || "";
  const folderId = extractDriveFolderId(docsLink);
  if (!folderId) {
    return NextResponse.json({
      ok: false,
      error: "No Drive folder linked to this case",
    }, { status: 400 });
  }

  // Get the existing intake so we know what's already filled
  const existingIntake = (caseItem.pgwpIntake as Record<string, any>) || {};
  const clientName = caseItem.client || "Client";

  // List all files in the case's Drive folder
  let files: Array<{ id: string; name: string; mimeType: string }> = [];
  try {
    files = await listFilesInFolder(folderId);
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: `Failed to list Drive folder: ${(e as Error).message}`,
    }, { status: 500 });
  }

  if (files.length === 0) {
    return NextResponse.json({
      ok: true,
      filesScanned: 0,
      fieldsAdded: 0,
      message: "No documents in case folder yet",
    });
  }

  // Filter to image and PDF files only — Claude vision can read these
  const scannableFiles = files.filter(f =>
    f.mimeType.startsWith("image/") ||
    f.mimeType.includes("pdf")
  );

  const allMergedFields: Record<string, string> = {};
  const perFileResults: Array<{
    name: string;
    category?: string;
    fieldsAdded?: string[];
    error?: string;
  }> = [];

  // Working merge — track what's been filled across all docs in this run
  // (so a later doc doesn't overwrite an earlier one)
  const runningIntake: Record<string, any> = { ...existingIntake };

  for (const file of scannableFiles) {
    try {
      // Skip files that look like Newton-GENERATED forms — those would mislead OCR
      // because they're already-filled forms, not raw client uploads.
      //
      // Patterns we generate (must match these exactly so we don't accidentally
      // skip CLIENT uploads named similarly, e.g., "Completion Letter.pdf"):
      //   - IMM5710e_FirstName_LastName.pdf
      //   - IMM5476_FirstName_LastName.pdf
      //   - Representative_Submission_Letter_FirstName_LastName.pdf
      //   - Client_Info_FirstName_LastName.pdf (legacy)
      //   - Application_Forms_*.pdf
      //
      // Real bug fixed: previous regex `Letter|Submission` matched
      // "Completion Letter.pdf" (a CLIENT upload, the most important PGWP doc)
      // and incorrectly skipped it from OCR.
      const isGeneratedDoc =
        /^IMM\d{4}[a-z]?_/i.test(file.name) ||                         // IMM5710e_..., IMM5476_...
        /Representative.Submission.Letter/i.test(file.name) ||           // our submission letter
        /^Client_Info_/i.test(file.name) ||                              // legacy package file
        /^Application_Forms/i.test(file.name) ||                         // bundled forms PDF
        /^Submission.Package/i.test(file.name);                          // bundled package
      if (isGeneratedDoc) {
        perFileResults.push({ name: file.name, error: "Skipped (looks like generated doc)" });
        continue;
      }

      const buffer = await downloadDriveFileBytes(file.id);
      if (!buffer || buffer.length === 0) {
        perFileResults.push({ name: file.name, error: "Empty file" });
        continue;
      }

      // Cap at 10MB — vision model has limits, very large PDFs aren't OCRable
      // efficiently anyway. Larger files should be split or processed differently.
      if (buffer.length > 10 * 1024 * 1024) {
        perFileResults.push({ name: file.name, error: `Too large (${Math.round(buffer.length / 1024 / 1024)}MB)` });
        continue;
      }

      const extracted = await extractDocumentFields(buffer, file.mimeType, clientName);
      if (!extracted) {
        perFileResults.push({ name: file.name, error: "OCR returned no data" });
        continue;
      }

      const newFields = mapExtractedToIntake(extracted, runningIntake);

      // Merge into running intake so the next file's mapExtractedToIntake
      // sees the just-added fields and doesn't overwrite them
      for (const [k, v] of Object.entries(newFields)) {
        runningIntake[k] = v;
        allMergedFields[k] = v;
      }

      perFileResults.push({
        name: file.name,
        category: extracted.category,
        fieldsAdded: Object.keys(newFields),
      });
    } catch (e) {
      perFileResults.push({
        name: file.name,
        error: (e as Error).message.slice(0, 200),
      });
    }
  }

  // Save merged fields to the case in a single update
  if (Object.keys(allMergedFields).length > 0) {
    try {
      await updateCasePgwpIntake(user.companyId, params.id, allMergedFields as any);
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: `OCR succeeded but DB update failed: ${(e as Error).message}`,
        results: perFileResults,
      }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    filesScanned: scannableFiles.length,
    filesTotal: files.length,
    fieldsAdded: Object.keys(allMergedFields).length,
    fieldsAddedDetails: allMergedFields,
    results: perFileResults,
  });
}
