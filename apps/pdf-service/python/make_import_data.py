"""
make_import_data.py — Generate an Adobe-importable XFA data file (.xml) for IRCC
IMM forms, WITHOUT breaking the digital certification.

WHY THIS EXISTS
===============
IRCC IMM forms (IMM5710 / 5708 / 5709 / 5257 / 5476) are XFA-dynamic AND
digitally certified by IRCC. Writing data into the PDF server-side (pikepdf
rewriting the `datasets` stream — what the fill_*.py scripts do) puts the data
in BUT breaks the certification:

    server fill -> cert invalid -> Acrobat disables JavaScript ->
    "Validate" can't run -> no 2D barcode -> IRCC REJECTS the form.

The certified form DOES allow data to be *imported through Acrobat*
("you can save data typed into this form"). Importing data is treated as
form fill-in, which the certification permits, so JavaScript stays live,
Validate works, and the barcode is generated.

This module produces the file a human (or the agent) imports:

    Acrobat -> open the BLANK certified form (blank_imm5710.pdf) ->
    menu / More -> "Import Form Data" -> select this .xml ->
    click "Validate" -> "Save As" into the client's submission folder.

That is three clicks, identical for every case and every form type — instead
of the agent typing 200+ fields one at a time through computer-use.

SINGLE SOURCE OF TRUTH
======================
This does NOT re-implement the field mapping. The June-2026 audit flagged that
multiple divergent mappers are a correctness risk (M-5). So this reuses the
EXACT mapping inside `fill_<form>.fill_<form>()` by running that filler to a
throwaway PDF and extracting the resulting XFA `datasets` XML, then writing it
as a standalone import file. The throwaway PDF (certificate broken — never
delivered) is deleted; only its data XML is kept.

USAGE (library)
---------------
    from make_import_data import generate_import_data
    res = generate_import_data(client_dict, form_id="imm5710",
                               out_xml="/path/IMM5710_import_CASE-1611.xml")
    # res = {"ok": True, "out_xml": "...", "form_id": "imm5710", "filled_values": N}

USAGE (CLI)
-----------
    python make_import_data.py --form imm5710 --client client.json \
        --out IMM5710_import_CASE-1611.xml
    # or pipe JSON on stdin:
    cat client.json | python make_import_data.py --form imm5710 --out out.xml
"""
import os
import sys
import json
import tempfile
import argparse
import importlib
import xml.etree.ElementTree as ET

from pypdf import PdfReader

XFA_NS = "http://www.xfa.org/schema/xfa-data/1.0/"

# form_id -> (module name, EMPTY-template attribute name)
FILLERS = {
    "imm5710": ("fill_imm5710", "EMPTY_CLIENT"),
    "imm5708": ("fill_imm5708", "EMPTY_CLIENT"),
    "imm5709": ("fill_imm5709", "EMPTY_CLIENT"),
    "imm5257": ("fill_imm5257", "EMPTY_CLIENT"),
    "imm5476": ("fill_imm5476", "EMPTY_APPLICANT"),
}


def _extract_datasets_xml(pdf_path: str) -> bytes:
    """Pull the raw XFA `datasets` stream bytes out of a filled PDF."""
    reader = PdfReader(pdf_path)
    xfa = list(reader.trailer["/Root"]["/AcroForm"]["/XFA"])
    for i in range(0, len(xfa), 2):
        if str(xfa[i]) == "datasets":
            return xfa[i + 1].get_object().get_data()
    raise RuntimeError("XFA 'datasets' stream not found in the filled PDF")


def _count_filled(root: ET.Element) -> int:
    """Count leaf nodes that carry an actual value (rough fill report)."""
    n = 0
    for el in root.iter():
        if len(list(el)) == 0 and el.text and el.text.strip():
            n += 1
    return n


def generate_import_data(client: dict, form_id: str = "imm5710",
                         blank_pdf: str = None, out_xml: str = None) -> dict:
    """
    Build an Acrobat-importable XFA data file for `form_id` from `client`.

    Args:
        client:    Form-field dict in the EMPTY_CLIENT / EMPTY_APPLICANT key
                   format (the same shape the pdf-service /fill endpoint takes,
                   produced by the CRM's intake-to-form mapper).
        form_id:   One of FILLERS keys (imm5710, 5708, 5709, 5257, 5476).
        blank_pdf: Path to the blank template. Defaults to blank_<form_id>.pdf
                   next to this file.
        out_xml:   Where to write the import .xml. Defaults to a temp file.

    Returns:
        {"ok": True, "out_xml": <path>, "form_id": <id>, "filled_values": <int>}
    """
    if form_id not in FILLERS:
        raise ValueError(
            f"unsupported form_id '{form_id}'. Supported: {sorted(FILLERS)}"
        )

    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)

    mod_name, empty_attr = FILLERS[form_id]
    mod = importlib.import_module(mod_name)
    fill_fn = getattr(mod, f"fill_{form_id}")
    empty = getattr(mod, empty_attr)

    blank_pdf = blank_pdf or os.path.join(here, f"blank_{form_id}.pdf")
    if not os.path.exists(blank_pdf):
        raise FileNotFoundError(f"blank template not found: {blank_pdf}")
    out_xml = out_xml or tempfile.mktemp(suffix=".xml")

    merged = {**empty, **client}

    # Run the proven filler to a THROWAWAY pdf purely to reuse its mapping,
    # then extract the data XML. The pdf itself is discarded (cert is broken).
    tmp_pdf = tempfile.mktemp(suffix=".pdf")
    try:
        fill_fn(merged, blank_pdf, tmp_pdf)
        raw = _extract_datasets_xml(tmp_pdf)
    finally:
        if os.path.exists(tmp_pdf):
            try:
                os.remove(tmp_pdf)
            except OSError:
                pass

    # Normalize to the shape Acrobat's own "Export Data" produces: XML
    # declaration + <xfa:datasets> root containing ONLY the <xfa:data> subtree.
    # The raw stream also carries a large <LOVFile> (the form's embedded dropdown
    # option lists) which the blank form already has — including it just bloats
    # the import file (~480 KB -> a few KB), so we drop it and keep only data.
    ET.register_namespace("xfa", XFA_NS)
    raw_root = ET.fromstring(raw)
    data_el = None
    for c in raw_root:
        if c.tag == "{%s}data" % XFA_NS or c.tag.endswith("}data") or c.tag == "data":
            data_el = c
            break
    if data_el is None:
        raise RuntimeError("xfa:data element not found in datasets stream")

    new_root = ET.Element("{%s}datasets" % XFA_NS)
    new_root.append(data_el)
    body = ET.tostring(new_root, encoding="unicode")
    xml_text = '<?xml version="1.0" encoding="UTF-8"?>\n' + body + "\n"

    with open(out_xml, "w", encoding="utf-8") as f:
        f.write(xml_text)

    return {
        "ok": True,
        "out_xml": out_xml,
        "form_id": form_id,
        "filled_values": _count_filled(new_root),
    }


def _main(argv=None):
    p = argparse.ArgumentParser(
        description="Generate an Acrobat-importable XFA data file for IRCC IMM forms."
    )
    p.add_argument("--form", default="imm5710",
                   help="form id: imm5710 | imm5708 | imm5709 | imm5257 | imm5476")
    p.add_argument("--client", default=None,
                   help="path to client JSON (EMPTY_CLIENT key format). "
                        "If omitted, JSON is read from stdin.")
    p.add_argument("--blank", default=None, help="path to blank template PDF")
    p.add_argument("--out", default=None, help="output .xml path")
    args = p.parse_args(argv)

    if args.client:
        with open(args.client, "r", encoding="utf-8") as f:
            client = json.load(f)
    else:
        client = json.load(sys.stdin)

    res = generate_import_data(client, form_id=args.form,
                               blank_pdf=args.blank, out_xml=args.out)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    _main()
