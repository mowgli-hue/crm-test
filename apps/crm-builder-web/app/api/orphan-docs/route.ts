import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

// GET /api/orphan-docs?phone=+1604... — list orphan docs for a phone
// GET /api/orphan-docs — list ALL orphan docs (admin overview)
export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureSchema();
    const url = new URL(request.url);
    const phone = url.searchParams.get("phone");
    const params: any[] = [];
    let where = "WHERE linked_case_id IS NULL";
    if (phone) {
      params.push(phone);
      where += ` AND phone = $${params.length}`;
    }
    const res = await pool.query(`SELECT * FROM orphan_docs ${where} ORDER BY created_at DESC LIMIT 500`, params);
    return NextResponse.json({ orphans: res.rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, orphans: [] }, { status: 500 });
  }
}

// POST /api/orphan-docs/link
// Body: { phone, caseId } — move all orphan docs from this phone to this case
export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { phone, caseId } = body;
  if (!phone || !caseId) {
    return NextResponse.json({ error: "phone and caseId required" }, { status: 400 });
  }

  try {
    await ensureSchema();

    // Get all orphans for this phone
    const orphansRes = await pool.query(
      `SELECT * FROM orphan_docs WHERE phone = $1 AND linked_case_id IS NULL ORDER BY created_at ASC`,
      [phone]
    );
    const orphans = orphansRes.rows;
    if (orphans.length === 0) {
      return NextResponse.json({ ok: true, linked: 0, message: "No orphan docs found for this phone" });
    }

    const { getCase } = await import("@/lib/store");
    const { uploadFileToDriveFolder, extractDriveFolderId, createCaseDriveStructure } = await import("@/lib/google-drive");
    const { getObjectFromS3 } = await import("@/lib/object-storage");
    const { addDocument, updateCaseLinks } = await import("@/lib/store");

    const caseItem = await getCase(COMPANY_ID, caseId);
    if (!caseItem) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    // Make sure the case has Drive folders
    let driveFolderId = extractDriveFolderId(caseItem.docsUploadLink || "");
    if (!driveFolderId && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
      try {
        const structure = await createCaseDriveStructure(
          process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
          `${caseItem.client} - ${caseItem.formType}`
        );
        driveFolderId = structure.subfolders.clientDocuments.id;
        await updateCaseLinks(COMPANY_ID, caseId, {
          docsUploadLink: structure.subfolders.clientDocuments.webViewLink,
          applicationFormsLink: structure.subfolders.applicationForms.webViewLink,
          submittedFolderLink: structure.subfolders.submitted.webViewLink,
          correspondenceFolderLink: structure.subfolders.correspondence.webViewLink,
        });
      } catch (e) {
        console.error("Failed to auto-create Drive folder for case:", (e as Error).message);
      }
    }

    const clientNameClean = String(caseItem.client || "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
    let linkedCount = 0;

    for (const orphan of orphans) {
      try {
        // Build proper filename: ClientName - SuggestedLabel.ext
        const ext = orphan.original_filename?.includes(".")
          ? orphan.original_filename.split(".").pop()
          : orphan.mime_type?.includes("pdf") ? "pdf"
          : orphan.mime_type?.includes("image") ? "jpg"
          : "bin";
        const properFileName = `${clientNameClean} - ${orphan.suggested_label || "Document"}.${ext}`;

        // Pull file from S3
        let fileBuffer: Buffer | null = null;
        try {
          fileBuffer = await getObjectFromS3(orphan.s3_key);
        } catch (e) {
          console.warn(`Failed to pull orphan from S3 (${orphan.s3_key}):`, (e as Error).message);
        }

        let driveLink = "";
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
            console.error("Drive upload failed for orphan:", (e as Error).message);
          }
        }

        // Add document record on the case
        await addDocument({
          companyId: COMPANY_ID,
          caseId,
          name: properFileName,
          category: "client",
          uploadedBy: caseItem.client || "Client (WhatsApp orphan)",
          status: "received",
          link: driveLink || orphan.s3_link || "",
        });

        // Mark orphan as linked
        await pool.query(
          `UPDATE orphan_docs SET linked_case_id = $1, linked_at = NOW() WHERE id = $2`,
          [caseId, orphan.id]
        );
        linkedCount++;
      } catch (e) {
        console.error("Failed to link orphan:", orphan.id, (e as Error).message);
      }
    }

    return NextResponse.json({ ok: true, linked: linkedCount, total: orphans.length });
  } catch (e) {
    console.error("Orphan link error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orphan_docs (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      suggested_label TEXT,
      original_filename TEXT,
      mime_type TEXT,
      s3_key TEXT,
      s3_link TEXT,
      linked_case_id TEXT,
      linked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orphan_docs_phone ON orphan_docs(phone) WHERE linked_case_id IS NULL`);
}
