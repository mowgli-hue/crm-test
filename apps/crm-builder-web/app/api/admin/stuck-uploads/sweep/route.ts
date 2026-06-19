// ─────────────────────────────────────────────────────────────────────
// GET|POST /api/admin/stuck-uploads/sweep
//
// Self-healing recovery for WhatsApp uploads that got stuck at "Uploading…"
// (the inline webhook download was torn down before the file saved). Finds
// recent stuck inbox rows that carry a Meta mediaId and re-drives each one:
// download → S3 → fix the inbox row → create the CRM document record.
//
// Auth: cron system token (?systemToken=XXX) OR a logged-in Admin/Lead, so it
// can run on a schedule AND be triggered manually as "recover now".
//
// Schedule (Railway cron / external scheduler), every few minutes:
//   GET https://crm.newtonimmigration.com/api/admin/stuck-uploads/sweep?systemToken=XXX&limit=25
//
// Idempotent: re-running can't create duplicates (S3 overwrite + addDocument
// dedupe). Rows older than ~25 days, or from before mediaId was stored, are
// skipped — those clients must resend.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { isValidSystemToken } from "@/lib/auth-recovery-token";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { sweepStuckUploads } from "@/lib/wa-media-recovery";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run(request: NextRequest) {
  // Auth: system token (cron) OR a logged-in Admin/ProcessingLead (manual).
  const url = new URL(request.url);
  const token = url.searchParams.get("systemToken") || "";
  if (!isValidSystemToken(token)) {
    const user = await getCurrentUserFromRequest(request);
    if (!user || user.userType !== "staff" || !["Admin", "ProcessingLead"].includes(user.role)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const limitRaw = parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 25;
  const ageRaw = parseInt(url.searchParams.get("maxAgeDays") || "", 10);
  const maxAgeDays = Number.isFinite(ageRaw) && ageRaw > 0 ? ageRaw : undefined;

  try {
    const summary = await sweepStuckUploads(pool, { limit, maxAgeDays });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}
export async function POST(request: NextRequest) {
  return run(request);
}
