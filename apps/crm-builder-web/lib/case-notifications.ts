// -----------------------------------------------------------------------------
// lib/case-notifications.ts
//
// Per-person email notifications for case-related events. Emails are routed
// to the staff member who owns the case (case.assignedTo -> users.email).
// Falls back to TEAM_INBOX_EMAIL when the case has no assigned staff, or when
// the assignee name does not resolve to a user with an email.
//
// Each event uses a personal, second-person subject line ("A new case is
// assigned to you", "Your client uploaded a doc", "Your case has not been
// submitted in N days") so staff see at a glance whether it concerns them.
//
// Reassignment events fan out into two emails: one to the NEW assignee and
// one to the previous assignee, each with their own framing.
// -----------------------------------------------------------------------------

import { sendEmail } from "./email";
import { getCase, listUsers } from "./store";

const TEAM_INBOX = process.env.TEAM_INBOX_EMAIL || "newtonimmigration@gmail.com";

function appBaseUrl(): string {
  return process.env.PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || "https://crm.newtonimmigration.com";
}

function caseDeepLink(caseId: string): string {
  return appBaseUrl() + "/?case=" + encodeURIComponent(caseId);
}

// Look up a staff member email by their assignedTo name. Returns null if
// not found or if the name is empty/Unassigned.
async function resolveStaffEmail(companyId: string, name: string | null | undefined): Promise<{ name: string; email: string } | null> {
  const key = String(name || "").trim().toLowerCase();
  if (!key || key === "unassigned") return null;
  try {
    const users = await listUsers(companyId);
    const u = users.find((u) => u.email && String(u.name).trim().toLowerCase() === key && u.userType === "staff");
    if (u && u.email) return { name: u.name, email: u.email };
  } catch (e) {
    console.warn("[case-notify] listUsers threw:", (e as Error).message);
  }
  return null;
}

const HEADER = `<div style="background:#0B2F5C;padding:14px 20px;border-radius:8px 8px 0 0;"><span style="color:white;font-size:16px;font-weight:bold;letter-spacing:0.5px;">NEWTON IMMIGRATION</span><span style="color:#ef4444;font-size:16px;font-weight:bold;">.</span></div><div style="background:#f8fafc;padding:20px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;color:#0f172a;line-height:1.55;">`;

const FOOTER = `<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0 10px;" /><p style="font-size:11px;color:#94a3b8;margin:0;">Automated notification from the Newton Immigration CRM.<br/>Newton Immigration Inc. - 8327 120 Street, Delta, BC - RCIC #R705964</p></div>`;

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

export type CaseEvent =
  | { type: "case_created"; createdBy?: string }
  | { type: "doc_uploaded"; docName: string; docKind?: string; isSubmittedCase: boolean }
  | { type: "intake_skipped"; skipMode: string; skipReason: string; phone?: string }
  | { type: "submission_complete"; applicationNumber: string; submittedAt?: string }
  | { type: "reassigned"; previousAssignee: string | null; newAssignee: string | null; changedBy?: string };

type Email = { to: string; subject: string; html: string };

function caseBlock(caseId: string, caseClient: string, caseFormType: string, assignedTo: string | null): string {
  return `<p style="margin:0 0 14px;color:#64748b;font-size:13px;">${escapeHtml(caseClient)} - ${escapeHtml(caseFormType)} - <code style="font-size:12px;">${escapeHtml(caseId)}</code><br/>Assigned: ${escapeHtml(assignedTo || "Unassigned")}</p>`;
}

// Build the list of emails to send for a given event. Different events may
// fan out to multiple recipients (e.g. reassignment notifies both sides).
async function buildEmails(args: {
  companyId: string;
  caseId: string;
  caseClient: string;
  caseFormType: string;
  assignedTo: string | null;
  event: CaseEvent;
}): Promise<Email[]> {
  const { caseId, caseClient, caseFormType, assignedTo, event } = args;
  const block = caseBlock(caseId, caseClient, caseFormType, assignedTo);
  const cta = ctaButton(caseId);
  const ownerEmailObj = await resolveStaffEmail(args.companyId, assignedTo);
  const primaryRecipient = ownerEmailObj?.email || TEAM_INBOX;
  const ownerFirstName = ownerEmailObj?.name?.split(" ")?.[0] || "team";

  const emails: Email[] = [];

  switch (event.type) {
    case "case_created": {
      const by = event.createdBy ? " by " + escapeHtml(event.createdBy) : "";
      const subject = "[CRM] A new case is assigned to you: " + caseClient + " (" + caseId + ")";
      const body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">📂 New case assigned to you</h2>
        ${block}
        <p style="margin:0 0 12px;">Hi ${escapeHtml(ownerFirstName)} - a new case has been opened${by} and assigned to you. Please open it to review the client details and continue the intake.</p>`;
      emails.push({ to: primaryRecipient, subject, html: HEADER + body + cta + FOOTER });
      break;
    }
    case "doc_uploaded": {
      const docLabel = escapeHtml(event.docName || "document");
      const docKind = escapeHtml(event.docKind || "file");
      const urgent = event.isSubmittedCase;
      const subject = (urgent ? "[URGENT] " : "") + "[CRM] Your client " + caseClient + " uploaded a " + (event.docKind || "doc") + " (" + caseId + ")";
      const urgentNote = urgent
        ? `<p style="background:#fef2f2;border-left:4px solid #ef4444;padding:8px 12px;margin:0 0 12px;color:#991b1b;font-weight:600;">⚠ Your case is already SUBMITTED. The new document may need to be added to the submission or held for IRCC follow-up. Please review before responding to the client.</p>`
        : "";
      const body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">📎 Your client uploaded a document</h2>
        ${block}
        ${urgentNote}
        <p style="margin:0 0 12px;">Hi ${escapeHtml(ownerFirstName)} - your client just uploaded <strong>${docLabel}</strong> (kind: ${docKind}). Open the case to view it.</p>`;
      emails.push({ to: primaryRecipient, subject, html: HEADER + body + cta + FOOTER });
      break;
    }
    case "intake_skipped": {
      const subject = "[CRM] Intake skipped on your case: " + caseClient + " (" + caseId + ")";
      const body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">⚠ Intake auto-skipped</h2>
        ${block}
        <p style="margin:0 0 12px;">Hi ${escapeHtml(ownerFirstName)} - the intake bot did not start a fresh intake for your case. The system detected a conflict (usually a duplicate phone with active session on another case).</p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Mode:</strong> <code style="font-size:12px;">${escapeHtml(event.skipMode)}</code></p>
        <p style="margin:0 0 12px;font-size:13px;"><strong>Reason:</strong> ${escapeHtml(event.skipReason)}</p>`;
      emails.push({ to: primaryRecipient, subject, html: HEADER + body + cta + FOOTER });
      break;
    }
    case "submission_complete": {
      const subject = "[CRM] Your case is submitted: " + caseClient + " - " + event.applicationNumber + " (" + caseId + ")";
      const dateLabel = event.submittedAt ? new Date(event.submittedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : "today";
      const body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">✅ Your case is submitted to IRCC</h2>
        ${block}
        <p style="margin:0 0 8px;"><strong>Application Number:</strong> <code style="font-size:13px;">${escapeHtml(event.applicationNumber)}</code></p>
        <p style="margin:0 0 12px;">Submitted ${dateLabel}.</p>`;
      emails.push({ to: primaryRecipient, subject, html: HEADER + body + cta + FOOTER });
      break;
    }
    case "reassigned": {
      const by = event.changedBy ? " by " + escapeHtml(event.changedBy) : "";
      const newOwnerObj = await resolveStaffEmail(args.companyId, event.newAssignee);
      const prevOwnerObj = await resolveStaffEmail(args.companyId, event.previousAssignee);
      // To the NEW assignee
      if (newOwnerObj?.email) {
        const firstName = newOwnerObj.name.split(" ")[0];
        const subject = "[CRM] A case is assigned to you: " + caseClient + " (" + caseId + ")";
        const body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">📌 New case assigned to you</h2>
          ${block}
          <p style="margin:0 0 12px;">Hi ${escapeHtml(firstName)} - ${escapeHtml(caseClient)} has been reassigned to you${by} (previously: ${escapeHtml(event.previousAssignee || "Unassigned")}). Please review and pick up where the last person left off.</p>`;
        emails.push({ to: newOwnerObj.email, subject, html: HEADER + body + cta + FOOTER });
      }
      // To the PREVIOUS assignee (if they had one and resolved to a real user)
      if (prevOwnerObj?.email && prevOwnerObj.email !== newOwnerObj?.email) {
        const firstName = prevOwnerObj.name.split(" ")[0];
        const subject = "[CRM] Case reassigned away from you: " + caseClient + " (" + caseId + ")";
        const body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">🔀 Case reassigned</h2>
          ${block}
          <p style="margin:0 0 12px;">Hi ${escapeHtml(firstName)} - ${escapeHtml(caseClient)} has been reassigned from you to <strong>${escapeHtml(event.newAssignee || "Unassigned")}</strong>${by}. No further action needed on your part.</p>`;
        emails.push({ to: prevOwnerObj.email, subject, html: HEADER + body + cta + FOOTER });
      }
      // If neither resolved, send to team inbox so the change is logged
      if (emails.length === 0) {
        const subject = "[CRM] Reassigned: " + caseClient + " (" + caseId + ")";
        const body = `<h2 style="margin:0 0 10px;font-size:16px;color:#0B2F5C;">🔀 Case reassigned</h2>
          ${block}
          <p style="margin:0 0 12px;">Assignment changed from <strong>${escapeHtml(event.previousAssignee || "Unassigned")}</strong> to <strong>${escapeHtml(event.newAssignee || "Unassigned")}</strong>${by}.</p>`;
        emails.push({ to: TEAM_INBOX, subject, html: HEADER + body + cta + FOOTER });
      }
      break;
    }
  }

  return emails;
}

export async function notifyCaseEvent(args: {
  companyId: string;
  caseId: string;
  event: CaseEvent;
}): Promise<{ sent: number; failures: number }> {
  let sent = 0;
  let failures = 0;
  try {
    const c = await getCase(args.companyId, args.caseId);
    if (!c) {
      console.warn("[case-notify] case not found:", args.caseId);
      return { sent: 0, failures: 0 };
    }
    const emails = await buildEmails({
      companyId: args.companyId,
      caseId: c.id,
      caseClient: c.client || "",
      caseFormType: c.formType || "",
      assignedTo: c.assignedTo || null,
      event: args.event,
    });
    for (const e of emails) {
      const result = await sendEmail({ to: e.to, subject: e.subject, html: e.html });
      if (result.success) {
        sent++;
        console.log("[case-notify] sent " + args.event.type + " for " + args.caseId + " to " + e.to);
      } else {
        failures++;
        console.warn("[case-notify] send failed for", args.event.type, args.caseId, e.to, result.error);
      }
    }
    return { sent, failures };
  } catch (e) {
    console.warn("[case-notify] threw:", args.event.type, args.caseId, (e as Error).message);
    return { sent, failures: failures + 1 };
  }
}