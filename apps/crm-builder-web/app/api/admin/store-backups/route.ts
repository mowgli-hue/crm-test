// app/api/admin/store-backups/route.ts
//
// Admin-only access to the rolling store backups (app_store_backups).
//
//   GET  → list recent backups (id + timestamp) so an admin can see restore points.
//   POST → restore the live store from a chosen backup id. DESTRUCTIVE, so it
//          requires Admin + an explicit { confirm: "RESTORE" } in the body. The
//          restore helper snapshots the current state first, so a mistaken
//          restore is itself reversible.
//
// Auth: Admin only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listStoreBackups, restoreStoreFromBackup, isPostgresBackendEnabled } from "@/lib/postgres-store";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }
  if (!isPostgresBackendEnabled()) {
    return NextResponse.json({ error: "Backups are only available on the Postgres backend." }, { status: 400 });
  }
  try {
    const backups = await listStoreBackups();
    return NextResponse.json({ backups });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }
  if (!isPostgresBackendEnabled()) {
    return NextResponse.json({ error: "Backups are only available on the Postgres backend." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { backupId?: string; confirm?: string };
  const backupId = String(body.backupId || "").trim();
  if (!backupId) {
    return NextResponse.json({ error: "backupId is required" }, { status: 400 });
  }
  // Destructive — require an explicit confirmation string so this can't fire by
  // accident (a stray POST won't overwrite the live store).
  if (body.confirm !== "RESTORE") {
    return NextResponse.json(
      { error: 'This overwrites the live store. Re-send with { "confirm": "RESTORE" } to proceed.' },
      { status: 400 }
    );
  }

  try {
    await restoreStoreFromBackup(backupId);
    console.warn(`♻️  Store restored from backup ${backupId} by ${user.name} (${user.email}).`);
    return NextResponse.json({ ok: true, restoredFrom: backupId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
