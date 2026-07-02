"""
fill_plan.py — turn a case's field values into an ORDERED, technique-annotated
checklist that the human-typing runner follows to fill an IRCC form in Acrobat.

This is the "what to type, in what order, and how" brain. The computer-use runner
supplies the "where" (locate each field on the live screenshot) and verifies each
value with a zoom. Splitting it this way is what makes typing reliable instead of
improvised — every quirk in ../AGENT_FORM_FILLING_MEMORY.md is encoded here once.

A step is a dict:
    {
      "page":     1..5,               # which form page it's on
      "section":  "Personal Details", # human context
      "label":    "Family name",      # the visible label to locate
      "value":    "Singh",            # what to enter (already mapped)
      "widget":   "text" | "date_parts" | "dropdown_cycle" | "dropdown_pick"
                  | "yn_indicator" | "checkbox" | "radio_purpose",
      "technique":"...",              # exact how-to for the runner
      "verify":   True,               # zoom-verify after entering
    }

`build_plan(form_data, form_id)` returns the list. `form_data` uses the same
EMPTY_CLIENT keys the mappers/`make_import_data` already produce, so there is ONE
value source feeding both approaches.
"""
from __future__ import annotations

# Known dropdown letter-cycle recipes from AGENT_FORM_FILLING_MEMORY.md.
# key = value we want; value = (first_letter, presses, note)
COUNTRY_CYCLE = {
    "India":  ("i", 2, "press 'i' twice (Iceland -> India), then Return"),
    "Canada": ("c", 4, "press 'c' 4x (CaboVerde->Cambodia->Cameroon->Canada), then Return"),
}
# Passport 'Country of issue' uses 3-LETTER codes list; India = 'i','i' (IDN->IND).
PASSPORT_COUNTRY_CYCLE = {
    "India": ("i", 2, "3-letter-code list: press 'i' twice (IDN->IND), then Return"),
}
LANGUAGE_CYCLE = {
    "Punjabi": ("p", 23, "press 'p' 23x SINGLE presses (Pahari..Punjabi), then Return "
                          "— NEVER key-repeat; Acrobat reads 'ppp' as a search string"),
    "English": ("e", 1, "press 'e' to reach English, then Return"),
}

# IRCC marital-status codes -> the label shown in the dropdown (what to type/pick).
MARITAL_LABELS = {
    "01": "Married", "02": "Single", "03": "Common-Law", "04": "Divorced",
    "05": "Separated", "06": "Widowed", "07": "Unknown", "09": "Annulled Marriage",
}


def _sv(fd, *keys, default=""):
    for k in keys:
        v = fd.get(k)
        if v not in (None, "", False):
            return v
    return default


def _dropdown(label, value, page, section, table):
    rec = table.get(value)
    if rec:
        letter, n, note = rec
        tech = f"open dropdown arrow, {note}"
    else:
        letter = (value[:1] or "").lower()
        tech = (f"open dropdown arrow, press '{letter}' repeatedly to CYCLE to "
                f"'{value}', then Return (verify — count unknown for this value)")
    return {"page": page, "section": section, "label": label, "value": value,
            "widget": "dropdown_cycle", "technique": tech, "verify": True}


def build_plan(form_data: dict, form_id: str = "imm5710") -> list:
    if form_id != "imm5710":
        raise ValueError(f"fill_plan currently covers imm5710; got {form_id}. "
                         "Add pages for the other forms the same way.")
    fd = form_data
    P = []  # plan

    # ── PAGE 1 ──────────────────────────────────────────────────────────
    # Application type (Box 3). PGWP convention = "first time or new employer".
    if _sv(fd, "applying_change_employer") or _sv(fd, "applying_extend_stay"):
        P.append({"page": 1, "section": "Application type",
                  "label": "Apply for a work permit for the first time or with a new employer",
                  "value": "check", "widget": "checkbox",
                  "technique": "single left-click the checkbox; zoom to confirm the check landed",
                  "verify": True})
    if _sv(fd, "uci_client_id"):
        P.append({"page": 1, "section": "Personal Details", "label": "UCI",
                  "value": _sv(fd, "uci_client_id"), "widget": "text",
                  "technique": "TYPE DIGITS ONLY, no hyphens (hyphens turn the field red)",
                  "verify": True})
    P.append({"page": 1, "section": "Personal Details", "label": "Family name",
              "value": _sv(fd, "family_name"), "widget": "text",
              "technique": "click field, type passport surname exactly", "verify": True})
    P.append({"page": 1, "section": "Personal Details", "label": "Given name(s)",
              "value": _sv(fd, "given_name"), "widget": "text",
              "technique": "click field, type given name(s) exactly", "verify": True})
    P.append({"page": 1, "section": "Personal Details",
              "label": "Have you ever used any other name? (2a)",
              "value": "Yes" if _sv(fd, "has_alias") else "No", "widget": "yn_indicator",
              "technique": "click the No box (or Yes + fill alias). Validate reddens it if missed",
              "verify": True})
    P.append({"page": 1, "section": "Personal Details", "label": "Sex",
              "value": _sv(fd, "sex"), "widget": "dropdown_pick",
              "technique": "click dropdown, pick M Male / F Female", "verify": True})
    # DOB — separate YYYY/MM/DD that auto-advance.
    P.append({"page": 1, "section": "Personal Details", "label": "Date of birth",
              "value": f'{_sv(fd,"dob_year")}-{_sv(fd,"dob_month")}-{_sv(fd,"dob_day")}',
              "widget": "date_parts",
              "technique": "click YYYY box, type 4-digit year; focus auto-jumps to MM then DD — "
                           "keep typing, do NOT pre-click MM/DD", "verify": True})
    P.append({"page": 1, "section": "Personal Details", "label": "Place of birth — City/Town",
              "value": _sv(fd, "place_birth_city"), "widget": "text",
              "technique": "click field, type city", "verify": True})
    P.append(_dropdown("Place of birth — Country", _sv(fd, "place_birth_country"),
                       1, "Personal Details", COUNTRY_CYCLE))
    P.append(_dropdown("Citizenship", _sv(fd, "citizenship_country"),
                       1, "Personal Details", COUNTRY_CYCLE))
    # Current country of residence (Canada pre-filled) — set Status + dates.
    P.append({"page": 1, "section": "Current residence", "label": "Current status",
              "value": _sv(fd, "current_status"), "widget": "dropdown_pick",
              "technique": "in the residence row, open Status dropdown; for PGWP pick Student "
                           "(the study permit)", "verify": True})
    P.append({"page": 1, "section": "Current residence", "label": "Status From date",
              "value": _sv(fd, "current_status_from_date"), "widget": "date_parts",
              "technique": "type YYYY-MM-DD (study-permit validity From)", "verify": True})
    P.append({"page": 1, "section": "Current residence", "label": "Status To date",
              "value": _sv(fd, "current_status_to_date"), "widget": "date_parts",
              "technique": "type YYYY-MM-DD (study-permit validity To)", "verify": True})
    P.append({"page": 1, "section": "Current residence",
              "label": "Lived in another country >6 months? (8a)",
              "value": "Yes" if _sv(fd, "prev_country_1") else "No", "widget": "yn_indicator",
              "technique": "click No for a normal PGWP applicant", "verify": True})
    _marital = _sv(fd, "marital_status")
    P.append({"page": 1, "section": "Marital status", "label": "Current marital status",
              "value": MARITAL_LABELS.get(str(_marital), _marital), "widget": "dropdown_pick",
              "technique": "open dropdown; Single = press 's','s' (Separated->Single), Return", "verify": True})

    # ── PAGE 2 ──────────────────────────────────────────────────────────
    P.append({"page": 2, "section": "Marital status", "label": "Previously married / common-law?",
              "value": "Yes" if _sv(fd, "previously_married") else "No", "widget": "yn_indicator",
              "technique": "click No unless previously married", "verify": True})
    P.append(_dropdown("Native language", _sv(fd, "native_language"),
                       2, "Languages", LANGUAGE_CYCLE))
    P.append({"page": 2, "section": "Languages", "label": "Able to communicate in Eng/Fre",
              "value": _sv(fd, "communicate_language"), "widget": "dropdown_pick",
              "technique": "pick English / French / Both / Neither", "verify": True})
    P.append({"page": 2, "section": "Languages", "label": "Taken a language test?",
              "value": "Yes" if _sv(fd, "language_test_taken") else "No", "widget": "yn_indicator",
              "technique": "PGWP clients usually Yes (IELTS)", "verify": True})
    P.append({"page": 2, "section": "Passport", "label": "Passport number",
              "value": _sv(fd, "passport_number"), "widget": "text",
              "technique": "type exactly as on passport", "verify": True})
    P.append(_dropdown("Passport — Country of issue", _sv(fd, "passport_country"),
                       2, "Passport", PASSPORT_COUNTRY_CYCLE))
    P.append({"page": 2, "section": "Passport", "label": "Passport issue date",
              "value": f'{_sv(fd,"passport_issue_year")}-{_sv(fd,"passport_issue_month")}-{_sv(fd,"passport_issue_day")}',
              "widget": "date_parts", "technique": "type YYYY MM DD", "verify": True})
    P.append({"page": 2, "section": "Passport", "label": "Passport expiry date",
              "value": f'{_sv(fd,"passport_expiry_year")}-{_sv(fd,"passport_expiry_month")}-{_sv(fd,"passport_expiry_day")}',
              "widget": "date_parts",
              "technique": "type YYYY-MM-DD; this box does NOT auto-insert dashes — type them "
                           "explicitly, then zoom-verify", "verify": True})
    P.append({"page": 2, "section": "National ID", "label": "Do you have a national ID?",
              "value": "Yes" if _sv(fd, "has_national_id") else "No", "widget": "yn_indicator",
              "technique": "click No for ~99% of clients", "verify": True})
    P.append({"page": 2, "section": "US card", "label": "US PR card (green card)?",
              "value": "Yes" if _sv(fd, "has_us_card") else "No", "widget": "yn_indicator",
              "technique": "click No", "verify": True})
    # Mailing address
    for lbl, key, tech in [
        ("Mailing — Street number", "mailing_street_num", "type street number"),
        ("Mailing — Street name", "mailing_street_name", "type street name"),
        ("Mailing — City/Town", "mailing_city", "type city"),
        ("Mailing — Postal code", "mailing_postal_code", "type postal code"),
    ]:
        if _sv(fd, key):
            P.append({"page": 2, "section": "Contact", "label": lbl, "value": _sv(fd, key),
                      "widget": "text", "technique": tech, "verify": True})
    P.append(_dropdown("Mailing — Country", _sv(fd, "mailing_country", default="Canada"),
                       2, "Contact", COUNTRY_CYCLE))
    P.append({"page": 2, "section": "Contact", "label": "Mailing — Province",
              "value": _sv(fd, "mailing_province"), "widget": "dropdown_pick",
              "technique": "open arrow, click the 2-letter code (e.g. BC)", "verify": True})
    P.append({"page": 2, "section": "Contact", "label": "Phone — number",
              "value": _sv(fd, "phone_actual_number"), "widget": "text",
              "technique": "set Canada/US + type area/first-three/last digits into the split boxes; "
                           "scroll field above the floating 'Ask AI' bar first or text lands in the bar",
              "verify": True})
    if _sv(fd, "email"):
        P.append({"page": 2, "section": "Contact", "label": "Email", "value": _sv(fd, "email"),
                  "widget": "text", "technique": "type email", "verify": True})

    # ── PAGE 3 ──────────────────────────────────────────────────────────
    P.append({"page": 3, "section": "Coming into Canada", "label": "Original entry date",
              "value": _sv(fd, "original_entry_date"), "widget": "date_parts",
              "technique": "type YYYY-MM-DD", "verify": True})
    P.append({"page": 3, "section": "Coming into Canada", "label": "Original entry place",
              "value": _sv(fd, "original_entry_place"), "widget": "text",
              "technique": "type port/city of first entry", "verify": True})
    P.append({"page": 3, "section": "Coming into Canada", "label": "Purpose of original entry",
              "value": _sv(fd, "original_entry_purpose"), "widget": "dropdown_pick",
              "technique": "pick Visit/Study/Work/Other", "verify": True})
    if _sv(fd, "work_permit_type"):
        P.append({"page": 3, "section": "Details of work", "label": "Work permit type",
                  "value": _sv(fd, "work_permit_type"), "widget": "dropdown_pick",
                  "technique": "PGWP = 'Post Graduation Work Permit'. LEAVE employer/location/"
                               "occupation/duration BLANK (open work permit)", "verify": True})
    # Education (one row)
    if _sv(fd, "has_education") or _sv(fd, "edu_school_name"):
        P.append({"page": 3, "section": "Education", "label": "Have post-secondary education?",
                  "value": "Yes", "widget": "yn_indicator", "technique": "click Yes", "verify": True})
        P.append({"page": 3, "section": "Education", "label": "Education From (YYYY-MM)",
                  "value": f'{_sv(fd,"edu_from_year")}-{_sv(fd,"edu_from_month")}',
                  "widget": "date_parts", "technique": "type year then month", "verify": True})
        P.append({"page": 3, "section": "Education", "label": "Field of study",
                  "value": _sv(fd, "edu_field_of_study"), "widget": "text",
                  "technique": "type field/level", "verify": True})
        P.append({"page": 3, "section": "Education", "label": "School",
                  "value": _sv(fd, "edu_school_name"), "widget": "text",
                  "technique": "type institution name", "verify": True})
        P.append({"page": 3, "section": "Education", "label": "Education To (YYYY-MM)",
                  "value": f'{_sv(fd,"edu_to_year")}-{_sv(fd,"edu_to_month")}',
                  "widget": "date_parts", "technique": "type year then month", "verify": True})
        P.append({"page": 3, "section": "Education", "label": "School city",
                  "value": _sv(fd, "edu_city"), "widget": "text", "technique": "type city", "verify": True})
        P.append(_dropdown("Education — Country", _sv(fd, "edu_country", default="Canada"),
                           3, "Education", COUNTRY_CYCLE))
        P.append({"page": 3, "section": "Education", "label": "School province",
                  "value": _sv(fd, "edu_province"), "widget": "dropdown_pick",
                  "technique": "click 2-letter code", "verify": True})

    # ── EMPLOYMENT (page 3 row1, page 4 rows 2-3) ───────────────────────
    emp = fd.get("employment", []) or []
    emp_pages = [3, 4, 4]
    for i, job in enumerate(emp[:3]):
        pg = emp_pages[i]
        P.append({"page": pg, "section": f"Employment row {i+1}",
                  "label": f"Employment {i+1} — From (YYYY-MM)",
                  "value": f'{job.get("from_year","")}-{job.get("from_month","")}',
                  "widget": "date_parts", "technique": "type year then month", "verify": True})
        P.append({"page": pg, "section": f"Employment row {i+1}",
                  "label": f"Employment {i+1} — Occupation", "value": job.get("occupation", ""),
                  "widget": "text", "technique": "type occupation (PGWP row1 = 'Unemployed')", "verify": True})
        P.append({"page": pg, "section": f"Employment row {i+1}",
                  "label": f"Employment {i+1} — Employer", "value": job.get("employer", ""),
                  "widget": "text", "technique": "type employer ('Not Applicable' for the unemployed row)", "verify": True})
        P.append({"page": pg, "section": f"Employment row {i+1}",
                  "label": f"Employment {i+1} — To (YYYY-MM)",
                  "value": f'{job.get("to_year","")}-{job.get("to_month","")}'.strip("-"),
                  "widget": "date_parts", "technique": "type year then month (blank = ongoing)", "verify": True})
        P.append({"page": pg, "section": f"Employment row {i+1}",
                  "label": f"Employment {i+1} — City", "value": job.get("city", ""),
                  "widget": "text", "technique": "type city", "verify": True})
        P.append(_dropdown(f"Employment {i+1} — Country", job.get("country", "Canada"),
                           pg, f"Employment row {i+1}", COUNTRY_CYCLE))
        P.append({"page": pg, "section": f"Employment row {i+1}",
                  "label": f"Employment {i+1} — Prov/State", "value": job.get("prov_state", ""),
                  "widget": "dropdown_pick", "technique": "click 2-letter code", "verify": True})

    # ── PAGE 4 — Background questions (Y/N indicators) ──────────────────
    bg = [
        ("Medical condition needing treatment?", _sv(fd, "has_medical_condition")),
        ("Previously applied / refused a visa or permit?", _sv(fd, "prev_application_refused")),
        ("Refused specifically for Canada?", _sv(fd, "prev_refused_to_canada")),
        ("Criminal record?", _sv(fd, "has_criminal_record")),
        ("Military / paramilitary service?", _sv(fd, "has_military_service")),
        ("Held a government position?", _sv(fd, "held_government_position")),
        ("Witnessed ill-treatment of prisoners?", _sv(fd, "witnessed_ill_treatment")),
    ]
    for label, val in bg:
        P.append({"page": 4, "section": "Background", "label": label,
                  "value": "Yes" if val else "No", "widget": "yn_indicator",
                  "technique": "click Yes/No; each sub-question is independent (all No if umbrella is No)",
                  "verify": True})
    if _sv(fd, "prev_refused_details"):
        P.append({"page": 4, "section": "Background", "label": "Refusal details (2d)",
                  "value": _sv(fd, "prev_refused_details"), "widget": "text",
                  "technique": "type full detail; press Home + zoom to confirm the whole string stored",
                  "verify": True})

    # ── SIGNATURE — leave blank (applicant signs). Then VALIDATE. ────────
    P.append({"page": 5, "section": "Signature", "label": "Signature & date",
              "value": "LEAVE BLANK", "widget": "text",
              "technique": "do NOT fill — the applicant signs. Form still validates without it",
              "verify": False})
    P.append({"page": 1, "section": "Validate", "label": "Validate button",
              "value": "click", "widget": "checkbox",
              "technique": "jump to page 1 (type '1' in page box, Return), click blue Validate. "
                           "Missing required fields turn RED — fix those, re-Validate. Success = "
                           "barcode page appended + 'Validated' stamp", "verify": True})
    return P


if __name__ == "__main__":
    import json, sys
    data = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else {}
    plan = build_plan(data)
    print(f"{len(plan)} steps")
    for i, s in enumerate(plan, 1):
        print(f'{i:2} p{s["page"]} [{s["widget"]:14}] {s["label"]}: {s["value"]!r}')
