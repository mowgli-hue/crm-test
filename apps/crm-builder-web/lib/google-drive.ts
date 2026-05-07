import { createSign } from "node:crypto";

type DriveFolderResult = {
  id: string;
  webViewLink: string;
};

type DriveFileResult = {
  id: string;
  webViewLink: string;
};

type CaseDriveStructureResult = {
  caseFolder: DriveFolderResult;
  subfolders: {
    clientDocuments: DriveFolderResult;
    applicationForms: DriveFolderResult;
    submitted: DriveFolderResult;
    correspondence: DriveFolderResult;
  };
};

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getServiceAccount() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  if (!email || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  }
  return { email, privateKey };
}

async function getDriveAccessToken(): Promise<string> {
  const { email, privateKey } = getServiceAccount();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey);
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store"
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token request failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google access token missing");
  return json.access_token;
}

export function extractDriveFolderId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const idPattern = /[-\w]{25,}/;
  if (!value.includes("http")) return idPattern.test(value) ? value : null;

  const byFolders = value.match(/\/folders\/([-\w]{25,})/);
  if (byFolders?.[1]) return byFolders[1];

  const byIdParam = value.match(/[?&]id=([-\w]{25,})/);
  if (byIdParam?.[1]) return byIdParam[1];

  const generic = value.match(idPattern);
  return generic?.[0] || null;
}

function sanitizeFolderName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

export function buildCaseFolderName(caseId: string, client: string) {
  return sanitizeFolderName(`${caseId} - ${client || "Client"}`);
}

function sanitizeAppType(input: string): string {
  return sanitizeFolderName(String(input || "").replace(/\s+/g, " ").trim());
}

export function buildCaseFolderNameWithApp(caseId: string, client: string, formType: string) {
  const app = sanitizeAppType(formType);
  if (!app) return buildCaseFolderName(caseId, client);
  return sanitizeFolderName(`${caseId} - ${client || "Client"} - ${app}`);
}

const CASE_SUBFOLDER_NAMES = {
  clientDocuments: "Client Documents",
  applicationForms: "Application Forms",
  submitted: "Submitted",
  correspondence: "Correspondence"
} as const;

export async function createDriveSubfolder(parentFolderId: string, folderName: string): Promise<DriveFolderResult> {
  const accessToken = await getDriveAccessToken();

  const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId]
    }),
    cache: "no-store"
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive folder create failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string; webViewLink?: string };
  if (!data.id) throw new Error("Google Drive folder id missing");
  return {
    id: data.id,
    webViewLink: data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`
  };
}

async function findDriveSubfolderByName(parentFolderId: string, folderName: string): Promise<DriveFolderResult | null> {
  const accessToken = await getDriveAccessToken();
  const safeName = String(folderName || "").replace(/'/g, "\\'");
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `'${parentFolderId}' in parents`,
    `name='${safeName}'`
  ].join(" and ");
  const url =
    "https://www.googleapis.com/drive/v3/files?" +
    new URLSearchParams({
      q,
      fields: "files(id,name,webViewLink,createdTime)",
      pageSize: "1",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      orderBy: "createdTime desc"
    }).toString();
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { files?: Array<{ id: string; webViewLink?: string }> };
  const match = data.files?.[0];
  if (!match?.id) return null;
  return {
    id: match.id,
    webViewLink: match.webViewLink || `https://drive.google.com/drive/folders/${match.id}`
  };
}

export async function getOrCreateDriveSubfolder(parentFolderId: string, folderName: string): Promise<DriveFolderResult> {
  const existing = await findDriveSubfolderByName(parentFolderId, folderName);
  if (existing) return existing;
  return createDriveSubfolder(parentFolderId, folderName);
}

export async function createCaseDriveStructure(
  rootFolderId: string,
  caseFolderName: string
): Promise<CaseDriveStructureResult> {
  const caseFolder = await getOrCreateDriveSubfolder(rootFolderId, caseFolderName);
  const [clientDocuments, applicationForms, submitted, correspondence] = await Promise.all([
    getOrCreateDriveSubfolder(caseFolder.id, CASE_SUBFOLDER_NAMES.clientDocuments),
    getOrCreateDriveSubfolder(caseFolder.id, CASE_SUBFOLDER_NAMES.applicationForms),
    getOrCreateDriveSubfolder(caseFolder.id, CASE_SUBFOLDER_NAMES.submitted),
    getOrCreateDriveSubfolder(caseFolder.id, CASE_SUBFOLDER_NAMES.correspondence)
  ]);

  return {
    caseFolder,
    subfolders: {
      clientDocuments,
      applicationForms,
      submitted,
      correspondence
    }
  };
}

export async function uploadFileToDriveFolder(input: {
  folderId: string;
  fileName: string;
  fileBuffer: Buffer;
  mimeType?: string;
}): Promise<DriveFileResult> {
  const accessToken = await getDriveAccessToken();
  const boundary = `flowdesk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = {
    name: sanitizeFolderName(input.fileName),
    parents: [input.folderId]
  };
  const mimeType = input.mimeType || "application/octet-stream";

  const preamble =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const ending = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(preamble, "utf8"),
    input.fileBuffer,
    Buffer.from(ending, "utf8")
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body,
      cache: "no-store"
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive file upload failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id?: string; webViewLink?: string };
  if (!data.id) throw new Error("Google Drive file id missing");
  return {
    id: data.id,
    webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`
  };
}


// ── Google Sheets Integration ──────────────────────────────────────
// Spreadsheet ID for Newton submitted applications sheet
const SUBMITTED_SHEET_ID = "1S3jXBineGtsfaMErKYdfZdclYlceLUNDI7QsgTrBweQ";

async function getSheetsAccessToken(): Promise<string> {
  const { email, privateKey } = getServiceAccount();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey);
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Sheets token error: ${data.error || "unknown"}`);
  return data.access_token;
}

export async function appendToSubmittedSheet(row: {
  name: string;
  appType: string;
  phone: string;
  appNumber: string;
  submissionDate: string;
}): Promise<void> {
  try {
    const token = await getSheetsAccessToken();
    // Append a new row: Date | Name | Application Type | Phone | App Number | Assigned To | Amount Paid | Status
    const values = [[
      row.name,
      row.appType,
      row.phone,
      row.appNumber,
      row.submissionDate,
      "", // Submission Shared
      "", // Result
      "", // Notes
    ]];
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SUBMITTED_SHEET_ID}/values/Sheet1!A:I:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Sheets append error:", err);
    } else {
      console.log(`✅ Appended ${row.name} / ${row.appNumber} to submitted sheet`);
    }
  } catch (e) {
    console.error("appendToSubmittedSheet failed:", (e as Error).message);
  }
}

// ── Under Review Sheet Sync ──────────────────────────────────────────────────
const UNDER_REVIEW_SHEET_ID = "1CcuWebtyrSmpINzh2ZxvxZUdZ_zC-ojh6fKmTYBuZb4";
const ALL_CASES_SHEET_ID = "1CcuWebtyrSmpINzh2ZxvxZUdZ_zC-ojh6fKmTYBuZb4";

export async function appendToAllCasesSheet(caseData: {
  caseId: string;
  name: string;
  phone: string;
  formType: string;
  permitExpiry?: string;
  uci?: string;
  isUrgent?: boolean;
  amountPaid?: number;
}): Promise<void> {
  try {
    const token = await getSheetsAccessToken();
    const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Vancouver'});
    const values = [[
      caseData.name,
      "'" + String(caseData.phone || "").replace(/\D/g, ""),
      caseData.formType,
      caseData.permitExpiry || "",
      caseData.uci || "",
      caseData.isUrgent ? "Urgent" : "",
      "", // Results
      caseData.amountPaid ? String(caseData.amountPaid) : "",
      caseData.caseId,
      today,
    ]];
    // Check if case already exists in sheet to prevent duplicates
    const checkRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${ALL_CASES_SHEET_ID}/values/Client Sheet!I:I`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (checkRes.ok) {
      const checkData = await checkRes.json() as { values?: string[][] };
      const existingIds = (checkData.values || []).flat();
      if (existingIds.includes(caseData.caseId)) {
        console.log(`⏭️ Case ${caseData.caseId} already in sheet — skipping`);
        return;
      }
    }

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${ALL_CASES_SHEET_ID}/values/Client Sheet!A:J:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("All Cases sheet append error:", err);
    } else {
      console.log(`✅ Added to All Cases sheet: ${caseData.name} (${caseData.caseId})`);
    }
  } catch (e) {
    console.error("appendToAllCasesSheet failed:", (e as Error).message);
  }
}

export async function syncCaseToUnderReviewSheet(caseItem: {
  client: string;
  formType: string;
  assignedTo?: string;
  reviewedBy?: string;
  processingStatus?: string;
  reviewStatus?: string;
  reviewNotes?: string;
  applicationNumber?: string;
}): Promise<void> {
  try {
    const token = await getSheetsAccessToken();

    // First read all rows to find if this client already exists
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${UNDER_REVIEW_SHEET_ID}/values/Under review!A:J`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const readData = await readRes.json() as { values?: string[][] };
    const rows = readData.values || [];

    // Find existing row by client name (column B = index 1)
    const clientName = String(caseItem.client || "").trim().toLowerCase();
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const rowName = String(rows[i]?.[1] || "").trim().toLowerCase();
      if (rowName && clientName.includes(rowName) || rowName.includes(clientName)) {
        rowIndex = i;
        break;
      }
    }

    // Determine submission status
    const status = caseItem.processingStatus === "submitted"
      ? (caseItem.applicationNumber ? `Submitted - ${caseItem.applicationNumber}` : "Submitted")
      : caseItem.reviewStatus === "changes_needed" ? "Changes Needed"
      : caseItem.reviewStatus === "changes_done" ? "Ready to Submit"
      : caseItem.processingStatus === "under_review" ? "Under Review"
      : caseItem.processingStatus === "docs_pending" ? "Docs Pending"
      : caseItem.processingStatus || "";

    if (rowIndex > 0) {
      // Update existing row
      const rowNum = rowIndex + 1;
      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${UNDER_REVIEW_SHEET_ID}/values/Under review!D${rowNum}:H${rowNum}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            values: [[
              caseItem.assignedTo || "",
              caseItem.reviewedBy || "",
              status,
              caseItem.reviewNotes || "",
              ""
            ]]
          })
        }
      );
      if (!updateRes.ok) {
        const err = await updateRes.json();
        console.error("Sheet update failed:", err);
      }
    } else {
      // Append new row
      const nextRow = rows.length + 1;
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${UNDER_REVIEW_SHEET_ID}/values/Under review!A:J:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            values: [[
              nextRow - 1,
              caseItem.client,
              caseItem.formType,
              caseItem.assignedTo || "",
              caseItem.reviewedBy || "",
              status,
              caseItem.reviewNotes || "",
              "", "", ""
            ]]
          })
        }
      );
    }

    console.log(`✅ Sheet synced: ${caseItem.client} → ${status}`);
  } catch (e) {
    console.error("syncCaseToUnderReviewSheet error:", (e as Error).message);
  }
}
// ─────────────────────────────────────────────────────────────────────────────
// Submission-package helpers (Increment 3)
// Append-only addition. Uses existing private getDriveAccessToken().
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Download the binary contents of a Drive file by its file ID.
 * Used by the submission-package orchestrator to fetch already-uploaded
 * client docs (passport, photo, study permit, IELTS, etc.) so they can
 * be sent to the bundler service.
 */
export async function downloadDriveFileBytes(fileId: string): Promise<Buffer> {
  if (!fileId) throw new Error("downloadDriveFileBytes: empty fileId");
  const accessToken = await getDriveAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive download failed for ${fileId} (${res.status}): ${text.slice(0, 300)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Server-side copy of a Drive file into a target folder, with a new name.
 * Drive copies the file metadata + content without re-uploading bytes
 * through our server. Much faster than download+re-upload.
 *
 * Used by the submission-package orchestrator to assemble standardized
 * filenames in the submission subfolder.
 */
export async function copyDriveFileToFolder(input: {
  sourceFileId: string;
  newName: string;
  targetFolderId: string;
}): Promise<DriveFileResult> {
  const { sourceFileId, newName, targetFolderId } = input;
  if (!sourceFileId || !targetFolderId) {
    throw new Error("copyDriveFileToFolder: sourceFileId and targetFolderId required");
  }
  const accessToken = await getDriveAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sourceFileId)}/copy?supportsAllDrives=true&fields=id,webViewLink`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: sanitizeFolderName(newName),
      parents: [targetFolderId],
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive copy failed for ${sourceFileId} → ${newName} (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { id?: string; webViewLink?: string };
  if (!json.id || !json.webViewLink) {
    throw new Error("Drive copy response missing id/webViewLink");
  }
  return { id: json.id, webViewLink: json.webViewLink };
}

/**
 * Look up a Drive file's ID from its webViewLink. The CRM stores doc
 * links as full URLs (e.g., https://drive.google.com/file/d/{id}/view?usp=...);
 * this extracts the ID for use with copy/download operations.
 */
export function extractDriveFileId(webViewLink: string | undefined | null): string | null {
  if (!webViewLink) return null;
  // Pattern 1: https://drive.google.com/file/d/{id}/view?...
  const m1 = webViewLink.match(/\/file\/d\/([a-zA-Z0-9_-]{25,})/);
  if (m1) return m1[1];
  // Pattern 2: https://drive.google.com/open?id={id}
  const m2 = webViewLink.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
  if (m2) return m2[1];
  // Pattern 3: bare id
  if (/^[a-zA-Z0-9_-]{25,}$/.test(webViewLink)) return webViewLink;
  return null;
}

/**
 * Delete any existing files in a Drive folder whose names exactly match any of
 * the names provided. Used by the submission-package orchestrator for per-file
 * dedup — before adding Passport_<First>_<Last>.pdf, we wipe any prior version.
 *
 * Why this instead of bulk emptyDriveFolder():
 *   - Bulk wipe loses unrelated files staff may have manually added
 *   - Bulk wipe on permission errors leaves the folder partially-emptied,
 *     creating duplicate sets when run again
 *   - Per-file dedup is idempotent: each target name has exactly one copy
 *
 * Returns count of files removed (not counted: files that didn't exist).
 */
export async function deleteFilesByNameInFolder(
  folderId: string,
  fileNames: string[]
): Promise<{ removed: number; errors: string[] }> {
  if (!folderId) throw new Error("deleteFilesByNameInFolder: empty folderId");
  if (!fileNames.length) return { removed: 0, errors: [] };

  const accessToken = await getDriveAccessToken();
  const errors: string[] = [];
  let removed = 0;

  for (const targetName of fileNames) {
    if (!targetName) continue;
    // Drive query: find files in this folder with this exact name (not trashed)
    const escapedName = String(targetName).replace(/'/g, "\\'");
    const q = `'${folderId}' in parents and name='${escapedName}' and trashed=false`;
    const listUrl =
      "https://www.googleapis.com/drive/v3/files?" +
      new URLSearchParams({
        q,
        fields: "files(id,name)",
        pageSize: "10",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      }).toString();

    let listJson: { files?: Array<{ id: string; name: string }> } = {};
    try {
      const listRes = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!listRes.ok) {
        errors.push(`list "${targetName}" failed: ${listRes.status}`);
        continue;
      }
      listJson = await listRes.json();
    } catch (e) {
      errors.push(`list "${targetName}" exception: ${(e as Error).message}`);
      continue;
    }

    const matches = listJson.files || [];
    for (const m of matches) {
      try {
        const delRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(m.id)}?supportsAllDrives=true`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (delRes.ok || delRes.status === 204) {
          removed++;
        } else if (delRes.status === 404) {
          // File already deleted (e.g., between list and delete by another process).
          // This is the desired end state, so don't log it as an error.
          removed++;
        } else {
          const text = await delRes.text();
          errors.push(`delete "${m.name}" (${m.id.slice(0, 12)}): ${delRes.status} ${text.slice(0, 60)}`);
        }
      } catch (e) {
        errors.push(`delete "${m.name}" exception: ${(e as Error).message}`);
      }
    }
  }

  return { removed, errors };
}

// ────────────────────────────────────────────────────────────────────────
// listFilesInFolder
//
// List all (non-trashed) files inside a Drive folder. Returns id, name,
// and mimeType for each. Does NOT recurse into subfolders.
//
// Used by the doc-scan endpoint to enumerate uploaded client docs and
// run OCR on each.
// ────────────────────────────────────────────────────────────────────────
export async function listFilesInFolder(
  folderId: string,
): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  if (!folderId) throw new Error("listFilesInFolder: empty folderId");
  const accessToken = await getDriveAccessToken();

  const out: Array<{ id: string; name: string; mimeType: string }> = [];
  let pageToken: string | undefined = undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id,name,mimeType)",
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const url = "https://www.googleapis.com/drive/v3/files?" + params.toString();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`listFilesInFolder failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = await res.json() as {
      nextPageToken?: string;
      files?: Array<{ id: string; name: string; mimeType: string }>;
    };
    if (Array.isArray(json.files)) {
      for (const f of json.files) {
        // Skip subfolders — only list actual files
        if (f.mimeType === "application/vnd.google-apps.folder") continue;
        out.push({ id: f.id, name: f.name, mimeType: f.mimeType });
      }
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}
