"""
forms.py — form registry + import-file generation for the desktop agent.

Reuses the proven `make_import_data.generate_import_data` (which itself reuses the
`fill_<form>` mappers) so there is exactly ONE field-mapping code path in the whole
system. This module just decides WHICH forms a given application type needs and
produces an Acrobat import .xml for each.
"""
import os
import sys
import logging

log = logging.getLogger("newton.desktop.forms")


def _load_generator(pdf_service_python: str):
    """Import make_import_data from the pdf-service python dir."""
    path = os.path.abspath(os.path.expanduser(pdf_service_python))
    if path not in sys.path:
        sys.path.insert(0, path)
    import make_import_data  # noqa: E402  (dynamic path)
    return make_import_data


def forms_for(app_type: str, cfg: dict) -> list:
    """Return the ordered list of form_ids for an application type (primary +
    extras + the Use-of-Representative form appended for every case)."""
    types = cfg.get("application_types", {})
    if app_type not in types:
        raise ValueError(
            f"unknown application type '{app_type}'. "
            f"Known: {sorted(types)}"
        )
    entry = types[app_type]
    forms = [entry["primary"], *entry.get("also", [])]
    rep = cfg.get("rep_form")
    if rep and rep not in forms:
        forms.append(rep)
    return forms


def generate_import_files(app_type: str, case_id: str, form_data: dict,
                          cfg: dict, out_dir: str) -> list:
    """
    For each form the `app_type` needs, generate an Acrobat import .xml from
    `form_data` (EMPTY_CLIENT-key format, produced by the CRM intake mapper).

    Returns a list of dicts: {form_id, out_xml, filled_values}.
    NOTE: `form_data` may need per-form shaping upstream; for now we pass the
    same dict and let each mapper take the keys it recognizes. (TODO: per-form
    data selection for 5476 applicant-only fields.)
    """
    gen = _load_generator(cfg["paths"]["pdf_service_python"])
    os.makedirs(os.path.expanduser(out_dir), exist_ok=True)
    results = []
    for form_id in forms_for(app_type, cfg):
        out_xml = os.path.join(
            os.path.expanduser(out_dir), f"{form_id}_import_{case_id}.xml"
        )
        res = gen.generate_import_data(
            form_data, form_id=form_id, out_xml=out_xml
        )
        log.info("generated %s -> %s (%s values)",
                 form_id, res["out_xml"], res["filled_values"])
        results.append({
            "form_id": form_id,
            "out_xml": res["out_xml"],
            "filled_values": res["filled_values"],
        })
    return results
