// app/api/admin/dedupe-documents/route.ts
//
// Clean up the duplicate document records created before the WhatsApp media
// pipeline became idempotent (one upload had been turning into many records on
// webhook retries). Within a single case, documents that share the same
// normalized name are duplicates of the same upload; we keep ONE (preferring a
// record that has a link, newest otherwise) and drop the rest.
//
// SAFE BY DEFAULT: runs as a DRY RUN and only reports what it would remove.
// Pass { apply: true } to actually delete. Optionally scope to one case with
// { caseId: "CASE-1552" }. Auth: Admin only. Never touches the underlying
// S3/Drive files — only the CRM records.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { mutateStore } from "@/lib/store";

function normalizeName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")        // drop extension
    .replace(/\(exp[^)]*\)/g, "")       // drop "(exp 2026-...)" so re-OCR variance collapses
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff" || user.role !== "Admin") {
    return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const onlyCaseId = String(body?.caseId || "").trim();
  const apply = body?.apply === true;

  const result = await mutateStore((store) => {
    const docs = Array.isArray(store.documents) ? store.documents : [];
    const companyId = user.companyId;

    // Group by case → normalized name.
    const groups = new Map<string, typeof docs>();
    for (const d of docs) {
      if (d.companyId !== companyId) continue;
      if (onlyCaseId && d.caseId !== onlyCaseId) continue;
      const key = `${d.caseId}::${normalizeName(d.name)}`;
      const arr = groups.get(key) || [];
      arr.push(d);
      groups.set(key, arr);
    }

    const removeIds = new Set<string>();
    const perCase = new Map<string, { kept: number; removed: number }>();
    for (const arr of groups.values()) {
      if (arr.length <= 1) continue;
      // Keep the best record: prefer one with a non-empty link, then newest.
      const sorted = [...arr].sort((a, b) => {
        const al = a.link ? 1 : 0, bl = b.link ? 1 : 0;
        if (al !== bl) return bl - al;
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });
      const keep = sorted[0];
      for (const d of sorted.slice(1)) removeIds.add(d.id);
      const c = perCase.get(keep.caseId) || { kept: 0, removed: 0 };
      c.kept += 1;
      c.removed += sorted.length - 1;
      perCase.set(keep.caseId, c);
    }

    if (apply && removeIds.size > 0) {
      store.documents = docs.filter((d) => !removeIds.has(d.id));
    }

    const byCase = [...perCase.entries()]
      .map(([caseId, v]) => ({ caseId, duplicatesRemoved: v.removed }))
      .sort((a, b) => b.duplicatesRemoved - a.duplicatesRemoved);

    return {
      scannedDocuments: docs.filter((d) => d.companyId === companyId && (!onlyCaseId || d.caseId === onlyCaseId)).length,
      duplicateRecords: removeIds.size,
      casesAffected: byCase.length,
      topCases: byCase.slice(0, 15),
    };
  });

  return NextResponse.json({
    ok: true,
    applied: apply,
    ...result,
    message: apply
      ? `Removed ${result.duplicateRecords} duplicate document record(s) across ${result.casesAffected} case(s).`
      : `DRY RUN — would remove ${result.duplicateRecords} duplicate record(s) across ${result.casesAffected} case(s). Re-run with {"apply": true} to delete.`,
  });
}
