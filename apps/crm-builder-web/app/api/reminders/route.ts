import { NextRequest, NextResponse } from "next/server";
import { listCases, getLatestClientInviteForCase } from "@/lib/store";
import { sendPortalReminder, sendStaleEmailReminder } from "@/lib/whatsapp-smart-reply";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "newton";
const BASE_URL = process.env.NEXTAUTH_URL || "https://junglecrm-builder-web-production-d358.up.railway.app";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!isValidSystemToken(body.token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cases = await listCases(COMPANY_ID);
  const now = Date.now();
  const results = { portalReminders: 0, staleAlerts: 0 };

  // 1. Portal reminders — DISABLED May 2026
  //
  // This used to auto-send WhatsApp messages to clients who'd opened
  // their portal but not finished filling it in. Disabled for the same
  // reasons we killed the IRCC results auto-sender + permit-expiry
  // reminders: bot-initiated client messages without staff review carry
  // too much risk (wrong-client links, stale data, undermining staff
  // who already messaged the client manually).
  //
  // The new daily digest emailer (/api/admin/digest/run) covers the
  // staff-side equivalent — staff sees stuck cases and reaches out
  // themselves. Branch left here in case the policy is revisited.
  if (body.type === "portal" || body.type === "all") {
    // No-op: client-facing portal reminders are disabled.
  }

  // 2. Stale case email reminders — cases not updated in 7+ days
  if (body.type === "stale" || body.type === "all") {
    const STALE_DAYS = body.staleDays || 7;
    const staleCases = cases
      .filter(c => c.processingStatus !== "submitted")
      .filter(c => {
        const lastUpdate = new Date(c.updatedAt || c.createdAt || "").getTime();
        const daysSince = (now - lastUpdate) / (1000*60*60*24);
        return daysSince >= STALE_DAYS;
      })
      .map(c => ({
        id: c.id,
        client: c.client,
        formType: c.formType,
        assignedTo: c.assignedTo || "Unassigned",
        daysSinceUpdate: Math.floor((now - new Date(c.updatedAt || c.createdAt || "").getTime()) / (1000*60*60*24))
      }))
      .sort((a,b) => b.daysSinceUpdate - a.daysSinceUpdate)
      .slice(0, 20); // max 20 per email

    if (staleCases.length > 0) {
      await sendStaleEmailReminder(staleCases);
      results.staleAlerts = staleCases.length;
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
