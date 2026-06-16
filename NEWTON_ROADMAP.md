# Newton CRM — Roadmap / Parked Ideas

Captured during the operations build. Not yet built — keep in mind.

## Results tracking (per application)
The CRM already receives result status (approved/refused). Build it out into a
proper results view per case:
- Status: **awaiting result → approved / refused**
- Who **prepared** the application (assignee)
- Who **reviewed** it (reviewer)
- The **notes / changes** raised during review (already captured via case_notes)
- Surface a "Results" board: outcomes by person/type, approval rate, refusal reasons.
This closes the loop: prep → review → submit → **result**, and feeds the
performance review (approval rate becomes a quality signal).

## Time session log ("what was done")
Time per application is already recorded (check-in/out) and shown as totals. Next:
- On check-out, optionally capture a one-line "what did you do this session?".
- Show a per-application **time journal**: each session = who · how long · when · note.
So a case carries a visible history: "Avneet — 1h 20m — added employment docs",
not just a total.

## Workload mixing ("2 big then 1 small")
Tag types big (LMIA/SOWP/VOWP/sponsorship/family) vs small (PGWP/TRV/VR/Study) and
have My Day suggest an interleaved order so nobody grinds three LMIAs in a row.
(Deadlines still override.)

## Reviewer "owner away" safety net
If a blocked reviewer (Serbleen/Parinita) is inactive, route their block to the
lead so simple types never get orphaned.

## Stable identity (name → user ID) — important
Time logs, reviewer blocks, and performance stats are all keyed by **display name**
(or first name). This is fragile: a rename splits a person's history, two people
sharing a name merge, and first-name collisions mis-route the reviewer queue.
Fix: key time logs, REVIEWER_BLOCKS, and performance aggregation on a stable
`user_id`/email, not the display name. (Audit: H1/H4/M7.)

## Correction attribution at write-time
Corrections (review "changes needed") are counted against a case's *current*
assignee. If a case is reassigned after the flag, the error moves to the new
person. Fix: stamp the preparer's name/id into the note when the reviewer raises
it, and attribute from that — not the live case. (Audit: H2.)

## Unify the two performance boards
The old `/admin/performance` (errors board) and the new `/admin/performance-review`
disagree on who's a "preparer" and use a hardcoded `EXCLUDED_NAMES` first-name list
that can hide real people (e.g. a new "Aman" or "Simran"). Fix: one shared
preparer-eligibility helper + an `excludeFromPerformance` per-account flag keyed by
id, not name. (Audit: H5/M7.)

## Payments → accounting (auto)
Today a client payment is stored on the case (`amountPaid` / `paymentStatus`) but
does NOT flow into the Accounting module (which only has manual entries). Build:
when a case payment is recorded/updated, create or sync a matching accounting
entry (client, case, amount, date), so accounting reflects money received without
manual re-entry. Surface received-by-month + outstanding.

## Tasker call log — operational checklist (not a code bug)
`/api/incoming-call` (the Tasker webhook) requires `TASKER_WEBHOOK_SECRET` and a
matching `X-Webhook-Secret` header. If call logs stop, it's almost always: (a) the
env var changed/missing in Railway, (b) the Tasker profile/app on the office phone
stopped running, or (c) the webhook URL/secret in Tasker drifted. Add an admin
"last call-log received at" indicator + a test-ping so this is diagnosable in-app.

## Re-submit-for-review action
A clean "send back for review" for preparers after fixing changes, so the review
status model isn't overloaded (changes_done currently does double duty).
