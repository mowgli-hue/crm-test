"""
strategy.py — the agent's JUDGMENT layer.

After the mechanical fill, a real caseworker steps back and thinks: is this case
actually strong? what's missing? what's strategically risky for THIS application
type? what do we still need from the client? This module produces that thinking
as a structured **team handoff note** — it never decides the case, it surfaces
what a human must decide.

Design:
  - A per-application-type RUBRIC holds the strategic knowledge (required docs,
    judgment checks, and the client questions to raise when something's missing).
    Training a new type = adding a rubric entry. PGWP is seeded from the playbooks.
  - `build_handoff_note(case, form_data, cfg, readiness=None)` runs gap analysis +
    the rubric and returns {sections dict, markdown}. The pipeline saves the
    markdown to the case's Drive folder and files a team task.

Output sections:
  1. SUMMARY        type, applicant, completeness
  2. DONE           what the agent filled/assembled
  3. LEFT TO DO     concrete missing fields/docs (mechanical)
  4. STRATEGIC      type-specific judgment flags a human must confirm
  5. ASK THE CLIENT specific outstanding questions to send the client
"""
from __future__ import annotations

# Identity fields that must come from documents (blank = not review-ready).
IDENTITY_FIELDS = ["family_name", "given_name", "dob_year", "passport_number",
                   "passport_expiry_year", "citizenship_country"]


def _blank(fd: dict, key: str) -> bool:
    return not str(fd.get(key, "")).strip()


# ── Per-application-type strategic rubric (extensible; train more here) ──────
# Each entry:
#   required_docs:   docs the package needs (checked against case['docs'] names)
#   checks:          [(id, human question the reviewer must confirm, why it matters)]
#   client_asks:     [(condition_fn(fd, case) -> bool, question to send client)]
RUBRIC = {
    "PGWP": {
        "label": "Post-Graduation Work Permit",
        "required_docs": ["passport", "study_permit", "completion_letter",
                          "transcripts", "language_test", "photo"],
        "checks": [
            ("status_timeline",
             "Confirm the status timeline is continuous from first entry to today "
             "(study permit dates vs. current status) — any gap means restoration is needed.",
             "A gap without restoration is a refusal trigger."),
            ("pgwp_eligibility_window",
             "Confirm the PGWP is filed within 180 days of the completion letter and "
             "the study permit was valid at completion.",
             "PGWP eligibility is time-boxed; late filing is refused."),
            ("employment_convention",
             "Confirm current-activity = 'Unemployed' (From = month after completion, "
             "employer 'N/A') and the study-period job moved to a past row.",
             "Newton PGWP convention; a blank employer row fails Validate."),
            ("open_work_permit",
             "Confirm the work section lists ONLY 'Post Graduation Work Permit' with "
             "employer/location/duration left blank (open permit).",
             "PGWP is employer-unrestricted; employer detail is wrong."),
            ("refusal_disclosure",
             "Confirm ALL prior refusals (any country) are disclosed in Background Q2 "
             "with accurate dates/reasons — even if the rep letter omits them.",
             "Non-disclosure = misrepresentation (5-year bar)."),
        ],
        "client_asks": [
            (lambda fd, c: _blank(fd, "language_test_taken") or str(fd.get("language_test_taken")).lower() in ("false", "no", ""),
             "Please send your IELTS/CELPIP/PTE result (language test report)."),
            (lambda fd, c: bool(fd.get("prev_application_refused")) and len(str(fd.get("prev_refused_details", ""))) < 25,
             "You noted a prior refusal — please give the full details: which country/visa, the date, and the refusal reason letter."),
        ],
    },
    # --- seed rows for other types; fill `checks`/`client_asks` during training ---
    "VisitorRecord": {"label": "Visitor Record", "required_docs": ["passport"], "checks": [], "client_asks": []},
    "TRV": {"label": "Temporary Resident Visa", "required_docs": ["passport", "photo"], "checks": [], "client_asks": []},
    "StudyPermitExtension": {"label": "Study Permit Extension",
                             "required_docs": ["passport", "study_permit", "transcripts"], "checks": [], "client_asks": []},
}


def _completeness(fd: dict, required_docs: list, present_docs: set):
    missing_fields = [k for k in IDENTITY_FIELDS if _blank(fd, k)]
    missing_docs = [d for d in required_docs if d not in present_docs]
    total = len(IDENTITY_FIELDS) + len(required_docs)
    have = total - len(missing_fields) - len(missing_docs)
    pct = round(100 * have / total) if total else 0
    return missing_fields, missing_docs, pct


def build_handoff_note(case: dict, form_data: dict, cfg: dict,
                       readiness: dict = None) -> dict:
    app_type = case.get("app_type", "")
    fd = form_data or {}
    rub = RUBRIC.get(app_type, {"label": app_type or "Unknown", "required_docs": [],
                                "checks": [], "client_asks": []})
    present_docs = set()
    for d in case.get("docs", []):
        name = (d.get("type") or d.get("name") or "").lower()
        present_docs.update(k for k in rub["required_docs"] if k.replace("_", " ") in name or k in name)

    missing_fields, missing_docs, pct = _completeness(fd, rub["required_docs"], present_docs)

    # Auto-detected strategic flags from the data itself.
    auto_flags = []
    if fd.get("prev_application_refused"):
        auto_flags.append("Prior refusal present — verify full disclosure + reasons (misrepresentation risk).")
    exp = str(fd.get("passport_expiry_year", "")).strip()
    if exp.isdigit() and int(exp) <= 2026:
        auto_flags.append(f"Passport expires {exp} — a permit is not issued past passport validity; confirm renewal.")
    if _blank(fd, "current_status_to_date"):
        auto_flags.append("Current status 'To' date blank — confirm status validity / restoration need.")

    # Client asks: rubric conditions that fire + any missing required doc.
    client_asks = [q for cond, q in rub["client_asks"] if _safe(cond, fd, case)]
    for d in missing_docs:
        client_asks.append(f"Please send your {d.replace('_', ' ')}.")

    applicant = f"{fd.get('given_name','')} {fd.get('family_name','')}".strip() or case.get("client", "")

    # ── assemble markdown ──
    L = []
    L.append(f"# Case Handoff — {case.get('case_id','')} · {rub['label']}")
    L.append(f"**Applicant:** {applicant or '—'}  |  **Review-readiness:** {pct}%")
    L.append("_Prepared by the processing agent. A human must review every field and decide the case; nothing is submitted._\n")

    L.append("## ✅ Done (agent completed)")
    L.append("- Mapped intake → form fields and generated the cert-safe fill script for the required forms.")
    L.append("- Assembled available client documents into the package.\n")

    L.append("## 📋 Left to do (mechanical)")
    if missing_fields:
        L.append(f"- Extract/confirm these identity fields (still blank): {', '.join(missing_fields)}.")
    if missing_docs:
        L.append(f"- Missing documents for this type: {', '.join(d.replace('_',' ') for d in missing_docs)}.")
    if not missing_fields and not missing_docs:
        L.append("- Nothing outstanding on the mechanical side.")
    L.append("")

    L.append("## 🧭 Strategic — confirm before filing")
    for _id, question, why in rub["checks"]:
        L.append(f"- [ ] {question}  \n  _Why:_ {why}")
    for f in auto_flags:
        L.append(f"- [ ] ⚠️ {f}")
    if not rub["checks"] and not auto_flags:
        L.append("- (No strategic rubric for this type yet — add one in strategy.py RUBRIC.)")
    L.append("")

    L.append("## 📨 Ask the client")
    if client_asks:
        for q in client_asks:
            L.append(f"- {q}")
    else:
        L.append("- Nothing outstanding to request.")
    L.append("")

    md = "\n".join(L)
    return {
        "case_id": case.get("case_id"),
        "app_type": app_type,
        "readiness_pct": pct,
        "missing_fields": missing_fields,
        "missing_docs": missing_docs,
        "strategic_checks": [q for _i, q, _w in rub["checks"]] + auto_flags,
        "client_asks": client_asks,
        "markdown": md,
    }


def _safe(fn, fd, case):
    try:
        return bool(fn(fd, case))
    except Exception:
        return False


if __name__ == "__main__":
    import json, sys
    fd = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else {}
    case = {"case_id": "CASE-1611", "app_type": "PGWP", "client": "Lovepreet Singh",
            "docs": [{"type": "passport"}, {"type": "study_permit"}]}
    note = build_handoff_note(case, fd, {})
    print(note["markdown"])
