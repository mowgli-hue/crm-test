# Newton CRM — Full Audit (June 2026)

Four-part audit of `crm-builder-web`, `newton-agent`, `pdf-service`, and the data layer. Findings are deduped and ranked by real-world impact. Severity = Critical / High / Medium / Low.

The single most important theme runs through every section: **the entire CRM is one JSON blob (`app_store_snapshots`, row `id='global'`) mutated by two processes (Node + the Python agent) with no shared lock and last-write-wins semantics.** That one fact explains the documented data-loss incidents (Vishal's lost intake), the duplicate case numbers, and is the highest structural risk in the system.

---

## CRITICAL

### Data integrity

C-1. **Cross-process lost updates.** Node writes the whole blob (`postgres-store.ts` `writeStoreToPostgres`, ~L716) while the Python agent writes the same row via `jsonb_set` (`newton-agent/agent_service.py` L116-173), with no coordination. Concurrent edits silently clobber each other. This is the Vishal CASE-1308 mechanism. Fix: route all writes through one path (agent calls a Node API through the mutex, or both use a Postgres advisory lock / optimistic `WHERE updated_at = $expected`).

C-2. **No optimistic concurrency / version column.** `writeStore` replaces `payload` unconditionally — no version, no row lock. Any cross-replica or cross-process read-modify-write clobbers every entity. Fix: add a `version` and compare-and-swap; reject/retry stale writes.

C-3. **Most mutators bypass the in-process mutex.** ~47 `writeStore` call-sites; only ~6 use `mutateStore`. The highest-traffic write — `updateCasePgwpIntake` (`store.ts` ~L3075), the WhatsApp intake save — is NOT wrapped. Fix: wrap every read-modify-write in `mutateStore`.

### Security

C-4. **WhatsApp inbound handlers are publicly POST-able with no signature check.** `app/api/Whatsapp/route.ts` (POST L89+) and `app/api/marketing-whatsapp/route.ts` (POST L1197) act on `req.json()` with zero verification. The signature *is* checked in `whatsapp-router/route.ts`, but it then forwards over public HTTP with only a forgeable `x-internal-forward: 1` header the handlers don't check — and the CSRF exemption is for lowercase `/api/whatsapp` while the real path is `/api/Whatsapp`. Anyone can forge inbound messages → drive intake, write inbox rows, trigger outbound LLM replies. Fix: verify HMAC over the raw body inside the handlers, fail-closed; sign the router→handler hop with a server-only secret or call in-process.

### Form correctness

C-5. **Invalid country codes for Iraq & Jordan.** `lib/ircc-codes.ts` L147/L154 map to the literal strings `"IRAQ"`/`"JORDAN"` instead of numeric IRCC codes — garbage into a coded XFA dropdown. Fix: real numeric codes + a test asserting every code matches `/^\d{3}$|^\*$/`.

C-6. **Admissibility questions can ship "No" alongside real detail (regex path).** When the AI parse fails (route swallows it), the PGWP regex path ticks background questions "No" unless the answer starts with "y" — so "Refused a US visa in 2019" → No. A misrepresentation/refusal risk. Fix: any non-empty answer that isn't a clean No → needs-review flag; never emit `has_*: false` with a present detail.

C-7. **Military / government-position / ill-treatment hardcoded "No" on PGWP.** `intake-to-form-mappers.ts` L962-964 — three inadmissibility questions the PGWP applicant was never asked are filled "No". Fix: ask them, or leave blank + flag.

---

## HIGH

H-1. **Intake answer-pointer advances by answer COUNT, not question index** (`whatsapp-ai-intake.ts` L1536 vs L1056-58, L1543). On non-contiguous batches (PGWP and others) validation runs against the wrong prompt and completion can fire early/late. Fix: make progress/validation purely answer-driven.

H-2. **Batch validation checks only ONE answer per reply** (`whatsapp-ai-intake.ts` L1457-1533). The default batched intake saves 5 of 6 answers unvalidated — DOB, passport, employment slip past the validators. Fix: validate every answer captured this turn. (Do with H-1.)

H-3. **Phone→case matching uses unanchored 9-digit suffix** (`Whatsapp/route.ts` L212-215; `whatsapp-ai-intake.ts` L305-308) — cross-client collisions; messages/docs land on the wrong case. `lib/phone.ts` already has the correct last-10 `samePhone()`. Fix: migrate both matchers to it.

H-4. **Multi-case phone routes documents to the array-FIRST case** (`Whatsapp/route.ts` L212-216) — doc filing isn't multi-case-aware though intake is. Fix: pick most-recently-active non-submitted case.

H-5. **Non-PGWP mappers emit TEXT where dropdowns need numeric codes.** Study-ext/TRV/Visitor-record mappers output "Single"/"Canada"/"Study" while the Python fillers write verbatim into coded LOV nodes. Fix: route all coded fields through the `textTo*Code` helpers (centralize in `mapIntakeToForm`).

H-6. **`frequent_language` overwritten with raw native language by the AI merge** (`intake-ai-parser.ts` L527) — re-introduces the invalid value (only English/French allowed). Fix: delete that line.

H-7. **Employment overflow silently dropped to 3 rows, no flag** — a 10-year history gap is an RFE/refusal trigger. Fix: flag when rows exceed form slots.

H-8. **Date parsing accepts impossible/ambiguous dates** (no range check; DD-MM vs YYYY-MM ambiguity). Fix: strict `YYYY-MM-DD` validator at fill time; blank + flag on failure.

H-9. **False "ready for human review."** `ready-package.ts` L97-115 ignores whether passport number / citizenship / DOB were actually extracted. A case can be "ready" with blank identity fields. Fix: require the `internalExtractionRequired` fields non-empty.

H-10. **Inbox-recovery parser assumes global question numbering** (`whatsapp-ai-intake.ts` L141-142) — section-numbered replies recover into wrong slots. Fix: don't auto-place by index; flag for staff.

### Security (High)

H-11. **`admin/stuck-uploads` GET — unauthenticated PII leak** (client phones, names, case IDs); also raw-interpolated interval. Its sibling `/action` is guarded; this one isn't. Fix: add the admin gate + parameterize.

H-12. **`app-lookup` GET — unauthenticated lookup by application number** returns name/phone/appType; sequential IDs → enumeration. Fix: require auth on GET.

H-13. **Twilio webhooks accept forged requests** (`twilio-voicemail`, `twilio-call-status`, `twilio-voice`, `transcribe`) — no `X-Twilio-Signature` validation; forged params overwrite call logs. Fix: validate the signature on every Twilio webhook.

---

## MEDIUM (summary)

- M-1. Backups are effectively manual/best-effort and live in the **same DB** (`BACKUP_DATABASE.sql` hand-run; in-app rolling backup throttled by an in-process timer, ~3 days, same database). Add a real scheduled off-site `pg_dump`.
- M-2. Duplicate CASE numbers root-caused to the old per-company id counter; `repairDuplicateCaseIds` exists but must be run, and nothing enforces uniqueness at the storage layer.
- M-3. Document dedup is `sourceMsgId`-only; without it, retries double-insert (the "1 upload → 87 docs" mode). Add a stable dedup key (caseId + Drive fileId / name+size).
- M-4. Drive↔DB linkage is a free-text URL with no stored `folderId` and no reconciliation job — folders can be missing, duplicated, or out of sync.
- M-5. Two/three parallel mapper implementations (`imm5710-mapper.ts`, `intake-to-form-mappers.ts`, `form-fill.ts`) can disagree. Quarantine the legacy ones; one code path.
- M-6. Name splitting mis-handles multi-word surnames and mononyms (passport mismatch). Prefer OCR `lastName`/`firstName`; flag on fallback.
- M-7. Marital status / language-test-taken / address country default silently (Single / Yes / Canada). Flag instead of defaulting.
- M-8. Duplicate-case guard relies on exact name+formType string equality; normalize formType, add phone-only check.
- M-9. `bootstrap` seeds all staff with hardcoded `Newton_123` and returns plaintext creds. Generate random per-user passwords; force reset.
- M-10. Hardcoded fallback secrets (`newton_verify_2024`, marketing phone id). Fail closed when env is unset.
- M-11. AI action paths (doc-classify, intake-extract, auto-prepare trigger) are steerable by client document/message content (prompt injection) — allow-list every action path, not just greetings.
- M-12. `cases/[id]/agent-process` authenticates but doesn't call `canStaffAccessCase` — any staff can run the agent on any company case.
- M-13. No DB schema management for the real model (normalized tables are dead code; `migrateStore` runs on every read). Add a `schema_version` + migration runner.

## LOW (summary)

Constant-time secret comparison; in-process per-instance rate limiting with spoofable `x-forwarded-for`; per-message text dedup keyed on a random id not Meta's id; orphan-doc digest for unlinked docs; layout auto-detection has no low-confidence flag; Python agent is a divergent third source of truth for the data sheet; `getRequiredForms` falls through to representative-form-only for unmapped types; `previous_doc_number` sanitizer can blank a valid number; email policy inconsistent across forms.

---

## Suggested fix order

1. **Security quick wins (low risk, high value):** H-11 admin auth, H-12 app-lookup auth, M-10 fail-closed secrets, M-12 agent-process access check, agent SQL parameterization. Self-contained, no live-flow risk.
2. **Form correctness (refusal risk):** C-5 country codes, H-6 frequent_language, C-6/C-7 admissibility flags, H-9 false-ready, H-5 text-vs-code. Each is contained and testable.
3. **Webhook auth (needs care — touches live intake):** C-4 + H-13. Do behind a verified secret with fail-open logging first, then fail-closed.
4. **Intake pointer/validation rewrite:** H-1 + H-2 together. Higher effort, well-specified.
5. **Concurrency / data model (structural, plan a window):** C-1/C-2/C-3 — the root cause. Biggest payoff, biggest care.

Items 1 and 2 are safe to start immediately. Items 3–5 should be sequenced deliberately.
