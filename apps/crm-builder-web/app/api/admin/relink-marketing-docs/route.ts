import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// POST /api/admin/relink-marketing-docs
// Body: { caseId: string }
//
// Re-runs the marketing-doc linkage logic for an existing case. Useful when
// the case was created from marketing convert but docs didn't follow through
// because of the phone-format bug (exact-match query missed docs stored under
// a different format than the convert URL).
//
// This endpoint is idempotent — calling it twice doesn't double-link docs
// because addDocument checks for existing docs with the same name+caseId.
export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const caseId = String(body.caseId || "").trim();
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const companyId = process.env.DEFAULT_COMPANY_ID || "newton";

  try {
    const { getCase, addDocument, updateCaseLinks } = await import("@/lib/store");
    const { uploadFileToDriveFolder, extractDriveFolderId, createCaseDriveStructure } = await import("@/lib/google-drive");
    const { getObjectFromS3 } = await import("@/lib/object-storage");

    const caseItem = await getCase(companyId, caseId);
    if (!caseItem) return NextResponse.json({ error: `Case ${caseId} not found` }, { status: 404 });

    const phone = String(caseItem.leadPhone || "");
    if (!phone) return NextResponse.json({ error: "Case has no phone number" }, { status: 400 });

    const phoneDigits = phone.replace(/\D/g, "");
    const last9 = phoneDigits.slice(-9);
    const clientName = String(caseItem.client || "Client");
    const formType = String(caseItem.formType || "Application");
    const cleanName = clientName.replace(/[^a-zA-Z0-9 ]/g, "").trim();

    // Make sure case has a Drive folder, create if missing
    let driveFolderId = extractDriveFolderId(caseItem.docsUploadLink || "");
    if (!driveFolderId && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
      try {
        const structure = await createCaseDriveStructure(
          process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
          `${clientName} - ${formType}`,
        );
        driveFolderId = structure.subfolders.clientDocuments.id;
        await updateCaseLinks(companyId, caseId, {
          docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
          applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
          submittedFolderLink: structure.subfolders.submitted.webViewLink,
          correspondenceFolderLink: structure.subfolders.correspondence.webViewLink,
        });
      } catch (e) {
        console.warn("Drive auto-create on relink failed:", (e as Error).message);
      }
    }

    // ── 1. Re-scan orphan_docs ──
    let orphansLinked = 0;
    let orphansSkipped = 0;
    try {
      const orphans = await pool.query(
        `SELECT * FROM orphan_docs
          WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
            AND linked_case_id IS NULL
          ORDER BY created_at ASC`,
        [last9],
      );
      for (const orphan of orphans.rows) {
        try {
          const ext = orphan.original_filename?.includes(".")
            ? orphan.original_filename.split(".").pop()
            : orphan.mime_type?.includes("pdf")
              ? "pdf"
              : orphan.mime_type?.includes("image")
                ? "jpg"
                : "bin";
          const properFileName = `${cleanName} - ${orphan.suggested_label || "Document"}.${ext}`;
          let driveLink = "";
          let fileBuffer: Buffer | null = null;
          try {
            fileBuffer = await getObjectFromS3(orphan.s3_key);
          } catch {
            // S3 fetch failed - we'll still try to register the doc with the S3 link
          }
          if (driveFolderId && fileBuffer) {
            try {
              const driveRes = await uploadFileToDriveFolder({
                folderId: driveFolderId,
                fileName: properFileName,
                fileBuffer,
                mimeType: orphan.mime_type || "application/octet-stream",
              });
              driveLink = driveRes.webViewLink || "";
            } catch (e) {
              console.warn("Drive upload failed (orphan):", (e as Error).message);
            }
          }
          await addDocument({
            companyId,
            caseId,
            name: properFileName,
            category: "client",
            uploadedBy: clientName + " (WhatsApp orphan, relinked)",
            status: "received",
            link: driveLink || orphan.s3_link || "",
          });
          await pool.query(
            `UPDATE orphan_docs SET linked_case_id = $1, linked_at = NOW() WHERE id = $2`,
            [caseId, orphan.id],
          );
          orphansLinked++;
        } catch (e) {
          orphansSkipped++;
          console.error("Orphan relink failed (one row):", (e as Error).message);
        }
      }
    } catch (e) {
      console.error("Orphan relink block failed:", (e as Error).message);
    }

    // ── 2. Re-scan marketing_inbox ──
    let marketingDocsLinked = 0;
    let marketingDocsSkipped = 0;
    try {
      const mktRows = await pool.query(
        `SELECT id, message, created_at FROM marketing_inbox
          WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
            AND direction = 'inbound'
            AND message LIKE '[doc:%'
          ORDER BY created_at ASC`,
        [last9],
      );
      for (const row of mktRows.rows) {
        try {
          const text = String(row.message || "");
          if (!text.startsWith("[doc:") || !text.endsWith("]")) {
            marketingDocsSkipped++;
            continue;
          }
          const inner = text.slice(1, -1);
          const parts = inner.split("|");
          const meta: any = { msgId: parts[0].replace(/^doc:/, "") };
          for (let i = 1; i < parts.length; i++) {
            const eq = parts[i].indexOf("=");
            if (eq < 0) continue;
            const k = parts[i].slice(0, eq);
            const v = parts[i].slice(eq + 1);
            try {
              meta[k] = decodeURIComponent(v);
            } catch {
              meta[k] = v;
            }
          }
          if (!meta.s3) {
            marketingDocsSkipped++;
            continue;
          }
          const origName = meta.name || `marketing-doc-${meta.msgId}`;
          const ext = origName.includes(".") ? origName.split(".").pop() : "bin";
          const baseLabel = origName.replace(/\.[^.]+$/, "");
          const properFileName = `${cleanName} - ${baseLabel}.${ext}`;

          let driveLink = "";
          let fileBuffer: Buffer | null = null;
          try {
            fileBuffer = await getObjectFromS3(meta.s3);
          } catch (e) {
            console.warn(`S3 fetch failed for ${meta.s3}:`, (e as Error).message);
          }
          if (driveFolderId && fileBuffer) {
            try {
              const driveRes = await uploadFileToDriveFolder({
                folderId: driveFolderId,
                fileName: properFileName,
                fileBuffer,
                mimeType: meta.mime || "application/octet-stream",
              });
              driveLink = driveRes.webViewLink || "";
            } catch (e) {
              console.warn("Drive upload failed (marketing relink):", (e as Error).message);
            }
          }
          await addDocument({
            companyId,
            caseId,
            name: properFileName,
            category: "client",
            uploadedBy: `${clientName} (Marketing WhatsApp, relinked)`,
            status: "received",
            link: driveLink || `/api/inbox-attachment?id=${encodeURIComponent(meta.msgId)}`,
          });
          marketingDocsLinked++;
        } catch (e) {
          marketingDocsSkipped++;
          console.error("Marketing doc relink failed (one row):", (e as Error).message);
        }
      }
    } catch (e) {
      console.error("Marketing doc relink block failed:", (e as Error).message);
    }

    return NextResponse.json({
      ok: true,
      caseId,
      phone,
      last9,
      orphansLinked,
      orphansSkipped,
      marketingDocsLinked,
      marketingDocsSkipped,
      total: orphansLinked + marketingDocsLinked,
    });
  } catch (e) {
    console.error("Relink endpoint error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
