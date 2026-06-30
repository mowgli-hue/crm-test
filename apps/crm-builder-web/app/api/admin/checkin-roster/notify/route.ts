// POST /api/admin/checkin-roster/notify — WhatsApp the morning roster (who's in /
// who hasn't checked in) to the alert recipients. Meant for a mid-morning cron.
// Admin or system token.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getTodayRoster } from "@/lib/checkin";
import { listAlertRecipients } from "@/lib/store";
import { sendWhatsAppText } from "@/lib/whatsapp";

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("systemToken") || "";
  const sysOk = Boolean(process.env.AUTH_RECOVERY_TOKEN) && token === process.env.AUTH_RECOVERY_TOKEN;
  let companyId = url.searchParams.get("companyId") || "newton";
  if (!sysOk) {
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff" || user.role !== "Admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    companyId = user.companyId;
  }

  const roster = await getTodayRoster(companyId);
  const inList = roster.checkedIn.map((e) => e.name).join(", ") || "—";
  const outList = roster.notYet.map((e) => e.name).join(", ") || "everyone's in 🎉";
  const msg =
    `🕘 Newton check-in (${new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })})\n` +
    `✅ In (${roster.checkedIn.length}): ${inList}\n` +
    `⛔ Not yet (${roster.notYet.length}): ${outList}`;

  const recipients = (await listAlertRecipients()).filter((r) => r.active).map((r) => r.phone);
  const envNumbers = String(process.env.OWNER_ALERT_WHATSAPP || "").split(",").map((s) => s.replace(/\D/g, "")).filter((n) => n.length >= 10);
  const numbers = Array.from(new Set([...recipients, ...envNumbers]));
  let sent = 0;
  for (const n of numbers) {
    try { const r = await sendWhatsAppText(n, msg); if (r?.success) sent++; } catch { /* noop */ }
  }
  return NextResponse.json({ ok: true, sent, ...roster });
}
