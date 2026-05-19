// CRM payment-submitted webhook receiver
// File path: app/api/integrations/nimmi/payment-submitted/route.ts

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Inline helpers to avoid path-resolution issues across CRM project structures.
// If you already have getNimmiPool / verifyWebhookSecret, replace these inline copies
// with your imports.

import { Pool } from "pg";

let _pool: Pool | null = null;
function getNimmiPool(): Pool {
  if (_pool) return _pool;
  const connString = process.env.DATABASE_URL || process.env.PG_URL;
  if (!connString) throw new Error("DATABASE_URL not set");
  _pool = new Pool({
    connectionString: connString,
    ssl: { rejectUnauthorized: false },
  });
  return _pool;
}

function verifyWebhookSecret(req: NextRequest): boolean {
  const secret = process.env.NIMMI_WEBHOOK_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-webhook-secret");
  return provided === secret;
}

export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    nimmi_payment_id,
    nimmi_user_id,
    email,
    first_name,
    last_name,
    phone,
    services,
    amount,
    base_price,
    discount_amount,
    payment_reference,
    scan_status,
    scan_detected_amount,
    scan_detected_recipient,
    scan_notes,
  } = body;

  if (!nimmi_payment_id || !nimmi_user_id || !amount) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const pool = getNimmiPool();

    await pool.query(
      `INSERT INTO nimmi_payments (
        nimmi_payment_id, nimmi_user_id, email, first_name, last_name, phone,
        services, base_price, discount_amount, final_amount, payment_reference,
        scan_status, scan_detected_amount, scan_detected_recipient, scan_notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (nimmi_payment_id) DO UPDATE SET
        services = EXCLUDED.services,
        base_price = EXCLUDED.base_price,
        discount_amount = EXCLUDED.discount_amount,
        final_amount = EXCLUDED.final_amount,
        scan_status = EXCLUDED.scan_status,
        scan_detected_amount = EXCLUDED.scan_detected_amount,
        scan_detected_recipient = EXCLUDED.scan_detected_recipient,
        scan_notes = EXCLUDED.scan_notes,
        updated_at = NOW()`,
      [
        nimmi_payment_id,
        nimmi_user_id,
        email || null,
        first_name || null,
        last_name || null,
        phone || null,
        JSON.stringify(services || []),
        base_price || amount,
        discount_amount || 0,
        amount,
        payment_reference || null,
        scan_status || "pending",
        scan_detected_amount || null,
        scan_detected_recipient || null,
        scan_notes || null,
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[nimmi/payment-submitted]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
