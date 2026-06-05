// app/api/review-inbox/route.ts
//
// "My review items" — the systematic, always-available list of review changes
// that need the current user's action, so nobody relies on catching a transient
// notification. Two buckets:
//   • toFix   — OPEN review changes on cases assigned to me (I'm the preparer).
//   • toVerify— ADDRESSED review changes I raised (I'm the reviewer) — the
//               preparer says they're done and I need to verify & close.
//
// Auth: staff session.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listAllCases } from "@/lib/store";
import { getPool } from "@/lib/postgres-store";

export const runtime = "nodejs";

const norm = (s: unknown) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Case → assigned preparer + client (company-agnostic; single firm).
  const cases = await listAllCases();
  const caseToPreparer = new Map<string, string>();
  const caseToClient = new Map<string, string>();
  for (const c of cases) {
    caseToPreparer.set(c.id, norm((c as any).assignedTo));
    caseToClient.set(c.id, String((c as any).client || ""));
  }

  type Item = { id: string; caseId: string; client: string; text: string; reviewer: string; status: string; createdAt: string };
  const toFix: Item[] = [];
  const toVerify: Item[] = [];

  try {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, case_id, body, author_user_id, author_name, status, created_at
         FROM review_comments
        WHERE parent_id IS NULL AND status IN ('open','addressed')
        ORDER BY created_at DESC
        LIMIT 500`
    );
    const me = norm(user.name);
    const isLead = ["ProcessingLead", "Admin", "Reviewer"].includes(user.role);
    for (const r of res.rows as any[]) {
      const item: Item = {
        id: r.id, caseId: r.case_id, client: caseToClient.get(r.case_id) || r.case_id,
        text: String(r.body || "").replace(/\s+/g, " ").trim().slice(0, 200),
        reviewer: r.author_name || "Reviewer", status: r.status, createdAt: r.created_at,
      };
      const preparer = caseToPreparer.get(r.case_id) || "";
      if (r.status === "open" && preparer && preparer === me) {
        toFix.push(item); // I prepared this case and there's an open change
      } else if (r.status === "addressed" && (r.author_user_id === user.id || isLead)) {
        toVerify.push(item); // I raised it (or I'm a lead) and it's marked done
      }
    }
  } catch (e) {
    // review_comments table may not exist yet
    console.error("[review-inbox] read failed:", (e as Error).message);
  }

  return NextResponse.json({ ok: true, toFix, toVerify, total: toFix.length + toVerify.length });
}
