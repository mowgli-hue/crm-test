"""
fill_imm5476.py — Fill IMM 5476 (Use of Representative) form for IRCC submissions.

This is auto-generated for every PGWP submission. Newton Immigration is hardcoded
as the representative (Navdeep Singh Sandhu, RCIC R-705964) since Newton is always
the authorized representative for these applications.

Applicant data (name, DOB, phone, email, UCI) comes from the case's pgwpIntake.

Verified end-to-end against Paras Kamboj's filed IMM5476 (which IRCC accepted).

USAGE:
    python3 fill_imm5476.py <input_json> <output_pdf>

The input_json should contain the applicant fields. Defaults below show structure.

Field paths verified against Paras Kamboj's filed IMM5476 reference form.
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from pypdf import PdfReader, PdfWriter

# Constants — Newton Immigration as authorized representative.
# These are HARDCODED because Newton is always the rep for cases generated through this CRM.
NEWTON_REP = {
    "rep_family_name":   "Sandhu",
    "rep_given_name":    "Navdeep Singh",
    "rep_compensated":   True,             # Paid representative
    "rep_cicc_member":   "R-705964",       # CICC membership number
    "rep_org":           "Newton Immigration Inc.",
    "rep_street":        "17282 59A Avenue",
    "rep_city":          "Surrey",
    "rep_province":      "BC",
    "rep_country":       "Canada",
    "rep_postal":        "V3S 5S5",
    "rep_phone_country": "1",
    "rep_phone_number":  "7787236662",
    "rep_email":         "newtonimmigration@gmail.com",
}

# Default applicant data (to be overridden by intake-derived input).
EMPTY_APPLICANT = {
    "applicant_family_name":  "",
    "applicant_given_name":   "",
    "applicant_dob":          "",       # YYYYMMDD format (no separators)
    "applicant_email":        "",
    "applicant_phone":        "",       # raw e.g. "+1(647) 545-8967" or "6475458967"
    "application_type":       "Post Graduate Work Permit",
    "applicant_uci":          "",       # digits only e.g. "113765742"
    "rep_signed_date":        "",       # YYYY-MM-DD
    "applicant_signed_date":  "",       # YYYY-MM-DD (typically same as rep_signed_date)
}

XFA_NS = "http://www.xfa.org/schema/xfa-data/1.0/"
XHTML_NS = "http://www.w3.org/1999/xhtml"


def _find_data_node(root):
    """The XFA datasets root contains an `<xfa:data>` child under which `<IMM_5476>` lives."""
    for ch in root:
        local = ch.tag.split("}")[-1] if "}" in ch.tag else ch.tag
        if local == "data":
            return ch
    return None


def _path_get_all(parent, path_parts):
    """Walk down a path of element names and return ALL matching nodes at the final level."""
    if not path_parts:
        return [parent]
    head, *rest = path_parts
    matches = []
    for child in parent:
        local = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if local == head:
            matches.extend(_path_get_all(child, rest))
    return matches


def _set_text(parent, path_parts, value, occurrence=0):
    """
    Set the text of the element at `path_parts` (relative to parent).
    If multiple siblings exist at the leaf, write to the `occurrence`-th (0-indexed).
    """
    if not path_parts:
        return False
    *parents, leaf = path_parts
    container = _path_get_all(parent, parents)
    if not container:
        return False
    container = container[0]
    leaves = [c for c in container if (c.tag.split("}")[-1] if "}" in c.tag else c.tag) == leaf]
    if not leaves or occurrence >= len(leaves):
        return False
    leaves[occurrence].text = str(value) if value is not None else None
    return True


def _set_richtext(parent, path_parts, value):
    """
    Some fields (e.g., familyName) are stored as XHTML rich-text inside <body><p>...</p></body>.
    This helper finds the <p> inside the body and sets its text content, preserving the structure.
    """
    if not path_parts:
        return False
    nodes = _path_get_all(parent, path_parts)
    if not nodes:
        return False
    target = nodes[0]
    # Find the <body> child (XHTML namespace)
    body = None
    for ch in target:
        local = ch.tag.split("}")[-1] if "}" in ch.tag else ch.tag
        if local == "body":
            body = ch
            break
    if body is None:
        # No body wrapper — fall through to setting plain text
        target.text = str(value) if value is not None else None
        return True
    # Find <p> inside body (recursive — may have spans etc.)
    for p in body.iter():
        p_local = p.tag.split("}")[-1] if "}" in p.tag else p.tag
        if p_local == "p":
            # Clear existing children/text, set fresh value
            for sub in list(p):
                p.remove(sub)
            p.text = str(value) if value is not None else None
            return True
    return False


def _normalize_phone(raw):
    """Strip all non-digit chars from phone. e.g. '+1(647) 545-8967' -> '16475458967'."""
    if not raw:
        return ""
    return "".join(c for c in str(raw) if c.isdigit())


def _format_applicant_phone_for_form(raw):
    """
    The applicant phone field on IMM5476 is formatted nicely with country code/area/etc.
    Paras's form had "+1(647) 545-8967". Reproduce that style if 11 digits starting with 1.
    For 10-digit Canadian numbers, prepend +1 and format as +1(NPA) NXX-XXXX.
    """
    digits = _normalize_phone(raw)
    if not digits:
        return ""
    if len(digits) == 10:
        digits = "1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return f"+1({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
    # Fallback: return raw input
    return str(raw)


def _normalize_dob_yyyymmdd(raw):
    """IMM5476 stores DOB as YYYYMMDD (no separators). Accept various input formats."""
    if not raw:
        return ""
    s = str(raw).strip()
    # Already YYYYMMDD?
    if len(s) == 8 and s.isdigit():
        return s
    # YYYY-MM-DD or YYYY/MM/DD
    digits = "".join(c for c in s if c.isdigit())
    if len(digits) == 8:
        return digits
    return s  # fallback


def _normalize_uci(raw):
    """UCI on the form has no dashes. Strip non-digit chars."""
    if not raw:
        return ""
    return "".join(c for c in str(raw) if c.isdigit())


def fill_imm5476(client_data, input_pdf, output_pdf):
    """
    Fill IMM 5476 form. `client_data` should contain applicant fields (see EMPTY_APPLICANT).
    Newton's representative info is automatically merged in.
    """
    # Merge defaults
    data = {**EMPTY_APPLICANT, **NEWTON_REP, **client_data}

    # Read PDF and locate XFA datasets stream
    reader = PdfReader(input_pdf)
    xfa = list(reader.trailer["/Root"]["/AcroForm"]["/XFA"])
    ds_stream = None
    for i in range(0, len(xfa), 2):
        if str(xfa[i]) == "datasets":
            ds_stream = xfa[i + 1].get_object()
            break
    if ds_stream is None:
        raise RuntimeError("XFA datasets stream not found in PDF")

    xml = ds_stream.get_data().decode("utf-8")
    ET.register_namespace("xfa", XFA_NS)
    ET.register_namespace("", XHTML_NS)
    root = ET.fromstring(xml)

    data_node = _find_data_node(root)
    if data_node is None:
        raise RuntimeError("XFA data node not found")
    # IMM_5476 root container
    imm = None
    for ch in data_node:
        local = ch.tag.split("}")[-1] if "}" in ch.tag else ch.tag
        if local == "IMM_5476":
            imm = ch
            break
    if imm is None:
        raise RuntimeError("IMM_5476 container not found")

    # ── Top of form: which radio button is selected ──────────────────
    # "1" = appointing a representative (always our use case)
    _set_text(imm, ["Page1", "RadioButtonList"], "1")

    # ── SECTION A: Applicant Information ─────────────────────────────
    # familyName is XHTML rich-text (Courier 9pt)
    _set_richtext(imm, ["Page1", "SectionA", "familyName"], data["applicant_family_name"])
    _set_text(imm, ["Page1", "SectionA", "givenName"], data["applicant_given_name"])
    _set_text(imm, ["Page1", "SectionA", "DOB"], _normalize_dob_yyyymmdd(data["applicant_dob"]))

    # SectionA has 3 sibling <office> elements (no, they're not really named "office" — that's a
    # form-template quirk where the fields share an XML name). Their order is:
    #   [0] = Email (3a)         - usually blank if applicant uses phone
    #   [1] = Phone (3b)         - if no email
    #   [2] = Application type   - "Post Graduate Work Permit"
    # We always populate [2] (application type). [0]/[1] for contact info: prefer email if given,
    # else phone — matches IRCC's "either email OR phone" instruction below the email field.
    if data["applicant_email"]:
        _set_text(imm, ["Page1", "SectionA", "office"], data["applicant_email"], occurrence=0)
    if data["applicant_phone"]:
        # Paras's form had phone in the 2nd <office>. Even if email is also provided, write phone too
        # — the form template renders both if present.
        formatted_phone = _format_applicant_phone_for_form(data["applicant_phone"])
        _set_text(imm, ["Page1", "SectionA", "office"], formatted_phone, occurrence=1)
    _set_text(imm, ["Page1", "SectionA", "office"], data["application_type"], occurrence=2)
    _set_text(imm, ["Page1", "SectionA", "UCI"], _normalize_uci(data["applicant_uci"]))

    # ── SECTION B: Representative (Newton Immigration) ───────────────
    _set_richtext(imm, ["Page1", "SectionB", "familyName"], data["rep_family_name"])
    _set_text(imm, ["Page1", "SectionB", "givenName"], data["rep_given_name"])

    # question6/questionII: paid representative + CICC membership
    if data["rep_compensated"]:
        _set_text(imm, ["Page1", "SectionB", "question6", "questionII", "compensated"], "1")
    _set_text(imm, ["Page1", "SectionB", "question6", "questionII", "ICCRCMember"], data["rep_cicc_member"])

    # question7: representative's contact info
    _set_text(imm, ["Page1", "SectionB", "question7", "organization"],     data["rep_org"])
    _set_text(imm, ["Page1", "SectionB", "question7", "streetName"],       data["rep_street"])
    _set_text(imm, ["Page1", "SectionB", "question7", "city"],             data["rep_city"])
    _set_text(imm, ["Page1", "SectionB", "question7", "province"],         data["rep_province"])
    _set_text(imm, ["Page1", "SectionB", "question7", "country"],          data["rep_country"])
    _set_text(imm, ["Page1", "SectionB", "question7", "postalcode"],       data["rep_postal"])
    _set_text(imm, ["Page1", "SectionB", "question7", "phoneCountryCode"], data["rep_phone_country"])
    _set_text(imm, ["Page1", "SectionB", "question7", "phoneNumber"],      _normalize_phone(data["rep_phone_number"]))
    _set_text(imm, ["Page1", "SectionB", "question7", "email"],            data["rep_email"])

    # question8: rep declaration date
    _set_text(imm, ["Page1", "SectionB", "question8", "dateSigned"], data["rep_signed_date"], occurrence=0)

    # ── SECTION E: Applicant declaration ─────────────────────────────
    _set_text(imm, ["sectionE", "dateApplicantSigned"], data["applicant_signed_date"], occurrence=0)

    # ── Save PDF ──────────────────────────────────────────────────────
    new_xml = ET.tostring(root, encoding="unicode")
    ds_stream.set_data(new_xml.encode("utf-8"))

    writer = PdfWriter()
    writer.append(reader)
    Path(output_pdf).parent.mkdir(parents=True, exist_ok=True)
    with open(output_pdf, "wb") as f:
        writer.write(f)

    print(f"✅  IMM5476 filled → {output_pdf}")


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 fill_imm5476.py <input_json> <output_pdf> [<blank_template>]")
        sys.exit(1)

    input_json = sys.argv[1]
    output_pdf = sys.argv[2]
    template = sys.argv[3] if len(sys.argv) > 3 else str(Path(__file__).parent / "blank_imm5476.pdf")

    with open(input_json) as f:
        client_data = json.load(f)

    fill_imm5476(client_data, template, output_pdf)


if __name__ == "__main__":
    main()
