import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { canStaffAccessCase, canUseAccounting } from "@/lib/rbac";
import { addCaseMilestone, addInvoice, getCase, recordCasePayment, toggleMilestone, updateCaseFinancials } from "@/lib/store";
import { getPool } from "@/lib/postgres-store";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!canUseAccounting(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const caseItem = await getCase(user.companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  if (!canStaffAccessCase(user.role, user.name, caseItem.assignedTo)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const updated = await updateCaseFinancials(user.companyId, params.id, {
    name: body.name,
    retainerAmount: body.retainerAmount,
    balanceAmount: body.balanceAmount
  });
  if (!updated) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  return NextResponse.json({ case: updated });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.userType !== "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!canUseAccounting(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const caseItem = await getCase(user.companyId, params.id);
  if (!caseItem) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  if (!canStaffAccessCase(user.role, user.name, caseItem.assignedTo)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const actionRaw = String(body.action ?? "").trim();
  const action = actionRaw.toLowerCase().replace(/[\s_-]+/g, "");
  const amountInput = String(body.amount ?? "").trim();
  const amountMaybe = Number(amountInput.replace(/[^0-9.]/g, "") || 0);

  if (action === "addmilestone") {
    const title = String(body.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    const updated = await addCaseMilestone(user.companyId, params.id, title);
    if (!updated) return NextResponse.json({ error: "Case not found" }, { status: 404 });
    return NextResponse.json({ case: updated });
  }

  if (action === "addinvoice") {
    const title = String(body.title ?? "").trim();
    const amount = Number(body.amount ?? 0);
    if (!title || amount <= 0) return NextResponse.json({ error: "title and positive amount required" }, { status: 400 });
    const updated = await addInvoice(user.companyId, params.id, title, amount);
    if (!updated) return NextResponse.json({ error: "Case not found" }, { status: 404 });
    return NextResponse.json({ case: updated });
  }

  if (action === "togglemilestone") {
    const milestoneId = String(body.milestoneId ?? "").trim();
    if (!milestoneId) return NextResponse.json({ error: "milestoneId required" }, { status: 400 });
    const updated = await toggleMilestone(user.companyId, params.id, milestoneId);
    if (!updated) return NextResponse.json({ error: "Case not found" }, { status: 404 });
    return NextResponse.json({ case: updated });
  }

  if (
    action === "recordpayment" ||
    action === "payment" ||
    action === "confirmpayment" ||
    action === "record" ||
    (!action && Number.isFinite(amountMaybe) && amountMaybe > 0)
  ) {
    const amount = amountMaybe;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Valid amount required" }, { status: 400 });
    }
    const updated = await recordCasePayment(user.companyId, params.id, amount);
    if (!updated) return NextResponse.json({ error: "Case not found" }, { status: 404 });

    // Auto-sync into Accounting so money received shows up without manual
    // re-entry. Marked source='case' (vs manual). Non-fatal if it fails.
    try {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS manual_payments (
          id TEXT PRIMARY KEY, company_id TEXT NOT NULL, payment_date DATE NOT NULL,
          amount NUMERIC(10,2) NOT NULL, client_name TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT '',
          added_by TEXT NOT NULL DEFAULT '', case_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`ALTER TABLE manual_payments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'`);
      await pool.query(
        `INSERT INTO manual_payments (id, company_id, payment_date, amount, client_name, description, method, added_by, case_id, source)
         VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6,$7,$8,'case')`,
        [
          `MP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          user.companyId, amount,
          String((updated as any).client || ""),
          `Case payment — ${params.id}`,
          String(body.method || ""),
          user.name || "",
          params.id,
        ]
      );
    } catch (e) {
      console.error("[financials] accounting sync failed:", (e as Error).message);
    }

    return NextResponse.json({ case: updated });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
