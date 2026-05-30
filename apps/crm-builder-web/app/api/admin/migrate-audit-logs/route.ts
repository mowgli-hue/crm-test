// app/api/admin/migrate-audit-logs/route.ts
//
// One-time: move the audit logs that are still sitting inside the JSON store
// into the dedicated audit_logs table, then clear them from the store so the
// hot-path blob shrinks. Safe order: copy to the table FIRST (idempotent —
// on conflict do nothing), and only clear the store after every row is copied.
//
// Idempotent: safe to run more than once. Auth: Admin only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { readStore, mutateStore } from "@/lib/store";
import { insertAuditLogRow, isPostgresBackendEnabled } from "@/lib/postgres-store";

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }
  if (!isPostgresBackendEnabled()) {
    return NextResponse.json({ error: "Audit-log table is only available on the Postgres backend." }, { status: 400 });
  }

  const store = await readStore();
  const logs = Array.isArray(store.auditLogs) ? store.auditLogs : [];
  const total = logs.length;
  if (total === 0) {
    return NextResponse.json({ ok: true, migrated: 0, message: "No audit logs in the store — nothing to migrate." });
  }

  // 1) Copy every log into the table (idempotent).
  let copied = 0;
  const failed: string[] = [];
  for (const l of logs) {
    try {
      await insertAuditLogRow({
        id: String(l.id),
        companyId: String(l.companyId),
        actorUserId: (l as any).actorUserId,
        actorName: (l as any).actorName,
        action: (l as any).action,
        resourceType: (l as any).resourceType,
        resourceId: (l as any).resourceId,
        metadata: (l as any).metadata,
        createdAt: (l as any).createdAt,
      });
      copied += 1;
    } catch (e) {
      failed.push(`${l.id}: ${(e as Error).message}`);
    }
  }

  // 2) Only clear the store if EVERY row made it into the table.
  if (failed.length > 0) {
    return NextResponse.json(
      { ok: false, migrated: copied, total, error: `Some rows failed; store NOT cleared so nothing is lost.`, sampleErrors: failed.slice(0, 5) },
      { status: 500 }
    );
  }

  await mutateStore((s) => {
    s.auditLogs = [];
    return null;
  });

  return NextResponse.json({
    ok: true,
    migrated: copied,
    total,
    message: `Moved ${copied} audit logs to the audit_logs table and cleared them from the store. The store blob is now smaller.`,
  });
}
