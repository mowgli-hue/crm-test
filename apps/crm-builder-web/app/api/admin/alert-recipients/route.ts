// app/api/admin/alert-recipients/route.ts
//
// Manage the list of people who get a WhatsApp ping when the marketing bot hits
// an "important" moment (office visit, blocked fabrication, frustrated client,
// ready-to-pay lead).
//   GET    → list recipients
//   POST   → add { phone, label }
//   DELETE → remove ?id=ALR-...
//
// Auth: Admin only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listAlertRecipients, addAlertRecipient, removeAlertRecipient } from "@/lib/store";

async function requireAdmin(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.userType !== "staff" || user.role !== "Admin") {
    return { error: NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 }) };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(request);
  if (gate.error) return gate.error;
  return NextResponse.json({ ok: true, recipients: await listAlertRecipients() });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin(request);
  if (gate.error) return gate.error;
  const body = await request.json().catch(() => ({}));
  const phone = String(body?.phone || "").trim();
  const label = String(body?.label || "").trim();
  if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 });
  const rec = await addAlertRecipient({ phone, label });
  if (!rec) return NextResponse.json({ error: "Invalid phone — include country code (e.g. 16049071276)." }, { status: 400 });
  return NextResponse.json({ ok: true, recipient: rec, recipients: await listAlertRecipients() });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdmin(request);
  if (gate.error) return gate.error;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const removed = await removeAlertRecipient(id);
  return NextResponse.json({ ok: true, removed, recipients: await listAlertRecipients() });
}
