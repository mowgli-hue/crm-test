#!/usr/bin/env python3
"""
run.py — CLI entry point for the Newton Desktop Agent.

    python run.py --case CASE-1611              # full pipeline -> review gate
    python run.py --case CASE-1611 --dry-run    # show the plan only
    python run.py --case CASE-1611 --only generate
"""
import os
import sys
import json
import argparse
import logging

import yaml

from agent import pipeline


def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def main(argv=None):
    p = argparse.ArgumentParser(description="Newton Desktop Agent")
    p.add_argument("--case", required=True, help="case id, e.g. CASE-1611")
    p.add_argument("--config", default=os.path.join(os.path.dirname(__file__),
                                                    "config.yaml"))
    p.add_argument("--only", default=None, help="run a single step: generate|fill")
    p.add_argument("--dry-run", action="store_true", help="plan only, no writes")
    p.add_argument("--log", default="INFO")
    args = p.parse_args(argv)

    logging.basicConfig(level=getattr(logging, args.log.upper(), logging.INFO),
                        format="%(levelname)s %(name)s: %(message)s")

    cfg = load_config(args.config)
    record = pipeline.run(args.case, cfg, only=args.only, dry_run=args.dry_run)
    print(json.dumps(record, indent=2))
    # Non-zero exit if we stopped for incomplete intake, so callers can react.
    return 2 if record.get("stopped") else 0


if __name__ == "__main__":
    sys.exit(main())
