import { Pool } from "pg";
import { AppStore } from "@/lib/models";

let pool: Pool | null = null;

export function getPool(): Pool {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for postgres data backend");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

export function isPostgresBackendEnabled() {
  return String(process.env.DATA_BACKEND || "file").toLowerCase() === "postgres";
}

async function ensureSnapshotTable() {
  const db = getPool();
  await db.query(`
    create table if not exists app_store_snapshots (
      id text primary key,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}

// ── AUTOMATED BACKUPS ──
// The entire app state lives in one app_store_snapshots row. If a bad write or
// corruption ever hits it, there's no undo. We keep a rolling history of
// snapshots in app_store_backups so any recent state can be restored. To avoid
// doubling write cost at bulk, backups are throttled to at most one per
// BACKUP_INTERVAL_MS (tracked in-process), and we keep only the newest
// BACKUP_KEEP rows. A cold start always captures one snapshot on first write,
// which conveniently records state right after each deploy.
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const BACKUP_KEEP = 72;                     // ~3 days of hourly snapshots
let lastBackupAt = 0;

async function ensureBackupTable() {
  const db = getPool();
  await db.query(`
    create table if not exists app_store_backups (
      id bigserial primary key,
      payload jsonb not null,
      created_at timestamptz not null default now()
    )
  `);
}

async function maybeBackupSnapshot(store: AppStore): Promise<void> {
  const now = Date.now();
  if (now - lastBackupAt < BACKUP_INTERVAL_MS) return;
  lastBackupAt = now;
  try {
    await ensureBackupTable();
    const db = getPool();
    await db.query(
      `insert into app_store_backups (payload) values ($1::jsonb)`,
      [JSON.stringify(store)]
    );
    // Prune to the newest BACKUP_KEEP rows.
    await db.query(
      `delete from app_store_backups
       where id not in (
         select id from app_store_backups order by created_at desc limit $1
       )`,
      [BACKUP_KEEP]
    );
  } catch (e) {
    // Backups are best-effort — never let a backup failure block a real write.
    console.error("Store backup failed (non-fatal):", (e as Error).message);
  }
}

export async function listStoreBackups(): Promise<Array<{ id: string; createdAt: string }>> {
  await ensureBackupTable();
  const db = getPool();
  const res = await db.query(
    `select id, created_at from app_store_backups order by created_at desc limit 100`
  );
  return res.rows.map((r: any) => ({ id: String(r.id), createdAt: toIso(r.created_at) }));
}

// Restore the live snapshot from a specific backup id. Returns the restored
// payload. DESTRUCTIVE — overwrites the current app_store_snapshots row, so it
// is only reachable from a guarded admin endpoint. Before overwriting, it takes
// a fresh backup of the current state so a mistaken restore is itself undoable.
export async function restoreStoreFromBackup(backupId: string): Promise<Partial<AppStore>> {
  await ensureBackupTable();
  const db = getPool();
  const res = await db.query(
    `select payload from app_store_backups where id = $1 limit 1`,
    [backupId]
  );
  if (!res.rowCount || !res.rows[0]?.payload) {
    throw new Error(`Backup ${backupId} not found`);
  }
  const payload = res.rows[0].payload as AppStore;
  // Snapshot current state first (force a backup regardless of throttle).
  lastBackupAt = 0;
  const current = await readStoreFromPostgres();
  await maybeBackupSnapshot(current as AppStore);
  // Overwrite the live snapshot.
  await db.query(
    `insert into app_store_snapshots (id, payload, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (id) do update set payload = excluded.payload, updated_at = now()`,
    ["global", JSON.stringify(payload)]
  );
  return payload as Partial<AppStore>;
}

function toIso(value: unknown) {
  const text = String(value || "");
  if (!text) return new Date().toISOString();
  const ts = new Date(text);
  return Number.isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString();
}

async function loadFromNormalizedTables(): Promise<Partial<AppStore>> {
  // Return empty store if normalized tables don't exist yet
  // The snapshot table is the primary storage
  return {};
  const db = getPool();
  const [
    companiesRes,
    usersRes,
    clientsRes,
    casesRes,
    messagesRes,
    outboundRes,
    documentsRes,
    clientCommsRes,
    auditRes,
    tasksRes,
    notificationsRes,
    sessionsRes,
    invitesRes
  ] = await Promise.all([
    db.query("select * from companies"),
    db.query("select * from users"),
    db.query("select * from clients"),
    db.query("select * from cases"),
    db.query("select * from messages"),
    db.query("select * from outbound_messages"),
    db.query("select * from documents"),
    db.query("select * from client_communications"),
    db.query("select * from audit_logs"),
    db.query("select * from tasks"),
    db.query("select * from notifications"),
    db.query("select * from sessions"),
    db.query("select * from invites")
  ]);

  return {
    companies: companiesRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      branding: r.branding || {},
      createdAt: toIso(r.created_at)
    })),
    users: usersRes.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      name: r.name,
      email: r.email,
      role: r.role,
      userType: r.user_type,
      active: r.active !== false,
      password: r.password_hash,
      mfaEnabled: Boolean(r.mfa_enabled),
      mfaSecret: r.mfa_secret || undefined,
      mfaEnabledAt: r.mfa_enabled_at ? toIso(r.mfa_enabled_at) : undefined,
      mfaLastVerifiedAt: r.mfa_last_verified_at ? toIso(r.mfa_last_verified_at) : undefined,
      workspaceDriveLink: r.workspace_drive_link || undefined,
      workspaceDriveFolderId: r.workspace_drive_folder_id || undefined,
      caseId: r.case_id || undefined
    })),
    clients: clientsRes.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      clientCode: r.client_code,
      fullName: r.full_name,
      phone: r.phone || undefined,
      email: r.email || undefined,
      assignedTo: r.assigned_to || undefined,
      internalFlags: r.internal_flags || {},
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at)
    })),
    cases: casesRes.rows.map((r) => {
      const payload = r.payload || {};
      return {
        ...payload,
        id: r.id,
        companyId: r.company_id,
        clientId: r.client_id || undefined,
        clientUserId: r.client_user_id || undefined,
        client: r.client_name,
        formType: r.form_type,
        assignedTo: r.assigned_to || undefined,
        owner: r.owner_name || payload.owner || "Unassigned",
        reviewer: r.reviewer_name || payload.reviewer || "Unassigned",
        stage: r.stage || payload.stage || "Lead",
        caseStatus: r.case_status || payload.caseStatus,
        aiStatus: r.ai_status || payload.aiStatus,
        leadPhone: r.lead_phone || payload.leadPhone,
        leadEmail: r.lead_email || payload.leadEmail,
        processingStatus: r.processing_status || payload.processingStatus,
        processingStatusOther: r.processing_status_other || payload.processingStatusOther,
        paymentStatus: r.payment_status || payload.paymentStatus,
        amountPaid: r.amount_paid !== null ? Number(r.amount_paid) : payload.amountPaid,
        balanceAmount: r.balance_amount !== null ? Number(r.balance_amount) : payload.balanceAmount,
        isUrgent: Boolean(r.is_urgent),
        deadlineDate: r.deadline_date || payload.deadlineDate,
        decisionDate: r.decision_date || payload.decisionDate,
        finalOutcome: r.final_outcome || payload.finalOutcome,
        remarks: r.remarks || payload.remarks,
        createdAt: toIso(r.created_at),
        updatedAt: toIso(r.updated_at)
      };
    }),
    messages: messagesRes.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      caseId: r.case_id,
      senderType: r.sender_type,
      senderName: r.sender_name,
      text: r.text,
      createdAt: toIso(r.created_at)
    })),
    outboundMessages: outboundRes.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      caseId: r.case_id,
      channel: r.channel,
      status: r.status,
      target: r.target || undefined,
      message: r.message,
      createdByUserId: r.created_by_user_id,
      createdByName: r.created_by_name,
      createdAt: toIso(r.created_at)
    })),
    documents: documentsRes.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      caseId: r.case_id,
      clientId: r.client_id || undefined,
      name: r.name,
      category: r.category || "general",
      fileType: r.file_type || undefined,
      version: Number(r.version || 1),
      versionGroupId: r.version_group_id || r.id,
      status: r.status,
      link: r.link,
      createdAt: toIso(r.created_at)
    })),
    clientCommunications: clientCommsRes.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      clientId: r.client_id,
      createdByUserId: r.created_by_user_id,
      createdByName: r.created_by_name,
      type: r.type,
      message: r.message,
      createdAt: toIso(r.created_at)
    })),
    auditLogs: auditRes.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      actorUserId: r.actor_user_id,
      actorName: r.actor_name,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      metadata: r.metadata || {},
      createdAt: toIso(r.created_at)
    })),
    tasks: tasksRes.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      caseId: r.case_id,
      title: r.title,
      description: r.description,
      assignedTo: r.assigned_to,
      createdBy: r.created_by,
      priority: r.priority,
      status: r.status,
      dueDate: r.due_date || undefined,
      createdAt: toIso(r.created_at)
    })),
    notifications: notificationsRes.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      userId: r.user_id,
      type: r.type,
      message: r.message,
      read: Boolean(r.read),
      createdAt: toIso(r.created_at)
    })),
    sessions: sessionsRes.rows.map((r) => ({
      token: r.token,
      userId: r.user_id,
      companyId: r.company_id,
      expiresAt: toIso(r.expires_at),
      ipAddress: r.ip_address || undefined,
      ipSubnet: r.ip_subnet || undefined,
      userAgent: r.user_agent || undefined,
      createdAt: r.created_at ? toIso(r.created_at) : undefined
    })),
    invites: invitesRes.rows.map((r) => ({
      token: r.token,
      companyId: r.company_id,
      caseId: r.case_id,
      email: r.email || undefined,
      createdByUserId: r.created_by_user_id,
      usedByUserId: r.used_by_user_id || undefined,
      status: r.status,
      expiresAt: toIso(r.expires_at),
      createdAt: toIso(r.created_at),
      acceptedAt: r.accepted_at ? toIso(r.accepted_at) : undefined
    }))
  };
}

export async function readStoreFromPostgres(): Promise<Partial<AppStore>> {
  await ensureSnapshotTable();
  const db = getPool();
  const existing = await db.query(
    "select payload from app_store_snapshots where id = $1 limit 1",
    ["global"]
  );
  if (existing.rowCount && existing.rows[0]?.payload) {
    return existing.rows[0].payload as Partial<AppStore>;
  }
  const hydrated = await loadFromNormalizedTables();
  await writeStoreToPostgres(hydrated as AppStore);
  return hydrated;
}

export async function writeStoreToPostgres(store: AppStore): Promise<void> {
  await ensureSnapshotTable();
  const db = getPool();
  await db.query(
    `insert into app_store_snapshots (id, payload, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (id) do update set payload = excluded.payload, updated_at = now()`,
    ["global", JSON.stringify(store)]
  );
  // Keep a throttled rolling backup so a bad write is recoverable.
  await maybeBackupSnapshot(store);
}
