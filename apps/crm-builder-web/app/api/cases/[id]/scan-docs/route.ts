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
import { getCase, updateCasePgwpIntake, listDocuments, addDocument } from "@/lib/store";
import {
  extractDriveFolderId,
  listFilesInFolder,
  downloadDriveFileBytes,
  findExistingSubfolder,
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

  // List all files in the case's Drive folder.
  let files: Array<{ id: string; name: string; mimeType: string }> = [];
  let scannedFolderId = folderId;
  try {
    files = await listFilesInFolder(folderId);
    // Fallback: the linked folder may be the case ROOT while the actual documents
    // sit one level down in the "Client Documents" subfolder. If nothing was found
    // directly, look there (targeted — NOT Application Forms / Submitted, so we
    // never mistake a generated form for a client document).
    if (files.length === 0) {
      const sub = await findExistingSubfolder(folderId, "Client Documents");
      if (sub) {
        const subFiles = await listFilesInFolder(sub.id);
        if (subFiles.length > 0) { files = subFiles; scannedFolderId = sub.id; }
      }
    }
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: `Failed to list Drive folder: ${(e as Error).message}`,
    }, { status: 500 });
  }
  void scannedFolderId;

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
    registered?: boolean;
    error?: string;
  }> = [];

  // Working merge — track what's been filled across all docs in this run
  // (so a later doc doesn't overwrite an earlier one)
  const runningIntake: Record<string, any> = { ...existingIntake };

  // ── Register Drive files as document ROWS ──
  // The checklist / case-agent / readiness all read the documents TABLE
  // (listDocuments). A file dropped straight into the Drive folder was being
  // OCR-scanned for FIELDS here but never registered as a document — so the
  // checklist still counted it as "missing" and the case never flipped to
  // ready-to-prepare. We now register each scanned client file so a Drive drop
  // counts toward the checklist. Idempotent on (caseId, "drive:"+fileId), and
  // we skip files whose normalized name already exists to avoid doubling up a
  // doc that was also uploaded via WhatsApp.
  const normName = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const existingDocs = await listDocuments(user.companyId, params.id);
  const existingNorm = new Set(existingDocs.map((d) => normName(d.name)));
  let docsRegistered = 0;

  for (const file of scannableFiles) {
    try {
      // Skip files that look like Newton-GENERATED forms — those would mislead OCR
      // because they're already-filled forms, not raw client uploads.
      //
      // Newton's GENERATED filename format is strict:
      //   IMM<digits><opt-letter>_<FirstName>_<LastName>.pdf
      //
      // Examples GENERATED (skip):
      //   - IMM5710e_Pratham_Patel.pdf
      //   - IMM5476_Pratham_Patel.pdf
      //   - IMM5444_Pratham_Patel.pdf
      //
      // Examples CLIENT UPLOADS (do NOT skip — must OCR):
      //   - IMM5739_1-1431N39M.pdf  (client-filled restoration form, no name)
      //   - IMM5710_filled.pdf       (client uploaded their own version)
      //   - "Completion Letter.pdf"  (the most common false-positive previously)
      //
      // Heuristic: Newton's generated docs are ALWAYS named IMM####_FirstName_LastName
      // pattern with the underscore-FirstName-underscore-LastName structure. Client
      // uploads typically don't follow this — they have hyphens, numbers, no name, etc.
      const isNewtonGenerated =
        /^IMM\d{4}[a-z]?_[A-Z][a-z]+_[A-Z][a-z]+\.pdf$/i.test(file.name) ||  // strict: IMM####_First_Last.pdf
        /^Representative.Submission.Letter_[A-Z][a-z]+_[A-Z][a-z]+/i.test(file.name) ||
        /^Client_Info_[A-Z][a-z]+_[A-Z][a-z]+/i.test(file.name) ||
        /^Application_Forms_[A-Z][a-z]+_[A-Z][a-z]+/i.test(file.name) ||
        /^Submission.Package_[A-Z][a-z]+_[A-Z][a-z]+/i.test(file.name);
      if (isNewtonGenerated) {
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

      // Register this Drive file as a document row so the checklist counts it.
      // Append the OCR category token to the stored name (e.g. "scan001.pdf
      // [transcripts]") so even a poorly-named file is matched by the checklist's
      // keyword/category logic, not just well-named files like "Transcripts.pdf".
      const cat = String(extracted.category || "").trim();
      const storedName =
        cat && cat !== "other" ? `${file.name} [${cat}]` : file.name;
      let registered = false;
      if (!existingNorm.has(normName(file.name)) && !existingNorm.has(normName(storedName))) {
        try {
          await addDocument({
            companyId: user.companyId,
            caseId: params.id,
            name: storedName,
            category: "general",
            status: "received",
            link: `https://drive.google.com/file/d/${file.id}/view`,
            sourceMsgId: `drive:${file.id}`,
          });
          existingNorm.add(normName(storedName));
          existingNorm.add(normName(file.name));
          docsRegistered += 1;
          registered = true;
        } catch {
          // Non-fatal — field extraction already succeeded; registration is a bonus.
        }
      }

      perFileResults.push({
        name: file.name,
        category: extracted.category,
        fieldsAdded: Object.keys(newFields),
        registered,
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
    docsRegistered,
    results: perFileResults,
  });
}
