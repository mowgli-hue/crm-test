import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase } from "@/lib/store";
import { canStaffAccessCase } from "@/lib/rbac";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8000";

// Verify the caller is allowed to act on this specific case (company scope + RBAC).
async function assertCaseAccess(request: NextRequest, caseId: string) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const caseItem = await getCase(user.companyId, caseId);
  if (!caseItem) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (user.userType === "staff" && !canStaffAccessCase(user.role, user.name, caseItem.assignedTo)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, caseItem };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await assertCaseAccess(request, params.id);
  if (access.error) return access.error;
  const body = await request.json().catch(() => ({}));
  const res = await fetch(`${AGENT_URL}/process/${params.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: body.action || "full_process" }),
  });
  return NextResponse.json(await res.json());
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await assertCaseAccess(request, params.id);
  if (access.error) return access.error;
  const jobId = request.nextUrl.searchParams.get("job_id");
  if (!jobId) return NextResponse.json({ error: "job_id required" }, { status: 400 });
  const res = await fetch(`${AGENT_URL}/status/${jobId}`);
  return NextResponse.json(await res.json());
}
