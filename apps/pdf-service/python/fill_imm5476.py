"""
fill_imm5476.py — Fill IMM 5476 (Use of Representative) form for IRCC submissions.

Generated for every PGWP/work-permit/study-permit submission. Newton Immigration is
hardcoded as the representative (Navdeep Singh Sandhu, RCIC R-705964).

Targets IMM 5476 (11-2025) revision.

DESIGN — STRING-BASED XML MUTATION
───────────────────────────────────
Earlier versions used Python's ElementTree to parse + mutate + re-serialize.
That broke Adobe Reader's data binding: when ET re-serialized after touching
rich-text fields (`<html:body><html:p>`), the XHTML namespace got promoted to
the default, and ALL elements ended up tagged as `<html:IMM_5476>` etc. Adobe
couldn't match them to the form template (which expects `<IMM_5476>` with no
namespace), so every field rendered blank.

String-based mutation is namespace-safe by construction.

USAGE:
    python3 fill_imm5476.py <input_json> <output_pdf>
"""
import json, re, sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter
import pikepdf

NEWTON_REP = {
    "rep_family_name":   "Sandhu",
    "rep_given_name":    "Navdeep Singh",
    "rep_compensated":   True,
    "rep_cicc_member":   "R-705964",
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

EMPTY_APPLICANT = {
    "applicant_family_name":  "",
    "applicant_given_name":   "",
    "applicant_dob":          "",
    "applicant_email":        "",
    "applicant_phone":        "",
    "application_type":       "Post Graduate Work Permit",
    "applicant_uci":          "",
    "rep_signed_date":        "",
    "applicant_signed_date":  "",
}


def _normalize_phone(raw):
    if not raw: return ""
    return "".join(c for c in str(raw) if c.isdigit())


def _format_applicant_phone_for_form(raw):
    digits = _normalize_phone(raw)
    if not digits: return ""
    if len(digits) == 10: digits = "1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return f"+1({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
    return str(raw)


def _normalize_dob(raw):
    """IMM 5476 (11-2025) form picture is `date{YYYY-MM-DD}`."""
    if not raw: return ""
    s = str(raw).strip()
    if len(s) == 10 and s[4] == "-" and s[7] == "-": return s
    if len(s) == 10 and s[4] == "/" and s[7] == "/": return s.replace("/", "-")
    digits = "".join(c for c in s if c.isdigit())
    if len(digits) == 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:]}"
    return s


def _normalize_uci(raw):
    if not raw: return ""
    return "".join(c for c in str(raw) if c.isdigit())


def _xml_escape(text):
    if text is None: return ""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _find_parent_span(xml, path_parts):
    """
    Find [start, end) covering contents of the parent at `path_parts`.

    Supports IRCC's quirky XFA serialization that puts whitespace/newlines
    inside tags: `<Page1\n>` instead of `<Page1>`. Standard XML, just visually
    weird — our regexes use [\s\S]* and \s* to handle it.
    """
    cursor_start = 0
    cursor_end = len(xml)

    for tag in path_parts:
        # `<Tag>` or `<Tag attr=...>` — possibly with newlines inside
        open_pattern = re.compile(rf"<{re.escape(tag)}(?:\s[^>]*)?\s*>")
        m = open_pattern.search(xml, cursor_start, cursor_end)
        if not m:
            return None

        start_inner = m.end()
        depth = 1
        idx = start_inner
        same_open = re.compile(rf"<{re.escape(tag)}(?:\s[^>]*)?\s*>")
        same_close = re.compile(rf"</{re.escape(tag)}\s*>")

        while idx < cursor_end and depth > 0:
            opens = same_open.search(xml, idx, cursor_end)
            closes = same_close.search(xml, idx, cursor_end)
            if closes is None:
                return None
            if opens and opens.start() < closes.start():
                depth += 1
                idx = opens.end()
            else:
                depth -= 1
                if depth == 0:
                    cursor_start = start_inner
                    cursor_end = closes.start()
                    break
                idx = closes.end()

    return (cursor_start, cursor_end)


def _set_simple_field(xml, path, value, occurrence=0):
    """
    Replace a self-closing `<Leaf/>` (or `<Leaf\n/>`) inside the given parent
    path with `<Leaf>value</Leaf>`. `path` is the full traversal from
    IMM_5476 down to the leaf. `occurrence` selects which sibling.

    Also handles the case where the leaf already has content (e.g.,
    `<organization>Newton Immigration Inc. </organization>` in your
    pre-filled template) — in that case it leaves the existing content alone
    UNLESS the input data is non-empty AND differs. Currently we treat
    "field already has content" as "skip" so we don't accidentally clobber
    your manually-pre-filled fields.
    """
    if value is None or value == "":
        return xml

    *parents, leaf = path
    parent_span = _find_parent_span(xml, parents)
    if parent_span is None:
        return xml

    start, end = parent_span
    section = xml[start:end]

    # Match self-closing: `<Leaf/>` or `<Leaf />` or `<Leaf\n/>` etc.
    pattern = re.compile(rf"<{re.escape(leaf)}\s*/>")
    matches = list(pattern.finditer(section))
    if occurrence >= len(matches):
        return xml

    match = matches[occurrence]
    new_section = (
        section[:match.start()]
        + f"<{leaf}>{_xml_escape(value)}</{leaf}>"
        + section[match.end():]
    )
    return xml[:start] + new_section + xml[end:]


def _set_richtext(xml, path, value):
    """
    For XHTML rich-text fields like familyName which contain
    `<body xmlns="http://www.w3.org/1999/xhtml"><p ...>...</p></body>`,
    replace the empty `<span>...</span>` placeholder (or the entire `<p>`
    body) with our value.

    Note: in IRCC's serialization (your pre-filled template), the body uses
    `<body xmlns="...">` with no html: prefix on individual children — the
    namespace is declared on the body element. Our writer preserves this
    structure by replacing only the `<p>...</p>` inner content.
    """
    if not value:
        return xml
    parent_span = _find_parent_span(xml, path)
    if parent_span is None:
        return xml
    start, end = parent_span
    section = xml[start:end]

    # Find the <p ...> opening and matching </p>
    p_open = re.compile(r"<p(\s[^>]*)?\s*>")
    p_close = re.compile(r"</p\s*>")
    om = p_open.search(section)
    cm = p_close.search(section)
    if not om or not cm:
        return xml

    attrs = om.group(1) or ""
    # Replace the entire <p ...>...</p> with <p ...>value</p>
    new_p = f"<p{attrs}>{_xml_escape(value)}</p>"
    new_section = section[:om.start()] + new_p + section[cm.end():]
    return xml[:start] + new_section + xml[end:]


def fill_imm5476(client_data, input_pdf, output_pdf):
    """Fill IMM 5476. Newton's rep info auto-merged into client_data."""
    data = {**EMPTY_APPLICANT, **NEWTON_REP, **client_data}

    reader = PdfReader(input_pdf)
    xfa = list(reader.trailer["/Root"]["/AcroForm"]["/XFA"])
    ds_stream = None
    for i in range(0, len(xfa), 2):
        if str(xfa[i]) == "datasets":
            ds_stream = xfa[i + 1].get_object()
            break
    if ds_stream is None:
        raise RuntimeError("XFA datasets stream not found")

    xml = ds_stream.get_data().decode("utf-8")

    # NOTE: Newton's representative info (Section B name, paid/CICC, address,
    # phone, email, organization, "appointing" radio button) is PRE-FILLED in
    # the blank_imm5476.pdf template — we manually loaded those fields into
    # the template once. The filler only writes:
    #   - SECTION A: applicant info (varies per case)
    #   - question8 dateSigned (rep declaration date — today)
    #   - sectionE dateApplicantSigned (applicant declaration date — today)
    # If a future change requires updating Newton's info, edit the template
    # PDF directly using Adobe Reader, then save it back to the repo.

    # SECTION A: Applicant
    xml = _set_richtext(xml,    ["IMM_5476", "Page1", "SectionA", "familyName"],  data["applicant_family_name"])
    xml = _set_simple_field(xml, ["IMM_5476", "Page1", "SectionA", "givenName"],   data["applicant_given_name"])
    xml = _set_simple_field(xml, ["IMM_5476", "Page1", "SectionA", "DOB"],         _normalize_dob(data["applicant_dob"]))

    # 3 sibling <office/>: [0]=email, [1]=phone, [2]=app type.
    # IMPORTANT: write from highest occurrence to lowest. Once an <office/>
    # self-closing is replaced with <office>...</office>, it no longer matches
    # the self-closing regex, so the indices of remaining empty <office/>
    # don't shift if we work backwards.
    xml = _set_simple_field(xml, ["IMM_5476", "Page1", "SectionA", "office"], data["application_type"], occurrence=2)
    if data["applicant_phone"]:
        xml = _set_simple_field(xml, ["IMM_5476", "Page1", "SectionA", "office"],
                                _format_applicant_phone_for_form(data["applicant_phone"]), occurrence=1)
    if data["applicant_email"]:
        xml = _set_simple_field(xml, ["IMM_5476", "Page1", "SectionA", "office"], data["applicant_email"], occurrence=0)
    xml = _set_simple_field(xml, ["IMM_5476", "Page1", "SectionA", "UCI"], _normalize_uci(data["applicant_uci"]))

    # question8: rep declaration date — first dateSigned (today's date)
    xml = _set_simple_field(xml, ["IMM_5476", "Page1", "SectionB", "question8", "dateSigned"], data["rep_signed_date"], occurrence=0)

    # sectionE: applicant declaration date (today's date)
    xml = _set_simple_field(xml, ["IMM_5476", "Page1", "sectionE", "dateApplicantSigned"], data["applicant_signed_date"], occurrence=0)

    # NB: Sections C and D not touched — we're appointing, not cancelling/withdrawing.

    # ── Save ──────────────────────────────────────────────────────
    # See fill_imm5710.py for full explanation — pikepdf preserves XFA
    # barcode generation; pypdf strips it.
    new_xfa_xml = xml.encode("utf-8")
    Path(output_pdf).parent.mkdir(parents=True, exist_ok=True)

    with pikepdf.open(input_pdf) as pdf:
        acroform = pdf.Root.AcroForm
        xfa = acroform.XFA
        for i in range(0, len(xfa), 2):
            if str(xfa[i]) == 'datasets':
                xfa[i + 1].write(new_xfa_xml)
                break
        else:
            raise RuntimeError("Could not find datasets stream to replace")
        pdf.save(output_pdf)

    print(f"✅  IMM5476 filled (XFA-preserved) → {output_pdf}")


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 fill_imm5476.py <input_json> <output_pdf> [<blank_template>]")
        sys.exit(1)
    with open(sys.argv[1]) as f:
        client_data = json.load(f)
    template = sys.argv[3] if len(sys.argv) > 3 else str(Path(__file__).parent / "blank_imm5476.pdf")
    fill_imm5476(client_data, template, sys.argv[2])


if __name__ == "__main__":
    main()
