// app/api/admin/ops-lead/route.ts
//
// The AI Operations Lead dashboard payload.
//
//   GET ?windowDays=30&idle=30
//     → { ok, data (metrics + team summary + proposed rebalance), judgment
//         (AI brief + per-staff verdicts + new-hire ramp reads) }
//
// Auth: Admin only. This exposes every staff member's performance read, so it's
// gated to owner/admin accounts the same way the existing performance board is.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { gatherOpsData } from "@/lib/ops-lead";
import { aiJudgment } from "@/lib/ops-lead-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — admins only" }, { status: 403 });
  }

  const url = new URL(request.url);
  const windowDays = Math.min(Math.max(Number(url.searchParams.get("windowDays")) || 30, 7), 120);
  const idleThresholdMin = Math.min(Math.max(Number(url.searchParams.get("idle")) || 30, 5), 240);

  try {
    const data = await gatherOpsData({ windowDays, idleThresholdMin });
    const judgment = await aiJudgment(data);
    return NextResponse.json({ ok: true, data, judgment });
  } catch (e) {
    console.error("[ops-lead] failed:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
