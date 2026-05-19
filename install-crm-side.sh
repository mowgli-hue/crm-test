#!/bin/bash
# Nimmi → CRM integration — CRM SIDE INSTALL
# ──────────────────────────────────────────────────────────────
# Run from the CRM app directory:
#   cd "~/Documents/New project/newton-crm-test/apps/crm-builder-web"
#   bash install-crm-side.sh
#
# What this does:
#   ✓ ADDS 4 webhook receiver routes (/api/integrations/nimmi/*)
#   ✓ ADDS 4 admin list routes (/api/nimmi/*)
#   ✓ ADDS new standalone page at /nimmi (self-contained, no shell touch)
#   ✓ ADDS lib/nimmi/webhook-utils.ts (shared DB pool + auth helper)
#   ✓ ADDS SQL migration with 4 new tables (nimmi_signups, nimmi_callbacks,
#     nimmi_intakes, nimmi_documents)
#
# What this does NOT do:
#   ✗ Does NOT touch simple-shell.tsx (the 13,557-line shell your team uses)
#   ✗ Does NOT touch lib/rbac.ts
#   ✗ Does NOT touch lib/store.ts
#   ✗ Does NOT touch any existing API routes
#   ✗ Does NOT touch any existing schema or tables
#
# Newton's team accesses the Nimmi view by going to:
#   https://your-crm-url.com/nimmi
# (Add a sidebar link in a quieter moment — not done here to avoid risk.)

set -e

echo "═══════════════════════════════════════════════════════"
echo "  Nimmi → CRM integration — CRM SIDE"
echo "═══════════════════════════════════════════════════════"
echo ""

# Verify we're in the right directory
if [ ! -f "package.json" ] || ! grep -q "crm-builder-web" package.json 2>/dev/null; then
  if [ -d "apps/crm-builder-web" ]; then
    cd apps/crm-builder-web
    echo "  ↳ cd'd into apps/crm-builder-web"
  else
    echo "✗ This must be run from the crm-builder-web app directory."
    echo "  Run: cd 'apps/crm-builder-web' && bash install-crm-side.sh"
    exit 1
  fi
fi

echo "▶ Working dir: $(pwd)"
echo ""

# ─── STEP 1: Find source files ──────────────────────────────────────
echo "▶ Step 1/5: Finding source files..."

if [ -d ~/Downloads/nimmi-crm-integration ]; then
  SOURCE=~/Downloads/nimmi-crm-integration/crm-side
elif [ -f ~/Downloads/nimmi-crm-integration.tar.gz ]; then
  cd ~/Downloads && tar -xzf nimmi-crm-integration.tar.gz && cd -
  SOURCE=~/Downloads/nimmi-crm-integration/crm-side
else
  echo "✗ Cannot find nimmi-crm-integration in ~/Downloads"
  exit 1
fi

echo "  ✓ Found: $SOURCE"

# ─── STEP 2: Run SQL migration ──────────────────────────────────────
echo ""
echo "▶ Step 2/5: SQL migration"
echo ""
echo "  The migration creates 4 NEW tables. It does NOT modify any existing tables."
echo "  All statements use 'CREATE TABLE IF NOT EXISTS' — safe to re-run."
echo ""

if [ -z "$DATABASE_URL" ]; then
  echo "  ! DATABASE_URL not in shell env."
  echo "    Two options:"
  echo ""
  echo "    Option A: Run it manually now"
  echo "      psql \"\$YOUR_CRM_DATABASE_URL\" -f $SOURCE/sql/nimmi-tables.sql"
  echo ""
  echo "    Option B: Set DATABASE_URL and re-run this script"
  echo "      export DATABASE_URL='<your CRM postgres URL>'"
  echo "      bash install-crm-side.sh"
  echo ""
  read -p "  Have you run the SQL migration? (yes/no): " sqldone
  if [ "$sqldone" != "yes" ]; then
    echo "  ! Stopping. Run the SQL migration first, then re-run this script."
    exit 0
  fi
else
  if command -v psql >/dev/null 2>&1; then
    echo "  Running migration..."
    psql "$DATABASE_URL" -f "$SOURCE/sql/nimmi-tables.sql"
    echo "  ✓ Migration applied"
  else
    echo "  ! psql not installed. Run the migration manually:"
    echo "    psql \"\$DATABASE_URL\" -f $SOURCE/sql/nimmi-tables.sql"
    read -p "  Have you run the SQL migration? (yes/no): " sqldone
    if [ "$sqldone" != "yes" ]; then
      echo "  ! Stopping. Run the SQL migration first."
      exit 0
    fi
  fi
fi

# ─── STEP 3: Backup ─────────────────────────────────────────────────
echo ""
echo "▶ Step 3/5: Sanity checking that we don't already have nimmi files..."

CONFLICTS=()
[ -d "app/api/integrations/nimmi" ] && CONFLICTS+=("app/api/integrations/nimmi")
[ -d "app/api/nimmi" ] && CONFLICTS+=("app/api/nimmi")
[ -d "app/nimmi" ] && CONFLICTS+=("app/nimmi")
[ -d "lib/nimmi" ] && CONFLICTS+=("lib/nimmi")

if [ ${#CONFLICTS[@]} -gt 0 ]; then
  echo "  ! Nimmi directories already exist:"
  for c in "${CONFLICTS[@]}"; do
    echo "    - $c"
  done
  read -p "  Overwrite? (yes/no): " overwrite
  if [ "$overwrite" != "yes" ]; then
    echo "  ! Aborting."
    exit 0
  fi
  BACKUP_DIR="/tmp/nimmi-crm-backup-$(date +%s)"
  mkdir -p "$BACKUP_DIR"
  for c in "${CONFLICTS[@]}"; do
    cp -R "$c" "$BACKUP_DIR/"
  done
  echo "  ✓ Backed up to $BACKUP_DIR"
fi

# ─── STEP 4: Copy files ─────────────────────────────────────────────
echo ""
echo "▶ Step 4/5: Installing new files..."

mkdir -p app/api/integrations
mkdir -p app/api
mkdir -p app
mkdir -p lib

cp -R "$SOURCE/app/api/integrations/nimmi" ./app/api/integrations/
cp -R "$SOURCE/app/api/nimmi" ./app/api/
cp -R "$SOURCE/app/nimmi" ./app/
cp -R "$SOURCE/lib/nimmi" ./lib/

echo "  ✓ Files installed:"
echo "    + app/api/integrations/nimmi/{signup,callback,intake,document}/route.ts"
echo "    + app/api/nimmi/{signups,callbacks,intakes,documents}/route.ts"
echo "    + app/nimmi/page.tsx"
echo "    + lib/nimmi/webhook-utils.ts"
echo "    + (DB) 4 new tables: nimmi_signups, nimmi_callbacks, nimmi_intakes, nimmi_documents"

# ─── STEP 5: Type-check ─────────────────────────────────────────────
echo ""
echo "▶ Step 5/5: Type-check (no build, just tsc)..."

if [ -f "node_modules/.bin/tsc" ]; then
  ./node_modules/.bin/tsc --noEmit 2>&1 | head -30 || true
elif command -v npx >/dev/null 2>&1; then
  npx -y typescript@5 tsc --noEmit 2>&1 | head -30 || true
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✓ CRM SIDE INSTALLED"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "What's next:"
echo ""
echo "  1. Generate a shared secret (use the same one on Nimmi side):"
echo "       openssl rand -hex 32"
echo "     (Save it — you'll paste it twice.)"
echo ""
echo "  2. Add CRM env vars (Railway or wherever CRM runs):"
echo "       NIMMI_WEBHOOK_SECRET=<the secret from step 1>"
echo "     DATABASE_URL is already set (we use the same DB)."
echo ""
echo "  3. Deploy the CRM as you normally do."
echo ""
echo "  4. Add the same secret on Nimmi side as CRM_WEBHOOK_SECRET."
echo ""
echo "  5. Test: visit https://<your-crm-url>/nimmi"
echo "     You should see the Nimmi admin page with 4 tabs (empty for now)."
echo ""
echo "  6. Once you install the Nimmi side and a user signs up,"
echo "     check the Signups tab — you should see them within a few seconds."
