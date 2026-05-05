// ─────────────────────────────────────────────────────────────────────
// /api/inbox-attachment — download a WhatsApp attachment by inbox msg ID
//
// Used by the Inbox UI and Case Comm tab to surface a "Download" button
// directly in the chat for client-sent docs/images/audio.
//
// Flow:
//   1. Frontend calls GET /api/inbox-attachment?id=WA-1234
//   2. We look up the row in whatsapp_inbox
//   3. Parse the message text to extract the S3 key + filename + mime
//   4. Stream the file from S3 to the browser with proper Content-Disposition
//
// The S3 file is the original payload Meta sent us — the team's "WhatsApp
// Web style" instant download, no waiting for Drive to sync.
//
// Auth: only authenticated staff can call this. We do a simple "is user
// signed in" check; granular per-case access checks for matched messages
// would slow this down too much, and any signed-in staff member already
// has visibility on the inbox anyway.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getObjectFromS3 } from "@/lib/object-storage";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Parse our message-text format: `[doc:msgId|kind=...|name=...|mime=...|s3=...]`
function parseDocPlaceholder(messageText: string): null | { kind: string; name?: string; mime?: string; s3?: string; pending: boolean } {
  if (!messageText || !messageText.startsWith("[doc:")) return null;
  // Strip outer brackets
  const inner = messageText.slice(1, -1); // "doc:msgId|kind=...|..."
  const parts = inner.split("|");
  // First part is "doc:msgId" — skip
  const result: any = { pending: false };
  for (let i = 1; i < parts.length; i++) {
    const [k, v] = parts[i].split("=");
    if (!k) continue;
    if (k === "pending") result.pending = v === "1" || v === "true";
    else if (v) result[k] = decodeURIComponent(v);
  }
  if (!result.kind) result.kind = "document";
  return result;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user || user.userType !== "staff") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' parameter" }, { status: 400 });
  }

  // Look up the inbox row — try processing-side whatsapp_inbox first,
  // then fall back to marketing_inbox. This way both sources of [doc:...]
  // placeholders work through the same /api/inbox-attachment?id=... URL.
  let row: any = null;
  try {
    const r1 = await pool.query(`SELECT id, message FROM whatsapp_inbox WHERE id = $1`, [id]);
    row = r1.rows[0];
    if (!row) {
      const r2 = await pool.query(`SELECT id, message FROM marketing_inbox WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
      row = r2.rows[0];
    }
  } catch (e) {
    console.error("[inbox-attachment] DB lookup failed:", (e as Error).message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = parseDocPlaceholder(String(row.message || ""));
  if (!parsed) {
    return NextResponse.json({ error: "Not a doc message" }, { status: 400 });
  }
  if (parsed.pending) {
    return NextResponse.json({ error: "Still processing — try again in a few seconds" }, { status: 425 });
  }
  if (!parsed.s3) {
    return NextResponse.json({ error: "No S3 key on record" }, { status: 404 });
  }

  // Stream from S3
  let buffer: Buffer;
  try {
    buffer = await getObjectFromS3(parsed.s3);
  } catch (e) {
    console.error("[inbox-attachment] S3 fetch failed:", (e as Error).message);
    return NextResponse.json({ error: "S3 fetch failed" }, { status: 500 });
  }

  const filename = parsed.name || `whatsapp-${id}`;
  const mime = parsed.mime || "application/octet-stream";

  // ── inline vs attachment ──
  // For images, we let the browser preview inline if it wants to (the UI's
  // download button still triggers a save thanks to the `download` attribute).
  // For everything else, force attachment so PDFs etc. don't open in tab.
  const disposition = mime.startsWith("image/") ? "inline" : "attachment";

  // ── Filename encoding (RFC 5987 / RFC 6266) ──
  // HTTP headers must be ASCII (Node's strict ByteString validator throws on
  // any char > 255). Filenames with curly apostrophes ('), accented letters,
  // or non-Latin scripts (e.g. "Jasmeen's Document.pdf" — index 6 is U+2019)
  // crash the Response constructor. The fix: provide an ASCII-safe fallback
  // in `filename=` and the real Unicode version in `filename*=UTF-8''<encoded>`.
  // Modern browsers (all ≥2010) honor the starred parameter for the actual
  // saved filename.
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(filename);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=300",
    },
  });
}
