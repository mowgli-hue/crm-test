// app/api/marketing-inbox/thread/route.ts
//
// The COMPLETE marketing-inbox conversation for one phone number — no 1000-row
// cap (the main inbox list is capped, which truncated older messages). Matches
// on the last 10 digits so different stored formats (+1…, 1…, (672)…) all hit.
//
//   GET ?phone=16723384375  → { phone, count, lead, messages: [...chronological] }
//
// Auth: any logged-in staff (marketing data).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgres-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const raw = new URL(request.url).searchParams.get("phone") || "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const suffix = "%" + digits.slice(-10);

  try {
    const pool = getPool();
    const msgs = await pool.query(
      `SELECT id, phone, message, direction, contact_name, is_read, created_at
         FROM marketing_inbox
        WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE $1
     ORDER BY created_at ASC
        LIMIT 5000`,
      [suffix]
    );
    let lead: any = null;
    try {
      const lr = await pool.query(
        `SELECT * FROM marketing_leads WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE $1 LIMIT 1`,
        [suffix]
      );
      lead = lr.rows[0] || null;
    } catch { /* leads table optional */ }

    return NextResponse.json({ ok: true, phone: raw, count: msgs.rows.length, lead, messages: msgs.rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
