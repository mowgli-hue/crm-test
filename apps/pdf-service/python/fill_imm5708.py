"""
IMM5708 Auto-Fill Script — Generic CRM Edition
===============================================
IMM5708 = Application to Change Conditions, Extend My Stay or Remain
          in Canada as a Visitor

The KEY DIFFERENCE from IMM5709 (student) and IMM5710 (worker) is Section 8:
  • Purpose of this visit (Business / Tourism / Family Visit / etc.)
  • Intended stay dates (from / to)
  • Funds available (CAD)
  • Who pays expenses
  • Contacts to visit in Canada (up to 2 people: name, relationship, address)

All other sections (Personal, Marital, Languages, Passport, Contact,
Entry, Education, Employment, Background) share the same structure.

Usage:
    from fill_imm5708 import fill_imm5708, EMPTY_CLIENT
    fill_imm5708(crm_data, "blank_imm5708.pdf", f"filled_{case_id}.pdf")

Requirements:
    pip install pypdf
"""

from pypdf import PdfReader, PdfWriter
import xml.etree.ElementTree as ET


# ══════════════════════════════════════════════════════════════════
#  CRM DATA TEMPLATE  — every key = one CRM question
# ══════════════════════════════════════════════════════════════════
EMPTY_CLIENT = {

    # ── SECTION 1: What are you applying for? ─────────────────────
    # CRM Q: "What are you applying for?" (multi-select)
    "applying_restore_status":       False,   # Restore my status as a visitor
    "applying_extend_stay":          False,   # Extend my status as a visitor
    "applying_trp":                  False,   # Temporary Resident Permit

    # ── SECTION 2: Personal Information ──────────────────────────
    "uci_client_id":                 "",      # CRM Q: UCI / Client ID (optional)
    "family_name":                   "",      # CRM Q: Family name (as on passport)
    "given_name":                    "",      # CRM Q: Given name(s)
    "has_alias":                     False,   # CRM Q: Have you used another name?
    "alias_family_name":             "",
    "alias_given_name":              "",
    "sex":                           "",      # F Female | M Male | U Unknown | X Another gender
    "dob_year":                      "",      # YYYY
    "dob_month":                     "",      # MM
    "dob_day":                       "",      # DD
    "place_birth_city":              "",
    "place_birth_country":           "",      # Full country name e.g. "India"
    "citizenship_country":           "",

    # ── SECTION 3: Current & Previous Status ─────────────────────
    # Citizen | Permanent resident | Visitor | Worker | Student | Other | Protected Person | Foreign National
    "current_status":                "",
    "current_status_other":          "",
    "current_status_from_date":      "",      # YYYY-MM-DD
    "current_status_to_date":        "",
    "prev_country_1":                "",
    "prev_status_1":                 "",
    "prev_status_other_1":           "",
    "prev_from_date_1":              "",
    "prev_to_date_1":                "",
    "prev_country_2":                "",
    "prev_status_2":                 "",
    "prev_status_other_2":           "",
    "prev_from_date_2":              "",
    "prev_to_date_2":                "",

    # ── SECTION 4: Marital Status ─────────────────────────────────
    # Annulled Marriage | Common-Law | Divorced | Legally Separated | Married | Single | Unknown | Widowed
    "marital_status":                "",
    "spouse_family_name":            "",
    "spouse_given_name":             "",
    "date_of_marriage":              "",      # YYYY-MM-DD
    "spouse_status_in_canada":       "",
    "previously_married":            False,
    "prev_spouse_family_name":       "",
    "prev_spouse_given_name":        "",
    "prev_relationship_type":        "",      # Married | Common-Law
    "prev_marriage_from":            "",
    "prev_marriage_to":              "",
    "prev_spouse_dob_year":          "",
    "prev_spouse_dob_month":         "",
    "prev_spouse_dob_day":           "",

    # ── SECTION 5: Languages ─────────────────────────────────────
    "native_language":               "",      # Full language name e.g. "Hindi"
    "communicate_language":          "",      # English | French | Both | Neither
    "language_test_taken":           False,
    "frequent_language":             "",      # English | French | Both | Neither

    # ── SECTION 6: Travel Documents ──────────────────────────────
    "passport_number":               "",
    "passport_country":              "",
    "passport_issue_year":           "",
    "passport_issue_month":          "",
    "passport_issue_day":            "",
    "passport_expiry_year":          "",
    "passport_expiry_month":         "",
    "passport_expiry_day":           "",
    "has_national_id":               False,
    "national_id_number":            "",
    "national_id_country":           "",
    "national_id_issue_date":        "",
    "national_id_expiry_date":       "",
    "has_us_card":                   False,
    "us_card_number":                "",
    "us_card_expiry_date":           "",

    # ── SECTION 7: Contact Information ───────────────────────────
    "mailing_po_box":                "",
    "mailing_apt_unit":              "",
    "mailing_street_num":            "",
    "mailing_street_name":           "",
    "mailing_city":                  "",
    "mailing_province":              "",      # 2-letter: BC | ON | AB ...
    "mailing_postal_code":           "",
    "mailing_country":               "",
    "mailing_district":              "",
    "residential_same_as_mailing":   True,
    "residential_apt_unit":          "",
    "residential_street_num":        "",
    "residential_street_name":       "",
    "residential_city":              "",
    "residential_province":          "",
    "residential_country":           "",
    "phone_type":                    "Canada/US",  # Canada/US | International
    "phone_number_type":             "Mobile",     # Residence | Cellular | Business | Other
    "phone_area_code":               "",
    "phone_first_three":             "",
    "phone_last_five":               "",
    "phone_extension":               "",
    "phone_intl_number":             "",
    "alt_phone_area_code":           "",
    "alt_phone_first_three":         "",
    "alt_phone_last_five":           "",
    "alt_phone_extension":           "",
    "email":                         "",

    # ── SECTION 8: Entry to Canada ────────────────────────────────
    "original_entry_date":           "",      # YYYY-MM-DD
    "original_entry_place":          "",
    # Options: Business | Tourism | Study | Work | Other | Family Visit
    "original_entry_purpose":        "",
    "original_entry_purpose_other":  "",
    "recent_entry_date":             "",      # YYYY-MM-DD
    "recent_entry_place":            "",
    "previous_doc_number":           "",

    # ── SECTION 8b: Details of Visit (IMM5708-SPECIFIC) ──────────
    # CRM Q: "What is the purpose of your visit?"
    # Options: Business | Tourism | Short-Term Studies | Returning Student |
    #          Returning Worker | Super Visa: For Parents or Grandparents |
    #          Other | Family Visit | Visit
    "visit_purpose":                 "",
    "visit_purpose_other":           "",

    # CRM Q: "What date does your visit start?" (YYYY-MM-DD)
    "visit_from_date":               "",
    # CRM Q: "What date does your visit end / when do you plan to leave?" (YYYY-MM-DD)
    "visit_to_date":                 "",

    # CRM Q: "How much money do you have available for your stay? (CAD)"
    "funds_available":               "",
    # CRM Q: "Who will pay your expenses in Canada?"
    # Options: Myself | Parents | Other
    "expenses_paid_by":              "",
    "expenses_paid_by_other":        "",

    # CRM Q: "Will you be visiting anyone in Canada?"
    "will_visit_contact_1_name":     "",      # Full name of person being visited
    "will_visit_contact_1_rel":      "",      # Relationship to applicant e.g. "Sister"
    "will_visit_contact_1_address":  "",      # Their address in Canada

    "will_visit_contact_2_name":     "",
    "will_visit_contact_2_rel":      "",
    "will_visit_contact_2_address":  "",

    # ── SECTION 9: Education ──────────────────────────────────────
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

    # ── SECTION 10: Employment History (up to 3, most recent first)
    # Each: from_year, from_month, occupation, employer, to_year, to_month, city, country, prov_state
    "employment": [],

    # ── SECTION 11: Background Questions ─────────────────────────
    "has_medical_condition":         False,
    "medical_details":               "",
    "prev_application_refused":      False,
    "prev_refused_to_canada":        False,
    "prev_refused_details":          "",
    "has_criminal_record":           False,
    "criminal_details":              "",
    "has_military_service":          False,
    "military_details":              "",
    "held_government_position":      False,
    "witnessed_ill_treatment":       False,
}


# ══════════════════════════════════════════════════════════════════
#  ENGINE
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


def fill_imm5708(client: dict, input_pdf: str, output_pdf: str) -> str:
    """Fill IMM5708 from CRM dict and save to output_pdf."""

    data = {**EMPTY_CLIENT, **client}

    reader   = PdfReader(input_pdf)
    xfa_list = list(reader.trailer['/Root']['/AcroForm']['/XFA'])

    ds_stream = None
    for i in range(0, len(xfa_list), 2):
        if str(xfa_list[i]) == 'datasets':
            ds_stream = xfa_list[i + 1].get_object()
            break
    if ds_stream is None:
        raise RuntimeError("XFA datasets stream not found")

    root     = ET.fromstring(ds_stream.get_data().decode('utf-8'))
    xfa_data = next((c for c in root if c.tag.endswith('}data') or c.tag == 'xfa:data'), None)
    if xfa_data is None:
        raise RuntimeError("xfa:data not found")

    form1 = _get_or_create(xfa_data, 'form1')

    def sv(value, *path):
        if value not in (None, "", False):
            _set_value(form1, list(path), value)

    # ── SECTION 1: Application Type ──────────────────────────────
    sv("1" if data["applying_restore_status"] else "0",
       "Page1","PersonalDetails","ApplyingFor","RestoreStat")
    sv("1" if data["applying_extend_stay"]    else "0",
       "Page1","PersonalDetails","ApplyingFor","Extend")
    sv("1" if data["applying_trp"]            else "0",
       "Page1","PersonalDetails","ApplyingFor","TRP")

    # ── SECTION 2: Personal ───────────────────────────────────────
    sv(data["uci_client_id"],       "Page1","PersonalDetails","ServiceIn","UCIClientID")
    sv(data["family_name"],         "Page1","PersonalDetails","Name","FamilyName")
    sv(data["given_name"],          "Page1","PersonalDetails","Name","GivenName")
    if data["has_alias"]:
        sv(data["alias_family_name"], "Page1","PersonalDetails","AliasName","AliasFamilyName")
        sv(data["alias_given_name"],  "Page1","PersonalDetails","AliasName","AliasGivenName")
        sv("1", "Page1","PersonalDetails","AliasName","AliasNameIndicator","AliasNameIndicator")
    sv(data["sex"],                 "Page1","PersonalDetails","q3-4-5","sex","Sex")
    sv(data["dob_day"],             "Page1","PersonalDetails","q3-4-5","dob","DOBDay")
    sv(data["dob_month"],           "Page1","PersonalDetails","q3-4-5","dob","DOBMonth")
    sv(data["dob_year"],            "Page1","PersonalDetails","q3-4-5","dob","DOBYear")
    sv(data["place_birth_city"],    "Page1","PersonalDetails","q3-4-5","pob","PlaceBirthCity")
    sv(data["place_birth_country"], "Page1","PersonalDetails","q3-4-5","pob","PlaceBirthCountry")
    sv(data["citizenship_country"], "Page1","PersonalDetails","Citizenship","Citizenship")

    # ── SECTION 3: Status ─────────────────────────────────────────
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

    # ── SECTION 4: Marital ────────────────────────────────────────
    sv(data["marital_status"], "Page1","MaritalStatus","Current","MaritalStatus")
    if data["marital_status"] in ("Married", "Common-Law"):
        sv(data["spouse_family_name"],      "Page1","MaritalStatus","Current","c","FamilyName")
        sv(data["spouse_given_name"],       "Page1","MaritalStatus","Current","c","GivenName")
        sv(data["spouse_status_in_canada"], "Page1","MaritalStatus","d","SpouseStatus")
        dom = data.get("date_of_marriage","")
        if dom and len(dom) == 10:
            sv(dom[:4],  "Page1","MaritalStatus","Current","b","MarriageDate","FromYr")
            sv(dom[5:7], "Page1","MaritalStatus","Current","b","MarriageDate","FromMM")
            sv(dom[8:],  "Page1","MaritalStatus","Current","b","MarriageDate","FromDD")
    if data["previously_married"]:
        sv("1",                               "Page2","MaritalStatus","PrevMarriage","PrevMarriedIndicator")
        sv(data["prev_spouse_family_name"],   "Page2","MaritalStatus","PrevMarriage","PMFamilyName")
        sv(data["prev_spouse_given_name"],    "Page2","MaritalStatus","PrevMarriage","PMGivenName")
        sv(data["prev_relationship_type"],    "Page2","MaritalStatus","PrevMarriage","TypeOfRelationship")
        sv(data["prev_marriage_from"],        "Page2","MaritalStatus","PrevMarriage","From","FromDate")
        sv(data["prev_marriage_to"],          "Page2","MaritalStatus","PrevMarriage","To","ToDate")
        sv(data["prev_spouse_dob_day"],       "Page2","MaritalStatus","PrevMarriage","dob","DOBDay")
        sv(data["prev_spouse_dob_month"],     "Page2","MaritalStatus","PrevMarriage","dob","DOBMonth")
        sv(data["prev_spouse_dob_year"],      "Page2","MaritalStatus","PrevMarriage","dob","DOBYear")

    # ── SECTION 5: Languages ─────────────────────────────────────
    sv(data["native_language"],      "Page2","Languages","nativeLang")
    sv(data["communicate_language"], "Page2","Languages","communicateLang")
    sv(data["frequent_language"],    "Page2","Languages","FreqLang")
    sv("1" if data["language_test_taken"] else "0", "Page2","Languages","LangTestIndicator")

    # ── SECTION 6: Travel Documents ──────────────────────────────
    sv(data["passport_number"],       "Page2","Passport","PassportNum")
    sv(data["passport_country"],      "Page2","Passport","CountryofIssue")
    sv(data["passport_issue_year"],   "Page2","Passport","Issue","YYYY")
    sv(data["passport_issue_month"],  "Page2","Passport","Issue","MM")
    sv(data["passport_issue_day"],    "Page2","Passport","Issue","DD")
    sv(data["passport_expiry_year"],  "Page2","Passport","Expiry","YYYY")
    sv(data["passport_expiry_month"], "Page2","Passport","Expiry","MM")
    sv(data["passport_expiry_day"],   "Page2","Passport","Expiry","DD")
    if data["has_national_id"]:
        sv("1",                            "Page2","natID","q1","natIDIndicator")
        sv(data["national_id_number"],     "Page2","natID","natIDdocs","DocNum","DocNum")
        sv(data["national_id_country"],    "Page2","natID","natIDdocs","CountryofIssue","CountryofIssue")
        sv(data["national_id_issue_date"], "Page2","natID","natIDdocs","IssueDate","IssueDate")
        sv(data["national_id_expiry_date"],"Page2","natID","natIDdocs","ExpiryDate")
    if data["has_us_card"]:
        sv("1",                        "Page2","USCard","q1","usCardIndicator")
        sv(data["us_card_number"],     "Page2","USCard","usCarddocs","DocNum","DocNum")
        sv(data["us_card_expiry_date"],"Page2","USCard","usCarddocs","ExpiryDate")

    # ── SECTION 7: Contact ────────────────────────────────────────
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
    is_ca_us = str(data.get("phone_type","")).upper() in ("CANADA/US","CANADA","US","")
    sv("1" if is_ca_us else "0",     "Page2","ContactInformation","q3-4","Phone","CanOtherInd","CanadaUS")
    sv(data["phone_number_type"],    "Page2","ContactInformation","q3-4","Phone","Type")
    sv(data["phone_extension"],      "Page2","ContactInformation","q3-4","Phone","NumberExt")
    if is_ca_us:
        sv(data["phone_area_code"],  "Page2","ContactInformation","q3-4","Phone","NANumber","AreaCode")
        sv(data["phone_first_three"],"Page2","ContactInformation","q3-4","Phone","NANumber","FirstThree")
        sv(data["phone_last_five"],  "Page2","ContactInformation","q3-4","Phone","NANumber","LastFive")
    else:
        sv(data["phone_intl_number"],"Page2","ContactInformation","q3-4","Phone","IntlNumber","IntlNumber")
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

    # ── SECTION 8b: Details of Visit (5708-SPECIFIC) ──────────────
    sv(data["visit_purpose"],        "Page3","DetailsOfVisit","Purpose","Purpose")
    sv(data["visit_purpose_other"],  "Page3","DetailsOfVisit","Purpose","Other")
    sv(data["visit_from_date"],      "Page3","DetailsOfVisit","Purpose","Stay","FromDate")
    sv(data["visit_to_date"],        "Page3","DetailsOfVisit","Purpose","Stay","ToDate")
    sv(data["funds_available"],      "Page3","DetailsOfVisit","Funds","FundsAvail")
    sv(data["expenses_paid_by"],     "Page3","DetailsOfVisit","Funds","ExpPaidBy")
    sv(data["expenses_paid_by_other"],"Page3","DetailsOfVisit","Funds","Other")

    # Contacts to visit in Canada
    sv(data["will_visit_contact_1_name"],    "Page3","DetailsOfVisit","WillVisit","VisitList","Rec1","Name")
    sv(data["will_visit_contact_1_rel"],     "Page3","DetailsOfVisit","WillVisit","VisitList","Rec1","Relationship")
    sv(data["will_visit_contact_1_address"], "Page3","DetailsOfVisit","WillVisit","VisitList","Rec1","Addr")
    sv(data["will_visit_contact_2_name"],    "Page3","DetailsOfVisit","WillVisit","VisitList","Rec2","Name")
    sv(data["will_visit_contact_2_rel"],     "Page3","DetailsOfVisit","WillVisit","VisitList","Rec2","Relationship")
    sv(data["will_visit_contact_2_address"], "Page3","DetailsOfVisit","WillVisit","VisitList","Rec2","Addr")

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

    # ── SECTION 10: Employment (up to 3) ──────────────────────────
    # 5708: EmpRec1+2 in Page3/Employment, EmpRec3 in Page4/Employment2
    emp_bases = [
        ["Page3","Employment","EmpRec1"],
        ["Page3","Employment","EmpRec2"],
        ["Page4","Employment2","EmpRec3"],
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

    # ── SECTION 11: Background ────────────────────────────────────
    sv("1" if data["has_medical_condition"]    else "0", "Page4","BackgroundInfo","HealthQ","qANY")
    sv("0" if data["has_medical_condition"]    else "1", "Page4","BackgroundInfo","HealthQ","qBNY")
    sv(data["medical_details"],                          "Page4","BackgroundInfo","HealthQ","MedicalDetails")
    sv("1" if data["prev_application_refused"] else "0", "Page4","BackgroundInfo","PrevApplied","qANY")
    sv("0" if data["prev_application_refused"] else "1", "Page4","BackgroundInfo","PrevApplied","qBNY")
    sv("1" if data["prev_refused_to_canada"]   else "0", "Page4","BackgroundInfo","PrevApplied","qCNY")
    sv(data["prev_refused_details"],                     "Page4","BackgroundInfo","PrevApplied","refusedDetails")
    sv("1" if data["has_criminal_record"]      else "0", "Page4","BackgroundInfo","Criminal","qANY")
    sv(data["criminal_details"],                         "Page4","BackgroundInfo","Criminal","refusedDetails")
    sv("1" if data["has_military_service"]     else "0", "Page4","BackgroundInfo","Military","qANY")
    sv(data["military_details"],                         "Page4","BackgroundInfo","Military","militaryServiceDetails")
    sv("1" if data["held_government_position"] else "0", "Page4","BackgroundInfo","GovPosition","qGovtNY")
    sv("1" if data["witnessed_ill_treatment"]  else "0", "Page4","BackgroundInfo","Illtreatment","qWitnessNY")

    # ── Save ──────────────────────────────────────────────────────
    ET.register_namespace('xfa', XFA_NS)
    ds_stream.set_data(ET.tostring(root, encoding='unicode').encode('utf-8'))
    writer = PdfWriter()
    writer.append(reader)
    with open(output_pdf, 'wb') as f:
        writer.write(f)

    print(f"✅  IMM5708 filled → {output_pdf}")
    return output_pdf


# ══════════════════════════════════════════════════════════════════
#  QUICK TEST
# ══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    test_client = {
        **EMPTY_CLIENT,
        "applying_extend_stay":       True,
        "family_name":                "Test",
        "given_name":                 "Visitor",
        "sex":                        "M Male",
        "dob_year":                   "1985",
        "dob_month":                  "07",
        "dob_day":                    "22",
        "place_birth_city":           "Lagos",
        "place_birth_country":        "Nigeria",
        "citizenship_country":        "Nigeria",
        "marital_status":             "Married",
        "spouse_family_name":         "Test",
        "spouse_given_name":          "Spouse",
        "date_of_marriage":           "2012-06-15",
        "native_language":            "Yoruba",
        "communicate_language":       "English",
        "passport_number":            "B9876543",
        "passport_country":           "Nigeria",
        "passport_expiry_year":       "2029",
        "passport_expiry_month":      "11",
        "passport_expiry_day":        "30",
        "mailing_street_num":         "88",
        "mailing_street_name":        "King St W",
        "mailing_city":               "Toronto",
        "mailing_province":           "ON",
        "mailing_postal_code":        "M5H 1A1",
        "mailing_country":            "Canada",
        "phone_area_code":            "647",
        "phone_first_three":          "999",
        "phone_last_five":            "1234",
        "email":                      "test.visitor@email.com",
        "original_entry_date":        "2024-11-01",
        "original_entry_place":       "Toronto Pearson",
        "original_entry_purpose":     "Tourism",
        "recent_entry_date":          "2024-11-01",
        "recent_entry_place":         "Toronto Pearson",
        "visit_purpose":              "Family Visit",
        "visit_from_date":            "2025-01-01",
        "visit_to_date":              "2025-06-30",
        "funds_available":            "15000",
        "expenses_paid_by":           "Myself",
        "will_visit_contact_1_name":  "John Test",
        "will_visit_contact_1_rel":   "Brother",
        "will_visit_contact_1_address": "123 Maple Ave, Toronto ON M4B 1B3",
        "employment": [
            {
                "from_year":  "2018",
                "from_month": "03",
                "occupation": "Accountant",
                "employer":   "Lagos Finance Corp",
                "to_year":    "2025",
                "to_month":   "01",
                "city":       "Lagos",
                "country":    "Nigeria",
                "prov_state": "",
            }
        ],
        "prev_application_refused":   False,
        "has_criminal_record":        False,
        "has_medical_condition":      False,
        "has_military_service":       False,
        "held_government_position":   False,
        "witnessed_ill_treatment":    False,
    }

    fill_imm5708(test_client, "imm5708e__4_.pdf", "imm5708_test_output.pdf")
    print("Test complete. Open imm5708_test_output.pdf in Adobe to verify.")
