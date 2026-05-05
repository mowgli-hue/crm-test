"""
IMM5710 Auto-Fill Script — Generic CRM Edition
===============================================
Drop this file into your CRM backend. When a client completes the intake
questionnaire, call fill_imm5710(client_data, input_pdf, output_pdf).

HOW YOUR CRM SHOULD CALL THIS:
───────────────────────────────
    from fill_imm5710 import fill_imm5710, EMPTY_CLIENT

    # Start with the empty template
    client = EMPTY_CLIENT.copy()

    # Fill in whatever your CRM has collected
    client["family_name"]    = crm.get_answer("What is your family name?")
    client["given_name"]     = crm.get_answer("What is your given name?")
    client["sex"]            = crm.get_answer("What is your sex?")
    # ... etc for each section

    # Generate the filled PDF
    output_path = fill_imm5710(client, "blank_imm5710.pdf", f"imm5710_{case_id}.pdf")

REQUIREMENTS:
    pip install pypdf

SECTIONS:
    Section 1  – Application Type
    Section 2  – Personal Information
    Section 3  – Current & Previous Status in Canada
    Section 4  – Marital Status
    Section 5  – Languages
    Section 6  – Travel Documents
    Section 7  – Contact Information
    Section 8  – Entry to Canada
    Section 9  – Education
    Section 10 – Employment History (up to 3)
    Section 11 – Background Questions
"""

from pypdf import PdfReader, PdfWriter
import pikepdf
import xml.etree.ElementTree as ET


# ══════════════════════════════════════════════════════════════════
#  EMPTY CLIENT TEMPLATE
#  ──────────────────────
#  This is the master list of every CRM question key.
#  Your CRM should populate each key from its intake answers.
#  Leave as "" or False if not collected / not applicable.
# ══════════════════════════════════════════════════════════════════
EMPTY_CLIENT = {

    # ── SECTION 1: What are you applying for? ────────────────────
    # CRM Question: "What are you applying for?" (multi-select)
    "applying_restore_status":       False,   # Restore my status
    "applying_extend_stay":          False,   # Extend my stay (PGWP / visitor / student)
    "applying_change_employer":      False,   # Change employer or conditions
    "applying_trp":                  False,   # Temporary Resident Permit

    # ── SECTION 2: Personal Information ─────────────────────────
    # CRM Question: "What is your UCI / Client ID?" (optional)
    "uci_client_id":                 "",

    # CRM Question: "What is your family (last) name?"
    "family_name":                   "",
    # CRM Question: "What is your given (first) name?"
    "given_name":                    "",

    # CRM Question: "Have you ever used a different name?"
    "has_alias":                     False,
    # CRM Question: "Other family name used"
    "alias_family_name":             "",
    # CRM Question: "Other given name used"
    "alias_given_name":              "",

    # CRM Question: "What is your sex?"
    # Options: Female | Male | Unknown | Unspecified
    "sex":                           "",

    # CRM Question: "What is your date of birth?" (YYYY-MM-DD)
    "dob_year":                      "",      # YYYY
    "dob_month":                     "",      # MM
    "dob_day":                       "",      # DD

    # CRM Question: "What city were you born in?"
    "place_birth_city":              "",
    # CRM Question: "What country were you born in?"
    "place_birth_country":           "",
    # CRM Question: "What is your country of citizenship?"
    "citizenship_country":           "",

    # ── SECTION 3: Current & Previous Status in Canada ───────────
    # CRM Question: "What is your current immigration status in Canada?"
    # Options: Student | Worker | Visitor | Other
    "current_status":                "",
    "current_status_other":          "",      # If "Other" selected
    # CRM Question: "What date did your current status start?" (YYYY-MM-DD)
    "current_status_from_date":      "",
    # CRM Question: "What date does your current status expire?" (YYYY-MM-DD)
    "current_status_to_date":        "",

    # CRM Question: "List any previous countries of residence (1st)"
    "prev_country_1":                "",
    "prev_status_1":                 "",
    "prev_status_other_1":           "",
    "prev_from_date_1":              "",      # YYYY-MM-DD
    "prev_to_date_1":                "",      # YYYY-MM-DD

    # CRM Question: "List any previous countries of residence (2nd)"
    "prev_country_2":                "",
    "prev_status_2":                 "",
    "prev_status_other_2":           "",
    "prev_from_date_2":              "",
    "prev_to_date_2":                "",

    # ── SECTION 4: Marital Status ────────────────────────────────
    # CRM Question: "What is your current marital status?"
    # Options: Single | Married | Common-Law | Separated | Divorced | Widowed | Annulled Marriage | Unknown
    "marital_status":                "",

    # CRM Question: "Spouse / partner family name" (if Married or Common-Law)
    "spouse_family_name":            "",
    # CRM Question: "Spouse / partner given name"
    "spouse_given_name":             "",
    # CRM Question: "Date of marriage / start of relationship" (YYYY-MM-DD)
    "date_of_marriage":              "",
    # CRM Question: "What is your spouse's immigration status in Canada?"
    "spouse_status_in_canada":       "",

    # CRM Question: "Were you previously married or in a common-law relationship?"
    "previously_married":            False,
    "prev_spouse_family_name":       "",
    "prev_spouse_given_name":        "",
    # Options: Married | Common-Law | Other
    "prev_relationship_type":        "",
    "prev_marriage_from":            "",      # YYYY-MM-DD
    "prev_marriage_to":              "",      # YYYY-MM-DD
    "prev_spouse_dob_year":          "",
    "prev_spouse_dob_month":         "",
    "prev_spouse_dob_day":           "",

    # ── SECTION 5: Languages ─────────────────────────────────────
    # CRM Question: "What is your native language?"
    "native_language":               "",
    # CRM Question: "Which official language can you communicate in?"
    # Options: English | French | Both | Neither
    "communicate_language":          "",
    # CRM Question: "Have you taken an official language test (IELTS / CELPIP / TEF)?"
    "language_test_taken":           False,
    # CRM Question: "What language do you use most frequently?"
    "frequent_language":             "",

    # ── SECTION 6: Travel Documents ─────────────────────────────
    # CRM Question: "What is your passport number?"
    "passport_number":               "",
    # CRM Question: "What country issued your passport?"
    "passport_country":              "",
    # CRM Question: "What is your passport issue date?" (YYYY-MM-DD)
    "passport_issue_year":           "",
    "passport_issue_month":          "",
    "passport_issue_day":            "",
    # CRM Question: "What is your passport expiry date?" (YYYY-MM-DD)
    "passport_expiry_year":          "",
    "passport_expiry_month":         "",
    "passport_expiry_day":           "",

    # CRM Question: "Do you have a national identity document?"
    "has_national_id":               False,
    "national_id_number":            "",
    "national_id_country":           "",
    "national_id_issue_date":        "",
    "national_id_expiry_date":       "",

    # CRM Question: "Do you have a US Permanent Resident Card (Green Card)?"
    "has_us_card":                   False,
    "us_card_number":                "",
    "us_card_expiry_date":           "",

    # ── SECTION 7: Contact Information ──────────────────────────
    # CRM Question: "What is your mailing address?"
    "mailing_po_box":                "",
    "mailing_apt_unit":              "",
    "mailing_street_num":            "",
    "mailing_street_name":           "",
    "mailing_city":                  "",
    "mailing_province":              "",
    "mailing_postal_code":           "",
    "mailing_country":               "",
    "mailing_district":              "",

    # CRM Question: "Is your residential address the same as mailing?"
    "residential_same_as_mailing":   True,
    "residential_apt_unit":          "",
    "residential_street_num":        "",
    "residential_street_name":       "",
    "residential_city":              "",
    "residential_province":          "",
    "residential_country":           "",

    # CRM Question: "What is your phone number?"
    # phone_type: Canada/US | International
    "phone_type":                    "Canada/US",
    # phone_number_type: Mobile | Home | Work | Other
    "phone_number_type":             "Mobile",
    "phone_area_code":               "",
    "phone_first_three":             "",
    "phone_last_five":               "",
    "phone_extension":               "",
    "phone_intl_number":             "",      # If international

    # CRM Question: "Do you have an alternate phone number?"
    "alt_phone_area_code":           "",
    "alt_phone_first_three":         "",
    "alt_phone_last_five":           "",
    "alt_phone_extension":           "",

    # CRM Question: "What is your email address?"
    "email":                         "",

    # ── SECTION 8: Entry to Canada ───────────────────────────────
    # CRM Question: "What was your original entry date to Canada?" (YYYY-MM-DD)
    "original_entry_date":           "",
    # CRM Question: "Where did you first enter Canada? (city / port of entry)"
    "original_entry_place":          "",
    # CRM Question: "What was the purpose of your original entry?"
    # Options: Visit | Study | Work | Other
    "original_entry_purpose":        "",
    "original_entry_purpose_other":  "",

    # CRM Question: "What was your most recent entry date to Canada?" (YYYY-MM-DD)
    "recent_entry_date":             "",
    # CRM Question: "Where did you most recently enter Canada?"
    "recent_entry_place":            "",

    # CRM Question: "What is the number on your most recent permit or visa?"
    "previous_doc_number":           "",

    # CRM Question: "Are you applying to work?" (fills Details of Work section)
    "work_permit_type":              "",      # If blank, work section is skipped
    "work_permit_type_other":        "",
    "employer_name":                 "",
    "employer_address":              "",
    "work_location_province":        "",
    "work_location_city":            "",
    "work_location_address":         "",
    "job_title":                     "",
    "job_description":               "",
    "work_from_date":                "",
    "work_to_date":                  "",
    "lmo_number":                    "",      # Labour Market Opinion number
    "caq_cert_number":               "",      # Quebec CAQ certificate

    # ── SECTION 9: Education ─────────────────────────────────────
    # CRM Question: "Have you completed any post-secondary education?"
    "has_education":                 False,
    "edu_from_year":                 "",
    "edu_from_month":                "",
    "edu_field_of_study":            "",
    "edu_school_name":               "",
    "edu_to_year":                   "",
    "edu_to_month":                  "",
    "edu_city":                      "",
    "edu_country":                   "",
    "edu_province":                  "",

    # ── SECTION 10: Employment History ──────────────────────────
    # CRM Question: "List your employment history (last 10 years, most recent first)"
    # Each entry is a dict — add up to 3
    "employment": [
        # {
        #     "from_year":   "YYYY",
        #     "from_month":  "MM",
        #     "occupation":  "Job title",
        #     "employer":    "Company name",
        #     "to_year":     "YYYY",
        #     "to_month":    "MM",
        #     "city":        "City",
        #     "country":     "Country",
        #     "prov_state":  "Province or State",
        # }
    ],

    # ── SECTION 11: Background Questions ────────────────────────
    # CRM Question: "Do you have any physical or mental health conditions requiring treatment?"
    "has_medical_condition":         False,
    "medical_details":               "",

    # CRM Question: "Have you ever been refused a visa or permit to Canada or any other country?"
    "prev_application_refused":      False,
    # CRM Question: "Was the refusal specifically for Canada?"
    "prev_refused_to_canada":        False,
    # CRM Question: "Please provide details of all refusals"
    "prev_refused_details":          "",

    # CRM Question: "Have you ever been convicted of a crime in any country?"
    "has_criminal_record":           False,
    "criminal_details":              "",

    # CRM Question: "Have you served in any military, paramilitary, militia or civil defence unit?"
    "has_military_service":          False,
    "military_details":              "",

    # CRM Question: "Have you ever held a government position?"
    "held_government_position":      False,

    # CRM Question: "Have you ever witnessed or participated in the ill-treatment of prisoners?"
    "witnessed_ill_treatment":       False,
}


# ══════════════════════════════════════════════════════════════════
#  ENGINE — no changes needed below
# ══════════════════════════════════════════════════════════════════
XFA_NS = "http://www.xfa.org/schema/xfa-data/1.0/"

def _get_or_create(parent, tag):
    child = parent.find(tag)
    if child is None:
        child = ET.SubElement(parent, tag)
    return child

def _set_value(node, path, value):
    cur = node
    for tag in path:
        cur = _get_or_create(cur, tag)
    cur.text = str(value) if value not in (None, "", False) else None


def fill_imm5710(client: dict, input_pdf: str, output_pdf: str) -> str:
    """
    Fill IMM5710 from client dict and write to output_pdf.

    Args:
        client:     Dict of CRM answers. Use EMPTY_CLIENT as a base template.
        input_pdf:  Path to blank IMM5710 PDF (imm5710e.pdf from IRCC)
        output_pdf: Path where filled PDF will be saved

    Returns:
        output_pdf path
    """
    # Merge with empty template so missing keys don't cause KeyErrors
    data = {**EMPTY_CLIENT, **client}

    reader   = PdfReader(input_pdf)
    xfa_list = list(reader.trailer['/Root']['/AcroForm']['/XFA'])

    ds_stream = None
    for i in range(0, len(xfa_list), 2):
        if str(xfa_list[i]) == 'datasets':
            ds_stream = xfa_list[i + 1].get_object()
            break
    if ds_stream is None:
        raise RuntimeError("XFA datasets stream not found in PDF")

    root = ET.fromstring(ds_stream.get_data().decode('utf-8'))
    xfa_data = next(
        (c for c in root if c.tag.endswith('}data') or c.tag == 'xfa:data'),
        None
    )
    if xfa_data is None:
        raise RuntimeError("xfa:data element not found")

    form1 = _get_or_create(xfa_data, 'form1')

    def sv(value, *path):
        """Set value at path under form1. Skips empty/False values."""
        if value not in (None, "", False):
            _set_value(form1, list(path), value)

    # ── SECTION 1: Application Type ──────────────────────────────
    sv("1" if data["applying_restore_status"]  else "0", "Page1","PersonalDetails","ApplyingFor","RestoreStat")
    sv("1" if data["applying_extend_stay"]     else "0", "Page1","PersonalDetails","ApplyingFor","Extend")
    sv("1" if data["applying_change_employer"] else "0", "Page1","PersonalDetails","ApplyingFor","NewEmployer")
    sv("1" if data["applying_trp"]             else "0", "Page1","PersonalDetails","ApplyingFor","TRP")

    # ── SECTION 2: Personal Information ──────────────────────────
    sv(data["uci_client_id"],       "Page1","PersonalDetails","ServiceIn","UCIClientID")
    sv(data["family_name"],         "Page1","PersonalDetails","Name","FamilyName")
    sv(data["given_name"],          "Page1","PersonalDetails","Name","GivenName")
    # Alias / "Have you ever used another name": always tick the indicator
    # (Y or N) so the form has a definitive answer, never a blank box. Verified
    # against Paras's filed form: the indicator value is the literal character
    # "Y" or "N", not "1"/"0".
    if data["has_alias"]:
        sv(data["alias_family_name"], "Page1","PersonalDetails","AliasName","AliasFamilyName")
        sv(data["alias_given_name"],  "Page1","PersonalDetails","AliasName","AliasGivenName")
        sv("Y",                       "Page1","PersonalDetails","AliasName","AliasNameIndicator","AliasNameIndicator")
    else:
        sv("N",                       "Page1","PersonalDetails","AliasName","AliasNameIndicator","AliasNameIndicator")
    sv(data["sex"],                 "Page1","PersonalDetails","q3-4-5","sex","Sex")
    sv(data["dob_day"],             "Page1","PersonalDetails","q3-4-5","dob","DOBDay")
    sv(data["dob_month"],           "Page1","PersonalDetails","q3-4-5","dob","DOBMonth")
    sv(data["dob_year"],            "Page1","PersonalDetails","q3-4-5","dob","DOBYear")
    sv(data["place_birth_city"],    "Page1","PersonalDetails","q3-4-5","pob","PlaceBirthCity")
    sv(data["place_birth_country"], "Page1","PersonalDetails","q3-4-5","pob","PlaceBirthCountry")
    sv(data["citizenship_country"], "Page1","PersonalDetails","Citizenship","Citizenship")

    # ── SECTION 3: Status in Canada ───────────────────────────────
    sv(data["current_status"],           "Page1","PersonalDetails","CurrentCOR","CurrentCOR","Row2","Status")
    sv(data["current_status_other"],     "Page1","PersonalDetails","CurrentCOR","CurrentCOR","Row2","Other")
    sv(data["current_status_from_date"], "Page1","PersonalDetails","CurrentCOR","CurrentCOR","Row2","FromDate")
    sv(data["current_status_to_date"],   "Page1","PersonalDetails","CurrentCOR","CurrentCOR","Row2","ToDate")
    if data["prev_country_1"]:
        sv(data["prev_country_1"],       "Page1","PersonalDetails","PrevCOR","PreviousCOR","Row2","Country")
        sv(data["prev_status_1"],        "Page1","PersonalDetails","PrevCOR","PreviousCOR","Row2","Status")
        sv(data["prev_status_other_1"],  "Page1","PersonalDetails","PrevCOR","PreviousCOR","Row2","Other")
        sv(data["prev_from_date_1"],     "Page1","PersonalDetails","PrevCOR","PreviousCOR","Row2","FromDate")
        sv(data["prev_to_date_1"],       "Page1","PersonalDetails","PrevCOR","PreviousCOR","Row2","ToDate")
    if data["prev_country_2"]:
        sv(data["prev_country_2"],       "Page1","PersonalDetails","PrevCOR","PreviousCOR","Row3","Country")
        sv(data["prev_status_2"],        "Page1","PersonalDetails","PrevCOR","PreviousCOR","Row3","Status")
        sv(data["prev_status_other_2"],  "Page1","PersonalDetails","PrevCOR","PreviousCOR","Row3","Other")
        sv(data["prev_from_date_2"],     "Page1","PersonalDetails","PrevCOR","PreviousCOR","Row3","FromDate")
        sv(data["prev_to_date_2"],       "Page1","PersonalDetails","PrevCOR","PreviousCOR","Row3","ToDate")

    # ── SECTION 4: Marital Status ─────────────────────────────────
    # marital_status is the numeric IRCC code ("01"=Married, "02"=Single,
    # "03"=Common-Law, etc). Accept legacy text values too for backward compat
    # with any old data that still flows through.
    sv(data["marital_status"], "Page1","MaritalStatus","Current","MaritalStatus")
    if data["marital_status"] in ("Married", "Common-Law", "01", "03"):
        sv(data["spouse_family_name"],     "Page1","MaritalStatus","Current","c","FamilyName")
        sv(data["spouse_given_name"],      "Page1","MaritalStatus","Current","c","GivenName")
        sv(data["spouse_status_in_canada"],"Page1","MaritalStatus","d","SpouseStatus")
        dom = data.get("date_of_marriage","")
        if dom and len(dom) == 10:
            sv(dom[:4],  "Page1","MaritalStatus","Current","b","MarriageDate","FromYr")
            sv(dom[5:7], "Page1","MaritalStatus","Current","b","MarriageDate","FromMM")
            sv(dom[8:],  "Page1","MaritalStatus","Current","b","MarriageDate","FromDD")
    # Previous marriage / common-law: always write the Y/N indicator so the No
    # box ticks for clients who weren't previously married. Paras's verified
    # form: PrevMarriedIndicator = "N".
    if data["previously_married"]:
        sv("Y",                               "Page2","MaritalStatus","PrevMarriage","PrevMarriedIndicator")
        sv(data["prev_spouse_family_name"],   "Page2","MaritalStatus","PrevMarriage","PMFamilyName")
        sv(data["prev_spouse_given_name"],    "Page2","MaritalStatus","PrevMarriage","PMGivenName")
        sv(data["prev_relationship_type"],    "Page2","MaritalStatus","PrevMarriage","TypeOfRelationship")
        sv(data["prev_marriage_from"],        "Page2","MaritalStatus","PrevMarriage","From","FromDate")
        sv(data["prev_marriage_to"],          "Page2","MaritalStatus","PrevMarriage","To","ToDate")
        sv(data["prev_spouse_dob_day"],       "Page2","MaritalStatus","PrevMarriage","dob","DOBDay")
        sv(data["prev_spouse_dob_month"],     "Page2","MaritalStatus","PrevMarriage","dob","DOBMonth")
        sv(data["prev_spouse_dob_year"],      "Page2","MaritalStatus","PrevMarriage","dob","DOBYear")
    else:
        sv("N",                               "Page2","MaritalStatus","PrevMarriage","PrevMarriedIndicator")

    # ── SECTION 5: Languages ─────────────────────────────────────
    sv(data["native_language"],      "Page2","Languages","nativeLang")
    sv(data["communicate_language"], "Page2","Languages","communicateLang")
    # LangTestIndicator: Y/N character format (verified against Paras's filed form, "Y"/"N", not "1"/"0").
    sv("Y" if data["language_test_taken"] else "N", "Page2","Languages","LangTestIndicator")
    sv(data["frequent_language"],    "Page2","Languages","FreqLang")

    # ── SECTION 6: Travel Documents ──────────────────────────────
    sv(data["passport_number"],       "Page2","Passport","PassportNum")
    sv(data["passport_country"],      "Page2","Passport","CountryofIssue")
    sv(data["passport_issue_year"],   "Page2","Passport","Issue","YYYY")
    sv(data["passport_issue_month"],  "Page2","Passport","Issue","MM")
    sv(data["passport_issue_day"],    "Page2","Passport","Issue","DD")
    sv(data["passport_expiry_year"],  "Page2","Passport","Expiry","YYYY")
    sv(data["passport_expiry_month"], "Page2","Passport","Expiry","MM")
    sv(data["passport_expiry_day"],   "Page2","Passport","Expiry","DD")
    # National ID: always write the Y/N indicator so the No box ticks for the
    # 99% of clients without a national ID. When Yes, also write the document
    # details. Paras's verified form: natIDIndicator = "N".
    if data["has_national_id"]:
        sv("Y",                            "Page2","natID","q1","natIDIndicator")
        sv(data["national_id_number"],     "Page2","natID","natIDdocs","DocNum","DocNum")
        sv(data["national_id_country"],    "Page2","natID","natIDdocs","CountryofIssue","CountryofIssue")
        sv(data["national_id_issue_date"], "Page2","natID","natIDdocs","IssueDate","IssueDate")
        sv(data["national_id_expiry_date"],"Page2","natID","natIDdocs","ExpiryDate")
    else:
        sv("N",                            "Page2","natID","q1","natIDIndicator")

    # US PR Card (green card): same pattern. Paras's verified form: usCardIndicator = "N".
    if data["has_us_card"]:
        sv("Y",                      "Page2","USCard","q1","usCardIndicator")
        sv(data["us_card_number"],   "Page2","USCard","usCarddocs","DocNum","DocNum")
        sv(data["us_card_expiry_date"],"Page2","USCard","usCarddocs","ExpiryDate")
    else:
        sv("N",                      "Page2","USCard","q1","usCardIndicator")

    # ── SECTION 7: Contact Information ───────────────────────────
    sv(data["mailing_po_box"],       "Page2","ContactInformation","Mailing","AddrLine1","POBox")
    sv(data["mailing_apt_unit"],     "Page2","ContactInformation","Mailing","AddrLine1","AptUnit")
    sv(data["mailing_street_num"],   "Page2","ContactInformation","Mailing","AddrLine1","StreetNum")
    sv(data["mailing_street_name"],  "Page2","ContactInformation","Mailing","AddrLine1","Streetname")
    sv(data["mailing_city"],         "Page2","ContactInformation","Mailing","AddrLine2","City")
    sv(data["mailing_country"],      "Page2","ContactInformation","Mailing","AddrLine2","Country")
    sv(data["mailing_province"],     "Page2","ContactInformation","Mailing","AddrLine2","Prov")
    sv(data["mailing_postal_code"],  "Page2","ContactInformation","Mailing","AddrLine2","PostalCode")
    sv(data["mailing_district"],     "Page2","ContactInformation","Mailing","AddrLine2","District")
    if not data["residential_same_as_mailing"]:
        sv(data["residential_apt_unit"],    "Page2","ContactInformation","Resi","AddrLine1","AptUnit")
        sv(data["residential_street_num"],  "Page2","ContactInformation","Resi","AddrLine1","StreetNum")
        sv(data["residential_street_name"], "Page2","ContactInformation","Resi","AddrLine1","Streetname")
        sv(data["residential_city"],        "Page2","ContactInformation","Resi","AddrLine2","City")
        sv(data["residential_country"],     "Page2","ContactInformation","Resi","AddrLine2","Country")
        sv(data["residential_province"],    "Page2","ContactInformation","Resi","AddrLine2","Prov")
    # ── Phone ──
    # The mapper now provides:
    #   phone_type:        IRCC numeric type code ("02"=Cellular, "01"=Residential, etc.)
    #   phone_canada_us:   "1" if Canada/US-format, else "0"/"" (drives split vs intl format)
    #   phone_number_type: legacy human-readable label ("Mobile") — kept for back-compat
    #   phone_actual_number: full digits as one string (e.g. "6475458967")
    phone_type_value = str(data.get("phone_type", "")).strip()
    phone_canada_us_flag = str(data.get("phone_canada_us", "")).strip()

    # Route NA-format vs intl: prefer the explicit phone_canada_us flag,
    # fall back to legacy phone_type text values for old/intermediate data.
    if phone_canada_us_flag in ("1", "true", "True"):
        is_ca_us = True
    elif phone_canada_us_flag in ("0", "false", "False"):
        is_ca_us = False
    else:
        # No explicit flag — sniff legacy text values.
        is_ca_us = phone_type_value.upper() in ("CANADA/US", "CANADA", "US", "")

    sv("1" if is_ca_us else "0",     "Page2","ContactInformation","q3-4","Phone","CanOtherInd","CanadaUS")

    # Phone/Type: IRCC dropdown wants the numeric code. If phone_type looks
    # like a code (digits), use it; otherwise fall back to the legacy
    # phone_number_type text so old data still writes something.
    if phone_type_value.isdigit() and phone_type_value:
        sv(phone_type_value,         "Page2","ContactInformation","q3-4","Phone","Type")
    else:
        sv(data["phone_number_type"],"Page2","ContactInformation","q3-4","Phone","Type")

    sv(data["phone_extension"],      "Page2","ContactInformation","q3-4","Phone","NumberExt")
    if is_ca_us:
        sv(data["phone_area_code"],  "Page2","ContactInformation","q3-4","Phone","NANumber","AreaCode")
        sv(data["phone_first_three"],"Page2","ContactInformation","q3-4","Phone","NANumber","FirstThree")
        sv(data["phone_last_five"],  "Page2","ContactInformation","q3-4","Phone","NANumber","LastFive")
    else:
        sv(data["phone_intl_number"],"Page2","ContactInformation","q3-4","Phone","IntlNumber","IntlNumber")

    # Phone/ActualNumber: a separate merged-format field IRCC populates alongside
    # the split fields (verified against Paras Kamboj's filed form). Use the
    # mapper-provided value if present, else compute from the split parts.
    actual = str(data.get("phone_actual_number", "")).strip()
    if not actual:
        actual = "{}{}{}".format(
            data.get("phone_area_code", "") or "",
            data.get("phone_first_three", "") or "",
            data.get("phone_last_five", "") or "",
        )
    sv(actual,                       "Page2","ContactInformation","q3-4","Phone","ActualNumber")
    if data["alt_phone_area_code"]:
        sv("1",                           "Page2","ContactInformation","q3-4","AltPhone","CanOtherInd","CanadaUS")
        sv(data["alt_phone_area_code"],   "Page2","ContactInformation","q3-4","AltPhone","NANumber","AreaCode")
        sv(data["alt_phone_first_three"], "Page2","ContactInformation","q3-4","AltPhone","NANumber","FirstThree")
        sv(data["alt_phone_last_five"],   "Page2","ContactInformation","q3-4","AltPhone","NANumber","LastFive")
        sv(data["alt_phone_extension"],   "Page2","ContactInformation","q3-4","AltPhone","NumberExt")
    sv(data["email"],                "Page2","ContactInformation","q5-6","Email","Email")

    # ── SECTION 8: Entry to Canada ────────────────────────────────
    sv(data["original_entry_date"],          "Page3","ComingIntoCda","OrigEntry","DateLastEntry")
    sv(data["original_entry_place"],         "Page3","ComingIntoCda","OrigEntry","Place")
    sv(data["original_entry_purpose"],       "Page3","ComingIntoCda","PurposeOfVisit","PurposeOfVisit")
    sv(data["original_entry_purpose_other"], "Page3","ComingIntoCda","PurposeOfVisit","Other")
    sv(data["recent_entry_date"],            "Page3","ComingIntoCda","RecentEntry","DateLastEntry")
    sv(data["recent_entry_place"],           "Page3","ComingIntoCda","RecentEntry","Place")
    sv(data["previous_doc_number"],          "Page3","ComingIntoCda","PrevDocNum","docNum")
    if data["work_permit_type"]:
        sv(data["work_permit_type"],         "Page3","DetailsOfWork","Purpose","Type")
        sv(data["work_permit_type_other"],   "Page3","DetailsOfWork","Purpose","Other")
        sv(data["employer_name"],            "Page3","DetailsOfWork","Employer","Name")
        sv(data["employer_address"],         "Page3","DetailsOfWork","Employer","Addr")
        sv(data["work_location_province"],   "Page3","DetailsOfWork","Location","Prov")
        sv(data["work_location_city"],       "Page3","DetailsOfWork","Location","City")
        sv(data["work_location_address"],    "Page3","DetailsOfWork","Location","Addr")
        sv(data["job_title"],                "Page3","DetailsOfWork","Occupation","Job")
        sv(data["job_description"],          "Page3","DetailsOfWork","Occupation","Desc")
        sv(data["work_from_date"],           "Page3","DetailsOfWork","Duration","FromDate")
        sv(data["work_to_date"],             "Page3","DetailsOfWork","Duration","ToDate")
        sv(data["lmo_number"],               "Page3","DetailsOfWork","Duration","LMO")
        sv(data["caq_cert_number"],          "Page3","DetailsOfWork","CAQ","CertNum")

    # ── SECTION 9: Education ──────────────────────────────────────
    if data["has_education"] or data["edu_school_name"]:
        sv("1",                      "Page3","Education","EducationIndicator")
        sv(data["edu_from_year"],    "Page3","Education","EduLine1","From","YYYY")
        sv(data["edu_from_month"],   "Page3","Education","EduLine1","From","MM")
        sv(data["edu_field_of_study"],"Page3","Education","EduLine1","FieldOfStudy")
        sv(data["edu_school_name"],  "Page3","Education","EduLine1","School")
        sv(data["edu_to_year"],      "Page3","Education","EduLine2","To","YYYY")
        sv(data["edu_to_month"],     "Page3","Education","EduLine2","To","MM")
        sv(data["edu_city"],         "Page3","Education","EduLine2","City")
        sv(data["edu_country"],      "Page3","Education","EduLine2","Country")
        sv(data["edu_province"],     "Page3","Education","EduLine2","Prov")

    # ── SECTION 10: Employment History ───────────────────────────
    emp_bases = [
        ["Page3","Employment","EmpRec1"],
        ["Page4","EmpRec2"],
        ["Page4","EmpRec3"],
    ]
    for idx, job in enumerate(data.get("employment", [])[:3]):
        b = emp_bases[idx]
        sv(job.get("from_year"),   *b,"Line1","From","YYYY")
        sv(job.get("from_month"),  *b,"Line1","From","MM")
        sv(job.get("occupation"),  *b,"Line1","Occupation")
        sv(job.get("employer"),    *b,"Line1","Employer")
        sv(job.get("to_year"),     *b,"Line2","To","YYYY")
        sv(job.get("to_month"),    *b,"Line2","To","MM")
        sv(job.get("city"),        *b,"Line2","City")
        sv(job.get("country"),     *b,"Line2","Country")
        sv(job.get("prov_state"),  *b,"Line2","ProvState")

    # ── SECTION 11: Background Questions ─────────────────────────
    # Format note: IRCC uses literal "Y"/"N" character codes for these Yes/No
    # radio indicators, NOT "1"/"0". Verified against Paras Kamboj's filed
    # form (which IRCC accepted): qANY="N", qBNY="N", qCNY="Y" for sub-questions.
    #
    # IMPORTANT: qANY, qBNY, and qCNY are INDEPENDENT sub-questions, not a
    # mirror Yes/No pair for the same question. The OLD filler wrote qBNY as
    # the inverse of qANY (e.g., qANY=0, qBNY=1) — treating them as Yes/No
    # for one question. That was wrong; they're separate Y/N answers for
    # different sub-questions on the form. When the client says "No" to the
    # umbrella question, all sub-question indicators should be "N".
    #
    # Defaults (matching the standard "all No" client answer):
    #   - HealthQ:    qANY = qBNY = "N"
    #   - PrevApplied: qANY = qBNY = qCNY = "N"
    #   - Criminal:   qANY = "N"
    #   - Military:   qANY = "N"
    #   - GovPosition: qGovtNY = "N"
    #   - Illtreatment: qWitnessNY = "N"
    # When a client answers Yes (with details), staff reviews the form and
    # adjusts the specific sub-question that applies.
    yn = lambda b: "Y" if b else "N"

    sv(yn(data["has_medical_condition"]),    "Page4","BackgroundInfo","HealthQ","qANY")
    sv("N",                                  "Page4","BackgroundInfo","HealthQ","qBNY")
    sv(data["medical_details"],              "Page4","BackgroundInfo","HealthQ","MedicalDetails")

    sv(yn(data["prev_application_refused"]), "Page4","BackgroundInfo","PrevApplied","qANY")
    sv("N",                                  "Page4","BackgroundInfo","PrevApplied","qBNY")
    sv(yn(data["prev_refused_to_canada"]),   "Page4","BackgroundInfo","PrevApplied","qCNY")
    sv(data["prev_refused_details"],         "Page4","BackgroundInfo","PrevApplied","refusedDetails")

    sv(yn(data["has_criminal_record"]),      "Page4","BackgroundInfo","Criminal","qANY")
    sv(data["criminal_details"],             "Page4","BackgroundInfo","Criminal","refusedDetails")

    sv(yn(data["has_military_service"]),     "Page4","BackgroundInfo","Military","qANY")
    sv(data["military_details"],             "Page4","BackgroundInfo","Military","militaryServiceDetails")

    sv(yn(data["held_government_position"]), "Page4","BackgroundInfo","GovPosition","qGovtNY")
    sv(yn(data["witnessed_ill_treatment"]),  "Page4","BackgroundInfo","Illtreatment","qWitnessNY")

    # ── Save PDF ──────────────────────────────────────────────────
    ET.register_namespace('xfa', XFA_NS)
    ds_stream.set_data(ET.tostring(root, encoding='unicode').encode('utf-8'))
    writer = PdfWriter()
    writer.append(reader)
    with open(output_pdf, 'wb') as f:
        writer.write(f)

    print(f"✅  IMM5710 filled → {output_pdf}")
    return output_pdf


# ══════════════════════════════════════════════════════════════════
#  QUICK TEST — remove before deploying to production
# ══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    # Simulate a client coming from your CRM
    test_client = {
        **EMPTY_CLIENT,   # start with empty template

        # Section 1
        "applying_extend_stay":       True,

        # Section 2
        "family_name":                "Test",
        "given_name":                 "Client",
        "sex":                        "Female",
        "dob_year":                   "1995",
        "dob_month":                  "06",
        "dob_day":                    "15",
        "place_birth_city":           "Mumbai",
        "place_birth_country":        "India",
        "citizenship_country":        "India",

        # Section 4
        "marital_status":             "Single",

        # Section 5
        "native_language":            "Hindi",
        "communicate_language":       "English",

        # Section 6
        "passport_number":            "Z1234567",
        "passport_country":           "India",
        "passport_expiry_year":       "2030",
        "passport_expiry_month":      "03",
        "passport_expiry_day":        "22",

        # Section 7
        "mailing_street_num":         "123",
        "mailing_street_name":        "Main St",
        "mailing_city":               "Toronto",
        "mailing_province":           "ON",
        "mailing_postal_code":        "M5V 2T6",
        "mailing_country":            "Canada",
        "phone_area_code":            "416",
        "phone_first_three":          "555",
        "phone_last_five":            "01234",
        "email":                      "test.client@email.com",

        # Section 8
        "original_entry_date":        "2023-09-01",
        "original_entry_place":       "Toronto Pearson",
        "original_entry_purpose":     "Study",
        "recent_entry_date":          "2024-12-15",
        "recent_entry_place":         "Toronto Pearson",

        # Section 10
        "employment": [
            {
                "from_year":   "2023",
                "from_month":  "10",
                "occupation":  "Sales Associate",
                "employer":    "Shopify Inc",
                "to_year":     "2026",
                "to_month":    "01",
                "city":        "Toronto",
                "country":     "Canada",
                "prov_state":  "ON",
            }
        ],

        # Section 11
        "prev_application_refused":   False,
        "has_criminal_record":        False,
        "has_medical_condition":      False,
        "has_military_service":       False,
        "held_government_position":   False,
        "witnessed_ill_treatment":    False,
    }

    fill_imm5710(test_client, "imm5710e__8_.pdf", "imm5710_test_output.pdf")
    print("Test complete. Open imm5710_test_output.pdf in Adobe to verify.")
