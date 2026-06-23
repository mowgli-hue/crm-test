// app/api/cases/[id]/rep-letter/versions/route.ts
//
// Lists the saved representative-letter versions for a case (the timestamped
// PDFs in the "Rep Letter Versions" Drive subfolder), so the team can see and
// open prior versions from inside the CRM instead of digging in Drive.
//
//   GET → { ok, versions: [{ name, link, createdTime }] }

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { canStaffAccessCase } from "@/lib/rbac";
import { getCase } from "@/lib/store";
import { extractDriveFolderId, findExistingSubfolder, listDriveFolderFiles } from "@/lib/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const caseItem = await getCase(user.companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  if (user.userType === "staff" && !canStaffAccessCase(user.role, user.name, (caseItem as any).assignedTo)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const folderId = extractDriveFolderId((caseItem as any).docsUploadLink || "");
  if (!folderId) return NextResponse.json({ ok: true, versions: [] });

  try {
    const sub = await findExistingSubfolder(folderId, "Rep Letter Versions");
    if (!sub) return NextResponse.json({ ok: true, versions: [] });
    const files = await listDriveFolderFiles(sub.id);
    const versions = files
      .filter((f) => /\.pdf$/i.test(f.name))
      .map((f) => ({ name: f.name, link: f.webViewLink || "", createdTime: f.createdTime || "" }));
    return NextResponse.json({ ok: true, versions });
  } catch (e) {
    return NextResponse.json({ ok: true, versions: [], error: (e as Error).message });
  }
}
