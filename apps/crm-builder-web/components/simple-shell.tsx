"use client" // v2.0.1;
import { NewtonAgent } from "@/components/newton-agent";
import { NewtonAiAgent } from "@/components/newton-ai-agent";
import { AiAssistantPanel } from "@/components/ai-assistant-panel";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import UnderReviewPanel from "@/components/under-review-panel";
import {
  Bell,
  CheckSquare,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageCircle,
  Users,
  UserPlus,
  ClipboardList,
  BookOpen,
  Calculator,
  Settings2,
  FolderOpen,
  Send,
  BarChart2
} from "lucide-react";
import { Header } from "@/components/header";
import { LoginView } from "@/components/login-view";
import { CaseItem, Role } from "@/lib/data";
import { apiFetch } from "@/lib/api-client";
import { Company } from "@/lib/models";
import { getChecklistForFormType, resolveApplicationChecklistKey } from "@/lib/application-checklists";
import { isQuestionnaireComplete, getQuestionPromptsForFormType } from "@/lib/application-question-flows";
import { canCreateCase, canManageUsers, canAssignCases, canChangeStatus, canStaffAccessCase, tabsForRole, type AppScreen } from "@/lib/rbac";
import { IMPORT_CASES_DATA } from "@/lib/import-data";
import { generateVisitorVisaScript } from "@/lib/ircc-script-generator";

type Screen = AppScreen;
type ClientScreen = "retainer" | "overview" | "documents" | "questions" | "results" | "chat";
type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  userType: "staff" | "client";
};

type MessageItem = {
  id: string;
  senderName: string;
  senderType: "staff" | "client" | "ai";
  text: string;
  createdAt: string;
};

type OutboundMessageItem = {
  id: string;
  channel: "email" | "whatsapp" | "sms" | "link" | "copy";
  status: "queued" | "opened_app" | "sent" | "failed";
  target?: string;
  message: string;
  createdByName: string;
  createdAt: string;
};

type DocumentItem = {
  id: string;
  clientId?: string;
  name: string;
  category?: "general" | "result";
  fileType?: string;
  version?: number;
  versionGroupId?: string;
  status: "pending" | "received";
  link: string;
  createdAt: string;
};

type TaskItem = {
  id: string;
  caseId: string;
  title: string;
  description: string;
  assignedTo: string;
  createdBy: "ai" | "admin";
  priority: "low" | "medium" | "high";
  status: "pending" | "completed";
  dueDate?: string;
  createdAt: string;
};

type NotificationItem = {
  id: string;
  type: "deadline" | "missing_doc" | "ai_alert";
  message: string;
  read: boolean;
  createdAt: string;
};
type LegacyResultItem = {
  id: string;
  entryType?: "result" | "submission";
  clientName: string;
  phone?: string;
  applicationNumber: string;
  resultDate: string;
  autoCategory: "new" | "old";
  outcome: "approved" | "refused" | "request_letter" | "other";
  notes?: string;
  fileName?: string;
  fileLink?: string;
  matchedCaseId?: string;
  matchedClientId?: string;
  informedToClient?: boolean;
  informedAt?: string;
  informedByName?: string;
  createdAt: string;
};
type CustomPortalSection = {
  id: string;
  title: string;
  body: string;
  fieldType?: "text" | "dropdown" | "date" | "file_upload" | "checkbox";
  options?: string[];
  visibleFor?: string[];
  sortOrder?: number;
  enabled?: boolean;
};
type CustomPortalSectionVersion = {
  id: string;
  createdAt: string;
  actorName?: string;
  sections: CustomPortalSection[];
};

const PORTAL_FIELD_TYPES: Array<CustomPortalSection["fieldType"]> = [
  "text",
  "dropdown",
  "date",
  "file_upload",
  "checkbox"
];
const PORTAL_VISIBILITY_OPTIONS = [
  "all",
  "pgwp",
  "visitor_visa",
  "trv_inside",
  "visitor_record",
  "work_permit",
  "study_permit",
  "study_permit_extension",
  "super_visa",
  "express_entry",
  "family_sponsorship",
  "citizenship_prcard",
  "us_b1b2",
  "uk_visitor",
  "refugee",
  "canadian_passport_doc",
  "generic"
];
type AuditItem = {
  id: string;
  action: string;
  actorName: string;
  actorUserId?: string;
  resourceType?: string;
  resourceId: string;
  createdAt: string;
  metadata?: Record<string, string>;
};
type TeamUserItem = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active?: boolean;
  mfaEnabled?: boolean;
  workspaceDriveLink?: string;
  workspaceDriveFolderId?: string;
};
type DocRequestItem = {
  id: string;
  title: string;
  details?: string;
  status: "open" | "fulfilled";
  requestedBy: string;
  requestedAt: string;
  fulfilledAt?: string;
  fulfilledBy?: string;
  documentId?: string;
};
type CaseDetailTab = "overview" | "profile" | "documents" | "tasks" | "communication" | "notes";
type CaseBoardView = "home" | "new_cases" | "assigned_cases" | "under_review_cases" | "urgent_cases" | "all_cases";

type PgwpDraft = {
  applicationType: "PGWP";
  requiredDocuments: Array<{ key: string; label: string; required: boolean; matchedDocumentName?: string; received: boolean }>;
  missingDocuments: string[];
  missingOptionalDocuments?: string[];
  riskFlags: string[];
  reviewChecklist: string[];
  finalSubmissionOrder?: string[];
  recommendedFileNames?: string[];
  representativeLetterDraft: string;
};

type IntakeCheckSummary = {
  questionnaireComplete: boolean;
  missingIntakeItems: Array<{ key: string; label: string }>;
  missingRequiredDocs: string[];
  riskFlags: string[];
  recommendedTaskTitles: string[];
};

type RequiredDocItem = {
  key: string;
  label: string;
  required?: boolean;
  keywords?: string[];
};

const APPLICATION_TYPES: string[] = [
  "Post-Graduation Work Permit (PGWP)",
  "Webform Submission",
  "PR Consultation",
  "Not for Processing",
  "Refugee Extension",
  "Visitor Visa (TRV - Outside Canada)",
  "TRV (Inside Canada)",
  "Visitor Record (Extension)",
  "Super Visa",
  "Study Permit (Outside Canada)",
  "Study Permit Extension (Inside Canada)",
  "College Change",
  "LMIA-Based Work Permit",
  "LMIA-Exempt Work Permit (C11, Francophone, etc.)",
  "Spousal Open Work Permit (SOWP)",
  "SOWP Extension",
  "Open Work Permit (General)",
  "Bridging Open Work Permit (BOWP)",
  "Vulnerable Open Work Permit",
  "Restoration (Work/Study/Visitor)",
  "Temporary Resident Permit (TRP)",
  "Verification of Status",
  "Travel Document (PRTD)",
  "Express Entry Profile Creation",
  "Express Entry PR Application",
  "BC PNP",
  "Alberta PNP (AAIP)",
  "Other Provinces PNP",
  "Spousal Sponsorship (Inside Canada)",
  "Spousal Sponsorship (Outside Canada)",
  "Parents & Grandparents Sponsorship",
  "Home Care Worker Pilot",
  "PR Pathways via LMIA / Work Experience",
  "Refugee Claim",
  "Humanitarian & Compassionate (H&C)",
  "Citizenship Application",
  "PR Card Renewal",
  "PR Card Replacement",
  "B1/B2 Visitor Visa (DS-160)",
  "UK Visitor Visa",
  "C11 Owner-Operator Work Permit",
  "Entrepreneur Programs (BC PNP / AAIP Rural)",
  "LMIA Application",
  "Job Bank / Employer Portal Setup",
  "Offer of Employment (LMIA-exempt)",
  "WES Evaluation",
  "ATIP Notes",
  "Passport Renewal",
  "E-Visa (Generic)",
  "Express Entry + PNP",
  "PNP + PR",
  "LMIA + Work Permit",
  "PR Sponsorship + Open Work Permit",
  "Study Permit + SOWP",
  "Other"
];

const NON_PROCESSING_APPLICATION_TYPES = new Set(["PR Consultation", "Not for Processing", "College Change"]);

const PROCESSING_ASSIGNEE_FALLBACK: string[] = [
  "Unassigned",
  "Rapneet Kaur",
  "Rajwinder Kaur",
  "Avneet Kaur",
  "Ramandeep Kaur",
  "Simi Das",
  "Manisha",
  "Sukhman",
  "Serbleen",
  "Team",
];

const PROCESSING_STATUS_OPTIONS: Array<{ value: "docs_pending" | "under_review" | "submitted" | "other"; label: string }> = [
  { value: "docs_pending", label: "Docs Pending" },
  { value: "under_review", label: "Under Review" },
  { value: "submitted", label: "Submitted" },
  { value: "other", label: "Other" }
];

function prettyStatus(value: string) {
  return String(value || "")
    .replace(/_/g, " ")
    .trim();
}

function formatCurrencyValue(value: number) {
  if (!Number.isFinite(value)) return "$0";
  return `$${Math.max(0, value).toFixed(0)}`;
}

function caseStatusChipClass(status: string) {
  const s = String(status || "lead").toLowerCase();
  if (s === "submitted") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (s === "under_review") return "border-amber-300 bg-amber-50 text-amber-800";
  if (s === "ready") return "border-blue-300 bg-blue-50 text-blue-800";
  if (s === "active") return "border-sky-300 bg-sky-50 text-sky-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function processingStatusChipClass(status: string) {
  const s = String(status || "docs_pending").toLowerCase();
  if (s === "submitted") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (s === "under_review") return "border-amber-300 bg-amber-50 text-amber-800";
  if (s === "other") return "border-violet-300 bg-violet-50 text-violet-800";
  return "border-orange-300 bg-orange-50 text-orange-800";
}

function aiStatusChipClass(status: string) {
  const s = String(status || "idle").toLowerCase();
  if (s === "completed") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (s === "drafting") return "border-blue-300 bg-blue-50 text-blue-800";
  if (s === "collecting_docs" || s === "waiting_client") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

type InternalExtractionIntake = {
  passportNumber?: string;
  passportIssueDate?: string;
  passportExpiryDate?: string;
  countryOfBirth?: string;
  citizenship?: string;
  currentCountryStatus?: string;
  studyPermitExpiryDate?: string;
  permitDetails?: string;
};

type DiagnosticsCheck = {
  id: string;
  title: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

type DiagnosticsReport = {
  generatedAt: string;
  summary: {
    overall: "pass" | "warn" | "fail";
    failCount: number;
    warnCount: number;
    passCount: number;
    total: number;
  };
  checks: DiagnosticsCheck[];
};

const tabs: { id: Screen; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
  { id: "cases", label: "Cases", icon: <ClipboardList size={16} /> },
  { id: "communications", label: "New Case", icon: <UserPlus size={16} /> },
  { id: "results", label: "Results", icon: <BarChart2 size={16} /> },
  { id: "submission", label: "Submission", icon: <Send size={16} /> },
  { id: "accounting", label: "Accounting", icon: <Calculator size={16} /> },
  { id: "settings", label: "Settings", icon: <Settings2 size={16} /> },
  { id: "tasks", label: "Tasks", icon: <CheckSquare size={16} /> },
  { id: "inbox", label: "Inbox", icon: <MessageCircle size={16} /> },
  { id: "team", label: "Team", icon: <Users size={16} /> },
  { id: "newton-ai", label: "Newton AI", icon: <span>🤖</span> }
];

function filterCasesByRole(allCases: CaseItem[], role: Role, userName?: string) {
  if (role === "Client") return [];
  // Processing staff only see their own assigned cases
  if (role === "Processing" && userName) {
    return allCases.filter((c) => canStaffAccessCase(role, userName, c.assignedTo));
  }
  // Marketing staff only see cases they created/are assigned to
  if (role === "Marketing" && userName) {
    return allCases.filter((c) => 
      String(c.assignedTo || "").toLowerCase() === userName.toLowerCase() ||
      String((c as any).createdByName || "").toLowerCase() === userName.toLowerCase()
    );
  }
  return allCases;
}

function questionnaireUrl(link: string | undefined, caseId: string) {
  const inviteToken =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("t") ||
        new URLSearchParams(window.location.search).get("token") ||
        new URLSearchParams(window.location.search).get("invite") ||
        new URLSearchParams(window.location.search).get("invite_token")
      : "";

  const clean = (link ?? "").trim();
  const base =
    !clean || clean.includes("newton.local")
      ? `/questionnaire/${caseId}`
      : clean;
  if (!inviteToken) return base;
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}t=${encodeURIComponent(inviteToken)}`;
}

function clientAccessLinkFromPayload(payload: any) {
  return String(payload?.portalInviteUrl || payload?.inviteUrl || "");
}

type SimpleShellProps = {
  expectedSlug?: string;
};

export function SimpleShell({ expectedSlug }: SimpleShellProps) {
  const fixedInteracRecipient =
    process.env.NEXT_PUBLIC_INTERAC_RECIPIENT || "payments@newtonimmigration.ca";
  const allowDataDelete = process.env.NEXT_PUBLIC_ALLOW_DATA_DELETE === "true";
  const normalizeInteracInstructions = (value?: string) =>
    (value || "Use your case number in message and upload proof.")
      .replace(/payments@newtonimmigration\.com/gi, fixedInteracRecipient)
      .replace(/payments@newtonimmigration\.ca/gi, fixedInteracRecipient);
  const STAFF_PHONES = ["16046535031"];
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [caseBoardView, setCaseBoardView] = useState<CaseBoardView>("home");
  const [clientScreen, setClientScreen] = useState<ClientScreen>("retainer");
  const [clientQStep, setClientQStep] = useState(0);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [viewRole, setViewRole] = useState<Role>("Admin");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [outboundMessages, setOutboundMessages] = useState<OutboundMessageItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [resultUploadFile, setResultUploadFile] = useState<File | null>(null);
  const [resultUploadName, setResultUploadName] = useState("");
  const [resultUploadStatus, setResultUploadStatus] = useState("");
  const [resultSearch, setResultSearch] = useState("");
  const [resultApplicationNumber, setResultApplicationNumber] = useState("");
  const [resultCaseNumberInput, setResultCaseNumberInput] = useState("");
  const [resultOutcome, setResultOutcome] = useState<"" | "approved" | "refused" | "request_letter">("");
  const [resultDecisionDate, setResultDecisionDate] = useState("");
  const [resultRemarks, setResultRemarks] = useState("");
  const [resultDecisionStatus, setResultDecisionStatus] = useState("");
  const [resultShareStatus, setResultShareStatus] = useState("");
  const [resultSendEmail, setResultSendEmail] = useState("");
  const [resultSendPhone, setResultSendPhone] = useState("");
  const [legacyResultClientName, setLegacyResultClientName] = useState("");
  const [legacyResultPhone, setLegacyResultPhone] = useState("");
  const [legacyResultDate, setLegacyResultDate] = useState(new Date().toISOString().slice(0, 10));
  const [legacyResultOutcome, setLegacyResultOutcome] = useState<"approved" | "refused" | "request_letter" | "other">("other");
  const [legacyResultNotes, setLegacyResultNotes] = useState("");
  const [legacyResultFile, setLegacyResultFile] = useState<File | null>(null);
  const [legacyResultStatus, setLegacyResultStatus] = useState("");
  const [legacyResults, setLegacyResults] = useState<LegacyResultItem[]>([]);
  const [submissionSearch, setSubmissionSearch] = useState("");
  const [submissionCaseId, setSubmissionCaseId] = useState("");
  const [submissionApplicationNumber, setSubmissionApplicationNumber] = useState("");
  const [submissionClientName, setSubmissionClientName] = useState("");
  const [submissionPhone, setSubmissionPhone] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState("");
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitModalCaseId, setSubmitModalCaseId] = useState("");
  const [submitModalAppNo, setSubmitModalAppNo] = useState("");
  const [submitModalPhone, setSubmitModalPhone] = useState("");
  const [submitModalSaving, setSubmitModalSaving] = useState(false);
  const [submitModalStatus, setSubmitModalStatus] = useState("");
  const [submissionUploadType, setSubmissionUploadType] = useState<"submission_letter" | "wp_extension_letter">(
    "submission_letter"
  );
  const [submissionUploadFile, setSubmissionUploadFile] = useState<File | null>(null);
  const [submissionUploadStatus, setSubmissionUploadStatus] = useState("");
  const [docRequests, setDocRequests] = useState<DocRequestItem[]>([]);
  const [clientIntakeDone, setClientIntakeDone] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [auditStatus, setAuditStatus] = useState("");
  const [teamUsers, setTeamUsers] = useState<TeamUserItem[]>([]);
  const [inboxMessages, setInboxMessages] = useState<Array<{id:string;phone:string;message:string;direction:string;matched_case_id:string|null;matched_case_name:string|null;is_read:boolean;created_at:string}>>([]);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [inboxShowArchived, setInboxShowArchived] = useState(false);
  const [newtonBriefing, setNewtonBriefing] = useState<{loaded:boolean; data:any}>({loaded:false, data:null});
  const [inboxSearch, setInboxSearch] = useState<Record<string,string>>({});
  const [inboxGlobalSearch, setInboxGlobalSearch] = useState("");
  const [inboxAttachment, setInboxAttachment] = useState<Record<string,{name:string;type:string;data:string}|null>>({});
  const [aiResult, setAiResult] = useState<{caseId:string;text:string;action:string}|null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [inboxAiSuggestion, setInboxAiSuggestion] = useState<Record<string,string>>({});
  const [inboxAiLoading, setInboxAiLoading] = useState<Record<string,boolean>>({});
  const [inboxReply, setInboxReply] = useState<Record<string,string>>({});
  const [inboxStatus, setInboxStatus] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [caseDetailTab, setCaseDetailTab] = useState<CaseDetailTab>("overview");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<"low" | "medium" | "high">("medium");
  const [newTaskAssignedTo, setNewTaskAssignedTo] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [teamTaskCaseId, setTeamTaskCaseId] = useState("");
  const [teamTaskTitle, setTeamTaskTitle] = useState("");
  const [teamTaskDescription, setTeamTaskDescription] = useState("");
  const [teamTaskPriority, setTeamTaskPriority] = useState<"low" | "medium" | "high">("medium");
  const [teamTaskAssignedTo, setTeamTaskAssignedTo] = useState("");
  const [teamTaskDueDate, setTeamTaskDueDate] = useState("");
  const [taskActionStatus, setTaskActionStatus] = useState("");
  const [chatText, setChatText] = useState("");
  const [chatStatus, setChatStatus] = useState("");
  const [retainerName, setRetainerName] = useState("");
  const [retainerSignatureType, setRetainerSignatureType] = useState<"initials" | "signature" | "typed">("typed");
  const [retainerSignatureValue, setRetainerSignatureValue] = useState("");
  const [retainerStatus, setRetainerStatus] = useState("");
  const [commClientName, setCommClientName] = useState("");
  const [commFormType, setCommFormType] = useState("PGWP");
  const [commFormTypeOther, setCommFormTypeOther] = useState("");
  const [commPhone, setCommPhone] = useState("");
  const [commEmail, setCommEmail] = useState("");
  const [commTotalCharges, setCommTotalCharges] = useState("");
  const [commIrccFees, setCommIrccFees] = useState("");
  const [commIrccFeePayer, setCommIrccFeePayer] = useState<"sir_card" | "client_card">("client_card");
  const [commAdditionalApplicants, setCommAdditionalApplicants] = useState<{name: string; phone: string; formType: string}[]>([]);
  const [commApplicantDraftName, setCommApplicantDraftName] = useState("");
  const [commApplicantDraftPhone, setCommApplicantDraftPhone] = useState("");
  const [commApplicantDraftType, setCommApplicantDraftType] = useState("");
  const [commFamilyTotalCharges, setCommFamilyTotalCharges] = useState("");
  const [commAdditionalNotes, setCommAdditionalNotes] = useState("");
  const [commCreateStatus, setCommCreateStatus] = useState("");
  const [commAssignedTo, setCommAssignedTo] = useState("Unassigned");
  const [commUrgent, setCommUrgent] = useState(false);
  const [commUrgentDays, setCommUrgentDays] = useState("5");
  const [commPermitExpiryDate, setCommPermitExpiryDate] = useState("");
  const [commSearch, setCommSearch] = useState("");
  const [commPaymentFilter, setCommPaymentFilter] = useState<"all" | "pending" | "paid">("all");
  const [commPaymentStatus, setCommPaymentStatus] = useState("");
  const [commPruneCaseIds, setCommPruneCaseIds] = useState("CASE-1006, CASE-1007");
  const [commPruneStatus, setCommPruneStatus] = useState("");
  const [commAutoSendInvite, setCommAutoSendInvite] = useState(true);
  const [caseActionStatus, setCaseActionStatus] = useState("");
  const [showURPanel, setShowURPanel] = useState<string|null>(null);
  const [inboxThread, setInboxThread] = useState<string|null>(null);
  const [caseNotes, setCaseNotes] = useState<Record<string, Array<{id:string;text:string;added_by:string;created_at:string}>>>({});
  const [diagnosticsStatus, setDiagnosticsStatus] = useState("");
  const [diagnosticsReport, setDiagnosticsReport] = useState<DiagnosticsReport | null>(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [caseStatusFilter, setCaseStatusFilter] = useState<"all" | "docs_pending" | "under_review" | "submitted" | "other">("all");
  const [caseAssignedFilter, setCaseAssignedFilter] = useState<string>("all");
  const [accountingSearch, setAccountingSearch] = useState("");
  const [accountingPaymentFilter, setAccountingPaymentFilter] = useState<"all" | "pending" | "paid">("all");
  const [accountingAmount, setAccountingAmount] = useState<Record<string, string>>({});
  const [accountingStatus, setAccountingStatus] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [importRunning, setImportRunning] = useState(false);
  const [accountingPage, setAccountingPage] = useState(0);
  const [taskViewFilter, setTaskViewFilter] = useState<"all"|"pending"|"completed">("all");
  const [expandedAcctDates, setExpandedAcctDates] = useState<Set<string>>(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return new Set([todayStr]);
  });
  const [brandAppName, setBrandAppName] = useState("");
  const [brandLogoText, setBrandLogoText] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [brandDriveRootLink, setBrandDriveRootLink] = useState("");
  const [brandCustomSections, setBrandCustomSections] = useState<CustomPortalSection[]>([]);
  const [brandCustomSectionHistory, setBrandCustomSectionHistory] = useState<CustomPortalSectionVersion[]>([]);
  const [newCustomSectionTitle, setNewCustomSectionTitle] = useState("");
  const [newCustomSectionBody, setNewCustomSectionBody] = useState("");
  const [newCustomSectionFieldType, setNewCustomSectionFieldType] = useState<CustomPortalSection["fieldType"]>("text");
  const [newCustomSectionOptions, setNewCustomSectionOptions] = useState("");
  const [newCustomSectionVisibleFor, setNewCustomSectionVisibleFor] = useState("all");
  const [brandStatus, setBrandStatus] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamEmail, setTeamEmail] = useState("");
  const [teamRole, setTeamRole] = useState<Role>("Processing");
  const [teamPassword, setTeamPassword] = useState("");
  const [teamDriveLink, setTeamDriveLink] = useState("");
  const [teamStatus, setTeamStatus] = useState("");
  const [teamPasswordDrafts, setTeamPasswordDrafts] = useState<Record<string, string>>({});
  // Staff profile notes
  const [staffProfileUserId, setStaffProfileUserId] = useState<string | null>(null);
  const [staffProfileNotes, setStaffProfileNotes] = useState<Array<{id:string;authorId:string;authorName:string;text:string;createdAt:string;pinned?:boolean}>>([]);
  const [staffNoteDrafts, setStaffNoteDrafts] = useState<Record<string, string>>({});
  const [staffNoteStatus, setStaffNoteStatus] = useState("");
  const [staffNoteCounts, setStaffNoteCounts] = useState<Record<string, number>>({});
  const [setupFormType, setSetupFormType] = useState("");
  const [setupRetainerAmount, setSetupRetainerAmount] = useState("");
  const [setupInteracRecipient, setSetupInteracRecipient] = useState("");
  const [setupInteracInstructions, setSetupInteracInstructions] = useState("");
  const [retainerConfirm, setRetainerConfirm] = useState(false);
  const [setupStatus, setSetupStatus] = useState("");
  const [paymentEmailTemplate, setPaymentEmailTemplate] = useState("");
  const [paymentEmailStatus, setPaymentEmailStatus] = useState("");
  const [clientMessageTemplate, setClientMessageTemplate] = useState("");
  const [clientMessageStatus, setClientMessageStatus] = useState("");
  const [aiDraft, setAiDraft] = useState<PgwpDraft | null>(null);
  const [aiDraftStatus, setAiDraftStatus] = useState("");
  const [intakeCheckStatus, setIntakeCheckStatus] = useState("");
  const [intakeCheckSummary, setIntakeCheckSummary] = useState<IntakeCheckSummary | null>(null);
  const [readyPackageStatus, setReadyPackageStatus] = useState("");
  const [readyPackagePath, setReadyPackagePath] = useState("");
  const [immRunStatus, setImmRunStatus] = useState("");
  const [clientUploadFile, setClientUploadFile] = useState<File | null>(null);
  const [clientUploadStatus, setClientUploadStatus] = useState("");
  const isUrgentCase = (c: CaseItem) => Boolean((c as CaseItem & { isUrgent?: boolean }).isUrgent);
  const [requestedUploadFiles, setRequestedUploadFiles] = useState<Record<string, File | null>>({});
  const [requestedUploadStatus, setRequestedUploadStatus] = useState<Record<string, string>>({});
  const [staffDocRequestTitle, setStaffDocRequestTitle] = useState("");
  const [staffDocRequestDetails, setStaffDocRequestDetails] = useState("");
  const [staffDocRequestStatus, setStaffDocRequestStatus] = useState("");
  const [clientProfileOpen, setClientProfileOpen] = useState(false);
  const [clientWorkOpen, setClientWorkOpen] = useState(false);
  const [interacCopyStatus, setInteracCopyStatus] = useState("");
  const [checklistFiles, setChecklistFiles] = useState<Record<string, File | null>>({});
  const [checklistStatus, setChecklistStatus] = useState<Record<string, string>>({});
  const [internalIntake, setInternalIntake] = useState<InternalExtractionIntake>({});
  const [internalIntakeStatus, setInternalIntakeStatus] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [inviteShareStatus, setInviteShareStatus] = useState("");
  const [clientUpdateText, setClientUpdateText] = useState("");
  const [clientUpdateStatus, setClientUpdateStatus] = useState("");
  const [clientUpdateChannel, setClientUpdateChannel] = useState<"whatsapp" | "email" | "sms" | "copy">("whatsapp");
  const [outboundFilterChannel, setOutboundFilterChannel] = useState<"all" | "email" | "whatsapp" | "sms" | "link" | "copy">("all");
  const [outboundFilterStatus, setOutboundFilterStatus] = useState<"all" | "queued" | "opened_app" | "sent" | "failed">("all");
  const [outboundSearch, setOutboundSearch] = useState("");
  const [paymentLinkStatus, setPaymentLinkStatus] = useState("");
  const [leadSheetCsvUrl, setLeadSheetCsvUrl] = useState(
    process.env.NEXT_PUBLIC_LEADS_SHEET_CSV_URL || ""
  );
  const [leadSyncStatus, setLeadSyncStatus] = useState("");
  const [clientPortalAccess, setClientPortalAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isLocalRuntime, setIsLocalRuntime] = useState(true);
  const [autofillStatus, setAutofillStatus] = useState("");
  const [autofillHint, setAutofillHint] = useState("");
  const [autofillRunning, setAutofillRunning] = useState(false);
  const [autofillResult, setAutofillResult] = useState<{ fieldsAdded: number; source: string } | null>(null);
  const [sheetSyncStatus, setSheetSyncStatus] = useState("");
  const [sheetSyncRunning, setSheetSyncRunning] = useState(false);

  async function syncToSheets() {
    if (!selectedCase) return;
    setSheetSyncRunning(true);
    setSheetSyncStatus("Syncing to Google Sheets…");
    const res = await apiFetch(`/cases/${selectedCase.id}/sync-sheet`, { method: "POST" });
    const payload = await res.json().catch(() => ({}));
    setSheetSyncRunning(false);
    if (!res.ok) {
      setSheetSyncStatus(String(payload.error || "Sheet sync failed — check Drive root is configured."));
      return;
    }
    const tracker = payload.tracker?.status || "";
    const intake = payload.intakeSheet?.status || "";
    setSheetSyncStatus(`✓ Tracker: ${tracker} · Intake sheet: ${intake}`);
  }

  async function runAutofill() {
    if (!selectedCase) return;
    setAutofillRunning(true);
    setAutofillStatus("Running AI autofill…");
    setAutofillResult(null);
    const res = await apiFetch(`/cases/${selectedCase.id}/autofill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hint: autofillHint.trim() })
    });
    const payload = await res.json().catch(() => ({}));
    setAutofillRunning(false);
    if (!res.ok) {
      setAutofillStatus(String(payload.error || "Autofill failed — check AI provider env vars."));
      return;
    }
    const filled = payload.filled as Record<string, string>;
    const fieldsAdded = Number(payload.fieldsAdded || 0);
    const source = String(payload.source || "rules");
    if (fieldsAdded === 0) {
      setAutofillStatus("All fields already filled — nothing to add.");
      setAutofillResult({ fieldsAdded: 0, source });
      return;
    }
    // Patch the case intake via the existing intake PATCH endpoint
    const intakeRes = await apiFetch(`/cases/${selectedCase.id}/intake`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filled)
    });
    const intakePayload = await intakeRes.json().catch(() => ({}));
    if (!intakeRes.ok) {
      setAutofillStatus(String(intakePayload.error || "Autofill suggested fields but could not save them."));
      return;
    }
    // Refresh the case
    setCases((prev) => prev.map((c) => c.id === selectedCase.id ? { ...c, pgwpIntake: { ...(c.pgwpIntake || {}), ...filled } } : c));
    setAutofillResult({ fieldsAdded, source });
    setAutofillStatus(`✓ ${fieldsAdded} field${fieldsAdded !== 1 ? "s" : ""} filled by AI (${source}). Questionnaire updated.`);
    setAutofillHint("");
  }

  async function loadSession() {
    setLoading(true);
    setError("");
    try {
      const meRes = await apiFetch("/auth/me", { cache: "no-store" });
      if (!meRes.ok) {
        setSessionUser(null);
        setCompany(null);
        setCases([]);
        return;
      }
      const me = await meRes.json();
      const user = me.user as SessionUser;
      const comp = me.company as Company;
      setSessionUser(user);
      setCompany(comp);
      setViewRole(user.role);
      setBrandAppName(comp?.branding?.appName || "");
      setBrandLogoText(comp?.branding?.logoText || "");
      setBrandLogoUrl(comp?.branding?.logoUrl || "");
      setBrandDriveRootLink(comp?.branding?.driveRootLink || "https://drive.google.com/drive/folders/1FAjuG-Uj4fhp9zWfVsiHoX8WbVPT_r7j?usp=drive_link");
      setBrandCustomSections(
        Array.isArray(comp?.branding?.customPortalSections)
          ? (comp.branding.customPortalSections as CustomPortalSection[])
          : []
      );
      setBrandCustomSectionHistory(
        Array.isArray(comp?.branding?.customPortalSectionHistory)
          ? (comp.branding.customPortalSectionHistory as CustomPortalSectionVersion[])
          : []
      );

      const caseRes = await apiFetch("/cases", { cache: "no-store" });
      if (!caseRes.ok) {
        setError("Could not load cases");
        return;
      }
      const casePayload = await caseRes.json();
      const loadedCases = casePayload.cases as CaseItem[];
      setCases(loadedCases);
      if (loadedCases.length > 0) {
        setSelectedCaseId((prev) =>
          prev && loadedCases.some((c) => c.id === prev) ? prev : ""
        );
      }

      const [taskRes, noticeRes] = await Promise.all([
        apiFetch("/tasks", { cache: "no-store" }),
        apiFetch("/notifications", { cache: "no-store" })
      ]);
      if (taskRes.ok) {
        const t = await taskRes.json();
        setTasks((t.tasks || []) as TaskItem[]);
      }
      if (noticeRes.ok) {
        const n = await noticeRes.json();
        setNotifications((n.notifications || []) as NotificationItem[]);
      }

      if (user.userType === "staff") {
        const legacyRes = await apiFetch("/results/legacy", { cache: "no-store" });
        if (legacyRes.ok) {
          const legacyPayload = await legacyRes.json().catch(() => ({}));
          setLegacyResults((legacyPayload.items || []) as LegacyResultItem[]);
        }
        const usersRes = await apiFetch("/users", { cache: "no-store" });
        if (usersRes.ok) {
          const usersPayload = await usersRes.json().catch(() => ({}));
          setTeamUsers((usersPayload.users || []) as TeamUserItem[]);
        }
        if (user.role === "Admin") {
          const auditRes = await apiFetch("/audit?limit=100", { cache: "no-store" });
          if (auditRes.ok) {
            const auditPayload = await auditRes.json().catch(() => ({}));
            setAuditLogs((auditPayload.logs || []) as AuditItem[]);
          } else {
            setAuditStatus("Could not load audit logs.");
          }
        }
      }
    } catch {
      setError("Could not load workspace");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    if (!sessionUser || sessionUser.userType !== "staff") return;
    let cancelled = false;
    const tick = async () => {
      const res = await apiFetch("/notifications", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const payload = await res.json().catch(() => ({}));
      if (cancelled) return;
      setNotifications((payload.notifications || []) as NotificationItem[]);
    };
    const timer = setInterval(() => {
      void tick();
    }, 20000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionUser?.id, sessionUser?.userType]);

  useEffect(() => {
    if (!sessionUser || sessionUser.userType !== "staff") return;
    let cancelled = false;
    const tick = async () => {
      const res = await apiFetch("/results/legacy", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const payload = await res.json().catch(() => ({}));
      if (cancelled) return;
      setLegacyResults((payload.items || []) as LegacyResultItem[]);
    };
    const timer = setInterval(() => {
      void tick();
    }, 15000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionUser?.id, sessionUser?.userType]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token =
      new URLSearchParams(window.location.search).get("invite") ||
      new URLSearchParams(window.location.search).get("invite_token") ||
      new URLSearchParams(window.location.search).get("token");
    if (!token) return;
    window.location.replace(`/invite/${encodeURIComponent(token)}`);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setClientPortalAccess(params.get("client") === "1");
  }, []);

  useEffect(() => {
    if (!selectedCaseId) return;
    apiFetch(`/cases/${selectedCaseId}/notes`).then(r => r?.json()).then(d => {
      if (d?.notes) setCaseNotes(prev => ({ ...prev, [selectedCaseId]: d.notes }));
    }).catch(() => {});
  }, [selectedCaseId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname.toLowerCase();
    const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
    setIsLocalRuntime(localHosts.has(host));
  }, []);

  const visibleCases = useMemo(() => {
    const byRole = filterCasesByRole(cases, viewRole, sessionUser?.name);
    const q = caseSearch.trim().toLowerCase();
    // Exclude submitted cases from main view — they live in Submission tab
    const isProcessingCase = (c: CaseItem) => !NON_PROCESSING_APPLICATION_TYPES.has(c.formType);
    const byStatus =
      caseStatusFilter === "all"
        ? byRole.filter(c => c.processingStatus !== "submitted" && isProcessingCase(c))
        : caseStatusFilter === "submitted"
          ? byRole.filter(c => c.processingStatus === "submitted" && isProcessingCase(c))
          : byRole.filter((c) => (c.processingStatus || "docs_pending") === caseStatusFilter && isProcessingCase(c));
    if (!q) return byStatus;
    return byStatus.filter((c) => {
      const candidate = `${c.id} ${c.client} ${c.formType} ${c.assignedTo || ""} ${c.processingStatus || ""} ${c.processingStatusOther || ""}`.toLowerCase();
      return candidate.includes(q);
    });
  }, [cases, viewRole, caseSearch, caseStatusFilter]);
  const roleScopedCases = useMemo(() => filterCasesByRole(cases, viewRole, sessionUser?.name), [cases, viewRole, sessionUser?.name]);
  const caseSearchSuggestions = useMemo(() => {
    const q = caseSearch.trim().toLowerCase();
    if (!q) return [] as CaseItem[];
    const scored = roleScopedCases
      .filter((c) => {
        const candidate = `${c.id} ${c.client} ${c.formType} ${c.assignedTo || ""}`.toLowerCase();
        return candidate.includes(q);
      })
      .sort((a, b) => {
        const aNew = (a.caseStatus || "lead") === "lead" || (a.caseStatus || "lead") === "active";
        const bNew = (b.caseStatus || "lead") === "lead" || (b.caseStatus || "lead") === "active";
        if (aNew !== bNew) return aNew ? -1 : 1;
        const aTs = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTs = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTs - aTs;
      });
    return scored.slice(0, 50);
  }, [roleScopedCases, caseSearch]);
  const selectedCase = roleScopedCases.find((c) => c.id === selectedCaseId) ?? null;
  const clientRelatedCases = useMemo(() => {
    if (!selectedCase) return [] as CaseItem[];
    const scoped = cases.filter((c) => c.companyId === selectedCase.companyId);
    const byClientId = selectedCase.clientId
      ? scoped.filter((c) => c.clientId && c.clientId === selectedCase.clientId)
      : [];
    const byContact = scoped.filter((c) => {
      const sameEmail =
        String(selectedCase.leadEmail || "").trim().length > 0 &&
        String(c.leadEmail || "").trim().toLowerCase() === String(selectedCase.leadEmail || "").trim().toLowerCase();
      const samePhone =
        String(selectedCase.leadPhone || "").trim().length > 0 &&
        String(c.leadPhone || "").replace(/\s+/g, "") === String(selectedCase.leadPhone || "").replace(/\s+/g, "");
      const sameName =
        String(c.client || "").trim().toLowerCase() === String(selectedCase.client || "").trim().toLowerCase();
      return sameEmail || samePhone || sameName;
    });
    const dedup = new Map<string, CaseItem>();
    [...byClientId, ...byContact].forEach((c) => dedup.set(c.id, c));
    if (!dedup.has(selectedCase.id)) {
      dedup.set(selectedCase.id, selectedCase);
    }
    return Array.from(dedup.values()).sort((a, b) => {
      const aTs = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTs = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTs - aTs;
    });
  }, [cases, selectedCase]);
  const newCasesList = useMemo(
    () =>
      visibleCases.filter((c) => {
        const status = c.caseStatus || "lead";
        const isAssigned = String(c.assignedTo || "Unassigned") !== "Unassigned";
        return (status === "active" || status === "lead") && !isAssigned;
      }),
    [visibleCases]
  );
  const assignedCasesList = useMemo(
    () =>
      visibleCases.filter((c) => {
        const status = c.caseStatus || "lead";
        const isAssigned = String(c.assignedTo || "Unassigned") !== "Unassigned";
        return (status === "active" || status === "lead") && isAssigned;
      }),
    [visibleCases]
  );
  const underReviewCasesList = useMemo(
    () =>
      visibleCases.filter(
        (c) =>
          (c.caseStatus || "lead") === "under_review" ||
          c.processingStatus === "under_review" ||
          c.stage === "Under Review" ||
          (c.aiStatus || "idle") === "drafting"
      ),
    [visibleCases]
  );
  const activeCaseBoardList = useMemo(() => {
    if (caseBoardView === "new_cases") return newCasesList;
    if (caseBoardView === "assigned_cases") return assignedCasesList;
    if (caseBoardView === "under_review_cases") return underReviewCasesList;
    if (caseBoardView === "urgent_cases") return visibleCases.filter((c) => isUrgentCase(c));
    return visibleCases;
  }, [caseBoardView, newCasesList, assignedCasesList, underReviewCasesList, visibleCases]);
  const activeCaseBoardListFiltered = useMemo(() => {
    if (caseAssignedFilter === "all") return activeCaseBoardList;
    return activeCaseBoardList.filter((c) => String(c.assignedTo || "Unassigned") === caseAssignedFilter);
  }, [activeCaseBoardList, caseAssignedFilter]);
  const caseTasks = useMemo(
    () => (selectedCase ? tasks.filter((t) => t.caseId === selectedCase.id) : []),
    [tasks, selectedCase?.id]
  );
  const resultDocuments = useMemo(
    () =>
      documents
        .filter((d) => {
          if ((d.category || "general") === "result") return true;
          const name = String(d.name || "").toLowerCase();
          return (
            name.includes("result") ||
            name.includes("approval") ||
            name.includes("refusal") ||
            name.includes("decision") ||
            name.includes("request letter")
          );
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [documents]
  );
  const resultCaseOptions = useMemo(() => {
    const query = resultSearch.trim().toLowerCase();
    return visibleCases
      .filter((c) => {
        if (!query) return true;
        return `${c.id} ${c.client} ${c.formType}`.toLowerCase().includes(query);
      })
      .sort((a, b) => {
        const aTs = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTs = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTs - aTs;
      });
  }, [visibleCases, resultSearch]);
  const resultLinkedCase = useMemo(() => {
    const appNo = resultApplicationNumber.trim().toLowerCase();
    const caseNo = resultCaseNumberInput.trim().toLowerCase();
    if (!appNo && !caseNo) return null;
    const matches = visibleCases.filter((c) => {
      const byApp =
        appNo &&
        String(c.applicationNumber || "")
          .trim()
          .toLowerCase() === appNo &&
        ((c.processingStatus || "docs_pending") === "submitted" ||
          c.stage === "Submitted" ||
          c.stage === "Decision" ||
          Boolean(c.submittedAt));
      const byCase = caseNo ? String(c.id || "").trim().toLowerCase() === caseNo : false;
      return byApp || byCase;
    });
    if (matches.length === 1) return matches[0];
    return null;
  }, [visibleCases, resultApplicationNumber, resultCaseNumberInput]);
  const resultAutoCategory = useMemo(() => {
    if (!resultApplicationNumber.trim() && !resultCaseNumberInput.trim()) return "";
    return resultLinkedCase ? "new" : "old";
  }, [resultLinkedCase, resultApplicationNumber, resultCaseNumberInput]);
  const toLocalDateKey = (value?: string) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const todayIsoDate = useMemo(() => toLocalDateKey(new Date().toISOString()), []);
  const todaysResults = useMemo(
    () =>
      legacyResults
        .filter((r) => (r.entryType || "result") === "result" && !r.informedToClient)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 200),
    [legacyResults]
  );
  // Unlinked scanner uploads — shown at top for manual linking
  const unlinkedScannerUploads = useMemo(() =>
    legacyResults
      .filter((r) => r.autoCategory === "old" && !r.informedToClient &&
        // Only show if has a real client name
        String(r.clientName || "").trim().length > 2 &&
        String(r.clientName || "").trim().toLowerCase() !== "client" &&
        String(r.clientName || "").trim().toLowerCase() !== "legacy client"
      )
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 30),
    [legacyResults]
  );

  // Pending queue — matched results not yet informed (exclude unlinked ones to avoid duplicates)
  const pendingResultsQueue = useMemo(() => {
    const unlinkedIdSet = new Set(unlinkedScannerUploads.map(r => r.id));
    return todaysResults
      .filter(r => !unlinkedIdSet.has(r.id))
      .slice(0, 25);
  }, [todaysResults, unlinkedScannerUploads]);
  const normalizeAppNumber = (value: string) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const matchingLegacyCandidates = useMemo(() => {
    const key = normalizeAppNumber(resultApplicationNumber);
    if (!key) return [];
    return legacyResults
      .filter((r) => {
        if ((r.entryType || "result") !== "result") return false;
        const appKey = normalizeAppNumber(String(r.applicationNumber || ""));
        return appKey.includes(key) || key.includes(appKey);
      })
      .slice(0, 6);
  }, [legacyResults, resultApplicationNumber]);
  const selectedLegacyByAppNo = useMemo(() => {
    const key = normalizeAppNumber(resultApplicationNumber);
    if (!key) return null;
    const exact = legacyResults.find(
      (r) =>
        (r.entryType || "result") === "result" &&
        normalizeAppNumber(String(r.applicationNumber || "")) === key
    );
    if (exact) return exact;
    const prefix = legacyResults.find((r) =>
      (r.entryType || "result") === "result" &&
      normalizeAppNumber(String(r.applicationNumber || "")).startsWith(key)
    );
    if (prefix) return prefix;
    return (
      legacyResults.find(
        (r) =>
          (r.entryType || "result") === "result" &&
          normalizeAppNumber(String(r.applicationNumber || "")).includes(key)
      ) || null
    );
  }, [legacyResults, resultApplicationNumber]);
  const submissionLegacyByAppNo = useMemo(() => {
    const key = normalizeAppNumber(submissionApplicationNumber);
    if (!key) return null;
    const exact = legacyResults.find(
      (r) => normalizeAppNumber(String(r.applicationNumber || "")) === key
    );
    if (exact) return exact;
    const prefix = legacyResults.find((r) =>
      normalizeAppNumber(String(r.applicationNumber || "")).includes(key)
    );
    if (prefix) return prefix;
    return (
      legacyResults.find(
        (r) => key.includes(normalizeAppNumber(String(r.applicationNumber || "")))
      ) || null
    );
  }, [legacyResults, submissionApplicationNumber]);
  const resultSuggestedContact = useMemo(() => {
    if (resultLinkedCase) {
      return {
        source: "case" as const,
        clientName: String(resultLinkedCase.client || "").trim(),
        phone: String(resultLinkedCase.leadPhone || "").trim()
      };
    }
    if (selectedLegacyByAppNo) {
      return {
        source: "history" as const,
        clientName: String(selectedLegacyByAppNo.clientName || "").trim(),
        phone: String(selectedLegacyByAppNo.phone || "").trim()
      };
    }
    return null;
  }, [resultLinkedCase, selectedLegacyByAppNo]);
  const submissionCaseOptions = useMemo(() => {
    const query = submissionSearch.trim().toLowerCase();
    return visibleCases
      .filter((c) => (c.processingStatus || "docs_pending") !== "submitted")
      .filter((c) => {
        if (!query) return true;
        return `${c.id} ${c.client} ${c.formType} ${c.applicationNumber || ""}`.toLowerCase().includes(query);
      })
      .sort((a, b) => {
        const aTs = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTs = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTs - aTs;
      });
  }, [visibleCases, submissionSearch]);
  const selectedSubmissionCase = useMemo(
    () => submissionCaseOptions.find((c) => c.id === submissionCaseId) ?? null,
    [submissionCaseOptions, submissionCaseId]
  );
  const submissionAutoMatchedCase = useMemo(() => {
    const key = normalizeAppNumber(submissionApplicationNumber);
    if (!key) return null;
    const matches = roleScopedCases.filter(
      (c) => normalizeAppNumber(String(c.applicationNumber || "")) === key
    );
    return matches.length === 1 ? matches[0] : null;
  }, [roleScopedCases, submissionApplicationNumber]);
  const todaysSubmissions = useMemo(
    () =>
      legacyResults
        .filter((r) => (r.entryType || "result") === "submission" && !r.informedToClient)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 200),
    [legacyResults]
  );
  const pendingSubmissionsQueue = useMemo(() => todaysSubmissions.slice(0, 25), [todaysSubmissions]);

  const recentResults = useMemo(
    () =>
      legacyResults
        .filter((r) => (r.entryType || "result") === "result")
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 25),
    [legacyResults]
  );

  const recentSubmissions = useMemo(
    () =>
      legacyResults
        .filter((r) => (r.entryType || "result") === "submission")
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 25),
    [legacyResults]
  );

  const submissionSuggestedContact = useMemo(() => {
    const sourceCase = selectedSubmissionCase || submissionAutoMatchedCase;
    if (sourceCase) {
      return {
        source: "case" as const,
        clientName: String(sourceCase.client || "").trim(),
        phone: String(sourceCase.leadPhone || "").trim()
      };
    }
    if (submissionLegacyByAppNo) {
      return {
        source: "history" as const,
        clientName: String(submissionLegacyByAppNo.clientName || "").trim(),
        phone: String(submissionLegacyByAppNo.phone || "").trim()
      };
    }
    return null;
  }, [selectedSubmissionCase, submissionAutoMatchedCase, submissionLegacyByAppNo]);

  const communicationSearchList = useMemo(() => {
    const query = commSearch.trim().toLowerCase();
    const byPayment =
      commPaymentFilter === "all"
        ? visibleCases
        : visibleCases.filter((c) => {
            const total = Number(c.servicePackage?.retainerAmount || 0);
            const paid = Number(c.amountPaid || 0);
            const status = paid >= total && total > 0 ? "paid" : c.paymentStatus || "pending";
            return status === commPaymentFilter;
          });
    if (!query) return byPayment.slice(0, 8);
    return byPayment
      .filter((c) => {
        const client = c.client.toLowerCase();
        const formType = (c.formType || "").toLowerCase();
        const caseId = c.id.toLowerCase();
        return client.includes(query) || formType.includes(query) || caseId.includes(query);
      })
      .slice(0, 8);
  }, [commSearch, visibleCases, commPaymentFilter]);
  const allowedTabs = useMemo(
    () => (sessionUser?.userType === "staff" ? tabsForRole(sessionUser.role) : []),
    [sessionUser?.role, sessionUser?.userType]
  );
  const visibleTabs = useMemo(() => tabs.filter((t) => allowedTabs.includes(t.id)), [allowedTabs]);
  const taskAssigneeOptions = useMemo(() => {
    const names = new Set<string>();
    teamUsers
      .filter((u) => u.active !== false)
      .forEach((u) => names.add(String(u.name || "").trim()));
    if (sessionUser?.name) names.add(sessionUser.name);
    if (selectedCase?.assignedTo) names.add(String(selectedCase.assignedTo));
    names.delete("");
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [teamUsers, sessionUser?.name, selectedCase?.assignedTo]);
  const processingAssigneeOptions = useMemo(() => {
    const names = new Set<string>(["Unassigned"]);
    // Show all active team members
    teamUsers
      .filter((u) => u.active !== false)
      .forEach((u) => {
        const name = String(u.name || "").trim();
        if (!name) return;
        names.add(name);
      });
    const ordered = Array.from(names).filter(Boolean).sort((a, b) => {
      if (a === "Unassigned") return -1;
      if (b === "Unassigned") return 1;
      return a.localeCompare(b);
    });
    return ordered;
  }, [teamUsers, roleScopedCases]);

  const effectiveCommFormType = useMemo(
    () => (commFormType === "Other" ? commFormTypeOther.trim() : commFormType.trim()),
    [commFormType, commFormTypeOther]
  );

  const assigneeWorkloadRows = useMemo(() => {
    const now = Date.now();
    const activeAssignees = processingAssigneeOptions.filter((name) => name && name !== "Unassigned");
    return activeAssignees.map((name) => {
      const lower = name.toLowerCase();
      const owned = roleScopedCases.filter(
        (c) => String(c.assignedTo || "").trim().toLowerCase() === lower
      );
      const openCases = owned.filter((c) => String(c.processingStatus || "docs_pending") !== "submitted");
      const urgentCount = openCases.filter((c) => Boolean((c as CaseItem & { isUrgent?: boolean }).isUrgent)).length;
      const dueSoonCount = openCases.filter((c) => {
        const deadline = c.deadlineDate ? new Date(c.deadlineDate).getTime() : NaN;
        return Number.isFinite(deadline) && deadline >= now && deadline - now <= 3 * 24 * 60 * 60 * 1000;
      }).length;
      const sameTypeCount = openCases.filter(
        (c) => String(c.formType || "").trim().toLowerCase() === String(effectiveCommFormType || "").toLowerCase()
      ).length;
      const score = openCases.length + urgentCount * 2 + dueSoonCount - Math.min(3, sameTypeCount) * 0.5;
      return {
        name,
        openCases: openCases.length,
        urgentCount,
        dueSoonCount,
        sameTypeCount,
        score
      };
    });
  }, [processingAssigneeOptions, roleScopedCases, effectiveCommFormType]);

  const suggestedAssignee = useMemo(() => {
    if (!assigneeWorkloadRows.length) return "Unassigned";
    const sorted = [...assigneeWorkloadRows].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return sorted[0]?.name || "Unassigned";
  }, [assigneeWorkloadRows]);

  const filteredOutboundMessages = useMemo(() => {
    return outboundMessages.filter((item) => {
      if (outboundFilterChannel !== "all" && item.channel !== outboundFilterChannel) return false;
      if (outboundFilterStatus !== "all" && item.status !== outboundFilterStatus) return false;
      const q = outboundSearch.trim().toLowerCase();
      if (!q) return true;
      const hay = `${item.channel} ${item.status} ${item.target || ""} ${item.message || ""} ${item.createdByName || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [outboundMessages, outboundFilterChannel, outboundFilterStatus, outboundSearch]);

  useEffect(() => {
    if (!visibleTabs.length) return;
    if (!visibleTabs.some((t) => t.id === screen)) {
      setScreen(visibleTabs[0].id);
    }
  }, [screen, visibleTabs]);

  // Auto-assign removed — cases stay unassigned until manually assigned

  async function loadCaseDetail(caseId: string) {
    const [msgRes, docRes, reqRes, outRes] = await Promise.all([
      apiFetch(`/cases/${caseId}/messages`, { cache: "no-store" }),
      apiFetch(`/cases/${caseId}/documents`, { cache: "no-store" }),
      apiFetch(`/cases/${caseId}/doc-requests`, { cache: "no-store" }),
      apiFetch(`/cases/${caseId}/outbound`, { cache: "no-store" })
    ]);

    if (msgRes.ok) {
      const payload = await msgRes.json();
      setMessages(payload.messages as MessageItem[]);
    }
    if (docRes.ok) {
      const payload = await docRes.json();
      setDocuments(payload.documents as DocumentItem[]);
    }
    if (reqRes.ok) {
      const payload = await reqRes.json();
      setDocRequests((payload.requests || []) as DocRequestItem[]);
    }
    if (outRes.ok) {
      const payload = await outRes.json();
      setOutboundMessages((payload.logs || []) as OutboundMessageItem[]);
    }
  }

  async function loadClientIntakeProgress(caseId: string) {
    const res = await apiFetch(`/cases/${caseId}/intake`, { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setClientIntakeDone(false);
      return;
    }
    const intake = (payload.intake || {}) as Record<string, string>;
    const formType = String(payload.formType || intake.applicationType || "");
    setClientIntakeDone(isQuestionnaireComplete(formType, intake));
  }

  async function refreshTasks(caseId?: string) {
    const url = caseId ? `/tasks?caseId=${encodeURIComponent(caseId)}` : "/tasks";
    const res = await apiFetch(url, { cache: "no-store" });
    if (!res.ok) return;
    const payload = await res.json().catch(() => ({}));
    setTasks((payload.tasks || []) as TaskItem[]);
  }

  async function loadInternalIntake(caseId: string) {
    const res = await apiFetch(`/cases/${caseId}/intake`, { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setInternalIntake({});
      setInternalIntakeStatus(String(payload.error || "Could not load internal extraction fields"));
      return;
    }
    setInternalIntake((payload.intake || {}) as InternalExtractionIntake);
    setInternalIntakeStatus("");
  }

  async function loadLatestInviteForCase(caseId: string) {
    const res = await apiFetch(`/cases/${caseId}/invite`, { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setInviteUrl(clientAccessLinkFromPayload(payload));
  }

  useEffect(() => {
    if (!selectedCase) return;
    void loadCaseDetail(selectedCase.id);
    void loadInternalIntake(selectedCase.id);
    void refreshTasks(selectedCase.id);
    setCaseDetailTab("overview");
    setTaskActionStatus("");
  }, [selectedCase?.id]);

  useEffect(() => {
    if (!selectedCase || sessionUser?.userType !== "client") return;
    void loadClientIntakeProgress(selectedCase.id);
  }, [selectedCase?.id, sessionUser?.userType]);

  useEffect(() => {
    setInviteStatus("");
    setClientUpdateStatus("");
    if (!selectedCase || sessionUser?.userType !== "staff") {
      setInviteUrl("");
      setClientUpdateText("");
      return;
    }
    setInviteEmail(String(selectedCase.leadEmail || ""));
    setInvitePhone(String(selectedCase.leadPhone || ""));
    setOutboundFilterChannel("all");
    setOutboundFilterStatus("all");
    setOutboundSearch("");
    setClientUpdateText("");
    void loadLatestInviteForCase(selectedCase.id);
  }, [selectedCase?.id, sessionUser?.userType]);

  useEffect(() => {
    if (!selectedCase) return;
    setSetupFormType(selectedCase.formType || "");
    setSetupRetainerAmount(String(selectedCase.servicePackage.retainerAmount ?? ""));
    setSetupInteracRecipient(fixedInteracRecipient);
    setSetupInteracInstructions(selectedCase.interacInstructions || "");
    setRetainerConfirm(false);
    setSetupStatus("");
    setPaymentEmailTemplate("");
    setPaymentEmailStatus("");
    setClientMessageTemplate("");
    setClientMessageStatus("");
    setAiDraft(null);
    setAiDraftStatus("");
    setReadyPackageStatus("");
    setReadyPackagePath("");
    setImmRunStatus("");
    setInternalIntake({});
    setInternalIntakeStatus("");
    setResultOutcome((selectedCase.finalOutcome as "" | "approved" | "refused" | "request_letter") || "");
    setResultDecisionDate(selectedCase.decisionDate || "");
    setResultRemarks(selectedCase.remarks || "");
    setResultDecisionStatus("");
    setResultShareStatus("");
    setResultSendEmail(String(selectedCase.leadEmail || ""));
    setResultSendPhone(String(selectedCase.leadPhone || ""));
    setSubmissionCaseId(selectedCase.id || "");
    setSubmissionApplicationNumber(selectedCase.applicationNumber || "");
    setSubmissionStatus("");
    setNewTaskAssignedTo(String(selectedCase.assignedTo || sessionUser?.name || ""));
    setNewTaskDueDate("");
  }, [selectedCase?.id]);

  useEffect(() => {
    if (sessionUser?.userType === "client" && sessionUser.name) {
      setRetainerName((prev) => prev || sessionUser.name);
    }
  }, [sessionUser?.userType, sessionUser?.name]);

  useEffect(() => {
    if (sessionUser?.userType !== "client") return;
    const clientCase = cases[0];
    if (!clientCase) return;
    if (!clientCase.retainerSigned) {
      setClientScreen("retainer");
      return;
    }
    // Auto-guide the client once retainer is signed.
    if (!clientIntakeDone) {
      setClientScreen("questions");
      return;
    }
    setClientScreen("documents");
  }, [sessionUser?.userType, cases, clientIntakeDone]);

  useEffect(() => {
    if (!selectedCase) return;
    if (screen !== "chat" && sessionUser?.userType !== "client") return;
    const timer = setInterval(() => {
      void loadCaseDetail(selectedCase.id);
    }, 4000);
    return () => clearInterval(timer);
  }, [screen, selectedCase?.id, sessionUser?.userType]);

  useEffect(() => {
    if (!sessionUser) return;
    const minutes = Math.max(
      5,
      Number(process.env.NEXT_PUBLIC_INACTIVITY_LOGOUT_MINUTES || 30)
    );
    const timeoutMs = minutes * 60 * 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void logout();
      }, timeoutMs);
    };

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart"
    ];
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [sessionUser?.id]);

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
    setSessionUser(null);
    setCompany(null);
    setCases([]);
  }

  async function createInviteForCase(caseId: string, email?: string) {
    const res = await apiFetch(`/cases/${caseId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(email || "").trim() || undefined })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false as const, error: String(payload.error || "Could not create invite.") };
    }
    return {
      ok: true as const,
      url: clientAccessLinkFromPayload(payload)
    };
  }

  async function tryServerDispatchForCase(
    caseId: string,
    channel: "email" | "whatsapp" | "sms",
    target: string,
    message: string
  ): Promise<"sent" | "provider_missing" | "failed" | "not_applicable"> {
    const trimmedTarget = String(target || "").trim();
    if (!trimmedTarget) return "not_applicable";
    const res = await apiFetch(`/cases/${caseId}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        target: trimmedTarget,
        message
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return "failed";
    const status = String(payload?.result?.status || "");
    const log = payload?.log as OutboundMessageItem | undefined;
    if (log && selectedCaseId === caseId) {
      setOutboundMessages((prev) => [log, ...prev]);
    }
    if (status === "sent") return "sent";
    if (status === "provider_missing") return "provider_missing";
    return "failed";
  }

  async function createCaseFromCommunications() {
    const effectiveFormType =
      commFormType === "Other" ? commFormTypeOther.trim() : commFormType.trim();
    if (!commClientName.trim() || !effectiveFormType) {
      setCommCreateStatus("Client name and application type are required.");
      return;
    }
    const totalChargesRaw = commTotalCharges.trim();
    const irccFeesRaw = commIrccFees.trim();
    const totalCharges = totalChargesRaw ? Number(totalChargesRaw) : 0;
    const irccFees = irccFeesRaw ? Number(irccFeesRaw) : 0;
    if (!Number.isFinite(totalCharges) || totalCharges < 0) {
      setCommCreateStatus("Enter a valid Total Charges amount.");
      return;
    }
    if (!Number.isFinite(irccFees) || irccFees < 0) {
      setCommCreateStatus("Enter a valid IRCC Fees amount.");
      return;
    }
    if (commUrgent) {
      const days = Number(commUrgentDays || 0);
      if (!Number.isFinite(days) || days <= 0) {
        setCommCreateStatus("Enter valid urgent deadline days.");
        return;
      }
    }
    if (NON_PROCESSING_APPLICATION_TYPES.has(effectiveFormType)) {
      // Still create the case but go to accounting after
      // Continue with case creation below — just flag it
    }
    const familyTotalChargesRaw = commFamilyTotalCharges.trim();
    const familyTotalCharges = familyTotalChargesRaw ? Number(familyTotalChargesRaw) : undefined;
    if (
      familyTotalChargesRaw &&
      (!Number.isFinite(Number(familyTotalCharges)) || Number(familyTotalCharges) < 0)
    ) {
      setCommCreateStatus("Enter a valid Family Total Charges amount.");
      return;
    }
    const normalizedAdditionalApplicants = commAdditionalApplicants
      .map((a) => String(a.name || "").trim())
      .filter(Boolean);
    setCommCreateStatus("Creating case...");
    const res = await apiFetch("/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: commClientName.trim(),
        formType: effectiveFormType,
        leadPhone: commPhone.trim() || undefined,
        leadEmail: commEmail.trim() || undefined,
        totalCharges,
        irccFees,
        irccFeePayer: commIrccFeePayer,
        familyMembers:
          normalizedAdditionalApplicants.length > 0
            ? normalizedAdditionalApplicants.join(", ")
            : undefined,
        familyTotalCharges,
        assignedTo: commAssignedTo && commAssignedTo !== "Unassigned" ? commAssignedTo : undefined,
        additionalNotes: commAdditionalNotes.trim() || undefined,
        isUrgent: commUrgent,
        dueInDays: commUrgent ? Number(commUrgentDays || 0) : undefined,
        permitExpiryDate: commPermitExpiryDate || undefined
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCommCreateStatus(String(payload.error || "Could not create case."));
      return;
    }
    const created = payload.case as CaseItem;
    setCases((prev) => [created, ...prev]);
    setSelectedCaseId(created.id);
    setInviteEmail(String(created.leadEmail || ""));
    setInvitePhone(String(created.leadPhone || ""));
    setSetupFormType(created.formType || effectiveFormType);
    const driveLinked = Boolean(payload?.drive?.linked);
    const driveReason = String(payload?.drive?.reason || "");
    let inviteOutcome = "";
    if (commAutoSendInvite && !NON_PROCESSING_APPLICATION_TYPES.has(effectiveFormType)) {
      const leadPhone = String(created.leadPhone || commPhone || "").trim();
      const waPhone = normalizePhoneForWa(leadPhone);
      if (waPhone) {
        const waIntakeRes = await apiFetch(`/cases/${created.id}/wa-intake`, { method: "POST" }).catch(()=>null);
        if (waIntakeRes?.ok) {
          inviteOutcome = " ✅ WhatsApp intake sent!";
          // Switch to inbox so team can see the conversation
          setTimeout(() => setScreen("inbox"), 1500);
        } else {
          const d = await waIntakeRes?.json().catch(()=>({}));
          inviteOutcome = " ⚠️ WhatsApp not sent: " + (d?.error || "check phone number");
        }
      } else {
        inviteOutcome = " ⚠️ No phone number — add phone to send WhatsApp intake.";
      }
    }
    if (driveLinked) {
      setCommCreateStatus(`✓ Case ${created.id} created.${inviteOutcome || " Portal link ready — send to client."}`);
    } else {
      setCommCreateStatus(`✓ Case ${created.id} created.${inviteOutcome || " Auto-send off — use Send Link button in case."}`);
    }
    // Send invites to linked applicants with phone numbers
    if (commAutoSendInvite && commAdditionalApplicants.length > 0) {
      for (const applicant of commAdditionalApplicants) {
        if (typeof applicant !== "string" && applicant.phone) {
          const waPhone = normalizePhoneForWa(applicant.phone);
          if (waPhone) {
            const linkedInvite = await createInviteForCase(created.id, undefined);
            if (linkedInvite.ok) {
              const linkedMsg = `Hi ${applicant.name.split(" ")[0]}! Newton Immigration has opened your ${applicant.formType || created.formType} file. Your portal link: ${linkedInvite.url}`;
              await tryServerDispatchForCase(created.id, "whatsapp", waPhone, linkedMsg);
            }
          }
        }
      }
    }

    setCommClientName("");
    setCommPhone("");
    setCommEmail("");
    setCommTotalCharges("");
    setCommIrccFees("");
    setCommIrccFeePayer("client_card");
    setCommAdditionalApplicants([]);
    setCommApplicantDraftName("");
    setCommApplicantDraftPhone("");
    setCommApplicantDraftType("");
    setCommFamilyTotalCharges("");
    setCommAdditionalNotes("");
    setCommFormTypeOther("");
    setCommAssignedTo("Unassigned");
    setCommUrgent(false);
    setCommUrgentDays("5");
    setCommPermitExpiryDate("");
    // Navigate to accounting for non-processing types
    if (NON_PROCESSING_APPLICATION_TYPES.has(effectiveFormType)) {
      setTimeout(() => setScreen("accounting"), 800);
    } else {
      setTimeout(() => { setSelectedCaseId(created.id); setScreen("cases"); }, 800);
    }
  }

  function addAdditionalApplicant() {
    const name = commApplicantDraftName.trim();
    if (!name) return;
    if (name.toLowerCase() === commClientName.trim().toLowerCase()) {
      setCommCreateStatus("Main applicant is already included.");
      return;
    }
    const exists = commAdditionalApplicants.some((a) => (typeof a === "string" ? a : a.name).toLowerCase() === name.toLowerCase());
    if (exists) { setCommCreateStatus("Applicant already added."); return; }
    setCommAdditionalApplicants((prev) => [...prev, { name, phone: commApplicantDraftPhone.trim(), formType: commApplicantDraftType.trim() }]);
    setCommApplicantDraftName(""); setCommApplicantDraftPhone(""); setCommApplicantDraftType("");
    setCommCreateStatus("");
  }

  function removeAdditionalApplicant(index: number) {
    setCommAdditionalApplicants((prev) => prev.filter((_, i) => i !== index));
  }

  async function pruneToRealCases() {
    if (sessionUser?.role !== "Admin" || sessionUser?.userType !== "staff") {
      setCommPruneStatus("Only Admin can run this action.");
      return;
    }
    const keepCaseIds = commPruneCaseIds
      .split(/[\n, ]+/g)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (keepCaseIds.length === 0) {
      setCommPruneStatus("Enter at least one case ID, e.g. CASE-1006.");
      return;
    }

    setCommPruneStatus("Pruning test cases...");
    const res = await apiFetch("/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pruneCases: true,
        confirmText: "PRUNE",
        keepCaseIds
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCommPruneStatus(String(payload.error || "Could not prune cases."));
      return;
    }
    const deletedCount = Number(payload.deletedCount || 0);
    setCommPruneStatus(`Done. Removed ${deletedCount} non-selected case(s).`);
    await loadSession();
  }

  async function runDiagnosticsBot() {
    setDiagnosticsStatus("Running QA/Security bot checks...");
    const res = await apiFetch("/testing/bot", { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDiagnosticsReport(null);
      setDiagnosticsStatus(String(payload.error || "Could not run diagnostics bot."));
      return;
    }
    setDiagnosticsReport(payload as DiagnosticsReport);
    setDiagnosticsStatus("Diagnostics completed.");
  }

  function downloadAuditCsv() {
    setAuditStatus("Preparing audit export...");
    const url = `/api/audit?format=csv&limit=5000`;
    window.open(url, "_blank");
    setAuditStatus("Audit CSV export started.");
  }

  async function sendMessage(mode: "human" | "ai") {
    const text = chatText.trim();
    if (!text) return;

    const targetCaseId = selectedCase?.id || cases[0]?.id;
    if (!targetCaseId) {
      setChatStatus("No case found for chat.");
      return;
    }

    setChatStatus("Sending...");
    const res = await apiFetch(`/cases/${targetCaseId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setChatStatus(String(payload.error || "Could not send message."));
      return;
    }
    setMessages((prev) => {
      const next = [...prev];
      if (payload.message) next.push(payload.message as MessageItem);
      if (payload.aiMessage) next.push(payload.aiMessage as MessageItem);
      return next;
    });
    setChatText("");
    setChatStatus("Sent.");
  }

  async function addDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const link = String(data.get("link") ?? "").trim();
    if (!name) return;

    const res = await apiFetch(`/cases/${selectedCase.id}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, link, status: "pending" })
    });
    if (!res.ok) return;
    const payload = await res.json();
    setDocuments((prev) => [...prev, payload.document as DocumentItem]);
    form.reset();
  }

  async function uploadResultDocument() {
    const targetCase = resultLinkedCase || selectedCase;
    if (!targetCase) {
      setResultUploadStatus("Enter application number/case ID or select a case first.");
      return;
    }
    if (!resultUploadFile) {
      setResultUploadStatus("Choose a file first.");
      return;
    }
    setResultUploadStatus("Uploading result...");
    const formData = new FormData();
    formData.append("file", resultUploadFile);
    formData.append("name", resultUploadName.trim() || resultUploadFile.name);
    formData.append("category", "result");
    const res = await apiFetch(`/cases/${targetCase.id}/documents`, {
      method: "POST",
      body: formData
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setResultUploadStatus(String(payload.error || "Could not upload result."));
      return;
    }
    if (payload.document) {
      setDocuments((prev) => [...prev, payload.document as DocumentItem]);
    }
    setSelectedCaseId(targetCase.id);
    await loadCaseDetail(targetCase.id);
    setResultUploadFile(null);
    setResultUploadName("");
    setResultUploadStatus(`Result uploaded for ${targetCase.id} and available in client portal.`);
  }

  async function saveCaseResultDecision() {
    const targetCase = resultLinkedCase || selectedCase;
    if (!targetCase) {
      setResultDecisionStatus("Enter application number/case ID or select a case first.");
      return;
    }
    if (!resultOutcome) {
      setResultDecisionStatus("Select a decision first.");
      return;
    }
    setResultDecisionStatus("Saving decision...");
    const res = await apiFetch(`/cases/${targetCase.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        finalOutcome: resultOutcome,
        decisionDate: resultDecisionDate.trim() || undefined,
        remarks: resultRemarks.trim() || undefined
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setResultDecisionStatus(String(payload.error || "Could not save result decision."));
      return;
    }
    const updated = payload.case as CaseItem;
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setSelectedCaseId(updated.id);
    setResultDecisionStatus(`Saved result for ${updated.id}.`);
  }

  function buildResultMessage(caseItem: CaseItem) {
    const resultsSupportPhone = "6046535031";
    const outcome =
      caseItem.finalOutcome === "approved"
        ? "approved"
        : caseItem.finalOutcome === "refused"
          ? "refused"
          : caseItem.finalOutcome === "request_letter"
            ? "request letter issued"
            : "updated";
    const resultLink = resultDocuments[0]?.link || "";
    const lines = [
      `Hi ${caseItem.client},`,
      "",
      `Your case ${caseItem.id} (${caseItem.formType}) is ${outcome}.`
    ];
    if (caseItem.applicationNumber) {
      lines.push(`Application number: ${caseItem.applicationNumber}`);
    }
    if (resultLink) {
      lines.push("", `Result document: ${resultLink}`);
    }
    if (caseItem.finalOutcome === "approved") {
      lines.push("", "Congratulations, we got your permit approved.");
      lines.push("If you found our service helpful, please share your review:");
      lines.push("https://g.page/r/CYTdpFJ-nDr7EAE/review");
    }
    lines.push("", `For result support, contact us at ${resultsSupportPhone}.`);
    lines.push("", "Newton Immigration Team");
    return lines.join("\n");
  }

  async function sendResultUpdate(channel: "email" | "whatsapp" | "sms") {
    const targetCase = resultLinkedCase || selectedCase;
    if (!targetCase) {
      setResultShareStatus("Enter application number/case ID or select a case first.");
      return;
    }
    setResultShareStatus("Sending result update...");
    const message = buildResultMessage(targetCase);
    const email = resultSendEmail.trim() || String(targetCase.leadEmail || "").trim();
    const phone = resultSendPhone.trim() || String(targetCase.leadPhone || "").trim();

    if (channel === "email") {
      if (!email) {
        setResultShareStatus("Enter client email first.");
        return;
      }
      const dispatchStatus = await tryServerDispatch("email", email, message);
      if (dispatchStatus === "sent") {
        setResultShareStatus("Result email sent.");
        return;
      }
      setResultShareStatus("Email provider not configured. Opened local email app.");
      window.open(
        `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Case result update - ${targetCase.id}`)}&body=${encodeURIComponent(message)}`,
        "_blank"
      );
      return;
    }

    const cleanedPhone = channel === "whatsapp" ? normalizePhoneForWa(phone) : phone.replace(/[^\d+]/g, "");
    if (!cleanedPhone) {
      setResultShareStatus("Enter client phone number first.");
      return;
    }

    // For Results workflow, WhatsApp should always open directly.
    if (channel === "whatsapp") {
      window.open(`https://wa.me/${cleanedPhone}?text=${encodeURIComponent(message)}`, "_blank");
      setResultShareStatus("WhatsApp opened.");
      return;
    }

    const dispatchStatus = await tryServerDispatch(channel, cleanedPhone, message);
    if (dispatchStatus === "sent") {
      setResultShareStatus("Result SMS sent.");
      return;
    }
    window.open(`sms:${cleanedPhone}?body=${encodeURIComponent(message)}`, "_blank");
    setResultShareStatus("SMS app opened. Provider not configured for server send.");
  }

  async function submitLegacyResult() {
    const appNo = resultApplicationNumber.trim();
    if (!appNo) {
      setLegacyResultStatus("Application number is required.");
      return;
    }
    const phone =
      legacyResultPhone.trim() ||
      resultSuggestedContact?.phone ||
      "";
    if (!phone) {
      setLegacyResultStatus("Phone number is required. Use matched phone or enter manually.");
      return;
    }
    if (!legacyResultFile) {
      setLegacyResultStatus("Result PDF is required.");
      return;
    }
    const client = legacyResultClientName.trim() || resultSuggestedContact?.clientName || "Legacy Client";
    setLegacyResultStatus("Saving legacy result...");
    const form = new FormData();
    form.append("applicationNumber", appNo);
    form.append("resultDate", legacyResultDate || todayIsoDate);
    form.append("clientName", client);
    form.append("phone", phone);
    form.append("outcome", legacyResultOutcome);
    form.append("notes", legacyResultNotes.trim());
    if (legacyResultFile) form.append("file", legacyResultFile);

    const res = await apiFetch("/results/legacy", {
      method: "POST",
      body: form
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLegacyResultStatus(String(payload.error || "Could not save legacy result."));
      return;
    }
    const item = payload.item as LegacyResultItem;
    setLegacyResults((prev) => [item, ...prev]);
    setLegacyResultFile(null);
    setLegacyResultNotes("");
    setLegacyResultStatus(
      item.autoCategory === "new"
        ? `Saved and linked to ${item.matchedCaseId || "case"} automatically.`
        : `Saved old-client result for ${item.clientName}.`
    );
  }

  function applyResultSuggestedContact() {
    if (!resultSuggestedContact) {
      setLegacyResultStatus("No matched contact found. Enter client name and phone manually.");
      return;
    }
    setLegacyResultClientName(resultSuggestedContact.clientName || "");
    setLegacyResultPhone(resultSuggestedContact.phone || "");
    setLegacyResultStatus(
      `Loaded ${resultSuggestedContact.source === "case" ? "case" : "history"} contact details.`
    );
  }

  async function linkScannerUploadToCase(resultId: string, caseId: string) {
    const result = legacyResults.find(r => r.id === resultId);
    const matchedCase = cases.find(c => c.id === caseId);

    // Save app number to case
    if (result?.applicationNumber && matchedCase) {
      await apiFetch(`/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationNumber: result.applicationNumber })
      });
      setCases(prev => prev.map(c => c.id === caseId ? { ...c, applicationNumber: result.applicationNumber } : c));
    }

    // Pull phone from case into result so WhatsApp works
    const casePhone = matchedCase?.leadPhone || "";
    if (casePhone) {
      await apiFetch(`/results/legacy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link_to_case", resultId, caseId, phone: casePhone })
      });
    }

    // Update local state — mark linked + add phone
    setLegacyResults(prev => prev.map(r => r.id === resultId ? {
      ...r,
      autoCategory: "new" as const,
      matchedCaseId: caseId,
      phone: casePhone || r.phone,
      clientName: matchedCase?.client || r.clientName,
    } : r));
  }

  async function markResultInformed(resultId: string) {
    setLegacyResultStatus("Updating informed status...");
    const res = await apiFetch("/results/legacy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultId })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLegacyResultStatus(String(payload.error || "Could not update informed status."));
      return;
    }
    const updated = payload.item as LegacyResultItem;
    setLegacyResults((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setLegacyResultStatus(
      `Marked informed${updated.informedAt ? ` on ${new Date(updated.informedAt).toLocaleString()}` : ""}.`
    );
  }

  function buildLegacyResultMessage(item: LegacyResultItem) {
    const firstName = (item.clientName || "Client").split(" ")[0];
    const outcomeText =
      item.outcome === "approved" ? "✅ *APPROVED*" :
      item.outcome === "refused"  ? "❌ *REFUSED*" :
      item.outcome === "request_letter" ? "📋 *Request Letter*" : "📄 Update";
    const lines = [
      `Hi ${firstName},`,
      "",
      `We have an update on your application *${item.applicationNumber}*:`,
      "",
      `*Result: ${outcomeText}*`,
      "",
    ];
    if (item.outcome === "approved") {
      lines.push("🎉 Congratulations! Your application has been approved by IRCC.");
      lines.push("Our team will contact you shortly with next steps.");
    } else if (item.outcome === "refused") {
      lines.push("Our team has reviewed your refusal and will contact you to discuss your options.");
    } else if (item.outcome === "request_letter") {
      lines.push("IRCC has requested additional documents/information.");
      lines.push("Our team will contact you with the details of what is needed.");
    } else {
      lines.push("Please check your application portal for details.");
    }
    if (item.fileLink && typeof window !== "undefined") {
      const downloadUrl = `${window.location.origin}/api/results/legacy/${encodeURIComponent(item.id)}/download`;
      lines.push("", `📎 Download your result letter: ${downloadUrl}`);
    }
    lines.push("", "*Newton Immigration Team*", "📞 604-902-4500");
    return lines.join("\n");
  }

  async function sendLegacyResultOnWhatsApp(item: LegacyResultItem) {
    const phoneDigits = String(item.phone || "").replace(/[^\d]/g, "");
    const waPhone = phoneDigits.length === 10 ? `1${phoneDigits}` : phoneDigits;
    if (!waPhone) {
      setLegacyResultStatus(`❌ No phone number for ${item.clientName || item.applicationNumber}. Add phone first.`);
      return;
    }
    setLegacyResultStatus(`Sending WhatsApp to ${item.clientName}...`);
    try {
      // Send via CRM dispatch API — uses WhatsApp Cloud API directly
      const matchedCase = cases.find(c =>
        c.leadPhone?.replace(/\D/g,"") === waPhone ||
        c.applicationNumber === item.applicationNumber
      );
      const message = buildLegacyResultMessage(item);
      if (matchedCase) {
        const res = await apiFetch(`/cases/${matchedCase.id}/dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "whatsapp", target: waPhone, message })
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d?.result?.status === "sent") {
          setLegacyResultStatus(`✅ WhatsApp sent to ${item.clientName}!`);
          await markResultInformed(item.id);
          return;
        }
      }
      // Fallback — open WhatsApp web
      window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`, "_blank");
      setLegacyResultStatus(`✅ WhatsApp opened for ${item.clientName}.`);
      await markResultInformed(item.id);
    } catch(e) {
      window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(buildLegacyResultMessage(item))}`, "_blank");
      setLegacyResultStatus(`WhatsApp opened for ${item.clientName}.`);
    }
  }

  async function setLegacyResultInformedState(item: LegacyResultItem, nextState: "not_informed" | "informed") {
    if (nextState === "not_informed") {
      setLegacyResultStatus("This entry is already stored as not informed or cannot be reverted from here.");
      return;
    }
    if (item.informedToClient) {
      setLegacyResultStatus("Already marked informed.");
      return;
    }
    await markResultInformed(item.id);
  }

  async function submitCaseWithApplicationNumber() {
    const appNo = submissionApplicationNumber.trim();
    if (!appNo) {
      setSubmissionStatus("Application number is required.");
      return;
    }
    const normalizeAppNo = (value: string) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    let targetCase = selectedSubmissionCase || submissionAutoMatchedCase;
    if (!targetCase) {
      const key = normalizeAppNo(appNo);
      const matches = submissionCaseOptions.filter(
        (c) => normalizeAppNo(String(c.applicationNumber || "")) === key
      );
      if (matches.length === 1) {
        targetCase = matches[0];
        setSubmissionCaseId(matches[0].id);
      } else if (matches.length > 1) {
        setSubmissionStatus("Multiple cases matched this application number. Please select case.");
        return;
      }
    }
    if (!submissionUploadFile) {
      setSubmissionStatus("Upload submission document before marking submitted.");
      return;
    }
    const resolvedPhone =
      String(submissionPhone || "").trim() ||
      submissionSuggestedContact?.phone ||
      "";
    if (!resolvedPhone) {
      setSubmissionStatus("Phone number is required. Use matched phone or enter manually.");
      return;
    }
    const submissionFileName = String(submissionUploadFile.name || "").toLowerCase();
    const submissionFileType = String(submissionUploadFile.type || "").toLowerCase();
    if (submissionFileType !== "application/pdf" && !submissionFileName.endsWith(".pdf")) {
      setSubmissionStatus("Submission attachment must be a PDF file.");
      return;
    }
    setSubmissionStatus("Submitting and uploading document...");

    let storedFileName = "";
    let storedFileLink = "";
    const nowIso = new Date().toISOString();
    if (targetCase) {
      const formData = new FormData();
      formData.append("file", submissionUploadFile);
      formData.append(
        "name",
        submissionUploadType === "submission_letter" ? "Submission Letter" : "WP Extension Letter"
      );
      formData.append("driveFolderType", "submission");
      formData.append("category", "general");

      const docRes = await apiFetch(`/cases/${targetCase.id}/documents`, {
        method: "POST",
        body: formData
      });
      const docPayload = await docRes.json().catch(() => ({}));
      if (!docRes.ok) {
        setSubmissionStatus(String(docPayload.error || "Could not upload submission document."));
        return;
      }
      if (docPayload.document) {
        const newDoc = docPayload.document as DocumentItem;
        storedFileName = String(newDoc.name || "").trim();
        storedFileLink = String(newDoc.link || "").trim();
        setDocuments((prev) => [...prev, newDoc]);
      }

      const res = await apiFetch(`/cases/${targetCase.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processingStatus: "submitted",
          applicationNumber: appNo,
          submittedAt: nowIso,
          submissionDocumentUploadedAt: nowIso
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmissionStatus(String(payload.error || "Could not submit case."));
        return;
      }
      const updated = payload.case as CaseItem;
      setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    }

    const submissionForm = new FormData();
    submissionForm.append("entryType", "submission");
    submissionForm.append("applicationNumber", appNo);
    submissionForm.append("resultDate", nowIso.slice(0, 10));
    submissionForm.append("outcome", "other");
    submissionForm.append("notes", "Submitted");
    submissionForm.append(
      "clientName",
      String(submissionClientName || "").trim() ||
        targetCase?.client ||
        submissionLegacyByAppNo?.clientName ||
        "Client"
    );
    submissionForm.append(
      "phone",
      resolvedPhone
    );
    if (targetCase?.id) {
      submissionForm.append("selectedCaseId", targetCase.id);
    }

    if (storedFileLink && storedFileName) {
      const recordRes = await apiFetch("/results/legacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryType: "submission",
          applicationNumber: appNo,
          resultDate: nowIso.slice(0, 10),
          outcome: "other",
          notes: "Submitted",
          clientName:
            String(submissionClientName || "").trim() ||
            targetCase?.client ||
            submissionLegacyByAppNo?.clientName ||
            "Client",
          phone:
            resolvedPhone,
          selectedCaseId: targetCase?.id || undefined,
          fileName: storedFileName,
          fileLink: storedFileLink
        })
      });
      const recordPayload = await recordRes.json().catch(() => ({}));
      if (!recordRes.ok) {
        setSubmissionStatus(String(recordPayload.error || "Submission saved on case, but history record failed."));
        return;
      }
      if (recordPayload.item) {
        setLegacyResults((prev) => [recordPayload.item as LegacyResultItem, ...prev]);
      }
    } else {
      submissionForm.append("file", submissionUploadFile);
      const recordRes = await apiFetch("/results/legacy", {
        method: "POST",
        body: submissionForm
      });
      const recordPayload = await recordRes.json().catch(() => ({}));
      if (!recordRes.ok) {
        setSubmissionStatus(String(recordPayload.error || "Could not create submission history record."));
        return;
      }
      if (recordPayload.item) {
        setLegacyResults((prev) => [recordPayload.item as LegacyResultItem, ...prev]);
      }
    }

    setSubmissionStatus(
      targetCase
        ? `Submitted ${targetCase.id} and saved submission history for ${appNo}.`
        : `Saved standalone submission history for ${appNo}.`
    );
    setSubmissionApplicationNumber("");
    setSubmissionClientName("");
    setSubmissionPhone("");
    setSubmissionSearch("");
    setSubmissionCaseId("");
    setSubmissionUploadFile(null);
  }

  function applySubmissionSuggestedContact() {
    if (!submissionSuggestedContact) {
      setSubmissionStatus("No matched contact found. Enter client name and phone manually.");
      return;
    }
    setSubmissionClientName(submissionSuggestedContact.clientName || "");
    setSubmissionPhone(submissionSuggestedContact.phone || "");
    setSubmissionStatus(
      `Loaded ${submissionSuggestedContact.source === "case" ? "case" : "history"} contact details.`
    );
  }

  async function uploadSubmissionDocument() {
    const targetCase = selectedSubmissionCase || selectedCase;
    if (!targetCase) {
      setSubmissionUploadStatus("Select a case first.");
      return;
    }
    if (!submissionUploadFile) {
      setSubmissionUploadStatus("Choose a file first.");
      return;
    }
    const submissionFileName = String(submissionUploadFile.name || "").toLowerCase();
    const submissionFileType = String(submissionUploadFile.type || "").toLowerCase();
    if (submissionFileType !== "application/pdf" && !submissionFileName.endsWith(".pdf")) {
      setSubmissionUploadStatus("Only PDF files are allowed for submission uploads.");
      return;
    }
    setSubmissionUploadStatus("Uploading to submission folder...");
    const formData = new FormData();
    formData.append("file", submissionUploadFile);
    formData.append(
      "name",
      submissionUploadType === "submission_letter" ? "Submission Letter" : "WP Extension Letter"
    );
    formData.append("driveFolderType", "submission");
    formData.append("category", "general");
    const res = await apiFetch(`/cases/${targetCase.id}/documents`, {
      method: "POST",
      body: formData
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSubmissionUploadStatus(String(payload.error || "Could not upload submission document."));
      return;
    }
    if (payload.document) {
      setDocuments((prev) => [...prev, payload.document as DocumentItem]);
    }
    setSubmissionUploadFile(null);
    setSubmissionUploadStatus("Uploaded successfully to submission folder.");
  }

  function buildSubmissionMessage(entry: { clientName: string; applicationNumber?: string; caseId?: string }) {
    return [
      `Hi ${entry.clientName || "Client"},`,
      "",
      `Your application has been submitted.`,
      `Case: ${entry.caseId || "-"}`,
      `Application number: ${entry.applicationNumber || "-"}`,
      "",
      "Newton Immigration Team"
    ].join("\n");
  }

  async function sendSubmissionOnWhatsApp(item: LegacyResultItem) {
    const phone = normalizePhoneForWa(String(item.phone || ""));
    if (!phone) {
      setSubmissionStatus(`No phone found for ${item.applicationNumber}.`);
      return;
    }
    const text = encodeURIComponent(
      buildSubmissionMessage({
        clientName: item.clientName || "Client",
        applicationNumber: item.applicationNumber,
        caseId: item.matchedCaseId
      })
    );
    window.open(`https://wa.me/${phone}?text=${text}`, "_blank");
    setSubmissionStatus(`WhatsApp opened for ${item.applicationNumber}.`);
  }

  async function syncLeadsFromSheet() {
    setLeadSyncStatus("Syncing leads...");
    const res = await apiFetch("/integrations/google-sheet/sync-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvUrl: leadSheetCsvUrl.trim() || undefined })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLeadSyncStatus(String(payload.error || "Could not sync lead sheet"));
      return;
    }
    setLeadSyncStatus(
      `Lead sync complete. Created ${Number(payload.created || 0)} case(s), skipped ${Number(payload.skipped || 0)}.`
    );
    await loadSession();
  }

  async function createClientInvite() {
    if (!selectedCase) return;
    setInviteStatus("Creating invite link...");
    setInviteShareStatus("");
    const res = await apiFetch(`/cases/${selectedCase.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim() || undefined })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setInviteStatus(String(payload.error || "Could not create invite"));
      return;
    }
    const url = clientAccessLinkFromPayload(payload);
    setInviteUrl(url);
    setInviteStatus("Invite link ready. Send this to client.");
    await logOutboundCommunication({
      channel: "link",
      status: "sent",
      target: inviteEmail.trim() || invitePhone.trim() || undefined,
      message: `Client portal link generated: ${url}`
    });
  }

  async function logOutboundCommunication(input: {
    channel: "email" | "whatsapp" | "sms" | "link" | "copy";
    status: "queued" | "opened_app" | "sent" | "failed";
    target?: string;
    message: string;
  }) {
    if (!selectedCase) return;
    const res = await apiFetch(`/cases/${selectedCase.id}/outbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!res.ok) return;
    const payload = await res.json().catch(() => ({}));
    const log = payload?.log as OutboundMessageItem | undefined;
    if (log) {
      setOutboundMessages((prev) => [log, ...prev]);
    }
  }

  async function tryServerDispatch(
    channel: "email" | "whatsapp" | "sms",
    target: string,
    message: string
  ): Promise<"sent" | "provider_missing" | "failed" | "not_applicable"> {
    if (!selectedCase) return "not_applicable";
    const trimmedTarget = String(target || "").trim();
    if (!trimmedTarget) return "failed";
    const res = await apiFetch(`/cases/${selectedCase.id}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        target: trimmedTarget,
        message
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return "failed";
    const status = String(payload?.result?.status || "");
    const log = payload?.log as OutboundMessageItem | undefined;
    if (log) setOutboundMessages((prev) => [log, ...prev]);
    if (status === "sent") return "sent";
    if (status === "provider_missing") return "provider_missing";
    return "failed";
  }

  function normalizePhoneForWa(phone: string) {
    const digits = phone.replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.length === 10) return `1${digits}`;
    return digits;
  }

  function buildInviteMessage(caseItem: CaseItem, url: string) {
    const amount = Number(setupRetainerAmount || caseItem.servicePackage.retainerAmount || 0);
    return [
      `Hi ${caseItem.client},`,
      "",
      `Your Newton Immigration portal link is ready for ${caseItem.formType}.`,
      `Case: ${caseItem.id}`,
      "",
      `Complete your details and documents here:`,
      url,
      "",
      amount > 0
        ? `Interac amount: $${amount} CAD to ${fixedInteracRecipient} (use case number ${caseItem.id} in message).`
        : `Please follow instructions inside your portal.`,
      "",
      "Newton Immigration Team"
    ].join("\n");
  }

  function buildDocsReminderMessage(caseItem: CaseItem) {
    return [
      `Hi ${caseItem.client},`,
      "",
      `Quick reminder from Newton Immigration for ${caseItem.formType} (${caseItem.id}).`,
      "Please complete your pending questionnaire and upload all required documents in your portal.",
      inviteUrl ? `Portal link: ${inviteUrl}` : "Use your secure portal link shared with you.",
      "",
      "If you need help, reply here and our team will assist you.",
      "",
      "Newton Immigration Team"
    ].join("\n");
  }

  function buildPaymentReminderMessage(caseItem: CaseItem) {
    const total = Number(caseItem.totalCharges || caseItem.servicePackage?.retainerAmount || 0);
    const paid = Number(caseItem.amountPaid || 0);
    const pending = Math.max(0, total - paid);
    return [
      `Hi ${caseItem.client},`,
      "",
      `Payment reminder for case ${caseItem.id} (${caseItem.formType}).`,
      `Total service fee: ${formatCurrencyValue(total)} CAD`,
      `Received: ${formatCurrencyValue(paid)} CAD`,
      `Pending: ${formatCurrencyValue(pending)} CAD`,
      "",
      `Interac recipient: ${fixedInteracRecipient}`,
      "Please include your case number in transfer message.",
      "",
      "Newton Immigration Team"
    ].join("\n");
  }

  function buildGeneralFollowupMessage(caseItem: CaseItem) {
    return [
      `Hi ${caseItem.client},`,
      "",
      `This is a follow-up update for your case ${caseItem.id} (${caseItem.formType}).`,
      "Our team is actively working on your file. We will keep updating you in this portal.",
      "",
      "If you need support, reply with your question and we will help.",
      "",
      "Newton Immigration Team"
    ].join("\n");
  }

  async function shareInvite(channel: "copy" | "email" | "whatsapp" | "sms") {
    const caseItem = selectedCase;
    if (!caseItem || !inviteUrl) {
      setInviteShareStatus("Create invite link first.");
      return;
    }
    const message = buildInviteMessage(caseItem, inviteUrl);
    const email = inviteEmail.trim() || String(caseItem.leadEmail || "").trim();
    const phone = invitePhone.trim() || String(caseItem.leadPhone || "").trim();

    try {
      if (channel === "copy") {
        await navigator.clipboard.writeText(message);
        setInviteShareStatus("Invite message copied.");
        await logOutboundCommunication({
          channel: "copy",
          status: "sent",
          target: undefined,
          message
        });
        return;
      }
      if (channel === "email") {
        if (!email) {
          setInviteShareStatus("Enter client email first.");
          return;
        }
        const dispatchStatus = await tryServerDispatch("email", email, message);
        if (dispatchStatus === "sent") {
          setInviteShareStatus("Email sent from server.");
          return;
        }
        const subject = encodeURIComponent(`Newton Immigration Portal Link - ${caseItem.id}`);
        const body = encodeURIComponent(message);
        window.open(`mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`, "_blank");
        setInviteShareStatus(
          dispatchStatus === "provider_missing"
            ? "Email provider not configured yet. Email app opened instead."
            : "Email app opened."
        );
        await logOutboundCommunication({
          channel: "email",
          status: "opened_app",
          target: email,
          message
        });
        return;
      }
      if (channel === "whatsapp") {
        const waPhone = normalizePhoneForWa(phone);
        if (!waPhone) {
          setInviteShareStatus("Enter client phone number first.");
          return;
        }
        const dispatchStatus = await tryServerDispatch("whatsapp", waPhone, message);
        if (dispatchStatus === "sent") {
          setInviteShareStatus("WhatsApp sent from server.");
          return;
        }
        const text = encodeURIComponent(message);
        window.open(`https://wa.me/${waPhone}?text=${text}`, "_blank");
        setInviteShareStatus(
          dispatchStatus === "provider_missing"
            ? "WhatsApp provider not configured yet. WhatsApp app opened instead."
            : "WhatsApp opened."
        );
        await logOutboundCommunication({
          channel: "whatsapp",
          status: "opened_app",
          target: waPhone,
          message
        });
        return;
      }
      if (channel === "sms") {
        const smsPhone = phone.replace(/[^\d+]/g, "");
        if (!smsPhone) {
          setInviteShareStatus("Enter client phone number first.");
          return;
        }
        const dispatchStatus = await tryServerDispatch("sms", smsPhone, message);
        if (dispatchStatus === "sent") {
          setInviteShareStatus("SMS sent from server.");
          return;
        }
        const body = encodeURIComponent(message);
        window.open(`sms:${smsPhone}?body=${body}`, "_blank");
        setInviteShareStatus(
          dispatchStatus === "provider_missing"
            ? "SMS provider not configured yet. SMS app opened instead."
            : "SMS app opened."
        );
        await logOutboundCommunication({
          channel: "sms",
          status: "opened_app",
          target: smsPhone,
          message
        });
      }
    } catch {
      setInviteShareStatus("Could not open sharing app.");
      await logOutboundCommunication({
        channel,
        status: "failed",
        target: channel === "email" ? email : phone,
        message
      });
    }
  }

  function insertDefaultClientUpdateMessage() {
    if (!selectedCase) return;
    if (!inviteUrl) {
      setClientUpdateStatus("Create invite link first, then insert default message.");
      return;
    }
    setClientUpdateText(buildInviteMessage(selectedCase, inviteUrl));
    setClientUpdateStatus("Default update message inserted.");
  }

  function insertTemplateMessage(type: "invite" | "docs" | "payment" | "followup") {
    if (!selectedCase) return;
    if (type === "invite") {
      insertDefaultClientUpdateMessage();
      return;
    }
    if (type === "docs") {
      setClientUpdateText(buildDocsReminderMessage(selectedCase));
      setClientUpdateStatus("Document reminder template inserted.");
      return;
    }
    if (type === "payment") {
      setClientUpdateText(buildPaymentReminderMessage(selectedCase));
      setClientUpdateStatus("Payment reminder template inserted.");
      return;
    }
    setClientUpdateText(buildGeneralFollowupMessage(selectedCase));
    setClientUpdateStatus("Follow-up template inserted.");
  }

  async function sendClientUpdate(channel: "copy" | "email" | "whatsapp" | "sms") {
    const caseItem = selectedCase;
    if (!caseItem) return;
    const message = String(clientUpdateText || "").trim();
    if (!message) {
      setClientUpdateStatus("Write a message first (or click Insert Default Message).");
      return;
    }
    const email = inviteEmail.trim() || String(caseItem.leadEmail || "").trim();
    const phone = invitePhone.trim() || String(caseItem.leadPhone || "").trim();

    try {
      if (channel === "copy") {
        await navigator.clipboard.writeText(message);
        setClientUpdateStatus("Message copied.");
        await logOutboundCommunication({
          channel: "copy",
          status: "sent",
          target: undefined,
          message
        });
        return;
      }

      if (channel === "email") {
        if (!email) {
          setClientUpdateStatus("Client email is missing.");
          return;
        }
        const dispatchStatus = await tryServerDispatch("email", email, message);
        if (dispatchStatus === "sent") {
          setClientUpdateStatus("Email sent from server.");
          return;
        }
        const subject = encodeURIComponent(`Newton Immigration Update - ${caseItem.id}`);
        const body = encodeURIComponent(message);
        window.open(`mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`, "_blank");
        setClientUpdateStatus(
          dispatchStatus === "provider_missing"
            ? "Email provider not configured. Email app opened."
            : "Email app opened."
        );
        await logOutboundCommunication({
          channel: "email",
          status: "opened_app",
          target: email,
          message
        });
        return;
      }

      if (channel === "whatsapp") {
        const waPhone = normalizePhoneForWa(phone);
        if (!waPhone) {
          setClientUpdateStatus("Client phone is missing.");
          return;
        }
        const dispatchStatus = await tryServerDispatch("whatsapp", waPhone, message);
        if (dispatchStatus === "sent") {
          setClientUpdateStatus("WhatsApp sent from server.");
          return;
        }
        const text = encodeURIComponent(message);
        window.open(`https://wa.me/${waPhone}?text=${text}`, "_blank");
        setClientUpdateStatus(
          dispatchStatus === "provider_missing"
            ? "WhatsApp provider not configured. WhatsApp app opened."
            : "WhatsApp app opened."
        );
        await logOutboundCommunication({
          channel: "whatsapp",
          status: "opened_app",
          target: waPhone,
          message
        });
        return;
      }

      const smsPhone = phone.replace(/[^\d+]/g, "");
      if (!smsPhone) {
        setClientUpdateStatus("Client phone is missing.");
        return;
      }
      const dispatchStatus = await tryServerDispatch("sms", smsPhone, message);
      if (dispatchStatus === "sent") {
        setClientUpdateStatus("SMS sent from server.");
        return;
      }
      const body = encodeURIComponent(message);
      window.open(`sms:${smsPhone}?body=${body}`, "_blank");
      setClientUpdateStatus(
        dispatchStatus === "provider_missing"
          ? "SMS provider not configured. SMS app opened."
          : "SMS app opened."
      );
      await logOutboundCommunication({
        channel: "sms",
        status: "opened_app",
        target: smsPhone,
        message
      });
    } catch {
      setClientUpdateStatus("Could not send message.");
      await logOutboundCommunication({
        channel,
        status: "failed",
        target: channel === "email" ? email : phone,
        message
      });
    }
  }

  async function sendPaymentLinkForCase(caseInput?: CaseItem) {
    const caseItem = caseInput ?? selectedCase;
    if (!caseItem) return;
    setPaymentLinkStatus("Preparing payment link...");
    setInviteShareStatus("");

    const formTypeToUse = setupFormType.trim() || caseItem.formType;
    const amountRaw = Number(setupRetainerAmount || caseItem.servicePackage.retainerAmount || 0);
    const retainerAmountToUse = Number.isFinite(amountRaw) && amountRaw > 0
      ? amountRaw
      : caseItem.servicePackage.retainerAmount;
    const interacInstructionsToUse =
      setupInteracInstructions.trim() ||
      caseItem.interacInstructions ||
      "Please include your case number in transfer message and share payment screenshot.";

    const retainerRes = await apiFetch(`/cases/${caseItem.id}/retainer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formType: formTypeToUse,
        retainerAmount: retainerAmountToUse,
        paymentMethod: "interac",
        interacRecipient: fixedInteracRecipient,
        interacInstructions: interacInstructionsToUse,
        sendRetainer: true,
        paymentStatus: "pending"
      })
    });
    const retainerPayload = await retainerRes.json().catch(() => ({}));
    if (!retainerRes.ok) {
      setPaymentLinkStatus(String(retainerPayload.error || "Could not prepare retainer/payment settings."));
      return;
    }
    const updatedCase = retainerPayload.case as CaseItem;
    setCases((prev) => prev.map((c) => (c.id === updatedCase.id ? updatedCase : c)));

    const inviteRes = await apiFetch(`/cases/${caseItem.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim() || undefined })
    });
    const invitePayload = await inviteRes.json().catch(() => ({}));
    if (!inviteRes.ok) {
      setPaymentLinkStatus(String(invitePayload.error || "Retainer prepared, but could not create invite link."));
      return;
    }

    const url = clientAccessLinkFromPayload(invitePayload);
    setInviteUrl(url);
    setInviteStatus("Invite link generated.");

    let driveNote = "";
    const driveRes = await apiFetch(`/cases/${caseItem.id}/drive-folder`, { method: "POST" });
    const drivePayload = await driveRes.json().catch(() => ({}));
    if (!driveRes.ok) {
      driveNote = ` Drive folder not created: ${String(drivePayload.error || "unknown error")}`;
    } else if (drivePayload.case) {
      const next = drivePayload.case as CaseItem;
      setCases((prev) => prev.map((c) => (c.id === next.id ? next : c)));
    }

    setPaymentLinkStatus(`Payment link sent flow ready.${driveNote}`);
    await loadCaseDetail(caseItem.id);
    await refreshTasks(caseItem.id);
  }

  function getCaseNextAction(caseItem: CaseItem): {
    label: string;
    hint: string;
    type: "documents" | "tasks" | "communication" | "open";
  } {
    if ((caseItem.paymentStatus || "pending") === "pending") {
      return { label: "Pending Payment", hint: "Handle in Communications", type: "communication" };
    }
    if ((caseItem.aiStatus || "idle") === "waiting_client") {
      return { label: "Collect Missing Docs", hint: "Waiting on client", type: "documents" };
    }
    if ((caseItem.aiStatus || "idle") === "drafting" || (caseItem.caseStatus || "lead") === "under_review") {
      return { label: "Review Tasks", hint: "Under review flow", type: "tasks" };
    }
    if ((caseItem.caseStatus || "lead") === "ready") {
      return { label: "Open Communication", hint: "Ready for final update", type: "communication" };
    }
    return { label: "Open Case", hint: "Continue processing", type: "open" };
  }

  async function runCaseNextAction(caseItem: CaseItem) {
    setSelectedCaseId(caseItem.id);
    setScreen("cases");
    const action = getCaseNextAction(caseItem);

    if (action.type === "documents") {
      setCaseDetailTab("documents");
      await loadCaseDetail(caseItem.id);
      return;
    }
    if (action.type === "tasks") {
      setCaseDetailTab("tasks");
      await loadCaseDetail(caseItem.id);
      return;
    }
    if (action.type === "communication") {
      setCaseDetailTab("communication");
      await loadCaseDetail(caseItem.id);
      return;
    }

    setCaseDetailTab("overview");
    await loadCaseDetail(caseItem.id);
  }

  async function updateCaseProcessing(
    caseId: string,
    patch: Partial<
      Pick<
        CaseItem,
        | "assignedTo"
        | "processingStatus"
        | "processingStatusOther"
        | "paymentMethod"
        | "applicationNumber"
        | "submittedAt"
        | "finalOutcome"
        | "decisionDate"
        | "remarks"
      >
    >
  ) {
    setCaseActionStatus("Saving case updates...");
    const res = await apiFetch(`/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCaseActionStatus(String(payload.error || "Could not save case updates."));
      return;
    }
    const updated = payload.case as CaseItem;
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setCaseActionStatus(`Updated ${updated.id}.`);
  }

  async function confirmCaseSubmission() {
    const appNo = submitModalAppNo.trim();
    if (!appNo) { setSubmitModalStatus("IRCC application number is required."); return; }
    const caseId = submitModalCaseId;
    if (!caseId) return;
    setSubmitModalSaving(true);
    setSubmitModalStatus("Saving...");
    try {
      // Save app number + mark submitted
      const res = await apiFetch(`/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processingStatus: "submitted",
          applicationNumber: appNo,
          submittedAt: new Date().toISOString(),
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) { setSubmitModalStatus(String(payload.error || "Could not save.")); return; }
      const updated = payload.case as CaseItem;
      setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

      // Send WhatsApp confirmation to client
      const phone = submitModalPhone.trim() || updated.leadPhone || "";
      const waPhone = normalizePhoneForWa(phone);
      if (waPhone) {
        const msg = `Hi ${updated.client.split(" ")[0]}! 🎉 Great news — your ${updated.formType} application has been submitted to IRCC.

Application Number: ${appNo}

We will notify you as soon as we receive a decision. This usually takes a few weeks. Feel free to message us if you have any questions.

— Newton Immigration Team`;
        await tryServerDispatchForCase(caseId, "whatsapp", waPhone, msg);
      }

      setSubmitModalStatus("✓ Submitted! Client notified on WhatsApp.");
      setTimeout(() => {
        setShowSubmitModal(false);
        setSubmitModalAppNo("");
        setSubmitModalPhone("");
        setSubmitModalStatus("");
        setSubmitModalCaseId("");
        setSelectedCaseId(null);
      }, 1800);
    } finally {
      setSubmitModalSaving(false);
    }
  }

  async function sendRetainerToClient() {
    if (!selectedCase) return;
    if (!retainerConfirm) {
      setSetupStatus("Please confirm application type and amount before sending.");
      return;
    }
    if (!setupFormType.trim() || !Number(setupRetainerAmount || 0)) {
      setSetupStatus("Application type and retainer amount are required.");
      return;
    }

    setSetupStatus("Sending retainer...");
    const res = await apiFetch(`/cases/${selectedCase.id}/retainer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formType: setupFormType.trim() || selectedCase.formType,
        retainerAmount: Number(setupRetainerAmount || 0),
        paymentMethod: "interac",
        interacRecipient: fixedInteracRecipient,
        interacInstructions: setupInteracInstructions.trim(),
        sendRetainer: true,
        paymentStatus: "pending"
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSetupStatus(String(payload.error || "Could not send retainer"));
      return;
    }
    const updated = payload.case as CaseItem;
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    const inviteRes = await apiFetch(`/cases/${selectedCase.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim() || undefined })
    });
    const invitePayload = await inviteRes.json().catch(() => ({}));
    const generatedInviteUrl = clientAccessLinkFromPayload(invitePayload);
    if (inviteRes.ok && generatedInviteUrl) {
      setInviteUrl(generatedInviteUrl);
      setInviteStatus("Client link created.");
      setSetupStatus("Retainer + client link created. Send link to client.");
      const amount = Number(setupRetainerAmount || updated.servicePackage.retainerAmount || 0);
      const appType = setupFormType || updated.formType;
      const lines = [
        `Hi ${updated.client},`,
        "",
        `Newton Immigration has opened your file for ${appType}.`,
        `Case: ${updated.id}`,
        "",
        "Step 1: Complete retainer and create your portal account:",
        generatedInviteUrl,
        "",
        `Step 2: Send Interac payment of $${amount} CAD to ${fixedInteracRecipient}`,
        `Reference message: ${updated.id}`,
        setupInteracInstructions.trim() || "Please include your case number in transfer message.",
        "",
        "After payment, reply with confirmation screenshot.",
        "",
        "Newton Immigration Team"
      ];
      setClientMessageTemplate(lines.join("\n"));
      setClientMessageStatus("Client message template generated from this invite.");
      return;
    }
    setSetupStatus("Retainer sent, but client link generation failed.");
  }

  async function confirmInteracReceived() {
    if (!selectedCase) return;
    await confirmInteracReceivedForCase(selectedCase.id, "overview");
  }

  async function confirmInteracReceivedForCase(caseId: string, source: "overview" | "communications") {
    if (source === "communications") setCommPaymentStatus("Confirming payment...");
    else setSetupStatus("Confirming payment...");
    const res = await apiFetch(`/cases/${caseId}/retainer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentStatus: "paid" })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = String(payload.error || "Could not confirm payment");
      if (source === "communications") setCommPaymentStatus(message);
      else setSetupStatus(message);
      return;
    }
    const updated = payload.case as CaseItem;
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    if (source === "communications") setCommPaymentStatus(`Payment confirmed for ${updated.id}.`);
    else setSetupStatus("Interac payment confirmed.");
  }

  async function recordAccountingPayment(caseId: string) {
    const raw = String(accountingAmount[caseId] || "").trim();
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const amount = Number(cleaned || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      setAccountingStatus("Enter a valid paid amount.");
      return;
    }
    setAccountingStatus("Recording received amount...");
    const res = await apiFetch(`/cases/${caseId}/financials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "record_payment", amount })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAccountingStatus(String(payload.error || "Could not record payment."));
      return;
    }
    let updated = payload.case as CaseItem;
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setAccountingAmount((prev) => ({ ...prev, [caseId]: "" }));
    const total = Number(updated.servicePackage?.retainerAmount || updated.totalCharges || 0);
    const paid = Number((updated as CaseItem & { amountPaid?: number }).amountPaid || 0);
    const remaining = Math.max(0, total - paid);

    if (remaining > 0) {
      setAccountingStatus(
        `Amount recorded for ${updated.id}. Remaining $${remaining}. Payment stays pending until full amount is received.`
      );
      return;
    }

    setAccountingStatus("Amount recorded. Confirming full payment...");
    const confirmRes = await apiFetch(`/cases/${caseId}/retainer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentStatus: "paid" })
    });
    const confirmPayload = await confirmRes.json().catch(() => ({}));
    if (!confirmRes.ok) {
      setAccountingStatus(
        `Amount recorded for ${updated.id}, but could not mark paid: ${String(
          confirmPayload.error || "unknown error"
        )}`
      );
      return;
    }
    updated = confirmPayload.case as CaseItem;
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setAccountingStatus(`Payment confirmed for ${updated.id}.`);
  }

  async function createDriveFolderForCase() {
    if (!selectedCase) return;
    setSetupStatus("Creating Drive case folder...");
    const res = await apiFetch(`/cases/${selectedCase.id}/drive-folder`, { method: "POST" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSetupStatus(String(payload.error || "Could not create Drive folder"));
      return;
    }
    const updated = payload.case as CaseItem;
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setSetupStatus("Drive case folder created and linked.");
  }

  async function saveBranding() {
    setBrandStatus("Saving branding...");
    const res = await apiFetch("/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appName: brandAppName.trim(),
        logoText: brandLogoText.trim(),
        logoUrl: brandLogoUrl.trim(),
        driveRootLink: brandDriveRootLink.trim(),
        customPortalSections: brandCustomSections
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBrandStatus(String(payload.error || "Could not save branding"));
      return;
    }
    const nextCompany = payload.company as Company;
    setCompany(nextCompany);
    setBrandCustomSections(
      Array.isArray(nextCompany?.branding?.customPortalSections)
        ? (nextCompany.branding.customPortalSections as CustomPortalSection[])
        : []
    );
    setBrandCustomSectionHistory(
      Array.isArray(nextCompany?.branding?.customPortalSectionHistory)
        ? (nextCompany.branding.customPortalSectionHistory as CustomPortalSectionVersion[])
        : []
    );
    setBrandStatus("Branding updated.");
  }

  function addCustomPortalSection() {
    const title = newCustomSectionTitle.trim();
    const body = newCustomSectionBody.trim();
    if (!title || !body) {
      setBrandStatus("Custom section title and body are required.");
      return;
    }
    const options = newCustomSectionOptions
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const visibleFor = newCustomSectionVisibleFor === "all" ? ["all"] : [newCustomSectionVisibleFor];
    setBrandCustomSections((prev) => [
      ...prev,
      {
        id: `section_${Date.now()}`,
        title,
        body,
        fieldType: newCustomSectionFieldType || "text",
        options,
        visibleFor,
        sortOrder: prev.length + 1,
        enabled: true
      }
    ]);
    setNewCustomSectionTitle("");
    setNewCustomSectionBody("");
    setNewCustomSectionFieldType("text");
    setNewCustomSectionOptions("");
    setNewCustomSectionVisibleFor("all");
    setBrandStatus("Custom section added. Click Save Branding to publish.");
  }

  function updateCustomPortalSection(index: number, patch: Partial<CustomPortalSection>) {
    setBrandCustomSections((prev) =>
      prev.map((section, i) => (i === index ? { ...section, ...patch } : section))
    );
  }

  function removeCustomPortalSection(index: number) {
    setBrandCustomSections((prev) => prev.filter((_, i) => i !== index));
    setBrandStatus("Custom section removed. Click Save Branding to publish.");
  }

  function moveCustomPortalSection(index: number, direction: -1 | 1) {
    setBrandCustomSections((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const current = next[index];
      next[index] = next[target];
      next[target] = current;
      return next.map((section, i) => ({ ...section, sortOrder: i + 1 }));
    });
    setBrandStatus("Section order updated. Click Save Branding to publish.");
  }

  async function rollbackCustomPortalSections(versionId: string) {
    if (!versionId) return;
    setBrandStatus("Restoring portal version...");
    const res = await apiFetch("/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rollbackPortalVersionId: versionId })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBrandStatus(String(payload.error || "Could not rollback portal version."));
      return;
    }
    const nextCompany = payload.company as Company;
    setCompany(nextCompany);
    setBrandCustomSections(
      Array.isArray(nextCompany?.branding?.customPortalSections)
        ? (nextCompany.branding.customPortalSections as CustomPortalSection[])
        : []
    );
    setBrandCustomSectionHistory(
      Array.isArray(nextCompany?.branding?.customPortalSectionHistory)
        ? (nextCompany.branding.customPortalSectionHistory as CustomPortalSectionVersion[])
        : []
    );
    setBrandStatus("Portal sections restored.");
  }

  async function addTeamMember() {
    if (!teamName.trim() || !teamEmail.trim() || !teamPassword.trim()) {
      setTeamStatus("Name, email and temporary password are required.");
      return;
    }
    setTeamStatus("Adding team member...");
    const res = await apiFetch("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: teamName.trim(),
        email: teamEmail.trim(),
        role: teamRole,
        password: teamPassword.trim(),
        workspaceDriveLink: teamDriveLink.trim()
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTeamStatus(String(payload.error || "Could not add team member."));
      return;
    }
    setTeamStatus(`Team member added: ${String(payload?.user?.name || teamName.trim())}`);
    setTeamName("");
    setTeamEmail("");
    setTeamPassword("");
    setTeamDriveLink("");
    const usersRes = await apiFetch("/users", { cache: "no-store" });
    if (usersRes.ok) {
      const usersPayload = await usersRes.json().catch(() => ({}));
      setTeamUsers((usersPayload.users || []) as TeamUserItem[]);
    }
  }

  async function syncNewtonTeamPreset() {
    setTeamStatus("Syncing Newton team users...");
    const res = await apiFetch("/users/sync-newton", { method: "POST" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTeamStatus(String(payload.error || "Could not sync team preset."));
      return;
    }
    setTeamStatus(`Team preset synced. Created ${Number(payload.created || 0)}, updated ${Number(payload.updated || 0)}.`);
    const usersRes = await apiFetch("/users", { cache: "no-store" });
    if (usersRes.ok) {
      const usersPayload = await usersRes.json().catch(() => ({}));
      setTeamUsers((usersPayload.users || []) as TeamUserItem[]);
    }
  }

  async function setTeamMemberActive(userId: string, active: boolean) {
    setTeamStatus(active ? "Reactivating team member..." : "Deactivating team member...");
    const res = await apiFetch(`/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTeamStatus(String(payload.error || "Could not update member status."));
      return;
    }
    const updated = payload.user as TeamUserItem;
    setTeamUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, active: updated.active } : u)));
    setTeamStatus(`${updated.name} is now ${updated.active === false ? "inactive" : "active"}.`);
  }

  async function resetTeamMemberPassword(userId: string) {
    const nextPassword = String(teamPasswordDrafts[userId] || "").trim();
    if (!nextPassword) {
      setTeamStatus("Enter a new password before reset.");
      return;
    }
    setTeamStatus("Resetting password...");
    const res = await apiFetch(`/users/${userId}/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: nextPassword })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTeamStatus(String(payload.error || "Could not reset password."));
      return;
    }
    setTeamPasswordDrafts((prev) => ({ ...prev, [userId]: "" }));
    setTeamStatus("Password reset complete.");
  }

  async function resetTeamMemberMfa(userId: string) {
    setTeamStatus("Resetting MFA...");
    const res = await apiFetch(`/users/${userId}/mfa/reset`, {
      method: "POST"
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTeamStatus(String(payload.error || "Could not reset MFA."));
      return;
    }
    const updated = payload.user as TeamUserItem;
    setTeamUsers((prev) =>
      prev.map((u) =>
        u.id === updated.id
          ? {
              ...u,
              active: updated.active,
              mfaEnabled: updated.mfaEnabled
            }
          : u
      )
    );
    setTeamStatus(`MFA reset complete for ${updated.name}.`);
  }

  async function loadStaffProfile(userId: string) {
    setStaffProfileUserId(userId);
    setStaffNoteStatus("");
    try {
      const res = await apiFetch(`/users/${userId}/notes`);
      if (res.ok) {
        const payload = await res.json().catch(() => ({}));
        const fetched = (payload.notes || []).slice().reverse();
        setStaffProfileNotes(fetched);
        setStaffNoteCounts((prev) => ({ ...prev, [userId]: fetched.length }));
      }
    } catch {
      setStaffProfileNotes([]);
    }
  }

  async function postStaffNote() {
    if (!staffProfileUserId) return;
    const text = (staffNoteDrafts[staffProfileUserId] || "").trim();
    if (!text) return;
    setStaffNoteStatus("Saving...");
    const res = await apiFetch(`/users/${staffProfileUserId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStaffNoteStatus(String(payload.error || "Could not save note."));
      return;
    }
    const updated = (payload.notes || []).slice().reverse();
    setStaffProfileNotes(updated);
    setStaffNoteCounts((prev) => ({ ...prev, [staffProfileUserId!]: updated.length }));
    setStaffNoteDrafts((prev) => ({ ...prev, [staffProfileUserId!]: "" }));
    setStaffNoteStatus("saved");
    setTimeout(() => setStaffNoteStatus(""), 2500);
  }

  async function deleteStaffProfileNote(noteId: string) {
    if (!staffProfileUserId) return;
    const res = await apiFetch(`/users/${staffProfileUserId}/notes?noteId=${encodeURIComponent(noteId)}`, {
      method: "DELETE",
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) {
      const updated = (payload.notes || []).slice().reverse();
      setStaffProfileNotes(updated);
      setStaffNoteCounts((prev) => ({ ...prev, [staffProfileUserId!]: updated.length }));
    }
  }

  function buildPaymentEmailTemplate() {
    if (!selectedCase || !company) return;
    const recipient = setupInteracRecipient.trim() || "your Interac autodeposit email";
    const amount = Number(setupRetainerAmount || selectedCase.servicePackage.retainerAmount || 0);
    const subject = `[${selectedCase.id}] Interac Payment Instructions - ${company.name}`;
    const body = [
      `Hi ${selectedCase.client},`,
      "",
      `Thank you for proceeding with your ${setupFormType || selectedCase.formType} application.`,
      "",
      `Please send your Interac e-Transfer payment of $${amount} CAD to: ${recipient}`,
      `Reference/Message: ${selectedCase.id}`,
      "",
      setupInteracInstructions.trim() || "Use your case number in the message and share payment confirmation.",
      "",
      `After payment, reply with confirmation so our team can update your file.`,
      "",
      `${company.name} Team`
    ].join("\n");
    setPaymentEmailTemplate(`Subject: ${subject}\n\n${body}`);
    setPaymentEmailStatus("Email template generated.");
  }

  async function copyPaymentEmailTemplate() {
    if (!paymentEmailTemplate.trim()) {
      setPaymentEmailStatus("Generate template first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(paymentEmailTemplate);
      setPaymentEmailStatus("Template copied.");
    } catch {
      setPaymentEmailStatus("Could not copy automatically. Select text and copy manually.");
    }
  }

  function buildClientInviteMessageTemplate() {
    if (!selectedCase || !company) return;
    const amount = Number(setupRetainerAmount || selectedCase.servicePackage.retainerAmount || 0);
    const appType = setupFormType || selectedCase.formType;
    const portalLink = inviteUrl || "(create invite link first)";
    const lines = [
      `Hi ${selectedCase.client},`,
      "",
      `Newton Immigration has opened your file for ${appType}.`,
      `Case: ${selectedCase.id}`,
      "",
      "Step 1: Complete retainer and create your portal account:",
      portalLink,
      "",
      `Step 2: Send Interac payment of $${amount} CAD to ${fixedInteracRecipient}`,
      `Reference message: ${selectedCase.id}`,
      setupInteracInstructions.trim() || "Please include your case number in transfer message.",
      "",
      "After payment, reply with confirmation screenshot.",
      "",
      "Newton Immigration Team"
    ];
    setClientMessageTemplate(lines.join("\n"));
    setClientMessageStatus("Client message template generated.");
  }

  async function copyClientMessageTemplate() {
    if (!clientMessageTemplate.trim()) {
      setClientMessageStatus("Generate template first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(clientMessageTemplate);
      setClientMessageStatus("Client message copied.");
    } catch {
      setClientMessageStatus("Could not copy automatically. Copy manually.");
    }
  }

  function downloadRetainer(caseItem: CaseItem, companyName: string) {
    const content = [
      `${companyName} - Service Agreement`,
      "",
      `Application Type: ${caseItem.formType}`,
      `Retainer Amount: $${caseItem.servicePackage.retainerAmount} CAD`,
      `Case ID: ${caseItem.id}`,
      "",
      "By signing, client confirms they have read and agreed to the retainer terms.",
      "",
      "Client Name: _______________________________",
      "Signature/Initials: _________________________",
      "Date: ______________________________________"
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${caseItem.id}_Retainer.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  async function generateAiDraftForCase() {
    if (!selectedCase) return;
    setAiDraftStatus("Generating AI draft...");
    const res = await apiFetch(`/cases/${selectedCase.id}/ai-draft`, { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAiDraftStatus(String(payload.error || "Could not generate AI draft"));
      return;
    }
    setAiDraft(payload.draft as PgwpDraft);
    setAiDraftStatus("AI draft generated.");
  }

  async function runAiIntakeCheck(createTasks = true) {
    if (!selectedCase) return;
    setIntakeCheckStatus("Running AI intake check...");
    const res = await apiFetch(`/cases/${selectedCase.id}/intake-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createTasks, maxTasks: 10 })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setIntakeCheckStatus(String(payload.error || "Could not run AI intake check."));
      return;
    }
    setIntakeCheckSummary((payload.check || null) as IntakeCheckSummary | null);
    const createdTasks = Number(payload.createdTasks || 0);
    if (createTasks) {
      setIntakeCheckStatus(
        `AI intake check complete. ${createdTasks} new missing-item task(s) created.`
      );
      await refreshTasks(selectedCase.id);
    } else {
      setIntakeCheckStatus("AI intake check complete.");
    }
  }

  async function generateReadyPackageForCase() {
    if (!selectedCase) return;
    setReadyPackageStatus("Generating ready package...");
    setReadyPackagePath("");
    const res = await apiFetch(`/cases/${selectedCase.id}/ready-package`, { method: "POST" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setReadyPackageStatus(String(payload.error || "Could not generate ready package"));
      return;
    }
    setReadyPackageStatus("Ready package generated.");
    setReadyPackagePath(String(payload.filePath || ""));
  }

  async function runImm5710AutomationForCase() {
    if (!selectedCase) return;
    setImmRunStatus("Preparing ready package...");
    const prepRes = await apiFetch(`/cases/${selectedCase.id}/ready-package`, { method: "POST" });
    const prepPayload = await prepRes.json().catch(() => ({}));
    if (!prepRes.ok) {
      setImmRunStatus(String(prepPayload.error || "Could not prepare ready package"));
      return;
    }
    const filePath = String(prepPayload.filePath || "");
    setReadyPackagePath(filePath);
    setReadyPackageStatus("Ready package generated.");

    setImmRunStatus("Starting IMM5710 automation...");
    const runRes = await apiFetch(`/cases/${selectedCase.id}/run-imm5710`, { method: "POST" });
    const runPayload = await runRes.json().catch(() => ({}));
    if (!runRes.ok) {
      setImmRunStatus(String(runPayload.error || "Could not start IMM5710 automation"));
      return;
    }
    setImmRunStatus(
      `IMM5710 automation started (PID ${String(runPayload.pid || "N/A")}). Check Acrobat and log: ${String(runPayload.logPath || "")}`
    );
  }

  function updateInternalIntakeField(field: keyof InternalExtractionIntake, value: string) {
    setInternalIntake((prev) => ({ ...prev, [field]: value }));
  }

  async function saveInternalExtraction() {
    if (!selectedCase) return;
    setInternalIntakeStatus("Saving extraction fields...");
    const res = await apiFetch(`/cases/${selectedCase.id}/intake`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(internalIntake)
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setInternalIntakeStatus(String(payload.error || "Could not save extraction fields"));
      return;
    }
    setInternalIntakeStatus("Internal extraction fields saved.");
  }

  async function createCaseTask() {
    if (!selectedCase) return;
    if (!newTaskTitle.trim()) {
      setTaskActionStatus("Task title is required.");
      return;
    }
    setTaskActionStatus("Creating task...");
    const res = await apiFetch("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: selectedCase.id,
        title: newTaskTitle.trim(),
        description: newTaskDescription.trim(),
        priority: newTaskPriority,
        assignedTo: newTaskAssignedTo.trim() || selectedCase.assignedTo || sessionUser?.name || "Unassigned",
        dueDate: newTaskDueDate || undefined
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTaskActionStatus(String(payload.error || "Could not create task"));
      return;
    }
    setNewTaskTitle("");
    setNewTaskDescription("");
    setNewTaskPriority("medium");
    setNewTaskDueDate("");
    setTaskActionStatus("Task created.");
    await refreshTasks(selectedCase.id);
  }

  async function createTeamTask() {
    if (!teamTaskTitle.trim()) {
      setTaskActionStatus("Task title is required.");
      return;
    }
    setTaskActionStatus("Creating team task...");
    const targetCase = visibleCases.find((c) => c.id === teamTaskCaseId) || selectedCase;
    const res = await apiFetch("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: teamTaskCaseId.trim() || undefined,
        title: teamTaskTitle.trim(),
        description: teamTaskDescription.trim(),
        priority: teamTaskPriority,
        assignedTo: teamTaskAssignedTo.trim() || targetCase?.assignedTo || sessionUser?.name || "Unassigned",
        dueDate: teamTaskDueDate || undefined
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTaskActionStatus(String(payload.error || "Could not create task"));
      return;
    }
    setTeamTaskTitle("");
    setTeamTaskDescription("");
    setTeamTaskPriority("medium");
    setTeamTaskDueDate("");
    setTeamTaskCaseId("");
    setTaskActionStatus("Team task created.");
    await refreshTasks();
  }

  async function markTaskCompleted(taskId: string) {
    const res = await apiFetch(`/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTaskActionStatus(String(payload.error || "Could not update task"));
      return;
    }
    setTaskActionStatus("Task marked completed.");
    await refreshTasks();
  }

  async function signRetainer(caseId: string) {
    const res = await apiFetch(`/cases/${caseId}/retainer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signerName: sessionUser?.name || "Client",
        signatureType: "typed",
        signatureValue: "I AGREE",
        acceptedTerms: true
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setRetainerStatus(String(payload.error || "Could not sign retainer"));
      return;
    }
    const updated = payload.case as CaseItem;
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setRetainerStatus("Retainer signed successfully.");
    setClientScreen("questions");
  }

  async function uploadClientDocument(caseId: string) {
    if (!clientUploadFile) {
      setClientUploadStatus("Choose a file first.");
      return;
    }
    setClientUploadStatus("Uploading...");
    const data = new FormData();
    data.append("file", clientUploadFile);
    data.append("name", clientUploadFile.name);

    const res = await apiFetch(`/cases/${caseId}/documents`, {
      method: "POST",
      body: data
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setClientUploadStatus(String(payload.error || "Upload failed"));
      return;
    }
    setDocuments((prev) => [...prev, payload.document as DocumentItem]);
    setClientUploadFile(null);
    if (payload?.driveUpload?.success) {
      setClientUploadStatus("Upload complete (saved to Google Drive).");
    } else {
      setClientUploadStatus("Upload complete (saved locally). Ask team to check Google Drive integration.");
    }
  }

  function isChecklistDocUploaded(item: RequiredDocItem): boolean {
    const names = documents.map((d) => d.name.toLowerCase());
    const keywords = (item.keywords && item.keywords.length > 0 ? item.keywords : [item.label]).map((k) =>
      String(k || "").toLowerCase()
    );
    return keywords.some((keyword) => names.some((n) => n.includes(keyword)));
  }

  async function uploadChecklistDocument(caseId: string, item: RequiredDocItem) {
    const file = checklistFiles[item.key];
    if (!file) {
      setChecklistStatus((prev) => ({ ...prev, [item.key]: "Choose a file first." }));
      return;
    }
    setChecklistStatus((prev) => ({ ...prev, [item.key]: "Uploading..." }));
    const data = new FormData();
    data.append("file", file);
    data.append("name", item.label);

    const res = await apiFetch(`/cases/${caseId}/documents`, {
      method: "POST",
      body: data
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setChecklistStatus((prev) => ({ ...prev, [item.key]: String(payload.error || "Upload failed") }));
      return;
    }
    setDocuments((prev) => [...prev, payload.document as DocumentItem]);
    setChecklistFiles((prev) => ({ ...prev, [item.key]: null }));
    const uploadedToDrive = Boolean(payload?.driveUpload?.success);
    setChecklistStatus((prev) => ({
      ...prev,
      [item.key]: uploadedToDrive ? "Uploaded to Google Drive." : "Uploaded locally (Drive not linked)."
    }));
  }

  async function createStaffDocRequest() {
    if (!selectedCase) return;
    const title = staffDocRequestTitle.trim();
    const details = staffDocRequestDetails.trim();
    if (!title) {
      setStaffDocRequestStatus("Request title is required.");
      return;
    }
    setStaffDocRequestStatus("Sending request...");
    const res = await apiFetch(`/cases/${selectedCase.id}/doc-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, details })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStaffDocRequestStatus(String(payload.error || "Could not create doc request."));
      return;
    }
    const updated = payload.case as CaseItem;
    setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setDocRequests((payload.requests || []) as DocRequestItem[]);
    setStaffDocRequestTitle("");
    setStaffDocRequestDetails("");
    setStaffDocRequestStatus("Request sent to client.");
  }

  async function uploadRequestedDocument(caseId: string, request: DocRequestItem) {
    const file = requestedUploadFiles[request.id];
    if (!file) {
      setRequestedUploadStatus((prev) => ({ ...prev, [request.id]: "Choose a file first." }));
      return;
    }
    setRequestedUploadStatus((prev) => ({ ...prev, [request.id]: "Uploading..." }));
    const data = new FormData();
    data.append("file", file);
    data.append("name", `Requested - ${request.title}`);
    data.append("requestId", request.id);

    const res = await apiFetch(`/cases/${caseId}/documents`, {
      method: "POST",
      body: data
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setRequestedUploadStatus((prev) => ({ ...prev, [request.id]: String(payload.error || "Upload failed") }));
      return;
    }
    setDocuments((prev) => [...prev, payload.document as DocumentItem]);
    setRequestedUploadFiles((prev) => ({ ...prev, [request.id]: null }));
    setRequestedUploadStatus((prev) => ({ ...prev, [request.id]: "Uploaded." }));
    const reqRes = await apiFetch(`/cases/${caseId}/doc-requests`, { cache: "no-store" });
    if (reqRes.ok) {
      const reqPayload = await reqRes.json().catch(() => ({}));
      setDocRequests((reqPayload.requests || []) as DocRequestItem[]);
    }
  }

  async function copyInteracDetails(caseItem: CaseItem) {
    const amount = Number(caseItem.servicePackage.retainerAmount || 0);
    const text = [
      `Interac recipient: ${fixedInteracRecipient}`,
      `Amount: $${amount} CAD`,
      `Reference message: ${caseItem.id}`,
      normalizeInteracInstructions(caseItem.interacInstructions)
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setInteracCopyStatus("Payment details copied.");
    } catch {
      setInteracCopyStatus("Could not copy automatically. Please copy manually.");
    }
  }

  const caseCounts = useMemo(
    () => ({
      all: visibleCases.length,
      lead: visibleCases.filter((c) => (c.caseStatus || "lead") === "lead").length,
      active: visibleCases.filter((c) => (c.caseStatus || "lead") === "active").length,
      under_review: visibleCases.filter((c) => (c.caseStatus || "lead") === "under_review").length,
      ready: visibleCases.filter((c) => (c.caseStatus || "lead") === "ready").length,
      submitted: visibleCases.filter((c) => (c.caseStatus || "lead") === "submitted").length
    }),
    [visibleCases]
  );

  const headerProps = company
    ? {
        appName: company.branding.appName,
        logoText: company.branding.logoText,
        logoUrl: company.branding.logoUrl,
        subtitle: `${company.name} workflow: lead to decision in one simple workspace.`,
        primary: company.branding.primary,
        secondary: company.branding.secondary,
        success: company.branding.success,
        text: company.branding.background
      }
    : { subtitle: "Company workflow: lead to decision in one simple workspace." };

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-4xl items-center justify-center px-4 py-8">
        <div className="inline-flex items-center gap-2 rounded-full border-2 border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">
          <Loader2 size={16} className="animate-spin" /> Loading dashboard...
        </div>
      </main>
    );
  }

  if (!sessionUser) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
        <Header {...headerProps} />
        <LoginView onLoginSuccess={loadSession} />
      </main>
    );
  }

  if (expectedSlug && company && company.slug !== expectedSlug) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 md:px-6 md:py-8">
        <Header {...headerProps} />
        <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-900">
          You are signed into "{company.slug}". Open "/portal/{company.slug}".
        </section>
      </main>
    );
  }

  // Client portal view
  if (sessionUser.userType === "client") {
    if (!clientPortalAccess) {
      return (
        <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 md:px-6 md:py-8">
          <Header {...headerProps} />
          <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
            <h2 className="text-lg font-semibold text-amber-900">Open Client Portal from Secure Link</h2>
            <p className="mt-1 text-sm text-amber-900">Please open the secure client invite link sent by Newton Immigration.</p>
            <button onClick={() => void logout()} className="mt-3 rounded-lg border border-amber-700 bg-white px-3 py-2 text-sm font-semibold text-amber-900">Sign Out</button>
          </section>
        </main>
      );
    }
    return (
      <ClientPortal
        c={cases[0]}
        sessionUser={sessionUser}
        clientPortalAccess={clientPortalAccess}
        clientQStep={clientQStep}
        setClientQStep={setClientQStep}
        clientScreen={clientScreen}
        setClientScreen={setClientScreen}
        retainerConfirm={retainerConfirm}
        setRetainerConfirm={setRetainerConfirm}
        retainerStatus={retainerStatus}
        setRetainerStatus={setRetainerStatus}
        cases={cases}
        setCases={setCases}
        documents={documents}
        setDocuments={setDocuments}
        apiFetch={apiFetch}
        logout={logout}
        headerProps={headerProps}
        isChecklistDocUploaded={isChecklistDocUploaded}
        caseChecklist={cases[0] ? getChecklistForFormType(cases[0].formType) : []}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-0 h-14">
          {/* Brand - Newton Immigration Logo */}
          <div className="flex items-center gap-2.5">
            <img src="data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAC+APoDASIAAhEBAxEB/8QAHAABAAIDAQEBAAAAAAAAAAAAAAYHBAUIAwIB/8QAThAAAQMEAAQDBAQHDAYLAAAAAQACAwQFBhEHEiExCBNBIlFhcRQygZEVN0J0obGyFhcjMzZSYnJzdbPRJDQ4gsLDNVVXdoOSk5SitMH/xAAbAQEAAgMBAQAAAAAAAAAAAAAAAQMCBAUGB//EADURAAICAQIEAwUHAwUAAAAAAAABAgMRBDEFEiFBE1FxM2FygbEGFBUykaGyIjRCFjVi0eH/2gAMAwEAAhEDEQA/AOy0REAREQBERAEREAREQBERAEREAREJA7oAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiqTjPxvsuCyPs1rhF4yJ2mtpWE8kLj28wjrv+iOp+CAttUt4g81vFmmoLbbHQtpqlsdXFVMJLiWPJ5fcRsNKhlLZuN2WWW4ZFkpqYByMdQ21hETm9due1g6hwA0AepDj7tGvshyJlottBS5M+prTAHMpLeH8kkMbj7bySPZ7ey09z8O+hqp2SfhQXV9z1/2e0miph+I6qacYvDju9ujXXr1922Trvh9fqnIMWoLpcI4KeprGOlbDGfyAdbG+p9PvCkS5Ax+O/ZPd7PTWmpqLtRGMR0pY8xt+jhwL2O19TW9OB3o679Fvq7N+L3B6+SNyyklyHGHVBbHUuaN8hPTle3fIdfku6eit0t0rE1JYwaHHuGU6OcLKbFJWZaS7LPTvn9UtmdQoo3w9zbH87sTbvj9WJowQ2WJ3SSF3817fQ/oPopIto8+EREAREQBERAEREAREQBERAEREAREQBERAEREAREQBEXzNJHDC+aV4ZGxpc5xOgAOpKAqXxJcTn4PYIrRZH8+SXQclMxg5nQsJ0ZNe/fRo9T8lheH7g5T4xTR5TlUf07KasmZzpzz/AEUu66G+7+vV33KD8FaSTirx2vfES4xmS12qQNoGvHTm2REPsaC4/EhSXjbxvyrh7mEtrixOnntpa009ZUeY1sx5QXAEdDon0QkvxcF+I/C8ixjiBW3O9uZNBequeoo5mSF+2c++U76gtDmjX3LoTgTx6hz6/TWC92+mtVe9vPReVIXMm19ZvXs4dx7+vu6xTx4a+g4kPXzar9USBbm38HGFZJj9prL/AHOSOO2XinjkpIBIS7YJ9st1obGvXfZX5cqGjuVBNQXCmiqqWdhZLFK0Oa9p9CCo3wc/FRi391U/+GFWPHbjpeOHebiwUNjoK2L6KybzJpHh23b6dPkg3IXxDxW88Bs3gzrDPMlxupkEdXSF50zZ6xO/on8l3of09MYhkFtyrG6K/WmXzKSrjD2b7tPq0+4g9CoJw1vU3GPhXcDldjZQU9a99M2Ngdp8fK0iRpd3Oz0I6bCr3wq3S4YpnOR8KLzJzGmlfNSE9BzNOna+Dmlrh8j70B0miIhAREQBERAEREAREQBERAEREAREQBERAEREAREQBQfj1c32ng/ktXG4tkNE6JpHfb/Y/wCJThVh4pGPfwQv3J+SI3H5eY1AYHhFtLLbwZoagNAkr55al59/XlH6GhYvjKijfwale9jXOjr4CwkdWkkjp9hKkXhqkZJwSxss17NO5p+Ye7a0PjFG+CtV8K2n/aQnucq02G5JasCtvE211H+jNrHR88OxJSvY72Xn4E+v391ZHiUyGryvhVw3v9exjKqriqnTcn1S4eW0ke7et6+KtrwsW2hvPh+jtVypmVNHVT1MU0Tx0c0uVZeLPHIMRwfBcdpZnzU9G+tZE949rkJjIB+IB1v4IT3OjODX4qMW/uqn/YC5h8WsEdTx6oKaUbjlpqVjh8C8grp7gz+KfFv7rg/YC5m8VX+0Ha/7Kk/bKELc7CpoIaamjpqeNkUMTAyNjRoNaBoAD3aXNnE5n7m/F3it2hHIy6MhbJrpzFxdEf8AhXS65r8Sp83j/wAN6eL+OEsLjr3GpGv1FAjpRERCAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCjXFKyPyPh3frLE3mmqqKRsQ97wNtH3gKSogKJ8Ft/jr+HFXYJH6qrTVuDoz3EcntNP3h4+xa/xk5pYW4W/Doa1s14kqopJIGg7iYPa249uvTXzUcyB8vBDxE/hx0T48YyAuMpaPZa1xBePmx2na9xUi8TPCNuY0P7vcRcaq4eQ180MR521cIb7L2f0gPQdx8e4nuSfwf8A4k6H87n/AG1A/Hh/qWJf2lV+qJT3whAt4KULSCCKqcEH09tQLx4f6liX9pVfqiQdzb2bii3AouG9turwLFdMfiE7yOsEgIDZPl6H4dfRVn4uK1kPGyjuEJbMyOippmFrth4BLho+4qa8ReGk+Z8AcRyC0Nkku1os8f8AAN6+fDyguaB/OHce/qPcqAxiz5PxEyK22Ch8ysqo4WwROkPswQtPdx9Gt3/+ISjvbhzm1kz3Hhe7FJK6AP8AKkbKwtcx4AJaflsdQqKrHjN/GRTsg/haXH4wHkdQDECT/wDN+vmpvcnWTw/cFX09JUCor38wgMnQ1NW5vV3L6NGgde4fFa7wiYZVWvG67NLy17rrf3+Y10n1vJ3zc3ze4l3yDUIL0REQgIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgIrxSwe1Z/iVRYbn/Bl3t01QG7dBKB0ePf36j1G1z9w84g5LwUvwwPiJTSy2UE/Q6tgLvKbv6zD+XH7x3H6F1WtJmeKWDMLQ61ZDboq2nJ23mGnRu/nNd3afkhIwurxqvtDq7FaijnoaqZ07n0rgWmRx24kDs4nqQuLvE1xBrs0zua2y0rKSisVRPSQRtfzF7g/ldITodTyDp6D3q1rt4fMuxW5S3ThZmU9KH96aeUxP0Ow5m+y8f1gFjio8UFtPkG3U1cR08ww08m/jvogRIvCBxDrclsEmI11ExrrHTM8qqa/+MjJIDS3XQjXffX3KSZJfuF/Bg3a4xQ00V3uchnko6Yh08rj1A1+Qzez10Op7quTZfE1kwNPU3CGxwv6PeySODQ/8MF33KT8PfDdYbXWi75lcpckuJd5jo3giDm97tkuk+ZI37kBEMDxXJuOWaxZ1nMDqbGaYn6FREkNlG+jGD1b09p35WtfLqSKNkUTIomNZGxoa1rRoNA7ABfkMUcELIYY2RxMaGsYxumtA7AAdgvtCAiIgCIiAIiIAiIgCIiAIiIAiIgCItblNxktGN3G6RRtkfSUz5msceji0b0VDaSyzOuuVk1CO76GyRV3wj4mQZqaijrKeKiuUXttiY4lskfvG/UeoUg4k5FPiuI1V6pqeOokhcwCOQkNOyB6KuN8JV+In0N23heqp1a0c44m2lj1267EkRabCLxLkGJ268zwshkq4fMcxhJDep6DfyW5VkZKSTRp3VSpslXPdNp/IIqXuXFrKhlN0stmxSK5GhnfH/BCRzuVrtcxA7L9/fM4k/wDZ1N/6M3+S1fvtXv8A0Z3f9Ma/Cb5VlZ6yit/mXOixbPUT1VppKqqgME80DHyxEEcji0Et69eh6LX5zda6x4rX3e300dTPSR+b5UhIDmj63b4bK2XJKPMcSuidlqpW7ePntubpFGOGOVfuwxSK8PhjgmMjo5Y2EkNcD8fhoqN8V+J7sMyC3Wyno4aoSs82qLydxsLtDl166Dj1+CrlfCNfiN9Dcp4Rq7tW9HCP9azlem5ZaL4gljmhZNE4PjkaHNcOxBGwVAcGz6tynOrvZ6egp22y3Fw+khxLnkO5W/Dron5BZSsjFpPuUUaK6+FlkF0gsv3diwURVZmfEDNrRktZbrXhU1wpIXAR1DYJXB40D3aNJbbGpZkZaHh92um66sZSz1aX1LTRUPQcZ8yuE80FDhjKqWA6lZCyV7ozvXtAduoPdWhw2v16yGxy1t8sz7TUsnMbYXMe0loAIdp3XuT9yrq1VdrxE3NfwHWaCvxL0kviTfX3J5JQiKs+IXFemsV1NhsNufeLvzcjmN3yRu/m9OrnfAferLLY1LMmaWh0Go11nhURy/2S82+xZiKkHcWM5skkdTlOF+TQPcAXsjkiI38XEjfwOlbOKZDbMns0V1tU3mQP6EEacxw7tcPQrCrUQseFubOv4Nq9DBWWJOL7pprPllG2RFXPF7iNV4NcLXDBbYKyKra98nO8tcA0gaGvms7LI1x5pbGrodDdrrlRQsyefdssljIsDHrvQ36zU11t0vmU1QwOafUe8H3EdlEbpnVZScWaPDG0NO6nqI2vM5cecbaT27eiStjFJt7k0aC++c64x6wTbT6YS3J6iIrDTCIiAIiIAo/xI/kBfvzCb9kqQKP8SP5AX78wm/ZKwt/I/Q2tD/dV/Evqc5WCwXW24TQcQ8fleKqiqZG1LB19kHo75dwQrP4h5PR5bwKqrtSaa5zomzxb2YpA4bb/AJfBZ/hziin4WiCeNskUlRM17HDYcCdEEKquK+PXLA7hX2+gc/8AAF505gPVoLTvl/rN9PgVyOV00cy2kuvr5n0bxa+JcWdFrxbVZmL84p5cfVbovjg9+LKw/mo/WVLFE+D34srD+aj9ZUsXVp9nH0R894n/AHt3xS+rOcMbzG14ZxbyuuukVTJHPNNE0QNDjvzd9dke5WBbuN2J11wp6KGlugkqJWxMLom624gDftfFQvBa/Hrfxhy6TIpaGOB0szYzVNBaXeb6bHfW1ZrMn4Yse17K/H2uadgiNgIPv7Ln6eU1HpNJZZ7PjNOmnbFz005y5I9Yt4/Kvc9ibLzqoIqqllpp2B8UrCx7T6tI0QvykqIKuliqqaVssMrA+N7ezmkbBC9V1NzwHWL8mik+AUsuPZpkeEVTzqOQywb9eU6J+1pafsUTyS1zZ/lWa3uAufBaYCKcjs4sOgP/ACtefuW744OrcO4kUeWW1vKa2lfHvsPMDS0/oc0/Ypt4fbG23cOIpp4wZLm908nMPrNPstB+wfpXJjW7Jfd3tHP/AJ9T6Ndq1pKvxmH5rVBL4k/6/wCP7mDiGYeTwEfd/N/0m30r6UEnqJB7LP1tXr4bbL+DsFdcpG6nuUxlJPcsb7Lf+I/aqcvsV0s9zu/DejaXQ1l1iMIJ9NkN+8OZv+quprFbobRZqO10/wDFUsLYm/HQ1v7e6t0rds05f4rHzOf9oK69BpZQqft586+BJNL9X+xmoiLpHhykfD1/LzM/7b/myK7lSPh6/l5mf9t/zZFdy1ND7FfP6no/tX/uUvSP8UavLrhJasWulyiG5KakkkZ/WDTr9KqzwyWWnltlwymqHn3CepdE2V/UtaAC4/Mk9T8Fbl5oYrpaKy2zkiOqhfC4j0DgRv8ASqJ4TZP+9zfblh2WA0sDpvMjnIPK13bf9VwAO/gsb2o3wlPbr+pfwiE7+FamnT+0bi2lu4rfHo9y+bjRUtxoZqGtgZPTzMLJI3jYcCqS4Gebj/FLI8Tjlc+ibzuYCexY4Bp+fK7RU/yXihh9otUlXFd6avm5SYoKd/M57vQdO3zKh/h7s1xrbrds7usZY+4lzYARrmDncz3D4dAB9qi2UZ3QUOrX0MuH0XaXheqlqU4wkkkn0zLPTCfl3LmVH+Iymirc0w+jnBMU8hikAOiWukjB/QVeCpXj9+MLCPzkf4saz1vsX8vqa32UbXEoteUv4swMKuVZwrz6bEr1O51jrX89LO/oG7Omv+Hud8eqzsiIPibtJHUeQz/Dcp5xXwyDMsafShrG18G5KSU/ku/mk+4/5Ki+GlXdajjFZKe9B4q6LdK4PHtAMY4AH5LUtUqpRq7ZTX/R6Ph9lXEartcni1VyjNebx0kvXHX3nUaIi6x85CIiAIiIAsa6UNPcrbUW+raX09RG6ORoOiWkaPVZKwb9dqCx2iou10qBT0dM0OlkIJDRsD0+JCNZ6Exk4tSjujwxbH7ZjVqFstELoaYPLw1zy47PfqV+5PYLVklrdbbxTCopy4O1sggjsQR2K2i1ltv9ouN5uNmo66OWvtpZ9LgHR0fONtPxB94WPJHl5cdC77zd4vjcz585znrnzye9ktlJZrVT2ugYY6WnZyRtLiSB8ysxay7X+0Wq5W2219dHBV3OV0VHEfrSuA2dD4D1+IWzUpJLCKpzlOTlJ5bINdOFGFXK41Fwq7fM+oqJHSyOFQ8bcTs9NrG/ebwL/qyf/wBy/wDzUvxq/wBoyO2/hGy1sdXTCR0Rez0e06cCD2IK/Ishs8uUS4zHXRvu0NMKqSnGy5kZIAJ9O5HT4qp6ep/4o6UeNcRiklfLC/5MzLbRwW6309BStLYKeNsUbSdkNaNDqshYl5uVFZ7VVXS4zCCkpYzLNIQTytHc9FkQSsngjmidzRyNDmn3gjYVyWOhzJScm292abMsUs2W0EVFeoHyxQyeYzkeWEO0R3HzW1t9JBQUEFDSs8uCnjbFG33NaNBazK8qsOLwQyXqvZTuqHckEQaXyzOHcMY0FzvsCx8UzbGsmqZqO03EOrIG80tLNG6KZjfeWPAOvisVGKfNjqWyvtlWqnJ8q6pdlk/K3CcerMthymele65w8pa8SEN2BoEt7EqRrGuldS2y21NxrZRFS0sTpppCN8rGgkn7gobFxd4fv5HOvvkxv1qWamlZH17EuLdAfFIwjHOFuLdRbcoqyTfKsLPZeSJ2i+YZI5omSxPbJG9ocx7TsOB7EH1C8bnW0ttt1RcK6ZsFLTROlmkd2a1o2T9wWRSajGsQseO3Gur7VTPinrnc1Q50hdzHZPY9upK36wcfu9uv1mprxaaltTRVTOeGVvZwXrdK6mtluqLhWPLKenYZJHBpcQ0d+g6lYxiorCRbdfZfPntk2/NmStFlmI49lETWXq3R1DmDTJR7MjR7g4ddfBR/9+DAfP8AI/C83m8vPyfQpubl3reuXtv1U1tlbT3K309fSPL6eojEkbi0tJaRsdD1CSipLDQpusomp1ycWu66Mg9r4PYLQVTagW2WpLTsNnmL2/d6qfRRxwxMiiY2ONgDWtaNBoHYAeixKK60Fbcq63U04kqqAsFSzR9gvHM37wsuaSOGJ800jI42NLnvedBoHcknsFEKoV/lWC7Va7U6tp32OWPN5PpaLI8SsmQXOguNzp3y1FvdzU7myFoaeYO7Dv1AWlZxXwN9Q2P8NhsD5PLbWOge2mc7etCUjk/Sps1zXNDmkOaRsEHoQplFSWGimm6yiXPXJp+aP1R+bDcflyyPKDRct0j7SteQCda2R2J0s2uyC0UV/obFV10cNxr2PfSwu6GUM1zaPbY32XvdbpQ2sUxrpxD9JqGU8OwTzSO+q3p70lFS3Qqvspz4cmsrDx3T7ehmIiLIqCIiAIiIAoJ4gPxO5H+bt/xGKdrQcRMefleF3LHmVTaR1bGGCYs5wzTg7etjfb3oDfqjqqgq7dnGXZ7Z4ZJa+z3VrKuCPvVURp4jJHr1c3XO34g+9XitFjdgdaLxf691S2YXasbUhgZrygImM5d76/V3vp3QFTz0s98yrE+IdyiljluV+jhtcMnQ09CIZi3p6OkPtn/dHor1WhyrHzequwzsqW04tVxbWlvJvzAI3s5R1Gvr7317LfIDnfh7UXHh9itDllsoam52u8GaGuoIRtzawSvbBK33B/Rjv90qQcO7DWWXjcya8StmvVyxmSsuUjfq+c6qb7Df6LQA0fAKycAx04xilJY5KltWadzz5oj5QeZ5d22e218Oxt7uJLMv+lt5G2g276P5fXZmEnPzb+Gta+1AYHG38UeU/wB2TfsqSWD/AKCt/wCax/shYec2R2SYfdrAypFM6vpXwCYs5gzmGt62N/etlb6c0tBT0pdzmGJsfNrW9ADaAgeEU0Fy4qZleq5olr7fPDb6Tn6+RT+U1+2j05nOds+vKsugy5kucW+23LDLja66ujmjpq2oEB5mR6c5u2vLgOx0vbJsOr5cidlGKXptmvEkTYaoSwedTVbG75RIzYPMNnTgdgEr4seJ36bJqTI8uyCC4VdCyRlFTUVJ5EEPmAB7jtznPJAHcgD3IDP4r/ivyn+56r/CcoJRcQqaHAbJZJcQvdTUV9BFQ0sdTTNjp6mQwgBpe465To/Z2BVm5dajfcVu1kbOIDX0ctMJS3mDOdhbza6b1vstbc8Po7pgFPilfM8iCliijqohyvjljaAyVnucCAQgPXhpZKvHMCstjr5mzVVFSMilc07bzD0B9w7D5KMcbb1Z2fgXErrc6ShgvFUHVj6iZsbfosWnPBJP5R5W/HZ9ynWP09ypbLSU13rY66uijDJqmOLyxK4flcuzon5rSRYbR1GZXPJL02luclTDFTUkM1OHNpYWbJA5t7LnEknp2CAjHCbIbFHmeRYhZ7rQ11GX/hW3upZ2yMbHKf4WP2TocsnXXuerQUVu2FUEl9sl6s0VHaau2VDnPdDTNAnhe3lfEeXXf2SD10WqVICv2/7RT/8Auk3/AO2VYCjwxt44kuy76W3kNnFt+j+X12JjJz82/jrWvtUhQEFwX8Zue/21F/glfPGoCpstns87nNoLpeaakrdHXNC4klhPucQG/at9YcedbMoyC9GqEou74HCIM15XlsLe++u+/osnLcft+T2Gos1ybJ5E2iHxu5XxvB217T6OBAIKAyKm02yps77NPQU77c+HyTTGMeXya1y8vbWlEuBr5BgpovOfPT2+vqqKkkcdl0EUrmx9fXQAH2LGdi3Eeam/BFRxApvwaRyOqorby17me7n5+QO1+WG/HSmeN2a349Y6SzWuHyaOkjEcbd7OveT6knqSgK24p45Fk/FewW81MlHVMs1ZPR1cf16edssJY8fI9x6gkLwuWSVN7tlgt95jjpshtWSUdPcoG9ubbuWVv9B4GwfmPRWDW466pz625QKtrW0VBPSGDk2XmRzHc3Nvprk7a9Vqs14fUOQ5XY8mhqHUVxtlSx8rmN2KqJp2I3jY7HqD6dUJJoiIhAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREB//9k=" alt="Newton Immigration" className="h-9 w-auto object-contain" />
          </div>

          {/* Search */}
          <div className="hidden md:flex flex-1 max-w-sm mx-8">
            <input
              value={caseSearch}
              onChange={(e) => setCaseSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none"
              placeholder="Search cases, clients, UCI..."
            />
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications((prev) => !prev)}
                className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              >
                <Bell size={16} />
                {notifications.filter((n) => !n.read).length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                    {notifications.filter((n) => !n.read).length > 9 ? "9+" : notifications.filter((n) => !n.read).length}
                  </span>
                )}
              </button>
              {showNotifications ? (
                <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
                  <p className="border-b border-slate-100 px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">Notifications</p>
                  <div className="max-h-72 overflow-auto">
                    {notifications.slice(0, 15).map((n) => (
                      <div key={n.id} onClick={() => {
                        if ((n as any).caseId) { setSelectedCaseId((n as any).caseId); setScreen("cases"); setShowNotifications(false); }
                        apiFetch(`/notifications/${n.id}`, { method: "PATCH" }).catch(()=>null);
                        setNotifications(prev => prev.map(x => x.id === n.id ? {...x, read: true} : x));
                      }} className={`border-b border-slate-50 px-4 py-3 text-xs cursor-pointer hover:bg-slate-50 ${n.read ? "opacity-50" : "bg-blue-50/30"}`}>
                        <p className={`leading-relaxed ${n.read ? "text-slate-500" : "text-slate-800 font-semibold"}`}>{n.message}</p>
                        <p className="mt-0.5 text-slate-400">{(n as any).caseId ? "🔗 Click to open case" : n.type}</p>
                      </div>
                    ))}
                    {notifications.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No alerts</p>}
                  </div>
                </div>
              ) : null}
            </div>

            {/* User pill */}
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                {sessionUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-semibold text-slate-800 leading-tight">{sessionUser.name.split(" ")[0]}</p>
                <p className="text-[10px] text-slate-400 leading-tight">{sessionUser.role}</p>
              </div>
            </div>

            <button
              onClick={logout}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] gap-0">
        {/* ── Sidebar ── */}
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-slate-200 bg-white px-3 py-4">

            {/* Sidebar logo + staff info */}
            <div className="mb-5 pb-4 border-b border-slate-100">
              <img src="data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAC+APoDASIAAhEBAxEB/8QAHAABAAIDAQEBAAAAAAAAAAAAAAYHBAUIAwIB/8QAThAAAQMEAAQDBAQHDAYLAAAAAQACAwQFBhEHEiExCBNBIlFhcRQygZEVN0J0obGyFhcjMzZSYnJzdbPRJDQ4gsLDNVVXdoOSk5SitMH/xAAbAQEAAgMBAQAAAAAAAAAAAAAAAQMCBAUGB//EADURAAICAQIEAwUHAwUAAAAAAAABAgMRBDEFEiFBE1FxM2FygbEGFBUykaGyIjRCFjVi0eH/2gAMAwEAAhEDEQA/AOy0REAREQBERAEREAREQBERAEREAREJA7oAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiqTjPxvsuCyPs1rhF4yJ2mtpWE8kLj28wjrv+iOp+CAttUt4g81vFmmoLbbHQtpqlsdXFVMJLiWPJ5fcRsNKhlLZuN2WWW4ZFkpqYByMdQ21hETm9due1g6hwA0AepDj7tGvshyJlottBS5M+prTAHMpLeH8kkMbj7bySPZ7ey09z8O+hqp2SfhQXV9z1/2e0miph+I6qacYvDju9ujXXr1922Trvh9fqnIMWoLpcI4KeprGOlbDGfyAdbG+p9PvCkS5Ax+O/ZPd7PTWmpqLtRGMR0pY8xt+jhwL2O19TW9OB3o679Fvq7N+L3B6+SNyyklyHGHVBbHUuaN8hPTle3fIdfku6eit0t0rE1JYwaHHuGU6OcLKbFJWZaS7LPTvn9UtmdQoo3w9zbH87sTbvj9WJowQ2WJ3SSF3817fQ/oPopIto8+EREAREQBERAEREAREQBERAEREAREQBERAEREAREQBEXzNJHDC+aV4ZGxpc5xOgAOpKAqXxJcTn4PYIrRZH8+SXQclMxg5nQsJ0ZNe/fRo9T8lheH7g5T4xTR5TlUf07KasmZzpzz/AEUu66G+7+vV33KD8FaSTirx2vfES4xmS12qQNoGvHTm2REPsaC4/EhSXjbxvyrh7mEtrixOnntpa009ZUeY1sx5QXAEdDon0QkvxcF+I/C8ixjiBW3O9uZNBequeoo5mSF+2c++U76gtDmjX3LoTgTx6hz6/TWC92+mtVe9vPReVIXMm19ZvXs4dx7+vu6xTx4a+g4kPXzar9USBbm38HGFZJj9prL/AHOSOO2XinjkpIBIS7YJ9st1obGvXfZX5cqGjuVBNQXCmiqqWdhZLFK0Oa9p9CCo3wc/FRi391U/+GFWPHbjpeOHebiwUNjoK2L6KybzJpHh23b6dPkg3IXxDxW88Bs3gzrDPMlxupkEdXSF50zZ6xO/on8l3of09MYhkFtyrG6K/WmXzKSrjD2b7tPq0+4g9CoJw1vU3GPhXcDldjZQU9a99M2Ngdp8fK0iRpd3Oz0I6bCr3wq3S4YpnOR8KLzJzGmlfNSE9BzNOna+Dmlrh8j70B0miIhAREQBERAEREAREQBERAEREAREQBERAEREAREQBQfj1c32ng/ktXG4tkNE6JpHfb/Y/wCJThVh4pGPfwQv3J+SI3H5eY1AYHhFtLLbwZoagNAkr55al59/XlH6GhYvjKijfwale9jXOjr4CwkdWkkjp9hKkXhqkZJwSxss17NO5p+Ye7a0PjFG+CtV8K2n/aQnucq02G5JasCtvE211H+jNrHR88OxJSvY72Xn4E+v391ZHiUyGryvhVw3v9exjKqriqnTcn1S4eW0ke7et6+KtrwsW2hvPh+jtVypmVNHVT1MU0Tx0c0uVZeLPHIMRwfBcdpZnzU9G+tZE949rkJjIB+IB1v4IT3OjODX4qMW/uqn/YC5h8WsEdTx6oKaUbjlpqVjh8C8grp7gz+KfFv7rg/YC5m8VX+0Ha/7Kk/bKELc7CpoIaamjpqeNkUMTAyNjRoNaBoAD3aXNnE5n7m/F3it2hHIy6MhbJrpzFxdEf8AhXS65r8Sp83j/wAN6eL+OEsLjr3GpGv1FAjpRERCAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCjXFKyPyPh3frLE3mmqqKRsQ97wNtH3gKSogKJ8Ft/jr+HFXYJH6qrTVuDoz3EcntNP3h4+xa/xk5pYW4W/Doa1s14kqopJIGg7iYPa249uvTXzUcyB8vBDxE/hx0T48YyAuMpaPZa1xBePmx2na9xUi8TPCNuY0P7vcRcaq4eQ180MR521cIb7L2f0gPQdx8e4nuSfwf8A4k6H87n/AG1A/Hh/qWJf2lV+qJT3whAt4KULSCCKqcEH09tQLx4f6liX9pVfqiQdzb2bii3AouG9turwLFdMfiE7yOsEgIDZPl6H4dfRVn4uK1kPGyjuEJbMyOippmFrth4BLho+4qa8ReGk+Z8AcRyC0Nkku1os8f8AAN6+fDyguaB/OHce/qPcqAxiz5PxEyK22Ch8ysqo4WwROkPswQtPdx9Gt3/+ISjvbhzm1kz3Hhe7FJK6AP8AKkbKwtcx4AJaflsdQqKrHjN/GRTsg/haXH4wHkdQDECT/wDN+vmpvcnWTw/cFX09JUCor38wgMnQ1NW5vV3L6NGgde4fFa7wiYZVWvG67NLy17rrf3+Y10n1vJ3zc3ze4l3yDUIL0REQgIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgIrxSwe1Z/iVRYbn/Bl3t01QG7dBKB0ePf36j1G1z9w84g5LwUvwwPiJTSy2UE/Q6tgLvKbv6zD+XH7x3H6F1WtJmeKWDMLQ61ZDboq2nJ23mGnRu/nNd3afkhIwurxqvtDq7FaijnoaqZ07n0rgWmRx24kDs4nqQuLvE1xBrs0zua2y0rKSisVRPSQRtfzF7g/ldITodTyDp6D3q1rt4fMuxW5S3ThZmU9KH96aeUxP0Ow5m+y8f1gFjio8UFtPkG3U1cR08ww08m/jvogRIvCBxDrclsEmI11ExrrHTM8qqa/+MjJIDS3XQjXffX3KSZJfuF/Bg3a4xQ00V3uchnko6Yh08rj1A1+Qzez10Op7quTZfE1kwNPU3CGxwv6PeySODQ/8MF33KT8PfDdYbXWi75lcpckuJd5jo3giDm97tkuk+ZI37kBEMDxXJuOWaxZ1nMDqbGaYn6FREkNlG+jGD1b09p35WtfLqSKNkUTIomNZGxoa1rRoNA7ABfkMUcELIYY2RxMaGsYxumtA7AAdgvtCAiIgCIiAIiIAiIgCIiAIiIAiIgCItblNxktGN3G6RRtkfSUz5msceji0b0VDaSyzOuuVk1CO76GyRV3wj4mQZqaijrKeKiuUXttiY4lskfvG/UeoUg4k5FPiuI1V6pqeOokhcwCOQkNOyB6KuN8JV+In0N23heqp1a0c44m2lj1267EkRabCLxLkGJ268zwshkq4fMcxhJDep6DfyW5VkZKSTRp3VSpslXPdNp/IIqXuXFrKhlN0stmxSK5GhnfH/BCRzuVrtcxA7L9/fM4k/wDZ1N/6M3+S1fvtXv8A0Z3f9Ma/Cb5VlZ6yit/mXOixbPUT1VppKqqgME80DHyxEEcji0Et69eh6LX5zda6x4rX3e300dTPSR+b5UhIDmj63b4bK2XJKPMcSuidlqpW7ePntubpFGOGOVfuwxSK8PhjgmMjo5Y2EkNcD8fhoqN8V+J7sMyC3Wyno4aoSs82qLydxsLtDl166Dj1+CrlfCNfiN9Dcp4Rq7tW9HCP9azlem5ZaL4gljmhZNE4PjkaHNcOxBGwVAcGz6tynOrvZ6egp22y3Fw+khxLnkO5W/Dron5BZSsjFpPuUUaK6+FlkF0gsv3diwURVZmfEDNrRktZbrXhU1wpIXAR1DYJXB40D3aNJbbGpZkZaHh92um66sZSz1aX1LTRUPQcZ8yuE80FDhjKqWA6lZCyV7ozvXtAduoPdWhw2v16yGxy1t8sz7TUsnMbYXMe0loAIdp3XuT9yrq1VdrxE3NfwHWaCvxL0kviTfX3J5JQiKs+IXFemsV1NhsNufeLvzcjmN3yRu/m9OrnfAferLLY1LMmaWh0Go11nhURy/2S82+xZiKkHcWM5skkdTlOF+TQPcAXsjkiI38XEjfwOlbOKZDbMns0V1tU3mQP6EEacxw7tcPQrCrUQseFubOv4Nq9DBWWJOL7pprPllG2RFXPF7iNV4NcLXDBbYKyKra98nO8tcA0gaGvms7LI1x5pbGrodDdrrlRQsyefdssljIsDHrvQ36zU11t0vmU1QwOafUe8H3EdlEbpnVZScWaPDG0NO6nqI2vM5cecbaT27eiStjFJt7k0aC++c64x6wTbT6YS3J6iIrDTCIiAIiIAo/xI/kBfvzCb9kqQKP8SP5AX78wm/ZKwt/I/Q2tD/dV/Evqc5WCwXW24TQcQ8fleKqiqZG1LB19kHo75dwQrP4h5PR5bwKqrtSaa5zomzxb2YpA4bb/AJfBZ/hziin4WiCeNskUlRM17HDYcCdEEKquK+PXLA7hX2+gc/8AAF505gPVoLTvl/rN9PgVyOV00cy2kuvr5n0bxa+JcWdFrxbVZmL84p5cfVbovjg9+LKw/mo/WVLFE+D34srD+aj9ZUsXVp9nH0R894n/AHt3xS+rOcMbzG14ZxbyuuukVTJHPNNE0QNDjvzd9dke5WBbuN2J11wp6KGlugkqJWxMLom624gDftfFQvBa/Hrfxhy6TIpaGOB0szYzVNBaXeb6bHfW1ZrMn4Yse17K/H2uadgiNgIPv7Ln6eU1HpNJZZ7PjNOmnbFz005y5I9Yt4/Kvc9ibLzqoIqqllpp2B8UrCx7T6tI0QvykqIKuliqqaVssMrA+N7ezmkbBC9V1NzwHWL8mik+AUsuPZpkeEVTzqOQywb9eU6J+1pafsUTyS1zZ/lWa3uAufBaYCKcjs4sOgP/ACtefuW744OrcO4kUeWW1vKa2lfHvsPMDS0/oc0/Ypt4fbG23cOIpp4wZLm908nMPrNPstB+wfpXJjW7Jfd3tHP/AJ9T6Ndq1pKvxmH5rVBL4k/6/wCP7mDiGYeTwEfd/N/0m30r6UEnqJB7LP1tXr4bbL+DsFdcpG6nuUxlJPcsb7Lf+I/aqcvsV0s9zu/DejaXQ1l1iMIJ9NkN+8OZv+quprFbobRZqO10/wDFUsLYm/HQ1v7e6t0rds05f4rHzOf9oK69BpZQqft586+BJNL9X+xmoiLpHhykfD1/LzM/7b/myK7lSPh6/l5mf9t/zZFdy1ND7FfP6no/tX/uUvSP8UavLrhJasWulyiG5KakkkZ/WDTr9KqzwyWWnltlwymqHn3CepdE2V/UtaAC4/Mk9T8Fbl5oYrpaKy2zkiOqhfC4j0DgRv8ASqJ4TZP+9zfblh2WA0sDpvMjnIPK13bf9VwAO/gsb2o3wlPbr+pfwiE7+FamnT+0bi2lu4rfHo9y+bjRUtxoZqGtgZPTzMLJI3jYcCqS4Gebj/FLI8Tjlc+ibzuYCexY4Bp+fK7RU/yXihh9otUlXFd6avm5SYoKd/M57vQdO3zKh/h7s1xrbrds7usZY+4lzYARrmDncz3D4dAB9qi2UZ3QUOrX0MuH0XaXheqlqU4wkkkn0zLPTCfl3LmVH+Iymirc0w+jnBMU8hikAOiWukjB/QVeCpXj9+MLCPzkf4saz1vsX8vqa32UbXEoteUv4swMKuVZwrz6bEr1O51jrX89LO/oG7Omv+Hud8eqzsiIPibtJHUeQz/Dcp5xXwyDMsafShrG18G5KSU/ku/mk+4/5Ki+GlXdajjFZKe9B4q6LdK4PHtAMY4AH5LUtUqpRq7ZTX/R6Ph9lXEartcni1VyjNebx0kvXHX3nUaIi6x85CIiAIiIAsa6UNPcrbUW+raX09RG6ORoOiWkaPVZKwb9dqCx2iou10qBT0dM0OlkIJDRsD0+JCNZ6Exk4tSjujwxbH7ZjVqFstELoaYPLw1zy47PfqV+5PYLVklrdbbxTCopy4O1sggjsQR2K2i1ltv9ouN5uNmo66OWvtpZ9LgHR0fONtPxB94WPJHl5cdC77zd4vjcz585znrnzye9ktlJZrVT2ugYY6WnZyRtLiSB8ysxay7X+0Wq5W2219dHBV3OV0VHEfrSuA2dD4D1+IWzUpJLCKpzlOTlJ5bINdOFGFXK41Fwq7fM+oqJHSyOFQ8bcTs9NrG/ebwL/qyf/wBy/wDzUvxq/wBoyO2/hGy1sdXTCR0Rez0e06cCD2IK/Ishs8uUS4zHXRvu0NMKqSnGy5kZIAJ9O5HT4qp6ep/4o6UeNcRiklfLC/5MzLbRwW6309BStLYKeNsUbSdkNaNDqshYl5uVFZ7VVXS4zCCkpYzLNIQTytHc9FkQSsngjmidzRyNDmn3gjYVyWOhzJScm292abMsUs2W0EVFeoHyxQyeYzkeWEO0R3HzW1t9JBQUEFDSs8uCnjbFG33NaNBazK8qsOLwQyXqvZTuqHckEQaXyzOHcMY0FzvsCx8UzbGsmqZqO03EOrIG80tLNG6KZjfeWPAOvisVGKfNjqWyvtlWqnJ8q6pdlk/K3CcerMthymele65w8pa8SEN2BoEt7EqRrGuldS2y21NxrZRFS0sTpppCN8rGgkn7gobFxd4fv5HOvvkxv1qWamlZH17EuLdAfFIwjHOFuLdRbcoqyTfKsLPZeSJ2i+YZI5omSxPbJG9ocx7TsOB7EH1C8bnW0ttt1RcK6ZsFLTROlmkd2a1o2T9wWRSajGsQseO3Gur7VTPinrnc1Q50hdzHZPY9upK36wcfu9uv1mprxaaltTRVTOeGVvZwXrdK6mtluqLhWPLKenYZJHBpcQ0d+g6lYxiorCRbdfZfPntk2/NmStFlmI49lETWXq3R1DmDTJR7MjR7g4ddfBR/9+DAfP8AI/C83m8vPyfQpubl3reuXtv1U1tlbT3K309fSPL6eojEkbi0tJaRsdD1CSipLDQpusomp1ycWu66Mg9r4PYLQVTagW2WpLTsNnmL2/d6qfRRxwxMiiY2ONgDWtaNBoHYAeixKK60Fbcq63U04kqqAsFSzR9gvHM37wsuaSOGJ800jI42NLnvedBoHcknsFEKoV/lWC7Va7U6tp32OWPN5PpaLI8SsmQXOguNzp3y1FvdzU7myFoaeYO7Dv1AWlZxXwN9Q2P8NhsD5PLbWOge2mc7etCUjk/Sps1zXNDmkOaRsEHoQplFSWGimm6yiXPXJp+aP1R+bDcflyyPKDRct0j7SteQCda2R2J0s2uyC0UV/obFV10cNxr2PfSwu6GUM1zaPbY32XvdbpQ2sUxrpxD9JqGU8OwTzSO+q3p70lFS3Qqvspz4cmsrDx3T7ehmIiLIqCIiAIiIAoJ4gPxO5H+bt/xGKdrQcRMefleF3LHmVTaR1bGGCYs5wzTg7etjfb3oDfqjqqgq7dnGXZ7Z4ZJa+z3VrKuCPvVURp4jJHr1c3XO34g+9XitFjdgdaLxf691S2YXasbUhgZrygImM5d76/V3vp3QFTz0s98yrE+IdyiljluV+jhtcMnQ09CIZi3p6OkPtn/dHor1WhyrHzequwzsqW04tVxbWlvJvzAI3s5R1Gvr7317LfIDnfh7UXHh9itDllsoam52u8GaGuoIRtzawSvbBK33B/Rjv90qQcO7DWWXjcya8StmvVyxmSsuUjfq+c6qb7Df6LQA0fAKycAx04xilJY5KltWadzz5oj5QeZ5d22e218Oxt7uJLMv+lt5G2g276P5fXZmEnPzb+Gta+1AYHG38UeU/wB2TfsqSWD/AKCt/wCax/shYec2R2SYfdrAypFM6vpXwCYs5gzmGt62N/etlb6c0tBT0pdzmGJsfNrW9ADaAgeEU0Fy4qZleq5olr7fPDb6Tn6+RT+U1+2j05nOds+vKsugy5kucW+23LDLja66ujmjpq2oEB5mR6c5u2vLgOx0vbJsOr5cidlGKXptmvEkTYaoSwedTVbG75RIzYPMNnTgdgEr4seJ36bJqTI8uyCC4VdCyRlFTUVJ5EEPmAB7jtznPJAHcgD3IDP4r/ivyn+56r/CcoJRcQqaHAbJZJcQvdTUV9BFQ0sdTTNjp6mQwgBpe465To/Z2BVm5dajfcVu1kbOIDX0ctMJS3mDOdhbza6b1vstbc8Po7pgFPilfM8iCliijqohyvjljaAyVnucCAQgPXhpZKvHMCstjr5mzVVFSMilc07bzD0B9w7D5KMcbb1Z2fgXErrc6ShgvFUHVj6iZsbfosWnPBJP5R5W/HZ9ynWP09ypbLSU13rY66uijDJqmOLyxK4flcuzon5rSRYbR1GZXPJL02luclTDFTUkM1OHNpYWbJA5t7LnEknp2CAjHCbIbFHmeRYhZ7rQ11GX/hW3upZ2yMbHKf4WP2TocsnXXuerQUVu2FUEl9sl6s0VHaau2VDnPdDTNAnhe3lfEeXXf2SD10WqVICv2/7RT/8Auk3/AO2VYCjwxt44kuy76W3kNnFt+j+X12JjJz82/jrWvtUhQEFwX8Zue/21F/glfPGoCpstns87nNoLpeaakrdHXNC4klhPucQG/at9YcedbMoyC9GqEou74HCIM15XlsLe++u+/osnLcft+T2Gos1ybJ5E2iHxu5XxvB217T6OBAIKAyKm02yps77NPQU77c+HyTTGMeXya1y8vbWlEuBr5BgpovOfPT2+vqqKkkcdl0EUrmx9fXQAH2LGdi3Eeam/BFRxApvwaRyOqorby17me7n5+QO1+WG/HSmeN2a349Y6SzWuHyaOkjEcbd7OveT6knqSgK24p45Fk/FewW81MlHVMs1ZPR1cf16edssJY8fI9x6gkLwuWSVN7tlgt95jjpshtWSUdPcoG9ubbuWVv9B4GwfmPRWDW466pz625QKtrW0VBPSGDk2XmRzHc3Nvprk7a9Vqs14fUOQ5XY8mhqHUVxtlSx8rmN2KqJp2I3jY7HqD6dUJJoiIhAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREB//9k=" alt="Newton Immigration" className="h-10 w-auto object-contain mb-3" />
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="text-xs font-bold text-slate-800">{sessionUser.name}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{sessionUser.role}</p>
              </div>
            </div>

            {/* Nav */}
            <nav className="space-y-0.5">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setScreen(tab.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                    screen === tab.id
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <span className="shrink-0 opacity-70">{tab.icon}</span>
                  {tab.label}
                  {/* Live counts on key tabs */}
                  {tab.id === "tasks" && tasks.filter((t) => t.status === "pending" && t.assignedTo?.toLowerCase().includes(sessionUser.name.split(" ")[0].toLowerCase())).length > 0 && (
                    <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold ${screen === tab.id ? "bg-white text-slate-900" : "bg-red-100 text-red-700"}`}>
                      {tasks.filter((t) => t.status === "pending" && t.assignedTo?.toLowerCase().includes(sessionUser.name.split(" ")[0].toLowerCase())).length}
                    </span>
                  )}
                  {tab.id === "cases" && visibleCases.filter((c) => isUrgentCase(c)).length > 0 && (
                    <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold ${screen === tab.id ? "bg-white text-slate-900" : "bg-amber-100 text-amber-700"}`}>
                      {visibleCases.filter((c) => isUrgentCase(c)).length}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {/* Quick search on mobile fallback */}
            <div className="mt-4 border-t border-slate-100 pt-3 md:hidden">
              <input
                value={caseSearch}
                onChange={(e) => setCaseSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2 py-2 text-xs"
                placeholder="Search cases..."
              />
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="min-w-0 flex-1 px-4 py-5 lg:px-6">
          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="space-y-4">
          {screen === "newton-ai" ? (
            <div className="flex-1 h-full overflow-hidden">
              <NewtonAgent sessionUser={sessionUser} />
            </div>
          ) : screen === "dashboard" ? (
            <>
              {/* ── Role-aware personal workspace ── */}
              {(() => {
                const myName = sessionUser?.name || "";
                const myRole = sessionUser?.role || "";
                const isAdmin = myRole === "Admin";
                const isMarketing = myRole === "Marketing";
                const isProcessing = myRole === "Processing" || myRole === "ProcessingLead";
                const isReviewer = myRole === "Reviewer";

                // My assigned cases (for processing staff)
                const myCases = visibleCases.filter(
                  (c) => c.assignedTo && c.assignedTo.toLowerCase().includes(myName.toLowerCase().split(" ")[0].toLowerCase())
                );
                const myPendingTasks = tasks.filter(
                  (t) => t.status === "pending" && t.assignedTo && t.assignedTo.toLowerCase().includes(myName.toLowerCase().split(" ")[0].toLowerCase())
                );
                const myHighTasks = myPendingTasks.filter((t) => t.priority === "high");
                const myOverdueTasks = myPendingTasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date());
                const underReviewCases = visibleCases.filter((c) => c.processingStatus === "under_review" || c.stage === "Under Review");
                const urgentCases = visibleCases.filter((c) => isUrgentCase(c));
                const today = new Date().toISOString().slice(0, 10);

                return (
                  <>
                    {/* ── Newton AI Daily Briefing Widget ── */}
                    {(isAdmin || myRole === "ProcessingLead") && (
                      <section className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">🤖</span>
                            <div>
                              <p className="text-sm font-bold text-emerald-800">Newton AI Daily Briefing</p>
                              <p className="text-[11px] text-emerald-600">{new Date().toLocaleDateString("en-CA", {timeZone:"America/Vancouver", weekday:"long", month:"long", day:"numeric"})}</p>
                            </div>
                          </div>
                          <button
                            onClick={async () => {
                              setNewtonBriefing({loaded:false, data:null});
                              try {
                                const res = await apiFetch("/newton-briefing", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({token:"newton-recovery-2024"})});
                                const data = await res.json();
                                setNewtonBriefing({loaded:true, data});
                              } catch(e) { setNewtonBriefing({loaded:true, data:{error:"Failed"}}); }
                            }}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                          >
                            {newtonBriefing.loaded ? "↻ Refresh" : "▶ Run Briefing"}
                          </button>
                        </div>

                        {!newtonBriefing.loaded && (
                          <div className="grid grid-cols-4 gap-3">
                            {[
                              {icon:"📊", label:"Active Cases", value:visibleCases.length, color:"text-slate-700"},
                              {icon:"🔴", label:"Urgent", value:urgentCases.length, color:"text-red-600"},
                              {icon:"🔍", label:"Under Review", value:underReviewCases.length, color:"text-amber-600"},
                              {icon:"⚠️", label:"Expiring Soon", value:visibleCases.filter(c=>{
                                const intake=(c.pgwpIntake||{}) as any;
                                const exp=intake.studyPermitExpiryDate||intake.workPermitExpiryDate||(c as any).permitExpiryDate||"";
                                if(!exp) return false;
                                const days=Math.floor((new Date(exp).getTime()-Date.now())/86400000);
                                return days>=0&&days<=30;
                              }).length, color:"text-orange-600"},
                            ].map((stat,i) => (
                              <div key={i} className="rounded-xl bg-white border border-slate-100 p-3 text-center shadow-sm">
                                <p className="text-xl">{stat.icon}</p>
                                <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                                <p className="text-[10px] text-slate-500 font-medium">{stat.label}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {newtonBriefing.loaded && newtonBriefing.data && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-4 gap-2">
                              {[
                                {icon:"📊", label:"Active", value:newtonBriefing.data.urgentCases !== undefined ? visibleCases.length : "—"},
                                {icon:"🔴", label:"Urgent", value:newtonBriefing.data.urgentCases ?? "—"},
                                {icon:"⚠️", label:"Expiring", value:newtonBriefing.data.expiringCases ?? "—"},
                                {icon:"✅", label:"New Results", value:newtonBriefing.data.recentResults ?? "—"},
                              ].map((s,i) => (
                                <div key={i} className="rounded-lg bg-white border border-slate-100 p-2 text-center">
                                  <p className="text-lg">{s.icon}</p>
                                  <p className="text-lg font-bold text-slate-800">{s.value}</p>
                                  <p className="text-[10px] text-slate-500">{s.label}</p>
                                </div>
                              ))}
                            </div>
                            {newtonBriefing.data.staleCases > 0 && (
                              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                                💤 <strong>{newtonBriefing.data.staleCases} stale cases</strong> — no updates in 7+ days
                              </div>
                            )}
                            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
                              ✅ Briefing sent to team • Client reminders: {newtonBriefing.data.clientReminders?.length || 0} sent
                            </div>
                          </div>
                        )}

                        <div className="mt-3 pt-3 border-t border-emerald-100 flex gap-2">
                          <button onClick={() => setScreen("newton-ai")} className="text-xs text-emerald-600 font-semibold hover:underline">
                            💬 Ask Newton AI →
                          </button>
                          <span className="text-slate-300">|</span>
                          <button onClick={() => setScreen("cases")} className="text-xs text-slate-500 hover:underline">
                            View all cases →
                          </button>
                        </div>
                      </section>
                    )}

                    {/* ── Personal greeting header ── */}
                    <section className="rounded-2xl border-2 border-slate-900 bg-slate-900 p-4 text-white" style={{background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)"}}> 
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Newton Immigration · {myRole}</p>
                          <h2 className="mt-1 text-xl font-semibold">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {myName.split(" ")[0]}</h2>
                          <p className="mt-1 text-sm text-slate-400">{today} · {isProcessing ? (myCases.length > 0 ? `${myCases.length} cases assigned to you` : "No cases assigned to you yet") : isAdmin ? `${visibleCases.length} total active cases` : isMarketing ? `${visibleCases.length} total cases` : myCases.length > 0 ? `${myCases.length} cases` : "No cases yet"}</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setScreen("cases")} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-white">
                            Open Cases
                          </button>
                          {(isAdmin || isMarketing) && (
                            <button onClick={() => setScreen("communications")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">
                              + New Case
                            </button>
                          )}
                        </div>
                      </div>
                    </section>

                    {/* ── PROCESSING STAFF workspace ── */}
                    {isProcessing && (
                      <>
                        {/* My stats row */}
                        <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
                          <article className={`rounded-xl border-2 p-4 ${myHighTasks.length > 0 ? "border-red-300 bg-red-50" : "border-slate-300 bg-white"}`}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">My High Priority</p>
                            <p className={`mt-1 text-3xl font-bold ${myHighTasks.length > 0 ? "text-red-900" : "text-slate-900"}`}>{myHighTasks.length}</p>
                            <p className="mt-1 text-[11px] text-slate-500">tasks</p>
                          </article>
                          <article className={`rounded-xl border-2 p-4 ${myOverdueTasks.length > 0 ? "border-amber-300 bg-amber-50" : "border-slate-300 bg-white"}`}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overdue</p>
                            <p className={`mt-1 text-3xl font-bold ${myOverdueTasks.length > 0 ? "text-amber-900" : "text-slate-900"}`}>{myOverdueTasks.length}</p>
                            <p className="mt-1 text-[11px] text-slate-500">tasks past due date</p>
                          </article>
                          <article className="rounded-xl border-2 border-slate-300 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">My Cases</p>
                            <p className="mt-1 text-3xl font-bold text-slate-900">{myCases.length}</p>
                            <p className="mt-1 text-[11px] text-slate-500">assigned to me</p>
                          </article>
                          <article className="rounded-xl border-2 border-slate-300 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">My Pending Tasks</p>
                            <p className="mt-1 text-3xl font-bold text-slate-900">{myPendingTasks.length}</p>
                            <p className="mt-1 text-[11px] text-slate-500">to complete</p>
                          </article>
                        </section>

                        {/* My tasks list */}
                        <section className="rounded-xl border border-slate-200 bg-white p-5">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-base font-semibold">My Tasks</h3>
                            <button onClick={() => setScreen("tasks")} className="text-xs font-semibold text-blue-700 underline">View all</button>
                          </div>
                          {myPendingTasks.length === 0 ? (
                            <p className="text-sm text-emerald-700 font-semibold">✓ No pending tasks — you are all caught up!</p>
                          ) : (
                            <div className="space-y-2">
                              {myPendingTasks.slice(0, 8).map((t) => (
                                <div key={t.id} className={`rounded-lg border p-3 ${t.priority === "high" ? "border-red-200 bg-red-50" : t.dueDate && new Date(t.dueDate) < new Date() ? "border-amber-200 bg-amber-50" : "border-slate-200"}`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                      <p className="text-sm font-semibold text-slate-800">{t.title}</p>
                                      <p className="text-[11px] text-slate-500 mt-0.5">
                                        {t.caseId && t.caseId !== "GENERAL" ? (
                                          <button onClick={() => { setSelectedCaseId(t.caseId); setScreen("cases"); }} className="text-blue-700 font-semibold hover:underline">{t.caseId}</button>
                                        ) : "General"} · {t.priority} {t.dueDate ? `· Due ${t.dueDate}` : ""}
                                      </p>
                                      {t.description ? <p className="text-[11px] text-slate-600 mt-0.5">{t.description}</p> : null}
                                    </div>
                                    <button onClick={() => void markTaskCompleted(t.id)} className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100">
                                      Done
                                    </button>
                                  </div>
                                </div>
                              ))}
                              {myPendingTasks.length > 8 && <p className="text-xs text-slate-500 text-center">+{myPendingTasks.length - 8} more in Tasks tab</p>}
                            </div>
                          )}
                        </section>

                        {/* My assigned cases */}
                        <section className="rounded-xl border border-slate-200 bg-white p-5">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-base font-semibold">My Assigned Cases</h3>
                            <button onClick={() => setScreen("cases")} className="text-xs font-semibold text-blue-700 underline">Open Cases</button>
                          </div>
                          {myCases.length === 0 ? (
                            <p className="text-sm text-slate-500">No cases assigned to you yet.</p>
                          ) : (
                            <div className="space-y-2">
                              {myCases.slice(0, 10).map((c) => (
                                <button key={c.id} onClick={() => { setSelectedCaseId(c.id); setScreen("cases"); }}
                                  className={`w-full rounded-xl border-2 p-3 text-left hover:bg-slate-50 ${isUrgentCase(c) ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <p className="text-sm font-semibold text-slate-900">{c.client}</p>
                                      <p className="text-xs text-slate-500 mt-0.5">{c.id} · {c.formType} · {c.stage}</p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      {isUrgentCase(c) && <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">URGENT</span>}
                                      {c.processingStatus === "under_review" && <span className="inline-block ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Under Review</span>}
                                    </div>
                                  </div>
                                </button>
                              ))}
                              {myCases.length > 10 && <p className="text-xs text-slate-500 text-center">+{myCases.length - 10} more — open Cases tab</p>}
                            </div>
                          )}
                        </section>
                      </>
                    )}

                    {/* ── REVIEWER workspace ── */}
                    {isReviewer && (
                      <>
                        <section className="grid gap-3 grid-cols-2 md:grid-cols-3">
                          <article className={`rounded-xl border-2 p-4 ${underReviewCases.length > 0 ? "border-amber-300 bg-amber-50" : "border-slate-300 bg-white"}`}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Awaiting My Review</p>
                            <p className="mt-1 text-3xl font-bold text-amber-900">{underReviewCases.length}</p>
                            <p className="mt-1 text-[11px] text-amber-600">cases to check</p>
                          </article>
                          <article className="rounded-xl border-2 border-slate-300 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">My Pending Tasks</p>
                            <p className="mt-1 text-3xl font-bold text-slate-900">{myPendingTasks.length}</p>
                            <p className="mt-1 text-[11px] text-slate-500">to complete</p>
                          </article>
                          <article className={`rounded-xl border-2 p-4 ${urgentCases.length > 0 ? "border-red-300 bg-red-50" : "border-slate-300 bg-white"}`}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Urgent</p>
                            <p className="mt-1 text-3xl font-bold text-red-900">{urgentCases.length}</p>
                            <p className="mt-1 text-[11px] text-red-600">need immediate action</p>
                          </article>
                        </section>

                        <section className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
                          <h3 className="text-base font-semibold text-amber-900">Cases Under Review — Needs Your Approval</h3>
                          {underReviewCases.length === 0 ? (
                            <p className="mt-2 text-sm text-emerald-700 font-semibold">✓ No cases waiting for review.</p>
                          ) : (
                            <div className="mt-3 space-y-2">
                              {underReviewCases.map((c) => (
                                <button key={c.id} onClick={() => { setSelectedCaseId(c.id); setScreen("cases"); }}
                                  className="w-full rounded-xl border-2 border-amber-300 bg-white p-3 text-left hover:bg-amber-50">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="text-sm font-semibold text-slate-900">{c.client}</p>
                                      <p className="text-xs text-slate-500">{c.id} · {c.formType}</p>
                                      {(c as any).reviewedBy && (
                                        <p className="text-xs font-semibold text-amber-700 mt-0.5">👁 {(c as any).reviewedBy}</p>
                                      )}
                                      <button onClick={e => { e.stopPropagation(); setShowURPanel(c.id); }}
                                        className="mt-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-amber-600">
                                        {(c as any).reviewStatus === "changes_needed" ? "⚠️ Changes Needed" : (c as any).reviewStatus === "changes_done" ? "✅ Ready to Submit" : "👁 Open Review"}
                                      </button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {c.leadPhone && (
                                        <button onClick={async e => {
                                          e.stopPropagation();
                                          // Open inbox for this client
                                          setInboxThread(String(c.leadPhone||"").replace(/\D/g,""));
                                          setScreen("inbox");
                                        }} className="rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-600">💬</button>
                                      )}
                                      <span className="text-xs font-semibold text-amber-700">Open →</span>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-5">
                          <h3 className="text-base font-semibold mb-3">My Tasks</h3>
                          {myPendingTasks.length === 0 ? (
                            <p className="text-sm text-emerald-700 font-semibold">✓ All caught up!</p>
                          ) : (
                            <div className="space-y-2">
                              {myPendingTasks.slice(0, 6).map((t) => (
                                <div key={t.id} className="rounded-lg border border-slate-200 p-3 flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold">{t.title}</p>
                                    <p className="text-[11px] text-slate-500">{t.caseId !== "GENERAL" ? t.caseId : "General"} · {t.priority}</p>
                                  </div>
                                  <button onClick={() => void markTaskCompleted(t.id)} className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Done</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      </>
                    )}

                    {/* ── ADMIN workspace ── */}
                    {isAdmin && (
                      <>
                        <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
                          <article className={`rounded-xl border-2 p-4 ${urgentCases.length > 0 ? "border-red-300 bg-red-50" : "border-slate-300 bg-white"}`}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Urgent</p>
                            <p className="mt-1 text-3xl font-bold text-red-900">{urgentCases.length}</p>
                            <p className="mt-1 text-[11px] text-red-600">need action today</p>
                          </article>
                          <article className={`rounded-xl border-2 p-4 ${underReviewCases.length > 0 ? "border-amber-300 bg-amber-50" : "border-slate-300 bg-white"}`}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Under Review</p>
                            <p className="mt-1 text-3xl font-bold text-amber-900">{underReviewCases.length}</p>
                            <p className="mt-1 text-[11px] text-amber-600">awaiting reviewer</p>
                          </article>
                          <article className="rounded-xl border-2 border-slate-300 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Cases</p>
                            <p className="mt-1 text-3xl font-bold text-slate-900">{visibleCases.length}</p>
                            <p className="mt-1 text-[11px] text-slate-500">all active files</p>
                          </article>
                          <article className="rounded-xl border-2 border-slate-300 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Tasks</p>
                            <p className="mt-1 text-3xl font-bold text-slate-900">{tasks.filter((t) => t.status === "pending").length}</p>
                            <p className="mt-1 text-[11px] text-slate-500">across all team</p>
                          </article>
                        </section>

                        {/* Pipeline summary */}
                        <section className="rounded-xl border border-slate-200 bg-white p-5">
                          <h3 className="text-base font-semibold mb-3">Pipeline</h3>
                          <div className="grid gap-2 grid-cols-2 md:grid-cols-4 text-sm">
                            {([
                              { label: "Docs Pending", status: "docs_pending", color: "text-amber-700" },
                              { label: "Under Review", status: "under_review", color: "text-blue-700" },
                              { label: "Submitted", status: "submitted", color: "text-purple-700" },
                              { label: "Urgent", status: "_urgent", color: "text-red-700" },
                            ] as const).map(({ label, status, color }) => {
                              const count = status === "_urgent"
                                ? visibleCases.filter(c => isUrgentCase(c)).length
                                : visibleCases.filter(c => (c.processingStatus || "docs_pending") === status).length;
                              return (
                                <button key={label} onClick={() => {
                                  if (status !== "_urgent") setCaseStatusFilter(status as any);
                                  setScreen("cases");
                                }} className="rounded-xl border-2 border-slate-100 p-3 text-left hover:border-slate-300 hover:bg-slate-50 transition-all">
                                  <p className="text-xs text-slate-400 font-semibold">{label}</p>
                                  <p className={`text-2xl font-black mt-1 ${color}`}>{count}</p>
                                </button>
                              );
                            })}
                          </div>
                        </section>

                        {/* Team workload */}
                        <section className="rounded-xl border border-slate-200 bg-white p-5">
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-base font-semibold">Team Workload</h3>
                            <button onClick={() => setScreen("settings")} className="text-xs text-slate-500 hover:text-slate-800">View all →</button>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            {teamUsers.filter(u => u.active !== false).map((member) => {
                              const firstName = member.name.split(" ")[0].toLowerCase();
                              const name = member.name;
                              const personCases = visibleCases.filter((c) => c.assignedTo && c.assignedTo.toLowerCase().includes(firstName));
                              const personTasks = tasks.filter((t) => t.status === "pending" && t.assignedTo && t.assignedTo.toLowerCase().includes(firstName));
                              const urgentCnt = personCases.filter((c) => isUrgentCase(c)).length;
                              if (personCases.length === 0 && personTasks.length === 0) return null;
                              return (
                                <div key={name} className="group rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 transition-colors">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                                        {(name||"?").charAt(0).toUpperCase()}
                                      </div>
                                      <p className="text-sm font-semibold text-slate-800">{name.split(" ")[0]}</p>
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px]">
                                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{personCases.length} cases</span>
                                      {personTasks.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">{personTasks.length} tasks</span>}
                                      {urgentCnt > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 font-bold text-red-700">{urgentCnt} urgent</span>}
                                    </div>
                                  </div>
                                  {member && (
                                    <button
                                      onClick={() => { void loadStaffProfile(member.id); setScreen("settings"); }}
                                      className="mt-2 text-[11px] font-medium text-slate-400 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      View profile & notes →
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>

                        {/* Urgent cases */}
                        {urgentCases.length > 0 && (
                          <section className="rounded-2xl border-2 border-red-200 bg-red-50 p-4">
                            <h3 className="text-base font-semibold text-red-900 mb-3">Urgent Cases — Act Today</h3>
                            <div className="space-y-2">
                              {urgentCases.slice(0, 6).map((c) => (
                                <button key={c.id} onClick={() => { setSelectedCaseId(c.id); setScreen("cases"); }}
                                  className="w-full rounded-xl border-2 border-red-300 bg-white p-3 text-left hover:bg-red-50">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="text-sm font-semibold">{c.client}</p>
                                      <p className="text-xs text-slate-500">{c.id} · {c.formType} · {c.assignedTo || "Unassigned"}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {c.leadPhone && (
                                        <button onClick={async e => {
                                          e.stopPropagation();
                                          // Open inbox for this client
                                          setInboxThread(String(c.leadPhone||"").replace(/\D/g,""));
                                          setScreen("inbox");
                                        }} className="rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-600">💬</button>
                                      )}
                                      <span className="text-xs font-semibold text-red-700">Open →</span>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </section>
                        )}

                        {/* Company branding (admin only) */}
                        <section className="rounded-xl border border-slate-200 bg-white p-5">
                          <h3 className="text-base font-semibold">Company Settings</h3>
                          <p className="mt-1 text-xs text-slate-500">Set company name, logo, and main Google Drive folder.</p>
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            <input value={brandAppName} onChange={(e) => setBrandAppName(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none" placeholder="App name" />
                            <input value={brandLogoText} onChange={(e) => setBrandLogoText(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none" placeholder="Header label text" />
                            <input value={brandLogoUrl} onChange={(e) => setBrandLogoUrl(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none" placeholder="Logo image URL (https://...)" />
                            <input value={brandDriveRootLink} onChange={(e) => setBrandDriveRootLink(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none" placeholder="Main Google Drive folder link" />
                          </div>
                          <button onClick={() => void saveBranding()} className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Save Settings</button>
                          {brandStatus ? <p className="mt-2 text-xs text-slate-600">{brandStatus}</p> : null}
                        </section>
                      </>
                    )}

                    {/* ── MARKETING workspace ── */}
                    {isMarketing && (
                      <>
                        <section className="grid gap-3 grid-cols-2 md:grid-cols-3">
                          <article className="rounded-xl border-2 border-slate-300 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Cases</p>
                            <p className="mt-1 text-3xl font-bold text-slate-900">{visibleCases.length}</p>
                            <p className="mt-1 text-[11px] text-slate-500">all files</p>
                          </article>
                          <article className="rounded-xl border-2 border-teal-200 bg-teal-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">New This Month</p>
                            <p className="mt-1 text-3xl font-bold text-teal-900">
                              {visibleCases.filter((c) => c.createdAt && c.createdAt.startsWith(today.slice(0, 7))).length}
                            </p>
                            <p className="mt-1 text-[11px] text-teal-600">cases created</p>
                          </article>
                          <article className="rounded-xl border-2 border-slate-300 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">My Tasks</p>
                            <p className="mt-1 text-3xl font-bold text-slate-900">{myPendingTasks.length}</p>
                            <p className="mt-1 text-[11px] text-slate-500">pending</p>
                          </article>
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-5">
                          <h3 className="text-base font-semibold mb-3">Quick Actions</h3>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => setScreen("communications")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">+ Create New Case</button>
                            <button onClick={() => void syncLeadsFromSheet()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Sync Leads from Sheet</button>
                            <button onClick={() => setScreen("cases")} className="rounded-lg border-2 border-slate-300 px-4 py-2 text-sm font-semibold">View All Cases</button>
                          </div>
                          {leadSyncStatus ? <p className="mt-2 text-xs text-slate-700">{leadSyncStatus}</p> : null}
                        </section>

                        {/* Recent cases */}
                        <section className="rounded-xl border border-slate-200 bg-white p-5">
                          <h3 className="text-base font-semibold mb-3">Recent Cases</h3>
                          <div className="space-y-2">
                            {visibleCases.slice(0, 8).map((c) => (
                              <button key={c.id} onClick={() => { setSelectedCaseId(c.id); setScreen("cases"); }}
                                className="w-full rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-semibold">{c.client}</p>
                                    <p className="text-xs text-slate-500">{c.id} · {c.formType} · {c.stage}</p>
                                  </div>
                                  <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                                    c.stage === "Decision" ? "bg-emerald-100 text-emerald-700" :
                                    c.stage === "Submitted" ? "bg-blue-100 text-blue-700" :
                                    isUrgentCase(c) ? "bg-red-100 text-red-700" :
                                    "bg-slate-100 text-slate-600"
                                  }`}>{isUrgentCase(c) ? "URGENT" : c.stage}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </section>

                        {myPendingTasks.length > 0 && (
                          <section className="rounded-xl border border-slate-200 bg-white p-5">
                            <h3 className="text-base font-semibold mb-3">My Tasks</h3>
                            <div className="space-y-2">
                              {myPendingTasks.map((t) => (
                                <div key={t.id} className="rounded-lg border border-slate-200 p-3 flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold">{t.title}</p>
                                    <p className="text-[11px] text-slate-500">{t.caseId !== "GENERAL" ? t.caseId : "General"} · {t.priority}</p>
                                  </div>
                                  <button onClick={() => void markTaskCompleted(t.id)} className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Done</button>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                      </>
                    )}

                    {/* ── UNDER REVIEW queue (visible to Admin + ProcessingLead + Reviewer) ── */}
                    {(isAdmin || myRole === "ProcessingLead" || isReviewer) && underReviewCases.length > 0 && !isAdmin && (
                      <section className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
                        <h3 className="text-base font-semibold text-amber-900 mb-3">Under Review Queue ({underReviewCases.length})</h3>
                        <div className="space-y-2">
                          {underReviewCases.map((c) => (
                            <button key={c.id} onClick={() => { setSelectedCaseId(c.id); setScreen("cases"); }}
                              className="w-full rounded-xl border-2 border-amber-300 bg-white p-3 text-left hover:bg-amber-50">
                              <p className="text-sm font-semibold">{c.client}</p>
                              <p className="text-xs text-slate-500">{c.id} · {c.formType} · {c.assignedTo || "—"}</p>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}

                  </>
                );
              })()}
            </>
          ) : null}
          {screen === "settings" ? (
            <>
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-base font-semibold">Company Branding</h3>
                <p className="mt-1 text-xs text-slate-500">Set company name, logo, and main Google Drive link.</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <input value={brandAppName} onChange={(e) => setBrandAppName(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none" placeholder="App name" />
                  <input value={brandLogoText} onChange={(e) => setBrandLogoText(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none" placeholder="Header label text" />
                  <input value={brandLogoUrl} onChange={(e) => setBrandLogoUrl(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none" placeholder="Logo image URL (https://...)" />
                  <input value={brandDriveRootLink} onChange={(e) => setBrandDriveRootLink(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none" placeholder="Main Google Drive folder link" />
                </div>
                <button onClick={() => void saveBranding()} className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                  Save Branding
                </button>
                {brandStatus ? <p className="mt-2 text-xs text-slate-600">{brandStatus}</p> : null}
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-base font-semibold">Customize Client Portal</h3>
                <p className="mt-1 text-xs text-slate-500">Add/edit/remove custom sections shown automatically in client portal.</p>
                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  <input
                    value={newCustomSectionTitle}
                    onChange={(e) => setNewCustomSectionTitle(e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                    placeholder="Section title"
                  />
                  <select
                    value={newCustomSectionFieldType}
                    onChange={(e) => setNewCustomSectionFieldType(e.target.value as CustomPortalSection["fieldType"])}
                    className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                  >
                    {PORTAL_FIELD_TYPES.map((type) => (
                      <option key={`new-ft-settings-${type}`} value={type}>{type}</option>
                    ))}
                  </select>
                  <select
                    value={newCustomSectionVisibleFor}
                    onChange={(e) => setNewCustomSectionVisibleFor(e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                  >
                    {PORTAL_VISIBILITY_OPTIONS.map((item) => (
                      <option key={`new-vis-settings-${item}`} value={item}>{item}</option>
                    ))}
                  </select>
                  <input
                    value={newCustomSectionBody}
                    onChange={(e) => setNewCustomSectionBody(e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                    placeholder="Section body"
                  />
                  <input
                    value={newCustomSectionOptions}
                    onChange={(e) => setNewCustomSectionOptions(e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none md:col-span-4"
                    placeholder="Dropdown options (comma separated, optional)"
                  />
                </div>
                <button onClick={addCustomPortalSection} className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">
                  Add Section
                </button>
                <div className="mt-3 space-y-2">
                  {brandCustomSections.map((section, idx) => (
                    <article key={section.id} className="rounded border border-slate-200 p-2">
                      <div className="grid gap-2 md:grid-cols-5">
                        <input
                          value={section.title}
                          onChange={(e) => updateCustomPortalSection(idx, { title: e.target.value })}
                          className="rounded border border-slate-300 px-2 py-2 text-xs"
                        />
                        <select
                          value={section.fieldType || "text"}
                          onChange={(e) => updateCustomPortalSection(idx, { fieldType: e.target.value as CustomPortalSection["fieldType"] })}
                          className="rounded border border-slate-300 px-2 py-2 text-xs"
                        >
                          {PORTAL_FIELD_TYPES.map((type) => (
                            <option key={`${section.id}-settings-ft-${type}`} value={type}>{type}</option>
                          ))}
                        </select>
                        <select
                          value={(section.visibleFor && section.visibleFor[0]) || "all"}
                          onChange={(e) => updateCustomPortalSection(idx, { visibleFor: [e.target.value] })}
                          className="rounded border border-slate-300 px-2 py-2 text-xs"
                        >
                          {PORTAL_VISIBILITY_OPTIONS.map((item) => (
                            <option key={`${section.id}-settings-vis-${item}`} value={item}>{item}</option>
                          ))}
                        </select>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={section.enabled !== false}
                            onChange={(e) => updateCustomPortalSection(idx, { enabled: e.target.checked })}
                          />
                          Enabled
                        </label>
                        <div className="flex items-center gap-1">
                          <button onClick={() => moveCustomPortalSection(idx, -1)} className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold">Up</button>
                          <button onClick={() => moveCustomPortalSection(idx, 1)} className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold">Down</button>
                        </div>
                      </div>
                      <textarea
                        value={section.body}
                        onChange={(e) => updateCustomPortalSection(idx, { body: e.target.value })}
                        className="mt-2 w-full rounded border border-slate-300 px-2 py-2 text-xs"
                        rows={3}
                      />
                      {(section.fieldType || "text") === "dropdown" ? (
                        <input
                          value={(section.options || []).join(", ")}
                          onChange={(e) =>
                            updateCustomPortalSection(idx, {
                              options: e.target.value
                                .split(",")
                                .map((v) => v.trim())
                                .filter(Boolean)
                            })
                          }
                          className="mt-2 w-full rounded border border-slate-300 px-2 py-2 text-xs"
                          placeholder="Dropdown options (comma separated)"
                        />
                      ) : null}
                      <button
                        onClick={() => removeCustomPortalSection(idx)}
                        className="mt-2 rounded border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700"
                      >
                        Remove
                      </button>
                    </article>
                  ))}
                  {brandCustomSections.length === 0 ? <p className="text-xs text-slate-500">No custom sections yet.</p> : null}
                </div>
                <p className="mt-2 text-xs text-slate-600">Save Branding to publish changes.</p>
                <div className="mt-3 rounded border border-slate-200 p-2">
                  <p className="text-xs font-semibold text-slate-700">Version History</p>
                  <div className="mt-2 max-h-36 space-y-2 overflow-auto">
                    {brandCustomSectionHistory.slice(0, 8).map((version) => (
                      <div key={version.id} className="flex items-center justify-between rounded border border-slate-200 p-2 text-xs">
                        <p>
                          {new Date(version.createdAt).toLocaleString()} {version.actorName ? `• ${version.actorName}` : ""}
                        </p>
                        <button
                          onClick={() => void rollbackCustomPortalSections(version.id)}
                          className="rounded border border-slate-300 px-2 py-1 font-semibold"
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                    {brandCustomSectionHistory.length === 0 ? (
                      <p className="text-xs text-slate-500">No previous versions.</p>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-base font-semibold">System Checks</h3>
                <p className="mt-1 text-xs text-slate-500">Run readiness and security checks before team operations.</p>
                <button
                  onClick={() => void runDiagnosticsBot()}
                  className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                >
                  Run Security Bot
                </button>
                {diagnosticsStatus ? <p className="mt-2 text-xs text-slate-700">{diagnosticsStatus}</p> : null}
              </section>

              {sessionUser?.userType === "staff" && sessionUser.role === "Admin" ? (
                <section className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold">Audit Trail</h3>
                      <p className="mt-1 text-xs text-slate-500">Immutable latest security and data-change events.</p>
                    </div>
                    <button
                      onClick={downloadAuditCsv}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Export CSV
                    </button>
                  </div>
                  <div className="mt-2 max-h-52 space-y-2 overflow-auto rounded border border-slate-200 p-2 text-xs">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="rounded border border-slate-200 p-2">
                        <p className="font-semibold">{log.action}</p>
                        <p className="text-slate-500">
                          {new Date(log.createdAt).toLocaleString()} • {log.actorName}
                          {log.actorUserId ? ` (${log.actorUserId})` : ""}
                        </p>
                        <p className="text-slate-500">
                          {log.resourceType || "resource"} • {log.resourceId}
                        </p>
                      </div>
                    ))}
                    {auditLogs.length === 0 ? <p className="text-slate-500">No audit entries found.</p> : null}
                  </div>
                  {auditStatus ? <p className="mt-2 text-xs text-slate-700">{auditStatus}</p> : null}
                </section>
              ) : null}

              {sessionUser?.userType === "staff" && canManageUsers(sessionUser.role) ? (
                <div className="space-y-4">

                  {/* ── Add team member ── */}
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900">
                        <Users size={15} className="text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Team Management</p>
                        <p className="text-xs text-slate-500">Add staff accounts and manage access</p>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-5">
                      <input
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                        placeholder="Full name"
                      />
                      <input
                        value={teamEmail}
                        onChange={(e) => setTeamEmail(e.target.value)}
                        className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                        placeholder="Email"
                      />
                      <select
                        value={teamRole}
                        onChange={(e) => setTeamRole(e.target.value as Role)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                      >
                        <option value="Marketing">Marketing</option>
                        <option value="Processing">Processing</option>
                        <option value="ProcessingLead">Processing Lead</option>
                        <option value="Reviewer">Reviewer</option>
                        <option value="Admin">Admin</option>
                      </select>
                      <input
                        value={teamPassword}
                        onChange={(e) => setTeamPassword(e.target.value)}
                        className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                        placeholder="Temporary password"
                      />
                      <input
                        value={teamDriveLink}
                        onChange={(e) => setTeamDriveLink(e.target.value)}
                        className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none md:col-span-2"
                        placeholder="Workspace Drive folder link (optional)"
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => void addTeamMember()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                        Add Team Member
                      </button>
                      <button onClick={() => void syncNewtonTeamPreset()} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                        Sync Newton Preset
                      </button>
                    </div>
                    {teamStatus ? <p className="mt-2 text-sm text-slate-600">{teamStatus}</p> : null}
                  </div>

                  {/* ── Staff profiles ── */}
                  {teamUsers.filter((u) => u.id).length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <div className="border-b border-slate-100 px-5 py-4">
                        <p className="text-sm font-semibold text-slate-900">Staff Profiles</p>
                        <p className="text-xs text-slate-500 mt-0.5">Click any member to view their cases, performance, and leave team notes.</p>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {teamUsers.filter((u) => u.id).map((member) => {
                          const memberCases = cases.filter((c) => String(c.assignedTo || "").toLowerCase() === member.name.toLowerCase());
                          const urgentCount = memberCases.filter((c) => isUrgentCase(c)).length;
                          const isOpen = staffProfileUserId === member.id;
                          const noteCount = staffNoteCounts[member.id] || 0;
                          const roleColor: Record<string, string> = {
                            Admin: "bg-purple-50 text-purple-700 border-purple-200",
                            Processing: "bg-blue-50 text-blue-700 border-blue-200",
                            ProcessingLead: "bg-indigo-50 text-indigo-700 border-indigo-200",
                            Marketing: "bg-pink-50 text-pink-700 border-pink-200",
                            Reviewer: "bg-amber-50 text-amber-700 border-amber-200",
                          };
                          const roleCls = roleColor[member.role] || "bg-slate-50 text-slate-700 border-slate-200";

                          return (
                            <div key={member.id}>
                              {/* Member row */}
                              <div className={`flex items-center justify-between px-5 py-4 transition-colors ${isOpen ? "bg-slate-50" : "hover:bg-slate-50"}`}>
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="relative flex-shrink-0">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                                      {(member.name||"?").charAt(0).toUpperCase()}
                                    </div>
                                    {member.active === false && (
                                      <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-slate-300" />
                                    )}
                                    {member.active !== false && (
                                      <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-400" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-semibold text-slate-900 truncate">{member.name}</p>
                                      {member.id === sessionUser?.id && (
                                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">you</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${roleCls}`}>{member.role}</span>
                                      <span className="text-[11px] text-slate-400">{memberCases.length} case{memberCases.length !== 1 ? "s" : ""}</span>
                                      {urgentCount > 0 && <span className="text-[11px] font-semibold text-red-600">{urgentCount} urgent</span>}
                                      {noteCount > 0 && (
                                        <span className="text-[11px] font-medium text-amber-600">
                                          {noteCount} note{noteCount !== 1 ? "s" : ""}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  onClick={() => {
                                    if (isOpen) {
                                      setStaffProfileUserId(null);
                                    } else {
                                      void loadStaffProfile(member.id);
                                    }
                                  }}
                                  className={`ml-4 flex-shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                                    isOpen
                                      ? "border-slate-900 bg-slate-900 text-white"
                                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                                  }`}
                                >
                                  {isOpen ? "Close ↑" : "View Profile"}
                                </button>
                              </div>

                              {/* Inline profile panel */}
                              {isOpen && (() => {
                                const mCases = cases.filter((c) => String(c.assignedTo || "").toLowerCase() === member.name.toLowerCase());
                                const urgentCnt = mCases.filter((c) => isUrgentCase(c)).length;
                                const reviewCnt = mCases.filter((c) => (c.processingStatus || "") === "under_review").length;
                                const submittedCnt = mCases.filter((c) => (c.processingStatus || "") === "submitted").length;
                                const currentDraft = staffNoteDrafts[member.id] || "";

                                return (
                                  <div className="border-t border-slate-100 bg-white">
                                    {/* Stats strip */}
                                    <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
                                      <div className="px-4 py-3 text-center">
                                        <p className="text-2xl font-bold text-slate-900">{mCases.length}</p>
                                        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Open Cases</p>
                                      </div>
                                      <div className="px-4 py-3 text-center bg-red-50">
                                        <p className="text-2xl font-bold text-red-700">{urgentCnt}</p>
                                        <p className="text-[10px] font-medium uppercase tracking-wide text-red-400">Urgent</p>
                                      </div>
                                      <div className="px-4 py-3 text-center bg-amber-50">
                                        <p className="text-2xl font-bold text-amber-700">{reviewCnt}</p>
                                        <p className="text-[10px] font-medium uppercase tracking-wide text-amber-400">In Review</p>
                                      </div>
                                      <div className="px-4 py-3 text-center bg-emerald-50">
                                        <p className="text-2xl font-bold text-emerald-700">{submittedCnt}</p>
                                        <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-400">Submitted</p>
                                      </div>
                                    </div>

                                    <div className="grid gap-0 lg:grid-cols-2 divide-x divide-slate-100">
                                      {/* Left: active cases */}
                                      <div className="p-5">
                                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Active Cases</p>
                                        {mCases.length === 0 ? (
                                          <p className="text-sm text-slate-400">No cases assigned.</p>
                                        ) : (
                                          <div className="space-y-2">
                                            {mCases.slice(0, 6).map((c) => (
                                              <button
                                                key={c.id}
                                                onClick={() => { setSelectedCaseId(c.id); setScreen("cases"); setCaseBoardView("all_cases"); setStaffProfileUserId(null); }}
                                                className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-left hover:shadow-sm transition-all ${
                                                  isUrgentCase(c) ? "border-red-200 bg-red-50 hover:border-red-300" : "border-slate-200 bg-white hover:border-slate-300"
                                                }`}
                                              >
                                                <div>
                                                  <p className="text-sm font-medium text-slate-900">{c.client}</p>
                                                  <p className="text-xs text-slate-400 mt-0.5">{c.id} · {c.formType}</p>
                                                </div>
                                                <div className="text-right ml-2 flex-shrink-0">
                                                  {isUrgentCase(c) ? (
                                                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">URGENT</span>
                                                  ) : (
                                                    <span className="text-[11px] text-slate-400">{c.processingStatus || "docs_pending"}</span>
                                                  )}
                                                </div>
                                              </button>
                                            ))}
                                            {mCases.length > 6 && (
                                              <p className="text-xs text-slate-400 pt-1">+{mCases.length - 6} more cases</p>
                                            )}
                                          </div>
                                        )}

                                        {/* Admin actions */}
                                        {sessionUser?.role === "Admin" && (
                                          <div className="mt-5 pt-4 border-t border-slate-100">
                                            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Admin Actions</p>
                                            <div className="space-y-2">
                                              <div className="flex gap-2">
                                                <input
                                                  value={teamPasswordDrafts[member.id] || ""}
                                                  onChange={(e) => setTeamPasswordDrafts((prev) => ({ ...prev, [member.id]: e.target.value }))}
                                                  placeholder="New password"
                                                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                                                />
                                                <button
                                                  onClick={() => void resetTeamMemberPassword(member.id)}
                                                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                                >
                                                  Reset Password
                                                </button>
                                              </div>
                                              <div className="flex gap-2">
                                                <button
                                                  onClick={() => void setTeamMemberActive(member.id, member.active === false)}
                                                  className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                                                    member.active === false
                                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                                      : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                                  }`}
                                                >
                                                  {member.active === false ? "Reactivate Account" : "Deactivate Account"}
                                                </button>
                                                {member.mfaEnabled && (
                                                  <button
                                                    onClick={() => void resetTeamMemberMfa(member.id)}
                                                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                                  >
                                                    Reset MFA
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                      {/* Right: notes */}
                                      <div className="p-5">
                                        <div className="flex items-center justify-between mb-3">
                                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                            Team Notes on {member.name.split(" ")[0]}
                                          </p>
                                          {staffProfileNotes.length > 0 && (
                                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                              {staffProfileNotes.length} note{staffProfileNotes.length !== 1 ? "s" : ""}
                                            </span>
                                          )}
                                        </div>

                                        {/* Compose */}
                                        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                                          <textarea
                                            value={currentDraft}
                                            onChange={(e) => setStaffNoteDrafts((prev) => ({ ...prev, [member.id]: e.target.value }))}
                                            placeholder={`Leave a note on ${member.name.split(" ")[0]}… e.g. "Always double-check permit expiry before flagging urgent."`}
                                            rows={3}
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm placeholder-slate-400 focus:border-slate-400 focus:outline-none resize-none"
                                          />
                                          <div className="mt-2.5 flex items-center gap-3">
                                            <button
                                              onClick={() => void postStaffNote()}
                                              disabled={!currentDraft.trim()}
                                              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40 transition-opacity"
                                            >
                                              Leave Note
                                            </button>
                                            {staffNoteStatus === "saved" && (
                                              <span className="text-xs font-medium text-emerald-700">✓ Note saved</span>
                                            )}
                                            {staffNoteStatus && staffNoteStatus !== "saved" && staffNoteStatus !== "Saving..." && (
                                              <span className="text-xs font-medium text-red-600">{staffNoteStatus}</span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Note feed */}
                                        {staffProfileNotes.length === 0 ? (
                                          <div className="rounded-xl border border-slate-100 py-10 text-center">
                                            <p className="text-sm text-slate-400">No notes yet</p>
                                            <p className="mt-1 text-xs text-slate-300">Flag errors, training reminders, or review feedback here.</p>
                                          </div>
                                        ) : (
                                          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                                            {staffProfileNotes.map((note) => {
                                              const isMyNote = sessionUser?.id === note.authorId;
                                              const isAdmin = sessionUser?.role === "Admin";
                                              const d = new Date(note.createdAt);
                                              const ago = (() => {
                                                const diff = Date.now() - d.getTime();
                                                if (diff < 60000) return "just now";
                                                if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
                                                if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
                                                return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
                                              })();
                                              return (
                                                <div key={note.id} className="rounded-xl border border-slate-200 bg-white p-4">
                                                  <div className="flex items-start justify-between gap-2">
                                                    <div className="flex items-start gap-2.5 min-w-0">
                                                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                                                        {(note.authorName||"?").charAt(0).toUpperCase()}
                                                      </div>
                                                      <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                                                          <p className="text-xs font-semibold text-slate-800">{note.authorName}</p>
                                                          {isMyNote && (
                                                            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700">you</span>
                                                          )}
                                                          <p className="text-[10px] text-slate-400">{ago}</p>
                                                        </div>
                                                        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{note.text}</p>
                                                      </div>
                                                    </div>
                                                    {(isMyNote || isAdmin) && (
                                                      <button
                                                        onClick={() => void deleteStaffProfileNote(note.id)}
                                                        className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
                                                      >
                                                        ✕
                                                      </button>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

            </>
          ) : null}

          {screen === "cases" ? (
            <div className="space-y-4">
              {caseBoardView === "home" ? (
                <>
                  {/* Page header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">Cases</h2>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {sessionUser?.role === "Processing"
                          ? `${visibleCases.length} cases assigned to you`
                          : `${visibleCases.length} total cases`}
                      </p>
                    </div>
                    {canCreateCase(sessionUser?.role || "Client") && (
                      <button onClick={() => setScreen("communications")} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                        + New Case
                      </button>
                    )}
                  </div>
                  {sessionUser?.role === "Processing" && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 font-medium">
                      👤 Showing only cases assigned to <strong>{sessionUser.name.split(" ")[0]}</strong>
                    </div>
                  )}

                  {/* Queue cards */}
                  <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
                    <button onClick={() => setCaseBoardView("new_cases")} className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-300 hover:shadow-sm transition-all">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">New</p>
                      <p className="mt-1.5 text-3xl font-bold text-slate-900">{newCasesList.length}</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">New Cases</p>
                    </button>
                    <button onClick={() => setCaseBoardView("assigned_cases")} className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-300 hover:shadow-sm transition-all">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Active</p>
                      <p className="mt-1.5 text-3xl font-bold text-slate-900">{assignedCasesList.length}</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">Assigned</p>
                    </button>
                    <button onClick={() => setCaseBoardView("under_review_cases")} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left hover:border-amber-300 hover:shadow-sm transition-all">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">Review</p>
                      <p className="mt-1.5 text-3xl font-bold text-amber-900">{underReviewCasesList.length}</p>
                      <p className="mt-1 text-xs font-medium text-amber-600">Under Review</p>
                    </button>
                    <button onClick={() => setCaseBoardView("all_cases")} className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-300 hover:shadow-sm transition-all">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">All</p>
                      <p className="mt-1.5 text-3xl font-bold text-slate-900">{visibleCases.length}</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">All Cases</p>
                    </button>
                    <button onClick={() => setCaseBoardView("urgent_cases")} className="rounded-xl border border-red-200 bg-red-50 p-4 text-left hover:border-red-300 hover:shadow-sm transition-all">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-red-400">Urgent</p>
                      <p className="mt-1.5 text-3xl font-bold text-red-800">{visibleCases.filter((c) => isUrgentCase(c)).length}</p>
                      <p className="mt-1 text-xs font-medium text-red-600">Urgent</p>
                    </button>
                  </div>

                  {/* Today's focus — urgent cases preview */}
                  {visibleCases.filter((c) => isUrgentCase(c)).length > 0 && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-red-600">Urgent — needs attention today</p>
                      <div className="space-y-2">
                        {visibleCases.filter((c) => isUrgentCase(c)).slice(0, 4).map((c) => (
                          <button
                            key={c.id}
                            onClick={() => { setSelectedCaseId(c.id); setCaseBoardView("all_cases"); }}
                            className="flex w-full items-center justify-between rounded-lg border border-red-200 bg-white px-4 py-3 hover:bg-red-50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-700">
                                {(c.client||"?").charAt(0).toUpperCase()}
                              </div>
                              <div className="text-left">
                                <p className="text-sm font-semibold text-slate-900">{c.client}</p>
                                <p className="text-xs text-slate-500">{c.id} · {c.formType}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-medium text-slate-600">{c.assignedTo || "Unassigned"}</p>
                              <p className="text-xs text-red-600 font-medium">{c.stage}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button onClick={() => setCaseBoardView("home")} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                        ← Back
                      </button>
                      <h2 className="text-lg font-semibold text-slate-900">
                        {caseBoardView === "new_cases" ? "New Cases"
                          : caseBoardView === "assigned_cases" ? "Assigned Cases"
                          : caseBoardView === "under_review_cases" ? "Under Review"
                          : caseBoardView === "urgent_cases" ? "Urgent Cases"
                          : "All Cases"}
                      </h2>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <input
                      value={caseSearch}
                      onChange={(e) => setCaseSearch(e.target.value)}
                      className="flex-1 min-w-[200px] rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-2.5 text-sm focus:border-slate-300 focus:bg-white focus:outline-none"
                      placeholder="Search name, case ID, app type..."
                    />
                    <select
                      value={caseAssignedFilter}
                      onChange={(e) => setCaseAssignedFilter(e.target.value)}
                      className="rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm focus:border-slate-300 focus:outline-none"
                    >
                      <option value="all">All team</option>
                      {processingAssigneeOptions.filter(m => m !== "Unassigned").map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={caseStatusFilter}
                      onChange={(e) => setCaseStatusFilter(e.target.value as "all"|"docs_pending"|"under_review"|"submitted"|"other")}
                      className="rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm focus:border-slate-300 focus:outline-none"
                    >
                      <option value="all">All status</option>
                      <option value="docs_pending">Docs Pending</option>
                      <option value="under_review">Under Review</option>
                      <option value="submitted">Submitted</option>
                    </select>
                  </div>
                  <div className="mt-3 space-y-2 max-h-[58vh] overflow-auto pr-1">
                    {activeCaseBoardListFiltered.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedCaseId(c.id)}
                        className={`w-full rounded-xl border p-4 text-left transition-all hover:shadow-sm ${
                          selectedCase?.id === c.id
                            ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                            : isUrgentCase(c)
                            ? "border-red-200 bg-red-50 hover:border-red-300"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                              selectedCase?.id === c.id ? "bg-white text-slate-900" : isUrgentCase(c) ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"
                            }`}>
                              {(c.client||"?").charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className={`font-semibold text-sm truncate ${selectedCase?.id === c.id ? "text-white" : "text-slate-900"}`}>{c.client}</p>
                                {isUrgentCase(c) && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-700 shrink-0">URGENT</span>}
                                {(c as any).reviewStatus === "changes_needed" && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-black text-white shrink-0">⚠️ CHANGES</span>}
                                {(c as any).reviewStatus === "changes_done" && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-700 shrink-0">✅ REVIEW DONE</span>}
                              </div>
                              <p className={`text-xs mt-0.5 truncate ${selectedCase?.id === c.id ? "text-slate-300" : "text-slate-400"}`}>
                                {c.formType}
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              selectedCase?.id === c.id ? "bg-white/20 text-white" : processingStatusChipClass(c.processingStatus || "docs_pending")
                            }`}>
                              {c.processingStatus === "other" ? prettyStatus(c.processingStatusOther || "other") : prettyStatus(c.processingStatus || "docs_pending")}
                            </span>
                            <p className={`text-[10px] mt-1 ${selectedCase?.id === c.id ? "text-slate-400" : "text-slate-400"}`}>
                              {c.assignedTo || "Unassigned"}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                    {activeCaseBoardListFiltered.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 bg-white py-12 text-center">
                        <p className="text-sm text-slate-500">No cases in this view.</p>
                      </div>
                    ) : null}
                  </div>
                  {caseActionStatus ? <p className="mt-2 text-sm text-slate-600">{caseActionStatus}</p> : null}
                </>
              )}

              {selectedCase ? (
                <>
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
                    {/* Case detail sticky header */}
                    <div className="sticky top-14 z-10 border-b border-slate-100 bg-white">
                      {/* Top bar — name + status */}
                      <div className="px-5 pt-4 pb-3">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white ${isUrgentCase(selectedCase) ? "bg-red-600" : "bg-slate-900"}`}>
                              {(selectedCase.client||"?").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-base font-bold text-slate-900">{selectedCase.client}</p>
                                {isUrgentCase(selectedCase) && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">🔴 URGENT</span>}
                              </div>
                              <p className="text-xs text-slate-400 mt-0.5">{selectedCase.id} · {selectedCase.formType} · {selectedCase.leadPhone || "No phone"}</p>
                            </div>
                          </div>
                          {/* Status pills + assign */}
                          <div className="flex flex-wrap items-center gap-2">
                            <select value={selectedCase.processingStatus || "docs_pending"}
                              onChange={async (e) => {
                                const newStatus = e.target.value as "docs_pending"|"under_review"|"submitted"|"other";
                                if (newStatus === "under_review") {
                                  // Just change status — reviewer will claim it from UR panel
                                  await updateCaseProcessing(selectedCase.id, { 
                                    processingStatus: newStatus,
                                    reviewedBy: "",
                                    reviewStatus: "",
                                    reviewStartedAt: new Date().toISOString()
                                  });
                                } else {
                                  await updateCaseProcessing(selectedCase.id, { processingStatus: newStatus });
                                }
                              }}
                              className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold focus:outline-none ${processingStatusChipClass(selectedCase.processingStatus || "docs_pending")}`}>
                              <option value="docs_pending">Docs Pending</option>
                              <option value="under_review">Under Review</option>
                              <option value="submitted">Submitted</option>
                              <option value="other">Other</option>
                            </select>
                            {selectedCase.processingStatus === "under_review" && (
                              <button onClick={() => setShowURPanel(selectedCase.id)}
                                className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 hover:bg-amber-200">
                                {(selectedCase as any).reviewedBy ? "👁 " + (selectedCase as any).reviewedBy : "👁 Under Review"}
                                {" "}{(selectedCase as any).reviewStatus === "changes_needed" ? "⚠️" : (selectedCase as any).reviewStatus === "changes_done" ? "✅" : ""}
                              </button>
                            )}
                            <select value={String(selectedCase.assignedTo || "Unassigned")}
                              onChange={(e) => void updateCaseProcessing(selectedCase.id, { assignedTo: e.target.value })}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none">
                              {processingAssigneeOptions.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            {selectedCase.leadPhone && (
                              <button onClick={() => {
                                setInboxThread(String(selectedCase.leadPhone||"").replace(/\D/g,""));
                                setScreen("inbox");
                              }} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
                                💬 Message
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Progress bar — intake completion */}
                        {(() => {
                          const intake = selectedCase.pgwpIntake as Record<string,string> | undefined;
                          const filled = intake ? Object.values(intake).filter(v => String(v||"").trim()).length : 0;
                          const total = 12;
                          const pct = Math.min(100, Math.round((filled/total)*100));
                          const docsCount = documents.filter(d => d.caseId === selectedCase.id).length;
                          const tasksTotal = caseTasks.length;
                          const tasksDone = caseTasks.filter(t => t.status === "completed").length;
                          return (
                            <div className="mt-3 grid grid-cols-3 gap-2">
                              <div className="rounded-lg bg-slate-50 px-3 py-2">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Intake</p>
                                  <p className="text-[10px] font-bold text-slate-700">{pct}%</p>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                                  <div className={`h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{width:`${pct}%`}} />
                                </div>
                              </div>
                              <div className="rounded-lg bg-slate-50 px-3 py-2">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Documents</p>
                                  <p className="text-[10px] font-bold text-slate-700">{docsCount}</p>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                                  <div className={`h-full rounded-full ${docsCount >= 5 ? "bg-emerald-500" : docsCount >= 2 ? "bg-amber-400" : "bg-red-400"}`} style={{width:`${Math.min(100,docsCount*15)}%`}} />
                                </div>
                              </div>
                              <div className="rounded-lg bg-slate-50 px-3 py-2">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Tasks</p>
                                  <p className="text-[10px] font-bold text-slate-700">{tasksDone}/{tasksTotal}</p>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                                  <div className={`h-full rounded-full ${tasksTotal > 0 && tasksDone === tasksTotal ? "bg-emerald-500" : "bg-amber-400"}`} style={{width:tasksTotal > 0 ? `${Math.round((tasksDone/tasksTotal)*100)}%` : "0%"}} />
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Quick action buttons */}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <button onClick={() => void runCaseNextAction(selectedCase)}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700">
                            {getCaseNextAction(selectedCase).label}
                          </button>
                          <button onClick={() => setCaseDetailTab("communication")}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                            💬 Message
                          </button>
                          <button onClick={() => void runAiIntakeCheck(true)}
                            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                            🤖 AI Check
                          </button>
                          <button onClick={async () => {
                            setAiLoading(true);
                            const res = await apiFetch(`/cases/${selectedCase.id}/ai-smart`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"summary"})}).catch(()=>null);
                            const d = await res?.json().catch(()=>({}));
                            setAiResult({caseId:selectedCase.id, text:d?.text||"Failed to generate summary", action:"summary"});
                            setAiLoading(false);
                          }} disabled={aiLoading} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">
                            {aiLoading ? "..." : "📋 Summary"}
                          </button>
                          <button onClick={async () => {
                            setAiLoading(true);
                            const res = await apiFetch(`/cases/${selectedCase.id}/ai-smart`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"draft_notes"})}).catch(()=>null);
                            const d = await res?.json().catch(()=>({}));
                            setAiResult({caseId:selectedCase.id, text:d?.text||"Failed", action:"draft_notes"});
                            setAiLoading(false);
                          }} disabled={aiLoading} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                            {aiLoading ? "..." : "✍️ Draft Notes"}
                          </button>
                          <button onClick={() => void runAutofill()} disabled={autofillRunning}
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                            {autofillRunning ? "Filling…" : "✨ Autofill"}
                          </button>
                          <button onClick={() => void syncToSheets()} disabled={sheetSyncRunning}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                            {sheetSyncRunning ? "Syncing…" : "↗ Sheets"}
                          </button>
                          <button onClick={async () => {
                            setAiLoading(true);
                            const res = await apiFetch(`/cases/${selectedCase.id}/ai-smart`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"overdue_check"})}).catch(()=>null);
                            const d = await res?.json().catch(()=>({}));
                            setAiResult({caseId:selectedCase.id, text:d?.text||"Failed", action:"overdue_check"});
                            setAiLoading(false);
                          }} disabled={aiLoading} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                            {aiLoading ? "..." : "⚡ Urgency"}
                          </button>
                        </div>
                      </div>

                      {/* Tab bar */}
                      <div className="flex gap-0 border-t border-slate-100 px-2">
                        {([
                          {id:"overview", icon:"📋", label:"Overview"},
                          {id:"profile",  icon:"👤", label:"Profile"},
                          {id:"documents",icon:"📎", label:"Docs"},
                          {id:"tasks",    icon:"✅", label:"Tasks"},
                          {id:"ai",       icon:"🤖", label:"Ask AI"},
                          {id:"communication",icon:"💬",label:"Chat"},
                          {id:"notes",    icon:"📝", label:"Notes"},
                        ] as const).map(tab => (
                          <button key={tab.id} onClick={() => setCaseDetailTab(tab.id)}
                            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                              caseDetailTab === tab.id
                                ? "border-slate-900 text-slate-900"
                                : "border-transparent text-slate-400 hover:text-slate-700"
                            }`}>
                            {tab.icon} {tab.label}
                            {tab.id === "tasks" && caseTasks.filter(t=>t.status!=="completed").length > 0 && (
                              <span className="rounded-full bg-amber-100 px-1.5 text-[9px] font-bold text-amber-700">{caseTasks.filter(t=>t.status!=="completed").length}</span>
                            )}
                            {tab.id === "documents" && documents.filter(d=>d.caseId===selectedCase.id).length > 0 && (
                              <span className="rounded-full bg-blue-100 px-1.5 text-[9px] font-bold text-blue-700">{documents.filter(d=>d.caseId===selectedCase.id).length}</span>
                            )}
                {tab.id === "notes" && (caseNotes[selectedCase.id]||[]).length > 0 && (
                              <span className="rounded-full bg-amber-100 px-1.5 text-[9px] font-bold text-amber-700">{(caseNotes[selectedCase.id]||[]).length}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="p-5">

                    {caseDetailTab === "profile" ? (
                      <div className="mt-3 space-y-3 text-xs">
                        <div className="grid gap-2 md:grid-cols-4">
                          <div className="rounded border border-slate-200 p-2">
                            <p className="text-slate-500">Client Name</p>
                            <p className="font-semibold">{selectedCase.client || "Client"}</p>
                          </div>
                          <div className="rounded border border-slate-200 p-2">
                            <p className="text-slate-500">Phone</p>
                            <p className="font-semibold">{selectedCase.leadPhone || "-"}</p>
                          </div>
                          <div className="rounded border border-slate-200 p-2">
                            <p className="text-slate-500">Email</p>
                            <p className="font-semibold">{selectedCase.leadEmail || "-"}</p>
                          </div>
                          <div className="rounded border border-slate-200 p-2">
                            <p className="text-slate-500">Client ID</p>
                            <p className="font-semibold">{selectedCase.clientId || "Not linked yet"}</p>
                          </div>
                        </div>

                        <div className="rounded border border-slate-200 p-2">
                          <p className="font-semibold">Current Status</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-4">
                            <div>
                              <p className="text-slate-500">Application</p>
                              <p className="font-semibold">{selectedCase.formType}</p>
                            </div>
                            <div>
                              <p className="text-slate-500">Stage</p>
                              <p className="font-semibold">{selectedCase.stage}</p>
                            </div>
                            <div>
                              <p className="text-slate-500">Assigned Staff</p>
                              <p className="font-semibold">{selectedCase.assignedTo || selectedCase.owner || "Unassigned"}</p>
                            </div>
                            <div>
                              <p className="text-slate-500">Pending Tasks</p>
                              <p className="font-semibold">{caseTasks.filter((t) => t.status !== "completed").length}</p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded border border-slate-200 p-2">
                          <p className="font-semibold">Application History</p>
                          <div className="mt-2 space-y-2">
                            {clientRelatedCases.map((c) => (
                              <div key={c.id} className="rounded border border-slate-200 p-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-semibold">
                                    {c.id} - {c.formType}
                                  </p>
                                  <p className="text-slate-500">
                                    Submitted: {c.submittedAt ? new Date(c.submittedAt).toLocaleDateString() : "-"}
                                  </p>
                                </div>
                                <p className="text-slate-600">
                                  {c.finalOutcome
                                    ? `${c.finalOutcome === "approved" ? "Approved" : c.finalOutcome === "refused" ? "Refused" : c.finalOutcome === "request_letter" ? "Request Letter" : "Withdrawn"}${c.decisionDate ? ` on ${new Date(c.decisionDate).toLocaleDateString()}` : ""}`
                                    : "Outcome pending"}
                                </p>
                                {c.remarks ? <p className="mt-1 text-slate-600">Notes: {c.remarks}</p> : null}
                              </div>
                            ))}
                            {clientRelatedCases.length === 0 ? <p className="text-slate-500">No timeline records yet.</p> : null}
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded border border-slate-200 p-2">
                            <p className="font-semibold">Documents</p>
                            <div className="mt-2 space-y-2">
                              {documents.map((d) => (
                                <div key={d.id} className="rounded border border-slate-100 p-2">
                                  <p className="font-semibold">{d.name}</p>
                                  <p className="text-slate-500">
                                    Type: {d.fileType || d.category || "general"} • Version: {Number(d.version || 1)}
                                  </p>
                                </div>
                              ))}
                              {documents.length === 0 ? <p className="text-slate-500">No documents uploaded.</p> : null}
                            </div>
                          </div>

                          <div className="rounded border border-slate-200 p-2">
                            <p className="font-semibold">Communication</p>
                            <div className="mt-2 space-y-2">
                              {messages.slice(0, 6).map((m) => (
                                <div key={m.id} className="rounded border border-slate-100 p-2">
                                  <p className="font-semibold">
                                    {m.senderName} <span className="font-normal text-slate-500">({m.senderType})</span>
                                  </p>
                                  <p>{m.text}</p>
                                </div>
                              ))}
                              {messages.length === 0 ? <p className="text-slate-500">No communication records yet.</p> : null}
                            </div>
                          </div>
                        </div>

                        <div className="rounded border border-slate-200 p-2">
                          <p className="font-semibold">Internal Flags</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <div className="rounded border border-slate-100 p-2">
                              <p className="text-slate-500">Previous refusals</p>
                              <p className="font-semibold">
                                {String(selectedCase.pgwpIntake?.refusedAnyCountry || "").trim() || "Not flagged"}
                              </p>
                            </div>
                            <div className="rounded border border-slate-100 p-2">
                              <p className="text-slate-500">Criminal history</p>
                              <p className="font-semibold">
                                {String(selectedCase.pgwpIntake?.criminalHistory || "").trim() || "Not flagged"}
                              </p>
                            </div>
                            <div className="rounded border border-slate-100 p-2">
                              <p className="text-slate-500">Medical history</p>
                              <p className="font-semibold">
                                {String(selectedCase.pgwpIntake?.medicalHistory || "").trim() || "Not flagged"}
                              </p>
                            </div>
                            <div className="rounded border border-slate-100 p-2">
                              <p className="text-slate-500">Missing docs</p>
                              <p className="font-semibold">{docRequests.filter((r) => r.status === "open").length}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {caseDetailTab === "overview" ? (
                      <div className="mt-3 space-y-4">

                        {/* ── Changes Needed Banner ── */}
                        {selectedCase.processingStatus === "under_review" && (selectedCase as any).reviewStatus === "changes_needed" && (
                          <div className="rounded-xl border-2 border-red-400 bg-red-50 p-4 flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <p className="text-sm font-bold text-red-800">⚠️ Changes Required by {(selectedCase as any).reviewedBy || "Reviewer"}</p>
                              <p className="text-sm text-red-700 mt-1 whitespace-pre-wrap">{(selectedCase as any).reviewNotes}</p>
                              <p className="text-[10px] text-red-500 mt-2">Fix the above then click "Changes Done" in the Review panel</p>
                            </div>
                            <button onClick={() => setShowURPanel(selectedCase.id)}
                              className="rounded-xl bg-red-500 px-3 py-2 text-xs font-bold text-white hover:bg-red-600 shrink-0">
                              Open Review →
                            </button>
                          </div>
                        )}
                        {selectedCase.processingStatus === "under_review" && (selectedCase as any).reviewStatus === "changes_done" && (
                          <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-3 flex items-center justify-between gap-3">
                            <p className="text-sm font-bold text-emerald-800">✅ Changes done — waiting for reviewer to submit</p>
                            <button onClick={() => setShowURPanel(selectedCase.id)}
                              className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 shrink-0">
                              Submit →
                            </button>
                          </div>
                        )}

                        {/* ── WhatsApp Intake ── */}
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-emerald-900">📱 WhatsApp Intake</p>
                            <p className="text-[10px] text-emerald-700 mt-0.5">Send questions via WhatsApp — client answers one by one, saves automatically.</p>
                          </div>
                          <button onClick={async () => {
                            if (!selectedCase.leadPhone) { setCaseActionStatus("❌ No phone number"); setTimeout(()=>setCaseActionStatus(""),3000); return; }
                            const res = await apiFetch(`/cases/${selectedCase.id}/wa-intake`, { method: "POST" });
                            if (res.ok) { setCaseActionStatus("✅ WhatsApp intake started!"); }
                            else { const d = await res.json().catch(()=>({})); setCaseActionStatus("❌ " + (d.error || "Failed")); }
                            setTimeout(() => setCaseActionStatus(""), 4000);
                          }} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 shrink-0">
                            📱 Start
                          </button>
                        </div>

                        {/* ── Generate IRCC Forms ── */}
                        {["post-graduation work permit","pgwp","sowp","spousal open work permit","bowp","bridging open work permit","open work permit","lmia","visitor record","visitor visa","trv","study permit","restoration"].some(k => selectedCase.formType.toLowerCase().includes(k)) && (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <p className="text-xs font-bold text-emerald-900">📄 IRCC Form Auto-Fill</p>
                              <p className="text-[10px] text-emerald-700 mt-0.5">
                                {selectedCase.formType.toLowerCase().includes("study permit") ? "IMM5709" :
                                 selectedCase.formType.toLowerCase().includes("visitor record") ? "IMM5708" :
                                 selectedCase.formType.toLowerCase().includes("trv") || selectedCase.formType.toLowerCase().includes("visitor visa") ? "IMM5257" :
                                 "IMM5710"} — auto-filled from client questionnaire
                              </p>
                            </div>
                            <button onClick={async () => {
                              setCaseActionStatus("Generating form...");
                              const res = await apiFetch(`/cases/${selectedCase.id}/generate-forms`, {
                                method: "POST",
                                headers: {"Content-Type":"application/json"},
                                body: JSON.stringify({
                                  systemToken: "newton-recovery-2024",
                                  intake: selectedCase.pgwpIntake || {}
                                })
                              }).catch(()=>null);
                              const d = await res?.json().catch(()=>({}));
                              if (res?.ok && d.generated?.length > 0) {
                                setCaseActionStatus(`✅ Generated: ${d.generated.join(", ").toUpperCase()} — check Documents tab`);
                                // Reload documents
                                const docsRes = await apiFetch(`/cases/${selectedCase.id}/documents`);
                                const docsData = await docsRes.json().catch(()=>({}));
                                if (docsData.documents) setDocuments(docsData.documents);
                              } else {
                                setCaseActionStatus(d.message || "No forms generated — complete questionnaire first");
                              }
                              setTimeout(() => setCaseActionStatus(""), 4000);
                            }} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shrink-0">
                              ⚡ Generate Now
                            </button>
                          </div>
                        )}

                        {/* ── IRCC Portal Script Generator ── */}
                        {(selectedCase.formType.toLowerCase().includes("visitor visa") || selectedCase.formType.toLowerCase().includes("trv")) && (
                          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <p className="text-xs font-bold text-blue-900">🌐 IRCC Portal Script</p>
                              <p className="text-[10px] text-blue-700 mt-0.5">Pre-filled JS script for IRCC portal</p>
                            </div>
                            <button onClick={() => {
                              const intake = (selectedCase as any).pgwpIntake || {};
                              const script = generateVisitorVisaScript(selectedCase, intake, {
                                visitDateFrom: { year: "2025", month: "06", day: "01" },
                                visitDateTo:   { year: "2025", month: "08", day: "31" },
                                visitPurpose:  "Tourism and visiting family in Canada",
                                funds: "15000",
                              });
                              navigator.clipboard.writeText(script).then(() => {
                                setCaseActionStatus("✅ Script copied — paste in browser console on IRCC portal Page 1");
                                setTimeout(() => setCaseActionStatus(""), 5000);
                              });
                            }} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shrink-0">
                              📋 Copy Script
                            </button>
                          </div>
                        )}

                        {/* ── Application Number (shown when submitted) ── */}
                        {selectedCase.processingStatus === "submitted" && (
                          <div className="rounded-xl border-2 border-purple-200 bg-purple-50 p-3 flex items-center gap-3 flex-wrap">
                            <div className="flex-1">
                              <p className="text-xs font-bold text-purple-900">📋 Application Number</p>
                              <input
                                defaultValue={String((selectedCase as any).applicationNumber || "")}
                                onBlur={async (e) => {
                                  const val = e.target.value.trim();
                                  if (!val) return;
                                  // Save app number + sync to lookup
                                  const subRes = await apiFetch(`/cases/${selectedCase.id}/submit`, {
                                    method: "POST",
                                    headers: {"Content-Type":"application/json"},
                                    body: JSON.stringify({ applicationNumber: val, submittedAt: new Date().toISOString() })
                                  }).catch(()=>null);
                                  if (subRes?.ok) {
                                    const d = await subRes.json().catch(()=>({}));
                                    if (d.case) setCases(prev => prev.map(c => c.id === selectedCase.id ? d.case : c));
                                  }
                                  setCaseActionStatus("✅ Application number saved + synced");
                                  setTimeout(() => setCaseActionStatus(""), 2000);
                                }}
                                placeholder="e.g. S1122334455"
                                className="mt-1 rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-sm font-mono w-full focus:outline-none focus:border-purple-400"
                              />
                            </div>
                            <p className="text-[10px] text-purple-600">Press Tab or click away to save</p>
                          </div>
                        )}

                        {/* ── Client Info + Status ── */}
                        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                          {/* Top row: name + key info */}
                          <div className="px-4 py-3 flex items-start justify-between gap-4 border-b border-slate-100">
                            <div>
                              <p className="text-base font-bold text-slate-900">{selectedCase.client}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{selectedCase.id} · {selectedCase.formType}</p>
                            </div>
                            <div className="flex gap-2 flex-wrap justify-end shrink-0">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${processingStatusChipClass(selectedCase.processingStatus || "docs_pending")}`}>
                                {selectedCase.processingStatus === "other" ? prettyStatus(selectedCase.processingStatusOther || "other") : prettyStatus(selectedCase.processingStatus || "docs_pending")}
                              </span>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${caseStatusChipClass(selectedCase.caseStatus || "lead")}`}>
                                {prettyStatus(selectedCase.caseStatus || "lead")}
                              </span>
                            </div>
                          </div>
                          {/* Details row */}
                          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y divide-slate-100">
                            <div className="px-3 py-2.5">
                              <p className="text-[10px] text-slate-400 font-semibold uppercase">Phone</p>
                              {selectedCase.leadPhone ? (
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <a href={`tel:${selectedCase.leadPhone}`} className="text-sm font-bold text-blue-700 hover:underline">{selectedCase.leadPhone}</a>
                                  <a href={`https://wa.me/${selectedCase.leadPhone.replace(/\D/g,"")}`} target="_blank"
                                    className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-600">WA</a>
                                  <button onClick={() => { setScreen("inbox"); }}
                                    className="rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-blue-600">💬 Message</button>
                                </div>
                              ) : <span className="text-sm text-slate-300">—</span>}
                            </div>
                            <div className="px-3 py-2.5">
                              <p className="text-[10px] text-slate-400 font-semibold uppercase">Email</p>
                              <p className="text-sm font-bold text-slate-900 mt-0.5 truncate">
                                {selectedCase.leadEmail ? <a href={`mailto:${selectedCase.leadEmail}`} className="text-blue-700 hover:underline">{selectedCase.leadEmail}</a> : <span className="text-slate-300">—</span>}
                              </p>
                            </div>
                            <div className="px-3 py-2.5">
                              <p className="text-[10px] text-slate-400 font-semibold uppercase">Assigned To</p>
                              <select value={String(selectedCase.assignedTo || "Unassigned")}
                                onChange={(e) => void updateCaseProcessing(selectedCase.id, { assignedTo: e.target.value })}
                                className="mt-0.5 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none">
                                {processingAssigneeOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                            <div className="px-3 py-2.5">
                              <p className="text-[10px] text-slate-400 font-semibold uppercase">Created</p>
                              <p className="text-sm font-bold text-slate-900 mt-0.5">{selectedCase.createdAt ? new Date(selectedCase.createdAt).toLocaleDateString() : "—"}</p>
                            </div>
                            {selectedCase.pgwpIntake?.uci && (
                              <div className="px-3 py-2.5">
                                <p className="text-[10px] text-slate-400 font-semibold uppercase">UCI</p>
                                <p className="text-sm font-bold text-slate-900 mt-0.5">{selectedCase.pgwpIntake.uci}</p>
                              </div>
                            )}
                            {selectedCase.pgwpIntake?.dateOfBirth && (
                              <div className="px-3 py-2.5">
                                <p className="text-[10px] text-slate-400 font-semibold uppercase">Date of Birth</p>
                                <p className="text-sm font-bold text-slate-900 mt-0.5">{selectedCase.pgwpIntake.dateOfBirth}</p>
                              </div>
                            )}
                            {selectedCase.pgwpIntake?.passportNumber && (
                              <div className="px-3 py-2.5">
                                <p className="text-[10px] text-slate-400 font-semibold uppercase">Passport</p>
                                <p className="text-sm font-bold text-slate-900 mt-0.5">{selectedCase.pgwpIntake.passportNumber}</p>
                              </div>
                            )}
                            {selectedCase.pgwpIntake?.address && (
                              <div className="px-3 py-2.5 col-span-2">
                                <p className="text-[10px] text-slate-400 font-semibold uppercase">Address</p>
                                <p className="text-xs font-semibold text-slate-700 mt-0.5">{selectedCase.pgwpIntake.address}</p>
                              </div>
                            )}
                          </div>
                          {/* Under Review badge if applicable */}
                          {selectedCase.processingStatus === "under_review" && (
                            <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-amber-800">
                                  {(selectedCase as any).reviewedBy ? "👁 Reviewing: " + (selectedCase as any).reviewedBy : "👁 Awaiting reviewer"}
                                </span>
                                {(selectedCase as any).reviewStatus === "changes_needed" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">⚠️ Changes Needed</span>}
                                {(selectedCase as any).reviewStatus === "changes_done" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">✅ Changes Done</span>}
                              </div>
                              <button onClick={() => setShowURPanel(selectedCase.id)}
                                className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-white hover:bg-amber-600">
                                Open Review →
                              </button>
                            </div>
                          )}
                        </div>

                                                {/* ── Fees ── */}
                        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Fees</p>
                          </div>
                          <div className="grid grid-cols-3 divide-x divide-slate-100">
                            <div className="px-4 py-3">
                              <p className="text-[10px] text-slate-400 font-semibold uppercase">Service Fee</p>
                              <p className="text-lg font-bold text-slate-900 mt-0.5">${Number(selectedCase.totalCharges ?? selectedCase.servicePackage?.retainerAmount ?? 0).toLocaleString()}</p>
                            </div>
                            <div className="px-4 py-3">
                              <p className="text-[10px] text-slate-400 font-semibold uppercase">IRCC Fees</p>
                              <p className="text-lg font-bold text-slate-900 mt-0.5">${Number(selectedCase.irccFees ?? 0).toLocaleString()} <span className="text-xs font-medium text-slate-400">({selectedCase.irccFeePayer === "sir_card" ? "Sir Card" : "Client Card"})</span></p>
                            </div>
                            <div className="px-4 py-3">
                              <p className="text-[10px] text-slate-400 font-semibold uppercase">Amount Paid</p>
                              <p className={`text-lg font-bold mt-0.5 ${Number((selectedCase as any).amountPaid || 0) >= Number(selectedCase.totalCharges ?? selectedCase.servicePackage?.retainerAmount ?? 0) ? "text-emerald-700" : "text-amber-700"}`}>
                                ${Number((selectedCase as any).amountPaid || 0).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* ── Portal Link ── */}
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Client Portal</p>
                          <div className="flex flex-wrap gap-2">
                            <input value={invitePhone} onChange={(e) => setInvitePhone(e.target.value)} placeholder="Phone (WhatsApp)"
                              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none" />
                            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Email (optional)"
                              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none" />
                            <button onClick={() => void createClientInvite()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                              {inviteUrl ? "Refresh Link" : "Create Link"}
                            </button>
                            {inviteUrl && (
                              <button onClick={() => void shareInvite("whatsapp")} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                                📱 Send WhatsApp
                              </button>
                            )}
                            {inviteUrl && (
                              <a href={inviteUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
                                Open Link ↗
                              </a>
                            )}
                          </div>
                          {inviteStatus && <p className="mt-2 text-xs text-slate-600">{inviteStatus}</p>}
                        </div>

                        {/* ── Tools ── */}
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-sm font-bold text-slate-800 mb-1">AI Intake Check</p>
                            <p className="text-xs text-slate-400 mb-3">Check what's missing from the client's file</p>
                            <div className="flex gap-2 flex-wrap">
                              <button onClick={() => void runAiIntakeCheck(true)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">Check + Create Tasks</button>
                              <button onClick={() => void runAiIntakeCheck(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Check Only</button>
                            </div>
                            {intakeCheckStatus && <p className="mt-2 text-xs text-slate-600">{intakeCheckStatus}</p>}
                            {intakeCheckSummary && (
                              <div className="mt-2 grid grid-cols-3 gap-2">
                                <div className={`rounded-lg p-2 text-center ${intakeCheckSummary.questionnaireComplete ? "bg-emerald-50" : "bg-amber-50"}`}>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase">Form</p>
                                  <p className={`text-xs font-bold mt-0.5 ${intakeCheckSummary.questionnaireComplete ? "text-emerald-700" : "text-amber-700"}`}>{intakeCheckSummary.questionnaireComplete ? "✓ Done" : "Pending"}</p>
                                </div>
                                <div className={`rounded-lg p-2 text-center ${intakeCheckSummary.missingIntakeItems.length === 0 ? "bg-emerald-50" : "bg-amber-50"}`}>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase">Missing</p>
                                  <p className={`text-xs font-bold mt-0.5 ${intakeCheckSummary.missingIntakeItems.length === 0 ? "text-emerald-700" : "text-amber-700"}`}>{intakeCheckSummary.missingIntakeItems.length} fields</p>
                                </div>
                                <div className={`rounded-lg p-2 text-center ${intakeCheckSummary.missingRequiredDocs.length === 0 ? "bg-emerald-50" : "bg-amber-50"}`}>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase">Docs</p>
                                  <p className={`text-xs font-bold mt-0.5 ${intakeCheckSummary.missingRequiredDocs.length === 0 ? "text-emerald-700" : "text-amber-700"}`}>{intakeCheckSummary.missingRequiredDocs.length} missing</p>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-sm font-bold text-slate-800 mb-1">AI Autofill</p>
                            <p className="text-xs text-slate-400 mb-3">Fill blank intake fields from existing data</p>
                            <input value={autofillHint} onChange={(e) => setAutofillHint(e.target.value)}
                              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs mb-2 focus:border-slate-400 focus:outline-none"
                              placeholder="Optional hint — e.g. passport DOB 1999-03-12" />
                            <button onClick={() => void runAutofill()} disabled={autofillRunning}
                              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                              {autofillRunning ? "Running…" : "Run Autofill"}
                            </button>
                            {autofillStatus && <p className={`mt-2 text-xs font-semibold ${autofillResult && autofillResult.fieldsAdded > 0 ? "text-emerald-700" : "text-slate-600"}`}>{autofillStatus}</p>}
                          </div>
                        </div>

                        {/* ── Google Sheets Sync ── */}
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between flex-wrap gap-3">
                            <div>
                              <p className="text-sm font-bold text-slate-800">Google Sheets Sync</p>
                              <p className="text-xs text-slate-400 mt-0.5">Sync this case to the Newton Master Tracker</p>
                            </div>
                            <button onClick={() => void syncToSheets()} disabled={sheetSyncRunning}
                              className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                              {sheetSyncRunning ? "Syncing…" : "↗ Sync to Sheets"}
                            </button>
                          </div>
                          {sheetSyncStatus && <p className={`mt-2 text-xs font-semibold ${sheetSyncStatus.startsWith("✓") ? "text-emerald-700" : "text-slate-600"}`}>{sheetSyncStatus}</p>}
                          {(selectedCase as any).intakeSheetUrl && (
                            <a href={(selectedCase as any).intakeSheetUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-blue-700 underline font-semibold">Open Intake Sheet ↗</a>
                          )}
                        </div>

                        {selectedCase.updatedAt && (
                          <p className="text-[10px] text-slate-400 text-right">Last updated: {new Date(selectedCase.updatedAt).toLocaleString()}</p>
                        )}
                      </div>
                    ) : null}

                                        {caseDetailTab === "documents" ? (
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="rounded border border-slate-300 bg-slate-50 p-2">
                          <p className="font-semibold">Request More Documents</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <input
                              value={staffDocRequestTitle}
                              onChange={(e) => setStaffDocRequestTitle(e.target.value)}
                              className="rounded border border-slate-300 px-2 py-2"
                              placeholder="Document name (e.g. Updated bank statement)"
                            />
                            <input
                              value={staffDocRequestDetails}
                              onChange={(e) => setStaffDocRequestDetails(e.target.value)}
                              className="rounded border border-slate-300 px-2 py-2"
                              placeholder="Details/instructions for client"
                            />
                          </div>
                          <button
                            onClick={() => void createStaffDocRequest()}
                            className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                          >
                            Send Request to Client Portal
                          </button>
                          {staffDocRequestStatus ? <p className="mt-1 text-slate-700">{staffDocRequestStatus}</p> : null}
                        </div>
                        <div className="rounded border border-slate-200 p-2">
                          <p className="font-semibold">Requested Documents Status</p>
                          <div className="mt-2 space-y-2">
                            {docRequests.map((r) => (
                              <div key={r.id} className="rounded border border-slate-200 p-2">
                                <p className="font-semibold">{r.title}</p>
                                {r.details ? <p className="text-slate-600">{r.details}</p> : null}
                                <p className="text-slate-500">
                                  {r.status} • requested by {r.requestedBy}
                                  {r.fulfilledAt ? ` • fulfilled ${new Date(r.fulfilledAt).toLocaleString()}` : ""}
                                </p>
                              </div>
                            ))}
                            {docRequests.length === 0 ? <p className="text-slate-500">No extra requests yet.</p> : null}
                          </div>
                        </div>
                        {documents.map((d) => (
                          <div key={d.id} className="rounded border border-slate-200 p-2">
                            <p className="font-semibold">{d.name}</p>
                            <p className="text-slate-500">{d.status}</p>
                            {d.link ? <a href={d.link} target="_blank" className="text-blue-700 underline">Open</a> : null}
                          </div>
                        ))}
                        {documents.length === 0 ? <p className="text-slate-500">No documents uploaded yet.</p> : null}
                      </div>
                    ) : null}

                    {caseDetailTab === "communication" ? (
                      <div className="mt-3">
                        <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                          <p className="font-semibold">Send Client Update</p>
                          <p className="mt-1 text-slate-600">One message panel for WhatsApp, email, SMS, or copy.</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <input
                              value={inviteEmail}
                              onChange={(e) => setInviteEmail(e.target.value)}
                              placeholder="Client email"
                              className="rounded border border-slate-300 px-2 py-2"
                            />
                            <input
                              value={invitePhone}
                              onChange={(e) => setInvitePhone(e.target.value)}
                              placeholder="Client phone"
                              className="rounded border border-slate-300 px-2 py-2"
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              onClick={() => void createClientInvite()}
                              className="rounded border border-slate-300 px-3 py-2 font-semibold"
                            >
                              Create/Refresh Invite Link
                            </button>
                            {inviteUrl ? (
                              <a
                                href={inviteUrl}
                                target="_blank"
                                className="rounded border border-slate-300 px-3 py-2 font-semibold text-blue-700 underline"
                              >
                                Open Client Link
                              </a>
                            ) : null}
                            <button
                              onClick={() => insertTemplateMessage("invite")}
                              className="rounded border border-slate-300 px-3 py-2 font-semibold"
                            >
                              Template: Portal Link
                            </button>
                            <button
                              onClick={() => insertTemplateMessage("docs")}
                              className="rounded border border-slate-300 px-3 py-2 font-semibold"
                            >
                              Template: Docs Reminder
                            </button>
                            <button
                              onClick={() => insertTemplateMessage("payment")}
                              className="rounded border border-slate-300 px-3 py-2 font-semibold"
                            >
                              Template: Payment Reminder
                            </button>
                            <button
                              onClick={() => insertTemplateMessage("followup")}
                              className="rounded border border-slate-300 px-3 py-2 font-semibold"
                            >
                              Template: Follow-up
                            </button>
                          </div>
                          <textarea
                            value={clientUpdateText}
                            onChange={(e) => setClientUpdateText(e.target.value)}
                            rows={4}
                            className="mt-2 w-full rounded border border-slate-300 px-2 py-2"
                            placeholder="Write update message for client..."
                          />
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select
                              value={clientUpdateChannel}
                              onChange={(e) =>
                                setClientUpdateChannel(e.target.value as "whatsapp" | "email" | "sms" | "copy")
                              }
                              className="rounded border border-slate-300 px-2 py-1"
                            >
                              <option value="whatsapp">WhatsApp</option>
                              <option value="email">Email</option>
                              <option value="sms">SMS</option>
                              <option value="copy">Copy only</option>
                            </select>
                            <button
                              onClick={() => void sendClientUpdate(clientUpdateChannel)}
                              className="rounded bg-slate-900 px-3 py-1.5 font-semibold text-white"
                            >
                              Send Update
                            </button>
                          </div>
                          {inviteStatus ? <p className="mt-1 text-slate-700">{inviteStatus}</p> : null}
                          {clientUpdateStatus ? <p className="mt-1 text-slate-700">{clientUpdateStatus}</p> : null}
                          {inviteShareStatus ? <p className="mt-1 text-slate-700">{inviteShareStatus}</p> : null}
                        </div>
                        <div className="mb-3 rounded border border-slate-200 p-2 text-xs">
                          <p className="font-semibold">Sent Link History</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-3">
                            <select
                              value={outboundFilterChannel}
                              onChange={(e) =>
                                setOutboundFilterChannel(
                                  e.target.value as "all" | "email" | "whatsapp" | "sms" | "link" | "copy"
                                )
                              }
                              className="rounded border border-slate-300 px-2 py-1"
                            >
                              <option value="all">All channels</option>
                              <option value="whatsapp">WhatsApp</option>
                              <option value="email">Email</option>
                              <option value="sms">SMS</option>
                              <option value="link">Link</option>
                              <option value="copy">Copy</option>
                            </select>
                            <select
                              value={outboundFilterStatus}
                              onChange={(e) =>
                                setOutboundFilterStatus(
                                  e.target.value as "all" | "queued" | "opened_app" | "sent" | "failed"
                                )
                              }
                              className="rounded border border-slate-300 px-2 py-1"
                            >
                              <option value="all">All statuses</option>
                              <option value="sent">Sent</option>
                              <option value="queued">Queued</option>
                              <option value="opened_app">Opened app</option>
                              <option value="failed">Failed</option>
                            </select>
                            <input
                              value={outboundSearch}
                              onChange={(e) => setOutboundSearch(e.target.value)}
                              placeholder="Search target or message"
                              className="rounded border border-slate-300 px-2 py-1"
                            />
                          </div>
                          <div className="mt-2 max-h-40 space-y-2 overflow-auto">
                            {filteredOutboundMessages.map((o) => (
                              <div key={o.id} className="rounded border border-slate-200 p-2">
                                <p className="font-semibold">
                                  {o.channel.toUpperCase()} • {o.status}
                                </p>
                                <p className="text-slate-500">
                                  {new Date(o.createdAt).toLocaleString()} • by {o.createdByName}
                                </p>
                                {o.target ? <p className="text-slate-600">To: {o.target}</p> : null}
                              </div>
                            ))}
                            {filteredOutboundMessages.length === 0 ? (
                              <p className="text-slate-500">No sent link records yet.</p>
                            ) : null}
                          </div>
                        </div>
                        <div className="max-h-56 space-y-2 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                          {messages.map((m) => (
                            <div key={m.id} className={`rounded p-2 ${m.senderType === "client" ? "bg-blue-50 border border-blue-100 ml-4" : m.senderType === "ai" ? "bg-emerald-50 border border-emerald-100" : "bg-white border border-slate-200"}`}>
                              <p className={`font-semibold text-[11px] mb-0.5 ${m.senderType === "client" ? "text-blue-700" : m.senderType === "ai" ? "text-emerald-700" : "text-slate-600"}`}>{m.senderName}{m.senderType === "ai" ? " (AI)" : ""}</p>
                              <p>{m.text}</p>
                            </div>
                          ))}
                          {messages.length === 0 ? <p className="text-slate-400 text-center py-2">No messages yet.</p> : null}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <input value={chatText} onChange={(e) => setChatText(e.target.value)} className="flex-1 rounded border border-slate-300 px-2 py-2 text-xs" placeholder="Write message" />
                          <button onClick={() => void sendMessage("human")} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700">Send</button>
                          <button onClick={() => void sendMessage("ai")} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700">AI Draft</button>
                        </div>
                        {chatStatus ? <p className="mt-1 text-xs text-slate-600">{chatStatus}</p> : null}
                      </div>
                    ) : null}

                    {caseDetailTab === "tasks" ? (
                      <div className="mt-3 text-xs">
                        <div className="grid gap-2 md:grid-cols-5 mb-2">
                          <input value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} className="rounded border border-slate-300 px-2 py-2" placeholder="Task title" />
                          <input value={newTaskDescription} onChange={(e) => setNewTaskDescription(e.target.value)} className="rounded border border-slate-300 px-2 py-2" placeholder="Description" />
                          <select value={newTaskPriority} onChange={(e) => setNewTaskPriority(e.target.value as "low" | "medium" | "high")} className="rounded border border-slate-300 px-2 py-2">
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                          <select value={newTaskAssignedTo} onChange={(e) => setNewTaskAssignedTo(e.target.value)} className="rounded border border-slate-300 px-2 py-2">
                            <option value="">Assign to</option>
                            {taskAssigneeOptions.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                          <input type="date" value={newTaskDueDate} onChange={(e) => setNewTaskDueDate(e.target.value)} className="rounded border border-slate-300 px-2 py-2" />
                        </div>
                        <button onClick={() => void createCaseTask()} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                          Add Task
                        </button>
                        {taskActionStatus ? <p className="mt-1 text-slate-700">{taskActionStatus}</p> : null}
                        <div className="mt-2 space-y-2">
                          {caseTasks.map((t) => (
                            <div key={t.id} className={`rounded border p-2 ${t.status === "completed" ? "border-slate-200 bg-slate-50 opacity-60" : t.priority === "high" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
                              <div className="flex items-start justify-between gap-2 flex-wrap">
                                <p className={`font-semibold ${t.status === "completed" ? "line-through text-slate-400" : "text-ink"}`}>{t.title}</p>
                                <div className="flex gap-1">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${t.priority === "high" ? "bg-red-100 text-red-800 border-red-300" : t.priority === "medium" ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-slate-100 text-slate-600 border-slate-200"}`}>{t.priority}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${t.status === "completed" ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-amber-100 text-amber-800 border-amber-300"}`}>{t.status}</span>
                                </div>
                              </div>
                              <p className="text-slate-500 mt-0.5">Assigned: {t.assignedTo}{t.dueDate ? ` · Due: ${t.dueDate}` : ""}</p>
                              {t.description ? <p className="mt-0.5 text-slate-600">{t.description}</p> : null}
                              {t.status !== "completed" ? (
                                <button onClick={() => void markTaskCompleted(t.id)} className="mt-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold hover:bg-slate-50">
                                  ✓ Mark Completed
                                </button>
                              ) : null}
                            </div>
                          ))}
                          {caseTasks.length === 0 ? <p className="text-slate-500">No tasks for this case yet.</p> : null}
                        </div>
                        <p className="mt-2 text-[11px] text-slate-500">
                          Completing task title containing "Review application" auto-moves case to READY.
                        </p>
                      </div>
                    ) : null}

                  </div>
                </div>
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white py-12 text-center">
                  <p className="text-sm font-semibold text-slate-700 mb-1">No case selected</p>
                  <p className="text-xs text-slate-400">Pick a case from the list above to open its details.</p>
                </div>
              )}
            </div>
          ) : null}

          {screen === "chat" ? (
            <div className="flex flex-col h-[calc(100vh-8rem)] gap-0">
              {/* Header + case selector */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 mb-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">💬 Chat</h2>
                    <p className="text-xs text-slate-400 mt-0.5">WhatsApp messages + staff notes per case</p>
                  </div>
                  {selectedCase && (
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{selectedCase.client}</p>
                      <p className="text-xs text-slate-400">{selectedCase.formType}</p>
                    </div>
                  )}
                </div>
                <select value={selectedCase?.id ?? ""} onChange={async (e) => {
                  setSelectedCaseId(e.target.value);
                  if (e.target.value && !caseNotes[e.target.value]) {
                    const r = await apiFetch(`/cases/${e.target.value}/notes`).catch(()=>null);
                    if (r?.ok) { const d = await r.json().catch(()=>({})); if (d.notes) setCaseNotes(prev => ({...prev, [e.target.value]: d.notes})); }
                  }
                }} className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 focus:border-emerald-400 focus:bg-white focus:outline-none">
                  <option value="">— Select a case —</option>
                  {visibleCases.map((c) => <option key={c.id} value={c.id}>{c.client} · {c.formType} · {c.id}</option>)}
                </select>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 min-h-0">
                {messages.filter(m => !m.text.startsWith("[WhatsApp] ") || true).map((m) => {
                  const isClient = m.senderType === "client";
                  const isWhatsApp = m.text.startsWith("[WhatsApp]");
                  const displayText = isWhatsApp ? m.text.replace("[WhatsApp] ", "") : m.text;
                  const isAI = m.senderType === "ai";
                  return (
                    <div key={m.id} className={`flex gap-2.5 ${isClient ? "flex-row-reverse" : ""}`}>
                      <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        isClient ? "bg-blue-500 text-white" :
                        isAI ? "bg-emerald-500 text-white" :
                        "bg-slate-900 text-white"
                      }`}>
                        {isClient ? "C" : isAI ? "AI" : m.senderName?.charAt(0)?.toUpperCase() || "S"}
                      </div>
                      <div className={`max-w-[75%] ${isClient ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                        <div className={`rounded-2xl px-4 py-2.5 text-sm ${
                          isClient ? "rounded-tr-sm bg-blue-500 text-white" :
                          isAI ? "rounded-tl-sm bg-emerald-100 text-emerald-900" :
                          "rounded-tl-sm bg-white border border-slate-200 text-slate-800"
                        }`}>
                          {isWhatsApp && <span className="text-[10px] opacity-70 block mb-0.5">📱 WhatsApp</span>}
                          <p className="leading-relaxed">{displayText}</p>
                        </div>
                        <p className="text-[10px] text-slate-400 px-1">
                          {m.senderName}{" · "}{m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <p className="text-3xl mb-3">💬</p>
                    <p className="text-sm font-semibold text-slate-500">No messages yet</p>
                    <p className="text-xs text-slate-400 mt-1">WhatsApp replies from client will appear here</p>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="mt-3 flex-shrink-0">
                <div className="flex gap-2 items-end">
                  <textarea value={chatText} onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage("human"); }}}
                    placeholder="Type a message… Enter to send, Shift+Enter for new line"
                    rows={2}
                    className="flex-1 rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-300 focus:border-emerald-400 focus:outline-none resize-none"
                  />
                  <div className="flex flex-col gap-1.5">
                    <button onClick={() => void sendMessage("human")}
                      className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-700">
                      Send
                    </button>
                    <button onClick={() => void sendMessage("ai")}
                      className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700">
                      AI
                    </button>
                  </div>
                </div>
                {chatStatus && <p className="mt-1 text-xs text-slate-500">{chatStatus}</p>}
              </div>
            </div>
          ) : null}

          {screen === "communications" ? (
            <div className="space-y-4">
              {/* Page header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">➕ New Case</h2>
                  <p className="mt-0.5 text-sm text-slate-500">Fill client details below to create a case and send their portal link automatically.</p>
                </div>
              </div>

              {/* Case selector */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Select active case</label>
                <select
                  value={selectedCase?.id ?? ""}
                  onChange={(e) => setSelectedCaseId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                >
                  {visibleCases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} — {c.client} · {c.formType}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="bg-slate-900 px-6 py-4">
                    <h2 className="text-base font-bold text-white">➕ Create New Case</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Payment received — fill details below. Portal link auto-sends to client.</p>
                  </div>

                  <div className="p-5 space-y-5">
                    {/* Client + Application in one row */}
                    <div className="grid gap-4 md:grid-cols-2">
                      {/* Left: Client */}
                      <div className="space-y-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">👤 Client</p>
                        <input
                          value={commClientName}
                          onChange={(e) => setCommClientName(e.target.value)}
                          placeholder="Full name *"
                          className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none"
                        />
                        <input
                          value={commPhone}
                          onChange={(e) => setCommPhone(e.target.value)}
                          placeholder="Phone number * (WhatsApp)"
                          className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none"
                        />
                        <input
                          value={commEmail}
                          onChange={(e) => setCommEmail(e.target.value)}
                          placeholder="Email (optional)"
                          className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none"
                        />
                      </div>

                      {/* Right: Application */}
                      <div className="space-y-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">📋 Application</p>
                        <select
                          value={commFormType}
                          onChange={(e) => setCommFormType(e.target.value)}
                          className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 focus:border-emerald-400 focus:bg-white focus:outline-none"
                        >
                          {APPLICATION_TYPES.map((appType) => (
                            <option key={appType} value={appType}>{appType}</option>
                          ))}
                        </select>
                        {commFormType === "Other" ? (
                          <input
                            value={commFormTypeOther}
                            onChange={(e) => setCommFormTypeOther(e.target.value)}
                            className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none"
                            placeholder="Custom application type"
                          />
                        ) : null}
                        <input
                          type="date"
                          value={commPermitExpiryDate}
                          onChange={(e) => setCommPermitExpiryDate(e.target.value)}
                          className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-emerald-400 focus:bg-white focus:outline-none"
                          placeholder="Permit expiry date"
                        />
                      </div>
                    </div>

                    {/* Fees */}
                    <div>
                      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">💰 Fees (CAD)</p>
                      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                        <input value={commTotalCharges} onChange={(e) => setCommTotalCharges(e.target.value)}
                          placeholder="Total charges"
                          className="rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none" />
                        <input value={commIrccFees} onChange={(e) => setCommIrccFees(e.target.value)}
                          placeholder="IRCC fees"
                          className="rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none" />
                        <input value={commFamilyTotalCharges} onChange={(e) => setCommFamilyTotalCharges(e.target.value)}
                          placeholder="Family total"
                          className="rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none" />
                        <select value={commIrccFeePayer} onChange={(e) => setCommIrccFeePayer(e.target.value as "sir_card" | "client_card")}
                          className="rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-emerald-400 focus:bg-white focus:outline-none">
                          <option value="sir_card">Sir card</option>
                          <option value="client_card">Client card</option>
                        </select>
                      </div>
                    </div>



                    {/* Notes */}
                    <textarea
                      value={commAdditionalNotes}
                      onChange={(e) => setCommAdditionalNotes(e.target.value)}
                      placeholder="📝 Internal notes (optional) — anything notable about this case..."
                      rows={2}
                      className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none resize-none"
                    />

                    {/* Additional applicants */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Linked Applicants</p>
                          <p className="text-xs text-slate-500 mt-0.5">e.g. LMIA main + SOWP spouse — each gets their own portal link</p>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3 mb-2">
                        <input
                          value={commApplicantDraftName}
                          onChange={(e) => setCommApplicantDraftName(e.target.value)}
                          placeholder="Full name"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-400 focus:outline-none"
                        />
                        <input
                          value={commApplicantDraftPhone}
                          onChange={(e) => setCommApplicantDraftPhone(e.target.value)}
                          placeholder="Phone number (optional)"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-400 focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <input
                            value={commApplicantDraftType}
                            onChange={(e) => setCommApplicantDraftType(e.target.value)}
                            placeholder="Application type (e.g. SOWP)"
                            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-400 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={addAdditionalApplicant}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                          >
                            + Add
                          </button>
                        </div>
                      </div>
                      {commAdditionalApplicants.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {commAdditionalApplicants.map((applicant, idx) => (
                            <div
                              key={`${applicant.name}-${idx}`}
                              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                                  {(applicant.name||"?").charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-slate-800">{applicant.name}</p>
                                  <p className="text-[10px] text-slate-400">
                                    {applicant.formType || "Same application"}{applicant.phone ? ` · ${applicant.phone}` : ""}
                                    {applicant.phone ? " · 📱 Will get own WhatsApp link" : " · 🔗 Shared portal link"}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeAdditionalApplicant(idx)}
                                className="text-slate-300 hover:text-red-500 text-lg leading-none"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <p className="text-[10px] text-slate-400 pt-1">
                            💡 Applicants with phone numbers get their own WhatsApp invite. Others share the main applicant's portal link.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Submit area */}
                    <div className="border-t border-slate-100 pt-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={() => setCommUrgent(p => !p)}
                          className={`flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-all ${commUrgent ? "border-red-400 bg-red-50 text-red-700" : "border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200"}`}>
                          🚨 Urgent
                        </button>
                        {commUrgent && (
                          <input value={commUrgentDays} onChange={(e) => setCommUrgentDays(e.target.value)}
                            placeholder="Days to deadline"
                            className="w-36 rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900 placeholder-red-300 focus:outline-none" />
                        )}
                        <button type="button" onClick={() => setCommAutoSendInvite(p => !p)}
                          className={`flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-all ${commAutoSendInvite ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200"}`}>
                          {commAutoSendInvite ? "✅ Auto-send WhatsApp questions" : "📱 Auto-send WhatsApp questions"}
                        </button>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => void createCaseFromCommunications()}
                          className="rounded-xl bg-slate-900 px-8 py-3.5 text-sm font-bold text-white hover:bg-slate-700 active:scale-95 transition-all"
                        >
                          Create Case →
                        </button>
                        {commCreateStatus ? (
                          <p className={`text-sm font-semibold ${commCreateStatus.includes("created") || commCreateStatus.includes("Case") ? "text-emerald-600" : "text-red-600"}`}>
                            {commCreateStatus}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                {sessionUser?.role === "Admin" && sessionUser?.userType === "staff" ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-3">
                    <p className="text-sm font-bold text-emerald-900">👥 Setup Newton Team</p>
                    <p className="text-xs text-emerald-600 mt-0.5 mb-3">Creates all 11 team accounts. Default password: <strong>Newton_123</strong> — share with each member to login.</p>
                    <button
                      onClick={async () => {
                        setImportRunning(true);
                        setImportStatus("Creating team accounts...");
                        const team = [{"name": "Rajwinder", "role": "Processing"}, {"name": "Avneet", "role": "Processing"}, {"name": "Ramandeep", "role": "Processing"}, {"name": "Simi", "role": "Processing"}, {"name": "Sukhman", "role": "Marketing"}, {"name": "Rapneet", "role": "Admin"}, {"name": "Manisha", "role": "Processing"}, {"name": "Serbleen", "role": "Marketing"}, {"name": "Akanksha", "role": "Marketing"}, {"name": "Neha", "role": "Marketing"}, {"name": "Manpreet", "role": "Marketing"}];
                        let created = 0, skipped = 0;
                        for (const member of team) {
                          try {
                            const email = `${member.name.toLowerCase()}@newtonimmigration.com`;
                            const res = await apiFetch("/users/invite", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                name: member.name,
                                email,
                                role: member.role,
                                password: "Newton_123"
                              })
                            });
                            if (res.ok) created++;
                            else skipped++;
                          } catch { skipped++; }
                        }
                        setImportStatus(`✓ Done! ${created} accounts created, ${skipped} skipped (already exist). Login: name@newtonimmigration.com / Newton_123`);
                        setImportRunning(false);
                      }}
                      disabled={importRunning}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {importRunning ? "Creating..." : "Create All Team Accounts"}
                    </button>
                    {importStatus && importStatus.includes("accounts") && <p className="mt-2 text-xs font-semibold text-emerald-800">{importStatus}</p>}
                  </div>
                ) : null}

                {sessionUser?.role === "Admin" && sessionUser?.userType === "staff" ? (
                  <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 mb-3">
                    <p className="text-sm font-bold text-purple-900">🔄 Migrate from Old CRM</p>
                    <p className="text-xs text-purple-600 mt-0.5 mb-3">Pull all cases, results and tasks from the old CRM (crm.newtonimmigration.com) into this CRM.</p>
                    <div className="flex gap-2 flex-wrap items-center">
                      <input
                        value={(typeof window !== "undefined" && (window as any).__oldDbUrl) || ""}
                        onChange={(e) => { if (typeof window !== "undefined") (window as any).__oldDbUrl = e.target.value; }}
                        placeholder="Old CRM DATABASE_URL (or set OLD_CRM_DATABASE_URL in Railway)"
                        className="flex-1 min-w-0 rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs focus:outline-none"
                      />
                      <button
                        onClick={async () => {
                          setImportRunning(true);
                          setImportStatus("Running dry run on old CRM...");
                          try {
                            const res = await apiFetch("/migrate-from-old", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ dryRun: true, oldDbUrl: (window as any).__oldDbUrl || "" })
                            });
                            const d = await res.json();
                            if (d.error) { setImportStatus(`Error: ${d.error}`); return; }
                            setImportStatus(`Old CRM has: ${d.oldCRM.totalCases} cases, ${d.oldCRM.totalResults} results, ${d.oldCRM.totalTasks} tasks. Would import: ${d.imported.cases} new cases, ${d.imported.results} results, ${d.imported.tasks} tasks. ${d.skipped} duplicates skipped.`);
                          } catch(e) { setImportStatus(`Error: ${e}`); }
                          finally { setImportRunning(false); }
                        }}
                        disabled={importRunning}
                        className="rounded-lg border border-purple-300 bg-white px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-50 disabled:opacity-50"
                      >
                        Dry Run
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm("Migrate all data from old CRM? This will import cases, results and tasks.")) return;
                          setImportRunning(true);
                          setImportStatus("Migrating from old CRM...");
                          try {
                            const res = await apiFetch("/migrate-from-old", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ dryRun: false, oldDbUrl: (window as any).__oldDbUrl || "" })
                            });
                            const d = await res.json();
                            if (d.error) { setImportStatus(`Error: ${d.error}`); return; }
                            setImportStatus(`✓ Done! Imported ${d.imported.cases} cases, ${d.imported.results} results, ${d.imported.tasks} tasks. ${d.skipped} skipped.`);
                            const casesRes = await apiFetch("/cases", { cache: "no-store" });
                            const casesData = await casesRes.json();
                            if (casesData.cases) setCases(casesData.cases);
                          } catch(e) { setImportStatus(`Error: ${e}`); }
                          finally { setImportRunning(false); }
                        }}
                        disabled={importRunning}
                        className="rounded-lg bg-purple-700 px-3 py-2 text-xs font-bold text-white hover:bg-purple-800 disabled:opacity-50"
                      >
                        {importRunning ? "Migrating..." : "Migrate All"}
                      </button>
                    </div>
                    {importStatus && importStatus.includes("old CRM") && <p className="mt-2 text-xs font-semibold text-purple-800">{importStatus}</p>}
                  </div>
                ) : null}

                {sessionUser?.role === "Admin" && sessionUser?.userType === "staff" ? (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <p className="text-sm font-bold text-blue-900">📥 Import Cases from Sheets</p>
                    <p className="text-xs text-blue-600 mt-0.5 mb-3">Import all existing clients from your Google Sheets. Duplicates are automatically skipped.</p>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={async () => {
                          setImportRunning(true);
                          setImportStatus("Running dry run...");
                          try {
                            const res = await apiFetch("/import-cases", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ cases: IMPORT_CASES_DATA, dryRun: true })
                            });
                            const d = await res.json();
                            setImportStatus(`Dry run: ${d.imported} would import, ${d.skipped} duplicates`);
                          } finally { setImportRunning(false); }
                        }}
                        disabled={importRunning}
                        className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        Test (Dry Run)
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm("Import all cases from sheets? This cannot be undone.")) return;
                          setImportRunning(true);
                          setImportStatus("Importing...");
                          try {
                            const batchSize = 50;
                            let totalImported = 0, totalSkipped = 0;
                            for (let i = 0; i < IMPORT_CASES_DATA.length; i += batchSize) {
                              const batch = IMPORT_CASES_DATA.slice(i, i + batchSize);
                              const res = await apiFetch("/import-cases", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ cases: batch, dryRun: false })
                              });
                              const d = await res.json();
                              totalImported += d.imported;
                              totalSkipped += d.skipped;
                              setImportStatus(`Importing... ${i + batchSize}/${IMPORT_CASES_DATA.length} (${totalImported} imported)`);
                            }
                            setImportStatus(`✓ Done! ${totalImported} imported, ${totalSkipped} skipped`);
                            const casesRes = await apiFetch("/cases", { cache: "no-store" });
                            const casesData = await casesRes.json();
                            if (casesData.cases) setCases(casesData.cases);
                          } finally { setImportRunning(false); }
                        }}
                        disabled={importRunning}
                        className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50"
                      >
                        {importRunning ? "Importing..." : "Import All Cases"}
                      </button>
                    </div>
                    {importStatus && <p className="mt-2 text-xs font-semibold text-blue-800">{importStatus}</p>}
                  </div>
                ) : null}

                {allowDataDelete && sessionUser?.role === "Admin" && sessionUser?.userType === "staff" ? (
                  <article className="rounded-lg border-2 border-rose-300 bg-rose-50 p-3">
                    <p className="text-sm font-semibold text-rose-900">Admin Cleanup: Keep Only Real Cases</p>
                    <p className="mt-1 text-xs text-rose-800">
                      This removes all other test/demo cases and keeps only the IDs you enter.
                    </p>
                    <input
                      value={commPruneCaseIds}
                      onChange={(e) => setCommPruneCaseIds(e.target.value)}
                      placeholder="CASE-1006, CASE-1007"
                      className="mt-2 w-full rounded border border-rose-300 px-2 py-2 text-xs"
                    />
                    <button
                      onClick={() => void pruneToRealCases()}
                      className="mt-2 rounded bg-rose-700 px-3 py-2 text-xs font-semibold text-white"
                    >
                      Keep Only These Cases
                    </button>
                    {commPruneStatus ? <p className="mt-2 text-xs text-rose-900">{commPruneStatus}</p> : null}
                  </article>
                ) : null}

            </div>
            </div>
          ) : null}

          {screen === "results" ? (
            <section className="space-y-4">

              {/* Header */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">📊 Results</h2>
                  <p className="text-xs text-slate-400 mt-0.5">IRCC decisions — notify clients via WhatsApp</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {/* Upload JSON */}
                  <label className="cursor-pointer rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">
                    📂 Upload JSON
                    <input type="file" accept=".json" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const text = await file.text();
                      let records: any[];
                      try { records = JSON.parse(text); } catch { alert("Invalid JSON file"); return; }
                      if (!Array.isArray(records)) records = [records];
                      let added = 0, skipped = 0;
                      for (const rec of records) {
                        const appNum = String(rec.applicationNumber || rec.app_num || rec.application_number || "").trim().toUpperCase();
                        if (!appNum) { skipped++; continue; }
                        // Try to match to a case
                        const phone = String(rec.phone || rec.phoneNumber || "").replace(/\D/g,"");
                        const name = String(rec.name || rec.clientName || rec.client_name || "").trim();
                        const outcome = String(rec.outcome || rec.result || "other").toLowerCase();
                        const date = String(rec.date || rec.resultDate || rec.submission_date || new Date().toISOString().slice(0,10));
                        const form = new FormData();
                        form.append("applicationNumber", appNum);
                        form.append("clientName", name);
                        form.append("phone", phone);
                        form.append("outcome", outcome);
                        form.append("resultDate", date.slice(0,10));
                        const res = await apiFetch("/results/legacy", { method: "POST", body: form });
                        if (res.ok) added++; else skipped++;
                      }
                      alert(`✅ Done! ${added} results added, ${skipped} skipped.`);
                      const r = await apiFetch("/results/legacy", { cache: "no-store" });
                      const p = await r.json().catch(()=>({}));
                      if (p.items) setLegacyResults(p.items);
                      e.target.value = "";
                    }} />
                  </label>
                  {/* Upload PDF */}
                  <label className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700">
                    + Upload PDF
                    <input type="file" accept=".pdf" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const appNo = prompt("Application number? (e.g. W311024778)");
                      if (!appNo) return;
                      const phone = prompt("Client phone? (optional)") || "";
                      const outcome = prompt("Outcome? (approved / refused / request_letter / other)") || "other";
                      const form = new FormData();
                      form.append("applicationNumber", appNo.trim().toUpperCase());
                      form.append("resultDate", new Date().toISOString().slice(0,10));
                      form.append("outcome", outcome.trim().toLowerCase());
                      form.append("phone", phone.replace(/\D/g,""));
                      form.append("clientName", "");
                      form.append("file", file);
                      const res = await apiFetch("/results/legacy", { method: "POST", body: form });
                      if (res.ok) {
                        const r = await apiFetch("/results/legacy", { cache: "no-store" });
                        const p = await r.json().catch(()=>({}));
                        if (p.items) setLegacyResults(p.items);
                      }
                      e.target.value = "";
                    }} />
                  </label>
                </div>
              </div>

              {/* Unmatched — collapsible */}
              {unlinkedScannerUploads.length > 0 && (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50 overflow-hidden">
                  <button onClick={() => {
                      const el = document.getElementById("unmatched-list");
                      if (el) el.style.display = el.style.display === "none" ? "block" : "none";
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-100 transition-all">
                    <p className="text-sm font-bold text-amber-900">⚠️ {unlinkedScannerUploads.length} unmatched results</p>
                    <span className="text-xs text-amber-700 font-semibold">tap to expand ▾</span>
                  </button>
                  <div id="unmatched-list" style={{display:"none"}}>
                    <div className="divide-y divide-amber-100">
                      {unlinkedScannerUploads.map(item => {
                        const candidates = visibleCases
                          .filter(c => {
                            const cn = String(c.client||"").toLowerCase();
                            const itemFirst = String(item.clientName||"").toLowerCase().split(" ")[0];
                            return itemFirst.length > 2 && cn.includes(itemFirst);
                          }).slice(0,4);
                        const outcomeColor = item.outcome === "approved" ? "text-emerald-700" :
                          item.outcome === "refused" ? "text-red-700" : "text-amber-700";
                        return (
                          <div key={item.id} className="px-4 py-2.5 bg-white">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`text-xs font-bold shrink-0 ${outcomeColor}`}>
                                  {item.outcome === "approved" ? "✅" : item.outcome === "refused" ? "❌" : "📄"}
                                </span>
                                <p className="text-xs font-semibold text-slate-900 truncate">{item.clientName || "Unknown"} · {item.applicationNumber}</p>
                              </div>
                              {item.fileLink && <a href={`/api/results/legacy/${encodeURIComponent(item.id)}/download`} target="_blank" className="text-[10px] text-blue-600 shrink-0">PDF</a>}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {candidates.map(c => (
                                <button key={c.id} onClick={() => void linkScannerUploadToCase(item.id, c.id)}
                                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold hover:border-emerald-400 hover:bg-emerald-50">
                                  {c.client}
                                </button>
                              ))}
                              {candidates.length === 0 && <p className="text-[10px] text-slate-400">No match found</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Ready to notify */}
              {pendingResultsQueue.filter(r => r.phone || r.matched_case_id).length > 0 && (
                <div className="rounded-xl border-2 border-emerald-200 bg-white overflow-hidden">
                  <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-3">
                    <p className="text-sm font-bold text-emerald-900">🔔 Ready to Notify ({pendingResultsQueue.filter(r => r.phone || r.matched_case_id).length})</p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {pendingResultsQueue.filter(r => r.phone || r.matched_case_id).map(item => {
                      const matchedCase = visibleCases.find(c => c.id === item.matched_case_id);
                      const phone = item.phone || matchedCase?.leadPhone || "";
                      const outcomeColor = item.outcome === "approved" ? "text-emerald-700 bg-emerald-50" :
                        item.outcome === "refused" ? "text-red-700 bg-red-50" : "text-amber-700 bg-amber-50";
                      return (
                        <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-slate-900">{item.clientName || matchedCase?.client || "Client"}</p>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${outcomeColor}`}>
                                {item.outcome === "approved" ? "✅ Approved" : item.outcome === "refused" ? "❌ Refused" : "📋 " + item.outcome}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">{item.applicationNumber} · {phone}</p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {item.fileLink && <a href={`/api/results/legacy/${encodeURIComponent(item.id)}/download`} target="_blank" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold">PDF</a>}
                            {phone && (
                              <button onClick={() => void sendSubmissionOnWhatsApp(item)}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
                                📱 WhatsApp
                              </button>
                            )}
                            <button onClick={() => void setLegacyResultInformedState(item, "informed")}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                              ✓ Done
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* All results history */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900">All Results ({legacyResults.filter(r => r.entryType !== "intake").length})</p>
                  <input placeholder="Search name or app number..."
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:outline-none focus:border-slate-400 w-48"
                    onChange={e => {
                      const q = e.target.value.toLowerCase();
                      (window as any).__resultSearch = q;
                      document.querySelectorAll('[data-result-row]').forEach((el: any) => {
                        el.style.display = !q || el.dataset.resultSearch?.includes(q) ? '' : 'none';
                      });
                    }} />
                </div>
                {legacyResults.filter(r => r.entryType !== "intake").length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-400">No results yet. Upload a JSON or PDF above.</p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-[600px] overflow-auto">
                    {legacyResults.filter(r => r.entryType !== "intake").map(item => {
                      const matchedCase = visibleCases.find(c => c.id === item.matched_case_id);
                      const phone = item.phone || matchedCase?.leadPhone || "";
                      const outcomeColor = item.outcome === "approved" ? "text-emerald-700" :
                        item.outcome === "refused" ? "text-red-700" : "text-amber-700";
                      const searchStr = `${item.clientName||""} ${item.applicationNumber||""} ${matchedCase?.client||""} ${phone}`.toLowerCase();
                      return (
                        <div key={item.id} data-result-row data-result-search={searchStr}
                          className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 flex-wrap">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900">{item.clientName || matchedCase?.client || "Unknown"}</p>
                              <span className={`text-xs font-bold ${outcomeColor}`}>
                                {item.outcome === "approved" ? "✅" : item.outcome === "refused" ? "❌" : "📋"}
                              </span>
                              {item.informedToClient && <span className="text-[10px] font-bold text-emerald-600">Notified</span>}
                            </div>
                            <p className="text-xs text-slate-400">{item.applicationNumber} · {phone || "no phone"} · {item.resultDate || item.createdAt?.slice(0,10)}</p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {item.fileLink && <a href={`/api/results/legacy/${encodeURIComponent(item.id)}/download`} target="_blank" className="text-xs text-blue-600 font-semibold hover:underline">PDF</a>}
                            {phone && !item.informedToClient && (
                              <button onClick={() => void sendSubmissionOnWhatsApp(item)}
                                className="rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-600">
                                📱
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {screen === "submission" ? (
            <section className="space-y-4">
              {/* Header */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-lg font-bold text-slate-900">📤 Submitted Applications</h2>
                <p className="mt-0.5 text-xs text-slate-500">Mark cases as submitted and track application numbers</p>
              </div>

              {/* Mark as submitted form */}
              <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-3">
                <p className="text-sm font-bold text-emerald-900">✅ Mark Case as Submitted</p>
                <div className="flex gap-2 flex-wrap">
                  <select id="submit-case-select"
                    className="flex-1 min-w-[220px] rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-emerald-400">
                    <option value="">Select case...</option>
                    {cases.filter(c => filterCasesByRole([c], viewRole, sessionUser?.name).length > 0 && c.processingStatus !== "submitted").map(c => (
                      <option key={c.id} value={c.id}>{c.client} — {c.id} — {c.formType}</option>
                    ))}
                  </select>
                  <input id="submit-app-number"
                    placeholder="Application number e.g. S1122334455"
                    className="flex-1 min-w-[220px] rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-400"
                  />
                  <button onClick={async () => {
                    const caseId = (document.getElementById("submit-case-select") as HTMLSelectElement)?.value;
                    const appNum = (document.getElementById("submit-app-number") as HTMLInputElement)?.value?.trim();
                    if (!caseId || !appNum) { alert("Please select a case and enter application number"); return; }
                    const submitRes = await apiFetch(`/cases/${caseId}/submit`, {
                      method: "POST",
                      headers: {"Content-Type":"application/json"},
                      body: JSON.stringify({ applicationNumber: appNum, submittedAt: new Date().toISOString() })
                    }).catch(()=>null);
                    if (submitRes?.ok) {
                      const d = await submitRes.json().catch(()=>({}));
                      if (d.case) setCases(prev => prev.map(c => c.id === caseId ? d.case : c));
                      else setCases(prev => prev.map(c => c.id === caseId ? {...c, processingStatus: "submitted", applicationNumber: appNum} as any : c));
                      (document.getElementById("submit-case-select") as HTMLSelectElement).value = "";
                      (document.getElementById("submit-app-number") as HTMLInputElement).value = "";
                      setCaseActionStatus("✅ Submitted + lookup synced!");
                    } else {
                      setCaseActionStatus("❌ Failed");
                    }
                    setTimeout(() => setCaseActionStatus(""), 3000);
                  }} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 shrink-0">
                    Mark Submitted
                  </button>
                </div>
                {caseActionStatus && <p className="text-sm font-semibold text-emerald-700">{caseActionStatus}</p>}
              </div>

              {/* Submitted cases list */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-bold text-slate-900">All Submitted Cases ({cases.filter(c => c.processingStatus === "submitted").length})</p>
                </div>
                {cases.filter(c => c.processingStatus === "submitted").length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-400">No submitted cases yet</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {cases.filter(c => c.processingStatus === "submitted")
                      .sort((a,b) => ((b as any).submittedAt || b.createdAt || "").localeCompare((a as any).submittedAt || a.createdAt || ""))
                      .map(c => (
                        <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold text-slate-900">{c.client}</p>
                              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">SUBMITTED</span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">{c.id} · {c.formType} · {c.assignedTo || "Unassigned"}</p>
                            {(c as any).applicationNumber && (
                              <p className="text-xs font-mono font-bold text-emerald-700 mt-0.5">📋 {(c as any).applicationNumber}</p>
                            )}
                            {(c as any).submittedAt && (
                              <p className="text-[10px] text-slate-400 mt-0.5">Submitted: {new Date((c as any).submittedAt).toLocaleDateString()}</p>
                            )}
                            {c.leadPhone && <p className="text-[10px] text-slate-400">📞 {c.leadPhone}</p>}
                          </div>
                          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                            {c.leadPhone && (
                              <a href={`https://wa.me/${c.leadPhone.replace(/\D/g,"")}`} target="_blank"
                                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600">
                                WhatsApp
                              </a>
                            )}
                            <button onClick={() => { setSelectedCaseId(c.id); setScreen("cases"); setCaseStatusFilter("submitted"); }}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                              Open →
                            </button>
                            <button onClick={async () => {
                              if (!confirm(`Move ${c.client} back to active cases?`)) return;
                              const res = await apiFetch(`/cases/${c.id}`, {
                                method: "PATCH",
                                headers: {"Content-Type":"application/json"},
                                body: JSON.stringify({ processingStatus: "docs_pending", submittedAt: null, applicationNumber: null })
                              }).catch(()=>null);
                              if (res?.ok) {
                                const d = await res.json().catch(()=>({}));
                                const updated = d.case || {...c, processingStatus: "docs_pending"};
                                setCases(prev => prev.map(ca => ca.id === c.id ? updated : ca));
                                setCaseActionStatus("✅ " + c.client + " moved back to active cases");
                              } else { setCaseActionStatus("❌ Failed to move case"); }
                              setTimeout(() => setCaseActionStatus(""), 3000);
                            }} className="rounded-lg border-2 border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100">
                              ↩ Move Back
                            </button>
                          </div>
                        </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : null}


          {screen === "accounting" ? (
            <div className="space-y-4">
              {(() => {
                const today = new Date();
                const todayStr = today.toISOString().slice(0, 10);
                const todayLabel = today.toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

                // Accounting uses ALL cases including submitted
                const allCasesByRole = filterCasesByRole(cases, viewRole, sessionUser?.name);
                const allWithFees = allCasesByRole.filter((c) => Number(c.servicePackage?.retainerAmount || (c as any).totalCharges || 0) > 0);
                // Today's cases = created today AND have a phone number (not bulk-imported)
                const todayCases = allWithFees.filter((c) => {
                  const isToday = (c.createdAt || "").slice(0, 10) === todayStr;
                  const hasPhone = Boolean(c.leadPhone?.trim());
                  const hasStaff = Boolean((c as any).createdByName?.trim());
                  // Only count as "today" if created today AND (has phone OR was created by staff member)
                  return isToday && (hasPhone || hasStaff);
                });

                const todayCollected = todayCases.reduce((s, c) => s + Number((c as any).amountPaid || 0), 0);
                const todayTotal = todayCases.reduce((s, c) => s + Number(c.servicePackage?.retainerAmount || (c as any).totalCharges || 0), 0);
                const allCollected = allWithFees.reduce((s, c) => s + Number((c as any).amountPaid || 0), 0);
                const allTotal = allWithFees.reduce((s, c) => s + Number(c.servicePackage?.retainerAmount || (c as any).totalCharges || 0), 0);

                const q = accountingSearch.trim().toLowerCase();
                const filtered = allWithFees.filter((c) => {
                  const matchText = !q || `${c.id} ${c.client} ${c.formType}`.toLowerCase().includes(q);
                  const total = Number(c.servicePackage?.retainerAmount || (c as any).totalCharges || 0);
                  const paid = Number((c as any).amountPaid || 0);
                  const status = paid >= total && total > 0 ? "paid" : "pending";
                  const matchStatus = accountingPaymentFilter === "all" ? true : status === accountingPaymentFilter;
                  return matchText && matchStatus;
                }).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

                // Date-grouped view — no pagination needed

                return (
                  <>
                    {/* Today summary */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">{todayLabel}</p>
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[10px] text-slate-400 font-semibold uppercase">New Today</p>
                          <p className="text-xl font-bold text-slate-900 mt-0.5">{todayCases.length}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[10px] text-slate-400 font-semibold uppercase">Collected Today</p>
                          <p className="text-xl font-bold text-emerald-700 mt-0.5">${todayCollected.toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[10px] text-slate-400 font-semibold uppercase">Total Collected</p>
                          <p className="text-xl font-bold text-slate-900 mt-0.5">${allCollected.toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[10px] text-slate-400 font-semibold uppercase">Outstanding</p>
                          <p className="text-xl font-bold text-amber-700 mt-0.5">${(allTotal - allCollected).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>

                    {/* Today's new cases - quick entry */}
                    {todayCases.length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">📅 Today's Cases</p>
                        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden">
                          {todayCases.map((c) => {
                            const total = Number(c.servicePackage?.retainerAmount || (c as any).totalCharges || 0);
                            const paid = Number((c as any).amountPaid || 0);
                            const remaining = Math.max(0, total - paid);
                            const isPaid = remaining <= 0 && total > 0 && paid > 0;
                            return (
                              <div key={`t-${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{c.client}</p>
                                  <p className="text-xs text-slate-400">{c.id} · {c.formType}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-bold text-slate-900">${total.toLocaleString()}</span>
                                  {isPaid ? (
                                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">✓ Paid</span>
                                  ) : (
                                    <>
                                      <input value={accountingAmount[c.id] || ""} onChange={(e) => setAccountingAmount(p => ({...p, [c.id]: e.target.value}))}
                                        placeholder="Amount" onKeyDown={(e) => e.key === "Enter" && void recordAccountingPayment(c.id)}
                                        className="w-28 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-center focus:border-emerald-400 focus:outline-none" />
                                      <button onClick={() => void recordAccountingPayment(c.id)}
                                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">✓ Done</button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Search + filter */}
                    <div className="flex flex-wrap gap-2 items-center">
                      <input value={accountingSearch} onChange={(e) => { setAccountingSearch(e.target.value); setAccountingPage(0); }}
                        placeholder="Search client, case ID, application..."
                        className="flex-1 min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none" />
                      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
                        {(["all","pending","paid"] as const).map(f => (
                          <button key={f} onClick={() => { setAccountingPaymentFilter(f); setAccountingPage(0); }}
                            className={`px-3 py-2 ${accountingPaymentFilter === f ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                            {f.charAt(0).toUpperCase()+f.slice(1)}
                          </button>
                        ))}
                      </div>
                      <span className="text-xs text-slate-400">{filtered.length} cases</span>
                    </div>

                    {/* Date-grouped collapsible list */}
                    {(() => {
                      // Group by date — use updatedAt or createdAt
                      // Cases with no real date (imported from sheets) go to Unknown
                      const todayIso = new Date().toISOString().slice(0, 10);
                      const groups: Record<string, typeof filtered> = {};
                      filtered.forEach(c => {
                        const rawDate = (c.createdAt || "").slice(0, 10);
                        const d = rawDate || "Unknown";
                        if (!groups[d]) groups[d] = [];
                        groups[d].push(c);
                      });
                      // Sort dates newest first, Unknown always last
                      const sortedDates = Object.keys(groups)
                        .sort((a, b) => {
                          if (a === "Unknown") return 1;
                          if (b === "Unknown") return -1;
                          return b.localeCompare(a);
                        });

                      return (
                        <div className="space-y-2">
                          {sortedDates.map(dateKey => {
                            const dayCases = groups[dateKey];
                            const isToday = dateKey === todayStr;
                            const isExpanded = isToday || expandedAcctDates.has(dateKey);
                            const _unused = accountingPage; // keep reftodayStr])).has(dateKey));
                            const dayTotal = dayCases.reduce((s, c) => s + Number(c.servicePackage?.retainerAmount || (c as any).totalCharges || 0), 0);
                            const dayPaid = dayCases.reduce((s, c) => s + Number((c as any).amountPaid || 0), 0);
                            const dayPending = dayCases.filter(c => {
                              const t = Number(c.servicePackage?.retainerAmount || (c as any).totalCharges || 0);
                              return Number((c as any).amountPaid || 0) < t;
                            }).length;
                            const dateLabel = dateKey === todayStr ? "Today" :
                              dateKey === "Unknown" ? "Unknown Date" :
                              new Date(dateKey + "T12:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

                            return (
                              <div key={dateKey} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                {/* Date header — clickable to expand/collapse */}
                                <button
                                  onClick={() => setExpandedAcctDates((prev: Set<string>) => {
                                    const next = new Set(prev);
                                    if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
                                    return next;
                                  })}
                                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="text-lg">{isExpanded ? "▾" : "▸"}</span>
                                    <div className="text-left">
                                      <div className="flex items-center gap-2">
                                        <p className="text-sm font-bold text-slate-900">{dateLabel}</p>
                                        {isToday && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">TODAY</span>}
                                      </div>
                                      <p className="text-xs text-slate-400">{dayCases.length} cases · {dayPending} pending</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4 text-right">
                                    <div>
                                      <p className="text-[10px] text-slate-400 uppercase font-semibold">Billed</p>
                                      <p className="text-sm font-bold text-slate-900">${dayTotal.toLocaleString()}</p>
                                    </div>
                                    <div>
                                      <p className="text-[10px] text-slate-400 uppercase font-semibold">Collected</p>
                                      <p className="text-sm font-bold text-emerald-700">${dayPaid.toLocaleString()}</p>
                                    </div>
                                    <div>
                                      <p className="text-[10px] text-slate-400 uppercase font-semibold">Owing</p>
                                      <p className="text-sm font-bold text-amber-700">${(dayTotal - dayPaid).toLocaleString()}</p>
                                    </div>
                                  </div>
                                </button>

                                {/* Expanded cases */}
                                {isExpanded && (
                                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                                    {dayCases.map(c => {
                                      const total = Number(c.servicePackage?.retainerAmount || (c as any).totalCharges || 0);
                                      const paid = Number((c as any).amountPaid || 0);
                                      const remaining = Math.max(0, total - paid);
                                      const isPaid = remaining <= 0 && total > 0 && paid > 0;
                                      return (
                                        <div key={c.id} className={`grid grid-cols-6 gap-2 items-center px-4 py-3 text-sm ${isPaid ? "bg-emerald-50/20" : ""}`}>
                                          <div className="col-span-2 min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <button onClick={() => { setSelectedCaseId(c.id); setScreen("cases"); }}
                                                className="font-semibold text-slate-900 truncate hover:text-emerald-700 text-left">
                                                {c.client}
                                              </button>
                                              {isPaid && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600">PAID</span>}
                                            </div>
                                            <p className="text-xs text-slate-400 truncate">{c.id} · {c.formType}</p>
                                            {c.leadPhone && <p className="text-[10px] text-slate-400">📞 {c.leadPhone}</p>}
                                          </div>
                                          <div className="font-semibold text-slate-900">${total.toLocaleString()}</div>
                                          <div className={`font-semibold ${paid > 0 ? "text-emerald-700" : "text-slate-300"}`}>${paid.toLocaleString()}</div>
                                          <div className={`font-semibold ${remaining > 0 ? "text-amber-700" : "text-slate-300"}`}>${remaining.toLocaleString()}</div>
                                          <div>
                                            {!isPaid ? (
                                              <div className="flex items-center gap-1">
                                                <input value={accountingAmount[c.id] || ""} onChange={(e) => setAccountingAmount(p => ({...p, [c.id]: e.target.value}))}
                                                  placeholder="$" onKeyDown={(e) => e.key === "Enter" && void recordAccountingPayment(c.id)}
                                                  className="w-16 rounded border border-slate-200 px-2 py-1 text-xs text-center focus:border-emerald-400 focus:outline-none" />
                                                <button onClick={() => void recordAccountingPayment(c.id)} className="rounded bg-slate-900 px-2 py-1 text-[10px] font-bold text-white hover:bg-slate-700">✓</button>
                                              </div>
                                            ) : <span className="text-xs text-emerald-600 font-semibold">✓</span>}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {accountingStatus ? <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">{accountingStatus}</p> : null}
                  </>
                );
              })()}
            </div>
          ) : null}

          {screen === "tasks" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">✅ Tasks</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Personal tasks + team tasks · {tasks.filter(t=>t.status==="pending").length} pending</p>
                </div>
                <button onClick={() => { const el = document.querySelector("[placeholder='Task title — press Enter to save']") as HTMLInputElement; el?.focus(); el?.scrollIntoView({behavior:"smooth"}); }}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">
                  + New Task
                </button>
              </div>

              {/* My / All toggle */}
              {(() => {
                const myName = sessionUser?.name || "";
                const myFirstName = myName.split(" ")[0].toLowerCase();
                const myTasks = tasks.filter((t) => t.assignedTo && t.assignedTo.toLowerCase().includes(myFirstName));
                const myPending = myTasks.filter((t) => t.status === "pending");
                const myDone = myTasks.filter((t) => t.status === "completed");
                const allPending = tasks.filter((t) => t.status === "pending");

                return (
                  <>
                    {/* Quick stats */}
                    <div className="mb-4 grid gap-2 grid-cols-2 md:grid-cols-4">
                      <article className={`rounded-lg border-2 p-3 ${myPending.filter(t => t.priority === "high").length > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">My High Priority</p>
                        <p className={`mt-0.5 text-2xl font-bold ${myPending.filter(t => t.priority === "high").length > 0 ? "text-red-900" : "text-slate-900"}`}>{myPending.filter(t => t.priority === "high").length}</p>
                      </article>
                      <article className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">My Pending</p>
                        <p className="mt-0.5 text-2xl font-bold text-slate-900">{myPending.length}</p>
                      </article>
                      <article className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">My Completed</p>
                        <p className="mt-0.5 text-2xl font-bold text-emerald-900">{myDone.length}</p>
                      </article>
                      <article className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Team Pending</p>
                        <p className="mt-0.5 text-2xl font-bold text-slate-900">{allPending.length}</p>
                      </article>
                    </div>

                    {/* My tasks section */}
                    {myPending.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">My Tasks ({myPending.length} pending)</p>
                        <div className="space-y-2">
                          {myPending.map((t) => (
                            <article key={t.id} className={`rounded-xl border-2 p-4 ${
                              t.priority === "high" ? "border-red-300 bg-red-50" :
                              t.dueDate && new Date(t.dueDate) < new Date() ? "border-amber-300 bg-amber-50" :
                              "border-slate-200 bg-white"
                            }`}>
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-bold text-sm text-slate-900">{t.title}</p>
                                    {t.priority === "high" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700 border border-red-200">🔴 HIGH</span>}
                                    {t.priority === "medium" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">🟡 MED</span>}
                                    {t.dueDate && new Date(t.dueDate) < new Date() && <span className="rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-black text-red-900">⚠️ OVERDUE</span>}
                                  </div>
                                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                                    {t.caseId !== "GENERAL" ? (
                                      <button onClick={() => { setSelectedCaseId(t.caseId); setScreen("cases"); setCaseBoardView("all_cases"); }}
                                        className="text-xs font-semibold text-blue-700 hover:underline">{t.caseId}</button>
                                    ) : <span className="text-xs text-slate-400">General</span>}
                                    {t.dueDate && (
                                      <span className={`text-xs font-semibold ${new Date(t.dueDate) < new Date() ? "text-red-700" : "text-slate-500"}`}>
                                        Due: {t.dueDate}
                                      </span>
                                    )}
                                  </div>
                                  {t.description && <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">{t.description}</p>}
                                </div>
                                <button onClick={() => void markTaskCompleted(t.id)}
                                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 active:scale-95 flex-shrink-0">
                                  ✓ Done
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                    {myPending.length === 0 && (
                      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 font-semibold">✓ No tasks assigned to you right now — you are all caught up!</div>
                    )}
                  </>
                );
              })()}

              {/* Create task */}
              <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
                <p className="text-sm font-bold text-slate-900 mb-3">➕ Create Task</p>
                <div className="space-y-2">
                  <input value={teamTaskTitle} onChange={(e) => setTeamTaskTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void createTeamTask()}
                    className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none"
                    placeholder="Task title — press Enter to save" />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <select value={teamTaskCaseId} onChange={(e) => setTeamTaskCaseId(e.target.value)}
                      className="rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm focus:border-emerald-400 focus:outline-none">
                      <option value="">General (no case)</option>
                      {visibleCases.slice(0,50).map((c) => <option key={c.id} value={c.id}>{c.client} · {c.id}</option>)}
                    </select>
                    <select value={teamTaskAssignedTo} onChange={(e) => setTeamTaskAssignedTo(e.target.value)}
                      className="rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm focus:border-emerald-400 focus:outline-none">
                      <option value="">Assign to...</option>
                      {taskAssigneeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <select value={teamTaskPriority} onChange={(e) => setTeamTaskPriority(e.target.value as "low"|"medium"|"high")}
                      className="rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm focus:border-emerald-400 focus:outline-none">
                      <option value="low">🟢 Low</option>
                      <option value="medium">🟡 Medium</option>
                      <option value="high">🔴 High</option>
                    </select>
                    <input type="date" value={teamTaskDueDate} onChange={(e) => setTeamTaskDueDate(e.target.value)}
                      className="rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm focus:border-emerald-400 focus:outline-none" />
                  </div>
                  <div className="flex gap-2">
                    <input value={teamTaskDescription} onChange={(e) => setTeamTaskDescription(e.target.value)}
                      className="flex-1 rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-2.5 text-sm placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none"
                      placeholder="Description (optional)" />
                    <button onClick={() => void createTeamTask()}
                      className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-slate-700 active:scale-95">
                      Add Task
                    </button>
                  </div>
                </div>
              </div>

              {/* All team tasks */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">All Team Tasks ({tasks.length})</p>
                  <div className="flex gap-1">
                    {(["all","pending","completed"] as const).map(f => (
                      <button key={f} onClick={() => setTaskViewFilter && setTaskViewFilter(f)}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50">
                        {f.charAt(0).toUpperCase()+f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  {tasks.filter(t => taskViewFilter === "all" ? true : t.status === taskViewFilter).map((t) => (
                    <article key={t.id} className={`rounded-xl border p-3 ${
                      t.status === "completed" ? "border-slate-100 bg-slate-50 opacity-50" :
                      t.priority === "high" ? "border-red-200 bg-red-50" :
                      t.dueDate && new Date(t.dueDate) < new Date() ? "border-amber-200 bg-amber-50" :
                      "border-slate-200 bg-white"
                    }`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className={`text-sm font-bold ${t.status === "completed" ? "line-through text-slate-400" : "text-slate-900"}`}>{t.title}</p>
                            {t.priority === "high" && t.status !== "completed" && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-700">HIGH</span>}
                            {t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "completed" && <span className="rounded-full bg-red-200 px-1.5 py-0.5 text-[9px] font-black text-red-900">OVERDUE</span>}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {t.caseId === "GENERAL" ? "General" : t.caseId} · {t.assignedTo || "Unassigned"}
                            {t.dueDate ? ` · ${new Date(t.dueDate) < new Date() && t.status !== "completed" ? "⚠️ " : ""}Due ${t.dueDate}` : ""}
                          </p>
                          {t.description && <p className="mt-1 text-xs text-slate-500">{t.description}</p>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {t.status !== "completed" && (
                            <button onClick={() => void markTaskCompleted(t.id)}
                              className="rounded-lg bg-slate-900 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-slate-700">✓ Done</button>
                          )}
                          {t.status === "completed" && <span className="text-[10px] font-semibold text-emerald-600">✓ Done</span>}
                        </div>
                      </div>
                    </article>
                  ))}
                  {tasks.length === 0 ? <p className="text-xs text-slate-500">No tasks yet.</p> : null}
                </div>
              </div>
            </div>
          ) : null}

          {screen === "files" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">📁 Files</h2>
                    <p className="mt-0.5 text-xs text-slate-500">Documents per case · {documents.length} file{documents.length !== 1 ? "s" : ""} loaded</p>
                  </div>
                </div>
                <select value={selectedCase?.id ?? ""} onChange={(e) => setSelectedCaseId(e.target.value)}
                  className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 focus:border-emerald-400 focus:bg-white focus:outline-none">
                  <option value="">— Select a case —</option>
                  {visibleCases.map((c) => <option key={c.id} value={c.id}>{c.client} · {c.formType} · {c.id}</option>)}
                </select>
              </div>
              <section className="rounded-xl border border-slate-200 bg-white p-5">

              <div className="space-y-2 mb-3">
                {documents.map((d) => (
                  <article key={d.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm gap-2">
                    <div>
                      <p className="font-semibold text-ink">{d.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{new Date(d.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                        d.status === "received" ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-amber-100 text-amber-800 border-amber-300"
                      }`}>{d.status}</span>
                      {d.link ? <a href={d.link} target="_blank" rel="noreferrer" className="text-[11px] text-blue-700 underline font-semibold">View</a> : null}
                    </div>
                  </article>
                ))}
                {documents.length === 0 ? <p className="text-xs text-slate-500 text-center py-4">No documents for this case.</p> : null}
              </div>

              <form className="grid gap-2 md:grid-cols-3 rounded-xl border border-slate-200 bg-slate-50 p-3" onSubmit={addDocument}>
                <input name="name" placeholder="Document name" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none" />
                <input name="link" placeholder="Drive link (optional)" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none" />
                <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">+ Add Document</button>
              </form>
            </section>
            </div>
          ) : null}
          {screen === "inbox" ? (
            <section className="h-[calc(100vh-8rem)] flex gap-0 rounded-2xl border border-slate-200 overflow-hidden bg-white">

              {/* LEFT: Thread list */}
              <div className={`flex flex-col border-r border-slate-100 ${inboxThread ? "hidden md:flex md:w-72 shrink-0" : "w-full md:w-72 shrink-0"}`}>
                  {/* Global inbox search */}
                  <div className="px-3 py-2 border-b border-slate-100 bg-white shrink-0">
                    <input
                      value={inboxGlobalSearch||""}
                      onChange={e=>setInboxGlobalSearch(e.target.value)}
                      placeholder="🔍 Search all conversations..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setInboxShowArchived(false); setInboxLoaded(false); setInboxThread(null); }} className={`text-xs font-bold px-2 py-1 rounded-lg ${!inboxShowArchived ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>Active</button>
                    <button onClick={() => { setInboxShowArchived(true); setInboxLoaded(false); setInboxThread(null); }} className={`text-xs font-bold px-2 py-1 rounded-lg ${inboxShowArchived ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>📦 Archived</button>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">💬 Inbox</p>
                    <p className="text-[10px] text-slate-400">{sessionUser?.role === "Processing" ? "Your clients" : "All conversations"}</p>
                  </div>
                  <button onClick={async () => {
                    setInboxLoaded(false);
                    const res = await apiFetch("/inbox", { cache: "no-store" });
                    const d = await res.json().catch(()=>({}));
                    setInboxMessages(d.messages || []);
                    setInboxLoaded(true);
                  }} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold hover:bg-white">↻</button>
                </div>

                {!inboxLoaded && (() => {
                  apiFetch(`/inbox${inboxShowArchived ? "?archived=1" : ""}`, { cache: "no-store" }).then(r => r.json()).then(d => { setInboxMessages(d.messages || []); setInboxLoaded(true); }).catch(()=>setInboxLoaded(true));
                  // Auto-refresh inbox every 5 seconds
                  const inboxTimer = setInterval(() => {
                    apiFetch(`/inbox${inboxShowArchived ? "?archived=1" : ""}`, { cache: "no-store" })
                      .then(r => r.json())
                      .then(d => { if (d.messages) setInboxMessages(d.messages); })
                      .catch(() => {});
                  }, 5000);
                  return () => clearInterval(inboxTimer);
                  return <p className="text-xs text-slate-400 py-8 text-center">Loading...</p>;
                })()}

                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                  {inboxLoaded && (() => {
                    const threads: Record<string, typeof inboxMessages> = {};
                    inboxMessages.forEach(m => { if (!threads[m.phone]) threads[m.phone] = []; threads[m.phone].push(m); });
                    // Filter by global search
                    if (inboxGlobalSearch) {
                      const q = inboxGlobalSearch.toLowerCase();
                      Object.keys(threads).forEach(phone => {
                        const hasMatch = threads[phone].some(m => 
                          m.message.toLowerCase().includes(q) || 
                          (m.matched_case_name||"").toLowerCase().includes(q) ||
                          phone.includes(q)
                        );
                        if (!hasMatch) delete threads[phone];
                      });
                    }
                    const threadList = Object.entries(threads).map(([phone, msgs]) => {
                      const mp = phone.replace(/\D/g,"");
                      const matchedCase = cases.find(c => { const cp=(c.leadPhone||"").replace(/\D/g,""); return cp && mp.slice(-9)===cp.slice(-9); });
                      return { phone, msgs, matchedCase };
                    }).filter(({ matchedCase }) => {
                      if (!matchedCase) return sessionUser?.role !== "Processing";
                      if (sessionUser?.role === "Processing") return String(matchedCase.assignedTo||"").toLowerCase()===String(sessionUser?.name||"").toLowerCase();
                      return true;
                    }).sort((a,b) => {
                      // Sort: urgent unanswered first, then waiting, then unread, then recent
                      const getWaitMins = (msgs: typeof a.msgs) => {
                        const lastIn = [...msgs].filter(m=>m.direction==="inbound").sort((x,y)=>new Date(y.created_at).getTime()-new Date(x.created_at).getTime())[0];
                        const lastOut = [...msgs].filter(m=>m.direction==="outbound").sort((x,y)=>new Date(y.created_at).getTime()-new Date(x.created_at).getTime())[0];
                        if (!lastIn) return -1;
                        if (lastOut && new Date(lastOut.created_at) > new Date(lastIn.created_at)) return -1;
                        return Math.floor((Date.now() - new Date(lastIn.created_at).getTime()) / 60000);
                      };
                      const aw = getWaitMins(a.msgs);
                      const bw = getWaitMins(b.msgs);
                      if (bw >= 120 && aw < 120) return 1;
                      if (aw >= 120 && bw < 120) return -1;
                      if (bw >= 30 && aw < 30) return 1;
                      if (aw >= 30 && bw < 30) return -1;
                      const au = a.msgs.filter(m=>!m.is_read&&m.direction==="inbound").length;
                      const bu = b.msgs.filter(m=>!m.is_read&&m.direction==="inbound").length;
                      // Pin staff numbers to top
                      const aIsStaff = STAFF_PHONES.some(p => a.phone.includes(p.slice(-9)));
                      const bIsStaff = STAFF_PHONES.some(p => b.phone.includes(p.slice(-9)));
                      if (aIsStaff && !bIsStaff) return -1;
                      if (!aIsStaff && bIsStaff) return 1;
                      if (bu !== au) return bu - au;
                      return Math.max(bw, 0) - Math.max(aw, 0);
                    });

                    if (threadList.length === 0) return <p className="text-xs text-slate-400 py-8 text-center">No messages yet</p>;

                    return threadList.map(({ phone, msgs, matchedCase }) => {
                      const unread = msgs.filter(m=>!m.is_read&&m.direction==="inbound").length;
                      const isStaff = STAFF_PHONES.some(p => phone.includes(p.slice(-9)));
                      const clientName = isStaff ? "Newton Team" : matchedCase?.client || msgs[0]?.matched_case_name || "Unknown";
                      const lastMsg = [...msgs].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0];
                      const isSelected = inboxThread === phone;
                      const isUnknown = !matchedCase;
                      // Priority: time since last unanswered inbound message
                      const lastIn = [...msgs].filter(m=>m.direction==="inbound").sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0];
                      const lastOut = [...msgs].filter(m=>m.direction==="outbound").sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0];
                      const SIMPLE_REPLIES = /^(ok|okay|yes|no|k|👍|thanks|thank you|thx|confirmed|sure|noted|received|done|got it|ji|haa|nahi|theek|shukriya|ਹਾਂ|ਠੀਕ|ਜੀ|✅|👌|🙏|hmm|hm|yep|yup|nope)$/i;
                      const lastInIsSimple = lastIn ? SIMPLE_REPLIES.test(lastIn.message.trim()) : false;
                      const needsReply = lastIn && !lastInIsSimple && (!lastOut || new Date(lastIn.created_at) > new Date(lastOut.created_at));
                      const waitMins = needsReply ? Math.floor((Date.now() - new Date(lastIn.created_at).getTime()) / 60000) : null;
                      const isUrgent = waitMins !== null && waitMins >= 120;
                      const isPending = waitMins !== null && waitMins >= 30 && !isUrgent;
                      const waitLabel = waitMins !== null ? (waitMins >= 60 ? `${Math.floor(waitMins/60)}h` : `${waitMins}m`) : null;
                      return (
                        <button key={phone} onClick={() => {
                          setInboxThread(phone);
                          if (unread > 0) {
                            msgs.filter(m=>!m.is_read).forEach(m => apiFetch("/inbox",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:m.id})}).catch(()=>null));
                            setInboxMessages(prev=>prev.map(m=>m.phone===phone?{...m,is_read:true}:m));
                          }
                        }} className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${isSelected?"bg-blue-50 border-l-2 border-blue-500":isUrgent?"bg-red-50 border-l-2 border-red-400 hover:bg-red-100":isPending?"bg-amber-50 border-l-2 border-amber-300 hover:bg-amber-100":"hover:bg-slate-50"}`}>
                          <div className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold mt-0.5 ${isUnknown?"bg-orange-100 text-orange-700":isUrgent?"bg-red-100 text-red-700":isPending?"bg-amber-100 text-amber-700":"bg-emerald-100 text-emerald-700"}`}>
                            {(clientName||"?").charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <p className={`text-sm font-semibold truncate ${isSelected?"text-blue-900":isUrgent?"text-red-800":isPending?"text-amber-800":"text-slate-900"}`}>{clientName}</p>
                              <div className="flex items-center gap-1 shrink-0">
                                {isUrgent && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-black text-white">🔴 {waitLabel}</span>}
                                {isPending && <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-black text-white">⏳ {waitLabel}</span>}
                                {unread > 0 && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>}
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {STAFF_PHONES.some(p => phone.includes(p.slice(-9))) ? "📌 Newton Team" : matchedCase ? matchedCase.formType + " · " + (matchedCase.assignedTo || "Unassigned") : "⚠️ Unknown"}
                            </p>
                            <p className={`text-[11px] truncate ${isUrgent?"text-red-500 font-semibold":isPending?"text-amber-600":"text-slate-400"}`}>
                              {isUrgent?"⚠️ Needs reply · ":isPending?"⏳ Waiting · ":lastMsg?.direction==="outbound"?"You: ":""}{lastMsg?.message?.slice(0,35)}
                            </p>
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* RIGHT: Chat window */}
              {inboxThread ? (() => {
                const phone = inboxThread;
                const msgs = inboxMessages.filter(m=>m.phone===phone);
                const mp = phone.replace(/\D/g,"");
                const matchedCase = cases.find(c=>{ const cp=(c.leadPhone||"").replace(/\D/g,""); return cp && mp.slice(-9)===cp.slice(-9); });
                const clientName = matchedCase?.client || msgs[0]?.matched_case_name || "Unknown";
                const sortedMsgs = [...msgs].sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime());
                const isUnknown = !matchedCase;
                return (
                  <div className="flex-1 flex min-w-0 overflow-hidden">
                  <div className="flex-1 flex flex-col min-w-0">
                    {/* Chat header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white shrink-0">
                      <div className="flex items-center gap-3">
                        <button onClick={() => setInboxThread(null)} className="md:hidden rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold hover:bg-slate-50">← Back</button>
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${isUnknown?"bg-orange-100 text-orange-700":"bg-emerald-100 text-emerald-700"}`}>
                          {(clientName||"?").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{clientName}</p>
                          <p className="text-[10px] text-slate-400">
                            {matchedCase ? matchedCase.id + " · " + matchedCase.formType + " · 👤 " + (matchedCase.assignedTo||"Unassigned") : phone}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isUnknown && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <input
                              placeholder="💾 Save name (Enter)"
                              className="rounded-lg border border-orange-200 bg-white px-2 py-1.5 text-xs font-semibold text-orange-700 w-36 focus:outline-none focus:border-orange-400"
                              onKeyDown={async e => {
                                if (e.key !== "Enter") return;
                                const name = (e.target as HTMLInputElement).value.trim();
                                if (!name) return;
                                await apiFetch(`/inbox`, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({action:"saveName", phone, name})});
                                setInboxMessages(prev => prev.map(m => m.phone === phone ? {...m, matched_case_name: name} : m));
                                (e.target as HTMLInputElement).value = "";
                              }}
                            />
                            <select defaultValue="" onChange={async e => {
                              const cId = e.target.value; if (!cId) return;
                              await apiFetch(`/cases/${cId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({leadPhone:phone})});
                              setCases(prev=>prev.map(c=>c.id===cId?{...c,leadPhone:phone}:c));
                              setInboxMessages(prev=>prev.map(m=>m.phone===phone?{...m,matched_case_id:cId}:m));
                            }} className="rounded-lg border border-orange-200 bg-white px-2 py-1.5 text-xs font-semibold text-orange-700">
                              <option value="">⚠️ Link to case...</option>
                              {cases.slice(0,50).map(c=><option key={c.id} value={c.id}>{c.client} — {c.id}</option>)}
                            </select>
                          </div>
                        )}
                        {matchedCase && (
                          <button onClick={() => { setSelectedCaseId(matchedCase.id); setScreen("cases"); }}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                            Open Case →
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Search bar */}
                    <div className="px-4 py-2 border-b border-slate-100 bg-white shrink-0">
                      <input
                        value={inboxSearch[phone]||""}
                        onChange={e=>setInboxSearch(prev=>({...prev,[phone]:e.target.value}))}
                        placeholder="🔍 Search in this chat..."
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-400"
                      />
                      {inboxSearch[phone] && (
                        <p className="text-[10px] text-slate-400 mt-1 px-1">
                          {sortedMsgs.filter(m=>m.message.toLowerCase().includes((inboxSearch[phone]||"").toLowerCase())).length} results
                        </p>
                      )}
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-[#f0f2f5]">
                      {(() => {
                        const searchQ = (inboxSearch[phone]||"").toLowerCase();
                        const filtered = searchQ ? sortedMsgs.filter(m=>m.message.toLowerCase().includes(searchQ)) : sortedMsgs;
                        const elements: React.ReactNode[] = [];
                        let lastDate = "";
                        filtered.forEach((m, idx) => {
                          // Date separator
                          const msgDate = new Date(m.created_at);
                          const today = new Date();
                          const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
                          const dateStr = msgDate.toDateString();
                          let dateLabel = "";
                          if (dateStr === today.toDateString()) dateLabel = "Today";
                          else if (dateStr === yesterday.toDateString()) dateLabel = "Yesterday";
                          else dateLabel = msgDate.toLocaleDateString("en-CA", {day:"numeric",month:"long",year:"numeric"});
                          
                          if (dateLabel !== lastDate) {
                            lastDate = dateLabel;
                            elements.push(
                              <div key={`date-${idx}`} className="flex justify-center my-3">
                                <span className="bg-white text-slate-500 text-[11px] font-medium px-3 py-1 rounded-full shadow-sm border border-slate-200">{dateLabel}</span>
                              </div>
                            );
                          }

                          // Message bubble
                          const isOut = m.direction==="outbound";
                          const isMedia = m.message.includes("[image received]") || m.message.includes("[document received]");
                          const isImage = m.message.includes("[image received]");
                          const isDoc = m.message.includes("[document received]");
                          const isAudio = m.message.includes("[audio received]");
                          const time = new Date(m.created_at).toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit"});
                          
                          elements.push(
                            <div key={m.id||idx} className={`flex ${isOut?"justify-end":"justify-start"} mb-1`}>
                              <div className={`max-w-[72%] ${isOut?"bg-[#d9fdd3]":"bg-white"} rounded-2xl px-3.5 py-2 shadow-sm ${isOut?"rounded-br-sm":"rounded-bl-sm"} ${searchQ && m.message.toLowerCase().includes(searchQ) ? "ring-2 ring-yellow-400" : ""}`}>
                                {isImage && (
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-2xl">🖼️</span>
                                    <span className="text-sm text-slate-600 font-medium">Image</span>
                                  </div>
                                )}
                                {isDoc && (
                                  <div className="flex items-center gap-2 mb-1 bg-slate-50 rounded-xl p-2 border border-slate-200">
                                    <span className="text-2xl">📄</span>
                                    <div>
                                      <p className="text-sm font-semibold text-slate-800">Document</p>
                                      <p className="text-[10px] text-slate-500">Tap to open in case docs</p>
                                    </div>
                                  </div>
                                )}
                                {isAudio && (
                                  <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-2 border border-slate-200">
                                    <span className="text-xl">🎵</span>
                                    <span className="text-sm text-slate-600">Voice message</span>
                                  </div>
                                )}
                                {!isMedia && <p className="text-sm text-slate-900 whitespace-pre-wrap break-words leading-relaxed">{m.message}</p>}
                                <div className={`flex items-center justify-end gap-1 mt-0.5`}>
                                  <span className="text-[10px] text-slate-400">{time}</span>
                                  {isOut && <span className="text-[11px] text-blue-500">✓✓</span>}
                                </div>
                              </div>
                            </div>
                          );
                        });
                        if (filtered.length === 0) {
                          elements.push(<p key="empty" className="text-center text-xs text-slate-400 py-8">{searchQ ? "No messages found" : "No messages yet"}</p>);
                        }
                        return elements;
                      })()}
                    </div>

                    {/* Reply box */}
                    <div className="flex flex-col px-4 py-3 border-t border-slate-100 bg-white shrink-0 gap-2">
                      {inboxAttachment[phone] && (
                        <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-1.5">
                          <span className="text-sm">📎</span>
                          <span className="text-xs text-slate-600 truncate flex-1">{inboxAttachment[phone].name}</span>
                          <button onClick={() => setInboxAttachment(prev=>({...prev,[phone]:null}))} className="text-slate-400 hover:text-red-500 text-xs">✕</button>
                        </div>
                      )}
                      <div className="flex gap-2">
                      <label className="cursor-pointer flex items-center justify-center rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2.5 hover:border-emerald-400 transition-colors" title="Attach file">
                        <span className="text-slate-500 text-base">📎</span>
                        <input type="file" className="hidden" accept="image/*,.pdf,.doc,.docx" onChange={async e => {
                          const file = e.target.files?.[0]; if (!file) return;
                          const reader = new FileReader();
                          reader.onload = ev => {
                            const data = (ev.target?.result as string).split(",")[1];
                            setInboxAttachment(prev=>({...prev,[phone]:{name:file.name, type:file.type, data}}));
                          };
                          reader.readAsDataURL(file);
                          e.target.value = "";
                        }} />
                      </label>
                      <input value={inboxReply[phone]||""} onChange={e=>setInboxReply(prev=>({...prev,[phone]:e.target.value}))}
                        placeholder={`Message ${clientName}...`}
                        className="flex-1 rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-emerald-400 focus:outline-none focus:bg-white"
                        onKeyDown={async e => {
                          if (e.key!=="Enter") return;
                          const text=(inboxReply[phone]||"").trim(); if (!text) return;
                          const res = await apiFetch("/inbox/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone.replace(/\D/g,""),message:text,caseId:matchedCase?.id||null})}).catch(()=>null);
                          if (res?.ok) { setInboxReply(prev=>({...prev,[phone]:""})); setInboxAttachment(prev=>({...prev,[phone]:null})); setInboxMessages(prev=>[{id:`tmp-${Date.now()}`,phone,message:text,direction:"outbound",matched_case_id:matchedCase?.id||null,matched_case_name:clientName,is_read:true,created_at:new Date().toISOString()},...prev]); }
                          else { setCaseActionStatus("❌ Failed to send"); setTimeout(()=>setCaseActionStatus(""),3000); }
                        }} />
                      <button onClick={async () => {
                        const text=(inboxReply[phone]||"").trim(); if (!text) return;
                        const res = await apiFetch("/inbox/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone.replace(/\D/g,""),message:text,caseId:matchedCase?.id||null})}).catch(()=>null);
                        if (res?.ok) { setInboxReply(prev=>({...prev,[phone]:""})); setInboxAttachment(prev=>({...prev,[phone]:null})); setInboxMessages(prev=>[{id:`tmp-${Date.now()}`,phone,message:text,direction:"outbound",matched_case_id:matchedCase?.id||null,matched_case_name:clientName,is_read:true,created_at:new Date().toISOString()},...prev]); }
                        else { setCaseActionStatus("❌ Failed to send"); setTimeout(()=>setCaseActionStatus(""),3000); }
                      }} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 shrink-0">Send</button>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT: Smart Suggestions Panel */}
                  <div className="hidden lg:flex flex-col w-64 shrink-0 border-l border-slate-100 bg-slate-50 overflow-y-auto">
                    <div className="px-4 py-3 border-b border-slate-100">
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">🤖 Quick Send</p>
                      {matchedCase && <p className="text-[11px] text-slate-400 mt-0.5">{matchedCase.formType} · {clientName}</p>}
                    </div>

                    <div className="p-3 space-y-2">

                      {/* Send Checklist */}
                      {matchedCase && (() => {
                        const checklist = getChecklistForFormType(matchedCase.formType);
                        if (!checklist.length) return null;
                        const required = checklist.filter(i => i.required);
                        const optional = checklist.filter(i => !i.required);
                        const checklistMsg = [
                          `📋 *Document Checklist — ${matchedCase.formType}*`,
                          ``,
                          `*Required Documents:*`,
                          ...required.map((item, i) => `${i+1}. ${item.label}`),
                          ...(optional.length ? [
                            ``,
                            `*Additional (if applicable):*`,
                            ...optional.map((item, i) => `• ${item.label}`)
                          ] : []),
                          ``,
                          `Please send clear photos or scans of all documents. Thank you! 🙏`,
                          ``,
                          `— Newton Immigration Team 🍁`,
                        ].join("\n");
                        return (
                          <button onClick={async () => {
                            const res = await apiFetch("/inbox/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone.replace(/\D/g,""),message:checklistMsg,caseId:matchedCase.id})}).catch(()=>null);
                            if (res?.ok) { setInboxMessages(prev=>[{id:`tmp-${Date.now()}`,phone,message:checklistMsg,direction:"outbound",matched_case_id:matchedCase.id,matched_case_name:clientName,is_read:true,created_at:new Date().toISOString()},...prev]); setCaseActionStatus("✅ Checklist sent!"); setTimeout(()=>setCaseActionStatus(""),3000); }
                          }} className="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-left hover:bg-blue-100 transition-colors">
                            <p className="text-xs font-bold text-blue-800">📋 Send Document Checklist</p>
                            <p className="text-[10px] text-blue-600 mt-0.5">{checklist.filter((i: any) => i.required).length} required · {checklist.filter((i: any) => !i.required).length} optional</p>
                          </button>
                        );
                      })()}

                      {/* Send Questions */}
                      {matchedCase && (() => {
                        const questions = getQuestionPromptsForFormType(matchedCase.formType);
                        if (!questions.length) return null;
                        const questionList = questions.map((q, i) => `*${i+1}.* ${q}`).join("\n\n");
                        const questionsMsg = [
                          `📝 *Intake Questions for ${matchedCase.formType}*`,
                          ``,
                          `Please reply with all answers numbered in ONE message:`,
                          ``,
                          `━━━━━━━━━━━━━━━`,
                          questionList,
                          `━━━━━━━━━━━━━━━`,
                          ``,
                          `Take your time. Reply with all answers together. 🙏`,
                        ].join("\n");
                        return (
                          <button onClick={async () => {
                            const res = await apiFetch("/inbox/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone.replace(/\D/g,""),message:questionsMsg,caseId:matchedCase.id})}).catch(()=>null);
                            if (res?.ok) { setInboxMessages(prev=>[{id:`tmp-${Date.now()}`,phone,message:questionsMsg,direction:"outbound",matched_case_id:matchedCase.id,matched_case_name:clientName,is_read:true,created_at:new Date().toISOString()},...prev]); setCaseActionStatus("✅ Questions sent!"); setTimeout(()=>setCaseActionStatus(""),3000); }
                          }} className="w-full rounded-xl border border-purple-200 bg-purple-50 px-3 py-2.5 text-left hover:bg-purple-100 transition-colors">
                            <p className="text-xs font-bold text-purple-800">📝 Send Intake Questions</p>
                            <p className="text-[10px] text-purple-600 mt-0.5">{questions.length} questions</p>
                          </button>
                        );
                      })()}

                      {/* Send Greeting */}
                      <button onClick={async () => {
                        const greetMsg = `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${clientName.split(" ")[0]} ਜੀ! 🙏\nHi *${clientName.split(" ")[0]}*! Welcome to *Newton Immigration*. Thank you for choosing us. Our team will guide you through every step. Please feel free to reach out anytime!\n\n— Newton Immigration Team 🍁`;
                        const res = await apiFetch("/inbox/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone.replace(/\D/g,""),message:greetMsg,caseId:matchedCase?.id||null})}).catch(()=>null);
                        if (res?.ok) { setInboxMessages(prev=>[{id:`tmp-${Date.now()}`,phone,message:greetMsg,direction:"outbound",matched_case_id:matchedCase?.id||null,matched_case_name:clientName,is_read:true,created_at:new Date().toISOString()},...prev]); setCaseActionStatus("✅ Greeting sent!"); setTimeout(()=>setCaseActionStatus(""),3000); }
                      }} className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-left hover:bg-emerald-100 transition-colors">
                        <p className="text-xs font-bold text-emerald-800">👋 Send Greeting</p>
                        <p className="text-[10px] text-emerald-600 mt-0.5">Welcome message in English + Punjabi</p>
                      </button>

                      {/* AI Smart Reply */}
                      <button onClick={async () => {
                        const lastMsg = inboxMessages.filter(m=>m.phone===phone && m.direction==="inbound").sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0];
                        if (!lastMsg) { setCaseActionStatus("No client message to reply to"); setTimeout(()=>setCaseActionStatus(""),3000); return; }
                        setInboxAiLoading(prev=>({...prev,[phone]:true}));
                        const res = await apiFetch("/ai-reply", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone.replace(/\D/g,""),message:lastMsg.message,caseId:matchedCase?.id||null,action:"suggest"})}).catch(()=>null);
                        const d = await res?.json().catch(()=>({}));
                        if (d?.text) setInboxAiSuggestion(prev=>({...prev,[phone]:d.text}));
                        setInboxAiLoading(prev=>({...prev,[phone]:false}));
                      }} className="w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-left hover:bg-violet-100 transition-colors">
                        <p className="text-xs font-bold text-violet-800">{inboxAiLoading[phone] ? "🤖 Generating..." : "🤖 AI Smart Reply"}</p>
                        <p className="text-[10px] text-violet-600 mt-0.5">Generate reply from last client message</p>
                      </button>

                      {/* Show AI suggestion if available */}
                      {inboxAiSuggestion[phone] && (
                        <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-2.5 space-y-2">
                          <p className="text-[10px] font-bold text-violet-700">AI Suggestion:</p>
                          <p className="text-xs text-slate-700 whitespace-pre-wrap">{inboxAiSuggestion[phone]}</p>
                          <div className="flex gap-1.5">
                            <button onClick={async () => {
                              const msg = inboxAiSuggestion[phone];
                              const res = await apiFetch("/inbox/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone.replace(/\D/g,""),message:msg,caseId:matchedCase?.id||null})}).catch(()=>null);
                              if (res?.ok) { setInboxMessages(prev=>[{id:`tmp-${Date.now()}`,phone,message:msg,direction:"outbound",matched_case_id:matchedCase?.id||null,matched_case_name:clientName,is_read:true,created_at:new Date().toISOString()},...prev]); setInboxAiSuggestion(prev=>({...prev,[phone]:""})); setCaseActionStatus("✅ AI reply sent!"); setTimeout(()=>setCaseActionStatus(""),3000); }
                            }} className="flex-1 rounded-lg bg-violet-600 py-1.5 text-[10px] font-bold text-white hover:bg-violet-700">Send</button>
                            <button onClick={() => { setInboxReply(prev=>({...prev,[phone]:inboxAiSuggestion[phone]})); setInboxAiSuggestion(prev=>({...prev,[phone]:""})); }} className="flex-1 rounded-lg border border-violet-300 py-1.5 text-[10px] font-bold text-violet-700 hover:bg-violet-100">Edit first</button>
                            <button onClick={() => setInboxAiSuggestion(prev=>({...prev,[phone]:""}))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] text-slate-400 hover:bg-slate-50">✕</button>
                          </div>
                        </div>
                      )}

                      {/* Send Reminder */}
                      <button onClick={async () => {
                        const reminderMsg = `Hi *${clientName.split(" ")[0]}*! 👋 This is a gentle reminder from Newton Immigration. We are still waiting for your documents/answers. Please send them at your earliest convenience so we can move forward with your application. Thank you! 🙏`;
                        const res = await apiFetch("/inbox/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone.replace(/\D/g,""),message:reminderMsg,caseId:matchedCase?.id||null})}).catch(()=>null);
                        if (res?.ok) { setInboxMessages(prev=>[{id:`tmp-${Date.now()}`,phone,message:reminderMsg,direction:"outbound",matched_case_id:matchedCase?.id||null,matched_case_name:clientName,is_read:true,created_at:new Date().toISOString()},...prev]); setCaseActionStatus("✅ Reminder sent!"); setTimeout(()=>setCaseActionStatus(""),3000); }
                      }} className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left hover:bg-amber-100 transition-colors">
                        <p className="text-xs font-bold text-amber-800">⏰ Send Reminder</p>
                        <p className="text-[10px] text-amber-600 mt-0.5">Gentle follow-up message</p>
                      </button>

                      {/* Appointment */}
                      <button onClick={async () => {
                        const apptMsg = `Hi *${clientName.split(" ")[0]}*! Your application is ready for review. Please call us at your earliest convenience to schedule a consultation.\n\n📞 Newton Immigration\n🕐 Mon-Fri 9AM-5PM\n\nThank you! 🙏`;
                        const res = await apiFetch("/inbox/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone.replace(/\D/g,""),message:apptMsg,caseId:matchedCase?.id||null})}).catch(()=>null);
                        if (res?.ok) { setInboxMessages(prev=>[{id:`tmp-${Date.now()}`,phone,message:apptMsg,direction:"outbound",matched_case_id:matchedCase?.id||null,matched_case_name:clientName,is_read:true,created_at:new Date().toISOString()},...prev]); setCaseActionStatus("✅ Message sent!"); setTimeout(()=>setCaseActionStatus(""),3000); }
                      }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:bg-slate-50 transition-colors">
                        <p className="text-xs font-bold text-slate-700">📞 Schedule Call</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Invite client to call</p>
                      </button>

                      {caseActionStatus && <p className="text-xs font-bold text-emerald-700 text-center py-1">{caseActionStatus}</p>}

                    </div>
                  </div>
                  </div>
                );
              })() : (
                <div className="flex-1 flex items-center justify-center bg-slate-50">
                  <div className="text-center">
                    <p className="text-3xl mb-2">💬</p>
                    <p className="text-sm font-semibold text-slate-600">Select a conversation</p>
                    <p className="text-xs text-slate-400 mt-1">Click a client on the left to open their chat</p>
                  </div>
                </div>
              )}

            </section>) : null}

          {screen === "team" ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-lg font-bold text-slate-900">👥 Team</h2>
                <p className="mt-0.5 text-xs text-slate-500">View team members, their cases, and leave notes.</p>
              </div>

              {/* Team grid */}
              <div className="grid gap-4 md:grid-cols-2">
                {teamUsers.filter(u => u.active !== false).map(member => {
                  const mCases = cases.filter(c => String(c.assignedTo||"").toLowerCase() === member.name.toLowerCase());
                  const activeMCases = mCases.filter(c => c.processingStatus !== "submitted" && c.caseStatus !== "closed");
                  const urgent = mCases.filter(c => isUrgentCase(c)).length;
                  const pending = mCases.filter(c => c.processingStatus !== "submitted").length;
                  const submitted = mCases.filter(c => c.processingStatus === "submitted").length;
                  const isOpen = staffProfileUserId === member.id;
                  const noteCount = staffNoteCounts[member.id] || 0;
                  const roleColor: Record<string,string> = {
                    Admin: "bg-purple-100 text-purple-700",
                    Processing: "bg-blue-100 text-blue-700",
                    ProcessingLead: "bg-indigo-100 text-indigo-700",
                    Marketing: "bg-pink-100 text-pink-700",
                    Reviewer: "bg-amber-100 text-amber-700",
                  };
                  return (
                    <div key={member.id} className={`rounded-xl border-2 bg-white overflow-hidden transition-all ${isOpen ? "border-slate-900" : "border-slate-200"}`}>
                      {/* Member header */}
                      <div className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-lg font-black text-white">
                                {(member.name||"?").charAt(0).toUpperCase()}
                              </div>
                              <div className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${member.active !== false ? "bg-emerald-400" : "bg-slate-300"}`} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-bold text-slate-900">{member.name}</p>
                                {member.id === sessionUser?.id && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">you</span>}
                              </div>
                              <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${roleColor[member.role] || "bg-slate-100 text-slate-600"}`}>{member.role}</span>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => { setCaseAssignedFilter(member.name); setScreen("cases"); }}
                              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300">
                              Cases →
                            </button>
                            <button onClick={() => isOpen ? setStaffProfileUserId(null) : void loadStaffProfile(member.id)}
                              className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${isOpen ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"}`}>
                              {isOpen ? "Close" : "Notes"}
                            </button>
                          </div>
                        </div>

                        {/* Stats row */}
                        <div className="mt-3 grid grid-cols-4 gap-2">
                          <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <p className="text-lg font-black text-slate-900">{activeMCases.length}</p>
                            <p className="text-[9px] font-bold uppercase text-slate-400">Cases</p>
                          </div>
                          <div className={`rounded-lg p-2 text-center ${urgent > 0 ? "bg-red-50" : "bg-slate-50"}`}>
                            <p className={`text-lg font-black ${urgent > 0 ? "text-red-700" : "text-slate-900"}`}>{urgent}</p>
                            <p className="text-[9px] font-bold uppercase text-slate-400">Urgent</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <p className="text-lg font-black text-slate-900">{pending}</p>
                            <p className="text-[9px] font-bold uppercase text-slate-400">Active</p>
                          </div>
                          <div className={`rounded-lg p-2 text-center ${noteCount > 0 ? "bg-amber-50" : "bg-slate-50"}`}>
                            <p className={`text-lg font-black ${noteCount > 0 ? "text-amber-700" : "text-slate-900"}`}>{noteCount}</p>
                            <p className="text-[9px] font-bold uppercase text-slate-400">Notes</p>
                          </div>
                        </div>
                      </div>

                      {/* Expanded profile */}
                      {isOpen && (
                        <div className="border-t border-slate-100">
                          {/* Cases list */}
                          {mCases.length > 0 && (
                            <div className="p-4 border-b border-slate-100">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Active Cases</p>
                              <div className="space-y-1.5 max-h-48 overflow-auto">
                                {mCases.slice(0, 8).map(c => (
                                  <button key={c.id} onClick={() => { setSelectedCaseId(c.id); setScreen("cases"); setCaseBoardView("all_cases"); setStaffProfileUserId(null); }}
                                    className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left hover:shadow-sm ${isUrgentCase(c) ? "border-red-200 bg-red-50" : "border-slate-100 bg-white hover:border-slate-200"}`}>
                                    <div>
                                      <p className="text-sm font-semibold text-slate-900">{c.client}</p>
                                      <p className="text-xs text-slate-400">{c.formType} · {c.processingStatus || "docs_pending"}</p>
                                    </div>
                                    {isUrgentCase(c) && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold text-red-700">URGENT</span>}
                                  </button>
                                ))}
                                {mCases.length > 8 && <p className="text-xs text-slate-400 pt-1 text-center">+{mCases.length - 8} more</p>}
                              </div>
                            </div>
                          )}

                          {/* Notes section */}
                          <div className="p-4">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-3">Team Notes on {member.name.split(" ")[0]}</p>

                            {/* Existing notes */}
                            {staffProfileNotes.length > 0 && (
                              <div className="space-y-2 mb-3 max-h-40 overflow-auto">
                                {staffProfileNotes.map(note => (
                                  <div key={note.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1">
                                        <p className="text-xs text-slate-800">{note.text}</p>
                                        <p className="text-[10px] text-slate-400 mt-1">— {note.authorName} · {new Date(note.createdAt).toLocaleDateString()}</p>
                                      </div>
                                      {(note.authorId === sessionUser?.id || sessionUser?.role === "Admin") && (
                                        <button onClick={() => void deleteStaffProfileNote(note.id)} className="text-slate-300 hover:text-red-400 text-xs">✕</button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Add note */}
                            <div className="flex gap-2">
                              <textarea
                                value={staffNoteDrafts[member.id] || ""}
                                onChange={(e) => setStaffNoteDrafts(prev => ({...prev, [member.id]: e.target.value}))}
                                placeholder={`Leave a note on ${member.name.split(" ")[0]}...`}
                                rows={2}
                                className="flex-1 rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-sm placeholder-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none resize-none"
                              />
                              <button onClick={() => { setStaffProfileUserId(member.id); void postStaffNote(); }}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 self-end">
                                Post
                              </button>
                            </div>
                            {staffNoteStatus && <p className="mt-1 text-xs text-slate-500">{staffNoteStatus}</p>}

                            {/* Admin actions */}
                            {sessionUser?.role === "Admin" && (
                              <div className="mt-4 pt-3 border-t border-slate-100 flex gap-2 flex-wrap">
                                <input value={teamPasswordDrafts[member.id] || ""} onChange={(e) => setTeamPasswordDrafts(prev => ({...prev, [member.id]: e.target.value}))}
                                  placeholder="Reset password" className="rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-xs flex-1 focus:border-slate-300 focus:outline-none" />
                                <button onClick={() => void resetTeamMemberPassword(member.id)}
                                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Reset</button>
                                <button onClick={() => void setTeamMemberActive(member.id, member.active === false)}
                                  className={`rounded-xl border px-3 py-2 text-xs font-semibold ${member.active === false ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
                                  {member.active === false ? "Reactivate" : "Deactivate"}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

                    {caseDetailTab === "ai" && (
                      <div className="h-[500px]">
                        <AiAssistantPanel caseId={selectedCase.id} caseItem={selectedCase} />
                      </div>
                    )}
                    {caseDetailTab === "notes" ? (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <textarea
                            id="case-note-input"
                            placeholder="Add an internal note about this case..."
                            rows={3}
                            className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-emerald-400 focus:outline-none resize-none"
                          />
                          <div className="flex gap-2">
                          <button onClick={async () => {
                            // AI suggests note content
                            const el = document.getElementById("case-note-input") as HTMLTextAreaElement;
                            const res = await apiFetch(`/cases/${selectedCase.id}/ai-smart`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"draft_notes"})}).catch(()=>null);
                            const d = await res?.json().catch(()=>({}));
                            if (d?.text && el) el.value = d.text;
                          }} className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100">
                            🤖 AI Draft
                          </button>
                          <button onClick={async () => {
                            const el = document.getElementById("case-note-input") as HTMLTextAreaElement;
                            const text = el?.value?.trim();
                            if (!text) return;
                            const res = await apiFetch(`/cases/${selectedCase.id}/notes`, {
                              method: "POST",
                              headers: {"Content-Type": "application/json"},
                              body: JSON.stringify({ text, addedBy: sessionUser?.name })
                            }).catch(() => null);
                            if (res?.ok) {
                              el.value = "";
                              const d = await apiFetch(`/cases/${selectedCase.id}/notes`).then(r => r?.json()).catch(() => ({}));
                              if (d?.notes) setCaseNotes(prev => ({...prev, [selectedCase.id]: d.notes}));
                              setCaseActionStatus("✅ Note added");
                              setTimeout(() => setCaseActionStatus(""), 3000);
                            } else {
                              setCaseActionStatus("❌ Failed to add note");
                              setTimeout(() => setCaseActionStatus(""), 3000);
                            }
                          }} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700">
                            + Add Note
                          </button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {(caseNotes[selectedCase.id] || []).length === 0 ? (
                            <p className="text-xs text-slate-400 text-center py-4">No notes yet — add the first one above</p>
                          ) : (
                            [...(caseNotes[selectedCase.id] || [])].reverse().map(note => (
                              <div key={note.id} className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-xs font-bold text-slate-700">{note.added_by || "Staff"}</p>
                                  <p className="text-[10px] text-slate-400">{note.created_at ? new Date(note.created_at).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : ""}</p>
                                </div>
                                <p className="text-sm text-slate-800 whitespace-pre-wrap">{note.text}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : null}

          </div>
        </main>
      </div>

      {/* AI Result Modal */}
      {aiResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setAiResult(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-violet-600 px-4 py-3 flex items-center justify-between">
              <p className="text-sm font-bold text-white">
                {aiResult.action === "summary" ? "📋 AI Case Summary" 
                  : aiResult.action === "intake_check" ? "🔍 AI Intake Check" 
                  : aiResult.action === "draft_notes" ? "✍️ AI Draft Notes"
                  : aiResult.action === "overdue_check" ? "⚡ Urgency Analysis"
                  : aiResult.action === "smart_reply" ? "💬 AI Smart Reply"
                  : "🤖 AI Result"}
              </p>
              <button onClick={() => setAiResult(null)} className="text-violet-100 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{aiResult.text}</p>
            </div>
            <div className="px-5 pb-4 flex gap-2">
              <button onClick={async () => {
                const caseItem = cases.find(c => c.id === aiResult.caseId);
                if (!caseItem) return;
                const res = await apiFetch(`/cases/${aiResult.caseId}/notes`, {
                  method:"POST", headers:{"Content-Type":"application/json"},
                  body:JSON.stringify({text:`🤖 AI ${aiResult.action === "summary" ? "Summary" : "Check"}:
${aiResult.text}`, addedBy:"AI"})
                }).catch(()=>null);
                if (res?.ok) { setCaseActionStatus("✅ Saved to notes"); setTimeout(()=>setCaseActionStatus(""),3000); }
                setAiResult(null);
              }} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700">💾 Save to Notes</button>
              <button onClick={() => setAiResult(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">Close</button>
            </div>
          </div>
        </div>
      )}

      <UnderReviewPanel
        caseId={showURPanel}
        cases={cases}
        sessionUser={sessionUser}
        teamUsers={teamUsers}
        onClose={() => setShowURPanel(null)}
        onNotify={async (targetName, message, caseId) => {
          await apiFetch("/notify", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ targetName, message, caseId })
          }).catch(()=>null);
        }}
        onUpdate={(caseId, patch) => {
          void updateCaseProcessing(caseId, patch as any);
          setCases(prev => prev.map(c => c.id === caseId ? {...c, ...patch} as any : c));
        }}
        onSubmit={async (caseId, appNum) => {
          const res = await apiFetch(`/cases/${caseId}/submit`, {
            method: "POST", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ applicationNumber: appNum, submittedAt: new Date().toISOString() })
          }).catch(()=>null);
          if (res?.ok) {
            const d = await res.json().catch(()=>({}));
            if (d.case) setCases(prev => prev.map(c => c.id === caseId ? d.case : c));
            setShowURPanel(null); setSelectedCaseId(null);
            setCaseActionStatus("✅ Submitted! Sheet updated.");
          } else { setCaseActionStatus("❌ Submit failed"); }
          setTimeout(() => setCaseActionStatus(""), 4000);
        }}
        onAddNote={async (caseId, text, author) => {
          const res = await apiFetch(`/cases/${caseId}/notes`, {
            method: "POST", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ text, addedBy: author })
          }).catch(()=>null);
          // Reload notes for this case
          const notesRes = await apiFetch(`/cases/${caseId}/notes`).catch(()=>null);
          if (notesRes?.ok) {
            const d = await notesRes.json().catch(()=>({}));
            if (d.notes) setCaseNotes(prev => ({...prev, [caseId]: d.notes}));
          }
        }}
        setCaseActionStatus={setCaseActionStatus}
      />
    </div>
  );
}
// Module-level constants for ClientPortal (avoid SWC parsing issue with object literals before return)
const PORTAL_SELECTS: Record<string, string[]> = {
  sex: ["Female","Male","Unknown","Unspecified"],
  mailing_province: ["BC","AB","ON","MB","SK","NS","NB","NL","PE","QC","NT","NU","YT"],
  current_status: ["Student","Worker","Visitor","Other"],
  marital_status: ["Single","Married","Common-Law","Separated","Divorced","Widowed"],
};
const PORTAL_LABELS: Record<string, string> = {
  dob:"Date of Birth", sex:"Gender", place_birth_city:"City of Birth", place_birth_country:"Country of Birth",
  citizenship_country:"Country of Citizenship", native_language:"Native Language",
  mailing_street_num:"Street Number", mailing_street_name:"Street Name", mailing_apt_unit:"Apt/Unit (optional)",
  mailing_city:"City", mailing_province:"Province", mailing_postal_code:"Postal Code",
  current_status:"Current Status in Canada", current_status_from_date:"Status Valid From",
  current_status_to_date:"Status Expires", original_entry_date:"First Entry to Canada",
  original_entry_place:"Place of Entry", recent_entry_date:"Most Recent Entry to Canada",
  marital_status:"Marital Status", spouse_family_name:"Spouse Last Name", spouse_given_name:"Spouse First Name",
  date_of_marriage:"Date of Marriage", edu_school_name:"School/College Name", edu_field_of_study:"Field of Study",
  edu_city:"City", edu_from_year:"Start Year", edu_to_year:"End Year",
};

// ── Client Portal Component ────────────────────────────────────────────
// Extracted as separate component to avoid SWC JSX parsing limitations

interface ClientPortalProps {
  c: any;
  sessionUser: any;
  clientPortalAccess: boolean;
  clientQStep: number;
  setClientQStep: (fn: any) => void;
  clientScreen: string;
  setClientScreen: (s: any) => void;
  retainerConfirm: boolean;
  setRetainerConfirm: (v: boolean) => void;
  retainerStatus: string;
  setRetainerStatus: (s: string) => void;
  cases: any[];
  setCases: (fn: any) => void;
  documents: any[];
  setDocuments: (d: any) => void;
  apiFetch: (url: string, opts?: any) => Promise<Response>;
  logout: () => void;
  headerProps: any;
  isChecklistDocUploaded: (item: any) => boolean;
  caseChecklist: any[];
}

function ClientPortal({
  c, sessionUser, clientPortalAccess, clientQStep, setClientQStep,
  clientScreen, setClientScreen, retainerConfirm, setRetainerConfirm,
  retainerStatus, setRetainerStatus, cases, setCases, documents, setDocuments,
  apiFetch, logout, headerProps, isChecklistDocUploaded, caseChecklist
}: ClientPortalProps) {
  if (!clientPortalAccess) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 md:px-6 md:py-8">
        <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <h2 className="text-lg font-semibold text-amber-900">Open Client Portal from Secure Link</h2>
          <p className="mt-1 text-sm text-amber-900">Please open the secure client invite link sent by Newton Immigration.</p>
          <button onClick={() => void logout()} className="mt-3 rounded-lg border border-amber-700 bg-white px-3 py-2 text-sm font-semibold text-amber-900">Sign Out</button>
        </section>
      </main>
    );
  }

  const groups = [
    { id: "personal", label: "Personal Info", icon: "👤", keys: ["dob","sex","place_birth_city","place_birth_country","citizenship_country","native_language"] },
    { id: "address", label: "Address", icon: "🏠", keys: ["mailing_street_num","mailing_street_name","mailing_apt_unit","mailing_city","mailing_province","mailing_postal_code"] },
    { id: "status", label: "Status", icon: "🛂", keys: ["current_status","current_status_from_date","current_status_to_date","original_entry_date","original_entry_place","recent_entry_date"] },
    { id: "marital", label: "Marital", icon: "💍", keys: ["marital_status","spouse_family_name","spouse_given_name","date_of_marriage"] },
    { id: "background", label: "Background", icon: "📋", keys: ["prev_application_refused","has_criminal_record","has_medical_condition","has_military_service"] },
    { id: "education", label: "Education", icon: "🎓", keys: ["edu_school_name","edu_field_of_study","edu_city","edu_from_year","edu_to_year"] },
    { id: "employment", label: "Employment", icon: "💼", keys: [] as string[] },
  ];
  const totalSteps = groups.length;
  const step = clientQStep;
  const saved: any = c?.pgwpIntake || {};
  const currentGroup = groups[Math.min(step, totalSteps - 1)];
  const isLastStep = step >= totalSteps - 1;

  const doSave = async (patch: any, finalize?: boolean) => {
    if (!c) return;
    await apiFetch("/cases/" + c.id + "/intake", {
      method: "PATCH",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ intake: patch, finalizeIntake: finalize || isLastStep })
    }).catch(() => null);
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="bg-slate-900 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-white">Newton Immigration</p>
          <p className="text-[10px] text-slate-400">{c?.formType || "Client Portal"}</p>
        </div>
        <p className="text-xs text-slate-400">{sessionUser.name}</p>
      </div>
      <div className="mx-auto max-w-lg px-4 py-5 space-y-4">
        <div className="rounded-xl bg-white border border-slate-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-slate-600">Step {Math.min(step+1, totalSteps)} of {totalSteps} — {currentGroup.icon} {currentGroup.label}</p>
            <p className="text-xs text-slate-400">{Math.round((step/totalSteps)*100)}% done</p>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full">
            <div className="h-1.5 bg-blue-600 rounded-full transition-all" style={{width: Math.round((step/totalSteps)*100) + "%"}} />
          </div>
        </div>

        {!c?.retainerSigned && (
          <div className="rounded-xl bg-white border-2 border-slate-900 overflow-hidden">
            <div className="bg-slate-900 px-4 py-3">
              <p className="text-sm font-bold text-white">📝 Service Agreement</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600 space-y-2">
                <p className="font-bold text-slate-900">Newton Immigration Inc.</p>
                <p>Application: <strong>{c?.formType}</strong></p>
                {c?.totalCharges ? <p>Service Fee: <strong>${c.totalCharges}</strong></p> : null}
                <p className="text-xs text-slate-500 mt-2">By agreeing, you authorize Newton Immigration Inc. to provide immigration consulting services. All information shared will be kept confidential.</p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={retainerConfirm} onChange={e => setRetainerConfirm(e.target.checked)} className="mt-1 h-4 w-4" />
                <span className="text-sm text-slate-700">I have read and agree to the service agreement.</span>
              </label>
              {retainerStatus && <p className="text-sm font-semibold text-emerald-700">{retainerStatus}</p>}
              <button disabled={!retainerConfirm}
                onClick={async () => {
                  if (!c) return;
                  const res = await apiFetch("/cases/" + c.id + "/retainer", {
                    method: "POST",
                    headers: {"Content-Type":"application/json"},
                    body: JSON.stringify({ signedBy: sessionUser.name || "Client", retainerAmount: c.totalCharges })
                  });
                  if (res.ok) {
                    setRetainerStatus("✅ Agreed!");
                    setCases((prev: any[]) => prev.map((ca: any) => ca.id === c.id ? {...ca, retainerSigned: true} : ca));
                  } else {
                    setRetainerStatus("❌ Error. Please try again.");
                  }
                }}
                className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-40">
                ✅ Agree &amp; Continue →
              </button>
            </div>
          </div>
        )}

        {c?.retainerSigned && step < totalSteps && clientScreen !== "documents" && (
          <div className="rounded-xl bg-white border-2 border-blue-200 overflow-hidden">
            <div className="bg-blue-600 px-4 py-3 flex items-center justify-between">
              <p className="text-sm font-bold text-white">{currentGroup.icon} {currentGroup.label}</p>
              <p className="text-xs text-blue-200">{step+1}/{totalSteps}</p>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-[10px] text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
                {currentGroup.id === "employment"
                  ? "💡 List all jobs from the last 10 years. If you plan to work in the medical field, include your medical credentials/licence number."
                  : "💡 Please fill in your information accurately. Changes save automatically."}
              </p>

              {currentGroup.id !== "background" && currentGroup.id !== "employment" && currentGroup.keys.map((key: string) => {
                if ((key === "spouse_family_name" || key === "spouse_given_name" || key === "date_of_marriage") && !["Married","Common-Law"].includes(saved["marital_status"] || "")) return null;
                const isDate = key.includes("date") || key.includes("_from") || key.includes("_to") || key === "dob";
                return (
                  <div key={key}>
                    <label className="text-xs font-bold text-slate-700 block mb-1">{PORTAL_LABELS[key] || key}</label>
                    {PORTAL_SELECTS[key] ? (
                      <select defaultValue={saved[key] || ""}
                        onChange={async e => {
                          const p = {...saved, [key]: e.target.value};
                          setCases((prev: any[]) => prev.map((ca: any) => ca.id === c.id ? {...ca, pgwpIntake: p} : ca));
                          await doSave(p);
                        }}
                        className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm focus:border-blue-400 focus:outline-none">
                        <option value="">Select...</option>
                        {PORTAL_SELECTS[key].map((o: string) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type={isDate ? "date" : "text"} defaultValue={saved[key] || ""}
                        onBlur={async e => {
                          const p = {...saved, [key]: e.target.value};
                          setCases((prev: any[]) => prev.map((ca: any) => ca.id === c.id ? {...ca, pgwpIntake: p} : ca));
                          await doSave(p);
                        }}
                        className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm focus:border-blue-400 focus:outline-none" />
                    )}
                  </div>
                );
              })}

              {currentGroup.id === "background" && [
                {key:"prev_application_refused", label:"Ever been refused a visa or permit to any country?"},
                {key:"has_criminal_record", label:"Ever been convicted of a crime?"},
                {key:"has_medical_condition", label:"Any medical conditions requiring treatment?"},
                {key:"has_military_service", label:"Served in any military or police force?"},
              ].map(q => (
                <div key={q.key}>
                  <p className="text-xs font-bold text-slate-700 mb-2">{q.label}</p>
                  <div className="flex gap-3">
                    {["Yes","No"].map(opt => (
                      <button key={opt}
                        onClick={async () => {
                          const p = {...saved, [q.key]: opt === "Yes" ? "true" : "false"};
                          setCases((prev: any[]) => prev.map((ca: any) => ca.id === c.id ? {...ca, pgwpIntake: p} : ca));
                          await doSave(p);
                        }}
                        className={"flex-1 rounded-xl border-2 py-3 text-sm font-bold transition-all " + (((saved[q.key] === "true" && opt === "Yes") || (saved[q.key] === "false" && opt === "No")) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700")}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {currentGroup.id === "employment" && (
                <div className="space-y-4">
                  {Array.from({length: Number(saved.__empCount || 1)}, (_, idx) => {
                    const n = idx + 1;
                    return (
                      <div key={n} className="rounded-xl border-2 border-slate-100 bg-slate-50 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-slate-700">Job {n}</p>
                          {n > 1 && (
                            <button onClick={async () => {
                              const p: any = {...saved, __empCount: String(Number(saved.__empCount || 1) - 1)};
                              ["title","employer","city","country","from","to"].forEach(f => delete p["emp" + n + "_" + f]);
                              setCases((prev: any[]) => prev.map((ca: any) => ca.id === c.id ? {...ca, pgwpIntake: p} : ca));
                              await doSave(p);
                            }} className="text-xs text-red-500 font-semibold">Remove</button>
                          )}
                        </div>
                        {[{k:"title",p:"e.g. Sales Associate"},{k:"employer",p:"e.g. Walmart"},{k:"city",p:"e.g. Surrey"},{k:"country",p:"e.g. Canada"}].map(f => (
                          <div key={f.k}>
                            <label className="text-xs font-semibold text-slate-600 capitalize">{f.k}</label>
                            <input defaultValue={saved["emp"+n+"_"+f.k] || ""}
                              onBlur={async e => {
                                const p = {...saved, ["emp"+n+"_"+f.k]: e.target.value};
                                setCases((prev: any[]) => prev.map((ca: any) => ca.id === c.id ? {...ca, pgwpIntake: p} : ca));
                                await doSave(p);
                              }}
                              placeholder={f.p}
                              className="mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none" />
                          </div>
                        ))}
                        <div className="grid grid-cols-2 gap-3">
                          {[{k:"from",l:"Start date"},{k:"to",l:"End date"}].map(f => (
                            <div key={f.k}>
                              <label className="text-xs font-semibold text-slate-600">{f.l}</label>
                              <input type="date" defaultValue={saved["emp"+n+"_"+f.k] || ""}
                                onBlur={async e => {
                                  const p = {...saved, ["emp"+n+"_"+f.k]: e.target.value};
                                  setCases((prev: any[]) => prev.map((ca: any) => ca.id === c.id ? {...ca, pgwpIntake: p} : ca));
                                  await doSave(p);
                                }}
                                className="mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none" />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <button onClick={async () => {
                    const p = {...saved, __empCount: String(Number(saved.__empCount || 1) + 1)};
                    setCases((prev: any[]) => prev.map((ca: any) => ca.id === c.id ? {...ca, pgwpIntake: p} : ca));
                    await doSave(p);
                  }} className="w-full rounded-xl border-2 border-dashed border-blue-300 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50">
                    + Add Another Job
                  </button>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                {step > 0 && (
                  <button onClick={() => setClientQStep((prev: number) => prev - 1)} className="flex-1 rounded-xl border-2 border-slate-200 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">← Back</button>
                )}
                <button onClick={async () => {
                  if (isLastStep) {
                    await doSave(saved, true);
                    setClientScreen("documents");
                  } else {
                    setClientQStep((prev: number) => prev + 1);
                  }
                }} className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700">
                  {isLastStep ? "✅ Submit & Continue →" : "Next →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {c?.retainerSigned && clientScreen === "documents" && (
          <div className="rounded-xl bg-white border-2 border-amber-200 overflow-hidden">
            <div className="bg-amber-500 px-4 py-3">
              <p className="text-sm font-bold text-white">📎 Upload Documents</p>
            </div>
            <div className="p-5 space-y-4">
              {caseChecklist.length > 0 && (
                <div className="space-y-2">
                  {caseChecklist.map((item: any, i: number) => {
                    const uploaded = isChecklistDocUploaded(item);
                    return (
                      <div key={i} className={"flex items-center gap-3 rounded-xl border-2 p-3 " + (uploaded ? "border-emerald-200 bg-emerald-50" : "border-slate-200")}>
                        <span>{uploaded ? "✅" : "📄"}</span>
                        <p className={"text-sm font-semibold " + (uploaded ? "text-emerald-700" : "text-slate-900")}>{item.name}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-600 text-center mb-2">Upload documents</p>
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  className="w-full text-sm text-slate-600"
                  onChange={async e => {
                    const files = e.target.files;
                    if (!files || !c) return;
                    for (const file of Array.from(files)) {
                      const fd = new FormData();
                      fd.append("file", file); fd.append("name", file.name);
                      fd.append("caseId", c.id); fd.append("uploadedBy", sessionUser.name || "Client");
                      await apiFetch("/cases/" + c.id + "/documents", {method:"POST",body:fd}).catch(()=>null);
                    }
                    const r = await apiFetch("/cases/" + c.id + "/documents");
                    const d = await r.json().catch(()=>({}));
                    if (d.documents) setDocuments(d.documents);
                  }} />
              </div>
              {documents.filter((d: any) => d.caseId === c?.id).length > 0 && (
                <div className="space-y-1">
                  {documents.filter((d: any) => d.caseId === c?.id).map((d: any) => (
                    <div key={d.id} className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                      <span>✅</span>
                      <p className="text-xs font-semibold text-emerald-800 truncate">{d.name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {c?.retainerSigned && (
          <div className="flex gap-2">
            <button onClick={() => { setClientQStep(0); setClientScreen("retainer"); }}
              className={"flex-1 rounded-xl border-2 py-2.5 text-xs font-bold " + (clientScreen !== "documents" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600")}>
              📋 Questions
            </button>
            <button onClick={() => setClientScreen("documents")}
              className={"flex-1 rounded-xl border-2 py-2.5 text-xs font-bold " + (clientScreen === "documents" ? "border-amber-500 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600")}>
              📎 Documents
            </button>
            <a href="https://wa.me/16047795700" target="_blank"
              className="flex-1 rounded-xl border-2 border-emerald-200 bg-emerald-50 py-2.5 text-xs font-bold text-emerald-700 text-center">
              💬 Help
            </a>
          </div>
        )}

        <p className="text-center text-[10px] text-slate-400 pb-4">Newton Immigration · Secure Portal · All data encrypted</p>
      </div>
    </main>
  );
}
