// app/api/admin/update-user-role/route.ts
//
// Change a staff member's role (which controls what they can see — Processing
// staff see only their own cases, Marketing sees leads, etc.). Admin only.
//
// Body: { userId: string, role: "Admin"|"Marketing"|"Processing"|"ProcessingLead"|"Reviewer" }

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { updateUserRole } from "@/lib/store";
import type { Role } from "@/lib/models";

const ROLES = ["Admin", "Marketing", "Processing", "ProcessingLead", "Reviewer"];

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body?.userId || "").trim();
  const role = String(body?.role || "").trim();
  if (!userId || !ROLES.includes(role)) {
    return NextResponse.json({ error: "userId and a valid role are required." }, { status: 400 });
  }
  // Guard: don't let an admin strip their OWN admin access and lock themselves out.
  if (userId === user.id && role !== "Admin") {
    return NextResponse.json({ error: "You can't change your own role away from Admin (ask another admin)." }, { status: 400 });
  }

  // BUGFIX: this previously passed `role`, but updateUserRole reads `newRole`,
  // so the value arrived undefined and every role change silently failed with
  // "user not found". Pass the correct key.
  const updated = await updateUserRole({ companyId: user.companyId, userId, newRole: role as Role });
  if (!updated) return NextResponse.json({ error: "User not found." }, { status: 404 });
  return NextResponse.json({ ok: true, user: { id: updated.id, name: updated.name, role: updated.role } });
}
