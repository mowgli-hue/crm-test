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

## Re-submit-for-review action
A clean "send back for review" for preparers after fixing changes, so the review
status model isn't overloaded (changes_done currently does double duty).
