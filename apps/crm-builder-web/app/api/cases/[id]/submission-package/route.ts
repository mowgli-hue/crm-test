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
import { isValidSystemToken } from "@/lib/auth-recovery-token";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const isSystemCall =
    isValidSystemToken(rawBody.systemToken);

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

  // Form-type gate: enable for any application we have a submission profile
  // for. Each profile in submission-package.ts (pickProfile) handles its own
  // doc selection — gate just ensures we don't try to assemble for completely
  // unsupported types (e.g. US visa, UK visa, refugee).
  const formType = String(caseItem.formType || "").toLowerCase();
  const isSupportedType =
    // PGWP / BOWP / SOWP / LMIA / generic work permits / restoration → PROFILE_PGWP or PROFILE_SOWP
    formType.includes("pgwp") ||
    formType.includes("post-graduation") ||
    formType.includes("post graduation") ||
    formType.includes("bowp") ||
    formType.includes("sowp") ||
    formType.includes("vowp") ||
    formType.includes("vulnerable") ||
    formType.includes("lmia") ||
    formType.includes("work permit") ||
    formType.includes("open work permit") ||
    formType.includes("restoration") ||
    // Study permit + extension → PROFILE_STUDY_PERMIT_EXTENSION
    formType.includes("study permit") ||
    formType.includes("imm5709") ||
    formType.includes("imm 5709") ||
    formType.includes("imm5710") ||
    formType.includes("imm 5710") ||
    // TRV / visitor visa / super visa / visitor record → PROFILE_TRV
    formType.includes("trv") ||
    formType.includes("visitor visa") ||
    formType.includes("visitor record") ||
    formType.includes("super visa") ||
    formType.includes("supervisa") ||
    formType.includes("imm5257") ||
    formType.includes("imm 5257") ||
    // PR Card Renewal → PROFILE_PR_CARD
    formType.includes("pr card") ||
    formType.includes("permanent resident card") ||
    formType.includes("imm5444") ||
    formType.includes("imm 5444") ||
    // Citizenship → PROFILE_CITIZENSHIP
    formType.includes("citizenship") ||
    formType.includes("cit 0002") ||
    formType.includes("cit0002");
  if (!isSupportedType) {
    return NextResponse.json(
      {
        ok: false,
        error: `Submission package automation does not yet support "${caseItem.formType}". Supported types: PGWP, BOWP, SOWP, LMIA, work permits, study permit / extension, TRV / visitor visa / super visa, PR card renewal, citizenship. Email engineering to add a profile for this type.`,
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
