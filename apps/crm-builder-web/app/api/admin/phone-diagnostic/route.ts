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
    // ── 1. All messages for this phone — from BOTH inbox tables ──
    //
    // Newton has two parallel WhatsApp pipelines:
    //   - whatsapp_inbox     → main number, signed-in clients, case threads
    //   - marketing_inbox    → marketing number, leads, cold outreach
    //
    // Each pipeline writes to its own table. A complaint like "we sent
    // Karandeep a checklist and he didn't get it" usually comes from the
    // marketing pipeline (cold lead, template + checklist sent), but
    // querying only whatsapp_inbox returns zero rows and makes the
    // diagnostic look broken when really it was looking in the wrong
    // place.
    //
    // We query both, normalize the row shape, and tag each row with its
    // source channel so the staff member can tell which pipeline a given
    // message went through.
    const [mainRes, marketingRes] = await Promise.all([
      pool.query(
        `SELECT id, phone, direction, message, matched_case_id, matched_case_name,
                is_read, created_at, is_archived,
                'main' AS channel
           FROM whatsapp_inbox
          WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [last9]
      ),
      pool.query(
        `SELECT id, phone, direction, message, NULL::text AS matched_case_id,
                contact_name AS matched_case_name,
                is_read, created_at, FALSE AS is_archived,
                'marketing' AS channel
           FROM marketing_inbox
          WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [last9]
      ).catch((e) => {
        // marketing_inbox may not exist in older deployments — don't fail
        // the whole diagnostic if so; just report no marketing rows.
        console.warn(`marketing_inbox query failed: ${(e as Error).message.slice(0, 100)}`);
        return { rows: [] };
      }),
    ]);

    // Merge + re-sort by created_at DESC, cap to 50.
    const messages = {
      rows: [...mainRes.rows, ...marketingRes.rows]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50),
    };

    // ── 2. Distinct phone formats stored in DB (catches format drift) ──
    // Also query both tables — format drift can happen on either side.
    const [mainFmts, mktFmts] = await Promise.all([
      pool.query(
        `SELECT phone, COUNT(*) as count, MIN(created_at) as first_seen, MAX(created_at) as last_seen
           FROM whatsapp_inbox
          WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
          GROUP BY phone
          ORDER BY count DESC`,
        [last9]
      ),
      pool.query(
        `SELECT phone, COUNT(*) as count, MIN(created_at) as first_seen, MAX(created_at) as last_seen
           FROM marketing_inbox
          WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
          GROUP BY phone
          ORDER BY count DESC`,
        [last9]
      ).catch(() => ({ rows: [] })),
    ]);
    // Combine formats from both tables — same stored phone may exist in
    // either, so dedupe by `phone` and sum counts.
    const formatMap = new Map<string, { stored: string; count: number; firstSeen: any; lastSeen: any }>();
    for (const r of [...mainFmts.rows, ...mktFmts.rows]) {
      const existing = formatMap.get(r.phone);
      if (existing) {
        existing.count += parseInt(r.count, 10);
        if (new Date(r.first_seen) < new Date(existing.firstSeen)) existing.firstSeen = r.first_seen;
        if (new Date(r.last_seen) > new Date(existing.lastSeen)) existing.lastSeen = r.last_seen;
      } else {
        formatMap.set(r.phone, {
          stored: r.phone,
          count: parseInt(r.count, 10),
          firstSeen: r.first_seen,
          lastSeen: r.last_seen,
        });
      }
    }
    const formatsRes = { rows: Array.from(formatMap.values()).sort((a, b) => b.count - a.count) };

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
          stored: r.stored,
          count: r.count,
          firstSeen: r.firstSeen,
          lastSeen: r.lastSeen,
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
        channel: r.channel,   // 'main' or 'marketing' — which pipeline the message went through
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
