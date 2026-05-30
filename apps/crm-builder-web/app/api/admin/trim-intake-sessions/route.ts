// app/api/admin/trim-intake-sessions/route.ts
//
// One-time / on-demand: shrink the JSON store by stripping the embedded WhatsApp
// intake transcripts that bloat each case. The transcript (conversationHistory)
// is REDUNDANT — the live copy is in the whatsapp_inbox table and completed
// intakes are exported to Drive, and the restart-guard reads pgwpIntake-level
// flags, not the embedded session. migrateStore() already trims on read; this
// endpoint forces the trimmed state to PERSIST (a write) and reports the saving.
//
// Idempotent: safe to run repeatedly. Auth: Admin only. Never deletes a case.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { mutateStore } from "@/lib/store";

const bytesOf = (x: unknown) => Buffer.byteLength(JSON.stringify(x ?? null), "utf8");
const mb = (n: number) => +(n / 1048576).toFixed(2);

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }

  // readStore() inside mutateStore has already run migrateStore, which trims the
  // embedded sessions. So by the time we see the store here, completed sessions
  // are "" and stale ones have empty conversationHistory. We just measure what's
  // left, write it through so the trim is durable, and report the result.
  const result = await mutateStore((store) => {
    const cases = Array.isArray(store.cases) ? store.cases : [];
    let casesWithSession = 0;
    let remainingSessionBytes = 0;
    let remainingTurns = 0;

    for (const c of cases) {
      const raw = (c as any)?.pgwpIntake?.whatsappSession;
      if (typeof raw === "string" && raw.length > 0) {
        casesWithSession += 1;
        remainingSessionBytes += Buffer.byteLength(raw, "utf8");
        try {
          const s = JSON.parse(raw);
          if (Array.isArray(s?.conversationHistory)) remainingTurns += s.conversationHistory.length;
        } catch { /* ignore */ }
      }
    }

    return {
      caseCount: cases.length,
      casesStillCarryingSession: casesWithSession,
      remainingSessionMB: mb(remainingSessionBytes),
      remainingConversationTurns: remainingTurns,
      casesMB: mb(bytesOf(cases)),
    };
  });

  return NextResponse.json({
    ok: true,
    ...result,
    message:
      "Embedded intake transcripts trimmed and persisted. Completed intakes are " +
      "cleared; abandoned ones (>21 days) keep their answers but drop the transcript. " +
      "Re-run /api/admin/store-stats to confirm the new total.",
  });
}
