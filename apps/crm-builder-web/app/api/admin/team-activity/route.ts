// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/team-activity?idle=30
//
// Manager-only live floor view: for every staff member, are they punched into
// a case right now (and how long), or idle (and since when), plus today's hours
// and the last status they reported. Lets a lead see at a glance who's working,
// who's stalled, and who hasn't started.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { canSeeAllCases } from "@/lib/rbac";
import { listAllStaff } from "@/lib/store";
import { teamActivity } from "@/lib/time-tracking";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!canSeeAllCases(user.role)) {
    return NextResponse.json({ error: "Forbidden — managers only" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const idleRaw = parseInt(url.searchParams.get("idle") || "", 10);
    const idleThreshold = Number.isFinite(idleRaw) && idleRaw > 0 ? idleRaw : 30;

    const users = await listAllStaff();
    // Exclude deactivated accounts. Keep the stable id (= staff_id on time logs).
    const staff = users
      .filter((u: any) => u.active !== false)
      .map((u: any) => ({ id: u.id, name: u.name || u.email || u.id, role: u.role || "" }));

    const rows = await teamActivity(staff, idleThreshold);

    // Surface order: active first (longest first), then idle (longest idle
    // first), then offline. So a lead's eye lands on who's stuck/not started.
    const rank = (s: string) => (s === "active" ? 0 : s === "idle" ? 1 : 2);
    rows.sort((a, b) => {
      if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
      if (a.status === "active") return b.activeMinutes - a.activeMinutes;
      if (a.status === "idle") return b.idleMinutes - a.idleMinutes;
      return a.staffName.localeCompare(b.staffName);
    });

    const summary = {
      active: rows.filter((r) => r.status === "active").length,
      idle: rows.filter((r) => r.status === "idle").length,
      offline: rows.filter((r) => r.status === "offline").length,
      idleThresholdMin: idleThreshold,
    };

    return NextResponse.json({ ok: true, summary, members: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
