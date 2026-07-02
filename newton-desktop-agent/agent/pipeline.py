"""
pipeline.py — end-to-end case processing with a hard human-review gate.

Order:  gather -> readiness -> generate -> fill -> assemble -> handoff(review)

The pipeline NEVER submits to IRCC. `handoff` marks the case for human review and
stops. Each step returns a dict that is accumulated into a run record so the run
is fully auditable.
"""
import os
import json
import logging
from datetime import datetime, timezone

from . import forms as forms_mod
from . import acrobat_driver
from . import strategy

log = logging.getLogger("newton.desktop.pipeline")

STEPS = ["gather", "readiness", "generate", "fill", "assemble", "handoff"]


# --------------------------------------------------------------------------
# Data source. In production these read from the CRM DB + Google Drive using the
# clients in ../newton-agent (crm_api.py, drive_tools.py). For the scaffold they
# fall back to a local case file so the spine runs without live credentials.
# --------------------------------------------------------------------------
def gather(case_id: str, cfg: dict, data_source=None) -> dict:
    """Return {case_id, app_type, form_data, docs, case_folder}."""
    if data_source is not None:
        return data_source.fetch_case(case_id)   # TODO: wire crm_api + drive_tools

    # Fallback: local ./cases/<case_id>.json  (form_data in EMPTY_CLIENT format)
    local = os.path.join(os.path.dirname(__file__), "..", "cases",
                         f"{case_id}.json")
    if not os.path.exists(local):
        raise FileNotFoundError(
            f"no data source and no local case file at {local}. "
            f"Wire a data_source (CRM+Drive) or drop a {case_id}.json there."
        )
    with open(local, "r", encoding="utf-8") as f:
        case = json.load(f)
    case.setdefault("case_id", case_id)
    case.setdefault("docs", [])
    return case


def readiness(case: dict, cfg: dict) -> dict:
    """Lightweight completeness check. The authoritative CRM readiness
    (get_case_readiness) should be preferred when the data_source is live."""
    fd = case.get("form_data", {})
    # Identity fields that must never be blank on a real submission.
    required = ["family_name", "given_name", "dob_year", "passport_number",
                "citizenship_country"]
    missing = [k for k in required if not str(fd.get(k, "")).strip()]
    return {"complete": not missing, "missing": missing}


def generate(case: dict, cfg: dict) -> dict:
    out_dir = cfg["paths"]["output_dir"]
    files = forms_mod.generate_import_files(
        case["app_type"], case["case_id"], case["form_data"], cfg, out_dir
    )
    return {"import_files": files}


def fill(case: dict, generated: dict, cfg: dict, runner=None) -> dict:
    """Stage each import file and drive Acrobat (or emit manual instructions)."""
    case_folder = os.path.expanduser(
        case.get("case_folder") or os.path.join(cfg["paths"]["output_dir"],
                                                 case["case_id"]))
    os.makedirs(case_folder, exist_ok=True)
    results = []
    for item in generated["import_files"]:
        staged = acrobat_driver.stage_import_file(item["out_xml"],
                                                  item["form_id"], cfg)
        save_to = os.path.join(
            case_folder,
            f"{item['form_id'].upper()}_{case['case_id']}_VALIDATED.pdf")
        res = acrobat_driver.drive_acrobat_import(
            item["form_id"], case["case_id"], staged, save_to, cfg, runner=runner)
        results.append(res)
    return {"filled": results}


def assemble(case: dict, filled: dict, cfg: dict) -> dict:
    """Bundle validated forms + client docs into the submission package.
    TODO: reuse ../apps/pdf-service bundle_client_info.bundle_files."""
    saved = [f["saved_path"] for f in filled["filled"] if f.get("saved_path")]
    return {"package_inputs": saved, "assembled": False,
            "note": "TODO: call pdf-service /bundle once forms are saved"}


def handoff(case: dict, cfg: dict) -> dict:
    """Produce the STRATEGIC handoff note, mark the case ready for HUMAN review,
    and stop. No submission ever."""
    r = cfg["review"]
    # The judgment layer: strategic flags + what's left + what to ask the client.
    note = strategy.build_handoff_note(case, case.get("form_data", {}), cfg)

    # Save the note next to the case output so the team (and Drive upload) can use it.
    out_dir = os.path.expanduser(
        case.get("case_folder") or os.path.join(cfg["paths"]["output_dir"],
                                                 case["case_id"]))
    os.makedirs(out_dir, exist_ok=True)
    note_path = os.path.join(out_dir, f"HANDOFF_{case['case_id']}.md")
    with open(note_path, "w", encoding="utf-8") as f:
        f.write(note["markdown"])

    # TODO: via data_source -> update_case_status(stage=ready_stage) + upload the
    #       note to the case's Drive folder + file a team task with client_asks.
    log.info("HANDOFF: case %s -> '%s' (%d%% ready, %d client asks)",
             case["case_id"], r["ready_stage"], note["readiness_pct"],
             len(note["client_asks"]))
    return {"stage": r["ready_stage"], "status": r["ready_status"],
            "submitted": False, "note_path": note_path,
            "readiness_pct": note["readiness_pct"],
            "strategic_checks": note["strategic_checks"],
            "client_asks": note["client_asks"]}


# --------------------------------------------------------------------------
def run(case_id: str, cfg: dict, only: str = None, dry_run: bool = False,
        data_source=None, runner=None) -> dict:
    record = {"case_id": case_id, "started_at": datetime.now(timezone.utc).isoformat(),
              "steps": {}, "dry_run": dry_run}

    case = gather(case_id, cfg, data_source=data_source)
    record["app_type"] = case.get("app_type")
    record["steps"]["gather"] = {"ok": True, "app_type": case.get("app_type"),
                                 "doc_count": len(case.get("docs", []))}

    rd = readiness(case, cfg)
    record["steps"]["readiness"] = rd
    if not rd["complete"]:
        # Don't fabricate — stop and flag for a human to complete intake.
        record["stopped"] = f"incomplete intake, missing: {rd['missing']}"
        log.warning(record["stopped"])
        if not (only and only in ("generate", "fill")):
            return record

    if only:
        # Single-step mode for iteration/debugging.
        if only == "generate":
            record["steps"]["generate"] = generate(case, cfg)
        elif only == "fill":
            gen = generate(case, cfg)
            record["steps"]["fill"] = fill(case, gen, cfg, runner=runner)
        else:
            raise ValueError(f"--only supports generate|fill, got {only}")
        return record

    if dry_run:
        record["plan"] = {"forms": forms_mod.forms_for(case["app_type"], cfg)}
        return record

    gen = generate(case, cfg)
    record["steps"]["generate"] = gen
    record["steps"]["fill"] = fill(case, gen, cfg, runner=runner)
    record["steps"]["assemble"] = assemble(case, record["steps"]["fill"], cfg)
    record["steps"]["handoff"] = handoff(case, cfg)
    record["finished_at"] = datetime.now(timezone.utc).isoformat()
    return record
