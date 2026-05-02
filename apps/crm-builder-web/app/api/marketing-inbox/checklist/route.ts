// ─────────────────────────────────────────────────────────────────────
// /api/marketing-inbox/checklist — get formatted service checklist message
//
// Used by the Marketing Inbox sidebar's "Quick checklists" feature. Staff
// clicks a service (PGWP, PR, etc.) → frontend hits this endpoint to get
// the full pre-formatted message → preview → click Send to send it via
// /api/marketing-inbox.
//
// We format the same shape as the marketing AI sends:
//   * Eligibility quick-check (✓ bullets)
//   * Documents Checklist (✅ bullets)
//   * Fee 💰
//   * "Reply YES with your full name to proceed" call-to-action
//
// Single source of truth = SERVICES catalog in lib/marketing-knowledge.ts
// so any updates to fees/eligibility/checklists propagate here AND to the
// AI's responses automatically.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { SERVICES } from "@/lib/marketing-knowledge";

// ── Format a service's checklist as a WhatsApp-ready message ──
//
// Produces a multi-paragraph text using the same conventions as the
// marketing AI: emojis, bullets, bold (* *) for emphasis, separators.
// Tone is warm + professional. Mirrors the sample chat we used as the
// reference last session.
function formatServiceMessage(serviceKey: string): string | null {
  const svc = SERVICES[serviceKey];
  if (!svc) return null;

  const lines: string[] = [];
  // Title
  lines.push(`${svc.emoji} *${svc.displayName}*`);
  lines.push(``);

  // Eligibility (always shown first per Newton's flow)
  if (svc.eligibility && svc.eligibility.length > 0) {
    lines.push(`*Quick eligibility check* — to qualify, you should:`);
    for (const e of svc.eligibility) {
      lines.push(`✓ ${e}`);
    }
    lines.push(``);
    lines.push(`If any of these are unclear, reply *CALL ME* with your best time, or call us: +1 604-653-5031.`);
    lines.push(``);
  }

  // Checklist (skip if it's just the "we'll review in consultation" placeholder)
  const checklistIsPlaceholder = svc.checklist.length === 1
    && /review your situation|consultation/i.test(svc.checklist[0] || "");
  if (svc.checklist && svc.checklist.length > 0 && !checklistIsPlaceholder) {
    lines.push(`📁 *Documents Checklist*`);
    for (const c of svc.checklist) {
      lines.push(`✅ ${c}`);
    }
    lines.push(``);
  }

  // Fee
  if (svc.feeText) {
    if (svc.needsConsultation) {
      // PR / Caregiver flow — emphasize consultation requirement
      lines.push(`💰 *Fee:* ${svc.feeText}`);
      lines.push(``);
      lines.push(`Payment via Interac e-transfer to: *newtonimmigration@gmail.com*`);
      lines.push(``);
      lines.push(`Once paid, share the receipt here and our team will set up your call right away.`);
    } else {
      lines.push(`💰 *Total: ${svc.feeText}*`);
      lines.push(``);
      lines.push(`Ready to start? Reply *YES* with your full name and we'll move forward 🚀`);
    }
  }

  return lines.join("\n");
}

// ── GET: list of services + their formatted messages ──
export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const services = Object.values(SERVICES).map(svc => ({
    key: svc.key,
    displayName: svc.displayName,
    emoji: svc.emoji,
    category: svc.category,
    feeText: svc.feeText,
    needsConsultation: svc.needsConsultation,
    message: formatServiceMessage(svc.key),
  }));

  return NextResponse.json({ services });
}
