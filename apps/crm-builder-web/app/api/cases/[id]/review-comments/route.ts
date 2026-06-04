// ─────────────────────────────────────────────────────────────────────
// /api/cases/[id]/review-comments — Reviewer ↔ Processing back-and-forth
//
// Purpose: When a reviewer finds an issue with a case, they leave a
// "review comment". The processing staff who prepared the case gets an
// email ping and can reply (in CRM). The conversation lives on the case
// forever. Each thread can be marked "resolved" when the issue is fixed.
//
// Endpoints:
//   GET                   → list all review comments (threaded) for a case
//   POST                  → add a new top-level comment OR reply
//   PATCH /resolve        → mark a thread resolved
//
// Schema:
//   review_comments table — case_id, parent_id (NULL for top-level), body,
//   author_user_id, author_name, status (open/resolved), created_at,
//   resolved_at, resolved_by_user_id.
//
// Email flow:
//   - New comment from reviewer  → email to assigned processing staff +
//                                  their lead (ProcessingLead role)
//   - Reply from processing      → email to original commenter (reviewer)
//   - Resolve action             → email to original commenter
//
// Failure mode:
//   Email failures are NON-FATAL. The comment still saves to DB; we just
//   log the email error. A missing email config doesn't break the feature.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getCase, getCaseAnyCompany, listAllStaff, addNotification } from "@/lib/store";
import { sendEmail, reviewCommentEmail, isEmailConfigured } from "@/lib/email";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_comments (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      parent_id TEXT,                                   -- NULL for top-level, ID of parent comment for replies
      body TEXT NOT NULL,
      author_user_id TEXT,                              -- nullable (deleted users)
      author_name TEXT NOT NULL,
      author_role TEXT,                                 -- 'Reviewer' | 'Processing' | 'ProcessingLead' | etc.
      status TEXT NOT NULL DEFAULT 'open',              -- 'open' | 'resolved'
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      resolved_by_user_id TEXT,
      resolved_by_name TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_comments_case ON review_comments (case_id, created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_comments_parent ON review_comments (parent_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_comments_status ON review_comments (status, company_id)`);
}

// ─── Recipient resolution ───
//
// Given a case + the author of a new comment/reply, figure out who should
// be notified. The rule:
//   - On a top-level (new) review comment: notify case's assigned staff
//     + all ProcessingLead users (if any)
//   - On a reply: notify the author of the parent comment AND the original
//     thread starter (if different)
//   - Always exclude the author themselves (don't ping yourself)
async function resolveRecipients(params: {
  companyId: string;
  caseId: string;
  authorUserId: string;
  parentId: string | null;
}): Promise<Array<{ userId: string; name: string; email: string }>> {
  // Company-agnostic lookup: a company-scoped getCase can miss the case when
  // the author's account carries a different company id than the case.
  const caseItem = (await getCase(params.companyId, params.caseId)) || (await getCaseAnyCompany(params.caseId));
  // All staff (company-agnostic) so the assigned preparer is found and emailed
  // even if their account carries a different company id than the reviewer's.
  const allUsers = await listAllStaff();
  const recipients = new Map<string, { userId: string; name: string; email: string }>();

  const addUser = (u: any) => {
    if (!u || u.id === params.authorUserId) return;
    if (!u.email) return;
    if (u.active === false) return;
    if (recipients.has(u.id)) return;
    recipients.set(u.id, { userId: u.id, name: u.name || "User", email: u.email });
  };

  if (params.parentId) {
    // Reply → notify everyone who has commented in this thread (so the
    // reviewer gets pinged when staff replies, and vice versa).
    const threadRes = await pool.query(
      `SELECT DISTINCT author_user_id FROM review_comments WHERE id = $1 OR parent_id = $1`,
      [params.parentId]
    );
    for (const row of threadRes.rows) {
      const u = allUsers.find((x: any) => x.id === row.author_user_id);
      addUser(u);
    }
  } else {
    // New top-level comment → notify case-assigned staff + ProcessingLeads
    const assignedToName = caseItem?.assignedTo;
    if (assignedToName && assignedToName !== "Unassigned") {
      const assignedUser = allUsers.find((u: any) => u.name === assignedToName);
      addUser(assignedUser);
    }
    for (const u of allUsers) {
      if (u.role === "ProcessingLead" || u.role === "Admin") {
        addUser(u);
      }
    }
  }

  return Array.from(recipients.values());
}

// ─── GET: list comments for a case (threaded) ───
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSchema();
  // Read by case_id ONLY. Staff accounts have drifted between two company IDs
  // ("CMP-1" vs "newton"), which made a reviewer's comment invisible to the
  // processing staffer (and vice-versa) — the whole point of this thread is
  // that BOTH sides see it. case_id is unique in this single-firm deployment.
  const r = await pool.query(
    `SELECT * FROM review_comments
     WHERE case_id = $1
     ORDER BY created_at ASC`,
    [params.id]
  );
  return NextResponse.json({ comments: r.rows });
}

// ─── POST: add new comment OR reply ───
//
// Body: { body: string, parentId?: string | null }
// - If parentId is provided → this is a reply to that thread
// - If null/missing       → new top-level comment
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const text = String(body?.body || "").trim();
  const parentId: string | null = body?.parentId || null;
  if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });
  if (text.length > 10000) return NextResponse.json({ error: "body too long" }, { status: 413 });

  await ensureSchema();

  // Validate parentId if provided (must exist + belong to this case)
  if (parentId) {
    const parentRes = await pool.query(
      `SELECT id FROM review_comments WHERE id = $1 AND case_id = $2`,
      [parentId, params.id]
    );
    if (parentRes.rowCount === 0) {
      return NextResponse.json({ error: "Parent comment not found" }, { status: 404 });
    }
  }

  const id = `RC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await pool.query(
    `INSERT INTO review_comments (id, case_id, company_id, parent_id, body, author_user_id, author_name, author_role, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open')`,
    [id, params.id, user.companyId, parentId, text, user.id, user.name, user.role]
  );

  // ── Send notifications (email + in-app) ──
  // Run async, don't block the response. Email failure is logged but doesn't
  // fail the API call — comment is saved either way.
  (async () => {
    try {
      const recipients = await resolveRecipients({
        companyId: user.companyId,
        caseId: params.id,
        authorUserId: user.id,
        parentId,
      });

      // In-app notifications for each recipient
      const caseItem = (await getCase(user.companyId, params.id)) || (await getCaseAnyCompany(params.id));
      const caseClient = caseItem?.client || params.id;
      const caseFormType = caseItem?.formType || "Application";
      const verb = parentId ? "replied to a comment on" : "commented on";

      for (const r of recipients) {
        await addNotification({
          companyId: user.companyId,
          userId: r.userId,
          type: "review_comment",
          message: `📝 ${user.name} ${verb} ${caseClient} (${params.id})`,
          link: `/?case=${encodeURIComponent(params.id)}#review-comments`,
        }).catch(() => {});
      }

      // Email notifications (only if configured)
      if (recipients.length > 0 && isEmailConfigured()) {
        const tpl = reviewCommentEmail({
          caseId: params.id,
          caseClient,
          caseFormType,
          reviewerName: user.name,
          commentText: text,
          isReply: Boolean(parentId),
        });
        await sendEmail({
          to: recipients.map(r => r.email),
          subject: tpl.subject,
          html: tpl.html,
          replyTo: user.email,  // replies go directly to the commenter (nice UX)
        });
      } else if (recipients.length > 0) {
        console.log(`📧 Email skipped (not configured) — would have notified ${recipients.length} recipient(s) for review comment ${id}`);
      }
    } catch (e) {
      console.error("Review comment notification error (non-fatal):", e);
    }
  })();

  return NextResponse.json({ ok: true, id });
}

// ─── PATCH: mark thread resolved (or re-open) ───
//
// Body: { commentId: string, status: "open" | "resolved" }
// commentId can be top-level OR a reply — we resolve the entire thread by
// finding the root and updating all related rows. Simpler: just update the
// one row's status. Show "resolved" badge on the comment that was resolved.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const commentId = String(body?.commentId || "");
  const status = String(body?.status || "");
  if (!commentId) return NextResponse.json({ error: "commentId required" }, { status: 400 });
  if (status !== "open" && status !== "resolved") {
    return NextResponse.json({ error: "status must be open or resolved" }, { status: 400 });
  }

  await ensureSchema();

  // Find root of thread: if this is a reply, walk up to top-level
  const rootRes = await pool.query(
    `SELECT id, parent_id FROM review_comments
     WHERE id = $1 AND case_id = $2`,
    [commentId, params.id]
  );
  if (rootRes.rowCount === 0) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  const rootId = rootRes.rows[0].parent_id || rootRes.rows[0].id;

  // Update root + all replies to same status
  if (status === "resolved") {
    await pool.query(
      `UPDATE review_comments
       SET status = 'resolved', resolved_at = NOW(),
           resolved_by_user_id = $1, resolved_by_name = $2
       WHERE (id = $3 OR parent_id = $3)`,
      [user.id, user.name, rootId]
    );
  } else {
    await pool.query(
      `UPDATE review_comments
       SET status = 'open', resolved_at = NULL,
           resolved_by_user_id = NULL, resolved_by_name = NULL
       WHERE (id = $1 OR parent_id = $1)`,
      [rootId]
    );
  }

  return NextResponse.json({ ok: true });
}
