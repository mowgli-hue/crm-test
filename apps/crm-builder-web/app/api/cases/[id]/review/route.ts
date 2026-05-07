// ─────────────────────────────────────────────────────────────────────
// PUT/GET /api/cases/[id]/review
//
// Persist Pre-Submission Review checklist state for a case.
// State shape: { [itemKey]: { ticked: boolean, by?: string, at?: string } }
// Plus optional markedReadyAt + markedReadyBy when staff finalize the review.
//
// Why a dedicated endpoint: the case object is large; we don't want to
// serialize/deserialize the whole thing for a single tick. This endpoint
// patches just the review fields.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase } from "@/lib/store";
import { readStore, writeStore } from "@/lib/store";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const caseItem = await getCase(user.companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  return NextResponse.json({
    preSubmissionReview: (caseItem as any).preSubmissionReview || {},
    markedReadyAt: (caseItem as any).markedReadyAt || null,
    markedReadyBy: (caseItem as any).markedReadyBy || null,
  });
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const review = body?.preSubmissionReview;
  if (!review || typeof review !== "object") {
    return NextResponse.json({ error: "preSubmissionReview object required" }, { status: 400 });
  }

  // Validate shape: every value must be { ticked: boolean, by?: string, at?: string }
  for (const [key, val] of Object.entries(review)) {
    if (!val || typeof val !== "object") {
      return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 });
    }
    const v = val as any;
    if (typeof v.ticked !== "boolean") {
      return NextResponse.json({ error: `Invalid ticked value for ${key}` }, { status: 400 });
    }
  }

  // Atomically update just the review fields on the case.
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === user.companyId && c.id === params.id);
  if (idx === -1) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const current = store.cases[idx] as any;
  store.cases[idx] = {
    ...current,
    preSubmissionReview: review,
    // Only update markedReady fields if explicitly sent (so simple ticks
    // don't accidentally finalize the review).
    ...(body.markedReadyAt !== undefined ? { markedReadyAt: body.markedReadyAt } : {}),
    ...(body.markedReadyBy !== undefined ? { markedReadyBy: body.markedReadyBy } : {}),
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);

  return NextResponse.json({
    ok: true,
    preSubmissionReview: store.cases[idx].preSubmissionReview,
    markedReadyAt: (store.cases[idx] as any).markedReadyAt || null,
    markedReadyBy: (store.cases[idx] as any).markedReadyBy || null,
  });
}
