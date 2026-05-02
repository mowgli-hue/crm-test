// /api/debug/wa-config — quick diagnostic to verify env var routing.
// Returns first 6 chars of each WhatsApp env var so we can confirm the
// running code is actually reading them. Safe to expose first chars only.
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

  return NextResponse.json({
    WHATSAPP_PHONE_NUMBER_ID: mask(process.env.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_MARKETING_PHONE_ID: mask(process.env.WHATSAPP_MARKETING_PHONE_ID),
    WHATSAPP_ACCESS_TOKEN: mask(process.env.WHATSAPP_ACCESS_TOKEN),
    MARKETING_DOCS_DRIVE_FOLDER_ID: mask(process.env.MARKETING_DOCS_DRIVE_FOLDER_ID),
    MARKETING_TEMPLATE_NAME: process.env.MARKETING_TEMPLATE_NAME || "(not set, using default)",
    PROCESSING_TEMPLATE_NAME: process.env.PROCESSING_TEMPLATE_NAME || "(not set, using default)",
    TASKER_WELCOME_TEMPLATE: process.env.TASKER_WELCOME_TEMPLATE || "(not set, using default)",
  });
}
