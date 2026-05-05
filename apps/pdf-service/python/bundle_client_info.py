"""
bundle_client_info.py — Merge client supporting documents into a single PDF.

Used by the PGWP submission package automation to produce
`Client_Info_<First>_<Last>.pdf`.

Categorization is done by filename pattern matching on the input file paths.
The endpoint calling this script is responsible for filtering/ordering files
correctly; this module just merges what it's given.

USAGE:
    python3 bundle_client_info.py <input_json> <output_pdf>

input_json format:
    {
      "files": [
        "/path/to/study_permit.pdf",
        "/path/to/ielts.pdf",
        "/path/to/algoma_transcript.pdf",
        "/path/to/algoma_loa.pdf"
      ]
    }

Files are merged in the order given. PDFs append directly. Images
(JPG/PNG) are converted to single-page PDFs first. Other formats
are skipped with a warning (they shouldn't reach this layer).

Verified to produce output structurally similar to Paras's filed
"Paras Kamboj - client info.pdf" (study permit + IELTS + previous
school records concatenated).
"""
import json
import sys
import tempfile
from pathlib import Path
from pypdf import PdfReader, PdfWriter


def _is_pdf(path):
    return path.suffix.lower() == ".pdf"


def _is_image(path):
    return path.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff")


def _image_to_pdf(image_path, tmpdir):
    """Convert image file to a single-page PDF, return path to the PDF."""
    from PIL import Image

    img = Image.open(image_path)
    # Convert to RGB if needed (PNG with alpha, etc.) so PDF rendering works
    if img.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", img.size, "white")
        bg.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")

    out_pdf = Path(tmpdir) / f"{image_path.stem}.pdf"
    img.save(out_pdf, "PDF", resolution=200.0)
    return out_pdf


def bundle_files(file_paths, output_pdf):
    """
    Merge a list of input files (PDFs and images) into a single PDF.

    Args:
        file_paths: list of str/Path to input files, in desired merge order
        output_pdf: str/Path where the bundled PDF should be written

    Returns:
        dict with stats: {pages_written, files_included, files_skipped}
    """
    output_pdf = Path(output_pdf)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    writer = PdfWriter()
    files_included = []
    files_skipped = []

    with tempfile.TemporaryDirectory() as tmpdir:
        for raw in file_paths:
            path = Path(raw)
            if not path.exists():
                files_skipped.append({"path": str(path), "reason": "file not found"})
                continue
            if path.stat().st_size == 0:
                files_skipped.append({"path": str(path), "reason": "empty file"})
                continue

            try:
                if _is_pdf(path):
                    pdf_to_append = path
                elif _is_image(path):
                    pdf_to_append = _image_to_pdf(path, tmpdir)
                else:
                    files_skipped.append({"path": str(path), "reason": f"unsupported extension {path.suffix}"})
                    continue

                reader = PdfReader(pdf_to_append)
                for page in reader.pages:
                    writer.add_page(page)
                files_included.append(str(path))

            except Exception as e:
                files_skipped.append({"path": str(path), "reason": f"merge error: {e}"})
                continue

        # Write final
        with open(output_pdf, "wb") as f:
            writer.write(f)

    pages_written = len(writer.pages)
    return {
        "pages_written": pages_written,
        "files_included": files_included,
        "files_skipped": files_skipped,
        "output": str(output_pdf),
    }


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 bundle_client_info.py <input_json> <output_pdf>")
        sys.exit(1)

    input_json = sys.argv[1]
    output_pdf = sys.argv[2]

    with open(input_json) as f:
        cfg = json.load(f)

    files = cfg.get("files", [])
    if not files:
        print("No input files provided in input_json.files")
        sys.exit(1)

    result = bundle_files(files, output_pdf)
    print(f"✅  Client Info bundled → {result['output']}")
    print(f"    Pages: {result['pages_written']}")
    print(f"    Included: {len(result['files_included'])} files")
    if result["files_skipped"]:
        print(f"    Skipped: {len(result['files_skipped'])} files")
        for s in result["files_skipped"]:
            print(f"      - {s['path']} ({s['reason']})")


if __name__ == "__main__":
    main()
