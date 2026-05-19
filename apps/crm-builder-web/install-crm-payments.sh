#!/bin/bash
# CRM Payments tab + webhook receiver
# Run from CRM dir: /Users/junglelabs/Documents/New project/newton-crm-test/apps/crm-builder-web

set -e

echo "═══════════════════════════════════════════════════════"
echo "  CRM — Nimmi Payments Tab"
echo "═══════════════════════════════════════════════════════"
echo ""

if [ -d ~/Downloads/crm-payments ]; then
  SOURCE=~/Downloads/crm-payments
elif [ -f ~/Downloads/crm-payments.tar.gz ]; then
  cd ~/Downloads && tar -xzf crm-payments.tar.gz && cd -
  SOURCE=~/Downloads/crm-payments
else
  echo "✗ Cannot find crm-payments in ~/Downloads"
  exit 1
fi

if ! grep -q "crm-builder-web" package.json 2>/dev/null; then
  echo "✗ Not in CRM dir. Run from CRM apps/crm-builder-web/"
  exit 1
fi

echo "▶ Installing CRM-side files..."

mkdir -p \
  app/api/integrations/nimmi/payment-submitted \
  app/api/nimmi/payments \
  app/nimmi

cp "$SOURCE/app/api/integrations/nimmi/payment-submitted/route.ts" \
   app/api/integrations/nimmi/payment-submitted/route.ts
echo "  ✓ app/api/integrations/nimmi/payment-submitted/route.ts (webhook receiver)"

cp "$SOURCE/app/api/nimmi/payments/route.ts" \
   app/api/nimmi/payments/route.ts
echo "  ✓ app/api/nimmi/payments/route.ts (list + verify/reject)"

cp "$SOURCE/app/nimmi/PaymentsTab.tsx" \
   app/nimmi/PaymentsTab.tsx
echo "  ✓ app/nimmi/PaymentsTab.tsx (UI component)"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✓ Files installed"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "📋 MANUAL STEPS:"
echo ""
echo "  1. Apply CRM migration:"
echo '     psql "$DATABASE_URL" -f '"$SOURCE/migrations/nimmi_payments.sql"
echo ""
echo "  2. Verify env vars are set in Railway/CRM:"
echo "     NIMMI_WEBHOOK_SECRET=<must equal Nimmi's CRM_WEBHOOK_SECRET>"
echo "     DATABASE_URL=<CRM Postgres connection>"
echo ""
echo "  3. Add Payments tab to /nimmi/page.tsx:"
echo "     Open app/nimmi/page.tsx"
echo "     At top: import { PaymentsTab } from './PaymentsTab';"
echo "     Add a 5th tab button next to existing 4 tabs"
echo "     Add: {activeTab === 'payments' && <PaymentsTab />}"
echo ""
echo "  4. Build + deploy:"
echo "     npm run build"
echo "     git add . && git commit -m 'feat: nimmi payments tab'"
echo "     git push"
echo ""
echo "  5. Test:"
echo "     Visit https://crm.newtonimmigration.com/nimmi"
echo "     Click 'Payments' tab"
echo "     If user submits payment on Nimmi → appears here within ~2 seconds"
