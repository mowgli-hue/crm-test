// lib/nimmi-results.ts
//
// Newton CRM → Nimmi result magic-link integration.
//
// Flow (per the integration spec):
//   1. prepare-upload  → { resultId, s3Key, uploadUrl, matchedUserId, matchedBy }
//   2. PUT the file bytes to the presigned S3 uploadUrl (no Nimmi auth)
//   3. finalize        → { shareUrl, tokenExpiresAt, matchedToUser }
//
// The CRM then stores shareUrl and sends it to the client over WhatsApp.
//
// Auth: every Nimmi call uses `Authorization: Bearer <CRM_API_SECRET>`.
// CRM_API_SECRET must match the value set on Nimmi's deploy. Never commit it.

const NIMMI_BASE = (process.env.NIMMI_API_BASE || "https://www.nimmi.solutions").replace(/\/+$/, "");

export type NimmiResultType =
  | "approval"
  | "refusal"
  | "passport_request"
  | "biometrics"
  | "medical"
  | "aor"
  | "additional_docs"
  | "other";

export type PushResultInput = {
  clientName: string;
  phone?: string;
  email?: string;
  appNumber?: string;
  serviceSlug?: string;
  resultType: NimmiResultType;
  fileName: string;
  contentType: string; // application/pdf | image/jpeg | image/png | image/heic
  fileBuffer: Buffer;
  rcicNote?: string;
};

export type PushResultOutput = {
  ok: boolean;
  shareUrl?: string;
  resultId?: string;
  tokenExpiresAt?: string;
  matchedToUser?: boolean;
  matchedUserId?: string | null;
  matchedBy?: string;
  error?: string;
};

export function isNimmiConfigured(): boolean {
  return Boolean(String(process.env.CRM_API_SECRET || "").trim());
}

function jsonHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${String(process.env.CRM_API_SECRET || "").trim()}`,
    "Content-Type": "application/json",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pushResultToNimmi(input: PushResultInput): Promise<PushResultOutput> {
  if (!isNimmiConfigured()) return { ok: false, error: "CRM_API_SECRET is not set" };
  if (!input.clientName?.trim()) return { ok: false, error: "clientName is required" };
  if (!input.phone && !input.email) return { ok: false, error: "phone or email is required" };
  if (!input.fileName?.trim()) return { ok: false, error: "fileName is required" };
  if (!input.contentType?.trim()) return { ok: false, error: "contentType is required" };
  if (!input.fileBuffer?.length) return { ok: false, error: "empty file" };

  // ── Step 1: prepare-upload ──
  let prep: any;
  try {
    const res = await fetch(`${NIMMI_BASE}/api/admin/results/from-crm/prepare-upload`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        clientName: input.clientName,
        phone: input.phone,
        email: input.email,
        appNumber: input.appNumber,
        serviceSlug: input.serviceSlug,
        resultType: input.resultType,
        filename: input.fileName,
        contentType: input.contentType,
      }),
    });
    prep = await res.json().catch(() => ({}));
    if (!res.ok || !prep?.ok) {
      return { ok: false, error: `prepare-upload ${res.status}: ${prep?.error || "failed"}` };
    }
  } catch (e) {
    return { ok: false, error: `prepare-upload error: ${(e as Error).message}` };
  }

  const resultId: string = prep.resultId;
  const s3Key: string = prep.s3Key;
  const uploadUrl: string = prep.uploadUrl;
  const matchedUserId: string | null = prep.matchedUserId ?? null;
  const matchedBy: string | undefined = prep.matchedBy;

  if (!uploadUrl || !resultId) {
    return { ok: false, error: "prepare-upload returned no uploadUrl/resultId" };
  }

  // ── Step 2: PUT the file to the presigned S3 URL ──
  const putFile = async (): Promise<{ ok: boolean; status: number; error?: string }> => {
    try {
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": input.contentType },
        body: input.fileBuffer as any,
      });
      if (res.ok) return { ok: true, status: res.status };
      // Surface the S3 error body (XML) so 403s are diagnosable — it names the
      // exact reason, e.g. SignatureDoesNotMatch / AccessDenied / expired URL.
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 600);
      // Diagnostics for SignatureDoesNotMatch: show which headers Nimmi SIGNED
      // into the presigned URL vs. what we actually send. If SignedHeaders lists
      // "content-type" and our value differs (or it lists a checksum header we
      // don't send), that's the mismatch.
      let signedHeaders = "?";
      try { signedHeaders = new URL(uploadUrl).searchParams.get("X-Amz-SignedHeaders") || "(none)"; } catch { /* ignore */ }
      console.error(
        `[nimmi] S3 PUT ${res.status} | signedHeaders=[${signedHeaders}] | weSent Content-Type=${input.contentType} | bodyBytes=${input.fileBuffer.length}`
      );
      return { ok: false, status: res.status, error: `S3 PUT ${res.status} (signed:[${signedHeaders}], sent ct=${input.contentType})${detail ? ` — ${detail}` : ""}` };
    } catch (e) {
      return { ok: false, status: 0, error: (e as Error).message };
    }
  };

  const firstPut = await putFile();
  if (!firstPut.ok) return { ok: false, error: `upload failed: ${firstPut.error}`, resultId };

  // ── Step 3: finalize (with the spec's retry guidance) ──
  const finalize = async (): Promise<{ status: number; data: any }> => {
    const res = await fetch(`${NIMMI_BASE}/api/admin/results/from-crm/finalize`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        resultId,
        s3Key,
        clientName: input.clientName,
        phone: input.phone,
        email: input.email,
        appNumber: input.appNumber,
        serviceSlug: input.serviceSlug,
        resultType: input.resultType,
        filename: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.fileBuffer.length,
        rcicNote: input.rcicNote,
        matchedUserId,
      }),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  let fin = await finalize();
  // 409 = file not in S3 yet → re-PUT then finalize again.
  if (fin.status === 409) {
    await putFile();
    fin = await finalize();
  }
  // 500 = server error → one backoff retry.
  if (fin.status >= 500) {
    await sleep(1000);
    fin = await finalize();
  }

  if (fin.status < 200 || fin.status >= 300 || !fin.data?.ok) {
    return { ok: false, error: `finalize ${fin.status}: ${fin.data?.error || "failed"}`, resultId };
  }

  return {
    ok: true,
    shareUrl: fin.data.shareUrl,
    resultId: fin.data.resultId || resultId,
    tokenExpiresAt: fin.data.tokenExpiresAt,
    matchedToUser: Boolean(fin.data.matchedToUser),
    matchedUserId,
    matchedBy,
  };
}

// ── Privacy-aware WhatsApp messages ──
// Approval can celebrate. Everything else (refusals especially) MUST NOT name
// the result type — the client views it privately behind the magic link.
export function buildResultWhatsAppMessage(
  resultType: NimmiResultType,
  firstName: string,
  shareUrl: string
): string {
  const name = (firstName || "").trim() || "there";
  if (resultType === "approval") {
    return [
      `Hi ${name} 🎉`,
      ``,
      `You have an approval from Newton Immigration.`,
      ``,
      `Tap to view it in Nimmi: ${shareUrl}`,
      ``,
      `If we've helped on your journey, a Google review means the world to us:`,
      `https://g.page/r/CYTdpFJ-nDr7EAE/review`,
      ``,
      `Nimmi is your private space to handle the rest of your immigration journey.`,
      ``,
      `— Newton Immigration`,
    ].join("\n");
  }
  return [
    `Hi ${name},`,
    ``,
    `There's an update on your application. Log in to view privately:`,
    `${shareUrl}`,
    ``,
    `We're here to help with next steps.`,
    ``,
    `— Newton Immigration`,
  ].join("\n");
}
