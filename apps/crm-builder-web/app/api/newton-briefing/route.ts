import { NextRequest, NextResponse } from "next/server";
import { listCases, listUsers, addNotification } from "@/lib/store";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { Pool } from "pg";

const SYSTEM_TOKEN = process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024";
const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.token !== SYSTEM_TOKEN) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver", weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const todayShort = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
    const cases = await listCases(COMPANY_ID);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const now = Date.now();

    // ── 1. IRCC NEWS via Claude web search ──────────────────────────────────
    let irccNews = "";
    try {
      const newsRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{
            role: "user",
            content: `Today is ${todayShort}. Search for the latest Canadian immigration news from the past 48 hours. Focus on:
1. New IRCC policy changes or announcements
2. Processing time updates for any permit type
3. New immigration programs or pathways
4. Important deadlines or changes affecting: PGWP, SOWP, Study Permits, Work Permits, Visitor Visa, PR applications
5. Any IRCC system outages or alerts

Search sites like canada.ca/ircc, cic.gc.ca, and Canadian immigration news. Provide 3-5 most important updates in bullet points. Be specific with dates and numbers.`
          }]
        })
      });
      if (newsRes.ok) {
        const newsData = await newsRes.json() as any;
        const textBlocks = newsData.content?.filter((c: any) => c.type === "text") || [];
        irccNews = textBlocks.map((c: any) => c.text).join("\n").slice(0, 1000);
      }
    } catch(e) { irccNews = "Visit www.canada.ca/ircc for latest updates."; }

    // ── 2. CASE ANALYSIS ────────────────────────────────────────────────────
    const expiringCases: any[] = [];
    const urgentCases: any[] = [];
    const staleCases: any[] = [];

    for (const c of cases) {
      if (c.isUrgent) urgentCases.push(c);
      const intake = (c.pgwpIntake || {}) as Record<string, string>;
      const permitExpiry = intake.studyPermitExpiryDate || intake.workPermitExpiryDate || (c as any).permitExpiryDate || "";
      if (permitExpiry) {
        const daysLeft = Math.floor((new Date(permitExpiry).getTime() - now) / 86400000);
        if (daysLeft >= 0 && daysLeft <= 30) expiringCases.push({ ...c, daysLeft, permitExpiry });
      }
      const lastUpdate = new Date((c as any).updatedAt || c.createdAt || "").getTime();
      const daysSince = Math.floor((now - lastUpdate) / 86400000);
      if (daysSince >= 7 && c.processingStatus !== "submitted") staleCases.push({ ...c, daysSince });
    }

    // ── 3. RECENT RESULTS ───────────────────────────────────────────────────
    const recentResults: any[] = [];
    try {
      const r = await pool.query(`SELECT * FROM submitted_apps_lookup WHERE updated_at > NOW() - INTERVAL '48 hours' ORDER BY updated_at DESC LIMIT 10`);
      recentResults.push(...r.rows);
    } catch(e) {}

    // ── 4. PIPELINE STATS ────────────────────────────────────────────────────
    const pending = cases.filter(c => (c.processingStatus || "docs_pending") === "docs_pending").length;
    const underReview = cases.filter(c => c.processingStatus === "under_review").length;

    // ── 5. BUILD BRIEFING ────────────────────────────────────────────────────
    const lines = [
      `🍁 *Newton Immigration — Daily Briefing*`,
      `📅 ${today}`,
      ``,
      `━━━━━━━━━━━━━━━`,
      `📊 *PIPELINE*`,
      `• Total Active: *${cases.length}* cases`,
      `• Docs Pending: *${pending}*`,
      `• Under Review: *${underReview}*`,
      `• 🔴 Urgent: *${urgentCases.length}*`,
    ];

    if (expiringCases.length > 0) {
      lines.push(``, `━━━━━━━━━━━━━━━`, `⚠️ *EXPIRING PERMITS*`);
      expiringCases.slice(0, 5).forEach(c => {
        const emoji = c.daysLeft <= 7 ? "🔴" : c.daysLeft <= 14 ? "🟡" : "🟢";
        lines.push(`${emoji} ${c.client} — ${c.daysLeft} days left`);
      });
    }

    if (recentResults.length > 0) {
      lines.push(``, `━━━━━━━━━━━━━━━`, `✅ *NEW RESULTS*`);
      recentResults.slice(0, 5).forEach(r => {
        const emoji = r.result?.toLowerCase().includes("approv") ? "✅" : "❌";
        lines.push(`${emoji} ${r.name} — ${r.app_type} — *${r.result}*`);
      });
    }

    if (staleCases.length > 0) {
      lines.push(``, `━━━━━━━━━━━━━━━`, `💤 *STALE CASES (7+ days)*`);
      staleCases.slice(0, 3).forEach(c => lines.push(`• ${c.client} (${c.id}) — ${c.daysSince} days`));
    }

    if (irccNews) {
      lines.push(``, `━━━━━━━━━━━━━━━`, `📰 *IRCC NEWS*`, irccNews);
    }

    lines.push(``, `— Newton AI 🤖`);
    const briefingMsg = lines.join("\n");

    // ── 6. SEND TO WHATSAPP GROUP ────────────────────────────────────────────
    const staffPhones = (process.env.STAFF_WHATSAPP_PHONES || "").split(",").filter(Boolean);
    let briefingSent = 0;
    for (const phone of staffPhones) {
      try { await sendWhatsAppText(phone.trim(), briefingMsg); briefingSent++; } catch(e) {}
    }

    // ── 7. CRM NOTIFICATIONS ─────────────────────────────────────────────────
    const users = await listUsers(COMPANY_ID);
    const admins = users.filter((u: any) => ["Admin", "ProcessingLead"].includes(u.role) && u.active !== false);
    for (const admin of admins) {
      await addNotification({
        companyId: COMPANY_ID,
        userId: admin.id,
        type: "ai_alert",
        message: `📅 Daily Briefing ${todayShort}: ${cases.length} active | ${expiringCases.length} expiring | ${recentResults.length} new results | ${urgentCases.length} urgent${irccNews ? " | 📰 IRCC news available" : ""}`
      });
    }

    // ── 8. CLIENT PERMIT REMINDERS ───────────────────────────────────────────
    //
    // Disabled May 2026 — this used to auto-send WhatsApp messages to
    // clients at 30/14/7-day permit-expiry milestones. Same risks as the
    // results auto-sender:
    //   - Wrong client matched (auto-linker damage) → wrong person reminded
    //   - Application already filed but case data stale → confusing nag
    //   - Client already in active conversation with staff who said "we're
    //     handling it" → bot's reminder undermines staff message
    //
    // New behavior: just collect the list of expiring permits in the
    // briefing summary. Staff sees them in the daily briefing and reaches
    // out themselves using the appropriate channel (call, WhatsApp from
    // inbox composer, email).
    //
    // Empty array kept for response shape compatibility.
    const reminders: string[] = [];

    await pool.end();
    return NextResponse.json({ ok: true, briefingSent, expiringCases: expiringCases.length, recentResults: recentResults.length, staleCases: staleCases.length, urgentCases: urgentCases.length, clientReminders: reminders });

  } catch(e) {
    console.error("Newton briefing error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
