// ─────────────────────────────────────────────────────────────────────
// POST /api/inbox/archive
//
// Archive (or unarchive) inbox rows. Two modes:
//   1. By phone — archive ALL rows for a contact (most common — declutters
//      the active inbox when a conversation is "done")
//   2. By rowId — archive a single row (rarely used)
//
// Body:
//   { phone: "12367884348", archived: true }     ← archive all of Cristo's msgs
//   { rowId: 1234, archived: true }              ← archive just one row
//   { phone: "12367884348", archived: false }    ← un-archive (move back to Active)
//
// Returns: { ok: true, updated: <count> }
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getCurrentUserFromRequest } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function POST(request: NextRequest) {
  try {
    // Staff-only: archiving inbox rows is an internal action.
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const phone: string | undefined = body?.phone;
    const rowId: number | undefined = body?.rowId;
    const archived: boolean = body?.archived !== false; // default = true (archive)

    if (!phone && !rowId) {
      return NextResponse.json(
        { ok: false, error: "Provide either 'phone' or 'rowId'" },
        { status: 400 }
      );
    }

    let result;
    if (rowId) {
      result = await pool.query(
        `UPDATE whatsapp_inbox SET is_archived = $1 WHERE id = $2`,
        [archived, rowId]
      );
    } else {
      // Normalize phone — strip + and spaces to match how rows are stored
      const normalized = String(phone).replace(/\D/g, "");
      result = await pool.query(
        `UPDATE whatsapp_inbox SET is_archived = $1 WHERE phone = $2 OR phone = $3 OR phone LIKE $4`,
        [archived, phone, normalized, `%${normalized}%`]
      );
    }

    return NextResponse.json({
      ok: true,
      updated: result.rowCount ?? 0,
      archived,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
