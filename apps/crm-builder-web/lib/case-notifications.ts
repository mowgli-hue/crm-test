// -----------------------------------------------------------------------------
// lib/case-notifications.ts
//
// Centralized email notifications for case-related events. Every code path
// that wants to alert the team about a case event should call notifyCaseEvent.
// All emails go to TEAM_INBOX (configurable via env), built from a consistent
// template, and include a direct link back to the case.
//
// Designed to be non-fatal: if email fails to send (rate limit, SMTP down,
// recipient invalid), the caller continues. The email is a side effect; the
// original action (creating a case, uploading a doc, etc.) is the priority.
// -----------------------------------------------------------------------------

import { sendEmail } from "./email";
import { getCase } from "./store";

const TEAM_INBOX = process.env.TEAM_INBOX_EMAIL || "team@newtonimmigration.com";

function appBaseUrl(): string {
  return process.env.PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || "https://crm.newtonimmigration.com";
}

function caseDeepLink(caseId: string): string {
  return appBaseUrl() + "/?case=" + encodeURIComponent(caseId);
}

const HEADER = `<div style="background:#0B2F5C;padding:14px 20px;border-radius:8px 8px 0 0;">
  <span style="color:white;font-size:16px;font-weight:bold;letter-spacing:0.5px;">NEWTON IMMIGRATION</span>
  <span style="color:#ef4444;font-size:16px;font-weight:bold;">.</span>
</div>
<div style="background:#f8fafc;padding:20px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;color:#0f172a;line-height:1.55;">`;

const FOOTER = `<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0 10px;" />
  <p style="font-size:11px;color:#94a3b8;margin:0;">
    Automated notification from the Newton Immigration CRM.<br/>
    Newton Immigration Inc. - 8327 120 Street, Delta, BC - RCIC #R705964
  </p>
</div>`;

function escapeHtml(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ctaButton(caseId: string, label: string = "Open Case in CRM"): string {
  return `<p style="margin:16px 0 0;"><a href="${caseDeepLink(caseId)}" style="display:inline-block;background:#0B2F5C;color:white;padding:10px 18px;border-radius:6px;font-weight:600;text-decoration:none;font-size:13px;">${label} →</a></p>`;
}

// ---- Event types -----------------------------------------------------------

export type CaseEvent =
  | { type: "case_created"; createdBy?: string }
  | { type: "doc_uploaded"; docName: string; docKind?: string; isSubmittedCase: boolean }
  | { type: "intake_skipped"; skipMode: string; skipReason: string; phone?: string }
  | { type: "submission_complete"; applicationNumber: string; submittedAt?: string }
  | { type: "reassigned"; previousAssignee: string | null; newAssignee: string | null; changedBy?: string };

// ---- Renderers -------------------------------------------------------------

function renderEmail(args: {
  caseId: string;
  caseClient: string;
  caseFormType: string;
  assignedTo: string | null;
  event: CaseEvent;
}): { subject: string; html: string } {
  const { caseId, caseClient, caseFormType, assignedTo, event } = args;
  const safeClient = escapeHtml(caseClient || "Unknown client");
  const safeFormType = escapeHtml(caseFormType || "Unknown");
  const safeAssigned = escapeHtml(assignedTo || "Unassigned");
  const caseLine = `<p style="margin:0 0 14px;color:#64748b;font-size:13px;">${safeClient} - ${safeFormType} - <code style="font-size:12px;">${escapeHtml(caseId)}</code><br/>Assigned: ${safeAssigned}</p>`;

  let subject = "";
  let body = "";

  switch (event.type) {
    case "case_created": {
      subject = "[CRM] New case: " + caseClient + " - " + caseFormType + " (" + caseId + ")";
      const by = event.createdBy ? " by " + escapeHtml(event.createdBy) : "";
      body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">📂 New case created</h2>
        ${caseLine}
        <p style="margin:0 0 12px;">A new case has been opened${by}.</p>`;
      break;
    }
    case "doc_uploaded": {
      const docLabel = escapeHtml(event.docName || "document");
      const docKind = escapeHtml(event.docKind || "file");
      const urgentPrefix = event.isSubmittedCase ? "[URGENT] " : "";
      subject = urgentPrefix + "[CRM] " + caseClient + " uploaded a " + (event.docKind || "doc") + " (" + caseId + ")";
      const urgentNote = event.isSubmittedCase
        ? `<p style="background:#fef2f2;border-left:4px solid #ef4444;padding:8px 12px;margin:0 0 12px;color:#991b1b;font-weight:600;">⚠ This case is already SUBMITTED. The new doc may need to be added to the submission or held for IRCC.</p>`
        : "";
      body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">📎 Client uploaded a document</h2>
        ${caseLine}
        ${urgentNote}
        <p style="margin:0 0 12px;">Document: <strong>${docLabel}</strong> (kind: ${docKind})</p>`;
      break;
    }
    case "intake_skipped": {
      subject = "[CRM] Intake auto-skipped for " + caseClient + " (" + caseId + ")";
      body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">⚠ Intake auto-skipped</h2>
        ${caseLine}
        <p style="margin:0 0 12px;">The intake bot did NOT start a fresh intake for this case because the system detected a conflict. This is usually correct (e.g., the same phone already has an active session), but worth a glance.</p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Mode:</strong> <code style="font-size:12px;">${escapeHtml(event.skipMode)}</code></p>
        <p style="margin:0 0 12px;font-size:13px;"><strong>Reason:</strong> ${escapeHtml(event.skipReason)}</p>`;
      break;
    }
    case "submission_complete": {
      subject = "[CRM] Submitted: " + caseClient + " - " + event.applicationNumber + " (" + caseId + ")";
      const dateLabel = event.submittedAt ? new Date(event.submittedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : "today";
      body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">✅ Application submitted to IRCC</h2>
        ${caseLine}
        <p style="margin:0 0 8px;"><strong>Application Number:</strong> <code style="font-size:13px;">${escapeHtml(event.applicationNumber)}</code></p>
        <p style="margin:0 0 12px;">Submitted ${dateLabel}.</p>`;
      break;
    }
    case "reassigned": {
      const prev = escapeHtml(event.previousAssignee || "Unassigned");
      const next = escapeHtml(event.newAssignee || "Unassigned");
      const by = event.changedBy ? " by " + escapeHtml(event.changedBy) : "";
      subject = "[CRM] Reassigned: " + caseClient + " - " + (event.newAssignee || "Unassigned") + " (" + caseId + ")";
      body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">🔀 Case reassigned</h2>
        ${caseLine}
        <p style="margin:0 0 12px;">Assignment changed from <strong>${prev}</strong> to <strong>${next}</strong>${by}.</p>`;
      break;
    }
  }

  const html = HEADER + body + ctaButton(caseId) + FOOTER;
  return { subject, html };
}

// ---- Public API ------------------------------------------------------------

export async function notifyCaseEvent(args: {
  companyId: string;
  caseId: string;
  event: CaseEvent;
}): Promise<{ sent: boolean; error?: string }> {
  try {
    const c = await getCase(args.companyId, args.caseId);
    if (!c) {
      console.warn("[case-notify] case not found for event", args.event.type, args.caseId);
      return { sent: false, error: "case_not_found" };
    }
    const { subject, html } = renderEmail({
      caseId: c.id,
      caseClient: c.client || "",
      caseFormType: c.formType || "",
      assignedTo: c.assignedTo || null,
      event: args.event,
    });
    const result = await sendEmail({ to: TEAM_INBOX, subject, html });
    if (!result.success) {
      console.warn("[case-notify] email send failed for", args.event.type, args.caseId, result.error);
      return { sent: false, error: result.error };
    }
    console.log("[case-notify] sent " + args.event.type + " for " + args.caseId + " to " + TEAM_INBOX);
    return { sent: true };
  } catch (e) {
    console.warn("[case-notify] threw for", args.event.type, args.caseId, (e as Error).message);
    return { sent: false, error: (e as Error).message };
  }
}