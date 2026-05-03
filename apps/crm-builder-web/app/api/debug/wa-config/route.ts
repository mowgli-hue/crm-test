// /api/debug/wa-config — quick diagnostic to verify env var routing.
// Returns first 6 chars of each WhatsApp env var so we can confirm the
// running code is actually reading them. Safe to expose first chars only.
//
// Also queries Meta Graph API to find:
//   - Which WABA each phone number belongs to
//   - What templates are approved on each WABA
// This tells us definitively whether `missed_call_welcome` exists on the
// marketing phone's WABA.
//
// DELETE THIS ENDPOINT AFTER DEBUGGING.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mask = (v: string | undefined) => {
    if (!v) return "(NOT SET)";
    if (v.length <= 6) return v.slice(0, 3) + "...";
    return v.slice(0, 6) + "..." + ` (length=${v.length})`;
  };

  // ── Live Meta API checks for each phone number ──
  // Given a phone_number_id, Meta tells us which whatsapp_business_account
  // it belongs to. Then we list templates on that account.
  async function probePhone(label: string, phoneId: string | undefined) {
    if (!phoneId) return { label, status: "phoneId not set" };
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return { label, status: "WHATSAPP_ACCESS_TOKEN not set" };

    try {
      // Step 1: find which WABA this phone belongs to.
      // Meta endpoint: GET /{phone_id}?fields=display_phone_number,verified_name
      // The WABA ID requires a different endpoint: /{phone_id}/whatsapp_business_account
      // Actually simplest: call /{phone_id} with field for whatsapp_business_account
      const phoneRes = await fetch(
        `https://graph.facebook.com/v20.0/${phoneId}?fields=display_phone_number,verified_name,whatsapp_business_account`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const phoneData: any = await phoneRes.json().catch(() => ({}));

      if (phoneRes.status !== 200) {
        return {
          label,
          phoneId: phoneId.slice(0, 6) + "...",
          status: "Meta API error",
          error: phoneData?.error?.message || "unknown",
        };
      }

      const wabaId = phoneData?.whatsapp_business_account?.id;
      const displayPhone = phoneData?.display_phone_number;
      const verifiedName = phoneData?.verified_name;

      // Step 2: list templates on this WABA
      let templates: Array<{ name: string; language: string; status: string }> = [];
      let templatesError: string | undefined;
      if (wabaId) {
        const tplRes = await fetch(
          `https://graph.facebook.com/v20.0/${wabaId}/message_templates?fields=name,language,status&limit=100`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const tplData: any = await tplRes.json().catch(() => ({}));
        if (tplRes.status === 200 && Array.isArray(tplData?.data)) {
          templates = tplData.data.map((t: any) => ({
            name: t.name,
            language: t.language,
            status: t.status,
          }));
        } else {
          templatesError = tplData?.error?.message || "unknown";
        }
      }

      return {
        label,
        phoneId: phoneId.slice(0, 6) + "...",
        displayPhone,
        verifiedName,
        wabaId: wabaId ? wabaId.slice(0, 6) + "..." : "(none)",
        templates,
        templatesError,
      };
    } catch (e) {
      return { label, phoneId: phoneId.slice(0, 6) + "...", status: "exception", error: (e as Error).message };
    }
  }

  const processingProbe = await probePhone("Processing", process.env.WHATSAPP_PHONE_NUMBER_ID);
  const marketingProbe = await probePhone("Marketing", process.env.WHATSAPP_MARKETING_PHONE_ID);

  return NextResponse.json({
    env: {
      WHATSAPP_PHONE_NUMBER_ID: mask(process.env.WHATSAPP_PHONE_NUMBER_ID),
      WHATSAPP_MARKETING_PHONE_ID: mask(process.env.WHATSAPP_MARKETING_PHONE_ID),
      WHATSAPP_ACCESS_TOKEN: mask(process.env.WHATSAPP_ACCESS_TOKEN),
      MARKETING_DOCS_DRIVE_FOLDER_ID: mask(process.env.MARKETING_DOCS_DRIVE_FOLDER_ID),
      MARKETING_TEMPLATE_NAME: process.env.MARKETING_TEMPLATE_NAME || "(not set, using default 'missed_call_welcome')",
      PROCESSING_TEMPLATE_NAME: process.env.PROCESSING_TEMPLATE_NAME || "(not set, using default 'newton_intake')",
      TASKER_WELCOME_TEMPLATE: process.env.TASKER_WELCOME_TEMPLATE || "(not set, using default 'missed_call_welcome')",
    },
    processing: processingProbe,
    marketing: marketingProbe,
  });
}

