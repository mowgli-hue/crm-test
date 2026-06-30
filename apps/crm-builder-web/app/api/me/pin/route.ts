// POST /api/me/pin  — the logged-in user sets their OWN 4-6 digit check-in PIN.
// We never see or set it for them; it's hashed at rest.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { setUserPin } from "@/lib/store";

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const pin = String(body.pin || "").replace(/\D/g, "");
  if (pin.length < 4 || pin.length > 6) {
    return NextResponse.json({ error: "PIN must be 4 to 6 digits." }, { status: 400 });
  }
  const ok = await setUserPin(user.id, pin);
  if (!ok) return NextResponse.json({ error: "Could not set PIN." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
