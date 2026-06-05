// app/api/admin/clear-results/route.ts
//
// "Start fresh" — wipe the historical / bulk-uploaded IRCC results so the
// Results screen begins clean when the firm goes live and starts sending only
// from the CRM. Destructive, so it requires Admin + an explicit confirm flag.
//
//   POST { confirm: true }  → clears legacy results, returns count removed
//
// Note: this only clears the uploaded "legacy results" feed. It does NOT touch
// cases, submissions, the sent-results log, or the submitted-apps sheet.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { clearLegacyResults } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return NextResponse.json(
      { error: "Confirmation required. This permanently clears all uploaded results. Re-send with { confirm: true }." },
      { status: 400 }
    );
  }

  const removed = await clearLegacyResults(user.companyId);
  console.log(`[clear-results] ${user.name || user.id} cleared ${removed} legacy results for ${user.companyId}`);
  return NextResponse.json({ ok: true, removed });
}
