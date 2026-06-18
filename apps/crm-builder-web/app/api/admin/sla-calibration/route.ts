// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/sla-calibration?buffer=0.2
//
// Manager-only. Rolls up real hands-on time per application family from the
// punch-in timers and recommends an SLA target per type (best-realistic time +
// buffer). Until the team has been punching in for a while, samples are small —
// the `confidence` field flags that.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { canSeeAllCases } from "@/lib/rbac";
import { slaCalibration } from "@/lib/sla-calibration";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Calibration sets firm-wide policy → managers only.
  if (!canSeeAllCases(user.role)) {
    return NextResponse.json({ error: "Forbidden — managers only" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const bufferRaw = parseFloat(url.searchParams.get("buffer") || "");
    const bufferRatio = Number.isFinite(bufferRaw) && bufferRaw >= 0 ? bufferRaw : undefined;
    const result = await slaCalibration({ companyId: user.companyId, bufferRatio });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
