// app/api/admin/migrate-messages/route.ts
//
// One-time: move the in-app case messages still sitting inside the JSON store
// into the dedicated case_messages table, then clear them from the store so the
// hot-path blob shrinks. Safe order: copy to the table FIRST (idempotent —
// on conflict do nothing), and only clear the store after every row is copied.
//
// Idempotent: safe to run more than once. Auth: Admin only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { readStore, mutateStore } from "@/lib/store";
import { insertCaseMessageRow, isPostgresBackendEnabled } from "@/lib/postgres-store";

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }
  if (!isPostgresBackendEnabled()) {
    return NextResponse.json({ error: "case_messages table is only available on the Postgres backend." }, { status: 400 });
  }

  const store = await readStore();
  const msgs = Array.isArray(store.messages) ? store.messages : [];
  const total = msgs.length;
  if (total === 0) {
    return NextResponse.json({ ok: true, migrated: 0, message: "No messages in the store — nothing to migrate." });
  }

  // 1) Copy every message into the table (idempotent).
  let copied = 0;
  const failed: string[] = [];
  for (const m of msgs) {
    try {
      await insertCaseMessageRow({
        id: String(m.id),
        companyId: String(m.companyId),
        caseId: String(m.caseId),
        senderType: (m as any).senderType,
        senderName: (m as any).senderName,
        text: (m as any).text,
        createdAt: (m as any).createdAt,
      });
      copied += 1;
    } catch (e) {
      failed.push(`${m.id}: ${(e as Error).message}`);
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
    s.messages = [];
    return null;
  });

  return NextResponse.json({
    ok: true,
    migrated: copied,
    total,
    message: `Moved ${copied} messages to the case_messages table and cleared them from the store. The store blob is now smaller.`,
  });
}
