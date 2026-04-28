-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Newton CRM — Database Backup Commands                              ║
-- ║  Run via psql against Railway Postgres                              ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- USAGE:
--   psql "$DATABASE_URL" -f BACKUP_DATABASE.sql
--
-- Or copy individual blocks and paste into psql interactive shell.

-- ────────────────────────────────────────────────────────────────────
-- ONE-TIME — Run before any major refactor / risky change
-- ────────────────────────────────────────────────────────────────────

-- Replace YYYYMMDD with today's date (e.g. 20260428 for April 28, 2026)
-- This creates immutable snapshot copies. Restore with:
--   TRUNCATE app_store_snapshots;
--   INSERT INTO app_store_snapshots SELECT * FROM app_store_backup_YYYYMMDD;

CREATE TABLE IF NOT EXISTS app_store_backup_20260428 AS
  SELECT * FROM app_store_snapshots;

CREATE TABLE IF NOT EXISTS whatsapp_inbox_backup_20260428 AS
  SELECT * FROM whatsapp_inbox;

CREATE TABLE IF NOT EXISTS orphan_docs_backup_20260428 AS
  SELECT * FROM orphan_docs;

-- Verify counts match the live tables
SELECT 'app_store_snapshots' AS source, COUNT(*) AS rows FROM app_store_snapshots
UNION ALL SELECT 'app_store_backup_20260428', COUNT(*) FROM app_store_backup_20260428
UNION ALL SELECT 'whatsapp_inbox', COUNT(*) FROM whatsapp_inbox
UNION ALL SELECT 'whatsapp_inbox_backup_20260428', COUNT(*) FROM whatsapp_inbox_backup_20260428
UNION ALL SELECT 'orphan_docs', COUNT(*) FROM orphan_docs
UNION ALL SELECT 'orphan_docs_backup_20260428', COUNT(*) FROM orphan_docs_backup_20260428;

-- ────────────────────────────────────────────────────────────────────
-- NIGHTLY — Schedule via Railway cron or run manually each evening
-- ────────────────────────────────────────────────────────────────────
-- This rotates a "rolling" snapshot you can always fall back to.
-- Each night drops the previous-night backup and creates a new one,
-- AND creates a daily-named backup that persists permanently.

-- Daily named backup (replace YYYYMMDD with today's date)
DROP TABLE IF EXISTS app_store_nightly;
CREATE TABLE app_store_nightly AS SELECT * FROM app_store_snapshots;

DROP TABLE IF EXISTS whatsapp_inbox_nightly;
CREATE TABLE whatsapp_inbox_nightly AS SELECT * FROM whatsapp_inbox;

-- Note: keep a rolling 30-day history by also creating a daily-named copy:
-- (substitute YYYYMMDD)
-- CREATE TABLE app_store_backup_YYYYMMDD AS SELECT * FROM app_store_snapshots;

-- ────────────────────────────────────────────────────────────────────
-- LIST EXISTING BACKUPS — see what snapshots you have
-- ────────────────────────────────────────────────────────────────────

SELECT
  table_name,
  pg_size_pretty(pg_total_relation_size('public.' || table_name)) AS size
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name LIKE 'app_store_backup%'
       OR table_name LIKE 'whatsapp_inbox_backup%'
       OR table_name LIKE 'orphan_docs_backup%'
       OR table_name LIKE '%_nightly')
ORDER BY table_name DESC;

-- ────────────────────────────────────────────────────────────────────
-- RESTORE — if production gets corrupted
-- ────────────────────────────────────────────────────────────────────
-- ⚠️  DESTRUCTIVE — only run if you confirm production is broken
--
-- BEGIN;
--   TRUNCATE app_store_snapshots;
--   INSERT INTO app_store_snapshots SELECT * FROM app_store_backup_20260428;
--   -- Verify before commit:
--   SELECT COUNT(*) FROM app_store_snapshots;
-- COMMIT;  -- or ROLLBACK;

-- ────────────────────────────────────────────────────────────────────
-- VISHAL RECOVERY — populate CASE-1308 with his actual answers
-- ────────────────────────────────────────────────────────────────────
-- His answers are in whatsapp_inbox at created_at = '2026-04-16 06:53:45.282456+00'
-- The snapshot's pgwpIntake is missing q1-q18 entirely.
-- This patches them in by editing the JSONB payload.

BEGIN;

-- Verify case exists and is in expected state before patching
SELECT
  c->>'id' AS case_id,
  c->>'client' AS client,
  jsonb_object_keys(c->'pgwpIntake') AS existing_keys
FROM app_store_snapshots,
     jsonb_array_elements(payload->'cases') AS c
WHERE id = 'global' AND c->>'id' = 'CASE-1308'
ORDER BY existing_keys;

-- Patch in Vishal's recovered answers (from his Apr 16 06:53 batch reply +
-- his Apr 16 07:09 clarification about the medical field). The PDF has the
-- canonical version — these match it.
UPDATE app_store_snapshots
SET payload = jsonb_set(
  payload,
  '{cases}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN c->>'id' = 'CASE-1308' THEN
          jsonb_set(
            c,
            '{pgwpIntake}',
            (c->'pgwpIntake') || jsonb_build_object(
              'q1',  'No',
              'q2',  'Single',
              'q3',  'NA',
              'q4',  'NA',
              'q5',  '1957 Granite Street, Victoria, BC V8S 3G2',
              'q6',  'SAME',
              'q7',  '+1 604-722-4151',
              'q8',  'October 24, 2023 — Vancouver International Airport (YVR)',
              'q9',  'Study',
              'q10', 'No',
              'q11', 'No',
              'q12', 'Yes — Type 1 Diabetes; currently taking medication (prescribed in Canada)',
              'q13', 'No',
              'q14', 'Manager — Noodlebox, Royal Oak, Victoria — Apr 2025 to Present; Team Member — Noodlebox, Royal Oak, Victoria — Sep 2024 to Apr 2025; Team Member — Tim Hortons, 1920 Island Hwy, Colwood — Feb 2024 to Sep 2024; Team Member — McDonald''s, 2473 Mount Newton Cross Rd, Saanichton, BC — Feb 2024 to Apr 2024; Warehouse Associate — Amazon, Sidney, BC — Jan 2024 to Apr 2024; Team Member — Baba Chicken, Newton Exchange, Surrey — Nov 2023 to Jan 2024',
              'q15', 'Bachelors in Business Administration (BBA) — Finance & HR — Malwa College, Bathinda, Punjab (Punjabi University Patiala) — 2018 to 2021',
              'q16', 'Punjabi',
              'q17', 'Yes — IELTS: Overall 6.5 (Speaking 7, Listening 7, Reading 6.5, Writing 6)',
              'q18', 'No',
              'whatsappIntakePhase', 'complete',
              'whatsappIntakeCompletedAt', '2026-04-16T06:53:45.282Z',
              'whatsappIntakeRecoveredAt', NOW()::text,
              'whatsappIntakeRecoveryNote', 'Recovered from whatsapp_inbox row at 2026-04-16 06:53:45 — original session never finalized due to old-template intake flow.'
            )
          )
        ELSE c
      END
    )
    FROM jsonb_array_elements(payload->'cases') AS c
  )
)
WHERE id = 'global';

-- Verify Vishal's case now has answers
SELECT
  c->>'id' AS case_id,
  c->>'client' AS client,
  c->'pgwpIntake'->>'q1' AS q1_answer,
  c->'pgwpIntake'->>'whatsappIntakePhase' AS phase,
  c->'pgwpIntake'->>'whatsappIntakeRecoveredAt' AS recovered_at
FROM app_store_snapshots,
     jsonb_array_elements(payload->'cases') AS c
WHERE id = 'global' AND c->>'id' = 'CASE-1308';

-- Inspect: SELECT shows the recovered row → if it looks right → COMMIT
-- If something looks off → ROLLBACK
COMMIT;
-- ROLLBACK;
