export type Role = "Admin" | "Marketing" | "Processing" | "ProcessingLead" | "Reviewer" | "Client";
export type UserType = "staff" | "client";
export type CaseStatus = "lead" | "active" | "under_review" | "ready" | "submitted";
export type AiStatus = "idle" | "collecting_docs" | "waiting_client" | "intake_complete" | "drafting" | "completed";
export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "completed";
export type NotificationType = "deadline" | "missing_doc" | "ai_alert";
export type DocRequestStatus = "open" | "fulfilled";

export type PgwpIntakeData = {
  whatsappSession?: string;
  fullName?: string;
  applicationType?: string;
  applicationSpecificAnswers?: string;
  intendedWorkDetails?: string;
  usedOtherName?: string;
  otherNameDetails?: string;
  travelHistorySixMonths?: string;
  travelHistoryDetails?: string;
  currentCountry?: string;
  currentCountryStatus?: string;
  currentCountryFromDate?: string;
  currentCountryToDate?: string;
  previousCountries?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  placeOfBirthCity?: string;
  passportNumber?: string;
  passportIssueDate?: string;
  passportExpiryDate?: string;
  nationalIdNumber?: string;
  usGreenCardNumber?: string;
  countryOfBirth?: string;
  citizenship?: string;
  uci?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  email?: string;
  phone?: string;
  nativeLanguage?: string;
  canCommunicateEnglishFrench?: string;
  preferredLanguage?: string;
  maritalStatus?: string;
  spouseName?: string;
  spouseDob?: string;
  spouseDateOfMarriage?: string;
  previousMarriageCommonLaw?: string;
  previousRelationshipDetails?: string;
  residentialAddress?: string;
  education?: string;
  educationDetails?: string;
  ieltsDetails?: string;
  englishTestTaken?: string;
  originalEntryDate?: string;
  originalEntryPlacePurpose?: string;
  originalEntryToCanadaPlace?: string;
  originalEntryPurpose?: string;
  recentEntryAny?: string;
  recentEntryDetails?: string;
  employmentHistory?: string;
  dliNameLocation?: string;
  programNameDuration?: string;
  completionLetterDate?: string;
  fullTimeStudentThroughout?: string;
  gapsOrPartTimeDetails?: string;
  previousCollegesInCanada?: string;
  academicProbationOrTransfer?: string;
  unauthorizedWorkDuringStudies?: string;
  hasRepresentative?: string;
  permitDetails?: string;
  studyPermitExpiryDate?: string;
  pastStudiesDetails?: string;
  currentStudyCompletionLetterDetails?: string;
  restorationNeeded?: string;
  fundsAvailable?: string;
  medicalExamCompleted?: string;
  refusedAnyCountry?: string;
  refusalDetails?: string;
  militaryServiceDetails?: string;
  criminalHistory?: string;
  medicalHistory?: string;
  additionalNotes?: string;
  // ── Internal metadata written by the WhatsApp intake bot ──
  // These are not user-answer fields, but are stored alongside answers in
  // the same blob so the bot can recover state and audit-trail intake
  // sessions. METADATA_KEYS in store.ts is the source-of-truth list.
  whatsappIntakePhase?: string;
  whatsappIntakeCompletedAt?: string;
  whatsappIntakeRecoveredAt?: string;
  whatsappIntakeRecoveryNote?: string;
  // Validation flags raised during intake — surfaced to staff for review
  // (e.g. missing key field, contradictory answer, ambiguous response).
  _intakeValidationFlags?: unknown;
};

export type Stage =
  | "Lead"
  | "Paid"
  | "Intake"
  | "Assigned"
  | "Under Review"
  | "Submitted"
  | "Decision";

export type Company = {
  id: string;
  name: string;
  slug: string;
  branding: {
    customPortalSections?: Array<{
      id: string;
      title: string;
      body: string;
      fieldType?: "text" | "dropdown" | "date" | "file_upload" | "checkbox";
      options?: string[];
      visibleFor?: string[];
      sortOrder?: number;
      enabled?: boolean;
    }>;
    customPortalSectionHistory?: Array<{
      id: string;
      createdAt: string;
      actorUserId?: string;
      actorName?: string;
      sections: Array<{
        id: string;
        title: string;
        body: string;
        fieldType?: "text" | "dropdown" | "date" | "file_upload" | "checkbox";
        options?: string[];
        visibleFor?: string[];
        sortOrder?: number;
        enabled?: boolean;
      }>;
    }>;
    appName: string;
    logoText: string;
    logoUrl?: string;
    driveRootLink?: string;
    primary: string;
    secondary: string;
    success: string;
    background: string;
    text: string;
  };
  createdAt: string;
};

export type CaseItem = {
  id: string;
  companyId: string;
  createdAt?: string;
  updatedAt?: string;
  clientId?: string;
  clientUserId?: string;
  client: string;
  caseStatus?: CaseStatus;
  aiStatus?: AiStatus;
  leadPhone?: string;
  leadEmail?: string;
  sourceLeadKey?: string;
  formType: string;
  assignedTo?: string;
  processingStatus?: "docs_pending" | "under_review" | "submitted" | "other";
  processingStatusOther?: string;
  isUrgent?: boolean;
  deadlineDate?: string;
  permitExpiryDate?: string;
  owner: string;
  reviewer: string;
  stage: Stage;
  dueInDays: number;
  unreadClientMessages: number;
  docsPending: number;
  balanceAmount: number;
  retainerSigned: boolean;
  retainerSentAt?: string;
  docsUploadLink: string;
  applicationFormsLink?: string;
  submittedFolderLink?: string;
  correspondenceFolderLink?: string;
  questionnaireLink: string;
  paymentMethod?: "interac" | "cash" | "card" | "bank_transfer" | "other";
  interacRecipient?: string;
  interacInstructions?: string;
  paymentStatus?: "pending" | "paid" | "not_required";
  paymentPaidAt?: string;
  applicationNumber?: string;
  amountPaid?: number;
  totalCharges?: number;
  irccFees?: number;
  irccFeePayer?: "sir_card" | "client_card";
  familyMembers?: string;
  familyTotalCharges?: number;
  submittedAt?: string;
  submissionDocumentUploadedAt?: string;
  decisionDate?: string;
  finalOutcome?: "approved" | "refused" | "request_letter" | "withdrawn";
  remarks?: string;
  imm5710Automation?: {
    status: "idle" | "started" | "failed";
    startedAt?: string;
    pid?: number;
    logPath?: string;
    readyPackagePath?: string;
    lastError?: string;
    autoTriggered?: boolean;
  };
  pgwpIntake?: PgwpIntakeData;
  // Pre-submission review checklist state — keyed by item.key from
  // /lib/pre-submission-review.ts. Tracks which items have been ticked
  // by which staff member at what time. Used to gate "Mark Ready for
  // IRCC Upload" and to provide audit trail.
  preSubmissionReview?: Record<string, { ticked: boolean; by?: string; at?: string }>;
  // Set when staff clicks "Mark Ready for IRCC Upload" — represents
  // human sign-off that the package is fully reviewed and ready to be
  // submitted to IRCC. Different from `submittedAt` (which is set after
  // it's actually been uploaded).
  markedReadyAt?: string;
  markedReadyBy?: string;
  docRequests?: Array<{
    id: string;
    title: string;
    details?: string;
    status: DocRequestStatus;
    requestedBy: string;
    requestedAt: string;
    fulfilledAt?: string;
    fulfilledBy?: string;
    documentId?: string;
  }>;
  retainerRecord?: {
    signedAt: string;
    signerName: string;
    signatureType: "initials" | "signature" | "typed";
    signatureValue: string;
    acceptedTerms: boolean;
  };
  servicePackage: {
    name: string;
    retainerAmount: number;
    balanceAmount: number;
    milestones: Array<{
      id: string;
      title: string;
      done: boolean;
    }>;
  };
  invoices: Array<{
    id: string;
    title: string;
    amount: number;
    status: "draft" | "sent" | "paid";
    createdAt: string;
  }>;
};

export type AppUser = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: Role;
  userType: UserType;
  active?: boolean;
  password: string;
  mfaEnabled?: boolean;
  mfaSecret?: string;
  mfaEnabledAt?: string;
  mfaLastVerifiedAt?: string;
  workspaceDriveLink?: string;
  workspaceDriveFolderId?: string;
  caseId?: string;
  staffNotes?: StaffNote[];
};

export type StaffNote = {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
  pinned?: boolean;
};

export type Session = {
  token: string;
  userId: string;
  companyId: string;
  expiresAt: string;
  ipAddress?: string;
  ipSubnet?: string;
  userAgent?: string;
  createdAt?: string;
};

export type ClientInvite = {
  token: string;
  companyId: string;
  caseId: string;
  email?: string;
  createdByUserId: string;
  usedByUserId?: string;
  status: "pending" | "accepted" | "expired";
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
};

export type MessageItem = {
  id: string;
  companyId: string;
  caseId: string;
  senderType: "client" | "staff" | "ai";
  senderName: string;
  text: string;
  createdAt: string;
};

export type OutboundMessageItem = {
  id: string;
  companyId: string;
  caseId: string;
  channel: "email" | "whatsapp" | "sms" | "link" | "copy";
  status: "queued" | "opened_app" | "sent" | "failed";
  target?: string;
  message: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
};

export type DocumentItem = {
  id: string;
  companyId: string;
  clientId?: string;
  caseId: string;
  name: string;
  category?: "general" | "result";
  fileType?: string;
  version?: number;
  versionGroupId?: string;
  status: "pending" | "received";
  link: string;
  createdAt: string;
  // Stable source identity (WhatsApp Meta message.id) used to dedupe a redelivered
  // webhook so one upload can't become many document records.
  sourceMsgId?: string;
};

export type ClientMaster = {
  id: string;
  companyId: string;
  clientCode: string;
  fullName: string;
  phone?: string;
  email?: string;
  assignedTo?: string;
  internalFlags: {
    previousRefusals?: boolean;
    risks?: string;
    missingDocuments?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type ClientCommunication = {
  id: string;
  companyId: string;
  clientId: string;
  createdByUserId: string;
  createdByName: string;
  type: "note" | "call" | "email" | "ai";
  message: string;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  companyId: string;
  actorUserId: string;
  actorName: string;
  action: string;
  resourceType: "client_profile" | "client_note" | "client_invite" | "case";
  resourceId: string;
  metadata?: Record<string, string>;
  createdAt: string;
};

export type TaskItem = {
  id: string;
  companyId: string;
  caseId: string;
  title: string;
  description: string;
  assignedTo: string;
  createdBy: "ai" | "admin";
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string;
  createdAt: string;
};

export type NotificationItem = {
  id: string;
  companyId: string;
  userId: string;
  type: NotificationType;
  message: string;
  read: boolean;
  createdAt: string;
};

export type LegacyResultItem = {
  id: string;
  companyId: string;
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
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
};

export interface WebFormEntry {
  id: string;
  companyId: string;
  clientName: string;
  caseId?: string | null;        // Optional link to a case in the CRM
  formType: string;               // e.g. "GCMS Notes", "Reconsideration", "Web Form"
  dateSubmitted: string;          // ISO date string
  status: "pending" | "done";
  link?: string;                  // Reference URL or document link
  assignedTo?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PrConsultationEntry {
  id: string;
  companyId: string;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  paymentAmount: number;          // CAD
  paymentReceived?: boolean;       // optional flag — true if paid
  paymentMethod?: string;          // cash / e-transfer / card / etc.
  consultationDate: string;        // ISO date string
  consultant?: string;             // Newton team member name
  status: "pending" | "done";
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionEntry {
  id: string;
  companyId: string;
  caseId?: string | null;          // optional — if auto-created from a case Submit action
  clientName: string;
  clientPhone?: string;
  appType: string;                 // form/application type
  submittedDate: string;           // ISO date
  irccReference?: string;          // confirmation number / file number from IRCC
  status: "submitted" | "aor_received" | "decision_pending" | "approved" | "refused";
  notes?: string;
  submittedBy?: string;            // staff member who submitted
  createdAt: string;
  updatedAt: string;
}

export type AppStore = {
  companies: Company[];
  users: AppUser[];
  clients: ClientMaster[];
  cases: CaseItem[];
  messages: MessageItem[];
  outboundMessages: OutboundMessageItem[];
  documents: DocumentItem[];
  clientCommunications: ClientCommunication[];
  auditLogs: AuditLog[];
  tasks: TaskItem[];
  notifications: NotificationItem[];
  legacyResults: LegacyResultItem[];
  sessions: Session[];
  invites: ClientInvite[];
  webForms?: WebFormEntry[];
  prConsultations?: PrConsultationEntry[];
  submissions?: SubmissionEntry[];
  trackers?: TrackerEntry[];
  alertRecipients?: AlertRecipient[];
};

// Post-submission milestone tracker — for long, multi-step applications
// (Express Entry PR after ITA, PR Sponsorship) where IRCC drives the file
// through many stages (AOR, biometrics, medical, eligibility, PPR, COPR,
// landing). This is a lightweight manual sheet: the owner/team enters the
// application number + client name and moves the stage forward as IRCC emails
// arrive. Deliberately separate from the case pipeline (those are pre-submission).
export interface TrackerEntry {
  id: string;
  companyId: string;
  applicationNumber: string;       // IRCC application / file number
  clientName: string;
  clientPhone?: string;            // for stage-change notifications (WhatsApp)
  applicationType: string;         // e.g. "Express Entry (PR)", "PR Sponsorship", "Other"
  stage: string;                   // current milestone (see TRACKER_STAGES)
  stageUpdatedAt: string;          // when the stage last changed (ISO)
  nextStep?: string;               // optional free-text reminder ("waiting on medical")
  notes?: string;
  // Email-sync bookkeeping. lastEmailAt = date of the most recent IRCC email
  // we've already processed for this file (so we don't re-flag it every poll).
  // pendingReview = an IRCC email arrived that we couldn't map to a stage (e.g.
  // a generic "sign in to your account" notice) — staff should check the portal.
  lastEmailAt?: string;
  pendingReview?: boolean;
  pendingReviewNote?: string;      // subject/date of the update awaiting review
  caseId?: string | null;          // optional link to an originating case
  archived?: boolean;              // hidden from the active list (e.g. landed/closed)
  updatedBy?: string;              // staff who last touched it
  createdAt: string;
  updatedAt: string;
}

// Canonical stage list for the post-ITA / PR tracker. Order = pipeline order.
// Covers Express Entry PR and PR Sponsorship (overlapping IRCC steps).
export const TRACKER_STAGES = [
  "ITA Received",
  "e-APR / Application Submitted",
  "AOR Received",
  "Biometrics Requested",
  "Biometrics Completed",
  "Medical Requested",
  "Medical Passed",
  "Sponsorship Approved (SA)",
  "Eligibility In Progress",
  "Additional Documents Requested",
  "Background / Security Check",
  "Interview Requested",
  "PPR / Passport Request",
  "COPR Issued",
  "Landed (PR Confirmed)",
  "PR Card Received",
  "On Hold",
  "Refused / Withdrawn",
] as const;

// People who get a WhatsApp ping when the marketing bot hits an "important"
// moment (office visit, blocked fabrication, frustrated client, ready-to-pay).
export type AlertRecipient = {
  id: string;
  phone: string;     // digits only, with country code (e.g. 16049071276)
  label: string;     // e.g. "Navdeep", "Front desk"
  active: boolean;
  createdAt: string;
};
