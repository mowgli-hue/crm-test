// ─────────────────────────────────────────────────────────────────────
// WhatsApp media recovery + self-healing sweep
//
// Problem this solves: inbound WhatsApp media (passports, transcripts,
// receipts) is downloaded → saved to S3 → filed to Drive INLINE inside the
// webhook request. Under load, or when Meta's CDN is slow, that work is
// occasionally torn down before the file is saved, leaving the inbox row
// stuck at "pending=1" ("Uploading…") forever. At ~120 cases/day this was
// ~8% of uploads; it climbs with volume.
//
// The durable fix has two halves:
//   1. The inbound webhook ALWAYS records the Meta mediaId in the placeholder
//      (see whatsapp/route.ts) so a stuck upload is recoverable.
//   2. This module re-drives any stuck row from its stored mediaId — download
//      → S3 → update the inbox row → create the CRM document record (so it
//      also counts toward the case checklist). A scheduled sweep runs it over
//      every recent stuck row, so uploads self-heal within minutes without a
//      human clicking anything.
//
// Meta media URLs are time-limited (nominally ~30 days, often shorter), so the
// sweep only attempts rows younger than RECOVER_MAX_AGE_DAYS. Older rows can't
// be pulled back and the client must resend.
// ─────────────────────────────────────────────────────────────────────

import type { Pool } from "pg";
import { addDocument } from "@/lib/store";

const WA_TOKEN =
  process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";
const GRAPH_VERSION = "v18.0";
const COMPANY_ID = "newton";

// Don't bother trying to recover media older than this — Meta will have retired
// the URL and the fetch just wastes time.
export const RECOVER_MAX_AGE_DAYS = 25;

export type RecoveryStatus =
  | "recovered"
  | "no_media_id"
  | "media_unreachable"
  | "s3_failed"
  | "not_pending"
  | "error";

export type RecoveryResult = {
  rowId: string;
  status: RecoveryStatus;
  caseId?: string;
  caseName?: string;
  bytes?: number;
  error?: string;
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Download a Meta media object by id, with hard timeouts so a slow/hung CDN
// can never pin a worker open. Returns null on any failure (logged).
export async function downloadWaMediaById(
  mediaId: string,
  timeoutMs = 20000,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const urlRes = await fetchWithTimeout(
      `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
      { headers: { Authorization: `Bearer ${WA_TOKEN}` } },
      timeoutMs,
    );
    if (!urlRes.ok) {
      console.error(`[wa-recovery] media URL fetch failed: status=${urlRes.status} mediaId=${mediaId}`);
      return null;
    }
    const urlData = (await urlRes.json()) as { url?: string; mime_type?: string; error?: unknown };
    if (!urlData?.url) {
      console.error(`[wa-recovery] no download URL for mediaId=${mediaId}`);
      return null;
    }
    const fileRes = await fetchWithTimeout(
      urlData.url,
      { headers: { Authorization: `Bearer ${WA_TOKEN}` } },
      timeoutMs,
    );
    if (!fileRes.ok) {
      console.error(`[wa-recovery] media download failed: status=${fileRes.status} mediaId=${mediaId} (likely expired URL)`);
      return null;
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    if (buffer.length === 0) {
      console.error(`[wa-recovery] empty buffer for mediaId=${mediaId}`);
      return null;
    }
    return { buffer, mimeType: urlData.mime_type || "application/octet-stream" };
  } catch (e) {
    console.error(`[wa-recovery] download error for mediaId=${mediaId}:`, (e as Error).message);
    return null;
  }
}

function parseField(msg: string, field: string): string {
  const m = msg.match(new RegExp(`${field}=([^|\\]]+)`));
  return m?.[1] ? decodeURIComponent(m[1]) : "";
}

// Recover ONE stuck inbox row from its stored mediaId. Idempotent: re-running
// it overwrites the same S3 key and addDocument dedupes on sourceMsgId, so a
// row swept twice can't create duplicates.
export async function recoverStuckInboxRow(
  pool: Pool,
  row: { id: string; message: string; matched_case_id?: string | null; matched_case_name?: string | null },
): Promise<RecoveryResult> {
  const rowId = row.id;
  const msg = String(row.message || "");
  if (!msg.includes("pending=1")) return { rowId, status: "not_pending" };

  const mediaId = parseField(msg, "mediaId");
  if (!mediaId) return { rowId, status: "no_media_id" };

  try {
    const media = await downloadWaMediaById(mediaId);
    if (!media) return { rowId, status: "media_unreachable", caseId: row.matched_case_id || undefined };

    const { putObjectToS3, buildS3ObjectKey, toS3StoredLink } = await import("@/lib/object-storage");
    const kind = parseField(msg, "kind") || "document";
    const caption = parseField(msg, "caption");
    const ext = media.mimeType.includes("pdf") ? "pdf" : media.mimeType.includes("image") ? "jpg" : "bin";
    const caseId = row.matched_case_id || "unknown";
    const baseName =
      (caption || `${row.matched_case_name || "WhatsApp"} document`).replace(/\|/g, "").trim() || `recovered.${ext}`;

    const s3Key = buildS3ObjectKey({
      companyId: COMPANY_ID,
      caseId,
      fileName: `${Date.now()}-${baseName}`,
    });
    try {
      await putObjectToS3({ key: s3Key, content: media.buffer, contentType: media.mimeType });
    } catch (e) {
      return { rowId, status: "s3_failed", caseId, error: (e as Error).message };
    }
    const s3Link = toS3StoredLink(s3Key);

    // Re-point the inbox row at the recovered file so it stops showing
    // "Uploading…" and becomes a viewable preview + download.
    const dispName = baseName;
    const updated = `[doc:${rowId}|kind=${kind}|name=${encodeURIComponent(dispName)}|mime=${encodeURIComponent(media.mimeType)}|s3=${encodeURIComponent(s3Key)}${caption ? `|caption=${encodeURIComponent(caption)}` : ""}]`;
    await pool.query(`UPDATE whatsapp_inbox SET message = $1 WHERE id = $2`, [updated, rowId]);

    // Create the CRM document record too — without this the file would be
    // viewable in the inbox but still not count toward the case checklist
    // (the gap the manual "retry" tool never closed). Dedupe on the row id.
    if (row.matched_case_id) {
      try {
        await addDocument({
          companyId: COMPANY_ID,
          caseId: row.matched_case_id,
          name: dispName,
          category: "general",
          status: "received",
          link: s3Link,
          sourceMsgId: `wa-recovered:${rowId}`,
        });
      } catch (e) {
        // Non-fatal: the file is safe in S3 and the inbox row is fixed.
        console.error(`[wa-recovery] addDocument failed for ${rowId}:`, (e as Error).message);
      }
    }

    return {
      rowId,
      status: "recovered",
      caseId: row.matched_case_id || undefined,
      caseName: row.matched_case_name || undefined,
      bytes: media.buffer.length,
    };
  } catch (e) {
    return { rowId, status: "error", error: (e as Error).message };
  }
}

export type SweepSummary = {
  scanned: number;
  recovered: number;
  unrecoverable: number;
  skippedNoMediaId: number;
  results: RecoveryResult[];
};

// Find recent stuck rows that carry a mediaId and re-drive them. Bounded by
// `limit` so a single run stays cheap; the schedule catches the rest next time.
export async function sweepStuckUploads(
  pool: Pool,
  opts: { maxAgeDays?: number; limit?: number } = {},
): Promise<SweepSummary> {
  const maxAgeDays = opts.maxAgeDays ?? RECOVER_MAX_AGE_DAYS;
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  const res = await pool.query(
    `SELECT id, message, matched_case_id, matched_case_name
       FROM whatsapp_inbox
      WHERE message LIKE '%pending=1%'
        AND message LIKE '%mediaId=%'
        AND created_at > NOW() - ($1 || ' days')::interval
      ORDER BY created_at DESC
      LIMIT $2`,
    [String(maxAgeDays), limit],
  );

  const summary: SweepSummary = {
    scanned: res.rows.length,
    recovered: 0,
    unrecoverable: 0,
    skippedNoMediaId: 0,
    results: [],
  };

  // Sequential on purpose — keeps memory + Meta API pressure low. Each row is
  // bounded by the download timeout, so the whole sweep is bounded too.
  for (const row of res.rows) {
    const r = await recoverStuckInboxRow(pool, row);
    summary.results.push(r);
    if (r.status === "recovered") summary.recovered++;
    else if (r.status === "no_media_id") summary.skippedNoMediaId++;
    else if (r.status !== "not_pending") summary.unrecoverable++;
  }
  return summary;
}
