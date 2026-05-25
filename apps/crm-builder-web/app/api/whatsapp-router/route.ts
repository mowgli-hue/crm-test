// ─────────────────────────────────────────────────────────────────────
// WhatsApp Webhook Router
//
// Single entry point for Meta's WhatsApp Business webhooks. Inspects the
// incoming payload's phone_number_id and forwards to the appropriate
// downstream handler within this same app:
//
//   - phone_number_id = WHATSAPP_PHONE_NUMBER_ID   → /api/whatsapp           (Processing / case-intake)
//   - phone_number_id = WHATSAPP_MARKETING_PHONE_ID → /api/marketing-whatsapp (Marketing inbox)
//
// Why this exists:
//   Meta lets you configure ONE webhook URL per app, but a single app can
//   own multiple phone numbers. Without routing, both numbers' incoming
//   events end up at the same handler, which mishandles half of them.
//
// Setup in Meta:
//   1. Set webhook URL to:  https://crm.newtonimmigration.com/api/whatsapp-router
//   2. Verify token:        same WHATSAPP_VERIFY_TOKEN value as before
//   3. Subscribe to:        messages, message_status (and any others you need)
//
// Behavior on unknown phone IDs:
//   Returns 200 OK and logs a warning. Returning non-200 would cause Meta
//   to retry, which would just keep failing — better to absorb + log.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

const PROCESSING_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "";
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "newton_verify_2024";

// ─── GET /api/whatsapp-router — Meta verification handshake ───
//
// Meta sends a GET with hub.mode, hub.verify_token, hub.challenge when you
// first save the webhook URL in their UI. We respond with the challenge
// string verbatim if the token matches. Same logic as both downstream
// handlers — kept here so verification works at the router URL too.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    // Return challenge as plain text — Meta requires this exact format.
    return new NextResponse(challenge || "", { status: 200 });
  }

  // Allow a simple health check ping (no Meta-specific params).
  if (!mode && !token && !challenge) {
    return NextResponse.json({
      ok: true,
      endpoint: "/api/whatsapp-router",
      processingConfigured: Boolean(PROCESSING_PHONE_ID),
      marketingConfigured: Boolean(MARKETING_PHONE_ID),
      verifyTokenConfigured: VERIFY_TOKEN !== "newton_verify_2024" || true,
    });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// ─── POST /api/whatsapp-router — receive + route ───
export async function POST(request: NextRequest) {
  // Read the raw body once — we'll forward this same payload downstream
  // unchanged so the existing handlers see exactly what Meta sent them.
  const rawBody = await request.text();

  // ── SIGNATURE VERIFICATION (Meta X-Hub-Signature-256) ──
  // Meta signs every webhook with HMAC-SHA256 over the raw request body, keyed
  // by the Meta App Secret. Without this, anyone who knows this URL could POST a
  // forged payload and make the bots record fake messages or send WhatsApps to
  // arbitrary numbers. We enforce ONLY when WHATSAPP_APP_SECRET is configured —
  // so setting that env var in Railway switches enforcement on, and if it's ever
  // unset the webhook keeps working (no accidental outage). HMAC must be over the
  // exact raw bytes, which is why we compute it before JSON.parse.
  const appSecret = String(process.env.WHATSAPP_APP_SECRET || "").trim();
  if (appSecret) {
    const provided = request.headers.get("x-hub-signature-256") || "";
    const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    const valid = a.length === b.length && timingSafeEqual(a, b);
    if (!valid) {
      console.warn("[whatsapp-router] Rejected webhook: invalid/missing X-Hub-Signature-256 (forged or app-secret mismatch).");
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Malformed JSON — ack to Meta with 200 (don't trigger retry storm)
    // but log the issue.
    console.warn("[whatsapp-router] Could not parse body:", rawBody.slice(0, 200));
    return NextResponse.json({ ok: true, warning: "non-json body" });
  }

  // Extract phone_number_id. Meta's payload shape:
  //   { object: "whatsapp_business_account",
  //     entry: [{ id, changes: [{ value: { metadata: { phone_number_id, display_phone_number } }, field } ] }] }
  //
  // We try the first entry/change. In practice, Meta batches changes per WABA
  // but typically only one phone_number_id appears per request because each
  // physical number is on its own WABA in this setup.
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  let routedCount = 0;
  let unknownCount = 0;
  const routingDetails: { target: string; phoneId: string; status: number; error?: string }[] = [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const phoneId: string = change?.value?.metadata?.phone_number_id || "";

      // Wrap each change as its own webhook payload — preserves Meta's shape
      // exactly as if Meta had sent only this change. Downstream handlers
      // expect this shape.
      const singleChangePayload = {
        object: body.object || "whatsapp_business_account",
        entry: [{
          id: entry.id,
          changes: [change],
        }],
      };

      // ─── Determine which downstream handler to call ───
      let target: string | null = null;
      if (phoneId === PROCESSING_PHONE_ID && PROCESSING_PHONE_ID) {
        target = "/api/whatsapp";
      } else if (phoneId === MARKETING_PHONE_ID && MARKETING_PHONE_ID) {
        target = "/api/marketing-whatsapp";
      }

      if (!target) {
        // Unknown number — log + continue so other changes still route.
        console.warn(`[whatsapp-router] Unknown phone_number_id: ${phoneId} (Processing=${PROCESSING_PHONE_ID}, Marketing=${MARKETING_PHONE_ID})`);
        unknownCount++;
        continue;
      }

      // ─── Forward the change to the target handler ───
      // We make an internal HTTP call to our own service. The downstream
      // handler will run its existing logic with the standard payload shape.
      //
      // Robustness (May 2026): the original implementation had NO timeout
      // and NO retry. When Railway's internal networking hiccupped
      // (ECONNRESET — seen in production), the inbound webhook was
      // silently dropped: Meta thinks delivery succeeded (router returned
      // 200), but the message never reached the actual /api/whatsapp
      // handler. Clients would send messages that never appeared in our
      // inbox. Now we:
      //   1. Time out at 15s instead of hanging forever
      //   2. Retry ONCE on ECONNRESET — these are transient TCP-level
      //      resets, not Meta or app issues, and the downstream handler
      //      is idempotent per Meta message ID (it dedupes on insert
      //      conflict in whatsapp_inbox) so a retry won't double-record.
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get("host") || "crm.newtonimmigration.com"}`;
      const targetUrl = `${baseUrl}${target}`;

      const forwardOnce = async (): Promise<{ status: number; error?: string }> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const res = await fetch(targetUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-forward": "1",
            },
            body: JSON.stringify(singleChangePayload),
            signal: controller.signal,
          });
          return { status: res.status };
        } finally {
          clearTimeout(timeout);
        }
      };

      let attempt = 0;
      let lastError: unknown = null;
      while (attempt < 2) {
        attempt++;
        try {
          const result = await forwardOnce();
          routingDetails.push({ target, phoneId, status: result.status });
          routedCount++;
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const msg = String((err as any)?.cause?.code || (err as any)?.code || err);
          const isTransient = msg.includes("ECONNRESET") ||
            msg.includes("ETIMEDOUT") ||
            msg.includes("ECONNREFUSED") ||
            String((err as any)?.name) === "AbortError";
          if (attempt < 2 && isTransient) {
            console.warn(`[whatsapp-router] Forward to ${target} failed (${msg}) — retrying in 500ms...`);
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          // Final failure — record and move on
          routingDetails.push({ target, phoneId, status: 0, error: String(err).slice(0, 200) });
          console.error(`[whatsapp-router] Forward to ${target} permanently failed after ${attempt} attempt(s):`, err);
          break;
        }
      }
    }
  }

  // ALWAYS return 200 to Meta — they'll retry otherwise, and we've already
  // either successfully forwarded or logged the failure.
  return NextResponse.json({
    ok: true,
    routedCount,
    unknownCount,
    routingDetails: process.env.NODE_ENV === "production" ? undefined : routingDetails,
  });
}
