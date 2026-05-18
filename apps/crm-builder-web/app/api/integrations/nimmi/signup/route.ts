import { NextRequest, NextResponse } from 'next/server';
import { getNimmiPool, verifyNimmiWebhook } from '@/lib/nimmi/webhook-utils';

/**
 * POST /api/integrations/nimmi/signup
 *
 * Receives signup events from Nimmi (when a new user signs up via Clerk).
 * Auth: X-Webhook-Secret header.
 */
export async function POST(req: NextRequest) {
  const authError = verifyNimmiWebhook(req);
  if (authError) return authError;

  const body = await req.json().catch(() => ({}));

  const {
    nimmi_user_id,
    clerk_id,
    email,
    phone,
    first_name,
    last_name,
    signed_up_at,
  } = body;

  if (!nimmi_user_id || !email) {
    return NextResponse.json(
      { error: 'nimmi_user_id and email are required' },
      { status: 400 }
    );
  }

  try {
    const pool = getNimmiPool();
    await pool.query(
      `INSERT INTO nimmi_signups (
        nimmi_user_id, clerk_id, email, phone, first_name, last_name, signed_up_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (nimmi_user_id) DO UPDATE SET
        email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, nimmi_signups.phone),
        first_name = COALESCE(EXCLUDED.first_name, nimmi_signups.first_name),
        last_name = COALESCE(EXCLUDED.last_name, nimmi_signups.last_name)`,
      [
        nimmi_user_id,
        clerk_id || null,
        email,
        phone || null,
        first_name || null,
        last_name || null,
        signed_up_at || new Date().toISOString(),
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[nimmi-signup] DB error:', err);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
