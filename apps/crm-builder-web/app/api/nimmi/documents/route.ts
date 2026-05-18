import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getNimmiPool } from '@/lib/nimmi/webhook-utils';

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const pool = getNimmiPool();
    const url = new URL(req.url);
    const userId = url.searchParams.get('user_id');

    const params: unknown[] = [];
    const whereClauses: string[] = [];
    if (userId) {
      params.push(userId);
      whereClauses.push(`nimmi_user_id = $${params.length}`);
    }

    const sql = `
      SELECT * FROM nimmi_documents
      ${whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : ''}
      ORDER BY shared_at DESC
      LIMIT 200
    `;

    const res = await pool.query(sql, params);
    return NextResponse.json({ rows: res.rows });
  } catch (err) {
    console.error('[nimmi/documents] error:', err);
    return NextResponse.json({ rows: [], error: String(err) });
  }
}
