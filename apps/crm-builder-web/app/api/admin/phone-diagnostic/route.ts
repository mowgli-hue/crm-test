// ─────────────────────────────────────────────────────────────────────
// GET /api/admin/phone-diagnostic?phone=17789548517
//
// Full diagnostic on a single phone number's WhatsApp history. Built to
// investigate "we sent but they didn't receive" complaints. Returns:
//
//   {
//     phone: { input, last9, formats: [...] },
//     summary: {
//       totalMessages, inboundCount, outboundCount,
//       firstSeenAt, lastInboundAt, lastOutboundAt,
//       hoursSinceLastInbound, insideWindow,
//     },
//     matchedCases: [{ id, client, formType, leadPhone, ...}],
//     recentMessages: [{ direction, message_preview, created_at, id }, ...]
//   }
//
// Read-only. Admin-only. Doesn't modify anything.
//
// Use case: staff says "Sawan never got our message". This endpoint
// shows:
//   - Was the message actually written to the DB? (yes = we tried to send)
//   - When did the client last respond? (24h window status)
//   - Are there multiple cases linked to this phone? (auto-linker damage)
//   - What's the phone stored as? (format issues)
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listCases } from "@/lib/store";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const rawPhone = new URL(req.url).searchParams.get("phone");
  if (!rawPhone) {
    return NextResponse.json({ error: "phone required" }, { status: 400 });
  }

  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 9) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }
  const last9 = digits.slice(-9);

  try {
    // ── 1. All messages for this phone (last 50, both directions) ──
    const messages = await pool.query(
      `SELECT id, phone, direction, message, matched_case_id, matched_case_name, is_read, created_at, is_archived
         FROM whatsapp_inbox
        WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [last9]
    );

    // ── 2. Distinct phone formats stored in DB (catches format drift) ──
    const formatsRes = await pool.query(
      `SELECT phone, COUNT(*) as count, MIN(created_at) as first_seen, MAX(created_at) as last_seen
         FROM whatsapp_inbox
        WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
        GROUP BY phone
        ORDER BY count DESC`,
      [last9]
    );

    // ── 3. Cases linked to this phone ──
    const cases = await listCases(user.companyId);
    const matchedCases = cases
      .filter((c) => {
        const cd = String(c.leadPhone || "").replace(/\D/g, "");
        return cd && cd.slice(-9) === last9;
      })
      .map((c) => ({
        id: c.id,
        client: c.client,
        formType: c.formType,
        leadPhone: c.leadPhone,
        assignedTo: c.assignedTo,
        processingStatus: c.processingStatus,
        updatedAt: c.updatedAt,
      }));

    // ── 4. Summary stats ──
    const rows = messages.rows;
    const inbound = rows.filter((r) => r.direction === "inbound");
    const outbound = rows.filter((r) => r.direction === "outbound");
    const lastInbound = inbound[0]; // already sorted DESC by created_at
    const lastOutbound = outbound[0];
    const firstSeen = rows[rows.length - 1]?.created_at || null;
    const hoursSinceLastInbound = lastInbound
      ? (Date.now() - new Date(lastInbound.created_at).getTime()) / (1000 * 60 * 60)
      : Infinity;

    return NextResponse.json({
      ok: true,
      phone: {
        input: rawPhone,
        last9,
        formats: formatsRes.rows.map((r) => ({
          stored: r.phone,
          count: parseInt(r.count, 10),
          firstSeen: r.first_seen,
          lastSeen: r.last_seen,
        })),
      },
      summary: {
        totalMessages: rows.length,
        inboundCount: inbound.length,
        outboundCount: outbound.length,
        firstSeenAt: firstSeen,
        lastInboundAt: lastInbound?.created_at || null,
        lastOutboundAt: lastOutbound?.created_at || null,
        hoursSinceLastInbound: lastInbound ? Math.round(hoursSinceLastInbound * 10) / 10 : null,
        insideWindow: hoursSinceLastInbound < 23.5,
      },
      matchedCases,
      recentMessages: rows.slice(0, 25).map((r) => ({
        id: r.id,
        direction: r.direction,
        preview: String(r.message || "").slice(0, 200),
        full_length: String(r.message || "").length,
        matched_case_id: r.matched_case_id,
        matched_case_name: r.matched_case_name,
        is_read: r.is_read,
        is_archived: r.is_archived,
        created_at: r.created_at,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `DB error: ${(e as Error).message.slice(0, 200)}` },
      { status: 500 }
    );
  }
}
