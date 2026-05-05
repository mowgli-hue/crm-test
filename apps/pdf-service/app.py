from flask import Flask, request, send_file, jsonify
import sys, os, tempfile, base64, json

app = Flask(__name__)
sys.path.insert(0, "/app/python")

@app.route("/health", methods=["GET"])
def health():
    import pypdf, sys
    try:
        import cryptography
        cv = cryptography.__version__
    except:
        cv = "not installed"
    try:
        import PIL
        pv = PIL.__version__
    except:
        pv = "not installed"
    return jsonify({"ok": True, "pypdf": pypdf.__version__, "python": sys.version, "cryptography": cv, "pillow": pv})

@app.route("/fill", methods=["POST"])
def fill():
    body = request.get_json()
    form_id = body.get("formId", "imm5710")
    data = body.get("data", {})
    blank = f"/app/python/blank_{form_id}.pdf"
    if not os.path.exists(blank):
        return jsonify({"error": f"blank_{form_id}.pdf not found"}), 404
    out = tempfile.mktemp(suffix=".pdf")
    try:
        if form_id == "imm5710":
            from fill_imm5710 import fill_imm5710, EMPTY_CLIENT
            fill_imm5710({**EMPTY_CLIENT, **data}, blank, out)
        elif form_id == "imm5708":
            from fill_imm5708 import fill_imm5708, EMPTY_CLIENT
            fill_imm5708({**EMPTY_CLIENT, **data}, blank, out)
        elif form_id == "imm5709":
            from fill_imm5709 import fill_imm5709, EMPTY_CLIENT
            fill_imm5709({**EMPTY_CLIENT, **data}, blank, out)
        elif form_id == "imm5257":
            from fill_imm5257 import fill_imm5257, EMPTY_CLIENT
            fill_imm5257({**EMPTY_CLIENT, **data}, blank, out)
        elif form_id == "imm5476":
            # Use of Representative form. Newton's rep info is hardcoded inside the filler.
            # `data` should contain applicant fields (family name, given name, DOB, phone, email, UCI, signed dates).
            from fill_imm5476 import fill_imm5476, EMPTY_APPLICANT
            fill_imm5476({**EMPTY_APPLICANT, **data}, blank, out)
        else:
            return jsonify({"error": f"unknown formId: {form_id}"}), 400
        return send_file(out, mimetype="application/pdf")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/bundle", methods=["POST"])
def bundle():
    """
    Merge multiple input files (PDFs and images) into a single PDF.

    Request body (JSON):
      {
        "files": [
          { "filename": "foo.pdf", "base64": "..." },
          { "filename": "bar.jpg", "base64": "..." },
          ...
        ]
      }

    Files are merged in the order provided. PDFs are appended directly; images
    are converted to single-page PDFs first. Returns the merged PDF as
    application/pdf.

    Used by the PGWP submission package automation to produce
    `Client_Info_<First>_<Last>.pdf`.
    """
    body = request.get_json(silent=True) or {}
    files = body.get("files", [])
    if not isinstance(files, list) or not files:
        return jsonify({"error": "Provide non-empty `files` array"}), 400

    from bundle_client_info import bundle_files

    workdir = tempfile.mkdtemp()
    paths = []
    try:
        for i, item in enumerate(files):
            if not isinstance(item, dict) or "base64" not in item:
                return jsonify({"error": f"files[{i}] missing base64"}), 400
            filename = item.get("filename") or f"input_{i}.pdf"
            # Sanitize filename — only basename, only safe chars
            safe = "".join(c for c in os.path.basename(filename) if c.isalnum() or c in "._- ")
            if not safe:
                safe = f"input_{i}.pdf"
            path = os.path.join(workdir, f"{i:03d}_{safe}")
            try:
                raw = base64.b64decode(item["base64"], validate=False)
            except Exception as e:
                return jsonify({"error": f"files[{i}] invalid base64: {e}"}), 400
            with open(path, "wb") as f:
                f.write(raw)
            paths.append(path)

        out = tempfile.mktemp(suffix=".pdf")
        result = bundle_files(paths, out)
        if result["pages_written"] == 0:
            return jsonify({"error": "no pages produced", "skipped": result["files_skipped"]}), 400
        return send_file(out, mimetype="application/pdf")
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        # cleanup tmp inputs (output is auto-cleaned by Flask after send)
        try:
            for p in paths:
                if os.path.exists(p):
                    os.remove(p)
            os.rmdir(workdir)
        except Exception:
            pass


@app.route("/debug", methods=["GET"])
def debug():
    import sys
    sys.path.insert(0, "/app/python")
    from pypdf import PdfReader, PdfWriter
    import xml.etree.ElementTree as ET
    reader = PdfReader("/app/python/blank_imm5710.pdf")
    xfa_list = list(reader.trailer["/Root"]["/AcroForm"]["/XFA"])
    for i in range(0, len(xfa_list), 2):
        if str(xfa_list[i]) == "datasets":
            ds = xfa_list[i+1].get_object()
            xml = ds.get_data().decode("utf-8")
            # inject test data
            xml = xml.replace("<FamilyName/>", "<FamilyName>TESTNAME</FamilyName>")
            ds.set_data(xml.encode("utf-8"))
            import tempfile
            out = tempfile.mktemp(suffix=".pdf")
            w = PdfWriter()
            w.append(reader)
            with open(out, "wb") as f: w.write(f)
            # read back
            r2 = PdfReader(out)
            xfa2 = list(r2.trailer["/Root"]["/AcroForm"]["/XFA"])
            for j in range(0, len(xfa2), 2):
                if str(xfa2[j]) == "datasets":
                    ds2 = xfa2[j+1].get_object()
                    xml2 = ds2.get_data().decode("utf-8")
                    has_test = "TESTNAME" in xml2
                    return jsonify({"injected": has_test, "xml_snippet": xml2[xml2.find("FamilyName")-5:xml2.find("FamilyName")+40]})
    return jsonify({"error": "datasets not found"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
