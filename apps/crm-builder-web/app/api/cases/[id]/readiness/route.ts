// ─────────────────────────────────────────────────────────────────────
// GET /api/cases/[id]/readiness
//
// The single shared "is this case ready?" check — the SAME definition the
// submission package uses (getCaseReadiness), so the CRM, the package, and
// (next) the processing agent never disagree on what's complete.
//
// Returns staged readiness: intake, client docs, generated forms, plus an
// overall submissionReady flag. Reconciles the documents table with a live
// Drive folder scan so files scanned in the office / dropped straight into
// Drive count too (same reconciliation the submission package does).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase, listDocuments } from "@/lib/store";
import {
  extractDriveFolderId,
  extractDriveFileId,
  listFilesInFolder,
} from "@/lib/google-drive";
import { getCaseReadiness } from "@/lib/case-readiness";

// The processing agent has no user session, so it authenticates with a shared
// service token (header `x-agent-token` === AGENT_SERVICE_TOKEN). Readiness only
// returns missing-item labels (not document contents), so this is low-risk.
// Constant-time compare to avoid leaking the token via timing.
function serviceTokenValid(request: NextRequest): boolean {
  const expected = process.env.AGENT_SERVICE_TOKEN || "";
  const provided = request.headers.get("x-agent-token") || "";
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  // Logged-in staff → their company. Trusted agent (valid service token) →
  // the default company, same as the rest of the app.
  const companyId = user
    ? user.companyId
    : serviceTokenValid(request)
      ? (process.env.DEFAULT_COMPANY_ID || "newton")
      : null;
  if (!companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const caseItem = await getCase(companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  // Start from the documents table, then fold in any Drive files that aren't
  // tracked yet (office scans / manual drops) so readiness reflects the real
  // folder — the same reconciliation the submission package performs.
  let docs: Array<Record<string, unknown>> = await listDocuments(companyId, params.id);
  try {
    const folderId = extractDriveFolderId(caseItem.docsUploadLink || "");
    if (folderId) {
      const driveFiles = await listFilesInFolder(folderId);
      const knownIds = new Set(
        docs
          .map((d) => extractDriveFileId((d as { link?: string }).link))
          .filter((id): id is string => !!id),
      );
      const driveOnly = driveFiles
        .filter((f) => !knownIds.has(f.id))
        .map((f) => ({
          id: `drive-only-${f.id}`,
          name: f.name,
          link: `https://drive.google.com/file/d/${f.id}/view`,
          status: "received" as const,
        }));
      if (driveOnly.length > 0) docs = [...docs, ...driveOnly];
    }
  } catch {
    // Drive scan is best-effort; fall back to the documents table alone.
  }

  const readiness = getCaseReadiness(
    caseItem,
    docs as unknown as Parameters<typeof getCaseReadiness>[1],
  );
  return NextResponse.json({ ok: true, caseId: params.id, readiness });
}
