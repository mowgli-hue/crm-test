"""
acrobat_driver.py — the desktop form-fill step.

IRCC XFA forms can only be validated/barcoded through Adobe. This module owns the
handoff between the agent's generated import file and Acrobat:

  1. stage_import_file()  — copy the generated .xml to the fixed Acrobat inbox
                            (a stable path the folder-level JS reads from).
  2. drive_acrobat_import() — the desktop-control step. In production this is
                            performed by a computer-use runner that:
                              open blank certified form -> run the
                              "Newton: Import Case Data" menu item (newton_import.js)
                              -> click Validate -> Save As into the case folder.

The GUI drive is intentionally kept behind a single interface so it can be
implemented by (a) the computer-use runner, or (b) a human doing the 3 clicks,
without the rest of the pipeline caring which.
"""
import os
import shutil
import logging

log = logging.getLogger("newton.desktop.acrobat")


def _inbox(cfg: dict) -> str:
    p = os.path.expanduser(cfg["paths"]["acrobat_inbox"])
    os.makedirs(p, exist_ok=True)
    return p


def stage_import_file(import_xml: str, form_id: str, cfg: dict) -> str:
    """Copy the generated import file to the Acrobat inbox under a stable name
    the folder-level JS expects (import.xml). Returns the staged path."""
    inbox = _inbox(cfg)
    staged = os.path.join(inbox, "import.xml")
    shutil.copyfile(os.path.expanduser(import_xml), staged)
    # Also keep a per-form named copy for audit.
    shutil.copyfile(os.path.expanduser(import_xml),
                    os.path.join(inbox, os.path.basename(import_xml)))
    log.info("staged %s -> %s", form_id, staged)
    return staged


def blank_template_for(form_id: str, cfg: dict) -> str:
    base = os.path.abspath(os.path.expanduser(cfg["paths"]["pdf_service_python"]))
    return os.path.join(base, f"blank_{form_id}.pdf")


def drive_acrobat_import(form_id: str, case_id: str, staged_xml: str,
                         save_to: str, cfg: dict, runner=None) -> dict:
    """
    Fill one certified form in Acrobat and save the validated, barcoded result.

    `runner` is an object exposing .fill(blank_pdf, staged_xml, save_to) that
    performs the actual Acrobat drive (computer-use). If None, we return a
    manual-instruction result so a human can complete the 3 clicks.

    Returns {form_id, saved_path|None, mode}.
    """
    blank = blank_template_for(form_id, cfg)
    if not os.path.exists(blank):
        raise FileNotFoundError(f"blank template missing: {blank}")

    if runner is None:
        # No automated drive available — hand the human a precise instruction.
        return {
            "form_id": form_id,
            "saved_path": None,
            "mode": "manual",
            "instruction": (
                f"In Adobe Acrobat: open a COPY of {os.path.basename(blank)} -> "
                f"menu 'Newton: Import Case Data' (imports {staged_xml}) -> "
                f"click Validate -> Save As to {save_to}."
            ),
        }

    # Automated: computer-use runner performs open -> import -> validate -> save.
    saved = runner.fill(blank_pdf=blank, staged_xml=staged_xml, save_to=save_to)
    return {"form_id": form_id, "saved_path": saved, "mode": "auto"}
