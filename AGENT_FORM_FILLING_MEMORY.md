# Newton CRM — IRCC Form-Filling Playbook (Cowork Memory)

This is the standing procedure for filling IRCC IMM forms for Newton Immigration
via cowork (computer-use + Adobe Acrobat). Read this before filling any form.

---

## ⚡ SPEED RULES (do these — every later form should be FAST, not exploratory)

The FIRST fill (Lovepreet) was slow because the form was unknown. It's mapped now.
Goal: open → fill top-to-bottom in one pass → Validate → Save. No re-discovery.

1. **NEVER open/fill the template `blank_imm5710.pdf` directly.** It got
   overwritten once (Acrobat Save wrote the filled+validated copy back onto it).
   ALWAYS work on a COPY: `cp blank_imm5710.pdf IMM5710e_<NAME>_DRAFT.pdf`, open
   the copy, fill, Validate, Save As to the client folder. If the template ever
   shows data, restore it: `git checkout -- apps/pdf-service/python/blank_imm5710.pdf`
   (HEAD blank = 862103 bytes; a contaminated one is ~983k). Delete the working
   copy when done.
2. **Gather ALL data BEFORE touching Acrobat.** The Drive case folder
   (Client_Info = the STUDY PERMIT, Completion_Letter, Transcript, Passport) has
   everything: UCI, study-permit From/To, DLI, program, study dates, POB, sex,
   citizenship, issue place. Read those first (Finder → spacebar Quick Look) so the
   fill is one uninterrupted pass. Don't ask the user for what the docs already hold.
3. **Type-ahead gotchas (memorized, don't rediscover):**
   - UCI = digits only, NO hyphens.
   - Place-of-birth / citizenship country list = full names → India = `i`,`i`,Return.
   - **Passport "Country of issue" list = 3-LETTER CODES** → India = `i`,`i`,Return
     (IDN→IND).
   - Province = open arrow, click the 2-letter code (BC).
   - Native language Punjabi = `p` × 23 SINGLE presses, Return (see §7).
   - Marital Single = open, `s`,`s` (Separated→Single), Return.
4. **Date fields:** most auto-insert dashes as you type YYYY then MM then DD. BUT
   the **passport Expiry field did NOT auto-format** — if it shows `20320512`,
   clear it and type the dashes explicitly: `2032-05-12`. Always zoom-verify dates.
5. **Page-2 Q5 (Taiwan MOFA passport) & Q6 (Israeli passport) checkboxes** were
   stubborn to click by eyeballing the grey square. Don't burn time hunting pixels —
   fill everything else, hit **Validate**, and the still-empty required ones turn
   RED, which pinpoints the exact box to click. (Both = No for a normal applicant.)
6. **Turn on "Highlight Existing Fields"** (top-right) early — it red-outlines every
   fillable widget so you click the right spot first time.
7. **Don't fight the floating "Ask AI Assistant" bar** — it overlaps the bottom
   ~40px; scroll the target field up before clicking it.
8. **Fill one field → zoom-verify → next.** Never batch typing across a scroll
   (values land a row off) and never key-repeat a dropdown letter (Acrobat reads
   `ppppp` as a search string and jumps wrong).

---

## STATUS: ✅ PROVEN END-TO-END (Lovepreet Singh, CASE-1611, 2026-06-10)

A full IMM5710 was filled manually THROUGH Adobe Acrobat via cowork and
**Validate succeeded — a 6-barcode page (page 6) was appended and the
"Certified by IRCC … you can save data typed into this form" banner stayed
intact.** That is the win: cert preserved → JS ran → barcodes generated. The
exact recipe that worked is captured in sections 7–9 below. Read those first.

---

## 0. THE ONE CRITICAL FACT (root cause of years of failures)

IRCC's IMM forms (IMM5710 / 5708 / 5257 / 5709 …) are **digitally CERTIFIED**
(signed by IRCC, "Certified by Immigration, Refugees and Citizenship Canada").

- Filling them **server-side** (pikepdf rewriting the XFA datasets) puts the data
  in BUT **breaks the certification** → Acrobat **disables the form's JavaScript**
  → the **Validate** button can't run → **no 2D barcode** → **IRCC rejects it**.
  (Symptoms on the broken file: "Certification … is invalid" + red
  "JavaScript has been disabled, the form requires JavaScript to validate".)
- The certified form **allows typing/importing data through Acrobat** ("You can
  save data typed into this form"). Doing it that way **preserves the cert**, so
  JavaScript runs, Validate works, and the barcode generates.

**RULE: never deliver a server-filled IMM form as the final. The form MUST be
filled THROUGH Acrobat (type or Import Form Data), then Validated, to be valid.**

(Acrobat Enhanced Security / Protected Mode were NOT the cause — don't bother
toggling them. If I turned Enhanced Security off while diagnosing, turn it back on.)

---

## 1. THE WORKFLOW (division of labour)

1. **Agent (automatic, server-side):** gathers docs, drafts the rep letter,
   assembles the package, and computes the form data (the `mapIntakeToForm` +
   `parseIntakeWithAI` pipeline — proven accurate). Scope: PGWP, Visitor Record,
   TRV. Forms: PGWP→IMM5710, Visitor Record→IMM5708, TRV→IMM5257, SPE→IMM5709,
   plus IMM5476 (Use of Representative) for all.
2. **Cowork (on the user's Mac, Adobe installed):** open the BLANK certified form
   → type/import the data → click **Validate** → **Save** the validated, barcoded
   form into the case's Submission ("Client Information - <Full Name>") folder.

Two ways to do step 2:
- **Manual type** (proven; slower, field-by-field) — use the field map below.
- **Import Form Data** (faster, fills all at once, still preserves cert) — generate
  an XFDF/XML from the agent's mapper, then Acrobat → Tools/Menu → Import Form Data
  → select the file → Validate → Save. **Preferred for production.**

---

## 2. DATA SOURCES per case (in the case's Google Drive folder)

Each case has a "Client Documents" Drive folder containing:
- **`<Name> - Intake Answers.txt`** — the WhatsApp Q&A (marital, address, phone,
  entry to Canada, refusals, employment, education, etc.).
- **`<Name> - Passport (exp …).pdf`** — identity: surname, given name, sex, DOB,
  place of birth, citizenship, passport number, issue/expiry.
- Plus completion letter, transcripts, study permit, photo, etc.

To read them via cowork: Finder → select file → **spacebar (Quick Look)**.
The CRM mapper also already produces these fields structurally.

---

## 3. ACROBAT — opening the blank form

- Default PDF app is **Adobe Acrobat (Reader)** — IRCC forms validate in free Reader.
- Blank templates live at:
  `…/newton-crm-test/apps/pdf-service/python/blank_imm5710.pdf` (and 5708/5257/5709).
- Open: Finder → Go menu → "Go to Folder…" → paste path; or Acrobat File → Open.
- The blank form shows a **blue banner "Certified by IRCC … you can save data typed
  into this form"** and working dropdowns = JavaScript is live. Good to fill.

---

## 4. FILL TECHNIQUES (memorized)

- **Text field:** left_click the field, then `type` the value.
- **Checkbox / radio (Yes/No):** single left_click.
- **Sex dropdown:** click → list shows F Female / M Male / U Unknown / X Another
  gender → click the choice.
- **Country dropdowns (Place of birth, Citizenship, etc.) — THE TRICKY ONE:**
  click to open, then **press the first letter repeatedly to cycle** to the country,
  then press **Return**. (India = press `i` twice → Iceland, then India → Return.)
  Type-ahead with the full word does NOT work; single-letter cycling does.
- **Date fields:** separate YYYY / MM / DD boxes — click each, type the part.
- **Validate:** the blue **Validate** button at top. If fields are missing it pops
  "The following field must contain a value: …" and highlights them red — that's
  proof JS is running. When complete, it stamps the **barcode** and "Validated".

---

## 5. IMM5710 — PAGE 1 FIELD MAP & ORDER (PGWP)

(Section numbers are on the form. Fill in this order.)
1. Box 1 UCI — usually blank (we rarely have it).
2. Box 2 "I want service in" — English (pre-set).
3. Box 3 "I am applying for…" — for **PGWP** check **"Apply for a work permit for
   the first time or with a new employer."**
4. Box 1 Full name — Family name (passport surname), Given name(s).
5. Box 2 "used any other name?" — usually **No**.
6. Box 3 Sex — dropdown (Male/Female).
7. Box 4 Date of birth — YYYY / MM / DD.
8. Box 5 Place of birth — City/Town + Country (country = letter-cycle dropdown).
9. Box 6 Citizenship — country dropdown.
10. Box 7 Current country of residence — Canada (pre-filled) + **Status** dropdown
    (Study permit for a PGWP applicant) + From/To dates of that status.
11. Box 8a Previous countries of residence (past 5 yrs, >6 months) — usually **No**.
12. Box 9 Marital status — dropdown (Single/Married/Common-Law/…).
Pages 2–5: language, mailing/residential address, phone, passport, national ID,
entry to Canada (original date+place+purpose, recent entry), DETAILS OF WORK
(work-permit type, employer, location, occupation, dates — for PGWP the type code
is set by `deriveWorkPermitType`), education, employment history (last 10 yrs),
background questions (refused? medical? criminal? military? govt position?).

**Watch-outs / gotchas:**
- The Mac **locks on idle** — I CANNOT enter the password. If it locks, stop and
  ask the user to unlock.
- The page scrolls as you click lower fields; re-screenshot to re-locate coords.
- Acrobat may open on the **second monitor** — use switch_display if not visible.
- A "What's new / Share via WhatsApp" promo pops on launch — close it (X).
- Always treat the output as a **DRAFT the RCIC reviews** before submission.

---

## 6. SAMPLE — LOVEPREET SINGH (CASE-1611, PGWP) — data captured, fill in progress

Identity (passport V8451230, India):
- Family name: **Singh**  · Given name: **Lovepreet**
- Sex: **Male** · DOB: **2003-07-31** · Place of birth: **Mansa, Punjab, India**
- Citizenship: **India** · Passport: **V8451230**, issued Chandigarh 2022-04-18,
  expires **2032-04-17**.

Intake answers:
- Marital: **Single** · Other name: No
- Mailing & residential: **15095 91 Avenue, Surrey, BC, V3R 1B6, Canada** (same)
- Phone: **+1 778-723-6483**
- First entered Canada: **2023-08-15, Vancouver airport** · Purpose: **Study**
- Recent entry: No
- Ever refused: **Yes** — study-permit visa refused from India, **March 2023**
- Medical: No · Criminal: No
- Employment: **LCT Lane Control Technician**, 2024-02 → present, Vancouver, Canada;
  **General Labor, Tire Chalet**, Richmond, Canada, 2023-10 → 2023-11
- Education: **Associate of Arts**, 2023-09 → 2026-04, **Alexander College, Burnaby**
- Same college since arrival: Yes

Status when paused (Mac locked): page 1 filled through Place of birth (Singh,
Lovepreet, first-WP, other-name No, Male, 2003-07-31, Mansa/India). Remaining:
Citizenship → India, current Status → Study permit, prev-countries → No, marital →
Single, then pages 2–5, then **Validate → Save** to the Client Information folder.

**→ COMPLETED & VALIDATED 2026-06-10. Full field values used are in section 9.**

---

## 7. WIDGET/FIELD TECHNIQUES — THE ONES THAT ACTUALLY WORK (learned the hard way)

- **Date fields auto-advance:** type the 4-digit YYYY and focus jumps to MM by
  itself — just keep typing the 2-digit MM (and DD) with NO extra click. Don't
  pre-click MM; you'll mis-land.
- **UCI (Box 1, pg 1): TYPE DIGITS ONLY, NO HYPHENS.** Hyphens make the field go
  RED (invalid). e.g. type `1125131453`, not `11-2513-1453`. The field's own mask
  handles display. (A red UCI box = you put hyphens or a wrong-length value.)
- **Country/Territory dropdowns** (Place of birth, Citizenship, education country,
  employment country): click the dropdown ARROW to open the full alphabetical
  list, then **press the first letter to CYCLE** through matches, then **Return**.
  - **Canada = open, press `c` FOUR times** (Cabo Verde → Cambodia → Cameroon →
    Canada), then Return. (First `c` lands on Cabo Verde, not Canada.)
  - **India = open, press `i` twice** then Return.
  - Full-word type-ahead does NOT work; single-letter cycling does.
- **Native language dropdown (page 2, Punjabi):** huge ISO language list. Open it,
  then press **`p` 23 times, ONE PRESS AT A TIME**, to reach **Punjabi**, then
  Return. (Press 1 = Pahari, 23 = Punjabi: Pahari→Pampango→Pangasinan→Pashto(+3
  variants)→Persian→Peul(+variants)→Pidgin→Polish→Portuguese(+4 variants)→Poular→
  **Punjabi**.) CRITICAL: do NOT use key-repeat/batched presses — Acrobat reads
  `ppppp` as a type-ahead SEARCH STRING and jumps to the wrong place. Single
  presses only, with the dropdown open.
- **Province/State dropdown** (only required once Country = Canada): click the
  ARROW, then **click the 2-letter code** in the list (AB, BC, MB, NB, NL, NS, NT,
  NU, ON, PE, QC, SK, YT). BC is the 2nd item.
- **Sex dropdown:** click → choose M Male / F Female.
- **Checkbox / radio (Yes/No, applying-for, background Qs):** single left_click on
  the box. Zoom to confirm the ✓ landed — clicks near the page bottom often miss
  because the view auto-scrolls.
- **VERIFY-AS-YOU-GO:** after each field, `zoom` into it. Do NOT batch typing
  across a scroll — the page shifts and values land in the wrong row (this
  repeatedly put data one row low). Fill one field → zoom → next.
- **The floating "Ask AI Assistant" bar steals focus.** It docks over the bottom
  ~40px of the page. If you click/type a form field that it overlaps, your text
  goes into the AI bar, NOT the form. Scroll the field up away from the bar first,
  then click the field, then type. (Cost me a re-type of the 2d details box.)
- **Multi-line detail boxes** (e.g. 2d) wrap and scroll; press `Home` + zoom to
  confirm the FULL text is stored (the field shows the tail by default).
- **Locating Validate:** jump to page 1 via the page-number box (top-right of the
  page rail) — type `1`, Return. `cmd+Home` did NOT scroll to top. The blue
  **Validate** button sits top-center of page 1 (Clear Form is top-right).
- **Mac second monitor / app hidden:** if a screenshot shows Chrome or the home
  screen instead of the form, the doc dropped behind. `open_application "Adobe
  Acrobat"` brings it back. Chrome is read-tier — never click into it.

---

## 8. PGWP-SPECIFIC FILL RULES (confirmed by the RCIC)

- **Box 3 applying-for:** "Apply for a work permit for the first time or with a
  new employer."
- **Current country of residence (pg1 box 7):** Canada · Status = **Student** (the
  study permit) · From/To = the study-permit validity dates.
- **National ID document:** **No.**  **US PR card:** **No.**  **Language test
  (have you taken one):** **Yes** (PGWP clients share an IELTS — Lovepreet
  2025-12-06).  Native language: client shares (Lovepreet = Punjabi).
- **DETAILS OF INTENDED WORK IN CANADA:** only fill **Box 1a work-permit type =
  "Post Graduation Work Permit"**. **LEAVE BLANK:** 2a employer name, 2b employer
  address, 3 intended location, 4 occupation/duties, 5 duration, 6 LMIA, 7 CAQ.
  (It's an open work permit — no employer.) Box 8 PNP certificate = **No**.
- **EMPLOYMENT — the PGWP convention:**
  - **Row 1 (Current Activity):** `Unemployed` · From = **completion-letter
    month** (≈ study To-date, Lovepreet 2026-04) · To = **blank** (ongoing) ·
    Company = `Not Applicable` · City = residence (Surrey) · Canada · BC.
  - **Row 2 (most recent job):** real occupation · From job-start · To =
    completion month · employer name · city · Canada · province. (If employer name
    unknown, the RCIC said put placeholder `employer` — they finalize on review.)
  - Older jobs / Row 3: only add if the RCIC asks (they said skip Lovepreet's).
- **EDUCATION:** Yes + one row: From/To (study dates), Field+level (e.g. Associate
  of Arts), School (e.g. Alexander College), City, Country, Province.
- **BACKGROUND:** TB No · medical-disorder No · 2a overstay/unauth-work/study No ·
  2b refused-visa **Yes** (+ 2d details: which visa, where, when, and that a later
  app was approved) · 2c previously-applied **Yes** · 3 criminal No · 4 military No
  · 5 violent-org No · 6 ill-treatment No.
- **SIGNATURE page:** leave the consent-to-be-contacted Y/N and the
  Signature/Date BLANK — the applicant signs. It still validates without them.

---

## 9. LOVEPREET SINGH — EXACT VALUES ENTERED (reference for QA)

UCI `1125131453` · service English · applying = first WP · Singh / Lovepreet ·
other-name No · Sex Male · DOB 2003-07-31 · POB Mansa / India · Citizenship India
· residence Canada / Student / 2025-11-22→2027-03-30 · prev-countries No · marital
Single · prev-married No · native Punjabi · communicate English · language-test Yes
· passport V8451230 / IND / 2022-04-18 / 2032-04-17 · Taiwan No · Israel No ·
national-ID No · US-PR No · mailing 15095 / 91 Avenue / Surrey / Canada / BC /
V3R 1B6 · residential same · phone Cellular +1 (778) 723-6483 · entry 2023-08-15
Vancouver / purpose Study · WP-type Post Graduation Work Permit (employer block
blank) · PNP No · Education Yes: 2023-09→2026-04 Associate of Arts, Alexander
College, Burnaby, Canada, BC · Employment R1 Unemployed 2026-04→ (Not Applicable,
Surrey, Canada, BC) · R2 Lane Control Technician 2024-02→2026-04, employer,
Vancouver, Canada, BC · BG: TB No, medical No, 2a No, 2b Yes, 2c Yes, 3 No, 4 No,
5 No, 6 No · 2d "study permit refused, Visa Office India, March 2023; subsequent
permit approved, entered Canada 2023-08-15, valid status since."
→ **Validated OK, 6 barcodes, cert intact.** Saved as a 961 KB PDF (NOTE: filename
came out garbled `lIMM5710e_ovepreet_Singh…` and saved into the **Mehak**
submission folder by mistake — Save-As defaults to the last-used client folder, so
ALWAYS reset the "Where" folder + retype the filename cleanly before clicking
Save). Use Save As (never ⌘S — it would overwrite blank_imm5710 template).
