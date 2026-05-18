import { NextRequest, NextResponse } from 'next/server';
import { getNimmiPool, verifyNimmiWebhook } from '@/lib/nimmi/webhook-utils';

/**
 * POST /api/integrations/nimmi/document
 *
 * Receives document-shared events from Nimmi.
 */
export async function POST(req: NextRequest) {
  const authError = verifyNimmiWebhook(req);
  if (authError) return authError;

  const body = await req.json().catch(() => ({}));

  const {
    nimmi_document_id,
    nimmi_user_id,
    email,
    phone,
    first_name,
    last_name,
    category,
    display_name,
    original_filename,
    storage_key,
    storage_bucket,
    share_note,
    shared_at,
  } = body;

  if (!nimmi_document_id || !storage_key) {
    return NextResponse.json(
      { error: 'nimmi_document_id and storage_key are required' },
      { status: 400 }
    );
  }

  try {
    const pool = getNimmiPool();
    await pool.query(
      `INSERT INTO nimmi_documents (
        nimmi_document_id, nimmi_user_id, email, phone, first_name, last_name,
        category, display_name, original_filename, storage_key, storage_bucket,
        share_note, shared_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (nimmi_document_id) DO UPDATE SET
        share_note = COALESCE(EXCLUDED.share_note, nimmi_documents.share_note)`,
      [
        nimmi_document_id,
        nimmi_user_id,
        email || null,
        phone || null,
        first_name || null,
        last_name || null,
        category || null,
        display_name || null,
        original_filename || null,
        storage_key,
        storage_bucket || null,
        share_note || null,
        shared_at || new Date().toISOString(),
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[nimmi-document] DB error:', err);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
