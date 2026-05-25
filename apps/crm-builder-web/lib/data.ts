import { AppUser, CaseItem, Company, Stage } from "@/lib/models";

export type { CaseItem, Role, Stage } from "@/lib/models";

export const stageOrder: Stage[] = [
  "Lead",
  "Paid",
  "Intake",
  "Assigned",
  "Under Review",
  "Submitted",
  "Decision"
];

export const seedCompany: Company = {
  id: "CMP-1",
  name: "Newton Immigration",
  slug: "newton",
  branding: {
    customPortalSections: [],
    customPortalSectionHistory: [],
    appName: "FlowDesk",
    logoText: "FlowDesk CRM",
    logoUrl: "",
    driveRootLink: "",
    primary: "#1E3A8A",
    secondary: "#6366F1",
    success: "#10B981",
    background: "#F8FAFC",
    text: "#111827"
  },
  createdAt: new Date().toISOString()
};

export const sampleCases: CaseItem[] = [
  {
    id: "CASE-1021",
    companyId: "CMP-1",
    clientUserId: "USR-10",
    client: "Jatin Yadav",
    formType: "IMM5710",
    owner: "Aman",
    reviewer: "Harpreet",
    stage: "Assigned",
    dueInDays: 2,
    unreadClientMessages: 3,
    docsPending: 1,
    balanceAmount: 450,
    retainerSigned: true,
    retainerSentAt: new Date().toISOString(),
    docsUploadLink: "https://drive.google.com/newton/upload/CASE-1021",
    questionnaireLink: "https://forms.newton.local/imm5710",
    paymentMethod: "interac",
    interacRecipient: "newtonimmigration@gmail.com",
    interacInstructions: "Send Interac e-Transfer and include case number in the message.",
    paymentStatus: "paid",
    paymentPaidAt: new Date().toISOString(),
    servicePackage: {
      name: "Work Permit Premium",
      retainerAmount: 1200,
      balanceAmount: 450,
      milestones: [
        { id: "M1", title: "Retainer signed", done: true },
        { id: "M2", title: "Documents collected", done: true },
        { id: "M3", title: "Final legal review", done: false },
        { id: "M4", title: "Submission", done: false }
      ]
    },
    invoices: [
      {
        id: "INV-1001",
        title: "Initial Retainer",
        amount: 1200,
        status: "sent",
        createdAt: new Date().toISOString()
      }
    ]
  },
  {
    id: "CASE-1022",
    companyId: "CMP-1",
    client: "Gurpreet Kaur",
    formType: "TRV",
    owner: "Simran",
    reviewer: "Nav",
    stage: "Under Review",
    dueInDays: 1,
    unreadClientMessages: 0,
    docsPending: 0,
    balanceAmount: 0,
    retainerSigned: true,
    retainerSentAt: new Date().toISOString(),
    docsUploadLink: "https://drive.google.com/newton/upload/CASE-1022",
    questionnaireLink: "https://forms.newton.local/trv",
    paymentMethod: "interac",
    interacRecipient: "newtonimmigration@gmail.com",
    interacInstructions: "Send Interac e-Transfer and include case number in the message.",
    paymentStatus: "paid",
    paymentPaidAt: new Date().toISOString(),
    servicePackage: {
      name: "TRV Express",
      retainerAmount: 600,
      balanceAmount: 0,
      milestones: [
        { id: "M1", title: "Retainer signed", done: true },
        { id: "M2", title: "Draft completed", done: true },
        { id: "M3", title: "Submitted", done: true }
      ]
    },
    invoices: []
  },
  {
    id: "CASE-1023",
    companyId: "CMP-1",
    client: "Rahul Sharma",
    formType: "PGWP",
    owner: "Aman",
    reviewer: "Mani",
    stage: "Intake",
    dueInDays: 4,
    unreadClientMessages: 2,
    docsPending: 4,
    balanceAmount: 320,
    retainerSigned: false,
    retainerSentAt: new Date().toISOString(),
    docsUploadLink: "https://drive.google.com/newton/upload/CASE-1023",
    questionnaireLink: "https://forms.newton.local/pgwp",
    paymentMethod: "interac",
    interacRecipient: "newtonimmigration@gmail.com",
    interacInstructions: "Send Interac e-Transfer and include case number in the message.",
    paymentStatus: "pending",
    servicePackage: {
      name: "PGWP Standard",
      retainerAmount: 900,
      balanceAmount: 320,
      milestones: [
        { id: "M1", title: "Retainer sent", done: true },
        { id: "M2", title: "Retainer signed", done: false },
        { id: "M3", title: "Submission", done: false }
      ]
    },
    invoices: []
  }
];

// NOTE: template/demo placeholders only. They are intentionally INACTIVE and
// carry NO usable password. Earlier versions shipped weak plaintext credentials
// (admin123, etc.) which — combined with the plaintext fallback in
// verifyPassword() — were a usable admin backdoor if they ever reached the live
// store. migrateStore() also filters out any @flowdesk.local user as a second
// layer of defense. Real accounts are created via the bootstrap endpoint /
// createCompanyWithAdmin, never from these seeds.
export const seedUsers: AppUser[] = [
  {
    id: "USR-1",
    companyId: "CMP-1",
    name: "Admin User",
    email: "admin@flowdesk.local",
    role: "Admin",
    userType: "staff",
    password: "",
    active: false
  },
  {
    id: "USR-2",
    companyId: "CMP-1",
    name: "Case Owner",
    email: "owner@flowdesk.local",
    role: "Processing",
    userType: "staff",
    password: "",
    active: false
  },
  {
    id: "USR-3",
    companyId: "CMP-1",
    name: "Reviewer User",
    email: "reviewer@flowdesk.local",
    role: "Reviewer",
    userType: "staff",
    password: "",
    active: false
  },
  {
    id: "USR-10",
    companyId: "CMP-1",
    name: "Jatin Yadav",
    email: "client@flowdesk.local",
    role: "Client",
    userType: "client",
    password: "",
    active: false,
    caseId: "CASE-1021"
  }
];

export const workflowBlocks = [
  {
    title: "Lead Intake",
    detail: "Google Form -> Sheet -> CRM lead record"
  },
  {
    title: "Payment + Retainer",
    detail: "Auto payment link + e-sign contract"
  },
  {
    title: "Client Portal",
    detail: "Case updates, secure chat, doc upload"
  },
  {
    title: "Production",
    detail: "Owner assignment, review assignment, SLA alerts"
  },
  {
    title: "Submission + Decision",
    detail: "App number tracking, approval/refusal timeline"
  }
];

export const appModules = [
  "CRM Builder",
  "Client Portal",
  "Team Inbox",
  "Assignment Engine",
  "Review Queue",
  "Submission Tracker",
  "AI Draft Assistant"
];
