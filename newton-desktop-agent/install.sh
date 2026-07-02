#!/usr/bin/env bash
# Newton Desktop Agent installer (macOS).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Creating virtualenv (.venv)"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate

echo "==> Installing dependencies"
pip install --upgrade pip >/dev/null
pip install -r requirements.txt

echo "==> Creating working folders"
mkdir -p ~/NewtonAgent/inbox ~/NewtonAgent/output
mkdir -p cases

echo ""
echo "Done. Next:"
echo "  1) Install the Acrobat helper once  ->  see acrobat/INSTALL_ACROBAT.md"
echo "  2) source .venv/bin/activate"
echo "  3) python run.py --case CASE-XXXX --dry-run"
