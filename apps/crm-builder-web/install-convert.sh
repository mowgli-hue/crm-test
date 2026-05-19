#!/bin/bash
# Nimmi → CRM Convert to Case
# Run from CRM dir: bash install-convert.sh

set -e

echo "═══════════════════════════════════════════════════════"
echo "  Nimmi — Convert to Case (CRM SIDE)"
echo "═══════════════════════════════════════════════════════"
echo ""

# Verify CRM repo
if [ ! -f "package.json" ] || ! grep -q "crm-builder-web" package.json 2>/dev/null; then
  if [ -d "apps/crm-builder-web" ]; then
    cd apps/crm-builder-web
    echo "  ↳ cd'd into apps/crm-builder-web"
  else
    echo "✗ Run from CRM app dir or monorepo root"
    exit 1
  fi
fi

echo "▶ Working dir: $(pwd)"
echo ""

# Find source
if [ -d ~/Downloads/nimmi-convert ]; then
  SOURCE=~/Downloads/nimmi-convert
elif [ -f ~/Downloads/nimmi-convert.tar.gz ]; then
  cd ~/Downloads && tar -xzf nimmi-convert.tar.gz && cd -
  SOURCE=~/Downloads/nimmi-convert
else
  echo "✗ Cannot find nimmi-convert in ~/Downloads"
  exit 1
fi

# Backup existing /nimmi page
BACKUP_DIR="/tmp/nimmi-convert-backup-$(date +%s)"
mkdir -p "$BACKUP_DIR/app/nimmi"
if [ -f "app/nimmi/page.tsx" ]; then
  cp "app/nimmi/page.tsx" "$BACKUP_DIR/app/nimmi/"
  echo "  ✓ Backed up app/nimmi/page.tsx"
fi

# Install files
mkdir -p app/api/nimmi/signups/\[id\]/convert
mkdir -p app/api/nimmi/callbacks/\[id\]/convert
mkdir -p app/api/nimmi/intakes/\[id\]/convert

cp "$SOURCE/crm/app/api/nimmi/signups/[id]/convert/route.ts" "app/api/nimmi/signups/[id]/convert/route.ts"
cp "$SOURCE/crm/app/api/nimmi/callbacks/[id]/convert/route.ts" "app/api/nimmi/callbacks/[id]/convert/route.ts"
cp "$SOURCE/crm/app/api/nimmi/intakes/[id]/convert/route.ts" "app/api/nimmi/intakes/[id]/convert/route.ts"
cp "$SOURCE/crm/app/nimmi/page.tsx" "app/nimmi/page.tsx"

echo "  ✓ Installed:"
echo "    + app/api/nimmi/signups/[id]/convert/route.ts"
echo "    + app/api/nimmi/callbacks/[id]/convert/route.ts"
echo "    + app/api/nimmi/intakes/[id]/convert/route.ts"
echo "    + app/nimmi/page.tsx (UPDATED with Convert buttons + dialog)"

# Build check
echo ""
echo "▶ Type-check..."

if [ -f "node_modules/.bin/tsc" ]; then
  ./node_modules/.bin/tsc --noEmit 2>&1 | tail -10 || true
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✓ Convert to Case installed"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Deploy CRM:"
echo "  cd \"\$(git rev-parse --show-toplevel)\""
echo "  git add ."
echo "  git commit -m 'feat: convert-to-case for nimmi signups/callbacks/intakes'"
echo "  git push"
echo ""
echo "After deploy, test at: https://crm.newtonimmigration.com/nimmi"
echo "Each row in Signups, Callbacks, Eligibility now has 'Convert to Case'."
echo "Click → pick form type + assignee → creates real CRM case."
echo ""
echo "ENV VAR check: DEFAULT_COMPANY_ID should be set (defaults to 'newton')"
