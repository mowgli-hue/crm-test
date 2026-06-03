// app/api/results/sent-log/route.ts
//
// The running record of every result/submission/letter sent to a client over
// WhatsApp — captured at send time so there's a trail (phone + details) even
// before the client replies and opens the 24h window.
//
//   GET            → { rows: [...] }              (JSON, newest first)
//   GET ?format=csv → text/csv download
//
// Auth: staff session.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listSentResultsLog } from "@/lib/postgres-store";

export const runtime = "nodejs";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") || "json").toLowerCase();
  const limit = Number(url.searchParams.get("limit") || 1000);
  const rows = await listSentResultsLog(limit);

  if (format === "csv") {
    const headers = [
      "Sent at", "Client", "Phone", "Email", "App number", "Type",
      "Service", "Delivered", "Delivery error", "Sent by", "Share link",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push([
        r.createdAt ? new Date(r.createdAt).toISOString() : "",
        r.clientName || "",
        r.phone || "",
        r.email || "",
        r.appNumber || "",
        r.resultType || "",
        r.serviceSlug || "",
        r.delivered ? "yes" : "no",
        r.deliveryError || "",
        r.sentBy || "",
        r.shareUrl || "",
      ].map(csvCell).join(","));
    }
    const csv = lines.join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sent-results-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ ok: true, rows });
}
