// ─────────────────────────────────────────────────────────────────────
// GET /api/nimmi/documents/[id]/download
//
// Generate a signed S3 download URL for a Nimmi-shared document.
// Auth: CRM session required (Newton staff only).
//
// Uses NIMMI_AWS_* env vars (separate from CRM's own AWS creds) to
// access Nimmi's S3 bucket. Falls back to AWS_* if NIMMI_* not set.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getNimmiPool } from "@/lib/nimmi/webhook-utils";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";

// Use NIMMI_AWS_* if available (Nimmi's S3 bucket), fall back to AWS_*
const region =
  process.env.NIMMI_AWS_REGION ||
  process.env.AWS_REGION ||
  "ca-central-1";

const accessKeyId =
  process.env.NIMMI_AWS_ACCESS_KEY_ID ||
  process.env.AWS_ACCESS_KEY_ID;

const secretAccessKey =
  process.env.NIMMI_AWS_SECRET_ACCESS_KEY ||
  process.env.AWS_SECRET_ACCESS_KEY;

const s3 = new S3Client({
  region,
  credentials:
    accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey }
      : undefined,
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const pool = getNimmiPool();
    const result = await pool.query(
      `SELECT * FROM nimmi_documents WHERE id = $1`,
      [id]
    );
    const doc = result.rows[0];
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!doc.s3_key || !doc.s3_bucket) {
      return NextResponse.json(
        { error: "Document has no S3 reference" },
        { status: 400 }
      );
    }

    // Generate 15-minute signed URL
    const command = new GetObjectCommand({
      Bucket: doc.s3_bucket,
      Key: doc.s3_key,
      ResponseContentDisposition: `attachment; filename="${doc.original_filename || "document.bin"}"`,
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    return NextResponse.json({
      ok: true,
      downloadUrl: signedUrl,
      expiresIn: 900,
      filename: doc.original_filename,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[nimmi/documents/download] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
