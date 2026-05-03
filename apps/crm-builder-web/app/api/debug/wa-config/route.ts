// /api/debug/wa-config — quick diagnostic to verify env var routing.
// Tests by actually attempting template sends to a known test number,
// reporting back exactly what works and what doesn't.
//
// Pass ?test=PHONE to run live send tests. Without test param, just shows env.
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

  const env = {
    WHATSAPP_PHONE_NUMBER_ID: mask(process.env.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_MARKETING_PHONE_ID: mask(process.env.WHATSAPP_MARKETING_PHONE_ID),
    WHATSAPP_ACCESS_TOKEN: mask(process.env.WHATSAPP_ACCESS_TOKEN),
    MARKETING_DOCS_DRIVE_FOLDER_ID: mask(process.env.MARKETING_DOCS_DRIVE_FOLDER_ID),
    MARKETING_TEMPLATE_NAME: process.env.MARKETING_TEMPLATE_NAME || "(default 'missed_call_welcome')",
    PROCESSING_TEMPLATE_NAME: process.env.PROCESSING_TEMPLATE_NAME || "(default 'newton_intake')",
    TASKER_WELCOME_TEMPLATE: process.env.TASKER_WELCOME_TEMPLATE || "(default 'missed_call_welcome')",
  };

  // ── Probe each phone number ──
  // Just confirms phone exists + returns display info. No WABA lookup
  // since /phone_id?fields=whatsapp_business_account isn't a valid field.
  async function getPhoneInfo(phoneId: string | undefined) {
    if (!phoneId) return { ok: false, reason: "phoneId not set" };
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return { ok: false, reason: "WHATSAPP_ACCESS_TOKEN not set" };
    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${phoneId}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data: any = await res.json().catch(() => ({}));
      if (res.status !== 200) return { ok: false, error: data?.error?.message || "Meta API error" };
      return {
        ok: true,
        displayPhone: data.display_phone_number,
        verifiedName: data.verified_name,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // ── Live template test ──
  // Actually attempts to send each known template via each phone, with
  // multiple language codes. Reports which combinations work.
  // Pass ?test=PHONE_DIGITS to enable. Use a phone that's safe to ping
  // (yours, ideally) since each successful test sends a real WhatsApp.
  async function tryTemplate(phoneId: string, to: string, name: string, lang: string) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return { ok: false, error: "no token" };
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: { name, language: { code: lang } },
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.status === 200) {
        return { ok: true, messageId: data?.messages?.[0]?.id };
      }
      return {
        ok: false,
        status: res.status,
        errCode: data?.error?.code,
        errMessage: data?.error?.message,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  const url = new URL(request.url);
  const testPhone = url.searchParams.get("test");

  const result: any = {
    env,
    phones: {
      processing: await getPhoneInfo(process.env.WHATSAPP_PHONE_NUMBER_ID),
      marketing: await getPhoneInfo(process.env.WHATSAPP_MARKETING_PHONE_ID),
    },
  };

  if (testPhone) {
    const cleanTest = testPhone.replace(/\D/g, "");
    const tests: any[] = [];
    const combos = [
      { phone: "marketing", phoneId: process.env.WHATSAPP_MARKETING_PHONE_ID, template: "missed_call_welcome", lang: "en" },
      { phone: "marketing", phoneId: process.env.WHATSAPP_MARKETING_PHONE_ID, template: "missed_call_welcome", lang: "en_US" },
      { phone: "marketing", phoneId: process.env.WHATSAPP_MARKETING_PHONE_ID, template: "missed_call_welcome", lang: "en_GB" },
      { phone: "marketing", phoneId: process.env.WHATSAPP_MARKETING_PHONE_ID, template: "newton_intake", lang: "en" },
      { phone: "processing", phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID, template: "newton_intake", lang: "en" },
      { phone: "processing", phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID, template: "newton_intake", lang: "en_US" },
      { phone: "processing", phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID, template: "missed_call_welcome", lang: "en" },
    ];
    for (const c of combos) {
      if (!c.phoneId) {
        tests.push({ ...c, phoneId: "NOT_SET", result: { ok: false, error: "phone ID not configured" } });
        continue;
      }
      const r = await tryTemplate(c.phoneId, cleanTest, c.template, c.lang);
      tests.push({
        phone: c.phone,
        phoneIdMask: c.phoneId.slice(0, 6) + "...",
        template: c.template,
        lang: c.lang,
        result: r,
      });
    }
    result.testResults = tests;
    result.testPhone = cleanTest;
    result.note = "Each successful test SENT a real WhatsApp to the test phone. Check your phone for received templates.";
  } else {
    result.tip = "Add ?test=YOUR_PHONE_DIGITS to actually try sending templates and see which combos work. Example: ?test=16041234567";
  }

  return NextResponse.json(result);
}


