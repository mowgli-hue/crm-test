# Newton Desktop Agent

An **installable, local** processing agent for Newton Immigration. It runs on the
firm's Mac, prepares immigration applications end-to-end like a junior caseworker,
and hands each finished package to a human for review and submission.

> Design principle: **the agent prepares, a human reviews and submits.** Every
> case stops at a review gate before anything is filed with IRCC. That gate is
> not a limitation — it is what makes full autonomy on everything *before* it safe.

## What it does (per case)

```
  1. GATHER      pull the case + its real documents from Google Drive / CRM
  2. READINESS   check intake + docs against the form's requirements
  3. GENERATE    map case data -> Acrobat import file(s) (make_import_data)
  4. FILL        drive Acrobat: Import -> Validate -> Save (cert + barcode intact)
  5. ASSEMBLE    bundle forms + client docs into the submission package
  6. HANDOFF     upload to the case folder, mark "Ready for human review", stop
```

Steps 1–3, 5, 6 are fully automatic. Step 4 uses the desktop (Acrobat) because
IRCC's XFA forms can only be validated/barcoded through Adobe — see
`../AGENT_FORM_FILLING_MEMORY.md` and `acrobat/INSTALL_ACROBAT.md`.

## Why this exists alongside `newton-agent/`

`newton-agent/` is the **cloud/managed** agent (runs against Anthropic's managed
Agents API, host event loop). `newton-desktop-agent/` is the **local** runtime the
firm installs: it can drive the actual computer (Acrobat, Finder, Drive) — the
"take over the machine and work like a human" piece — and reuses the same proven
building blocks (form mappers, Drive tools, CRM API).

## Form-fill: the solved problem

- IRCC IMM forms are XFA-dynamic **and** digitally certified.
- Writing data server-side breaks the cert -> no barcode -> rejection.
- The agent instead **generates an Acrobat import file** (`make_import_data.py`,
  reusing the proven `fill_*` mappers) and imports it *through Acrobat*, which
  preserves the cert so Validate produces the barcode.
- On this firm's Acrobat **Pro**, the import runs via a folder-level JavaScript
  menu item (`acrobat/newton_import.js`) — `importXFAData()` is permitted in the
  menu/batch context and works with certified forms.

## Install

```bash
cd newton-desktop-agent
./install.sh              # venv + deps
# then install the Acrobat helper once:
#   see acrobat/INSTALL_ACROBAT.md
```

## Run

```bash
source .venv/bin/activate
python run.py --case CASE-1611            # full pipeline, stops at review gate
python run.py --case CASE-1611 --dry-run  # plan only, no side effects
python run.py --case CASE-1611 --only generate   # run a single step
```

## Status

Scaffold. Real: pipeline spine, form registry + import-file generation, config,
CLI. Wired-but-needs-your-env: Drive/CRM fetch (reuses `newton-agent` clients),
the Acrobat drive step (needs the folder-level JS installed + tested live).
See `TODO` markers.
