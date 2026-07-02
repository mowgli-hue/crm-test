"""
build_fill_js.py — generate the Acrobat *console* script that fills a certified
IRCC IMM form in one shot, the CERT-SAFE way proven in IMM5710_PLAYBOOK.md
("THE FAST WORKER", 2026-06-13): write each value into the form's XFA **data DOM**
then remerge — Acrobat's own engine does the change, so the DocMDP certification
stays VALID and the Validate button still regenerates the 2-D barcodes.

Why this and not the alternatives (from the playbook):
  - pikepdf / external rewrite      -> breaks the signature byte-range -> portal rejects.
  - Doc.importXFAData / host.importData -> privileged, console blocks it.
  - getField(name).value            -> ignored on dynamic XFA.
  - resolveNode(...).rawValue = ..  -> leaves stale date-format errors.
  - xfa.datasets.resolveNode("data.form1." + path).value = ..; then
    xfa.form.remerge(); xfa.form.recalculate(1);   ->  CLEAN. (this file)

It reuses the SAME field map as make_import_data / fill_<form> (single source of
truth): it generates the import XML, walks the <form1> data tree, and emits one
`d("<som path>", "<value>")` call per filled leaf.

USAGE
-----
    python build_fill_js.py --form imm5710 --client case.json --out CASE-1611_fill.js
    # then in Acrobat: open blank certified form -> Cmd+J console ->
    #   paste the .js -> select-all -> numeric-keypad Enter -> "FILL ok=NN miss=0"
    #   -> click Validate -> File > Save As.
"""
import os
import sys
import json
import argparse
import tempfile
import xml.etree.ElementTree as ET

XFA_NS = "http://www.xfa.org/schema/xfa-data/1.0/"


def _load_generator():
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    import make_import_data
    return make_import_data


def _walk(el, prefix, out):
    """Collect (som_path, value) for every leaf under <form1>. `prefix` is the
    dotted SOM path built from element tag names (namespaces stripped)."""
    children = list(el)
    if not children:
        text = (el.text or "").strip()
        if text:
            out.append((prefix, text))
        return
    for c in children:
        tag = c.tag.split("}")[-1]           # strip any namespace
        # skip pure structural placeholders that carry no data
        if c.get("{%s}dataNode" % XFA_NS) == "dataGroup" and not list(c) and not (c.text or "").strip():
            continue
        _walk(c, f"{prefix}.{tag}" if prefix else tag, out)


def _js_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "")


def build_fill_js(client: dict, form_id: str = "imm5710", out_js: str = None) -> dict:
    gen = _load_generator()
    tmp_xml = tempfile.mktemp(suffix=".xml")
    gen.generate_import_data(client, form_id=form_id, out_xml=tmp_xml)
    try:
        root = ET.parse(tmp_xml).getroot()
    finally:
        if os.path.exists(tmp_xml):
            os.remove(tmp_xml)

    # find <xfa:data> then <form1>
    data = next((c for c in root if c.tag.endswith("}data") or c.tag == "data"), None)
    form1 = data.find("form1") if data is not None else None
    if form1 is None:
        raise RuntimeError("form1 not found in generated data")

    pairs = []
    _walk(form1, "", pairs)   # paths are relative to form1

    lines = []
    lines.append("// Newton — cert-safe IMM fill (data-DOM + remerge). Paste in Acrobat")
    lines.append("// console (Cmd+J), select-all, press numeric-keypad Enter.")
    lines.append("(function(){")
    lines.append("  var n=0, miss=0, errs=[];")
    lines.append("  function d(path, val){")
    lines.append('    try {')
    lines.append('      var node = xfa.datasets.resolveNode("data.form1." + path);')
    lines.append('      if (node) { node.value = String(val); n++; }')
    lines.append('      else { miss++; errs.push(path); }')
    lines.append('    } catch(e) { miss++; errs.push(path + ": " + e); }')
    lines.append("  }")
    for path, val in pairs:
        lines.append(f'  d("{path}", "{_js_escape(val)}");')
    lines.append("  xfa.form.remerge();")
    lines.append("  xfa.form.recalculate(1);")
    lines.append('  console.println("FILL ok=" + n + " miss=" + miss);')
    lines.append('  if (errs.length) console.println("MISSED: " + errs.join(", "));')
    lines.append("})();")
    js = "\n".join(lines) + "\n"

    out_js = out_js or tempfile.mktemp(suffix=".js")
    with open(out_js, "w", encoding="utf-8") as f:
        f.write(js)
    return {"ok": True, "out_js": out_js, "form_id": form_id, "field_count": len(pairs)}


def _main(argv=None):
    p = argparse.ArgumentParser(description="Generate an Acrobat console fill script for IRCC IMM forms.")
    p.add_argument("--form", default="imm5710")
    p.add_argument("--client", default=None, help="client JSON (EMPTY_CLIENT keys); stdin if omitted")
    p.add_argument("--out", default=None, help="output .js path")
    args = p.parse_args(argv)
    client = json.load(open(args.client)) if args.client else json.load(sys.stdin)
    res = build_fill_js(client, form_id=args.form, out_js=args.out)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    _main()
