import { Pool } from 'pg';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Shared utilities for Nimmi webhook receivers.
 *
 * Same pattern as the existing CRM incoming-call webhook:
 *   - X-Webhook-Secret header for auth (no user session, since Nimmi is a service)
 *   - Direct pg Pool, not the AppStore (these are independent tables)
 */

let _pool: Pool | null = null;
export function getNimmiPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return _pool;
}

/**
 * Verify the Nimmi → CRM shared secret.
 * Returns null if OK, or a NextResponse with 401/403 if not.
 */
export function verifyNimmiWebhook(req: NextRequest): NextResponse | null {
  const expected = process.env.NIMMI_WEBHOOK_SECRET || '';
  if (!expected) {
    console.error('[nimmi-webhook] NIMMI_WEBHOOK_SECRET not configured');
    return NextResponse.json(
      { error: 'Webhook receiver not configured' },
      { status: 500 }
    );
  }

  const provided = req.headers.get('x-webhook-secret') || '';
  if (provided !== expected) {
    console.warn('[nimmi-webhook] Invalid signature');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
