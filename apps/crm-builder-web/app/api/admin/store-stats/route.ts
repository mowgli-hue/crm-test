// app/api/admin/store-stats/route.ts
//
// Read-only diagnostic: how big is the single JSON store, and what's bloating
// it? Returns the total size, the biggest collections, and how much is taken up
// by WhatsApp intake sessions embedded inside cases (the usual suspect).
//
// Auth: Admin only. Safe — reads, never writes.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { readStore } from "@/lib/store";

const bytesOf = (x: unknown) => Buffer.byteLength(JSON.stringify(x ?? null), "utf8");
const mb = (n: number) => +(n / 1048576).toFixed(2);

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }

  const store = await readStore();

  const COLLECTIONS = [
    "companies", "users", "clients", "cases", "messages", "outboundMessages",
    "documents", "clientCommunications", "auditLogs", "tasks", "notifications",
    "legacyResults", "sessions", "invites", "webForms", "prConsultations", "submissions",
  ];

  let total = 0;
  const breakdown = COLLECTIONS.map((k) => {
    const v = (store as any)[k];
    const bytes = bytesOf(v);
    total += bytes;
    return { collection: k, count: Array.isArray(v) ? v.length : v ? 1 : 0, mb: mb(bytes), bytes };
  }).sort((a, b) => b.bytes - a.bytes);

  // How much of the "cases" weight is embedded WhatsApp intake sessions?
  let sessionBytes = 0;
  let casesWithSession = 0;
  let conversationTurns = 0;
  for (const c of (store.cases || [])) {
    const ws = (c as any)?.pgwpIntake?.whatsappSession;
    if (ws) {
      casesWithSession += 1;
      sessionBytes += bytesOf(ws);
      try {
        const s = typeof ws === "string" ? JSON.parse(ws) : ws;
        if (Array.isArray(s?.conversationHistory)) conversationTurns += s.conversationHistory.length;
      } catch { /* ignore */ }
    }
  }

  return NextResponse.json({
    totalStoreMB: mb(total),
    caseCount: (store.cases || []).length,
    biggestCollections: breakdown.slice(0, 8).map(({ bytes, ...rest }) => rest),
    embeddedWhatsappSessions: {
      casesWithSession,
      sessionMB: mb(sessionBytes),
      totalConversationTurns: conversationTurns,
      note: "These sessions are stored INSIDE each case. Completed ones can usually be trimmed to shrink the store.",
    },
  });
}
