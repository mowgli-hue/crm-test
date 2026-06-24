// ─────────────────────────────────────────────────────────────────────
// POST /api/admin/backfill-submitted-stage
//
// One-time (idempotent) data-hygiene job. Realigns `stage` for every case
// that is already submitted (processingStatus="submitted" or submittedAt set)
// but whose stage drifted to an older value like "Paid". Without this, a
// submitted case shows up as "paid, not started" in the Ops report and shows
// the wrong stage in the CRM.
//
// Admin-only, or system token (so it can also be run from the cron if needed).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { backfillSubmittedStages } from "@/lib/store";

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("systemToken") || "";
  const sysOk = Boolean(process.env.AUTH_RECOVERY_TOKEN) && token === process.env.AUTH_RECOVERY_TOKEN;
  if (!sysOk) {
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff" || user.role !== "Admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const result = await backfillSubmittedStages();
  return NextResponse.json({ ok: true, ...result });
}
