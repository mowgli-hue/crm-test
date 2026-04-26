import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "1047138985153613";
const WA_TOKEN = process.env.WHATSAPP_TOKEN || "";

// POST /api/marketing-broadcast
// Body: {
//   message: string                  // supports {name} and {phone} placeholders
//   filter?: { stage?, source?, tags?, dueToday?: bool }
//   phones?: string[]                // explicit list (overrides filter)
//   throttleMs?: number              // default 800ms between sends
// }
export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only Admin and Marketing can broadcast
  const role = String(user.role || "").toLowerCase();
  if (role !== "admin" && role !== "marketing") {
    return NextResponse.json({ error: "Forbidden — Admin or Marketing role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { message, filter, phones: explicitPhones, throttleMs } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: "Message exceeds WhatsApp 4000-char limit" }, { status: 400 });
  }

  const throttle = Math.max(200, Math.min(5000, Number(throttleMs) || 800));

  try {
    let recipients: { phone: string; contact_name: string | null }[] = [];

    if (Array.isArray(explicitPhones) && explicitPhones.length) {
      // Explicit list — fetch names for personalization
      const cleaned = explicitPhones.map((p: string) => String(p).replace(/\s+/g, "")).filter(Boolean);
      if (cleaned.length === 0) return NextResponse.json({ error: "No valid phones" }, { status: 400 });
      const r = await pool.query(
        `SELECT phone, contact_name FROM marketing_leads WHERE phone = ANY($1::text[])`,
        [cleaned]
      );
      const byPhone = new Map(r.rows.map((row: any) => [row.phone, row]));
      recipients = cleaned.map(p => byPhone.get(p) || { phone: p, contact_name: null });
    } else {
      // Filter-based
      const where: string[] = [];
      const params: any[] = [];
      if (filter?.stage) { params.push(filter.stage); where.push(`stage = $${params.length}`); }
      if (filter?.source) { params.push(filter.source); where.push(`source = $${params.length}`); }
      if (Array.isArray(filter?.tags) && filter.tags.length) {
        params.push(filter.tags); where.push(`tags && $${params.length}::text[]`);
      }
      if (filter?.dueToday) where.push(`next_follow_up <= CURRENT_DATE`);

      // Don't broadcast to converted or lost leads by default — they shouldn't get marketing pushes
      where.push(`stage NOT IN ('converted', 'lost')`);

      const sql = `SELECT phone, contact_name FROM marketing_leads ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT 1000`;
      const r = await pool.query(sql, params);
      recipients = r.rows;
    }

    if (recipients.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, failed: 0, recipients: 0 });
    }

    if (recipients.length > 250) {
      return NextResponse.json({ error: `Too many recipients (${recipients.length}) — max 250 per broadcast. Narrow the filter.` }, { status: 400 });
    }

    let sent = 0;
    let failed = 0;
    const failures: { phone: string; error: string }[] = [];

    for (const r of recipients) {
      const personalized = message
        .replace(/\{name\}/g, r.contact_name || "there")
        .replace(/\{phone\}/g, r.phone);

      try {
        const cleanedPhone = r.phone.replace(/\D/g, "");
        if (!cleanedPhone) { failed++; failures.push({ phone: r.phone, error: "invalid phone" }); continue; }

        const res = await fetch(`https://graph.facebook.com/v18.0/${MARKETING_PHONE_ID}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: cleanedPhone,
            type: "text",
            text: { body: personalized }
          })
        });

        if (res.ok) {
          sent++;
          const id = `mkt-bcast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await pool.query(
            `INSERT INTO marketing_inbox (id, phone, message, direction, is_read, created_at)
             VALUES ($1,$2,$3,'outbound',TRUE,NOW())`,
            [id, r.phone, personalized]
          );
        } else {
          failed++;
          const errText = await res.text().catch(() => "");
          failures.push({ phone: r.phone, error: `${res.status}: ${errText.slice(0, 100)}` });
        }
      } catch (err) {
        failed++;
        failures.push({ phone: r.phone, error: (err as Error).message });
      }

      // Throttle to avoid WhatsApp rate limits
      if (recipients.indexOf(r) < recipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, throttle));
      }
    }

    return NextResponse.json({ ok: true, sent, failed, recipients: recipients.length, failures: failures.slice(0, 20) });
  } catch (e) {
    console.error("Broadcast error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
