-- Run once against production Postgres. Idempotent via IF NOT EXISTS.
-- Speeds up documents / notifications / tasks / cases lookups.

create index if not exists idx_documents_case on documents(company_id, case_id, created_at desc);
create index if not exists idx_documents_version_group on documents(company_id, version_group_id);
create index if not exists idx_notifications_user_read on notifications(company_id, user_id, read);
create index if not exists idx_tasks_case_status on tasks(company_id, case_id, status);
create index if not exists idx_cases_lead_phone on cases(company_id, lead_phone);
