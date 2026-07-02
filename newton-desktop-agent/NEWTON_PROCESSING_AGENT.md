# Newton Processing Agent — Master Runbook (the agent's memory)

This is the standing, end-to-end procedure the Newton processing agent follows to
take a case from the CRM to a review-ready application package — the same way a
human caseworker does it. **Cowork has no memory between chats; THIS FILE is the
memory.** Point every new session here: "read NEWTON_PROCESSING_AGENT.md, then
process CASE-XXXX." Update it whenever a new quirk or application type is learned.

> Hard rule (unchanged): the agent PREPARES; a human REVIEWS and SUBMITS. Nothing
> is filed with IRCC by the agent.

---

## THE END-TO-END FLOW (what "process a case" means)

```
  1. CRM        open the CRM, find the case, read its data (intake, identity, type)
  2. DRIVE      open the case's Google Drive folder, read the REAL documents +
                the reference material Newton uses for this application type
  3. RECONCILE  build the true field values from the DOCUMENTS (passport/permit win
                over the rep letter), flag anything missing or contradictory
  4. FILL       generate the Acrobat console script + fill each required form
                (cert-safe: paste in console -> remerge -> Validate -> Save As)
  5. ASSEMBLE   bundle forms + client docs into the submission package
  6. STRATEGY   think per application type: what's done, what's left, what's
                strategically risky, what to ask the client (agent/strategy.py)
  7. HANDOFF    save the strategy note + package to Drive, mark "Ready for human
                review", file a team task with the client-asks, STOP (never submit)
```

The STRATEGY step is the judgment layer. It runs a per-application-type **rubric**
(in `agent/strategy.py` `RUBRIC`) plus auto gap-analysis and emits a team note with
four sections: Done · Left to do · Strategic (confirm before filing) · Ask the
client. PGWP is seeded from the playbooks (status-timeline gaps, 180-day window,
Unemployed convention, open-permit, refusal disclosure). **Training a new type =
add its `checks` + `client_asks` to the rubric** — that's a big part of what you'll
teach me per type.

Steps 4–6 are built and proven (console-JS fill: `FILL ok=97 miss=0`, cert intact).
Steps 1–3 are what this training fills in.

---

## CONFIRMED DATA PIPELINE (found in the CRM code, 2026-06-30)

The CRM already turns a case into form-field values — reuse it, don't rebuild it
(the audit warns against a second mapper):

- **Map intake → fields:** `lib/intake-to-form-mappers.ts` `mapIntakeToForm(intake, formType)`
  (regex baseline) + `lib/intake-ai-parser.ts` `parseIntakeWithAI` + `mergeAIIntoFormData`.
  Output = the EMPTY_CLIENT-key dict (`family_name`, `given_name`, …) — the SAME
  shape our fillers take. Used by `POST /api/cases/[id]/fill-forms`.
- **Ready package:** `lib/ready-package.ts` writes `data/ready_packages/<case>_pgwp.json`
  (identity fields must be extracted from the passport/permit first — see its
  `internalExtractionRequired` list).
- **The CRM already knows IMM5710 is manual/certified:** `fill-forms` explicitly
  SKIPS it with reason *"certified form — fill manually through Acrobat (cowork),
  not server-side."* → that gap is exactly what our console-JS fills.

### The wired loop (reuses their mapper + Drive, adds our cert-safe fill)
```
  DB/API: case + intake  ──mapIntakeToForm+AI──►  field values (EMPTY_CLIENT keys)
                                                         │
                       pdf-service  POST /fill-js  ◄─────┘   (NEW, built + tested)
                                    returns console .js (97 fields, remerge)
                                                         │
                       save .js to case Drive folder  ◄──┘   (05 - Application Forms)
                                                         │
   Acrobat: open blank form ► Cmd+J ► paste .js ► Enter ► Validate ► Save As
                                                         │
                                    human reviews & submits
```

**pdf-service `/fill-js`** (built + tested): `POST {formId, data}` → `{ok, field_count, js}`.
`data` is the mapIntakeToForm output. This is the bridge.

**One small CRM change still to make** (documented, not yet applied): in
`app/api/cases/[id]/fill-forms/route.ts`, for `formId === "imm5710"` instead of
skipping, POST `mainData` to pdf-service `/fill-js` and upload the returned `.js`
to the case's Application-Forms Drive folder as `IMM5710_fill_<case>.js`. Then the
agent/human runs it in Acrobat. (Same pattern the route already uses for other
forms via `fillFormViaService`.)

### Runtime access (the two the owner is providing)
- **DB/API:** `newton-agent/db_tools.py` (DATABASE_URL) + `crm_api.py`
  (CRM_BASE_URL + AGENT_SERVICE_TOKEN) — both configured in `newton-agent/.env`.
  NOTE: the Cowork sandbox can't reach the Railway DB (DNS locked); this runs on
  the firm's Mac where it resolves.
- **Drive:** `newton-agent/drive_tools.py` + `sa-key.json` (service account).
  `scan_case_folder` reads the real docs; upload puts the finished forms back.

---

## PART A — ACCESS (fill in during training)

### A1. The CRM
- URL: `______`
- How the agent signs in / authenticates: `______`
  (service token? a login the agent drives in the browser? Chrome extension?)
- Where a case's data lives once open: `______`
  (known so far: DB `app_store_snapshots` -> payload->'cases'; intake at
  `c->'pgwpIntake'`. Confirm for other application types.)

### A2. Google Drive
- How the agent reaches a case's folder: `______`
  (known: case record has `docsUploadLink`; `scan_case_folder` resolves it.)
- Folder layout (known): `01 - Intake`, `02 - Identification`, `03 - Education`,
  `04 - Employment`, `05 - Application Forms`, `06 - Submission Package`,
  `07 - Correspondence`.
- Where the REFERENCE material for each application type lives: `______`
  (the "references" you mentioned — templates, checklists, sample filled forms?)

---

## PART B — PER APPLICATION TYPE (fill in during training)

You do many types. For EACH, capture: which IRCC forms, which reference doc to
follow, and the type-specific rules. (PGWP/IMM5710 is done — see IMM5710_PLAYBOOK.)

| Type | Forms | Reference doc in Drive | Special rules |
|------|-------|------------------------|---------------|
| PGWP | IMM5710 (+IMM5476) | IMM5710_PLAYBOOK.md | done — see playbook |
| Visitor Record | IMM5708 | `______` | `______` |
| TRV | IMM5257 | `______` | `______` |
| Study Permit Ext | IMM5709 | `______` | `______` |
| Work Permit Ext | IMM5710 | `______` | `______` |
| LMIA / SOWP / VOWP | `______` | `______` | `______` |
| Family / Sponsorship | `______` | `______` | `______` |
| (add rows) | | | |

---

## PART C — RECONCILE RULES (data truth)

Captured so far (from IMM5710_PLAYBOOK):
- **Documents beat the rep letter.** Passport + permit are truth; the rep letter
  often has typos (wrong passport #/UCI) and omits refusals/employment.
- **Disclose refusals/employment** even when the letter omits them (Background Q2).
- Add more truth-rules per type during training: `______`

---

## PART D — QUIRKS / GOTCHAS (grows over time)
- Country/province/status/language fields need **IRCC numeric codes**, not text
  (postal-code validation cross-checks the country CODE = 511 for Canada).
- (add as learned) `______`

---

## HOW I'LL LEARN THIS
Best: walk me through **one real case end to end** (you drive or narrate; I watch
and do). I'll write every step, click, and quirk into this file as we go, then
replay it on a second case to prove I learned it. After that the desktop agent
runs it unattended, stopping at the human-review gate.
```
