import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { createCase } from "@/lib/store";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// POST /api/marketing-leads/[phone]/convert
// Body: { client?: string, formType: string, assignedTo?: string, leadEmail?: string }
// Creates a real Case using the lead's data, marks lead as 'converted'.
export async function POST(request: NextRequest, { params }: { params: { phone: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const phone = decodeURIComponent(params.phone).replace(/\s+/g, "");
  const body = await request.json().catch(() => ({}));

  const companyId = process.env.DEFAULT_COMPANY_ID || "newton";

  try {
    // Look up the lead row to get the contact name and other context
    const leadRes = await pool.query(`SELECT * FROM marketing_leads WHERE phone = $1`, [phone]);
    const lead = leadRes.rows[0];

    const clientName = String(body.client || lead?.contact_name || "").trim();
    const formType = String(body.formType || lead?.service_interest || "").trim();

    if (!clientName) return NextResponse.json({ error: "Client name required (pass `client` in body or set contact_name on the lead)" }, { status: 400 });
    if (!formType) return NextResponse.json({ error: "formType required (e.g. 'PGWP', 'Study Permit Extension')" }, { status: 400 });

    // Create a real Case using existing store function — wires up Drive folder, client record, etc.
    const newCase = await createCase({
      companyId,
      client: clientName,
      formType,
      leadPhone: phone,
      leadEmail: body.leadEmail || undefined,
      assignedTo: body.assignedTo || lead?.assigned_to || "Unassigned",
      additionalNotes: lead?.notes ? `Converted from marketing lead. Notes: ${lead.notes}` : "Converted from marketing lead.",
      sourceLeadKey: `marketing:${phone}`,
    });

    // Mark lead as converted and link the case ID
    await pool.query(
      `INSERT INTO marketing_leads (phone, stage, converted_case_id, ai_enabled, updated_at)
       VALUES ($1, 'converted', $2, FALSE, NOW())
       ON CONFLICT (phone) DO UPDATE SET
         stage = 'converted',
         converted_case_id = $2,
         ai_enabled = FALSE,
         updated_at = NOW()`,
      [phone, newCase.id]
    );

    // Auto-link any orphan WhatsApp docs from this phone to the new case
    let orphansLinked = 0;
    try {
      const orphansRes = await pool.query(
        `SELECT COUNT(*) FROM orphan_docs WHERE phone = $1 AND linked_case_id IS NULL`,
        [phone]
      );
      const orphanCount = parseInt(orphansRes.rows[0]?.count || "0", 10);
      if (orphanCount > 0) {
        // Trigger the orphan-link logic via internal call
        // (We replicate the logic here to avoid an HTTP self-call which would need auth)
        const orphans = await pool.query(
          `SELECT * FROM orphan_docs WHERE phone = $1 AND linked_case_id IS NULL ORDER BY created_at ASC`,
          [phone]
        );
        const { uploadFileToDriveFolder, extractDriveFolderId, createCaseDriveStructure } = await import("@/lib/google-drive");
        const { getObjectFromS3 } = await import("@/lib/object-storage");
        const { addDocument, updateCaseLinks, getCase } = await import("@/lib/store");
        const caseFresh = await getCase(companyId, newCase.id);
        let driveFolderId = extractDriveFolderId(caseFresh?.docsUploadLink || "");
        if (!driveFolderId && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
          try {
            const structure = await createCaseDriveStructure(
              process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
              `${clientName} - ${formType}`
            );
            driveFolderId = structure.subfolders.clientDocuments.id;
            await updateCaseLinks(companyId, newCase.id, {
              docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
              applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
              submittedFolderLink: structure.subfolders.submitted.webViewLink,
              correspondenceFolderLink: structure.subfolders.correspondence.webViewLink,
            });
          } catch (e) { console.warn("Drive auto-create on convert failed:", (e as Error).message); }
        }
        const cleanName = clientName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
        for (const orphan of orphans.rows) {
          try {
            const ext = orphan.original_filename?.includes(".") ? orphan.original_filename.split(".").pop()
              : orphan.mime_type?.includes("pdf") ? "pdf" : orphan.mime_type?.includes("image") ? "jpg" : "bin";
            const properFileName = `${cleanName} - ${orphan.suggested_label || "Document"}.${ext}`;
            let driveLink = "";
            let fileBuffer: Buffer | null = null;
            try { fileBuffer = await getObjectFromS3(orphan.s3_key); } catch {}
            if (driveFolderId && fileBuffer) {
              try {
                const driveRes = await uploadFileToDriveFolder({
                  folderId: driveFolderId,
                  fileName: properFileName,
                  fileBuffer,
                  mimeType: orphan.mime_type || "application/octet-stream",
                });
                driveLink = driveRes.webViewLink || "";
              } catch (e) { console.warn("Drive upload failed:", (e as Error).message); }
            }
            await addDocument({
              companyId,
              caseId: newCase.id,
              name: properFileName,
              category: "client",
              uploadedBy: clientName + " (WhatsApp orphan)",
              status: "received",
              link: driveLink || orphan.s3_link || "",
            });
            await pool.query(
              `UPDATE orphan_docs SET linked_case_id = $1, linked_at = NOW() WHERE id = $2`,
              [newCase.id, orphan.id]
            );
            orphansLinked++;
          } catch (e) { console.error("Orphan auto-link failed:", (e as Error).message); }
        }
      }
    } catch (e) { console.error("Orphan link block failed (non-fatal):", (e as Error).message); }

    // ── Auto-link marketing_inbox docs to the new case ──
    //
    // When a client sends docs to the Marketing WABA, they get saved into
    // marketing_inbox (NOT orphan_docs). When their lead converts to a case,
    // we want those docs to follow them — staff shouldn't need to ask the
    // client to re-send everything.
    //
    // We scan marketing_inbox for any [doc:...|s3=...] placeholders that
    // belong to this phone, then:
    //   1. Pull the file from S3
    //   2. Upload to the case's Drive folder (if Drive is set up)
    //   3. addDocument() to register it in CRM
    // Same flow as orphan_docs above, just sourced from marketing_inbox.
    let marketingDocsLinked = 0;
    try {
      const mktRows = await pool.query(
        `SELECT id, message, created_at FROM marketing_inbox
         WHERE phone = $1 AND direction = 'inbound' AND message LIKE '[doc:%'
         ORDER BY created_at ASC`,
        [phone]
      );
      if (mktRows.rowCount && mktRows.rowCount > 0) {
        const { uploadFileToDriveFolder, extractDriveFolderId, createCaseDriveStructure } = await import("@/lib/google-drive");
        const { getObjectFromS3 } = await import("@/lib/object-storage");
        const { addDocument, updateCaseLinks, getCase } = await import("@/lib/store");

        const caseFresh = await getCase(companyId, newCase.id);
        let driveFolderId = extractDriveFolderId(caseFresh?.docsUploadLink || "");

        // If the case doesn't have a Drive folder yet, create one
        if (!driveFolderId && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
          try {
            const structure = await createCaseDriveStructure(
              process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
              `${clientName} - ${formType}`
            );
            driveFolderId = structure.subfolders.clientDocuments.id;
            await updateCaseLinks(companyId, newCase.id, {
              docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
              applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
              submittedFolderLink: structure.subfolders.submitted.webViewLink,
              correspondenceFolderLink: structure.subfolders.correspondence.webViewLink,
            });
          } catch (e) { console.warn("Drive auto-create on convert failed:", (e as Error).message); }
        }

        const cleanName = clientName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
        for (const row of mktRows.rows) {
          try {
            // Parse the [doc:...] placeholder
            const text = String(row.message || "");
            if (!text.startsWith("[doc:") || !text.endsWith("]")) continue;
            const inner = text.slice(1, -1);
            const parts = inner.split("|");
            const meta: any = { msgId: parts[0].replace(/^doc:/, "") };
            for (let i = 1; i < parts.length; i++) {
              const eq = parts[i].indexOf("=");
              if (eq < 0) continue;
              const k = parts[i].slice(0, eq);
              const v = parts[i].slice(eq + 1);
              try { meta[k] = decodeURIComponent(v); } catch { meta[k] = v; }
            }

            // Skip docs that are still uploading (no s3 yet)
            if (!meta.s3) continue;

            // Construct a clean filename "Aman Kumar - passport.pdf"
            const origName = meta.name || `marketing-doc-${meta.msgId}`;
            const ext = origName.includes(".") ? origName.split(".").pop() : "bin";
            const baseLabel = origName.replace(/\.[^.]+$/, "");
            const properFileName = `${cleanName} - ${baseLabel}.${ext}`;

            let driveLink = "";
            let fileBuffer: Buffer | null = null;
            try { fileBuffer = await getObjectFromS3(meta.s3); } catch (e) {
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
              } catch (e) { console.warn("Drive upload failed (marketing doc):", (e as Error).message); }
            }
            await addDocument({
              companyId,
              caseId: newCase.id,
              name: properFileName,
              category: "client",
              uploadedBy: `${clientName} (Marketing WhatsApp)`,
              status: "received",
              link: driveLink || `/api/inbox-attachment?id=${encodeURIComponent(meta.msgId)}`,
            });
            marketingDocsLinked++;
          } catch (e) {
            console.error("Marketing doc link failed (one row):", (e as Error).message);
          }
        }
      }
    } catch (e) { console.error("Marketing doc link block failed (non-fatal):", (e as Error).message); }

    return NextResponse.json({ ok: true, case: newCase, orphansLinked, marketingDocsLinked });
  } catch (e) {
    console.error("Lead convert error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
