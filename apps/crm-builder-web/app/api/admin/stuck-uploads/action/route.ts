// ─────────────────────────────────────────────────────────────────────
// POST /api/admin/stuck-uploads/action
//
// Two actions:
//   - "dismiss" — mark a stuck row as failed/abandoned. Replaces placeholder
//     with a human-readable failure note so the row stops showing as
//     "Uploading…". Use for rows older than 24h where Meta media is gone.
//
//   - "retry" — re-fetch from WhatsApp + re-attempt S3 save. Only works if
//     the placeholder has mediaId= field (added 2026-05). For rows from before
//     that change, retry returns "media_id_unavailable".
//
// Body: { rowId: "WA-...", action: "dismiss" | "retry" }
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "";

async function downloadWaMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const urlRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` },
    });
    if (!urlRes.ok) {
      console.error(`[retry] media URL fetch failed: status=${urlRes.status}`);
      return null;
    }
    const urlData = await urlRes.json() as { url?: string; mime_type?: string; error?: any };
    if (!urlData.url) return null;
    const fileRes = await fetch(urlData.url, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` },
    });
    if (!fileRes.ok) return null;
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    if (buffer.length === 0) return null;
    return { buffer, mimeType: urlData.mime_type || "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rowId: string = body?.rowId;
    const action: "dismiss" | "retry" = body?.action;
    if (!rowId || !["dismiss", "retry"].includes(action)) {
      return NextResponse.json(
        { ok: false, error: "rowId and action ('dismiss' or 'retry') are required" },
        { status: 400 }
      );
    }

    const rowRes = await pool.query(
      `SELECT id, phone, message, matched_case_id, matched_case_name FROM whatsapp_inbox WHERE id = $1`,
      [rowId]
    );
    if (rowRes.rows.length === 0) {
      return NextResponse.json({ ok: false, error: `Row ${rowId} not found` }, { status: 404 });
    }
    const row = rowRes.rows[0];
    const msg = String(row.message || "");

    if (!msg.includes("pending=1")) {
      return NextResponse.json({
        ok: true,
        action: "already_completed",
        message: "Row already completed — nothing to do",
      });
    }

    // ── DISMISS — replace placeholder with a "failed" note ─────
    if (action === "dismiss") {
      const captionMatch = msg.match(/caption=([^|\]]+)/);
      const captionDecoded = captionMatch ? decodeURIComponent(captionMatch[1]) : "";
      const dismissedNote = captionDecoded
        ? `📵 Upload failed (client must resend): ${captionDecoded}`
        : `📵 Upload failed (client must resend)`;
      await pool.query(`UPDATE whatsapp_inbox SET message = $1 WHERE id = $2`, [dismissedNote, rowId]);
      return NextResponse.json({
        ok: true,
        action: "dismissed",
        message: `Row ${rowId} marked as failed. Ask client to resend the document.`,
      });
    }

    // ── RETRY — re-fetch from Meta (only works if mediaId in placeholder) ─
    if (action === "retry") {
      const mediaIdMatch = msg.match(/mediaId=([^|]+)/);
      if (!mediaIdMatch) {
        return NextResponse.json({
          ok: false,
          action: "media_id_unavailable",
          explanation:
            "This stuck upload's placeholder doesn't include mediaId — likely from " +
            "before the 2026-05 fix that started storing it. Retry not possible. " +
            "Use action=dismiss to clear, then ask client to resend.",
        });
      }
      const mediaId = mediaIdMatch[1];
      const media = await downloadWaMedia(mediaId);
      if (!media) {
        return NextResponse.json({
          ok: false,
          action: "media_expired_or_unreachable",
          explanation:
            `Meta returned no media for mediaId=${mediaId}. Either the URL has expired ` +
            `(common after >24h) or Meta has retired the media. Ask client to resend.`,
        });
      }

      // Save to S3 + update row
      const { putObjectToS3, buildS3ObjectKey, toS3StoredLink } = await import("@/lib/object-storage");
      const COMPANY_ID = "newton";
      const captionMatch = msg.match(/caption=([^|\]]+)/);
      const captionDecoded = captionMatch ? decodeURIComponent(captionMatch[1]) : "";
      const fileNameSafe = captionDecoded.replace(/\|/g, "") || `wa_recovered_${Date.now()}`;
      const s3Key = buildS3ObjectKey({
        companyId: COMPANY_ID,
        caseId: row.matched_case_id || "unknown",
        fileName: `${Date.now()}-${fileNameSafe}`,
      });
      try {
        await putObjectToS3({ key: s3Key, content: media.buffer, contentType: media.mimeType });
      } catch (e) {
        return NextResponse.json({
          ok: false,
          action: "s3_save_failed",
          error: (e as Error).message,
        });
      }
      const updatedDisplay = `[doc:${rowId}|kind=document|name=${encodeURIComponent(fileNameSafe)}|mime=${encodeURIComponent(media.mimeType)}|s3=${encodeURIComponent(s3Key)}${captionDecoded ? `|caption=${encodeURIComponent(captionDecoded)}` : ""}]`;
      await pool.query(`UPDATE whatsapp_inbox SET message = $1 WHERE id = $2`, [updatedDisplay, rowId]);
      return NextResponse.json({
        ok: true,
        action: "recovered",
        message: `Successfully recovered ${media.buffer.length} bytes. File now available in inbox.`,
        s3Key,
      });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
