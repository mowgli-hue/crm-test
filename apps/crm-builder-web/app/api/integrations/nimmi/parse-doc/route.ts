// ─────────────────────────────────────────────────────────────────────
// POST /api/integrations/nimmi/parse-doc
//
// Lightweight document parsing endpoint for Nimmi.
//
// Nimmi POSTs a single file (multipart). We run Claude vision OCR via
// the existing extractDocumentFields() helper and return the structured
// fields. No case context needed — pure transformation.
//
// AUTH: X-Webhook-Secret header (same shared secret as other Nimmi webhooks).
//
// REQUEST:  multipart/form-data with `file` field
// RESPONSE: { ok: true, fields: ExtractedFields } | { ok: false, error: string }
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { extractDocumentFields } from "@/lib/doc-ocr";
import { verifyNimmiWebhook } from "@/lib/nimmi/webhook-utils";

export const runtime = "nodejs";
// 60 sec for Claude vision call + safety margin
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authError = verifyNimmiWebhook(req);
  if (authError) return authError;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Could not parse multipart body" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "No file provided" },
      { status: 400 }
    );
  }

  const clientName = String(formData.get("client_name") || "Client");

  // Size limit: 20 MB (Claude vision can handle large files but we cap)
  const MAX_SIZE = 20 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { ok: false, error: "File too large (max 20MB)" },
      { status: 413 }
    );
  }

  // Convert File -> Buffer
  let buffer: Buffer;
  try {
    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Could not read file" },
      { status: 400 }
    );
  }

  // Run OCR
  try {
    const fields = await extractDocumentFields(buffer, file.type, clientName);
    if (!fields) {
      return NextResponse.json({
        ok: true,
        fields: null,
        message: "Could not extract fields (file type unsupported or ANTHROPIC_API_KEY missing)",
      });
    }
    return NextResponse.json({ ok: true, fields });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[nimmi-parse-doc] error:", message);
    return NextResponse.json(
      { ok: false, error: `OCR failed: ${message}` },
      { status: 500 }
    );
  }
}
