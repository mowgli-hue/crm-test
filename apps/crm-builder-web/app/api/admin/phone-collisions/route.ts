// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/phone-collisions
//
// Finds every phone number that appears on MORE THAN ONE case. This is
// the signature of the auto-linker bug (May 2026, since fixed in
// commit d8cdfa2): the unknown-number handler was overwriting other
// cases' leadPhone via fuzzy name match. Each collision = a case that
// got the wrong phone OR a case that lost its real phone to another.
//
// Returns an array of collision groups, each with:
//   - phone (last-10-digit canonical)
//   - cases: list of cases sharing that phone, with metadata so staff
//            can see which is right and which to fix
//
// Staff opens this to triage in batch — without it, they'd need to
// remember every victim by name (impossible after dozens of calls).
//
// READ-ONLY. Doesn't change anything. Staff fixes via Edit Case.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listCases } from "@/lib/store";

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const cases = await listCases(user.companyId);

  // Group by last-10-digit phone (matches the rest of the codebase's
  // canonical phone format — handles +1 vs no prefix, formatting variants).
  const byPhone = new Map<string, Array<{
    id: string;
    client: string;
    formType: string;
    leadPhone: string;
    assignedTo: string;
    processingStatus: string;
    createdAt: string;
    updatedAt: string;
  }>>();

  for (const c of cases) {
    const raw = String(c.leadPhone || "").trim();
    if (!raw) continue;
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10) continue; // skip too-short / invalid
    const canonical = digits.slice(-10); // canonical = last 10 digits
    if (!byPhone.has(canonical)) byPhone.set(canonical, []);
    byPhone.get(canonical)!.push({
      id: c.id,
      client: c.client || "(unnamed)",
      formType: c.formType || "(no type)",
      leadPhone: raw,
      assignedTo: c.assignedTo || "Unassigned",
      processingStatus: c.processingStatus || "(unset)",
      createdAt: c.createdAt || "",
      updatedAt: c.updatedAt || "",
    });
  }

  // Filter to only collisions (2+ cases share a phone)
  const collisions = Array.from(byPhone.entries())
    .filter(([, list]) => list.length > 1)
    .map(([phone, list]) => ({
      phone,
      formattedPhone: phone.length === 10
        ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`
        : phone,
      caseCount: list.length,
      // Sort within the group: most recently updated first — usually the
      // most recently-touched case is the auto-linker victim (the bot
      // overwrote someone else's phone onto it), so the older case is
      // typically the legitimate owner.
      cases: list.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    }))
    // Sort overall by most recent activity — auto-linker damage tends to
    // cluster around when the bot was running, so recent collisions are
    // the priority cleanup.
    .sort((a, b) => {
      const aLatest = Math.max(...a.cases.map(c => new Date(c.updatedAt).getTime()));
      const bLatest = Math.max(...b.cases.map(c => new Date(c.updatedAt).getTime()));
      return bLatest - aLatest;
    });

  return NextResponse.json({
    ok: true,
    totalCasesScanned: cases.length,
    collisionGroupCount: collisions.length,
    affectedCaseCount: collisions.reduce((sum, g) => sum + g.caseCount, 0),
    collisions,
    note: "Each group is a phone shared by 2+ cases. Likely caused by the auto-linker bug (since fixed). Staff should: (1) identify which case legitimately owns the phone, (2) clear the phone from the others via Edit Case.",
  });
}
