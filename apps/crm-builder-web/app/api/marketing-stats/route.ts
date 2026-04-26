import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Stage counts
    const stageRes = await pool.query(`
      SELECT stage, COUNT(*)::int as count
      FROM marketing_leads
      GROUP BY stage
    `);
    const byStage: Record<string, number> = { new: 0, contacted: 0, consultation_booked: 0, consultation_done: 0, converted: 0, lost: 0 };
    for (const row of stageRes.rows) byStage[row.stage] = row.count;

    // Source counts
    const sourceRes = await pool.query(`
      SELECT COALESCE(source, 'unknown') as source, COUNT(*)::int as count
      FROM marketing_leads
      GROUP BY source
      ORDER BY count DESC
    `);

    // Today's stats
    const todayRes = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM marketing_leads WHERE created_at::date = CURRENT_DATE) AS new_today,
        (SELECT COUNT(*)::int FROM marketing_leads WHERE next_follow_up <= CURRENT_DATE AND stage NOT IN ('converted','lost')) AS due_followups,
        (SELECT COUNT(*)::int FROM marketing_leads WHERE stage = 'converted' AND updated_at::date = CURRENT_DATE) AS converted_today,
        (SELECT COUNT(*)::int FROM marketing_inbox WHERE direction = 'inbound' AND is_read = FALSE) AS unread_messages,
        (SELECT COUNT(*)::int FROM marketing_inbox WHERE direction = 'inbound' AND created_at::date = CURRENT_DATE) AS inbound_today
    `);
    const today = todayRes.rows[0];

    // Conversion rate
    const total = Object.values(byStage).reduce((a, b) => a + b, 0);
    const conversionRate = total > 0 ? Math.round((byStage.converted / total) * 100) : 0;

    // Recent activity — last 14 days of new leads
    const trendRes = await pool.query(`
      SELECT created_at::date AS day, COUNT(*)::int AS count
      FROM marketing_leads
      WHERE created_at >= CURRENT_DATE - INTERVAL '13 days'
      GROUP BY day
      ORDER BY day ASC
    `);

    return NextResponse.json({
      byStage,
      bySource: sourceRes.rows,
      today,
      conversionRate,
      total,
      trend: trendRes.rows,
    });
  } catch (e) {
    console.error("Stats error:", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
