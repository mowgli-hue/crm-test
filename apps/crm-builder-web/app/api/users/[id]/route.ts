import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getUserById, setUserActive, unassignCasesForUser } from "@/lib/store";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = await getUserById(user.companyId, params.id);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (target.userType !== "staff") return NextResponse.json({ error: "Invalid target user" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "active boolean is required" }, { status: 400 });
  }
  if (target.id === user.id && body.active === false) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
  }

  const updated = await setUserActive(user.companyId, params.id, body.active);
  if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // On removal (deactivate), pull them off all their cases so nothing is left
  // assigned to a removed person. Reactivating does NOT auto-restore assignments.
  let casesUnassigned = 0;
  if (body.active === false) {
    try { casesUnassigned = await unassignCasesForUser(updated.name); }
    catch (e) { console.error("unassignCasesForUser failed (non-fatal):", (e as Error).message); }
  }

  return NextResponse.json({
    casesUnassigned,
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      active: updated.active !== false,
      mfaEnabled: Boolean(updated.mfaEnabled),
      workspaceDriveLink: updated.workspaceDriveLink || "",
      workspaceDriveFolderId: updated.workspaceDriveFolderId || ""
    }
  });
}
