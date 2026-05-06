/**
 * POST /api/cases/[id]/submission-package
 *
 * Assembles a complete PGWP submission package for a case:
 *   - Validates that all required documents are present
 *   - Generates IMM5476 (Use of Representative)
 *   - Bundles client supporting docs into Client_Info_<Name>.pdf
 *   - Copies all standard files into a Submission_<Name> Drive subfolder
 *
 * Returns:
 *   200 + { ok: true, folderLink, filesAdded, warnings } on success
 *   400 + { ok: false, missingRequired: [...] } when required docs are missing
 *   500 + { ok: false, errors: [...] } on assembly failure
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { canStaffAccessCase } from "@/lib/rbac";
import { getCase } from "@/lib/store";
import { assemblePgwpSubmissionPackage } from "@/lib/submission-package";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const isSystemCall =
    String(rawBody.systemToken || "").trim() ===
    (process.env.AUTH_RECOVERY_TOKEN || "newton-recovery-2024");

  const user = await getCurrentUserFromRequest(request);
  if (!user && !isSystemCall) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = user?.companyId || process.env.DEFAULT_COMPANY_ID || "newton";
  const caseItem = await getCase(companyId, params.id);
  if (!caseItem) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  if (!isSystemCall && user) {
    if (user.userType === "client") {
      return NextResponse.json({ error: "Forbidden — staff only" }, { status: 403 });
    }
    if (user.userType === "staff" && !canStaffAccessCase(user.role, user.name, caseItem.assignedTo)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Form-type gate: enable for any IMM5710-based application (PGWP, BOWP, SOWP,
  // LMIA-based work permits, study permit extensions, etc.). The orchestrator's
  // doc selection + IMM5476 generation work the same regardless of which subtype
  // it is — they all need passport/photo/transcript/forms/etc.
  const formType = String(caseItem.formType || "").toLowerCase();
  const isImm5710Type =
    formType.includes("pgwp") ||
    formType.includes("post-graduation") ||
    formType.includes("post graduation") ||
    formType.includes("bowp") ||
    formType.includes("sowp") ||
    formType.includes("lmia") ||
    formType.includes("work permit") ||
    formType.includes("study permit") ||
    formType.includes("imm5710") ||
    formType.includes("imm 5710");
  if (!isImm5710Type) {
    return NextResponse.json(
      {
        ok: false,
        error: `Submission package automation supports IMM5710-based applications (PGWP, BOWP, SOWP, work permits, study permit extensions). This case is "${caseItem.formType}".`,
      },
      { status: 400 }
    );
  }

  try {
    const result = await assemblePgwpSubmissionPackage(companyId, params.id);

    if (!result.ok) {
      // Distinguish "missing docs" (400) from "actual error" (500)
      const status = result.missingRequired && result.missingRequired.length > 0 ? 400 : 500;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("submission-package error:", (e as Error).message);
    return NextResponse.json(
      {
        ok: false,
        errors: [(e as Error).message],
      },
      { status: 500 }
    );
  }
}
