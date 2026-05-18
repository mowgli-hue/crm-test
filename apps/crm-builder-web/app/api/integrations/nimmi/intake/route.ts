import { NextRequest, NextResponse } from 'next/server';
import { getNimmiPool, verifyNimmiWebhook } from '@/lib/nimmi/webhook-utils';

/**
 * POST /api/integrations/nimmi/intake
 *
 * Receives eligibility-submission events from Nimmi.
 */
export async function POST(req: NextRequest) {
  const authError = verifyNimmiWebhook(req);
  if (authError) return authError;

  const body = await req.json().catch(() => ({}));

  const {
    nimmi_intake_id,
    nimmi_user_id,
    email,
    phone,
    first_name,
    last_name,
    service_slug,
    eligible,
    ineligible_reason,
    answers,
    created_at,
  } = body;

  if (!nimmi_intake_id || !service_slug) {
    return NextResponse.json(
      { error: 'nimmi_intake_id and service_slug are required' },
      { status: 400 }
    );
  }

  try {
    const pool = getNimmiPool();
    await pool.query(
      `INSERT INTO nimmi_intakes (
        nimmi_intake_id, nimmi_user_id, email, phone, first_name, last_name,
        service_slug, eligible, ineligible_reason, answers, created_at_nimmi
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (nimmi_intake_id) DO UPDATE SET
        eligible = EXCLUDED.eligible,
        ineligible_reason = EXCLUDED.ineligible_reason,
        answers = EXCLUDED.answers`,
      [
        nimmi_intake_id,
        nimmi_user_id,
        email || null,
        phone || null,
        first_name || null,
        last_name || null,
        service_slug,
        Boolean(eligible),
        ineligible_reason || null,
        answers ? JSON.stringify(answers) : null,
        created_at || new Date().toISOString(),
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[nimmi-intake] DB error:', err);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
