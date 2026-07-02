// GET  /api/cases/[id]/prefill-from-profile  → the reusable data already on file
//        for this client (from their previous applications), so intake can show
//        "we already have these — still correct?".
// POST /api/cases/[id]/prefill-from-profile   → copy that saved profile into THIS
//        case's intake (fills BLANK fields only — never overwrites fresh answers).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getClientProfileForCase, getCase, updateCasePgwpIntake } from "@/lib/store";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await getClientProfileForCase(user.companyId, params.id);
  return NextResponse.json({ ok: true, hasProfile: Object.keys(profile).length > 0, profile });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await getClientProfileForCase(user.companyId, params.id);
  if (Object.keys(profile).length === 0) return NextResponse.json({ ok: true, applied: 0, message: "No prior data on file for this client." });

  const c = await getCase(user.companyId, params.id);
  const existing = ((c?.pgwpIntake as Record<string, any>) || {});
  // Only fill fields that are currently blank — never clobber fresh answers.
  const patch: Record<string, string> = {};
  for (const [k, v] of Object.entries(profile)) {
    const cur = existing[k];
    if ((cur === undefined || cur === null || String(cur).trim() === "") && String(v || "").trim() !== "") {
      patch[k] = String(v);
    }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, applied: 0, message: "Nothing new to pre-fill." });
  await updateCasePgwpIntake(user.companyId, params.id, patch as any);
  return NextResponse.json({ ok: true, applied: Object.keys(patch).length, fields: Object.keys(patch) });
}
