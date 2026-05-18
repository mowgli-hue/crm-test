import { NextRequest, NextResponse } from 'next/server';
import { getNimmiPool, verifyNimmiWebhook } from '@/lib/nimmi/webhook-utils';

/**
 * POST /api/integrations/nimmi/callback
 *
 * Receives callback-request events from Nimmi.
 */
export async function POST(req: NextRequest) {
  const authError = verifyNimmiWebhook(req);
  if (authError) return authError;

  const body = await req.json().catch(() => ({}));

  const {
    nimmi_callback_id,
    nimmi_user_id,
    email,
    phone,
    first_name,
    last_name,
    service_slug,
    preferred_time,
    preferred_contact,
    message,
    created_at,
  } = body;

  if (!nimmi_callback_id || !nimmi_user_id) {
    return NextResponse.json(
      { error: 'nimmi_callback_id and nimmi_user_id are required' },
      { status: 400 }
    );
  }

  try {
    const pool = getNimmiPool();
    await pool.query(
      `INSERT INTO nimmi_callbacks (
        nimmi_callback_id, nimmi_user_id, email, phone, first_name, last_name,
        service_slug, preferred_time, preferred_contact, message, created_at_nimmi
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (nimmi_callback_id) DO UPDATE SET
        preferred_time = COALESCE(EXCLUDED.preferred_time, nimmi_callbacks.preferred_time),
        preferred_contact = COALESCE(EXCLUDED.preferred_contact, nimmi_callbacks.preferred_contact),
        message = COALESCE(EXCLUDED.message, nimmi_callbacks.message)`,
      [
        nimmi_callback_id,
        nimmi_user_id,
        email || null,
        phone || null,
        first_name || null,
        last_name || null,
        service_slug || null,
        preferred_time || null,
        preferred_contact || null,
        message || null,
        created_at || new Date().toISOString(),
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[nimmi-callback] DB error:', err);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
