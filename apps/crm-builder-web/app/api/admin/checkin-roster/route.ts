// GET /api/admin/checkin-roster — today's attendance: who has checked in and
// who hasn't. Admin / Marketing / ProcessingLead, or system token (for the cron).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getTodayRoster } from "@/lib/checkin";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("systemToken") || "";
  const sysOk = Boolean(process.env.AUTH_RECOVERY_TOKEN) && token === process.env.AUTH_RECOVERY_TOKEN;
  let companyId = url.searchParams.get("companyId") || "newton";
  if (!sysOk) {
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff" || !["Admin", "Marketing", "ProcessingLead"].includes(user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    companyId = user.companyId;
  }
  const roster = await getTodayRoster(companyId);
  return NextResponse.json({ ok: true, ...roster });
}
