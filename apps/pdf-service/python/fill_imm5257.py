"""
IMM5257 Auto-Fill Script — Generic CRM Edition
===============================================
IMM5257 = Application for a Temporary Resident Visa (Visitor Visa)
          or Electronic Travel Authorization (eTA)

KEY DIFFERENCES from 5708/5709/5710:
  - VisaType field: "Visitor Visa" or "Transit" (unique to this form)
  - CountryWhereApplying: country where applicant is physically applying from
  - SameAsCORIndicator: whether country of applying = country of residence
  - No "What are you applying for?" checkboxes — replaced by VisaType dropdown
  - Funds: amount only — no "who pays" dropdown
  - Education: single row, different field names (FromYear/ToYear, CityTown)
  - Occupation: OccupationRow1/2/3 structure with FromYear/ToYear (not YYYY/MM)
  - Background: PageWrapper subform wraps Q3/Q4 (criminal/military)
  - Address field names differ: CityTown (not City), ProvinceState (not Prov)
  - Passport field names differ: IssueYYYY/IssueMM/IssueDD, expiryYYYY/expiryMM/expiryDD

Usage:
    from fill_imm5257 import fill_imm5257, EMPTY_CLIENT
    fill_imm5257(crm_data, "blank_imm5257.pdf", f"filled_{case_id}.pdf")

Requirements:
    pip install pypdf
"""

from pypdf import PdfReader, PdfWriter
import xml.etree.ElementTree as ET


# ══════════════════════════════════════════════════════════════════
#  CRM DATA TEMPLATE
# ══════════════════════════════════════════════════════════════════
EMPTY_CLIENT = {

    # ── SECTION 1: Visa type & service ───────────────────────────
    # CRM Q: "What type of visa are you applying for?"
    # Options: Visitor Visa | Transit
    "visa_type":                     "",
    # CRM Q: "I want service in:"  (English | French)
    "service_in":                    "",

    # ── SECTION 2: Personal Information ──────────────────────────
    "uci_client_id":                 "",
    "family_name":                   "",      # As shown on passport
    "given_name":                    "",
    "has_alias":                     False,   # Ever used another name?
    "alias_family_name":             "",
    "alias_given_name":              "",
    "sex":                           "",      # F Female | M Male | U Unknown | X Another gender
    "dob_year":                      "",      # YYYY
    "dob_month":                     "",      # MM
    "dob_day":                       "",      # DD
    "place_birth_city":              "",
    "place_birth_country":           "",
    "citizenship_country":           "",

    # ── SECTION 3: Current country of residence ──────────────────
    # CRM Q: "What country do you currently live in?"
    "current_country":               "",      # Full country name
    # CRM Q: "What is your current immigration status in that country?"
    # Options: Citizen | Permanent resident | Visitor | Worker | Student | Other | Protected Person | Foreign National
    "current_status":                "",
    "current_status_other":          "",
    "current_status_from_date":      "",      # YYYY-MM-DD
    "current_status_to_date":        "",

    # Previous countries of residence
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

    # ── SECTION 3b: Country where applying (5257-UNIQUE) ─────────
    # CRM Q: "What country are you applying from?" (may differ from residence)
    "country_where_applying":        "",
    "country_where_applying_status": "",
    "country_where_applying_other":  "",
    "country_where_applying_from":   "",      # YYYY-MM-DD
    "country_where_applying_to":     "",      # YYYY-MM-DD
    # CRM Q: "Is this the same as your current country of residence?"
    "same_as_cor":                   True,    # If True, CountryWhereApplying mirrors COR

    # ── SECTION 4: Marital Status ─────────────────────────────────
    # Options: Annulled Marriage | Common-Law | Divorced | Legally Separated | Married | Single | Unknown | Widowed
    "marital_status":                "",
    "spouse_family_name":            "",
    "spouse_given_name":             "",
    "date_of_marriage":              "",      # YYYY-MM-DD (if Married or Common-Law)
    "previously_married":            False,
    "prev_spouse_family_name":       "",
    "prev_spouse_given_name":        "",
    "prev_spouse_dob_year":          "",
    "prev_spouse_dob_month":         "",
    "prev_spouse_dob_day":           "",
    "prev_relationship_type":        "",      # Married | Common-Law
    "prev_marriage_from":            "",
    "prev_marriage_to":              "",

    # ── SECTION 5: Passport ───────────────────────────────────────
    # NOTE: field names are different from 5708/5709/5710
    # IssueYYYY/IssueMM/IssueDD and expiryYYYY/expiryMM/expiryDD
    "passport_number":               "",
    "passport_country":              "",
    "passport_issue_year":           "",      # YYYY
    "passport_issue_month":          "",      # MM
    "passport_issue_day":            "",      # DD
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

    # ── SECTION 6: Languages ─────────────────────────────────────
    "native_language":               "",      # e.g. "Hindi", "Arabic"
    "communicate_language":          "",      # English | French | Both | Neither
    "frequent_language":             "",      # English | French | Both | Neither
    "language_test_taken":           False,

    # ── SECTION 7: Contact / Mailing Address ─────────────────────
    # NOTE: field names differ — CityTown (not City), ProvinceState (not Prov)
    "mailing_po_box":                "",
    "mailing_apt_unit":              "",
    "mailing_street_num":            "",
    "mailing_street_name":           "",
    "mailing_city":                  "",      # → CityTown
    "mailing_province":              "",      # → ProvinceState (can be province or state)
    "mailing_postal_code":           "",
    "mailing_country":               "",
    "mailing_district":              "",
    "residential_same_as_mailing":   True,
    "residential_apt_unit":          "",
    "residential_street_num":        "",
    "residential_street_name":       "",
    "residential_city":              "",
    "residential_province":          "",
    "residential_postal_code":       "",
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

    # ── SECTION 8: Details of Visit (Page 3) ─────────────────────
    # CRM Q: "What is the purpose of your visit to Canada?"
    # Options: Business | Tourism | Short-Term Studies | Returning Student |
    #          Returning Worker | Super Visa: For Parents or Grandparents |
    #          Family Visit | Visit | Other
    "visit_purpose":                 "",
    "visit_purpose_other":           "",
    # CRM Q: "When do you plan to arrive in Canada?" (YYYY-MM-DD)
    "visit_from_date":               "",
    # CRM Q: "When do you plan to leave Canada?" (YYYY-MM-DD)
    "visit_to_date":                 "",
    # CRM Q: "How much money do you have available for your stay? (CAD)"
    # NOTE: 5257 has NO "who pays" dropdown — just the amount
    "funds_available":               "",

    # Contacts in Canada (up to 2)
    "contact_1_name":                "",
    "contact_1_relationship":        "",
    "contact_1_address":             "",
    "contact_2_name":                "",
    "contact_2_relationship":        "",
    "contact_2_address":             "",

    # ── SECTION 9: Education (single row — different from 5708) ──
    # CRM Q: "Do you have any education to declare?"
    "has_education":                 False,
    "edu_from_year":                 "",      # YYYY
    "edu_from_month":                "",      # MM
    "edu_to_year":                   "",
    "edu_to_month":                  "",
    "edu_field_of_study":            "",
    "edu_school_name":               "",
    "edu_city":                      "",      # → CityTown
    "edu_country":                   "",
    "edu_province":                  "",      # → ProvState

    # ── SECTION 10: Occupation / Employment (up to 3 rows) ───────
    # NOTE: uses OccupationRow1/2/3 with FromYear/ToYear fields (not YYYY/MM pattern)
    # CRM Q: "List your occupation/employment history (most recent first, up to 3)"
    "occupation": [
        # {
        #   "from_year":   "YYYY",
        #   "from_month":  "MM",
        #   "to_year":     "YYYY",
        #   "to_month":    "MM",
        #   "occupation":  "Job title or activity",
        #   "employer":    "Company name",
        #   "city":        "City",
        #   "country":     "Country",
        #   "prov_state":  "Province or State",
        # }
    ],

    # ── SECTION 11: Background Questions ─────────────────────────
    # Q1: Medical
    "has_medical_condition":         False,
    "medical_details":               "",
    # Q2: Previous refused applications
    "prev_application_refused":      False,
    "prev_refused_to_canada":        False,
    "prev_refused_details":          "",
    # Q3: Criminal (in PageWrapper subform)
    "has_criminal_record":           False,
    "criminal_details":              "",
    # Q4: Military (in PageWrapper subform)
    "has_military_service":          False,
    "military_details":              "",
    # Q5: Government position (in PageWrapper subform)
    "held_government_position":      False,
    # Q6: Ill treatment (in PageWrapper subform) — NOTE: no separate qWitnessNY, uses Choice
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


def fill_imm5257(client: dict, input_pdf: str, output_pdf: str) -> str:
    """Fill IMM5257 from CRM dict and save to output_pdf."""

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

    # ── SECTION 1: Visa type & service ───────────────────────────
    sv(data["visa_type"],  "Page1","PersonalDetails","VisaType","VisaType")
    sv(data["service_in"], "Page1","PersonalDetails","ServiceIn","ServiceIn")
    sv(data["uci_client_id"], "Page1","PersonalDetails","UCIClientID")

    # ── SECTION 2: Personal ───────────────────────────────────────
    sv(data["family_name"],         "Page1","PersonalDetails","Name","FamilyName")
    sv(data["given_name"],          "Page1","PersonalDetails","Name","GivenName")
    if data["has_alias"]:
        sv(data["alias_family_name"], "Page1","PersonalDetails","AliasName","AliasFamilyName")
        sv(data["alias_given_name"],  "Page1","PersonalDetails","AliasName","AliasGivenName")
        sv("Y", "Page1","PersonalDetails","AliasName","AliasNameIndicator","AliasNameIndicator")
    sv(data["sex"],         "Page1","PersonalDetails","Sex","Sex")
    sv(data["dob_year"],    "Page1","PersonalDetails","DOBYear")
    sv(data["dob_month"],   "Page1","PersonalDetails","DOBMonth")
    sv(data["dob_day"],     "Page1","PersonalDetails","DOBDay")
    sv(data["place_birth_city"],    "Page1","PersonalDetails","PlaceBirthCity")
    sv(data["place_birth_country"], "Page1","PersonalDetails","PlaceBirthCountry")
    sv(data["citizenship_country"], "Page1","PersonalDetails","Citizenship","Citizenship")

    # ── SECTION 3: Current country of residence ───────────────────
    sv(data["current_country"],          "Page1","PersonalDetails","CurrentCOR","Row2","Country")
    sv(data["current_status"],           "Page1","PersonalDetails","CurrentCOR","Row2","Status")
    sv(data["current_status_other"],     "Page1","PersonalDetails","CurrentCOR","Row2","Other")
    sv(data["current_status_from_date"], "Page1","PersonalDetails","CurrentCOR","Row2","FromDate")
    sv(data["current_status_to_date"],   "Page1","PersonalDetails","CurrentCOR","Row2","ToDate")
    if data["prev_country_1"]:
        sv(data["prev_country_1"],       "Page1","PersonalDetails","PreviousCOR","Row2","Country")
        sv(data["prev_status_1"],        "Page1","PersonalDetails","PreviousCOR","Row2","Status")
        sv(data["prev_status_other_1"],  "Page1","PersonalDetails","PreviousCOR","Row2","Other")
        sv(data["prev_from_date_1"],     "Page1","PersonalDetails","PreviousCOR","Row2","FromDate")
        sv(data["prev_to_date_1"],       "Page1","PersonalDetails","PreviousCOR","Row2","ToDate")
    if data["prev_country_2"]:
        sv(data["prev_country_2"],       "Page1","PersonalDetails","PreviousCOR","Row3","Country")
        sv(data["prev_status_2"],        "Page1","PersonalDetails","PreviousCOR","Row3","Status")
        sv(data["prev_status_other_2"],  "Page1","PersonalDetails","PreviousCOR","Row3","Other")
        sv(data["prev_from_date_2"],     "Page1","PersonalDetails","PreviousCOR","Row3","FromDate")
        sv(data["prev_to_date_2"],       "Page1","PersonalDetails","PreviousCOR","Row3","ToDate")

    # ── SECTION 3b: Country where applying ───────────────────────
    if not data["same_as_cor"] and data["country_where_applying"]:
        sv(data["country_where_applying"],        "Page1","PersonalDetails","CountryWhereApplying","Row2","Country")
        sv(data["country_where_applying_status"], "Page1","PersonalDetails","CountryWhereApplying","Row2","Status")
        sv(data["country_where_applying_other"],  "Page1","PersonalDetails","CountryWhereApplying","Row2","Other")
        sv(data["country_where_applying_from"],   "Page1","PersonalDetails","CountryWhereApplying","Row2","FromDate")
        sv(data["country_where_applying_to"],     "Page1","PersonalDetails","CountryWhereApplying","Row2","ToDate")
    if data["same_as_cor"]:
        sv("Y", "Page1","PersonalDetails","SameAsCORIndicator")

    # ── SECTION 4: Marital ────────────────────────────────────────
    sv(data["marital_status"],   "Page1","MaritalStatus","SectionA","MaritalStatus")
    if data["marital_status"] in ("Married", "Common-Law"):
        sv(data["spouse_family_name"], "Page1","MaritalStatus","SectionA","FamilyName")
        sv(data["spouse_given_name"],  "Page1","MaritalStatus","SectionA","GivenName")
        dom = data.get("date_of_marriage","")
        if dom and len(dom) == 10:
            sv(dom[:4],  "Page1","MaritalStatus","SectionA","MarriageDate","FromYr")
            sv(dom[5:7], "Page1","MaritalStatus","SectionA","MarriageDate","FromMM")
            sv(dom[8:],  "Page1","MaritalStatus","SectionA","MarriageDate","FromDD")
    if data["previously_married"]:
        sv("Y",                              "Page2","MaritalStatus","SectionA","PrevMarriedIndicator")
        sv(data["prev_spouse_family_name"],  "Page2","MaritalStatus","SectionA","PMFamilyName")
        sv(data["prev_spouse_given_name"],   "Page2","MaritalStatus","SectionA","GivenName","PMGivenName")
        sv(data["prev_spouse_dob_year"],     "Page2","MaritalStatus","SectionA","PrevSpouseDOB","DOBYear")
        sv(data["prev_spouse_dob_month"],    "Page2","MaritalStatus","SectionA","PrevSpouseDOB","DOBMonth")
        sv(data["prev_spouse_dob_day"],      "Page2","MaritalStatus","SectionA","PrevSpouseDOB","DOBDay")
        sv(data["prev_relationship_type"],   "Page2","MaritalStatus","SectionA","TypeOfRelationship")
        sv(data["prev_marriage_from"],       "Page2","MaritalStatus","SectionA","FromDate")
        sv(data["prev_marriage_to"],         "Page2","MaritalStatus","SectionA","ToDate","ToDate")

    # ── SECTION 5: Passport ───────────────────────────────────────
    # NOTE: unique field names IssueYYYY/expiryYYYY
    sv(data["passport_number"],       "Page2","MaritalStatus","SectionA","Passport","PassportNum","PassportNum")
    sv(data["passport_country"],      "Page2","MaritalStatus","SectionA","Passport","CountryofIssue","CountryofIssue")
    sv(data["passport_issue_year"],   "Page2","MaritalStatus","SectionA","Passport","IssueYYYY")
    sv(data["passport_issue_month"],  "Page2","MaritalStatus","SectionA","Passport","IssueMM")
    sv(data["passport_issue_day"],    "Page2","MaritalStatus","SectionA","Passport","IssueDD")
    sv(data["passport_expiry_year"],  "Page2","MaritalStatus","SectionA","Passport","expiryYYYY")
    sv(data["passport_expiry_month"], "Page2","MaritalStatus","SectionA","Passport","expiryMM")
    sv(data["passport_expiry_day"],   "Page2","MaritalStatus","SectionA","Passport","expiryDD")
    if data["has_national_id"]:
        sv("Y",                            "Page2","natID","q1","natIDIndicator")
        sv(data["national_id_number"],     "Page2","natID","natIDdocs","DocNum","DocNum")
        sv(data["national_id_country"],    "Page2","natID","natIDdocs","CountryofIssue","CountryofIssue")
        sv(data["national_id_issue_date"], "Page2","natID","natIDdocs","IssueDate","IssueDate")
        sv(data["national_id_expiry_date"],"Page2","natID","natIDdocs","ExpiryDate")
    if data["has_us_card"]:
        sv("Y",                        "Page2","USCard","q1","usCardIndicator")
        sv(data["us_card_number"],     "Page2","USCard","usCarddocs","DocNum","DocNum")
        sv(data["us_card_expiry_date"],"Page2","USCard","usCarddocs","ExpiryDate")

    # ── SECTION 6: Languages ─────────────────────────────────────
    sv(data["native_language"],      "Page2","MaritalStatus","SectionA","Languages","languages","nativeLang","nativeLang")
    sv(data["communicate_language"], "Page2","MaritalStatus","SectionA","Languages","languages","ableToCommunicate","ableToCommunicate")
    sv(data["frequent_language"],    "Page2","MaritalStatus","SectionA","Languages","languages","lov")
    sv("Y" if data["language_test_taken"] else "N",
       "Page2","MaritalStatus","SectionA","Languages","LanguageTest")

    # ── SECTION 7: Contact / Address ─────────────────────────────
    # NOTE: CityTown (not City), ProvinceState (not Prov)
    sv(data["mailing_po_box"],      "Page2","ContactInformation","contact","AddressRow1","POBox","POBox")
    sv(data["mailing_apt_unit"],    "Page2","ContactInformation","contact","AddressRow1","Apt","AptUnit")
    sv(data["mailing_street_num"],  "Page2","ContactInformation","contact","AddressRow1","StreetNum","StreetNum")
    sv(data["mailing_street_name"], "Page2","ContactInformation","contact","AddressRow1","Streetname","Streetname")
    sv(data["mailing_city"],        "Page2","ContactInformation","contact","AddressRow2","CityTow","CityTown")
    sv(data["mailing_country"],     "Page2","ContactInformation","contact","AddressRow2","Country","Country")
    sv(data["mailing_province"],    "Page2","ContactInformation","contact","AddressRow2","ProvinceState","ProvinceState")
    sv(data["mailing_postal_code"], "Page2","ContactInformation","contact","AddressRow2","PostalCode","PostalCode")
    sv(data["mailing_district"],    "Page2","ContactInformation","contact","AddressRow2","District")
    if not data["residential_same_as_mailing"]:
        sv(data["residential_apt_unit"],    "Page2","ContactInformation","contact","ResidentialAddressRow1","AptUnit","AptUnit")
        sv(data["residential_street_num"],  "Page2","ContactInformation","contact","ResidentialAddressRow1","StreetNum","StreetNum")
        sv(data["residential_street_name"], "Page2","ContactInformation","contact","ResidentialAddressRow1","StreetName","Streetname")
        sv(data["residential_city"],        "Page2","ContactInformation","contact","ResidentialAddressRow1","CityTown","CityTown")
        sv(data["residential_country"],     "Page2","ContactInformation","contact","ResidentialAddressRow2","Country","Country")
        sv(data["residential_province"],    "Page2","ContactInformation","contact","ResidentialAddressRow2","ProvinceState","ProvinceState")
        sv(data["residential_postal_code"], "Page2","ContactInformation","contact","ResidentialAddressRow2","PostalCode","PostalCode")
    # Phone
    is_ca_us = str(data.get("phone_type","")).upper() in ("CANADA/US","CANADA","US","")
    sv("1" if is_ca_us else "0",    "Page2","ContactInformation","contact","PhoneNumbers","Phone","CanadaUS")
    sv(data["phone_number_type"],   "Page2","ContactInformation","contact","PhoneNumbers","Phone","Type")
    sv(data["phone_extension"],     "Page2","ContactInformation","contact","PhoneNumbers","Phone","NumberExt")
    if is_ca_us:
        sv(data["phone_area_code"],  "Page2","ContactInformation","contact","PhoneNumbers","Phone","NANumber","AreaCode")
        sv(data["phone_first_three"],"Page2","ContactInformation","contact","PhoneNumbers","Phone","NANumber","FirstThree")
        sv(data["phone_last_five"],  "Page2","ContactInformation","contact","PhoneNumbers","Phone","NANumber","LastFive")
    else:
        sv(data["phone_intl_number"],"Page2","ContactInformation","contact","PhoneNumbers","Phone","IntlNumber","IntlNumber")
    if data["alt_phone_area_code"]:
        sv("1",                           "Page2","ContactInformation","contact","PhoneNumbers","AltPhone","CanadaUS")
        sv(data["alt_phone_area_code"],   "Page2","ContactInformation","contact","PhoneNumbers","AltPhone","NANumber","AreaCode")
        sv(data["alt_phone_first_three"], "Page2","ContactInformation","contact","PhoneNumbers","AltPhone","NANumber","FirstThree")
        sv(data["alt_phone_last_five"],   "Page2","ContactInformation","contact","PhoneNumbers","AltPhone","NANumber","LastFive")
    sv(data["email"], "Page2","ContactInformation","contact","FaxEmail","Email")

    # ── SECTION 8: Details of Visit ──────────────────────────────
    sv(data["visit_purpose"],       "Page3","DetailsOfVisit","PurposeRow1","PurposeOfVisit","PurposeOfVisit")
    sv(data["visit_purpose_other"], "Page3","DetailsOfVisit","PurposeRow1","Other","Other")
    sv(data["visit_from_date"],     "Page3","DetailsOfVisit","PurposeRow1","HowLongStay","FromDate")
    sv(data["visit_to_date"],       "Page3","DetailsOfVisit","PurposeRow1","HowLongStay","ToDate")
    sv(data["funds_available"],     "Page3","DetailsOfVisit","PurposeRow1","Funds","Funds")
    # Contacts in Canada
    sv(data["contact_1_name"],         "Page3","DetailsOfVisit","Contacts_Row1","Name","Name")
    sv(data["contact_1_relationship"], "Page3","DetailsOfVisit","Contacts_Row1","RelationshipToMe","RelationshipToMe")
    sv(data["contact_1_address"],      "Page3","DetailsOfVisit","Contacts_Row1","AddressInCanada","AddressInCanada")
    sv(data["contact_2_name"],         "Page3","Contacts_Row2","Name","Name")
    sv(data["contact_2_relationship"], "Page3","Contacts_Row2","Relationship","RelationshipToMe")
    sv(data["contact_2_address"],      "Page3","Contacts_Row2","AddressInCanada","AddressInCanada")

    # ── SECTION 9: Education (single row, unique field names) ─────
    if data["has_education"] or data["edu_school_name"]:
        sv("Y",                       "Page3","Education","EducationIndicator")
        sv(data["edu_from_year"],     "Page3","Education","Edu_Row1","FromYear")
        sv(data["edu_from_month"],    "Page3","Education","Edu_Row1","FromMonth")
        sv(data["edu_to_year"],       "Page3","Education","Edu_Row1","ToYear")
        sv(data["edu_to_month"],      "Page3","Education","Edu_Row1","ToMonth")
        sv(data["edu_field_of_study"],"Page3","Education","Edu_Row1","FieldOfStudy")
        sv(data["edu_school_name"],   "Page3","Education","Edu_Row1","School")
        sv(data["edu_city"],          "Page3","Education","Edu_Row1","CityTown")
        sv(data["edu_country"],       "Page3","Education","Edu_Row1","Country","Country")
        sv(data["edu_province"],      "Page3","Education","Edu_Row1","ProvState")

    # ── SECTION 10: Occupation (OccupationRow1/2/3, unique structure) ──
    occ_rows = ["OccupationRow1", "OccupationRow2", "OccupationRow3"]
    for idx, occ in enumerate(data.get("occupation", [])[:3]):
        row = occ_rows[idx]
        sv(occ.get("from_year"),   "Page3","Occupation",row,"FromYear")
        sv(occ.get("from_month"),  "Page3","Occupation",row,"FromMonth")
        sv(occ.get("to_year"),     "Page3","Occupation",row,"ToYear")
        sv(occ.get("to_month"),    "Page3","Occupation",row,"ToMonth")
        sv(occ.get("occupation"),  "Page3","Occupation",row,"Occupation","Occupation")
        sv(occ.get("employer"),    "Page3","Occupation",row,"Employer")
        sv(occ.get("city"),        "Page3","Occupation",row,"CityTown","CityTown")
        sv(occ.get("country"),     "Page3","Occupation",row,"Country","Country")
        sv(occ.get("prov_state"),  "Page3","Occupation",row,"ProvState")

    # ── SECTION 11: Background ─────────────────────────────────────
    # Q1: Medical — BackgroundInfo/Choice (first=yes, second=no) and Details/MedicalDetails
    sv("Y" if data["has_medical_condition"] else "N",
       "Page3","BackgroundInfo","Choice")
    sv(data["medical_details"],
       "Page3","BackgroundInfo","Details","MedicalDetails")

    # Q2: Refused visa/permit — BackgroundInfo2
    sv("Y" if data["prev_application_refused"] else "N",
       "Page3","BackgroundInfo2","VisaChoice1")
    sv("Y" if data["prev_refused_to_canada"]   else "N",
       "Page3","BackgroundInfo2","VisaChoice2")
    sv(data["prev_refused_details"],
       "Page3","BackgroundInfo2","Details","refusedDetails")

    # Q3/4/5/6: Criminal, Military, Occupation, GovPosition — in PageWrapper
    sv("Y" if data["has_criminal_record"]      else "N",
       "Page3","PageWrapper","BackgroundInfo3","Choice")
    sv(data["criminal_details"],
       "Page3","PageWrapper","BackgroundInfo3","details")
    sv("Y" if data["has_military_service"]     else "N",
       "Page3","PageWrapper","Military","Choice")
    sv(data["military_details"],
       "Page3","PageWrapper","Military","militaryServiceDetails")
    sv("Y" if data["held_government_position"] else "N",
       "Page3","PageWrapper","GovPosition","Choice")
    sv("Y" if data["witnessed_ill_treatment"]  else "N",
       "Page3","PageWrapper","Occupation","Choice")

    # ── Save ──────────────────────────────────────────────────────
    ET.register_namespace('xfa', XFA_NS)
    ds_stream.set_data(ET.tostring(root, encoding='unicode').encode('utf-8'))
    writer = PdfWriter()
    writer.append(reader)
    with open(output_pdf, 'wb') as f:
        writer.write(f)

    print(f"✅  IMM5257 filled → {output_pdf}")
    return output_pdf


# ══════════════════════════════════════════════════════════════════
#  QUICK TEST
# ══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    test_client = {
        **EMPTY_CLIENT,
        "visa_type":                  "Visitor Visa",
        "service_in":                 "English",
        "family_name":                "Test",
        "given_name":                 "Visitor",
        "sex":                        "F Female",
        "dob_year":                   "1990",
        "dob_month":                  "03",
        "dob_day":                    "25",
        "place_birth_city":           "Mumbai",
        "place_birth_country":        "India",
        "citizenship_country":        "India",
        "current_country":            "India",
        "current_status":             "Citizen",
        "same_as_cor":                True,
        "marital_status":             "Single",
        "passport_number":            "X1234567",
        "passport_country":           "India",
        "passport_issue_year":        "2019",
        "passport_issue_month":       "06",
        "passport_issue_day":         "15",
        "passport_expiry_year":       "2029",
        "passport_expiry_month":      "06",
        "passport_expiry_day":        "14",
        "native_language":            "Hindi",
        "communicate_language":       "English",
        "frequent_language":          "English",
        "mailing_street_num":         "42",
        "mailing_street_name":        "Nehru Rd",
        "mailing_city":               "Mumbai",
        "mailing_country":            "India",
        "phone_type":                 "International",
        "phone_intl_number":          "+919876543210",
        "email":                      "test.visitor@email.com",
        "visit_purpose":              "Tourism",
        "visit_from_date":            "2026-06-01",
        "visit_to_date":              "2026-08-31",
        "funds_available":            "20000",
        "contact_1_name":             "Raj Test",
        "contact_1_relationship":     "Brother",
        "contact_1_address":          "100 King St, Toronto ON M5H 1A1",
        "has_education":              True,
        "edu_from_year":              "2008",
        "edu_from_month":             "06",
        "edu_to_year":                "2012",
        "edu_to_month":               "05",
        "edu_field_of_study":         "Engineering",
        "edu_school_name":            "IIT Bombay",
        "edu_city":                   "Mumbai",
        "edu_country":                "India",
        "occupation": [
            {
                "from_year":  "2012",
                "from_month": "07",
                "to_year":    "2026",
                "to_month":   "01",
                "occupation": "Software Engineer",
                "employer":   "Tata Consultancy",
                "city":       "Mumbai",
                "country":    "India",
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

    fill_imm5257(test_client, "imm5257e__3_.pdf", "imm5257_test_output.pdf")
    print("Test complete. Open imm5257_test_output.pdf in Adobe to verify.")
