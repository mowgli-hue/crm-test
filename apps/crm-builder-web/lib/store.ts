import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AiStatus,
  AuditLog,
  AppStore,
  AppUser,
  CaseItem,
  CaseStatus,
  ClientCommunication,
  ClientInvite,
  ClientMaster,
  Company,
  DocumentItem,
  MessageItem,
  NotificationItem,
  OutboundMessageItem,
  PgwpIntakeData,
  LegacyResultItem,
  Role,
  Session,
  Stage,
  TaskItem,
  UserType,
  WebFormEntry,
  PrConsultationEntry,
  SubmissionEntry,
  TrackerEntry,
  AlertRecipient
} from "@/lib/models";
import { sampleCases, seedCompany, seedUsers } from "@/lib/data";
import { getMissingChecklistDocs } from "@/lib/application-checklists";
import { getMissingImm5710Questions } from "@/lib/imm5710";
import { NEWTON_TEAM_MEMBERS } from "@/lib/newton-team";
import { SUBMITTED_APPS_LOOKUP } from "@/lib/submitted-apps-lookup";
import { SUBMITTED_APPS } from "@/lib/submitted-apps";
import { generatePgwpDraft } from "@/lib/pgwp";
import { getStorePath } from "@/lib/storage-paths";
import { hashPassword, isPasswordHash, verifyPassword } from "@/lib/security";
import { getPool as getSharedPool, isPostgresBackendEnabled, readStoreFromPostgres, writeStoreToPostgres, insertAuditLogRow, listAuditLogsFromTable, insertCaseMessageRow, listCaseMessagesFromTable, deleteCaseMessagesFromTable, deleteCompanyMessagesFromTable } from "@/lib/postgres-store";

const STORE_PATH = getStorePath();
const SESSION_MAX_AGE_SECONDS = Math.max(
  60 * 15,
  Number(process.env.SESSION_MAX_AGE_SECONDS || 60 * 60 * 12)
);

const defaultStore: AppStore = {
  companies: [seedCompany],
  users: seedUsers,
  clients: [],
  cases: sampleCases,
  messages: [
    {
      id: "MSG-1",
      companyId: "CMP-1",
      caseId: "CASE-1021",
      senderType: "staff",
      senderName: "Aman",
      text: "Please upload your latest passport and permit copy.",
      createdAt: new Date().toISOString()
    },
    {
      id: "MSG-2",
      companyId: "CMP-1",
      caseId: "CASE-1021",
      senderType: "ai",
      senderName: "FlowDesk AI",
      text: "I can help you verify if your documents are complete before review.",
      createdAt: new Date().toISOString()
    }
  ],
  outboundMessages: [],
  documents: [
    {
      id: "DOC-1",
      companyId: "CMP-1",
      caseId: "CASE-1021",
      name: "Passport Bio Page",
      category: "general",
      status: "received",
      link: "https://drive.google.com/newton/docs/passport",
      createdAt: new Date().toISOString()
    }
  ],
  clientCommunications: [],
  auditLogs: [],
  tasks: [],
  notifications: [],
  legacyResults: [],
  sessions: [],
  invites: []
};

function normalizeRuntimeRole(value: unknown): Role {
  const v = String(value || "").trim().toLowerCase();
  if (v === "admin") return "Admin";
  if (v === "marketing") return "Marketing";
  if (v === "processing") return "Processing";
  if (v === "processinglead" || v === "processing lead") return "ProcessingLead";
  if (v === "reviewer") return "Reviewer";
  if (v === "client") return "Client";
  return "Processing";
}

function normalizeRuntimeUserType(value: unknown): UserType {
  const v = String(value || "").trim().toLowerCase();
  return v === "client" ? "client" : "staff";
}

function normalizeClientCode(value: string) {
  const trimmed = String(value || "").trim().toUpperCase();
  if (!/^CLT-\d+$/.test(trimmed)) return "";
  return trimmed;
}

function nextClientCode(clients: ClientMaster[]) {
  const max = clients.reduce((acc, c) => {
    const parsed = Number(String(c.clientCode || "").replace(/^CLT-/, ""));
    return Number.isFinite(parsed) ? Math.max(acc, parsed) : acc;
  }, 1000);
  return `CLT-${max + 1}`;
}

// ── Embedded WhatsApp intake-session trim ──
// Each intake stores its session JSON (including the full conversationHistory
// transcript) inside case.pgwpIntake.whatsappSession. That transcript is the
// single biggest source of "cases" blob weight, and it is REDUNDANT:
//   • the live transcript lives in the dedicated whatsapp_inbox table, and
//   • completed intakes are exported to Drive (backupChatToDrive), and
//   • the restart-guard reads the pgwpIntake-level flags (whatsappIntakePhase /
//     whatsappIntakeCompletedAt), NOT the embedded session.
// So we can safely strip it. completeIntake() already clears it on the happy
// path; this is the belt-and-suspenders pass that also catches completions that
// cleared the wrong case and abandoned intakes that never completed.
const INTAKE_SESSION_RAW_THRESHOLD = 1500; // only bother with heavy sessions
const INTAKE_STALE_DAYS = 21;              // abandoned-intake cutoff
function trimEmbeddedIntakeSession(c: any): any {
  const intake = c?.pgwpIntake;
  if (!intake || typeof intake !== "object") return intake ?? undefined;
  const raw = intake.whatsappSession;
  if (typeof raw !== "string" || raw.length < INTAKE_SESSION_RAW_THRESHOLD) return intake;

  // Completed intake → drop the embedded session entirely (pure dead weight).
  const completed =
    intake.whatsappIntakePhase === "complete" || Boolean(intake.whatsappIntakeCompletedAt);
  if (completed) return { ...intake, whatsappSession: "" };

  // Abandoned intake (no case activity for a while) → keep the lightweight
  // session (answers/phase so a late resume still has context) but drop the
  // bulky conversationHistory, which is already mirrored in whatsapp_inbox.
  const updatedAt = Date.parse(String(c.updatedAt || c.createdAt || "")) || 0;
  const ageDays = updatedAt ? (Date.now() - updatedAt) / 86_400_000 : 0;
  if (ageDays >= INTAKE_STALE_DAYS) {
    try {
      const s = JSON.parse(raw);
      if (Array.isArray(s?.conversationHistory) && s.conversationHistory.length > 0) {
        s.conversationHistory = [];
        return { ...intake, whatsappSession: JSON.stringify(s) };
      }
    } catch { /* not JSON — leave untouched */ }
  }
  return intake;
}

function migrateStore(raw: Partial<AppStore>): AppStore {
  const companies =
    (raw.companies && raw.companies.length > 0 ? raw.companies : [seedCompany]).map((c) => ({
      ...c,
      branding: {
        ...seedCompany.branding,
        ...(c.branding ?? {})
      }
    }));

  const users = (raw.users ?? seedUsers)
    // SECURITY: drop demo/seed accounts (admin@flowdesk.local / admin123, etc.).
    // verifyPassword() accepts a plaintext match for non-hashed passwords, and the
    // auto-hash migration would otherwise just hash the weak credential in place —
    // so these template accounts were a usable admin backdoor if they lingered in
    // the live store. Filtering here purges them on the next store load and stops
    // the seedUsers fallback from ever re-introducing them.
    .filter((u) => !String(u.email || "").toLowerCase().endsWith("@flowdesk.local"))
    .map((u, idx) => ({
    ...u,
    companyId: u.companyId ?? companies[0].id,
    role:
      u.role === "Owner"
        ? (normalizeRuntimeUserType(u.userType) === "client" ? "Client" : "Processing")
        : normalizeRuntimeRole(u.role),
    userType: normalizeRuntimeUserType(u.userType),
    active: u.active !== false,
    mfaEnabled: Boolean(u.mfaEnabled),
    mfaSecret: u.mfaSecret ?? undefined,
    mfaEnabledAt: u.mfaEnabledAt ?? undefined,
    mfaLastVerifiedAt: u.mfaLastVerifiedAt ?? undefined
  }));

  const clients: ClientMaster[] = (raw.clients ?? []).map((c, idx) => ({
    ...c,
    companyId: c.companyId ?? companies[0].id,
    clientCode: normalizeClientCode(c.clientCode) || `CLT-${1001 + idx}`,
    fullName: String(c.fullName || "").trim() || "Client",
    phone: c.phone ?? undefined,
    email: c.email ?? undefined,
    assignedTo: c.assignedTo ?? "Unassigned",
    internalFlags: c.internalFlags ?? {},
    createdAt: c.createdAt ?? new Date().toISOString(),
    updatedAt: c.updatedAt ?? c.createdAt ?? new Date().toISOString()
  }));

  const findOrCreateClientForCase = (input: {
    companyId: string;
    clientName: string;
    clientId?: string;
    leadEmail?: string;
    leadPhone?: string;
    assignedTo?: string;
  }) => {
    const explicitId = String(input.clientId || "").trim();
    if (explicitId) {
      const explicit = clients.find((c) => c.companyId === input.companyId && c.id === explicitId);
      if (explicit) return explicit;
    }

    const email = String(input.leadEmail || "").trim().toLowerCase();
    const phone = String(input.leadPhone || "").replace(/\s+/g, "");
    const name = String(input.clientName || "").trim().toLowerCase();
    const found =
      (email && clients.find((c) => c.companyId === input.companyId && String(c.email || "").toLowerCase() === email)) ||
      (phone && clients.find((c) => c.companyId === input.companyId && String(c.phone || "").replace(/\s+/g, "") === phone)) ||
      (name && clients.find((c) => c.companyId === input.companyId && String(c.fullName || "").trim().toLowerCase() === name));
    if (found) {
      return found;
    }

    const created: ClientMaster = {
      id: `CLIENT-${randomUUID()}`,
      companyId: input.companyId,
      clientCode: nextClientCode(clients),
      fullName: String(input.clientName || "Client").trim(),
      phone: String(input.leadPhone || "").trim() || undefined,
      email: String(input.leadEmail || "").trim() || undefined,
      assignedTo: input.assignedTo || "Unassigned",
      internalFlags: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    clients.push(created);
    return created;
  };

  const cases = (raw.cases ?? sampleCases).map((c, idx) => {
    const companyId = c.companyId ?? companies[0].id;
    const assignedTo = c.assignedTo ?? c.owner ?? "Unassigned";
    const linkedClient = findOrCreateClientForCase({
      companyId,
      clientName: String(c.client || "Client"),
      clientId: c.clientId,
      leadEmail: c.leadEmail,
      leadPhone: c.leadPhone,
      assignedTo
    });
    return {
      ...c,
      createdAt: c.createdAt ?? c.updatedAt ?? new Date().toISOString(),
      updatedAt: c.updatedAt ?? c.createdAt ?? new Date().toISOString(),
      companyId,
      clientId: linkedClient.id,
      client: c.client || linkedClient.fullName,
      caseStatus: (c.caseStatus as CaseStatus) ?? "lead",
      aiStatus: (c.aiStatus as AiStatus) ?? "idle",
      leadPhone: c.leadPhone ?? linkedClient.phone ?? undefined,
      leadEmail: c.leadEmail ?? linkedClient.email ?? undefined,
      sourceLeadKey: c.sourceLeadKey ?? undefined,
      assignedTo,
      processingStatus: c.processingStatus ?? "docs_pending",
      processingStatusOther: c.processingStatusOther ?? undefined,
      isUrgent: Boolean(c.isUrgent),
      deadlineDate: c.deadlineDate ?? undefined,
      balanceAmount: c.balanceAmount ?? 0,
      retainerSigned: c.retainerSigned ?? false,
      retainerSentAt: c.retainerSentAt ?? undefined,
      docsUploadLink: c.docsUploadLink ?? "",
      applicationFormsLink: c.applicationFormsLink ?? undefined,
      submittedFolderLink: c.submittedFolderLink ?? undefined,
      correspondenceFolderLink: c.correspondenceFolderLink ?? undefined,
      questionnaireLink: c.questionnaireLink ?? "",
    paymentMethod: c.paymentMethod ?? "interac",
      interacRecipient: c.interacRecipient ?? "",
      interacInstructions:
        c.interacInstructions ??
        ((c as any).paymentLink
          ? `Use previous payment link: ${(c as any).paymentLink}`
          : "Send Interac e-Transfer with case number."),
      paymentStatus: c.paymentStatus ?? (c.retainerSigned ? "paid" : "pending"),
      paymentPaidAt: c.paymentPaidAt ?? undefined,
      applicationNumber: c.applicationNumber ?? undefined,
      submittedAt: c.submittedAt ?? undefined,
      decisionDate: c.decisionDate ?? undefined,
      finalOutcome: c.finalOutcome ?? undefined,
      remarks: c.remarks ?? undefined,
      amountPaid:
        Number.isFinite(Number(c.amountPaid))
          ? Number(c.amountPaid)
          : c.paymentStatus === "paid"
            ? Number(c.servicePackage?.retainerAmount || 0)
            : 0,
      totalCharges:
        Number.isFinite(Number(c.totalCharges))
          ? Number(c.totalCharges)
          : Number(c.servicePackage?.retainerAmount || 0),
      irccFees: Number.isFinite(Number(c.irccFees)) ? Number(c.irccFees) : 0,
      irccFeePayer:
        c.irccFeePayer === "sir_card" || c.irccFeePayer === "client_card"
          ? c.irccFeePayer
          : "client_card",
      familyMembers: String((c as CaseItem).familyMembers || "").trim() || undefined,
      familyTotalCharges:
        Number.isFinite(Number((c as CaseItem).familyTotalCharges))
          ? Number((c as CaseItem).familyTotalCharges)
          : undefined,
      imm5710Automation: c.imm5710Automation ?? { status: "idle" },
      pgwpIntake: trimEmbeddedIntakeSession(c),
      docRequests: Array.isArray(c.docRequests) ? c.docRequests : [],
      retainerRecord: c.retainerRecord ?? undefined,
      servicePackage: c.servicePackage ?? {
        name: "Standard Service",
        retainerAmount: c.balanceAmount ?? 0,
        balanceAmount: c.balanceAmount ?? 0,
        milestones: []
      },
      invoices: c.invoices ?? []
    };
  });

  return {
    companies,
    users,
    clients,
    cases,
    messages: raw.messages ?? defaultStore.messages,
    outboundMessages: (raw.outboundMessages ?? []).map((m) => ({
      ...m,
      status: m.status ?? "sent",
      createdAt: m.createdAt ?? new Date().toISOString()
    })),
    documents: (raw.documents ?? defaultStore.documents).map((d) => ({
      ...d,
      category: d.category ?? "general",
      fileType: d.fileType ?? undefined,
      version: Number(d.version || 1),
      versionGroupId: d.versionGroupId ?? d.id,
      clientId:
        d.clientId ??
        cases.find((c) => c.companyId === d.companyId && c.id === d.caseId)?.clientId
    })),
    clientCommunications: (raw.clientCommunications ?? []).map((n) => ({
      ...n,
      createdAt: n.createdAt ?? new Date().toISOString()
    })),
    auditLogs: (raw.auditLogs ?? []).map((l) => ({
      ...l,
      createdAt: l.createdAt ?? new Date().toISOString()
    })),
    // Keep ALL open (pending) tasks + the most recent completed ones; drop the
    // long tail of old completed AI tasks that bloated the store (had 5900+).
    tasks: (() => {
      const t = raw.tasks ?? [];
      if (t.length <= 1500) return t;
      const pending = t.filter((x: any) => x.status !== "completed");
      const completed = t
        .filter((x: any) => x.status === "completed")
        .sort((a: any, b: any) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, Math.max(0, 1500 - pending.length));
      return [...pending, ...completed];
    })(),
    // Cap transient UI notifications so they can't grow unbounded and bloat the
    // hot-path store (had grown to 7000+). Keep the newest 800 by createdAt;
    // older alerts are no longer useful. Self-heals: the trimmed list persists
    // on the next write. (Only sorts when actually over the cap.)
    notifications: (() => {
      const n = raw.notifications ?? [];
      if (n.length <= 800) return n;
      return [...n]
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 800);
    })(),
    legacyResults: (raw.legacyResults ?? []).map((r) => {
      const createdAt = r.createdAt ?? new Date().toISOString();
      const resultDate = String((r as LegacyResultItem).resultDate || "").trim() || createdAt.slice(0, 10);
      const matchedCaseId = (r as LegacyResultItem).matchedCaseId;
      return {
        ...r,
        entryType:
          ((r as LegacyResultItem).entryType || "result") as "result" | "submission",
        clientName: String((r as LegacyResultItem).clientName || "").trim() || "Legacy Client",
        resultDate,
        autoCategory: ((r as LegacyResultItem).autoCategory || (matchedCaseId ? "new" : "old")) as
          | "new"
          | "old",
        informedToClient: Boolean((r as LegacyResultItem).informedToClient),
        informedAt: (r as LegacyResultItem).informedAt ?? undefined,
        informedByName: (r as LegacyResultItem).informedByName ?? undefined,
        createdAt
      };
    }),
    sessions: raw.sessions ?? [],
    invites: raw.invites ?? [],
    webForms: raw.webForms ?? [],
    prConsultations: raw.prConsultations ?? [],
    submissions: raw.submissions ?? [],
    trackers: raw.trackers ?? [],
    alertRecipients: raw.alertRecipients ?? []
  };
}

async function ensureStoreFile() {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  try {
    await readFile(STORE_PATH, "utf8");
  } catch {
    await writeFile(STORE_PATH, JSON.stringify(defaultStore, null, 2), "utf8");
  }
}

// ── SHORT READ-CACHE ──
// The whole app state is one large JSON blob. Re-fetching it from Postgres and
// re-running migrateStore on EVERY request (dashboard does it several times, the
// webhook does it constantly) is what made the dashboard slow to load. We cache
// the parsed/migrated store for a short TTL and write through on every write, so
// within that window repeated reads are instant. The TTL is tiny so a write from
// ANOTHER replica is picked up within ~1.5s; same-replica writes are reflected
// immediately via the write-through in writeStore().
let __storeCache: { store: AppStore; at: number } | null = null;
const STORE_CACHE_TTL_MS = Number(process.env.STORE_CACHE_TTL_MS || 1500);

export function invalidateStoreCache(): void {
  __storeCache = null;
}

export async function readStore(): Promise<AppStore> {
  if (__storeCache && Date.now() - __storeCache.at < STORE_CACHE_TTL_MS) {
    return __storeCache.store;
  }
  const source = isPostgresBackendEnabled()
    ? await readStoreFromPostgres()
    : (() => {
        // file mode fallback
        return null;
      })();
  const store = isPostgresBackendEnabled()
    ? migrateStore(source as Partial<AppStore>)
    : await (async () => {
        await ensureStoreFile();
        const raw = await readFile(STORE_PATH, "utf8");
        return migrateStore(JSON.parse(raw) as Partial<AppStore>);
      })();
  let changed = false;
  for (let i = 0; i < store.users.length; i += 1) {
    const current = String(store.users[i].password || "");
    if (!isPasswordHash(current)) {
      store.users[i] = { ...store.users[i], password: await hashPassword(current) };
      changed = true;
    }
  }
  if (changed) {
    await writeStore(store);
  }
  __storeCache = { store, at: Date.now() };
  return store;
}

export async function writeStore(next: AppStore): Promise<void> {
  if (isPostgresBackendEnabled()) {
    await writeStoreToPostgres(migrateStore(next));
    // Write-through: same-replica reads see this immediately (no staleness).
    __storeCache = { store: next, at: Date.now() };
    return;
  }
  await ensureStoreFile();
  await writeFile(STORE_PATH, JSON.stringify(next, null, 2), "utf8");
  __storeCache = { store: next, at: Date.now() };
}

// ── WRITE-SAFETY: serialized read-modify-write ──
// The entire app state is one JSON blob that's read whole, mutated, and written
// whole. With separate readStore()/writeStore() calls, two concurrent mutations
// race: both read v1, both write, and the second silently erases the first's
// change. At bulk (team + agent writing together) that loses data.
//
// mutateStore() makes a read-modify-write atomic via an in-process promise-chain
// mutex that serializes calls within THIS Node process — which fully fixes the
// lost-update race on single-replica deployments (the normal case here).
//
// IMPORTANT (May 2026 hotfix): an earlier version ALSO took a Postgres advisory
// lock for cross-replica safety. That held a pooled DB connection for the whole
// read-modify-write, and under live webhook load it starved the small pool —
// logins and other reads began hanging ("login taking too long"). The advisory
// lock was removed; the in-process mutex is enough for a single instance, and a
// blocked app is far worse than a rare cross-instance race. If we ever run
// multiple replicas and need cross-instance serialization, do it without holding
// a pooled connection (e.g. a dedicated short-lived client + lock timeout).
let __storeMutexChain: Promise<unknown> = Promise.resolve();

export async function mutateStore<T>(mutator: (store: AppStore) => T | Promise<T>): Promise<T> {
  const run = __storeMutexChain.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  // Advance the chain regardless of outcome so one failed mutation can't wedge
  // the queue for everyone behind it.
  __storeMutexChain = run.then(() => undefined, () => undefined);
  return run as Promise<T>;
}

// ── Personal check-in PIN (set by the user themselves) ──
export async function setUserPin(userId: string, pin: string): Promise<boolean> {
  const clean = String(pin || "").replace(/\D/g, "");
  if (clean.length < 4 || clean.length > 6) return false;
  const hash = await hashPassword(clean);
  return mutateStore((store) => {
    const idx = store.users.findIndex((u) => u.id === userId);
    if (idx === -1) return false;
    store.users[idx] = { ...store.users[idx], pinHash: hash, pinSetAt: new Date().toISOString() };
    return true;
  });
}

export async function verifyUserPin(userId: string, pin: string): Promise<boolean> {
  const store = await readStore();
  const u = store.users.find((x) => x.id === userId);
  if (!u || !u.pinHash) return false;
  return verifyPassword(String(pin || "").replace(/\D/g, ""), u.pinHash);
}

export async function findUserByCredentials(email: string, password: string): Promise<AppUser | null> {
  const store = await readStore();
  const normalized = email.toLowerCase().trim();
  const found = store.users.find((u) => u.email.toLowerCase() === normalized && u.active !== false);
  if (!found) return null;
  const ok = await verifyPassword(password, String(found.password || ""));
  if (!ok) return null;
  return found ?? null;
}

// Identify an active user by email WITHOUT checking a password — used by the
// daily-code login path, where the shared office code (not the password) is the
// secret. The code is verified separately; this only resolves who is logging in
// so per-user identity (RBAC, time tracking, scorecards) is preserved.
export async function findActiveUserByEmail(email: string): Promise<AppUser | null> {
  const store = await readStore();
  const normalized = email.toLowerCase().trim();
  return store.users.find((u) => u.email.toLowerCase() === normalized && u.active !== false) ?? null;
}

export async function createCompanyWithAdmin(input: {
  companyName: string;
  adminName: string;
  email: string;
  password: string;
}): Promise<{ company: Company; user: AppUser }> {
  const store = await readStore();
  const existing = store.users.find((u) => u.email.toLowerCase() === input.email.toLowerCase());
  if (existing) {
    throw new Error("Email already in use");
  }

  const slugBase = input.companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const slug = `${slugBase || "company"}-${Math.floor(Math.random() * 900 + 100)}`;

  const company: Company = {
    id: `CMP-${store.companies.length + 1}`,
    name: input.companyName,
    slug,
    branding: {
      ...seedCompany.branding,
      appName: input.companyName,
      logoText: `${input.companyName} Portal`,
      driveRootLink: ""
    },
    createdAt: new Date().toISOString()
  };

  const user: AppUser = {
    id: `USR-${store.users.length + 1}`,
    companyId: company.id,
    name: input.adminName,
    email: input.email,
    role: "Admin",
    userType: "staff",
    active: true,
    password: await hashPassword(input.password)
  };

  store.companies.push(company);
  store.users.push(user);
  await writeStore(store);
  return { company, user };
}

export async function createSession(user: AppUser): Promise<Session> {
  return createSessionWithContext(user, {});
}

function deriveIpSubnet(ip: string): string {
  const value = String(ip || "").trim();
  if (!value) return "";
  if (value.includes(".")) {
    const parts = value.split(".").slice(0, 3);
    if (parts.length === 3) return `${parts.join(".")}.x`;
  }
  if (value.includes(":")) {
    const parts = value.split(":").slice(0, 4);
    if (parts.length > 0) return `${parts.join(":")}::/64`;
  }
  return value;
}

export async function createSessionWithContext(
  user: AppUser,
  context?: { ipAddress?: string; userAgent?: string; expiresAt?: string }
): Promise<Session> {
  const store = await readStore();
  // Daily-code logins pass an end-of-day expiry so access lapses overnight and
  // a fresh code is needed tomorrow; otherwise the normal rolling max-age.
  const expiresAt = String(context?.expiresAt || "").trim() || new Date(Date.now() + 1000 * SESSION_MAX_AGE_SECONDS).toISOString();
  const ipAddress = String(context?.ipAddress || "").trim() || undefined;
  const userAgent = String(context?.userAgent || "").slice(0, 500) || undefined;
  const session: Session = {
    token: randomUUID(),
    userId: user.id,
    companyId: user.companyId,
    expiresAt,
    ipAddress,
    ipSubnet: ipAddress ? deriveIpSubnet(ipAddress) : undefined,
    userAgent,
    createdAt: new Date().toISOString()
  };

  store.sessions = store.sessions
    .filter((s) => new Date(s.expiresAt).getTime() > Date.now())
    .concat(session);
  await writeStore(store);
  return session;
}

export async function createClientInvite(input: {
  companyId: string;
  caseId: string;
  createdByUserId: string;
  email?: string;
}): Promise<ClientInvite> {
  const store = await readStore();
  const caseItem = store.cases.find((c) => c.companyId === input.companyId && c.id === input.caseId);
  if (!caseItem) throw new Error("Case not found");

  const neverExpire = String(process.env.INVITE_LINK_NEVER_EXPIRES || "false").toLowerCase() === "true";
  const expiresAt = neverExpire
    ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 50).toISOString()
    : new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString();

  const invite: ClientInvite = {
    token: randomUUID(),
    companyId: input.companyId,
    caseId: input.caseId,
    email: input.email?.trim() || undefined,
    createdByUserId: input.createdByUserId,
    status: "pending",
    expiresAt,
    createdAt: new Date().toISOString()
  };

  store.invites = [invite, ...store.invites];
  await writeStore(store);
  return invite;
}

export async function getLatestClientInviteForCase(
  companyId: string,
  caseId: string
): Promise<ClientInvite | null> {
  const store = await readStore();
  const caseItem = store.cases.find((c) => c.companyId === companyId && c.id === caseId);
  if (!caseItem) return null;

  const invites = store.invites
    .filter((i) => i.companyId === companyId && i.caseId === caseId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return invites[0] ?? null;
}

export async function getClientInviteByToken(token: string): Promise<ClientInvite | null> {
  const store = await readStore();
  const invite = store.invites.find((i) => i.token === token);
  if (!invite) return null;

  const enableExpiry = String(process.env.INVITE_LINK_ENABLE_EXPIRY || "true").toLowerCase() === "true";
  if (enableExpiry && invite.status === "pending" && new Date(invite.expiresAt).getTime() <= Date.now()) {
    invite.status = "expired";
    await writeStore(store);
  }

  return store.invites.find((i) => i.token === token) ?? null;
}

export async function resolveUserFromInviteToken(
  token: string,
  expectedCaseId?: string
): Promise<AppUser | null> {
  const rawToken = String(token || "").trim();
  if (!rawToken) return null;

  const store = await readStore();
  const invite = store.invites.find((i) => i.token === rawToken);
  if (!invite) return null;

  if (expectedCaseId && invite.caseId !== expectedCaseId) return null;

  const enableExpiry =
    String(process.env.INVITE_LINK_ENABLE_EXPIRY || "true").toLowerCase() === "true";
  if (enableExpiry && invite.status === "pending" && new Date(invite.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  if (invite.status !== "accepted" || !invite.usedByUserId) return null;

  const user = store.users.find(
    (u) =>
      u.id === invite.usedByUserId &&
      u.companyId === invite.companyId &&
      u.userType === "client" &&
      u.active !== false
  );
  return user ?? null;
}

export async function acceptClientInvite(input: {
  token: string;
  name: string;
  email: string;
  password: string;
}): Promise<{ user: AppUser; company: Company; caseItem: CaseItem }> {
  const store = await readStore();
  const inviteIdx = store.invites.findIndex((i) => i.token === input.token);
  if (inviteIdx === -1) throw new Error("Invite not found");
  const invite = store.invites[inviteIdx];
  if (new Date(invite.expiresAt).getTime() <= Date.now()) throw new Error("Invite has expired");

  const company = store.companies.find((c) => c.id === invite.companyId);
  if (!company) throw new Error("Company not found");
  const caseIdx = store.cases.findIndex((c) => c.companyId === invite.companyId && c.id === invite.caseId);
  if (caseIdx === -1) throw new Error("Case not found");

  const allowReuse =
    String(process.env.INVITE_ALLOW_REUSE || "true").toLowerCase() === "true";
  if (invite.status === "accepted" && invite.usedByUserId) {
    if (!allowReuse) {
      throw new Error("Invite is no longer valid. Please request a new secure link.");
    }
    const existingUser = store.users.find(
      (u) => u.id === invite.usedByUserId && u.companyId === invite.companyId
    );
    if (!existingUser) throw new Error("Invite user not found");
    return { user: existingUser, company, caseItem: store.cases[caseIdx] };
  }

  if (invite.status !== "pending") throw new Error("Invite is no longer valid");

  const existing = store.users.find((u) => u.email.toLowerCase() === input.email.toLowerCase());
  if (existing) throw new Error("Email already in use");

  const user: AppUser = {
    id: `USR-${store.users.length + 1}`,
    companyId: invite.companyId,
    name: input.name.trim(),
    email: input.email.trim(),
    role: "Client",
    userType: "client",
    active: true,
    password: await hashPassword(input.password),
    caseId: invite.caseId
  };

  store.users.push(user);
  store.cases[caseIdx] = {
    ...store.cases[caseIdx],
    client: user.name,
    clientUserId: user.id
  };
  store.invites[inviteIdx] = {
    ...invite,
    status: "accepted",
    usedByUserId: user.id,
    acceptedAt: new Date().toISOString()
  };
  await writeStore(store);

  return { user, company, caseItem: store.cases[caseIdx] };
}

export async function destroySession(token: string): Promise<void> {
  const store = await readStore();
  store.sessions = store.sessions.filter((s) => s.token !== token);
  await writeStore(store);
}

export async function resolveUserFromSession(token: string): Promise<AppUser | null> {
  return resolveUserFromSessionWithContext(token, {});
}

export async function resolveUserFromSessionWithContext(
  token: string,
  context?: { ipAddress?: string; userAgent?: string }
): Promise<AppUser | null> {
  const store = await readStore();
  const session = store.sessions.find((s) => s.token === token);
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    store.sessions = store.sessions.filter((s) => s.token !== token);
    await writeStore(store);
    return null;
  }

  const found = store.users.find((u) => u.id === session.userId) ?? null;
  if (!found || found.active === false) {
    store.sessions = store.sessions.filter((s) => s.token !== token);
    await writeStore(store);
    return null;
  }

  const strictBinding =
    String(process.env.ENFORCE_SESSION_BINDING || "true").toLowerCase() === "true";
  if (strictBinding) {
    const reqIp = String(context?.ipAddress || "").trim();
    const reqUa = String(context?.userAgent || "").trim();
    const sessionSubnet = String(session.ipSubnet || "").trim();
    const reqSubnet = reqIp ? deriveIpSubnet(reqIp) : "";
    const sessionUa = String(session.userAgent || "").trim();
    const uaMismatch = Boolean(sessionUa && reqUa && sessionUa !== reqUa);

    // IP-subnet binding is OPT-IN (off by default). Egress IPs legitimately
    // rotate — mobile networks, CGNAT, load-balanced proxies, and CDN edges in
    // front of the custom domain can change the subnet between two requests in
    // the SAME session. Hard-deleting the session on that mismatch logged staff
    // out mid-session (e.g. the case loads, then the notes call 401s) and a
    // re-login wouldn't stick while the IP kept rotating. We keep the stable
    // user-agent binding (a strong signal against stolen cookies) and only
    // enforce IP when explicitly enabled.
    const enforceIp =
      String(process.env.ENFORCE_SESSION_IP_BINDING || "false").toLowerCase() === "true";
    const ipMismatch =
      enforceIp && Boolean(sessionSubnet && reqSubnet && sessionSubnet !== reqSubnet);

    if (uaMismatch || ipMismatch) {
      store.sessions = store.sessions.filter((s) => s.token !== token);
      await writeStore(store);
      return null;
    }
  }

  return found;
}

export async function listCases(companyId: string): Promise<CaseItem[]> {
  const store = await readStore();
  const now = Date.now();
  return store.cases
    .filter((c) => c.companyId === companyId)
    .map((c) => {
      if (!c.deadlineDate) return c;
      const diffMs = new Date(String(c.deadlineDate)).getTime() - now;
      const dueInDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return { ...c, dueInDays: Number.isFinite(dueInDays) ? dueInDays : c.dueInDays };
    });
}

export async function findCompanyById(companyId: string): Promise<Company | null> {
  const store = await readStore();
  return store.companies.find((c) => c.id === companyId) ?? null;
}

export async function resolveCaseDriveRootLink(
  companyId: string,
  caseId: string
): Promise<{
  link: string;
  source: "assigned_user" | "company";
  assignedUserId?: string;
}> {
  const store = await readStore();
  const caseItem = store.cases.find((c) => c.companyId === companyId && c.id === caseId);
  const company = store.companies.find((c) => c.id === companyId);
  if (!caseItem || !company) {
    return { link: "", source: "company" };
  }

  const assignedTo = String(caseItem.assignedTo || "").trim().toLowerCase();
  if (assignedTo && assignedTo !== "unassigned") {
    const assignedUser = store.users.find(
      (u) =>
        u.companyId === companyId &&
        u.userType === "staff" &&
        String(u.name || "").trim().toLowerCase() === assignedTo
    );
    const userLink = String(assignedUser?.workspaceDriveLink || "").trim();
    if (userLink) {
      return { link: userLink, source: "assigned_user", assignedUserId: assignedUser?.id };
    }
  }

  const companyLink = String(company.branding?.driveRootLink || "").trim();
  if (companyLink) {
    return { link: companyLink, source: "company" };
  }

  // Final fallback: the global Drive root from the GOOGLE_DRIVE_ROOT_FOLDER_ID
  // env var. Without this, any case whose assignee has no personal Drive link
  // AND whose company has no driveRootLink configured gets NO folder created
  // (drive_root_missing) — and even the manual "Create Drive folder" button
  // fails with "No Drive root is configured." The WhatsApp webhook and the
  // marketing-convert path already use GOOGLE_DRIVE_ROOT_FOLDER_ID as the
  // canonical root, so falling back to it here makes folder creation reliable
  // and consistent across every case-creation path. extractDriveFolderId()
  // accepts a bare folder id, so the raw env value works directly.
  const envRoot = String(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "").trim();
  if (envRoot) {
    return { link: envRoot, source: "company" };
  }

  return { link: "", source: "company" };
}

export async function findCompanyBySlug(slug: string): Promise<Company | null> {
  const store = await readStore();
  return store.companies.find((c) => c.slug === slug) ?? null;
}

export async function updateCompanyBranding(
  companyId: string,
  patch: Partial<Company["branding"]>
): Promise<Company | null> {
  const store = await readStore();
  const idx = store.companies.findIndex((c) => c.id === companyId);
  if (idx === -1) return null;
  store.companies[idx] = {
    ...store.companies[idx],
    branding: {
      ...store.companies[idx].branding,
      ...patch
    }
  };
  await writeStore(store);
  return store.companies[idx];
}

export async function getCase(companyId: string, caseId: string): Promise<CaseItem | null> {
  const store = await readStore();
  return store.cases.find((c) => c.companyId === companyId && c.id === caseId) ?? null;
}

// Find a case by id WITHOUT scoping to a company. Use for single-firm features
// (notes, review comments) where staff accounts have drifted between company
// IDs ("CMP-1" vs "newton") and a company-scoped getCase would wrongly miss the
// case. Case IDs are unique in this deployment.
export async function getCaseAnyCompany(caseId: string): Promise<CaseItem | null> {
  const store = await readStore();
  return store.cases.find((c) => c.id === caseId) ?? null;
}

export async function createCase(input: {
  companyId: string;
  client: string;
  formType: string;
  leadPhone?: string;
  leadEmail?: string;
  assignedTo?: string;
  additionalNotes?: string;
  sourceLeadKey?: string;
  isUrgent?: boolean;
  dueInDays?: number;
  permitExpiryDate?: string;
  totalCharges?: number;
  irccFees?: number;
  irccFeePayer?: "sir_card" | "client_card";
  familyMembers?: string;
  familyTotalCharges?: number;
}): Promise<CaseItem> {
  return mutateStore(async (store) => {

  // ── DUPLICATE-CASE GUARD ──
  // Bulk intake, web-form double-submits, and automation retries were creating
  // duplicate (even triplicate) cases for the same person — e.g. yuvraj x2,
  // LOVELEEN KAUR x3. If a case for the same company + client name + formType
  // was created very recently (and the phone matches when one is supplied),
  // return that existing case instead of spawning another. The window is short
  // (24h) so a genuine second application later is never blocked, and we return
  // the existing case rather than throwing so callers keep working.
  const dupName = String(input.client || "").trim().toLowerCase();
  const dupPhone = String(input.leadPhone || "").replace(/\D/g, "").slice(-10);
  const dupForm = String(input.formType || "").trim().toLowerCase();
  if (dupName) {
    const DUP_WINDOW_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const existingDup = store.cases.find((c) => {
      if (c.companyId !== input.companyId) return false;
      if (String(c.client || "").trim().toLowerCase() !== dupName) return false;
      if (dupForm && String(c.formType || "").trim().toLowerCase() !== dupForm) return false;
      // When a phone is supplied, require it to match (last 10 digits) so two
      // different people with the same name aren't merged.
      if (dupPhone) {
        const cPhone = String(c.leadPhone || "").replace(/\D/g, "").slice(-10);
        if (cPhone !== dupPhone) return false;
      }
      const created = new Date(c.createdAt || 0).getTime();
      return Number.isFinite(created) && now - created < DUP_WINDOW_MS;
    });
    if (existingDup) {
      console.warn(
        `⛔ Duplicate case creation blocked: "${input.client}" (${input.formType}) matches recent ${existingDup.id} created ${existingDup.createdAt} — returning existing case.`
      );
      return existingDup;
    }
  }

  const company = store.companies.find((c) => c.id === input.companyId);
  const normalizedEmail = String(input.leadEmail || "").trim().toLowerCase();
  const normalizedPhone = String(input.leadPhone || "").replace(/\s+/g, "");
  let client =
    (normalizedEmail &&
      store.clients.find(
        (c) => c.companyId === input.companyId && String(c.email || "").trim().toLowerCase() === normalizedEmail
      )) ||
    (normalizedPhone &&
      store.clients.find(
        (c) => c.companyId === input.companyId && String(c.phone || "").replace(/\s+/g, "") === normalizedPhone
      )) ||
    store.clients.find(
      (c) =>
        c.companyId === input.companyId &&
        String(c.fullName || "").trim().toLowerCase() === String(input.client || "").trim().toLowerCase()
    );
  if (!client) {
    client = {
      id: `CLIENT-${randomUUID()}`,
      companyId: input.companyId,
      clientCode: nextClientCode(store.clients),
      fullName: input.client,
      phone: String(input.leadPhone || "").trim() || undefined,
      email: String(input.leadEmail || "").trim() || undefined,
      assignedTo: "Unassigned",
      internalFlags: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.clients.push(client);
  } else {
    client = {
      ...client,
      fullName: input.client || client.fullName,
      phone: String(input.leadPhone || "").trim() || client.phone,
      email: String(input.leadEmail || "").trim() || client.email,
      updatedAt: new Date().toISOString()
    };
    const cIdx = store.clients.findIndex((c) => c.id === client?.id);
    if (cIdx !== -1) store.clients[cIdx] = client;
  }

  // Case IDs must be GLOBALLY unique, not per-company. Previously this filtered
  // by companyId, so when cases drifted across two company IDs (the CMP-1 seed
  // vs. the "newton" WhatsApp/marketing flow) the counter ignored the other
  // company's cases and reused a number that already existed there — e.g. a new
  // conversion landed on CASE-1584 while CASE-1584 already belonged to another
  // client under the other company. That duplicate then went invisible to the
  // processing team (who scope by company). Compute the highest number across
  // ALL cases, and guard against any pre-existing collision by bumping until the
  // id is genuinely free.
  const existingIds = new Set(store.cases.map((c) => String(c.id || "")));
  const highestCaseNumber = store.cases.reduce((max, c) => {
    const parsed = Number(String(c.id || "").replace(/^CASE-/, ""));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 1000);
  let nextNum = highestCaseNumber + 1;
  while (existingIds.has(`CASE-${nextNum}`)) nextNum++;
  const nextId = `CASE-${nextNum}`;
  const dueInDays = Number.isFinite(Number(input.dueInDays)) && Number(input.dueInDays) > 0 ? Number(input.dueInDays) : 7;
  const deadlineDate = new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000).toISOString();
  const totalCharges =
    Number.isFinite(Number(input.totalCharges)) && Number(input.totalCharges) >= 0
      ? Number(input.totalCharges)
      : 0;
  const irccFees =
    Number.isFinite(Number(input.irccFees)) && Number(input.irccFees) >= 0
      ? Number(input.irccFees)
      : 0;
  const irccFeePayer = input.irccFeePayer === "sir_card" ? "sir_card" : "client_card";
  const familyMembers = String(input.familyMembers || "").trim();
  const familyTotalCharges =
    Number.isFinite(Number(input.familyTotalCharges)) && Number(input.familyTotalCharges) >= 0
      ? Number(input.familyTotalCharges)
      : undefined;
  const item: CaseItem = {
    id: nextId,
    companyId: input.companyId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    clientId: client.id,
    client: input.client,
    caseStatus: "lead",
    aiStatus: "idle",
    leadPhone: input.leadPhone?.trim() || undefined,
    leadEmail: input.leadEmail?.trim() || undefined,
    sourceLeadKey: input.sourceLeadKey?.trim() || undefined,
    formType: input.formType,
    assignedTo: String(input.assignedTo || "Unassigned").trim() || "Unassigned",
    processingStatus: "docs_pending",
    processingStatusOther: undefined,
    isUrgent: Boolean(input.isUrgent),
    deadlineDate,
    permitExpiryDate: input.permitExpiryDate || undefined,
    owner: "N/A",
    reviewer: "N/A",
    stage: "Lead",
    dueInDays,
    unreadClientMessages: 0,
    docsPending: 5,
    balanceAmount: totalCharges,
    retainerSigned: false,
    retainerSentAt: undefined,
    // Do NOT seed the shared Drive root here. A per-case subfolder is created
    // at case setup (New Case screen) or lazily on the first document upload.
    // Seeding the root caused client docs to be uploaded straight into the
    // shared root folder (orphaned, no case folder). Empty = "no folder yet".
    docsUploadLink: "",
    applicationFormsLink: undefined,
    submittedFolderLink: undefined,
    correspondenceFolderLink: undefined,
    questionnaireLink: "",
    paymentMethod: "interac",
    interacRecipient: "",
    interacInstructions: "",
    paymentStatus: "pending",
    paymentPaidAt: undefined,
    amountPaid: 0,
    totalCharges,
    irccFees,
    irccFeePayer,
    familyMembers: familyMembers || undefined,
    familyTotalCharges,
    remarks: String(input.additionalNotes || "").trim() || undefined,
    imm5710Automation: { status: "idle" },
    pgwpIntake: undefined,
    docRequests: [],
    retainerRecord: undefined,
    servicePackage: {
      name: "Standard Service",
      retainerAmount: totalCharges,
      balanceAmount: totalCharges,
      milestones: []
    },
    invoices: []
  };
  if (client) {
    const clientIdx = store.clients.findIndex((c) => c.id === client?.id);
    if (clientIdx !== -1 && item.assignedTo && item.assignedTo !== "Unassigned") {
      store.clients[clientIdx] = {
        ...store.clients[clientIdx],
        assignedTo: item.assignedTo,
        updatedAt: new Date().toISOString()
      };
    }
  }
  store.cases = [item, ...store.cases];
  return item;
  });
}

// ── Duplicate-case diagnostics + repair ──────────────────────────────────
// Cases drifted across two company IDs (CMP-1 seed vs. "newton" WhatsApp flow),
// and the old per-company id counter reused numbers that already existed under
// the other company — producing two cases with the SAME CASE-id. The duplicate
// then went invisible to whichever team scopes by the other company. These two
// helpers report and repair that.

type SlimCase = { id: string; client: string; companyId: string; formType?: string; leadPhone?: string; leadEmail?: string; assignedTo?: string; caseStatus?: string; processingStatus?: string; sourceLeadKey?: string; createdAt?: string };

export async function inspectCaseData(opts?: { phone?: string; caseId?: string; name?: string }): Promise<{
  totalCases: number;
  companyCounts: Record<string, number>;
  duplicateIds: Array<{ id: string; cases: SlimCase[] }>;
  phoneMatches: SlimCase[];
  caseMatch: SlimCase[];
  nameMatches: SlimCase[];
}> {
  const store = await readStore();
  const cases = store.cases || [];
  const companyCounts: Record<string, number> = {};
  const byId: Record<string, CaseItem[]> = {};
  for (const c of cases) {
    companyCounts[String(c.companyId)] = (companyCounts[String(c.companyId)] || 0) + 1;
    (byId[String(c.id)] ||= []).push(c);
  }
  const slim = (c: CaseItem): SlimCase => ({
    id: c.id, client: c.client, companyId: c.companyId, formType: c.formType,
    leadPhone: c.leadPhone, leadEmail: c.leadEmail, assignedTo: c.assignedTo,
    caseStatus: c.caseStatus, processingStatus: c.processingStatus,
    sourceLeadKey: c.sourceLeadKey, createdAt: c.createdAt,
  });
  const duplicateIds = Object.entries(byId)
    .filter(([, list]) => list.length > 1)
    .map(([id, list]) => ({ id, cases: list.map(slim) }));
  const tail = String(opts?.phone || "").replace(/\D/g, "").slice(-10);
  const phoneMatches = tail
    ? cases.filter((c) => String(c.leadPhone || "").replace(/\D/g, "").slice(-10) === tail).map(slim)
    : [];
  const caseMatch = opts?.caseId
    ? cases.filter((c) => String(c.id) === String(opts.caseId)).map(slim)
    : [];
  const nameNeedle = String(opts?.name || "").trim().toLowerCase();
  const nameMatches = nameNeedle
    ? cases.filter((c) => String(c.client || "").toLowerCase().includes(nameNeedle)).map(slim)
    : [];
  return { totalCases: cases.length, companyCounts, duplicateIds, phoneMatches, caseMatch, nameMatches };
}

// Repair duplicate ids: keep the OLDEST case for each colliding id, and assign
// every newer duplicate a fresh, globally-unique CASE number. Optionally also
// re-point those repaired cases to a canonical companyId so the processing team
// (which scopes by company) can finally see them. Returns the list of changes.
export async function repairDuplicateCaseIds(opts?: {
  alignCompanyId?: string;       // if set, repaired cases get this companyId
}): Promise<{ changes: Array<{ oldId: string; newId: string; client: string; fromCompany: string; toCompany: string }> }> {
  return mutateStore(async (store) => {
    const cases = store.cases || [];
    const byId: Record<string, CaseItem[]> = {};
    for (const c of cases) (byId[String(c.id)] ||= []).push(c);

    // Track all numeric ids in use so re-assignment stays globally unique.
    const usedNums = new Set<number>();
    for (const c of cases) {
      const n = Number(String(c.id || "").replace(/^CASE-/, ""));
      if (Number.isFinite(n)) usedNums.add(n);
    }
    let nextNum = Math.max(1000, ...Array.from(usedNums)) + 1;
    const freshId = () => { while (usedNums.has(nextNum)) nextNum++; usedNums.add(nextNum); return `CASE-${nextNum}`; };

    const changes: Array<{ oldId: string; newId: string; client: string; fromCompany: string; toCompany: string }> = [];
    for (const [id, list] of Object.entries(byId)) {
      if (list.length < 2) continue;
      // Keep the oldest (smallest createdAt); re-id the rest.
      const sorted = list.slice().sort((a, b) =>
        String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
      );
      for (let i = 1; i < sorted.length; i++) {
        const dup = sorted[i];
        const oldId = String(dup.id);
        const newId = freshId();
        const fromCompany = String(dup.companyId);
        const toCompany = opts?.alignCompanyId || fromCompany;
        dup.id = newId;
        dup.updatedAt = new Date().toISOString();
        if (opts?.alignCompanyId) dup.companyId = opts.alignCompanyId;
        changes.push({ oldId, newId, client: dup.client, fromCompany, toCompany });
      }
    }
    return { changes };
  });
}

export async function resetCompanyDataToSingleCase(input: {
  companyId: string;
  clientName: string;
  caseNumber: number;
  formType?: string;
  keepStaffSessions?: boolean;
}): Promise<CaseItem> {
  const store = await readStore();
  const company = store.companies.find((c) => c.id === input.companyId);
  if (!company) {
    throw new Error("Company not found");
  }

  const normalizedClient = String(input.clientName || "").trim();
  if (!normalizedClient) {
    throw new Error("Client name is required");
  }
  const caseNumber = Number(input.caseNumber);
  if (!Number.isFinite(caseNumber) || caseNumber < 1000) {
    throw new Error("Case number must be 1000 or greater");
  }
  const caseId = `CASE-${Math.floor(caseNumber)}`;
  // Refuse to create a second case with an id that already exists ANYWHERE in
  // the store (any company) — duplicate ids are what made a converted lead
  // invisible to the processing team.
  if (store.cases.some((c) => String(c.id) === caseId)) {
    throw new Error(`Case ${caseId} already exists — choose a different number.`);
  }
  const formType = String(input.formType || "PGWP").trim() || "PGWP";
  const keepSessions = input.keepStaffSessions !== false;

  const staffUserIds = new Set(
    store.users.filter((u) => u.companyId === input.companyId && u.userType === "staff").map((u) => u.id)
  );

  const freshCase: CaseItem = {
    id: caseId,
    companyId: input.companyId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    clientId: `CLIENT-${randomUUID()}`,
    client: normalizedClient,
    formType,
    assignedTo: "Unassigned",
    processingStatus: "docs_pending",
    processingStatusOther: undefined,
    caseStatus: "lead",
    aiStatus: "idle",
    owner: "N/A",
    reviewer: "N/A",
    stage: "Lead",
    dueInDays: 7,
    isUrgent: false,
    deadlineDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    unreadClientMessages: 0,
    docsPending: 0,
    balanceAmount: 0,
    retainerSigned: false,
    docsUploadLink: "", // never seed the shared Drive root (orphans client docs)
    questionnaireLink: "",
    paymentMethod: "interac",
    interacRecipient: process.env.NEXT_PUBLIC_INTERAC_RECIPIENT || "newtonimmigration@gmail.com",
    interacInstructions: "Send Interac e-Transfer with case number.",
    paymentStatus: "pending",
    amountPaid: 0,
    applicationNumber: undefined,
    totalCharges: 0,
    irccFees: 0,
    irccFeePayer: "client_card",
    imm5710Automation: { status: "idle" },
    docRequests: [],
    servicePackage: {
      name: "Standard Service",
      retainerAmount: 0,
      balanceAmount: 0,
      milestones: []
    },
    invoices: []
  };

  store.cases = [freshCase, ...store.cases.filter((c) => c.companyId !== input.companyId)];
  store.clients = [
    {
      id: freshCase.clientId as string,
      companyId: input.companyId,
      clientCode: nextClientCode(store.clients.filter((c) => c.companyId === input.companyId)),
      fullName: normalizedClient,
      assignedTo: "Unassigned",
      internalFlags: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    ...store.clients.filter((c) => c.companyId !== input.companyId)
  ];
  store.messages = store.messages.filter((m) => m.companyId !== input.companyId);
  store.outboundMessages = store.outboundMessages.filter((m) => m.companyId !== input.companyId);
  store.documents = store.documents.filter((d) => d.companyId !== input.companyId);
  store.clientCommunications = store.clientCommunications.filter((n) => n.companyId !== input.companyId);
  store.auditLogs = store.auditLogs.filter((l) => l.companyId !== input.companyId);
  store.tasks = store.tasks.filter((t) => t.companyId !== input.companyId);
  store.notifications = store.notifications.filter((n) => n.companyId !== input.companyId);
  store.invites = store.invites.filter((i) => i.companyId !== input.companyId);
  store.users = store.users.filter((u) => u.companyId !== input.companyId || u.userType === "staff");
  store.sessions = keepSessions
    ? store.sessions.filter((s) => s.companyId !== input.companyId || staffUserIds.has(s.userId))
    : store.sessions.filter((s) => s.companyId !== input.companyId);

  // Messages live in their own table post-migration — wipe the company's there too.
  if (isPostgresBackendEnabled()) {
    await deleteCompanyMessagesFromTable(input.companyId).catch((e) =>
      console.error("company reset: case_messages cleanup failed:", (e as Error).message)
    );
  }

  await writeStore(store);
  return freshCase;
}

export async function pruneCompanyDataToCaseIds(input: {
  companyId: string;
  keepCaseIds: string[];
  keepStaffSessions?: boolean;
}): Promise<{ keptCases: CaseItem[]; deletedCount: number }> {
  const store = await readStore();
  const keepSet = new Set(
    (input.keepCaseIds || [])
      .map((id) => String(id || "").trim().toUpperCase())
      .filter((id) => /^CASE-\d+$/.test(id))
  );
  if (keepSet.size === 0) {
    throw new Error("At least one valid case ID is required");
  }

  const allCompanyCases = store.cases.filter((c) => c.companyId === input.companyId);
  const keptCases = allCompanyCases.filter((c) => keepSet.has(String(c.id).toUpperCase()));
  if (keptCases.length === 0) {
    throw new Error("None of the requested case IDs were found");
  }

  const keepIds = new Set(keptCases.map((c) => c.id));
  const keepSessions = input.keepStaffSessions !== false;
  const staffUserIds = new Set(
    store.users.filter((u) => u.companyId === input.companyId && u.userType === "staff").map((u) => u.id)
  );

  const beforeCount = allCompanyCases.length;

  store.cases = [
    ...store.cases.filter((c) => c.companyId !== input.companyId),
    ...keptCases
  ];
  store.messages = store.messages.filter(
    (m) => m.companyId !== input.companyId || keepIds.has(m.caseId)
  );
  store.outboundMessages = store.outboundMessages.filter(
    (m) => m.companyId !== input.companyId || keepIds.has(m.caseId)
  );
  store.documents = store.documents.filter(
    (d) => d.companyId !== input.companyId || keepIds.has(d.caseId)
  );
  store.tasks = store.tasks.filter(
    (t) => t.companyId !== input.companyId || keepIds.has(t.caseId)
  );
  store.invites = store.invites.filter(
    (i) => i.companyId !== input.companyId || keepIds.has(i.caseId)
  );
  store.users = store.users.filter((u) => {
    if (u.companyId !== input.companyId) return true;
    if (u.userType === "staff") return true;
    if (!u.caseId) return false;
    return keepIds.has(u.caseId);
  });
  store.notifications = store.notifications.filter((n) => n.companyId !== input.companyId);
  store.clientCommunications = store.clientCommunications.filter(
    (n) => n.companyId !== input.companyId || keepIds.has(store.cases.find((c) => c.clientId === n.clientId)?.id || "")
  );
  store.sessions = keepSessions
    ? store.sessions.filter((s) => s.companyId !== input.companyId || staffUserIds.has(s.userId))
    : store.sessions.filter((s) => s.companyId !== input.companyId);

  await writeStore(store);
  return {
    keptCases,
    deletedCount: Math.max(0, beforeCount - keptCases.length)
  };
}

function inferCaseStatusFromStage(stage: Stage): CaseStatus {
  if (stage === "Lead") return "lead";
  if (stage === "Under Review") return "under_review";
  if (stage === "Submitted" || stage === "Decision") return "submitted";
  if (stage === "Assigned" || stage === "Intake" || stage === "Paid") return "active";
  return "active";
}

// One-time data hygiene: a case that was submitted in an older code path often
// kept its old `stage` (commonly "Paid") even though processingStatus is
// "submitted"/submittedAt is set. That drift makes submitted files show up as
// "paid, not started" and pollutes every stage-based view. This realigns stage
// (and the derived caseStatus) for every already-submitted case. Idempotent.
export async function backfillSubmittedStages(): Promise<{ scanned: number; fixed: number; examples: string[] }> {
  return mutateStore((store) => {
    let fixed = 0;
    const examples: string[] = [];
    for (const c of store.cases) {
      // Conservative: only realign cases whose processingStatus is definitively
      // "submitted". A case with submittedAt but status under_review/docs_pending
      // was submitted then RE-OPENED (e.g. IRCC request letter / sent back to
      // review) — its current stage is correct and must be left alone.
      if (c.processingStatus !== "submitted") continue;
      if (c.stage === "Submitted" || c.stage === "Decision") continue;
      const target: Stage = (c as any).finalOutcome ? "Decision" : "Submitted";
      c.stage = target;
      c.caseStatus = inferCaseStatusFromStage(c.stage);
      if (!(c as any).submittedAt) (c as any).submittedAt = new Date().toISOString();
      c.updatedAt = new Date().toISOString();
      fixed += 1;
      if (examples.length < 20) examples.push(c.id);
    }
    return { scanned: store.cases.length, fixed, examples };
  });
}

function mapCaseStatusToStage(status: CaseStatus): Stage {
  if (status === "lead") return "Lead";
  if (status === "active") return "Assigned";
  if (status === "under_review") return "Under Review";
  if (status === "ready") return "Submitted";
  if (status === "submitted") return "Submitted";
  return "Assigned";
}

function findCaseTasks(store: AppStore, companyId: string, caseId: string) {
  return store.tasks.filter((t) => t.companyId === companyId && t.caseId === caseId);
}

function hasOpenTaskWithTitle(store: AppStore, companyId: string, caseId: string, title: string) {
  return store.tasks.some(
    (t) =>
      t.companyId === companyId &&
      t.caseId === caseId &&
      t.status === "pending" &&
      t.title.toLowerCase() === title.toLowerCase()
  );
}

function addAutomationTask(
  store: AppStore,
  input: {
    companyId: string;
    caseId: string;
    title: string;
    description: string;
    assignedTo: string;
    priority: "low" | "medium" | "high";
  }
) {
  if (hasOpenTaskWithTitle(store, input.companyId, input.caseId, input.title)) return;
  const task: TaskItem = {
    id: `TSK-${randomUUID().slice(0, 8)}`,
    companyId: input.companyId,
    caseId: input.caseId,
    title: input.title,
    description: input.description,
    assignedTo: input.assignedTo,
    createdBy: "ai",
    priority: input.priority,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  store.tasks.unshift(task);
}

function addAutomationNotification(
  store: AppStore,
  input: { companyId: string; userId: string; type: "deadline" | "missing_doc" | "ai_alert"; message: string }
) {
  const notice: NotificationItem = {
    id: `NTF-${randomUUID().slice(0, 8)}`,
    companyId: input.companyId,
    userId: input.userId,
    type: input.type,
    message: input.message,
    read: false,
    createdAt: new Date().toISOString()
  };
  store.notifications.unshift(notice);
}

function evaluateCaseAutomation(store: AppStore, caseItem: CaseItem) {
  const requiredDocKeywords = ["passport", "study permit", "transcript", "completion letter"];
  const docs = store.documents.filter((d) => d.companyId === caseItem.companyId && d.caseId === caseItem.id);
  const hasAllRequired = requiredDocKeywords.every((keyword) =>
    docs.some((d) => d.name.toLowerCase().includes(keyword))
  );

  const assignedTo = caseItem.owner && caseItem.owner !== "N/A" ? caseItem.owner : "Unassigned";

  if (caseItem.paymentStatus === "paid") {
    caseItem.caseStatus = caseItem.stage === "Under Review" ? "under_review" : "active";
    if (!caseItem.aiStatus || caseItem.aiStatus === "idle") caseItem.aiStatus = "collecting_docs";
  }

  if (caseItem.paymentStatus === "pending") {
    if (!hasOpenTaskWithTitle(store, caseItem.companyId, caseItem.id, "Follow up with client for payment")) {
      addAutomationTask(store, {
        companyId: caseItem.companyId,
        caseId: caseItem.id,
        title: "Follow up with client for payment",
        description: "Payment is pending. Send payment reminder.",
        assignedTo,
        priority: "high"
      });
    }
  }

  if (caseItem.aiStatus === "collecting_docs" || caseItem.aiStatus === "waiting_client") {
    if (!hasAllRequired) {
      caseItem.aiStatus = "waiting_client";
      addAutomationTask(store, {
        companyId: caseItem.companyId,
        caseId: caseItem.id,
        title: "Follow up with client",
        description: "Missing required PGWP documents. Follow up in 48h.",
        assignedTo,
        priority: "medium"
      });
    }
  }

  if (hasAllRequired && caseItem.paymentStatus === "paid") {
    caseItem.aiStatus = "drafting";
    addAutomationTask(store, {
      companyId: caseItem.companyId,
      caseId: caseItem.id,
      title: "Review application",
      description: "All required documents uploaded. Review draft package.",
      assignedTo: caseItem.reviewer && caseItem.reviewer !== "N/A" ? caseItem.reviewer : assignedTo,
      priority: "high"
    });
  }

  if (caseItem.stage === "Submitted") {
    caseItem.caseStatus = "submitted";
    caseItem.aiStatus = "completed";
    store.tasks = store.tasks.map((t) =>
      t.companyId === caseItem.companyId && t.caseId === caseItem.id ? { ...t, status: "completed" } : t
    );
  } else {
    caseItem.caseStatus = inferCaseStatusFromStage(caseItem.stage);
  }

  const adminUser = store.users.find((u) => u.companyId === caseItem.companyId && u.userType === "staff" && u.role === "Admin");
  if (adminUser && caseItem.aiStatus === "drafting") {
    addAutomationNotification(store, {
      companyId: caseItem.companyId,
      userId: adminUser.id,
      type: "ai_alert",
      message: `${caseItem.id} is ready for review (AI drafting completed docs check).`
    });
  }
}

function syncMissingIntakeTasksInStore(store: AppStore, caseItem: CaseItem, assignedTo: string) {
  const formType = String(caseItem.formType || "").toLowerCase();
  if (!formType.includes("pgwp") && !formType.includes("imm5710")) return;

  const missing = getMissingImm5710Questions(caseItem.pgwpIntake);
  const missingTitles = new Set(missing.map((q) => `IMM5710 data needed: ${q.label}`.toLowerCase()));

  for (const q of missing) {
    addAutomationTask(store, {
      companyId: caseItem.companyId,
      caseId: caseItem.id,
      title: `IMM5710 data needed: ${q.label}`,
      description: "Collect this missing IMM5710 answer from client or case team, then update intake.",
      assignedTo,
      priority: "high"
    });
  }

  store.tasks = store.tasks.map((t) => {
    if (t.companyId !== caseItem.companyId || t.caseId !== caseItem.id) return t;
    const isImmTask = t.title.toLowerCase().startsWith("imm5710 data needed:");
    if (!isImmTask || t.status !== "pending") return t;
    if (missingTitles.has(t.title.toLowerCase())) return t;
    return { ...t, status: "completed" };
  });
}

function syncMissingDocumentTasksInStore(store: AppStore, caseItem: CaseItem, assignedTo: string) {
  const formType = String(caseItem.formType || "").toLowerCase();
  const docs = store.documents.filter((d) => d.companyId === caseItem.companyId && d.caseId === caseItem.id);
  const isPgwpCase = formType.includes("pgwp") || formType.includes("imm5710");
  const missingDocLabels = isPgwpCase
    ? generatePgwpDraft(caseItem, docs).missingDocuments
    : getMissingChecklistDocs(caseItem.formType, docs);
  const missingDocTitles = new Set(missingDocLabels.map((label) => `Missing document: ${label}`.toLowerCase()));

  for (const label of missingDocLabels) {
    addAutomationTask(store, {
      companyId: caseItem.companyId,
      caseId: caseItem.id,
      title: `Missing document: ${label}`,
      description: `Client must upload this required ${caseItem.formType} document before review/submission.`,
      assignedTo,
      priority: "high"
    });
  }

  store.tasks = store.tasks.map((t) => {
    if (t.companyId !== caseItem.companyId || t.caseId !== caseItem.id) return t;
    const isDocTask = t.title.toLowerCase().startsWith("missing document:");
    if (!isDocTask || t.status !== "pending") return t;
    if (missingDocTitles.has(t.title.toLowerCase())) return t;
    return { ...t, status: "completed" };
  });

  const missingIntake = isPgwpCase ? getMissingImm5710Questions(caseItem.pgwpIntake) : [];
  const readyForReview =
    missingDocLabels.length === 0 &&
    missingIntake.length === 0 &&
    Boolean(caseItem.retainerSigned) &&
    (caseItem.paymentStatus === "paid" || caseItem.paymentStatus === "not_required");

  if (readyForReview) {
    caseItem.aiStatus = "drafting";
    caseItem.stage = "Under Review";
    caseItem.caseStatus = "under_review";
    addAutomationTask(store, {
      companyId: caseItem.companyId,
      caseId: caseItem.id,
      title: "Human review gate: approve submission package",
      description: "AI precheck passed. Reviewer must verify package and approve submission readiness.",
      assignedTo: caseItem.reviewer && caseItem.reviewer !== "N/A" ? caseItem.reviewer : assignedTo,
      priority: "high"
    });
  }
}

function applyCaseAutomation(store: AppStore, caseItem: CaseItem) {
  evaluateCaseAutomation(store, caseItem);
  const assignedTo = caseItem.owner && caseItem.owner !== "N/A" ? caseItem.owner : "Unassigned";
  syncMissingIntakeTasksInStore(store, caseItem, assignedTo);
  syncMissingDocumentTasksInStore(store, caseItem, assignedTo);
  caseItem.updatedAt = new Date().toISOString();
}

export async function syncCaseAutomation(companyId: string, caseId: string): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === caseId);
  if (idx === -1) return null;
  applyCaseAutomation(store, store.cases[idx]);
  await writeStore(store);
  return store.cases[idx];
}

export async function signCaseRetainer(input: {
  companyId: string;
  caseId: string;
  signerName: string;
  signatureType: "initials" | "signature" | "typed";
  signatureValue: string;
  acceptedTerms: boolean;
}): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === input.companyId && c.id === input.caseId);
  if (idx === -1) return null;
  if (store.cases[idx].retainerSigned) return store.cases[idx];

  store.cases[idx] = {
    ...store.cases[idx],
    updatedAt: new Date().toISOString(),
    retainerSentAt: store.cases[idx].retainerSentAt || new Date().toISOString(),
    retainerSigned: true,
    retainerRecord: {
      signedAt: new Date().toISOString(),
      signerName: input.signerName,
      signatureType: input.signatureType,
      signatureValue: input.signatureValue,
      acceptedTerms: input.acceptedTerms
    }
  };
  await writeStore(store);
  return store.cases[idx];
}

export async function updateCaseRetainerSetup(
  companyId: string,
  id: string,
  patch: {
    formType?: string;
    retainerAmount?: number;
    paymentMethod?: "interac";
    interacRecipient?: string;
    interacInstructions?: string;
    sendRetainer?: boolean;
    paymentStatus?: "pending" | "paid" | "not_required";
  }
): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;
  const current = store.cases[idx];
  const currentPackage = current.servicePackage ?? {
    name: "Standard Service",
    retainerAmount: 0,
    balanceAmount: Number(current.balanceAmount || 0),
    milestones: []
  };

  const nextServicePackage = {
    ...currentPackage,
    retainerAmount:
      patch.retainerAmount !== undefined && !Number.isNaN(patch.retainerAmount)
        ? Number(patch.retainerAmount)
        : currentPackage.retainerAmount
  };

  const nextPaymentStatus = patch.paymentStatus ?? current.paymentStatus ?? "pending";
  const isSendingRetainer = Boolean(patch.sendRetainer);
  const fullAmount = Number(nextServicePackage.retainerAmount || 0);
  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    formType: patch.formType !== undefined && patch.formType.trim() ? patch.formType.trim() : current.formType,
    servicePackage: nextServicePackage,
    retainerSentAt: isSendingRetainer ? new Date().toISOString() : current.retainerSentAt,
    retainerSigned: isSendingRetainer ? false : current.retainerSigned,
    retainerRecord: isSendingRetainer ? undefined : current.retainerRecord,
    paymentMethod: patch.paymentMethod ?? current.paymentMethod ?? "interac",
    interacRecipient:
      patch.interacRecipient !== undefined ? patch.interacRecipient : current.interacRecipient,
    interacInstructions:
      patch.interacInstructions !== undefined ? patch.interacInstructions : current.interacInstructions,
    paymentStatus: nextPaymentStatus,
    paymentPaidAt:
      nextPaymentStatus === "paid"
        ? current.paymentPaidAt ?? new Date().toISOString()
        : nextPaymentStatus === "pending"
          ? undefined
          : current.paymentPaidAt,
    amountPaid:
      nextPaymentStatus === "paid"
        ? fullAmount
        : nextPaymentStatus === "pending" && isSendingRetainer
          ? 0
          : current.amountPaid ?? 0,
    balanceAmount:
      nextPaymentStatus === "paid"
        ? 0
        : nextPaymentStatus === "pending" && isSendingRetainer
          ? fullAmount
          : current.balanceAmount,
    stage: nextPaymentStatus === "paid" ? "Paid" : current.stage
  };

  applyCaseAutomation(store, store.cases[idx]);

  await writeStore(store);
  return store.cases[idx];
}

export async function updateCaseStage(companyId: string, id: string, stage: Stage): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;
  store.cases[idx] = { ...store.cases[idx], stage, updatedAt: new Date().toISOString() };
  applyCaseAutomation(store, store.cases[idx]);
  await writeStore(store);
  return store.cases[idx];
}

export async function updateCaseProcessing(
  companyId: string,
  id: string,
  patch: {
    assignedTo?: string;
    processingStatus?: "docs_pending" | "under_review" | "submitted" | "other";
    processingStatusOther?: string;
    paymentMethod?: "interac" | "cash" | "card" | "bank_transfer" | "other";
    applicationNumber?: string;
    submittedAt?: string;
    submissionDocumentUploadedAt?: string;
    finalOutcome?: "approved" | "refused" | "request_letter" | "withdrawn";
    decisionDate?: string;
    remarks?: string;
    // aiStatus reflects where the case is in the AI-driven intake / drafting
    // / review pipeline. Mutated by the WhatsApp intake bot when it advances
    // the session phase, by the rep-letter / forms generators when they hand
    // work back to humans, and by the assemble step when it ships a package.
    aiStatus?: AiStatus;
  }
): Promise<CaseItem | null> {
  return mutateStore(async (store) => {
  let idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  // Single-firm: cases can drift across company ids, which made processing
  // updates (incl. marking a case SUBMITTED) silently fail — the case never
  // left the active list. Fall back to a stable id match so the update lands.
  if (idx === -1) idx = store.cases.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const current = store.cases[idx];

  const nextStatus = patch.processingStatus ?? current.processingStatus ?? "docs_pending";
  const nextOther =
    nextStatus === "other"
      ? (patch.processingStatusOther ?? current.processingStatusOther ?? "").trim() || undefined
      : undefined;

  const nextStageFromProcessing =
    nextStatus === "submitted"
      ? "Submitted"
      : nextStatus === "under_review"
        ? "Under Review"
        : nextStatus === "docs_pending"
          ? "Assigned"
          : current.stage;

  store.cases[idx] = {
    ...current,
    assignedTo:
      patch.assignedTo !== undefined ? patch.assignedTo.trim() || "Unassigned" : current.assignedTo,
    processingStatus: nextStatus,
    processingStatusOther: nextOther,
    paymentMethod:
      patch.paymentMethod !== undefined
        ? patch.paymentMethod
        : current.paymentMethod,
    applicationNumber:
      patch.applicationNumber !== undefined
        ? patch.applicationNumber.trim() || undefined
        : current.applicationNumber,
    submittedAt:
      patch.submittedAt !== undefined
        ? patch.submittedAt.trim() || undefined
        : nextStatus === "submitted"
          ? current.submittedAt ?? new Date().toISOString()
          : current.submittedAt,
    submissionDocumentUploadedAt:
      patch.submissionDocumentUploadedAt !== undefined
        ? patch.submissionDocumentUploadedAt.trim() || undefined
        : current.submissionDocumentUploadedAt,
    finalOutcome: patch.finalOutcome !== undefined ? patch.finalOutcome : current.finalOutcome,
    decisionDate:
      patch.decisionDate !== undefined
        ? (patch.decisionDate.trim() || undefined)
        : current.decisionDate,
    remarks:
      patch.remarks !== undefined
        ? (patch.remarks.trim() || undefined)
        : current.remarks,
    aiStatus: patch.aiStatus !== undefined ? patch.aiStatus : current.aiStatus,
    stage: patch.finalOutcome ? "Decision" : nextStageFromProcessing,
    updatedAt: new Date().toISOString()
  };

  store.cases[idx].caseStatus = inferCaseStatusFromStage(store.cases[idx].stage);

  return store.cases[idx];
  });
}

export async function updateCaseFinancials(
  companyId: string,
  id: string,
  patch: Partial<CaseItem["servicePackage"]>
): Promise<CaseItem | null> {
  return mutateStore(async (store) => {
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;
  const current = store.cases[idx];
  const currentPackage = current.servicePackage ?? {
    name: "Standard Service",
    retainerAmount: 0,
    balanceAmount: Number(current.balanceAmount || 0),
    milestones: []
  };
  const nextPackage = {
    ...currentPackage,
    ...patch
  };
  const paid = Number(current.amountPaid || 0);
  const total = Number(nextPackage.retainerAmount || 0);
  const remaining = Math.max(0, total - paid);
  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    servicePackage: {
      ...nextPackage,
      balanceAmount: remaining
    },
    balanceAmount: remaining
  };
  return store.cases[idx];
  });
}

export async function recordCasePayment(companyId: string, id: string, amount: number): Promise<CaseItem | null> {
  return mutateStore(async (store) => {
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;
  const current = store.cases[idx];
  const currentPackage = current.servicePackage ?? {
    name: "Standard Service",
    retainerAmount: 0,
    balanceAmount: Number(current.balanceAmount || 0),
    milestones: []
  };
  const total = Number(currentPackage.retainerAmount || 0);
  const paidNow = Number.isFinite(Number(amount)) ? Math.max(0, Number(amount)) : 0;
  const prevPaid = Number(current.amountPaid || 0);
  // If total fee is not configured yet, still record payment and treat remaining as 0.
  // This prevents "payment not recording" for legacy/incomplete cases.
  const nextPaid =
    total > 0 ? Math.max(0, Math.min(total, prevPaid + paidNow)) : Math.max(0, prevPaid + paidNow);
  const remaining = total > 0 ? Math.max(0, total - nextPaid) : 0;
  const nextTotal = total > 0 ? total : nextPaid;

  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    amountPaid: nextPaid,
    balanceAmount: remaining,
    paymentStatus: remaining <= 0 ? "paid" : "pending",
    paymentPaidAt: remaining <= 0 ? current.paymentPaidAt ?? new Date().toISOString() : current.paymentPaidAt,
    servicePackage: {
      ...currentPackage,
      retainerAmount: nextTotal,
      balanceAmount: remaining
    }
  };
  return store.cases[idx];
  });
}

export async function updateCaseLinks(
  companyId: string,
  id: string,
  patch: Partial<
    Pick<
      CaseItem,
      "questionnaireLink" | "docsUploadLink" | "applicationFormsLink" | "submittedFolderLink" | "correspondenceFolderLink"
    > & { intakeSheetId?: string; intakeSheetUrl?: string }
  >
): Promise<CaseItem | null> {
  return mutateStore(async (store) => {
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;
  const current = store.cases[idx];
  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    questionnaireLink:
      patch.questionnaireLink !== undefined ? String(patch.questionnaireLink) : current.questionnaireLink,
    docsUploadLink: patch.docsUploadLink !== undefined ? String(patch.docsUploadLink) : current.docsUploadLink,
    applicationFormsLink:
      patch.applicationFormsLink !== undefined ? String(patch.applicationFormsLink) : current.applicationFormsLink,
    submittedFolderLink:
      patch.submittedFolderLink !== undefined ? String(patch.submittedFolderLink) : current.submittedFolderLink,
    correspondenceFolderLink:
      patch.correspondenceFolderLink !== undefined
        ? String(patch.correspondenceFolderLink)
        : current.correspondenceFolderLink,
    // Intake sheet tracking (extends the base model via spread)
    ...((patch as any).intakeSheetId !== undefined ? { intakeSheetId: String((patch as any).intakeSheetId) } : {}),
    ...((patch as any).intakeSheetUrl !== undefined ? { intakeSheetUrl: String((patch as any).intakeSheetUrl) } : {}),
  };
  return store.cases[idx];
  });
}

export async function addCaseMilestone(
  companyId: string,
  id: string,
  title: string
): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;
  const current = store.cases[idx];
  const currentPackage = current.servicePackage ?? {
    name: "Standard Service",
    retainerAmount: 0,
    balanceAmount: Number(current.balanceAmount || 0),
    milestones: []
  };
  const milestone = {
    id: `MS-${currentPackage.milestones.length + 1}`,
    title,
    done: false
  };
  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    servicePackage: {
      ...currentPackage,
      milestones: [...currentPackage.milestones, milestone]
    }
  };
  await writeStore(store);
  return store.cases[idx];
}

export async function toggleMilestone(
  companyId: string,
  id: string,
  milestoneId: string
): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;
  const current = store.cases[idx];
  const currentPackage = current.servicePackage ?? {
    name: "Standard Service",
    retainerAmount: 0,
    balanceAmount: Number(current.balanceAmount || 0),
    milestones: []
  };
  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    servicePackage: {
      ...currentPackage,
      milestones: currentPackage.milestones.map((m) =>
        m.id === milestoneId ? { ...m, done: !m.done } : m
      )
    }
  };
  await writeStore(store);
  return store.cases[idx];
}

export async function addInvoice(
  companyId: string,
  id: string,
  title: string,
  amount: number
): Promise<CaseItem | null> {
  return mutateStore(async (store) => {
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;
  const current = store.cases[idx];
  const currentPackage = current.servicePackage ?? {
    name: "Standard Service",
    retainerAmount: 0,
    balanceAmount: Number(current.balanceAmount || 0),
    milestones: []
  };
  const currentInvoices = current.invoices ?? [];
  const invoice = {
    // Unique ID — the old `INV-(length+1)` scheme collided when invoices were
    // added concurrently or after one was removed (two invoices, same number).
    id: `INV-${randomUUID().slice(0, 8).toUpperCase()}`,
    title,
    amount,
    status: "sent" as const,
    createdAt: new Date().toISOString()
  };
  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    invoices: [...currentInvoices, invoice],
    servicePackage: {
      ...currentPackage,
      balanceAmount: Number(currentPackage.balanceAmount || 0) + amount
    },
    balanceAmount: Number(current.balanceAmount || 0) + amount
  };
  return store.cases[idx];
  });
}

// Update a user's email in place. Match by exact name OR by current email
// (case-insensitive). Returns the updated user, or null if no match.
export async function updateUserEmail(args: {
  companyId: string;
  name?: string;
  currentEmail?: string;
  newEmail: string;
}): Promise<AppUser | null> {
  const store = await readStore();
  const targetName = String(args.name || "").trim().toLowerCase();
  const targetEmail = String(args.currentEmail || "").trim().toLowerCase();
  const newEmail = String(args.newEmail || "").trim();
  if (!newEmail || !/@/.test(newEmail)) return null;
  const idx = store.users.findIndex((u) => {
    if (u.companyId !== args.companyId) return false;
    if (targetName && String(u.name).trim().toLowerCase() === targetName) return true;
    if (targetEmail && String(u.email).trim().toLowerCase() === targetEmail) return true;
    return false;
  });
  if (idx === -1) return null;
  store.users[idx] = { ...store.users[idx], email: newEmail };
  await writeStore(store);
  return store.users[idx];
}

// Reassign many cases in ONE store write (vs. one heavy mutation + sheet sync
// per case). Used for bulk team rebalancing. Matches by case id only (single
// firm). Returns how many landed.
export async function bulkReassignCases(
  assignments: Array<{ caseId: string; assignTo: string }>
): Promise<{ updated: number; notFound: string[] }> {
  const want = new Map(
    assignments.map((a) => [String(a.caseId), String(a.assignTo || "").trim() || "Unassigned"])
  );
  return mutateStore((store) => {
    let updated = 0;
    const notFound: string[] = [];
    for (const [caseId, assignTo] of want) {
      const idx = store.cases.findIndex((c) => c.id === caseId);
      if (idx === -1) { notFound.push(caseId); continue; }
      store.cases[idx] = { ...store.cases[idx], assignedTo: assignTo, updatedAt: new Date().toISOString() };
      updated++;
    }
    return { updated, notFound };
  });
}

export async function updateUserRole(args: {
  companyId: string; userId: string; newRole: Role;
}): Promise<AppUser | null> {
  const allowed: Role[] = ["Admin", "Marketing", "Processing", "ProcessingLead", "Reviewer"];
  if (!allowed.includes(args.newRole)) return null;
  return mutateStore((store) => {
    let idx = store.users.findIndex(
      (u) => u.companyId === args.companyId && u.id === args.userId && u.userType === "staff"
    );
    // Single-firm deployment: staff accounts can drift across company ids
    // ("CMP-1" vs "newton"), which made role changes fail for the drifted ones.
    // Fall back to a stable id match so the update always lands.
    if (idx === -1) {
      idx = store.users.findIndex((u) => u.id === args.userId && u.userType === "staff");
    }
    if (idx === -1) return null;
    store.users[idx] = { ...store.users[idx], role: args.newRole };
    return store.users[idx];
  });
}

export async function listUsers(companyId: string): Promise<AppUser[]> {
  const store = await readStore();
  return store.users.filter((u) => u.companyId === companyId && u.userType === "staff");
}

// All staff regardless of company id. Single-firm features (review-comment
// recipients, performance dashboard) must not miss a teammate just because
// their account drifted to a different company id ("CMP-1" vs "newton").
export async function listAllStaff(): Promise<AppUser[]> {
  const store = await readStore();
  return store.users.filter((u) => u.userType === "staff");
}

// All cases regardless of company id (single-firm aggregations like the
// performance dashboard that map a case → its assigned preparer).
export async function listAllCases(): Promise<CaseItem[]> {
  const store = await readStore();
  return store.cases.slice();
}

// When a team member is removed (deactivated), move every case still assigned to
// them to "Unassigned" so nothing is left orphaned under a removed name. Matches
// by display name (case/space-insensitive), company-agnostic. Returns the count.
export async function unassignCasesForUser(userName: string): Promise<number> {
  const norm = (s: unknown) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const target = norm(userName);
  if (!target) return 0;
  return mutateStore((store) => {
    let n = 0;
    for (const c of store.cases) {
      if (norm((c as any).assignedTo) === target) {
        (c as any).assignedTo = "Unassigned";
        n++;
      }
    }
    return n;
  });
}

export async function syncNewtonTeamUsers(companyId: string): Promise<{ created: number; updated: number }> {
  const store = await readStore();
  let created = 0;
  let updated = 0;
  for (const item of NEWTON_TEAM_MEMBERS) {
    const idx = store.users.findIndex(
      (u) => u.companyId === companyId && u.email.toLowerCase() === item.email.toLowerCase()
    );
    if (idx === -1) {
      const user: AppUser = {
        id: `USR-${store.users.length + 1}`,
        companyId,
        name: item.name,
        email: item.email,
        role: item.role,
        userType: "staff",
        active: true,
        password: await hashPassword(`Temp${Math.random().toString(36).slice(2, 10)}A1`),
        workspaceDriveLink: item.workspaceDriveLink,
        workspaceDriveFolderId: item.workspaceDriveFolderId
      };
      store.users.push(user);
      created += 1;
      continue;
    }
    const current = store.users[idx];
    store.users[idx] = {
      ...current,
      name: item.name,
      role: item.role,
      workspaceDriveLink: item.workspaceDriveLink,
      workspaceDriveFolderId: item.workspaceDriveFolderId
    };
    updated += 1;
  }
  await writeStore(store);
  return { created, updated };
}

export async function inviteUser(input: {
  companyId: string;
  name: string;
  email: string;
  role: AppUser["role"];
  password: string;
  workspaceDriveLink?: string;
  workspaceDriveFolderId?: string;
}): Promise<AppUser> {
  const store = await readStore();
  const existing = store.users.find((u) => u.email.toLowerCase() === input.email.toLowerCase());
  if (existing) throw new Error("Email already in use");

  const user: AppUser = {
    id: `USR-${store.users.length + 1}`,
    companyId: input.companyId,
    name: input.name,
    email: input.email,
    role: input.role,
    userType: "staff",
    active: true,
    password: await hashPassword(input.password),
    workspaceDriveLink: input.workspaceDriveLink,
    workspaceDriveFolderId: input.workspaceDriveFolderId
  };

  store.users.push(user);
  await writeStore(store);
  return user;
}

export async function resetUserPassword(companyId: string, userId: string, password: string): Promise<AppUser | null> {
  const store = await readStore();
  const idx = store.users.findIndex((u) => u.companyId === companyId && u.id === userId);
  if (idx === -1) return null;
  store.users[idx] = { ...store.users[idx], password: await hashPassword(password) };
  await writeStore(store);
  return store.users[idx];
}

export async function updateUserMfa(
  companyId: string,
  userId: string,
  patch: { mfaEnabled?: boolean; mfaSecret?: string; mfaLastVerifiedAt?: string }
): Promise<AppUser | null> {
  const store = await readStore();
  const idx = store.users.findIndex((u) => u.companyId === companyId && u.id === userId);
  if (idx === -1) return null;
  const current = store.users[idx];
  const nextEnabled = patch.mfaEnabled !== undefined ? Boolean(patch.mfaEnabled) : Boolean(current.mfaEnabled);
  store.users[idx] = {
    ...current,
    mfaEnabled: nextEnabled,
    mfaSecret: patch.mfaSecret !== undefined ? patch.mfaSecret : current.mfaSecret,
    mfaEnabledAt: nextEnabled ? (current.mfaEnabledAt || new Date().toISOString()) : undefined,
    mfaLastVerifiedAt: patch.mfaLastVerifiedAt ?? current.mfaLastVerifiedAt
  };
  await writeStore(store);
  return store.users[idx];
}

export async function getUserById(companyId: string, userId: string): Promise<AppUser | null> {
  const store = await readStore();
  return store.users.find((u) => u.companyId === companyId && u.id === userId) ?? null;
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const store = await readStore();
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  return store.users.find((u) => String(u.email || "").trim().toLowerCase() === normalized) ?? null;
}

export async function emergencyResetUserAccessByEmail(input: {
  email: string;
  password: string;
  clearMfa?: boolean;
  activate?: boolean;
}): Promise<AppUser | null> {
  const store = await readStore();
  const normalized = String(input.email || "").trim().toLowerCase();
  const idx = store.users.findIndex((u) => String(u.email || "").trim().toLowerCase() === normalized);
  if (idx === -1) return null;
  const current = store.users[idx];
  const clearMfa = input.clearMfa !== false;
  const activate = input.activate !== false;
  store.users[idx] = {
    ...current,
    active: activate ? true : current.active,
    password: await hashPassword(input.password),
    mfaEnabled: clearMfa ? false : current.mfaEnabled,
    mfaSecret: clearMfa ? undefined : current.mfaSecret,
    mfaEnabledAt: clearMfa ? undefined : current.mfaEnabledAt,
    mfaLastVerifiedAt: clearMfa ? undefined : current.mfaLastVerifiedAt
  };
  await writeStore(store);
  return store.users[idx];
}

export async function setUserActive(
  companyId: string,
  userId: string,
  active: boolean
): Promise<AppUser | null> {
  const store = await readStore();
  const idx = store.users.findIndex((u) => u.companyId === companyId && u.id === userId);
  if (idx === -1) return null;
  store.users[idx] = { ...store.users[idx], active: Boolean(active) };
  await writeStore(store);
  return store.users[idx];
}

export async function addStaffNote(
  companyId: string,
  targetUserId: string,
  note: { authorId: string; authorName: string; text: string }
): Promise<AppUser | null> {
  const store = await readStore();
  const idx = store.users.findIndex((u) => u.companyId === companyId && u.id === targetUserId);
  if (idx === -1) return null;
  const newNote = {
    id: `NOTE-${randomUUID()}`,
    authorId: note.authorId,
    authorName: note.authorName,
    text: note.text,
    createdAt: new Date().toISOString(),
    pinned: false,
  };
  store.users[idx] = {
    ...store.users[idx],
    staffNotes: [...(store.users[idx].staffNotes || []), newNote],
  };
  await writeStore(store);
  return store.users[idx];
}

export async function deleteStaffNote(
  companyId: string,
  targetUserId: string,
  noteId: string
): Promise<AppUser | null> {
  const store = await readStore();
  const idx = store.users.findIndex((u) => u.companyId === companyId && u.id === targetUserId);
  if (idx === -1) return null;
  store.users[idx] = {
    ...store.users[idx],
    staffNotes: (store.users[idx].staffNotes || []).filter((n) => n.id !== noteId),
  };
  await writeStore(store);
  return store.users[idx];
}

export async function listMessages(companyId: string, caseId: string): Promise<MessageItem[]> {
  // Merge the case_messages table (primary store) with any messages still in the
  // JSON blob (pre-migration / file-mode fallback). Dedupe by id, sort ascending.
  const fromTable: MessageItem[] = isPostgresBackendEnabled()
    ? await listCaseMessagesFromTable(companyId, caseId).catch(() => []) as MessageItem[]
    : [];
  const store = await readStore();
  const fromStore = store.messages.filter((m) => m.companyId === companyId && m.caseId === caseId);
  const byId = new Map<string, MessageItem>();
  for (const m of [...fromTable, ...fromStore]) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addMessage(input: {
  companyId: string;
  caseId: string;
  senderType: MessageItem["senderType"];
  senderName: string;
  text: string;
}): Promise<MessageItem> {
  const message: MessageItem = {
    id: `MSG-${randomUUID().slice(0, 8)}`,
    companyId: input.companyId,
    caseId: input.caseId,
    senderType: input.senderType,
    senderName: input.senderName,
    text: input.text,
    createdAt: new Date().toISOString()
  };
  // Messages go to their own table (out of the hot JSON blob). If the table
  // write fails, fall back to the store so a message is never lost.
  if (isPostgresBackendEnabled()) {
    try {
      await insertCaseMessageRow(message as any);
      return message;
    } catch (e) {
      console.error("case_messages insert failed, falling back to store:", (e as Error).message);
    }
  }
  return mutateStore((store) => {
    store.messages.push(message);
    return message;
  });
}

export async function listOutboundMessages(companyId: string, caseId: string): Promise<OutboundMessageItem[]> {
  const store = await readStore();
  return store.outboundMessages
    .filter((m) => m.companyId === companyId && m.caseId === caseId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addOutboundMessage(input: {
  companyId: string;
  caseId: string;
  channel: OutboundMessageItem["channel"];
  status: OutboundMessageItem["status"];
  target?: string;
  message: string;
  createdByUserId: string;
  createdByName: string;
}): Promise<OutboundMessageItem> {
  return mutateStore((store) => {
    const item: OutboundMessageItem = {
      id: `OUT-${randomUUID().slice(0, 8)}`,
      companyId: input.companyId,
      caseId: input.caseId,
      channel: input.channel,
      status: input.status,
      target: input.target,
      message: input.message,
      createdByUserId: input.createdByUserId,
      createdByName: input.createdByName,
      createdAt: new Date().toISOString()
    };
    store.outboundMessages.push(item);
    return item;
  });
}

export async function listDocuments(companyId: string, caseId: string): Promise<DocumentItem[]> {
  const store = await readStore();
  return store.documents
    .filter((d) => d.companyId === companyId && d.caseId === caseId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Company-agnostic: every document grouped by caseId. Used by the case-agent so
// it can assess all cases in one store read instead of one lookup per case.
export async function listAllDocumentsByCase(): Promise<Map<string, DocumentItem[]>> {
  const store = await readStore();
  const map = new Map<string, DocumentItem[]>();
  for (const d of store.documents) {
    const arr = map.get(d.caseId) || [];
    arr.push(d);
    map.set(d.caseId, arr);
  }
  return map;
}

export async function addDocument(input: {
  companyId: string;
  caseId: string;
  name: string;
  category?: "general" | "result";
  status: DocumentItem["status"];
  link: string;
  // Stable identity of the source (e.g. WhatsApp Meta message.id "wamid…").
  // When provided, addDocument is IDEMPOTENT on (companyId, caseId, sourceMsgId):
  // a redelivered/retried webhook for the same media returns the existing record
  // instead of inserting a duplicate. This is the durable backstop that stops
  // the "one upload became 87 documents" bug even if the webhook is reprocessed.
  sourceMsgId?: string;
}): Promise<DocumentItem> {
  return mutateStore((store) => {
    const srcId = String(input.sourceMsgId || "").trim();
    if (srcId) {
      const existing = store.documents.find(
        (d) =>
          d.companyId === input.companyId &&
          d.caseId === input.caseId &&
          String((d as { sourceMsgId?: string }).sourceMsgId || "") === srcId
      );
      if (existing) return existing; // already saved this exact message — no duplicate
    }
    const doc: DocumentItem = {
      id: `DOC-${randomUUID().slice(0, 8)}`,
      companyId: input.companyId,
      caseId: input.caseId,
      name: input.name,
      category: input.category ?? "general",
      status: input.status,
      link: input.link,
      createdAt: new Date().toISOString(),
      ...(srcId ? { sourceMsgId: srcId } : {}),
    } as DocumentItem;
    store.documents.push(doc);
    const caseIdx = store.cases.findIndex((c) => c.companyId === input.companyId && c.id === input.caseId);
    if (caseIdx !== -1) {
      store.cases[caseIdx] = { ...store.cases[caseIdx], updatedAt: new Date().toISOString() };
      applyCaseAutomation(store, store.cases[caseIdx]);
    }
    return doc;
  });
}

export async function listLegacyResults(companyId: string): Promise<LegacyResultItem[]> {
  const store = await readStore();
  return store.legacyResults
    .filter((r) => r.companyId === companyId)
    .sort((a, b) => `${b.resultDate}T${b.createdAt}`.localeCompare(`${a.resultDate}T${a.createdAt}`));
}

// Wipe the historical/bulk-uploaded results for a company so the Results screen
// can start fresh (used when going live and sending only from the CRM going
// forward). Returns how many were removed. Company-agnostic-safe: only removes
// rows whose companyId matches, leaving any other tenant's data intact.
export async function clearLegacyResults(companyId: string): Promise<number> {
  return mutateStore(async (store) => {
    const before = store.legacyResults.length;
    store.legacyResults = store.legacyResults.filter((r) => r.companyId !== companyId);
    return before - store.legacyResults.length;
  });
}

export async function addLegacyResult(input: {
  companyId: string;
  entryType?: "result" | "submission";
  clientName: string;
  phone?: string;
  applicationNumber: string;
  resultDate?: string;
  outcome: LegacyResultItem["outcome"];
  notes?: string;
  fileName?: string;
  fileLink?: string;
  forceMatchedCaseId?: string;
  createdByUserId: string;
  createdByName: string;
}): Promise<LegacyResultItem> {
  const store = await readStore();
  const appNo = String(input.applicationNumber || "").trim().toLowerCase();
  const forcedCase =
    input.forceMatchedCaseId
      ? store.cases.find(
          (c) => c.companyId === input.companyId && c.id === input.forceMatchedCaseId
        ) ?? null
      : null;
  // Normalize app number for matching - remove spaces, lowercase
  const normalizeApp = (v: string) => String(v || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const appNoNorm = normalizeApp(appNo);

  // Match by application number first (exact normalized match)
  const matchByAppNo = appNoNorm
    ? store.cases.find(
        (c) =>
          c.companyId === input.companyId &&
          normalizeApp(String(c.applicationNumber || "")) === appNoNorm
      ) ?? null
    : null;

  // Also try submitted apps lookup for phone if missing
  let lookupPhone = String(input.phone || "").trim();
  if (!lookupPhone && appNoNorm) {
    const sub = SUBMITTED_APPS.find(a => normalizeApp(a.appNum) === appNoNorm);
    if (sub?.phone) lookupPhone = sub.phone;
  }

  // Match by PHONE second — a phone number is a real, unique identifier (names
  // collide, phones don't). Compare on the last 10 digits so country-code /
  // formatting differences (+1, spaces, dashes) don't cause a miss. Only used
  // when the app-number match didn't already nail it.
  const phoneDigits = (v: string) => String(v || "").replace(/\D/g, "");
  const inputPhoneTail = phoneDigits(lookupPhone).slice(-10);
  const matchByPhone = !matchByAppNo && inputPhoneTail.length >= 10
    ? store.cases.find(
        (c) =>
          c.companyId === input.companyId &&
          phoneDigits(String(c.leadPhone || "")).slice(-10) === inputPhoneTail
      ) ?? null
    : null;

  // Fallback: match by client name. Loose substring matching ("includes") +
  // first()-match used to grab the WRONG/older case for common names. Now: collect
  // candidates, prefer an EXACT full-name match, and among ties pick the MOST
  // RECENT case (by updatedAt/createdAt) — never an arbitrary old one. Substring
  // matching removed.
  const inputName = String(input.clientName || "").trim().toLowerCase().replace(/\s+/g, " ");
  const inputFirstName = inputName.split(" ")[0];
  let matchByName: CaseItem | null = null;
  if (!matchByAppNo && !matchByPhone && inputName.length > 2) {
    const mostRecent = (list: CaseItem[]) =>
      list.slice().sort((a, b) =>
        String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))
      )[0] ?? null;
    const sameCompany = store.cases.filter((c) => c.companyId === input.companyId);
    const exact = sameCompany.filter(
      (c) => String(c.client || "").trim().toLowerCase().replace(/\s+/g, " ") === inputName
    );
    if (exact.length) {
      matchByName = mostRecent(exact);
    } else if (inputFirstName.length > 3) {
      const byFirst = sameCompany.filter(
        (c) => String(c.client || "").trim().toLowerCase().replace(/\s+/g, " ").split(" ")[0] === inputFirstName
      );
      matchByName = mostRecent(byFirst);
    }
  }

  const matchedCase = forcedCase ?? matchByAppNo ?? matchByPhone ?? matchByName ?? null;

  // If we matched by name and have an app number, save it to the case
  if (matchByName && appNo && !matchByName.applicationNumber) {
    matchByName.applicationNumber = input.applicationNumber;
  }

  // Look up phone + name from submitted apps database table
  let resolvedPhone = String(input.phone || "").trim();
  let resolvedClientName = String(input.clientName || "").trim();
  if (!resolvedPhone && appNoNorm) {
    try {
      // Use shared pool - creating a new Pool per call and end()-ing it leaks
      // connections if the query throws before end() runs. Shared pool (max=5)
      // is process-lifetime; do NOT call .end() on it.
      const _pool = getSharedPool();
      const res = await _pool.query(
        `SELECT name, phone FROM submitted_apps_lookup WHERE app_num = $1`,
        [appNoNorm]
      );
      if (res.rows.length && res.rows[0].phone) {
        resolvedPhone = res.rows[0].phone;
        if (!resolvedClientName || resolvedClientName === "Legacy Client") {
          resolvedClientName = res.rows[0].name || resolvedClientName;
        }
      }
      // Note: shared pool is process-lifetime; no .end() per-call.
    } catch { /* table may not exist yet */ }
  }


  const matchedClient = matchedCase
    ? store.clients.find((c) => c.companyId === input.companyId && c.id === matchedCase.clientId)
    : undefined;
  const resultDate = String(input.resultDate || "").trim() || new Date().toISOString().slice(0, 10);
  const autoCategory: LegacyResultItem["autoCategory"] = matchedCase ? "new" : "old";

  const item: LegacyResultItem = {
    id: `LRES-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    companyId: input.companyId,
    entryType: input.entryType || "result",
    clientName: resolvedClientName || matchedCase?.client || "Legacy Client",
    phone: String(input.phone || "").trim() || lookupPhone || matchedCase?.leadPhone || matchedClient?.phone || undefined,
    applicationNumber: String(input.applicationNumber || "").trim(),
    resultDate,
    autoCategory,
    outcome: input.outcome,
    notes: String(input.notes || "").trim() || undefined,
    fileName: String(input.fileName || "").trim() || undefined,
    fileLink: String(input.fileLink || "").trim() || undefined,
    matchedCaseId: matchedCase?.id,
    matchedClientId: matchedClient?.id,
    informedToClient: false,
    informedAt: undefined,
    informedByName: undefined,
    createdByUserId: input.createdByUserId,
    createdByName: input.createdByName,
    createdAt: new Date().toISOString()
  };
  store.legacyResults.unshift(item);
  await writeStore(store);
  return item;
}

export async function markLegacyResultInformed(input: {
  companyId: string;
  resultId: string;
  informedByName: string;
}): Promise<LegacyResultItem | null> {
  const store = await readStore();
  const idx = store.legacyResults.findIndex(
    (r) => r.companyId === input.companyId && r.id === input.resultId
  );
  if (idx === -1) return null;
  store.legacyResults[idx] = {
    ...store.legacyResults[idx],
    informedToClient: true,
    informedAt: new Date().toISOString(),
    informedByName: input.informedByName
  };
  await writeStore(store);
  return store.legacyResults[idx];
}

export async function listCaseDocRequests(companyId: string, caseId: string): Promise<NonNullable<CaseItem["docRequests"]>> {
  const store = await readStore();
  const found = store.cases.find((c) => c.companyId === companyId && c.id === caseId);
  if (!found) return [];
  return (found.docRequests ?? []).slice().sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function addCaseDocRequest(input: {
  companyId: string;
  caseId: string;
  title: string;
  details?: string;
  requestedBy: string;
}): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === input.companyId && c.id === input.caseId);
  if (idx === -1) return null;
  const current = store.cases[idx];
  const request = {
    id: `DRQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    title: input.title.trim(),
    details: String(input.details || "").trim() || undefined,
    status: "open" as const,
    requestedBy: input.requestedBy,
    requestedAt: new Date().toISOString()
  };
  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    docRequests: [request, ...(current.docRequests ?? [])]
  };
  await writeStore(store);
  return store.cases[idx];
}

export async function fulfillCaseDocRequest(input: {
  companyId: string;
  caseId: string;
  requestId: string;
  fulfilledBy: string;
  documentId?: string;
}): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === input.companyId && c.id === input.caseId);
  if (idx === -1) return null;
  const current = store.cases[idx];
  const nextRequests = (current.docRequests ?? []).map((req) =>
    req.id === input.requestId
      ? {
          ...req,
          status: "fulfilled" as const,
          fulfilledAt: new Date().toISOString(),
          fulfilledBy: input.fulfilledBy,
          documentId: input.documentId ?? req.documentId
        }
      : req
  );
  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    docRequests: nextRequests
  };
  await writeStore(store);
  return store.cases[idx];
}

export async function listTasks(companyId: string, caseId?: string): Promise<TaskItem[]> {
  const store = await readStore();
  // Single-firm deployment: match by caseId only (companyId intentionally not
  // enforced). Staff/cases drifted between "CMP-1" and "newton", which hid tasks
  // from teammates whose account carried the other id. caseId/assignment is the
  // real scope here.
  return store.tasks
    .filter((t) => (!caseId || t.caseId === caseId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addTask(input: {
  companyId: string;
  caseId: string;
  title: string;
  description?: string;
  assignedTo?: string;
  createdBy?: "ai" | "admin";
  priority?: "low" | "medium" | "high";
  dueDate?: string;
}): Promise<TaskItem> {
  return mutateStore((store) => {
  const normalizedCaseId = String(input.caseId || "").trim() || "GENERAL";
  const task: TaskItem = {
    id: `TSK-${randomUUID().slice(0, 8)}`,
    companyId: input.companyId,
    caseId: normalizedCaseId,
    title: input.title.trim(),
    description: String(input.description || "").trim(),
    assignedTo: String(input.assignedTo || "Unassigned").trim() || "Unassigned",
    createdBy: input.createdBy || "admin",
    priority: input.priority || "medium",
    status: "pending",
    dueDate: input.dueDate || undefined,
    createdAt: new Date().toISOString()
  };
  store.tasks.unshift(task);

  const assignedToLower = String(task.assignedTo || "").trim().toLowerCase();
  const assignedUser =
    assignedToLower && assignedToLower !== "unassigned"
      ? store.users.find(
          (u) =>
            u.companyId === input.companyId &&
            u.userType === "staff" &&
            String(u.name || "").trim().toLowerCase() === assignedToLower
        )
      : null;
  if (assignedUser) {
    addAutomationNotification(store, {
      companyId: input.companyId,
      userId: assignedUser.id,
      type: "ai_alert",
      message: `New task assigned: ${task.title} (${task.caseId}).${task.dueDate ? ` Due: ${task.dueDate}.` : ""}`
    });
  }

  const teamMailboxUser = store.users.find(
    (u) =>
      u.companyId === input.companyId &&
      u.userType === "staff" &&
      String(u.email || "").trim().toLowerCase() === "team.newtonimmigration@gmail.com"
  );
  if (teamMailboxUser) {
    addAutomationNotification(store, {
      companyId: input.companyId,
      userId: teamMailboxUser.id,
      type: "ai_alert",
      message: `Task alert: ${task.title} (${task.caseId}) assigned to ${task.assignedTo}.${task.dueDate ? ` Due: ${task.dueDate}.` : ""}`
    });
  }

  return task;
  });
}

export async function updateTaskStatus(
  companyId: string,
  taskId: string,
  status: "pending" | "completed"
): Promise<TaskItem | null> {
  return mutateStore((store) => {
  const idx = store.tasks.findIndex((t) => t.companyId === companyId && t.id === taskId);
  if (idx === -1) return null;
  store.tasks[idx] = { ...store.tasks[idx], status };

  if (status === "completed") {
    const task = store.tasks[idx];
    const caseIdx = store.cases.findIndex((c) => c.companyId === companyId && c.id === task.caseId);
    if (caseIdx !== -1) {
      const currentCase = store.cases[caseIdx];
      const title = (task.title || "").toLowerCase();
      if (title.includes("review application") || title.includes("human review gate")) {
        store.cases[caseIdx] = {
          ...currentCase,
          caseStatus: "ready",
          aiStatus: "completed",
          stage: mapCaseStatusToStage("ready")
        };

        const adminUser = store.users.find(
          (u) => u.companyId === companyId && u.userType === "staff" && u.role === "Admin"
        );
        if (adminUser) {
          addAutomationNotification(store, {
            companyId,
            userId: adminUser.id,
            type: "ai_alert",
            message: `${currentCase.id} moved to READY after review completion.`
          });
        }
      }
    }
  }

  return store.tasks[idx];
  });
}

export async function listNotifications(companyId: string, userId: string): Promise<NotificationItem[]> {
  const store = await readStore();
  // Match by userId only (not companyId). A notification is created with the
  // ACTOR's companyId but addressed to the recipient's userId; if their company
  // ids differ (the CMP-1/newton drift), a companyId filter hid the recipient's
  // own notifications. userId is globally unique, so this is the correct scope.
  const currentUser = store.users.find((u) => u.id === userId) || null;
  const saved = store.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const now = Date.now();
  const urgent = store.cases
    .filter((c) => c.companyId === companyId && c.isUrgent && c.deadlineDate)
    .map((c) => {
      const diffMs = new Date(String(c.deadlineDate)).getTime() - now;
      const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const dueText = days < 0 ? `${Math.abs(days)} day(s) overdue` : `${days} day(s) left`;
      return {
        id: `URG-${c.id}-${days}`,
        companyId,
        userId,
        type: "deadline" as const,
        message: `Urgent case ${c.id} (${c.client}) deadline: ${dueText}.`,
        read: false,
        createdAt: new Date().toISOString()
      } satisfies NotificationItem;
    })
    .filter((n) => !n.message.includes("NaN"));
  const permitExpiry = store.cases
    .filter((c) => c.companyId === companyId && c.permitExpiryDate)
    .map((c) => {
      const diffMs = new Date(String(c.permitExpiryDate)).getTime() - now;
      const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (Number.isNaN(days) || days > 30) return null;
      const dueText =
        days < 0
          ? `expired ${Math.abs(days)} day(s) ago`
          : days === 0
            ? "expires today"
            : `expires in ${days} day(s)`;
      return {
        id: `PRM-${c.id}-${days}`,
        companyId,
        userId,
        type: "deadline" as const,
        message: `Permit expiry alert: ${c.id} (${c.client}) ${dueText}.`,
        read: false,
        createdAt: new Date().toISOString()
      } satisfies NotificationItem;
    })
    .filter(Boolean) as NotificationItem[];
  const assignedTaskReminders = store.tasks
    .filter((t) => t.companyId === companyId && t.status === "pending" && t.dueDate)
    .filter((t) => {
      const assignedTo = String(t.assignedTo || "").trim().toLowerCase();
      const byName = assignedTo && currentUser ? assignedTo === String(currentUser.name || "").trim().toLowerCase() : false;
      const byTeamMailbox =
        currentUser && String(currentUser.email || "").trim().toLowerCase() === "team.newtonimmigration@gmail.com";
      return byName || byTeamMailbox;
    })
    .map((t) => {
      const diffMs = new Date(String(t.dueDate)).getTime() - now;
      const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (Number.isNaN(days) || days > 1) return null;
      const dueText = days < 0 ? `${Math.abs(days)} day(s) overdue` : days === 0 ? "due today" : `${days} day left`;
      return {
        id: `TSKDL-${t.id}-${userId}`,
        companyId,
        userId,
        type: "deadline" as const,
        message: `Task deadline alert: ${t.title} (${t.caseId}) is ${dueText}.`,
        read: false,
        createdAt: new Date().toISOString()
      } satisfies NotificationItem;
    })
    .filter(Boolean) as NotificationItem[];
  return [...permitExpiry, ...assignedTaskReminders, ...urgent, ...saved];
}

export async function markNotificationRead(companyId: string, userId: string, id: string): Promise<NotificationItem | null> {
  return mutateStore((store) => {
    const idx = store.notifications.findIndex((n) => n.companyId === companyId && n.userId === userId && n.id === id);
    if (idx === -1) return null;
    store.notifications[idx] = { ...store.notifications[idx], read: true };
    return store.notifications[idx];
  });
}

export async function addNotification(input: {
  companyId: string;
  userId: string;
  type: "deadline" | "missing_doc" | "ai_alert" | "review_comment";
  message: string;
  link?: string;
}): Promise<NotificationItem> {
  return mutateStore((store) => {
    const notice: NotificationItem = {
      id: `NTF-${randomUUID().slice(0, 8)}`,
      companyId: input.companyId,
      userId: input.userId,
      type: input.type as any,
      message: input.message,
      link: input.link,
      read: false,
      createdAt: new Date().toISOString()
    } as any;
    store.notifications.unshift(notice);
    return notice;
  });
}

// Add many notifications in ONE store write (for bulk reassignment etc.).
export async function addNotifications(items: Array<{
  companyId: string; userId: string;
  type: "deadline" | "missing_doc" | "ai_alert" | "review_comment";
  message: string; link?: string;
}>): Promise<number> {
  const valid = items.filter((i) => i.userId && i.message);
  if (valid.length === 0) return 0;
  await mutateStore((store) => {
    for (const i of valid) {
      store.notifications.unshift({
        id: `NTF-${randomUUID().slice(0, 8)}`,
        companyId: i.companyId, userId: i.userId, type: i.type as any,
        message: i.message, link: i.link, read: false, createdAt: new Date().toISOString(),
      } as any);
    }
    return store.notifications.length;
  });
  return valid.length;
}

export async function addAuditLog(input: {
  companyId: string;
  actorUserId: string;
  actorName: string;
  action: string;
  resourceType: AuditLog["resourceType"];
  resourceId: string;
  metadata?: Record<string, string>;
}): Promise<AuditLog> {
  const item: AuditLog = {
    id: `AUD-${Date.now()}-${randomUUID().slice(0, 8)}`,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata,
    createdAt: new Date().toISOString()
  };
  // Audit logs go to their own table (out of the hot JSON blob). If the table
  // write fails for any reason, fall back to the store so we never lose an audit
  // entry. Audit logging must never throw / block the underlying operation.
  if (isPostgresBackendEnabled()) {
    try {
      await insertAuditLogRow(item as any);
      return item;
    } catch (e) {
      console.error("audit log table insert failed, falling back to store:", (e as Error).message);
    }
  }
  return mutateStore((store) => {
    store.auditLogs.push(item);
    return item;
  });
}

export async function listAuditLogs(companyId: string, limit = 200): Promise<AuditLog[]> {
  const cap = Math.max(1, Math.min(1000, Number(limit) || 200));
  // Merge the table (primary store of audit history) with any logs still in the
  // JSON blob (pre-migration, or file-mode fallback). Dedupe by id.
  const fromTable: AuditLog[] = isPostgresBackendEnabled()
    ? await listAuditLogsFromTable(companyId, cap).catch(() => []) as AuditLog[]
    : [];
  const store = await readStore();
  const fromStore = store.auditLogs.filter((l) => l.companyId === companyId);
  const byId = new Map<string, AuditLog>();
  for (const l of [...fromTable, ...fromStore]) byId.set(l.id, l);
  return Array.from(byId.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, cap);
}

// ── Alert recipients (people pinged on important marketing-bot moments) ──
export async function listAlertRecipients(): Promise<AlertRecipient[]> {
  const store = await readStore();
  return (store.alertRecipients || []).slice().sort((a, b) => a.label.localeCompare(b.label));
}

export async function addAlertRecipient(input: { phone: string; label: string }): Promise<AlertRecipient | null> {
  const phone = String(input.phone || "").replace(/\D/g, "");
  if (phone.length < 10) return null;
  return mutateStore((store) => {
    if (!Array.isArray(store.alertRecipients)) store.alertRecipients = [];
    const existing = store.alertRecipients.find((r) => r.phone === phone);
    if (existing) {
      existing.active = true;
      existing.label = String(input.label || existing.label).trim() || existing.label;
      return existing;
    }
    const rec: AlertRecipient = {
      id: `ALR-${randomUUID().slice(0, 8)}`,
      phone,
      label: String(input.label || "").trim() || phone,
      active: true,
      createdAt: new Date().toISOString(),
    };
    store.alertRecipients.push(rec);
    return rec;
  });
}

export async function removeAlertRecipient(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const list = store.alertRecipients || [];
    const before = list.length;
    store.alertRecipients = list.filter((r) => r.id !== id);
    return store.alertRecipients.length < before;
  });
}

export async function updateCasePgwpIntake(
  companyId: string,
  id: string,
  patch: Partial<PgwpIntakeData>
): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;

  const current = store.cases[idx];

  // ── Defensive guard against accidental data wipes ──
  // If the caller is trying to write an empty/null patch when existing intake has
  // user-provided answers (q1, q2, ..., or any non-metadata key), refuse the write.
  // This prevents Vishal-style data loss where a code path accidentally wipes intake.
  // Metadata keys (whatsappSession, whatsappIntakePhase, etc.) don't count as "real answers".
  const METADATA_KEYS = new Set([
    "whatsappSession",
    "whatsappIntakePhase",
    "whatsappIntakeCompletedAt",
    "whatsappIntakeRecoveredAt",
    "whatsappIntakeRecoveryNote",
  ]);
  const existingIntake = (current.pgwpIntake ?? {}) as Record<string, unknown>;
  const hasRealAnswers = Object.keys(existingIntake).some(
    (k) => !METADATA_KEYS.has(k) && existingIntake[k] !== undefined && existingIntake[k] !== null && existingIntake[k] !== ""
  );
  const incomingHasRealAnswers = Object.keys(patch).some(
    (k) => !METADATA_KEYS.has(k) && (patch as Record<string, unknown>)[k] !== undefined && (patch as Record<string, unknown>)[k] !== null
  );
  if (hasRealAnswers && !incomingHasRealAnswers && Object.keys(patch).length > 0) {
    // Patch has only metadata, but existing intake has real answers — that's fine,
    // we're just updating metadata. The merge below preserves real answers.
    // No action needed; just don't blow away anything.
  }
  // The merge below ALWAYS preserves existing keys. We never replace pgwpIntake wholesale.

  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    pgwpIntake: {
      ...(current.pgwpIntake ?? {}),
      ...patch
    }
  };
  applyCaseAutomation(store, store.cases[idx]);
  await writeStore(store);

  // ── Drive backup hook ──
  // When intake is marked complete for the first time, kick off chat-to-PDF export.
  // Fire-and-forget — never blocks the API response.
  const wasComplete = (existingIntake.whatsappIntakePhase as string) === "complete";
  const isNowComplete = ((store.cases[idx].pgwpIntake as Record<string, unknown> | undefined)?.whatsappIntakePhase as string) === "complete";
  if (!wasComplete && isNowComplete) {
    // Fire-and-forget — backup runs async, errors logged but don't block return
    import("@/lib/chat-backup").then(({ backupChatToDrive }) => {
      backupChatToDrive(companyId, id).catch((e) => {
        console.error(`[chat-backup] Failed for case ${id}:`, e?.message || e);
      });
    }).catch(() => { /* module load fail — non-fatal */ });
  }

  return store.cases[idx];
}

export async function updateCaseImm5710Automation(
  companyId: string,
  id: string,
  patch: Partial<NonNullable<CaseItem["imm5710Automation"]>>
): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;

  const current = store.cases[idx];
  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    imm5710Automation: {
      status: "idle",
      ...(current.imm5710Automation ?? {}),
      ...patch
    }
  };
  await writeStore(store);
  return store.cases[idx];
}

// ─────────────────────────────────────────────────────────────────────────
// Web Forms & Reconsiderations
// Lightweight tracker for web forms (GCMS, status updates) and
// reconsideration requests. Each row is a free-form entry, optionally
// linked to a case but not required.
// ─────────────────────────────────────────────────────────────────────────

export async function listWebForms(companyId: string): Promise<WebFormEntry[]> {
  const store = await readStore();
  const rows = (store.webForms ?? []).filter((f) => f.companyId === companyId);
  return rows.sort((a, b) => (b.dateSubmitted || b.createdAt).localeCompare(a.dateSubmitted || a.createdAt));
}

export async function createWebForm(input: {
  companyId: string;
  clientName?: string;
  caseId?: string | null;
  formType?: string;
  dateSubmitted?: string;
  status?: "pending" | "done";
  link?: string;
  assignedTo?: string;
  notes?: string;
}): Promise<WebFormEntry> {
  const store = await readStore();
  const now = new Date().toISOString();
  const entry: WebFormEntry = {
    id: `WF-${randomUUID().slice(0, 8)}`,
    companyId: input.companyId,
    clientName: String(input.clientName || "").trim(),
    caseId: input.caseId || null,
    formType: String(input.formType || "").trim(),
    dateSubmitted: input.dateSubmitted || now.slice(0, 10),
    status: input.status === "done" ? "done" : "pending",
    link: input.link || "",
    assignedTo: input.assignedTo || "",
    notes: input.notes || "",
    createdAt: now,
    updatedAt: now,
  };
  if (!Array.isArray(store.webForms)) store.webForms = [];
  store.webForms.push(entry);
  await writeStore(store);
  return entry;
}

export async function updateWebForm(
  companyId: string,
  id: string,
  patch: Partial<Omit<WebFormEntry, "id" | "companyId" | "createdAt">>
): Promise<WebFormEntry | null> {
  const store = await readStore();
  if (!Array.isArray(store.webForms)) store.webForms = [];
  const idx = store.webForms.findIndex((f) => f.companyId === companyId && f.id === id);
  if (idx === -1) return null;
  store.webForms[idx] = {
    ...store.webForms[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
  return store.webForms[idx];
}

export async function deleteWebForm(companyId: string, id: string): Promise<boolean> {
  const store = await readStore();
  if (!Array.isArray(store.webForms)) return false;
  const before = store.webForms.length;
  store.webForms = store.webForms.filter((f) => !(f.companyId === companyId && f.id === id));
  if (store.webForms.length === before) return false;
  await writeStore(store);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// PR Consultations
// Standalone consultation records. Not cases — clients pay for a single
// consultation about PR/permanent residency. Rolls up to Accounting revenue.
// ─────────────────────────────────────────────────────────────────────────

export async function listPrConsultations(companyId: string): Promise<PrConsultationEntry[]> {
  const store = await readStore();
  const rows = (store.prConsultations ?? []).filter((c) => c.companyId === companyId);
  return rows.sort((a, b) => (b.consultationDate || b.createdAt).localeCompare(a.consultationDate || a.createdAt));
}

export async function createPrConsultation(input: {
  companyId: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  paymentAmount?: number;
  paymentReceived?: boolean;
  paymentMethod?: string;
  consultationDate?: string;
  consultant?: string;
  status?: "pending" | "done";
  notes?: string;
}): Promise<PrConsultationEntry> {
  const store = await readStore();
  const now = new Date().toISOString();
  const entry: PrConsultationEntry = {
    id: `PR-${randomUUID().slice(0, 8)}`,
    companyId: input.companyId,
    clientName: String(input.clientName || "").trim(),
    clientPhone: String(input.clientPhone || "").trim(),
    clientEmail: String(input.clientEmail || "").trim(),
    paymentAmount: Number(input.paymentAmount || 0),
    paymentReceived: input.paymentReceived === true,
    paymentMethod: String(input.paymentMethod || "").trim(),
    consultationDate: input.consultationDate || now.slice(0, 10),
    consultant: String(input.consultant || "").trim(),
    status: input.status === "done" ? "done" : "pending",
    notes: String(input.notes || "").trim(),
    createdAt: now,
    updatedAt: now,
  };
  if (!Array.isArray(store.prConsultations)) store.prConsultations = [];
  store.prConsultations.push(entry);
  await writeStore(store);
  return entry;
}

export async function updatePrConsultation(
  companyId: string,
  id: string,
  patch: Partial<Omit<PrConsultationEntry, "id" | "companyId" | "createdAt">>
): Promise<PrConsultationEntry | null> {
  const store = await readStore();
  if (!Array.isArray(store.prConsultations)) store.prConsultations = [];
  const idx = store.prConsultations.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;
  store.prConsultations[idx] = {
    ...store.prConsultations[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
  return store.prConsultations[idx];
}

export async function deletePrConsultation(companyId: string, id: string): Promise<boolean> {
  const store = await readStore();
  if (!Array.isArray(store.prConsultations)) return false;
  const before = store.prConsultations.length;
  store.prConsultations = store.prConsultations.filter((c) => !(c.companyId === companyId && c.id === id));
  if (store.prConsultations.length === before) return false;
  await writeStore(store);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Submission Log
// Tracks every IRCC submission. Rows can be created automatically when
// a case is marked "submitted" via the case workflow, or manually added
// by staff for legacy cases / cases handled outside the CRM.
// ─────────────────────────────────────────────────────────────────────────

export async function listSubmissions(companyId: string): Promise<SubmissionEntry[]> {
  const store = await readStore();
  const rows = (store.submissions ?? []).filter((s) => s.companyId === companyId);
  return rows.sort((a, b) => (b.submittedDate || b.createdAt).localeCompare(a.submittedDate || a.createdAt));
}

export async function createSubmission(input: {
  companyId: string;
  caseId?: string | null;
  clientName?: string;
  clientPhone?: string;
  appType?: string;
  submittedDate?: string;
  irccReference?: string;
  status?: SubmissionEntry["status"];
  notes?: string;
  submittedBy?: string;
}): Promise<SubmissionEntry> {
  const store = await readStore();
  const now = new Date().toISOString();
  const validStatuses: SubmissionEntry["status"][] = ["submitted", "aor_received", "decision_pending", "approved", "refused"];
  const status = validStatuses.includes(input.status as any) ? (input.status as SubmissionEntry["status"]) : "submitted";
  const entry: SubmissionEntry = {
    id: `SUB-${randomUUID().slice(0, 8)}`,
    companyId: input.companyId,
    caseId: input.caseId || null,
    clientName: String(input.clientName || "").trim(),
    clientPhone: String(input.clientPhone || "").trim(),
    appType: String(input.appType || "").trim(),
    submittedDate: input.submittedDate || now.slice(0, 10),
    irccReference: String(input.irccReference || "").trim(),
    status,
    notes: String(input.notes || "").trim(),
    submittedBy: String(input.submittedBy || "").trim(),
    createdAt: now,
    updatedAt: now,
  };
  if (!Array.isArray(store.submissions)) store.submissions = [];
  store.submissions.push(entry);
  await writeStore(store);
  return entry;
}

export async function updateSubmission(
  companyId: string,
  id: string,
  patch: Partial<Omit<SubmissionEntry, "id" | "companyId" | "createdAt">>
): Promise<SubmissionEntry | null> {
  const store = await readStore();
  if (!Array.isArray(store.submissions)) store.submissions = [];
  const idx = store.submissions.findIndex((s) => s.companyId === companyId && s.id === id);
  if (idx === -1) return null;
  store.submissions[idx] = {
    ...store.submissions[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
  return store.submissions[idx];
}

export async function deleteSubmission(companyId: string, id: string): Promise<boolean> {
  const store = await readStore();
  if (!Array.isArray(store.submissions)) return false;
  const before = store.submissions.length;
  store.submissions = store.submissions.filter((s) => !(s.companyId === companyId && s.id === id));
  if (store.submissions.length === before) return false;
  await writeStore(store);
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Post-ITA / PR milestone tracker (TrackerEntry).
// Lightweight manual sheet: appNumber + clientName + current stage.
// ─────────────────────────────────────────────────────────────────────
export async function listTrackers(companyId: string): Promise<TrackerEntry[]> {
  const store = await readStore();
  const rows = (store.trackers ?? []).filter((t) => t.companyId === companyId);
  // Active first (not archived), then most-recently-updated.
  return rows.sort((a, b) => {
    if (Boolean(a.archived) !== Boolean(b.archived)) return a.archived ? 1 : -1;
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
}

export async function createTracker(input: {
  companyId: string;
  applicationNumber?: string;
  clientName?: string;
  clientPhone?: string;
  applicationType?: string;
  stage?: string;
  nextStep?: string;
  notes?: string;
  caseId?: string | null;
  updatedBy?: string;
}): Promise<TrackerEntry> {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    if (!Array.isArray(store.trackers)) store.trackers = [];
    const entry: TrackerEntry = {
      id: `TRK-${randomUUID().slice(0, 8)}`,
      companyId: input.companyId,
      applicationNumber: String(input.applicationNumber || "").trim(),
      clientName: String(input.clientName || "").trim(),
      clientPhone: String(input.clientPhone || "").trim() || undefined,
      applicationType: String(input.applicationType || "Express Entry (PR)").trim(),
      stage: String(input.stage || "ITA Received").trim(),
      stageUpdatedAt: now,
      nextStep: String(input.nextStep || "").trim() || undefined,
      notes: String(input.notes || "").trim() || undefined,
      caseId: input.caseId || null,
      archived: false,
      updatedBy: String(input.updatedBy || "").trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    store.trackers.push(entry);
    return entry;
  });
}

export async function updateTracker(
  companyId: string,
  id: string,
  patch: Partial<Omit<TrackerEntry, "id" | "companyId" | "createdAt">>
): Promise<TrackerEntry | null> {
  return mutateStore((store) => {
    if (!Array.isArray(store.trackers)) store.trackers = [];
    const idx = store.trackers.findIndex((t) => t.companyId === companyId && t.id === id);
    if (idx === -1) return null;
    const prev = store.trackers[idx];
    // Stamp stageUpdatedAt only when the stage actually changes.
    const stageChanged = patch.stage !== undefined && patch.stage !== prev.stage;
    store.trackers[idx] = {
      ...prev,
      ...patch,
      stageUpdatedAt: stageChanged ? new Date().toISOString() : prev.stageUpdatedAt,
      updatedAt: new Date().toISOString(),
    };
    return store.trackers[idx];
  });
}

export async function deleteTracker(companyId: string, id: string): Promise<boolean> {
  return mutateStore((store) => {
    if (!Array.isArray(store.trackers)) return false;
    const before = store.trackers.length;
    store.trackers = store.trackers.filter((t) => !(t.companyId === companyId && t.id === id));
    return store.trackers.length !== before;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Delete a case + all related data (cascade).
//
// Cascade scope (everything in the JSON store that references caseId):
//   • cases — the case row itself
//   • messages — outbound + inbound conversation log
//   • outbound_messages — staff-sent WhatsApp messages
//   • tasks — to-dos created against this case
//   • submissions — submission row, if status was already "submitted"
//
// NOT touched here (in-store):
//   • google drive folder — preserved manually if needed (we never mass-
//     delete client docs from Drive — staff must do it intentionally)
//   • whatsapp_inbox table (PG) — separate database, kept so historical
//     conversations remain searchable by phone
//   • case_notes table (PG) — separate database, deleted by the route
//     handler in a separate query (not by this function — keeps store.ts
//     free of cross-database dependencies)
//   • marketing_leads table (PG) — kept for lead history; the route
//     handler resets converted_case_id pointer separately
//
// This is destructive and irreversible — caller MUST verify intent
// (admin role + double confirmation in the UI).
// ─────────────────────────────────────────────────────────────────────
export async function deleteCase(companyId: string, id: string): Promise<{
  ok: boolean;
  removed?: {
    case: boolean;
    messages: number;
    outboundMessages: number;
    tasks: number;
    submissions: number;
  };
}> {
  const store = await readStore();
  const caseIdx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (caseIdx === -1) {
    return { ok: false };
  }

  // Count + remove cascade tables
  const before = {
    messages: (store.messages || []).filter(m => m.companyId === companyId && m.caseId === id).length,
    outboundMessages: (store.outboundMessages || []).filter(m => m.companyId === companyId && m.caseId === id).length,
    tasks: (store.tasks || []).filter(t => t.companyId === companyId && t.caseId === id).length,
    submissions: (store.submissions || []).filter(s => s.companyId === companyId && s.caseId === id).length,
  };

  store.cases.splice(caseIdx, 1);
  store.messages = (store.messages || []).filter(m => !(m.companyId === companyId && m.caseId === id));
  store.outboundMessages = (store.outboundMessages || []).filter(m => !(m.companyId === companyId && m.caseId === id));
  store.tasks = (store.tasks || []).filter(t => !(t.companyId === companyId && t.caseId === id));
  if (Array.isArray(store.submissions)) {
    store.submissions = store.submissions.filter(s => !(s.companyId === companyId && s.caseId === id));
  }

  // Messages live in the case_messages table post-migration — clear them too,
  // and count them so the deletion summary reflects reality.
  let tableMsgCount = 0;
  if (isPostgresBackendEnabled()) {
    try {
      tableMsgCount = (await listCaseMessagesFromTable(companyId, id)).length;
      await deleteCaseMessagesFromTable(companyId, id);
    } catch (e) {
      console.error("deleteCase: case_messages cleanup failed:", (e as Error).message);
    }
  }

  await writeStore(store);
  return {
    ok: true,
    removed: {
      case: true,
      ...before,
      messages: before.messages + tableMsgCount,
    },
  };
}

// Auto-create submission row when a case status moves to "submitted".
// Idempotent: if a submission already exists for this caseId, returns the existing one
// (so we don't duplicate when staff toggles the status back and forth).
export async function autoCreateSubmissionFromCase(
  companyId: string,
  caseItem: { id: string; client?: string; leadPhone?: string; formType?: string; assignedTo?: string },
  options?: { irccReference?: string; submittedBy?: string }
): Promise<SubmissionEntry | null> {
  if (!caseItem?.id) return null;
  const store = await readStore();
  if (!Array.isArray(store.submissions)) store.submissions = [];
  // Check if already exists for this case
  const existing = store.submissions.find((s) => s.companyId === companyId && s.caseId === caseItem.id);
  if (existing) return existing;
  // Create new
  return await createSubmission({
    companyId,
    caseId: caseItem.id,
    clientName: caseItem.client || "",
    clientPhone: caseItem.leadPhone || "",
    appType: caseItem.formType || "",
    submittedDate: new Date().toISOString().slice(0, 10),
    irccReference: options?.irccReference || "",
    status: "submitted",
    submittedBy: options?.submittedBy || caseItem.assignedTo || "",
  });
}

// ─────────────────────────────────────────────────────────────────────────
// updateCaseProfile — edit the original case-creation fields after the fact.
// Used by the "Edit Case" mode in the New Case form. Only updates fields
// that are explicitly provided in the patch (others stay unchanged).
// ─────────────────────────────────────────────────────────────────────────
export async function updateCaseProfile(
  companyId: string,
  id: string,
  patch: {
    client?: string;
    formType?: string;
    leadPhone?: string;
    leadEmail?: string;
    totalCharges?: number;
    irccFees?: number;
    irccFeePayer?: "sir_card" | "client_card";
    familyMembers?: string;
    familyTotalCharges?: number;
    assignedTo?: string;
    additionalNotes?: string;
    isUrgent?: boolean;
    dueInDays?: number;
    permitExpiryDate?: string;
  }
): Promise<CaseItem | null> {
  const store = await readStore();
  const idx = store.cases.findIndex((c) => c.companyId === companyId && c.id === id);
  if (idx === -1) return null;
  const current = store.cases[idx];

  // Compute new servicePackage (preserves milestones, name, etc.)
  const currentPackage = current.servicePackage ?? {
    name: "Standard Service",
    retainerAmount: 0,
    balanceAmount: Number(current.balanceAmount || 0),
    milestones: [],
  };
  const nextServicePackage: any = { ...currentPackage };
  if (patch.totalCharges !== undefined) nextServicePackage.totalCharges = patch.totalCharges;
  if (patch.irccFees !== undefined) nextServicePackage.irccFees = patch.irccFees;
  if (patch.irccFeePayer !== undefined) nextServicePackage.irccFeePayer = patch.irccFeePayer;
  if (patch.familyTotalCharges !== undefined) nextServicePackage.familyTotalCharges = patch.familyTotalCharges;

  // If totalCharges was updated, reflect in retainerAmount + balance unless already paid
  if (patch.totalCharges !== undefined) {
    nextServicePackage.retainerAmount = patch.totalCharges;
    if (current.paymentStatus !== "paid") {
      nextServicePackage.balanceAmount = patch.totalCharges - Number(current.amountPaid || 0);
    }
  }

  store.cases[idx] = {
    ...current,
    updatedAt: new Date().toISOString(),
    client: patch.client !== undefined && patch.client.trim() ? patch.client.trim() : current.client,
    formType: patch.formType !== undefined && patch.formType.trim() ? patch.formType.trim() : current.formType,
    leadPhone: patch.leadPhone !== undefined ? patch.leadPhone : current.leadPhone,
    leadEmail: patch.leadEmail !== undefined ? patch.leadEmail : (current as any).leadEmail,
    assignedTo: patch.assignedTo !== undefined ? patch.assignedTo : current.assignedTo,
    servicePackage: nextServicePackage,
    familyMembers: patch.familyMembers !== undefined ? patch.familyMembers : (current as any).familyMembers,
    additionalNotes: patch.additionalNotes !== undefined ? patch.additionalNotes : (current as any).additionalNotes,
    isUrgent: patch.isUrgent !== undefined ? patch.isUrgent : (current as any).isUrgent,
    dueInDays: patch.dueInDays !== undefined ? patch.dueInDays : (current as any).dueInDays,
    permitExpiryDate: patch.permitExpiryDate !== undefined ? patch.permitExpiryDate : (current as any).permitExpiryDate,
  } as CaseItem;

  await writeStore(store);
  return store.cases[idx];
}
