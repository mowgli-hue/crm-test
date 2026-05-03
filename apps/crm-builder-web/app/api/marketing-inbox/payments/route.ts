// /api/marketing-inbox/payments — payment summary indexed by phone.
//
// Used by the Marketing Inbox left thread list to show a small "$X paid"
// tag next to each thread that has any payment record (manual entry or
// case-linked payment).
//
// Returns a map: { "16041234567": { paid: 315, source: "manual"|"case" }, ... }
//
// Two data sources merged:
//   1. manual_payments table — fees recorded via Accounting "+ Add Entry"
//   2. cases JSONB — for cases that match this phone, sum amountPaid
//
// Phone matching is on last-10-digits since some sources include "1" prefix
// and some don't. Whatever stored format we use should resolve.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Strip non-digits, take last 10. Used as a stable key across all sources.
function lastTen(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-10);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Aggregate per-phone payment data. We accumulate into a map keyed by
  // last-10-digit phone so different stored formats normalize cleanly.
  const summary: Record<string, { paidTotal: number; outstandingTotal: number; sources: string[]; clientName?: string }> = {};

  // ── Source 1: manual_payments table ──
  // Each row = a manual entry from Accounting screen. Sum by phone.
  // We don't have a phone column on manual_payments — but client_name often
  // matches what's on a case OR is bare (just a name). We'll cross-reference
  // against marketing_inbox + cases by name later if needed. For now, we
  // need to add the phone-lookup logic differently.
  //
  // Quick fix: manual_payments doesn't store phone. So this source can only
  // match via client_name → which is fragile. For v1, we'll skip manual
  // entries unless we add a phone column. Better to be honest about scope.
  //
  // Source 2 below works directly from case data which already has phones.

  // ── Source 2: cases ──
  // Cases store `phone` and `amountPaid` directly. Map by phone, sum payments.
  // Outstanding = retainerAmount - amountPaid (or totalCharges if no retainer).
  try {
    const { listCases } = await import("@/lib/store");
    const cases = await listCases(user.companyId);
    for (const c of cases) {
      const phone = (c as any).phone || (c as any).leadPhone || "";
      if (!phone) continue;
      const last = lastTen(phone);
      if (!last) continue;
      const paid = Number((c as any).amountPaid || 0);
      const total = Number(c.servicePackage?.retainerAmount || (c as any).totalCharges || 0);
      const outstanding = Math.max(0, total - paid);
      if (!summary[last]) {
        summary[last] = { paidTotal: 0, outstandingTotal: 0, sources: [], clientName: c.client };
      }
      summary[last].paidTotal += paid;
      summary[last].outstandingTotal += outstanding;
      if (!summary[last].sources.includes("case")) summary[last].sources.push("case");
      if (!summary[last].clientName && c.client) summary[last].clientName = c.client;
    }
  } catch (e) {
    console.error("Payment summary case lookup failed:", (e as Error).message);
  }

  // ── Source 3: manual_payments — best effort match by client_name
  // We cross-reference manual entries against case clients to attribute them
  // to a phone. Imperfect but useful: if "Aman Kumar" exists as a case AND
  // a manual entry, the manual entry's amount is added to Aman Kumar's case
  // phone bucket.
  try {
    const m = await pool.query(`
      SELECT client_name, SUM(amount) as total
      FROM manual_payments
      WHERE company_id = $1
      GROUP BY client_name
    `, [user.companyId]).catch(() => ({ rows: [] }));

    if (m.rows.length > 0) {
      // Build a name → phone-last-10 lookup from existing summary entries
      const nameLookup: Record<string, string> = {};
      for (const [phoneLast10, data] of Object.entries(summary)) {
        if (data.clientName) nameLookup[data.clientName.toLowerCase().trim()] = phoneLast10;
      }
      for (const row of m.rows) {
        const lookupKey = String(row.client_name || "").toLowerCase().trim();
        const phoneLast10 = nameLookup[lookupKey];
        if (!phoneLast10) continue; // Manual entry doesn't match any known case
        const amount = Number(row.total || 0);
        summary[phoneLast10].paidTotal += amount;
        summary[phoneLast10].outstandingTotal = Math.max(0, summary[phoneLast10].outstandingTotal - amount);
        if (!summary[phoneLast10].sources.includes("manual")) summary[phoneLast10].sources.push("manual");
      }
    }
  } catch (e) {
    console.error("Payment summary manual entry lookup failed:", (e as Error).message);
  }

  return NextResponse.json({ summary });
}
