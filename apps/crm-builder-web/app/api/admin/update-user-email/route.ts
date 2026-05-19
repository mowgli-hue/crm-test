// app/api/admin/update-user-email/route.ts
//
// One-shot endpoint to update a user's email in the store. Useful when a
// user was created with a typo and the CRM UI doesn't have an Edit option.
//
// Auth: Admin session OR system token (AUTH_RECOVERY_TOKEN).
//
// Body: {
//   name?: string,              // match by name (e.g. "Rapneet Kaur")
//   currentEmail?: string,      // OR match by current email
//   newEmail: string            // required - new email value
// }
//
// At least one of name/currentEmail must be provided.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { updateUserEmail } from "@/lib/store";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const user = await getCurrentUserFromRequest(request);
  const isSystem = isValidSystemToken(request.headers.get("x-admin-token")) ||
                   isValidSystemToken(body.systemToken);

  if (!user && !isSystem) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user && (user.userType !== "staff" || user.role !== "Admin") && !isSystem) {
    return NextResponse.json({ error: "Forbidden - Admin only" }, { status: 403 });
  }

  const companyId = user?.companyId || process.env.DEFAULT_COMPANY_ID || "newton";
  const { name, currentEmail, newEmail } = body || {};

  if (!newEmail || typeof newEmail !== "string" || !/@/.test(newEmail)) {
    return NextResponse.json({ error: "Missing or invalid newEmail" }, { status: 400 });
  }
  if (!name && !currentEmail) {
    return NextResponse.json({ error: "Provide name or currentEmail to identify the user" }, { status: 400 });
  }

  const updated = await updateUserEmail({
    companyId,
    name: typeof name === "string" ? name : undefined,
    currentEmail: typeof currentEmail === "string" ? currentEmail : undefined,
    newEmail,
  });

  if (!updated) {
    return NextResponse.json({ error: "No user matched the provided name or currentEmail" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role },
  });
}
