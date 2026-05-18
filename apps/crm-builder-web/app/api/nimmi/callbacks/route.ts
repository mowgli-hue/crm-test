import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getNimmiPool } from '@/lib/nimmi/webhook-utils';

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const pool = getNimmiPool();
    const url = new URL(req.url);
    const status = url.searchParams.get('status');

    const whereClauses: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      whereClauses.push(`status = $${params.length}`);
    }

    const sql = `
      SELECT * FROM nimmi_callbacks
      ${whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : ''}
      ORDER BY created_at_nimmi DESC
      LIMIT 200
    `;

    const res = await pool.query(sql, params);
    return NextResponse.json({ rows: res.rows });
  } catch (err) {
    console.error('[nimmi/callbacks] error:', err);
    return NextResponse.json({ rows: [], error: String(err) });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const { status, notes, converted_case_id } = body;

  try {
    const pool = getNimmiPool();
    const params: unknown[] = [id];
    const sets: string[] = [];

    if (typeof status === 'string') {
      params.push(status);
      sets.push(`status = $${params.length}`);
      if (status === 'done' || status === 'handled') {
        params.push(user.name || 'staff');
        sets.push(`handled_by = $${params.length}`);
        sets.push(`handled_at = NOW()`);
      }
    }
    if (typeof notes === 'string') {
      params.push(notes);
      sets.push(`notes = $${params.length}`);
    }
    if (typeof converted_case_id === 'string') {
      params.push(converted_case_id);
      sets.push(`converted_case_id = $${params.length}`);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    const res = await pool.query(
      `UPDATE nimmi_callbacks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    return NextResponse.json({ row: res.rows[0] });
  } catch (err) {
    console.error('[nimmi/callbacks PATCH] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
