// app/api/results/lookup-case/route.ts
//
// Preview lookup for the "Send result to Nimmi" form. Given an application
// number (preferred) or a client name, returns the matching case so staff can
// CONFIRM who the result will go to BEFORE sending — and so the form knows
// whether it needs a manually-typed phone (for older clients the CRM has no
// record of).
//
// Returns only what's needed to confirm: the client name, form type, and the
// LAST 4 digits of the phone (masked). The real phone is re-fetched server-side
// at send time — never trusted from the client.
//
// Auth: staff session.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const appNumber = String(request.nextUrl.searchParams.get("appNumber") || "").trim();
  const name = String(request.nextUrl.searchParams.get("name") || "").trim();

  if (!appNumber && !name) {
    return NextResponse.json({ found: false });
  }

  try {
    const { listCases } = await import("@/lib/store");
    const cases = await listCases(user.companyId);
    const normApp = (s: string) => String(s || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    const normName = (s: string) => String(s || "").trim().toLowerCase();

    let match = appNumber
      ? cases.find((c) => normApp((c as any).applicationNumber) && normApp((c as any).applicationNumber) === normApp(appNumber))
      : undefined;
    let matchedBy: "application_number" | "name" | "" = match ? "application_number" : "";
    if (!match && name) {
      match = cases.find((c) => normName(c.client) === normName(name));
      if (match) matchedBy = "name";
    }

    // ── Fallback: the historical "Submitted applications" sheet ──
    // Older clients aren't cases in the CRM, but their app number + phone were
    // imported into submitted_apps. Search there if the case lookup missed.
    if (!match) {
      try {
        const { lookupSubmittedAppByNumber, lookupSubmittedAppByName } = await import("@/lib/postgres-store");
        const hit = appNumber
          ? await lookupSubmittedAppByNumber(appNumber)
          : await lookupSubmittedAppByName(name);
        if (hit) {
          const phoneDigits = String(hit.phone || "").replace(/\D/g, "");
          return NextResponse.json({
            found: true,
            matchedBy: appNumber ? "application_number" : "name",
            source: "submitted_sheet",
            caseId: "",
            clientName: hit.name || "",
            formType: hit.appType || "",
            hasPhone: phoneDigits.length > 0,
            phone: phoneDigits,
            phoneLast4: phoneDigits.slice(-4),
            hasEmail: false,
          });
        }
      } catch { /* table may not exist yet — fall through to not-found */ }
      return NextResponse.json({ found: false });
    }

    const phoneDigits = String((match as any).leadPhone || "").replace(/\D/g, "");
    return NextResponse.json({
      found: true,
      matchedBy,
      source: "crm_case",
      caseId: match.id,
      clientName: match.client || "",
      formType: match.formType || "",
      hasPhone: phoneDigits.length > 0,
      phone: phoneDigits,            // full number so staff can verify who it's going to
      phoneLast4: phoneDigits.slice(-4), // kept for backwards-compat
      hasEmail: Boolean((match as any).leadEmail),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
