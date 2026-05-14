-- Newton CRM PostgreSQL baseline schema
-- Phase 2 foundation: migrate from JSON file storage to PostgreSQL.

create table if not exists companies (
  id text primary key,
  name text not null,
  slug text not null unique,
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null,
  user_type text not null,
  active boolean not null default true,
  password_hash text not null,
  mfa_enabled boolean not null default false,
  mfa_secret text,
  mfa_enabled_at timestamptz,
  mfa_last_verified_at timestamptz,
  workspace_drive_link text,
  workspace_drive_folder_id text,
  case_id text,
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

create table if not exists sessions (
  token text primary key,
  user_id text not null,
  company_id text not null references companies(id) on delete cascade,
  ip_address text,
  ip_subnet text,
  user_agent text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sessions_company on sessions(company_id);
create index if not exists idx_sessions_user on sessions(user_id);

create table if not exists clients (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  client_code text not null,
  full_name text not null,
  phone text,
  email text,
  assigned_to text,
  internal_flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, client_code)
);

create table if not exists cases (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  client_id text,
  client_user_id text,
  client_name text not null,
  form_type text not null,
  assigned_to text,
  owner_name text,
  reviewer_name text,
  stage text not null,
  case_status text,
  ai_status text,
  lead_phone text,
  lead_email text,
  processing_status text,
  processing_status_other text,
  payment_status text,
  amount_paid numeric(12,2),
  balance_amount numeric(12,2),
  is_urgent boolean not null default false,
  deadline_date text,
  decision_date text,
  final_outcome text,
  remarks text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cases_company on cases(company_id);
create index if not exists idx_cases_company_updated on cases(company_id, updated_at desc);
create index if not exists idx_cases_company_assigned on cases(company_id, assigned_to);

create table if not exists messages (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  case_id text not null references cases(id) on delete cascade,
  sender_type text not null,
  sender_name text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_case on messages(company_id, case_id, created_at);

create table if not exists outbound_messages (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  case_id text not null references cases(id) on delete cascade,
  channel text not null,
  status text not null,
  target text,
  message text not null,
  created_by_user_id text not null,
  created_by_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  case_id text not null references cases(id) on delete cascade,
  client_id text,
  name text not null,
  category text,
  file_type text,
  version integer,
  version_group_id text,
  status text not null,
  link text not null,
  created_at timestamptz not null default now()
);

create table if not exists client_communications (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  client_id text not null,
  created_by_user_id text not null,
  created_by_name text not null,
  type text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  actor_user_id text not null,
  actor_name text not null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_company_created on audit_logs(company_id, created_at desc);

create table if not exists tasks (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  case_id text not null references cases(id) on delete cascade,
  title text not null,
  description text not null,
  assigned_to text not null,
  created_by text not null,
  priority text not null,
  status text not null,
  due_date text,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  user_id text not null,
  type text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists invites (
  token text primary key,
  company_id text not null references companies(id) on delete cascade,
  case_id text not null references cases(id) on delete cascade,
  email text,
  created_by_user_id text not null,
  used_by_user_id text,
  status text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table if not exists auth_rate_limits (
  key text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);

-- S2-9 (added 2026-05-13): indexes speeding up store.ts query patterns.
create index if not exists idx_documents_case on documents(company_id, case_id, created_at desc);
create index if not exists idx_documents_version_group on documents(company_id, version_group_id);
create index if not exists idx_notifications_user_read on notifications(company_id, user_id, read);
create index if not exists idx_tasks_case_status on tasks(company_id, case_id, status);
create index if not exists idx_cases_lead_phone on cases(company_id, lead_phone);
