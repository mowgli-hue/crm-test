#!/bin/bash
# Nimmi — Megabatch (5 features)
# ──────────────────────────────────────────────────────────────
# Ships:
#   ✓ AI document parsing via CRM (uses extractDocumentFields)
#   ✓ Email expiry notifications (cron-friendly endpoint)
#   ✓ Wordmark component (drop-in for logo)
#   ✓ Newton briefing doc (Markdown deliverable)
#   ✓ CRM-side endpoint /api/integrations/nimmi/parse-doc

set -e

echo "═══════════════════════════════════════════════════════"
echo "  Nimmi — Megabatch (5 features)"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── STEP 1: Find source ────────────────────────────────────────────
echo "▶ Step 1/5: Finding source files..."

if [ -d ~/Downloads/nimmi-megabatch ]; then
  SOURCE=~/Downloads/nimmi-megabatch
elif [ -f ~/Downloads/nimmi-megabatch.tar.gz ]; then
  cd ~/Downloads && tar -xzf nimmi-megabatch.tar.gz && cd -
  SOURCE=~/Downloads/nimmi-megabatch
else
  echo "✗ Cannot find nimmi-megabatch in ~/Downloads"
  exit 1
fi

echo "  ✓ Found: $SOURCE"

# ─── STEP 2: Detect which side we're on ─────────────────────────────
echo ""
if [ -f "package.json" ] && grep -q '"nimmi"' package.json 2>/dev/null; then
  SIDE="nimmi"
  echo "▶ Detected: NIMMI repo ($(pwd))"
elif grep -q "crm-builder-web" package.json 2>/dev/null; then
  SIDE="crm"
  echo "▶ Detected: CRM repo ($(pwd))"
else
  echo "✗ Run from ~/Desktop/nimmi (for Nimmi side) or"
  echo "  ~/Documents/New project/newton-crm-test/apps/crm-builder-web (for CRM side)"
  exit 1
fi

BACKUP_DIR="/tmp/nimmi-megabatch-backup-$(date +%s)"
mkdir -p "$BACKUP_DIR"

# ─── STEP 3: Install ────────────────────────────────────────────────
echo ""
echo "▶ Step 2/5: Installing files for: $SIDE"

if [ "$SIDE" = "nimmi" ]; then
  # Back up existing immibook actions if present
  if [ -f "lib/immibook/actions.ts" ]; then
    cp "lib/immibook/actions.ts" "$BACKUP_DIR/immibook-actions.ts.bak"
    echo "  ✓ Backed up lib/immibook/actions.ts"
  fi

  # Copy nimmi-side files
  mkdir -p lib/crm lib/email/templates lib/immibook components/brand
  mkdir -p app/api/cron/expiry-notifications

  cp "$SOURCE/nimmi/lib/crm/parse-doc.ts" lib/crm/parse-doc.ts
  cp "$SOURCE/nimmi/lib/email/templates/expiry.ts" lib/email/templates/expiry.ts
  cp "$SOURCE/nimmi/lib/immibook/actions.ts" lib/immibook/actions.ts
  cp "$SOURCE/nimmi/app/api/cron/expiry-notifications/route.ts" app/api/cron/expiry-notifications/route.ts
  cp "$SOURCE/nimmi/components/brand/Wordmark.tsx" components/brand/Wordmark.tsx
  cp "$SOURCE/docs/NEWTON-BRIEFING.md" ./NEWTON-BRIEFING.md

  echo "  ✓ Installed Nimmi-side files:"
  echo "    + lib/crm/parse-doc.ts (CRM client)"
  echo "    + lib/email/templates/expiry.ts (email template)"
  echo "    + lib/immibook/actions.ts (PATCHED — adds AI parsing during upload)"
  echo "    + app/api/cron/expiry-notifications/route.ts (cron endpoint)"
  echo "    + components/brand/Wordmark.tsx (logo component)"
  echo "    + NEWTON-BRIEFING.md (in repo root)"

elif [ "$SIDE" = "crm" ]; then
  # Back up any existing parse-doc route
  if [ -d "app/api/integrations/nimmi/parse-doc" ]; then
    cp -R "app/api/integrations/nimmi/parse-doc" "$BACKUP_DIR/"
    echo "  ✓ Backed up existing parse-doc route"
  fi

  mkdir -p app/api/integrations/nimmi
  cp -R "$SOURCE/crm/app/api/integrations/nimmi/parse-doc" app/api/integrations/nimmi/

  echo "  ✓ Installed CRM-side file:"
  echo "    + app/api/integrations/nimmi/parse-doc/route.ts (uses extractDocumentFields)"
fi

# ─── STEP 4: Build ──────────────────────────────────────────────────
echo ""
echo "▶ Step 3/5: Build verification..."
echo ""

npm run build || {
  echo ""
  echo "  ✗ Build failed."
  echo "  Backups in: $BACKUP_DIR"
  echo "  Restore: cp $BACKUP_DIR/<file> <original-path>"
  exit 1
}

# ─── STEP 5: Logo upload prompt ─────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✓ Megabatch installed (side: $SIDE)"
echo "═══════════════════════════════════════════════════════"

if [ "$SIDE" = "nimmi" ]; then
  echo ""
  echo "📋 LOGO INTEGRATION — manual step:"
  echo ""
  echo "  Export your logo as 3 SVG files and put them in public/:"
  echo "    public/nimmi-mark.svg      — just the N icon"
  echo "    public/nimmi-wordmark.svg  — just 'nimmi' text"
  echo "    public/nimmi-lockup.svg    — N + 'nimmi' combined"
  echo ""
  echo "  Until you do, Wordmark component falls back to styled text safely."
  echo "  Use it in your code like:"
  echo "    import { Wordmark } from '@/components/brand/Wordmark'"
  echo "    <Wordmark size=\"md\" />"
  echo ""
  echo "📋 ENV VARS to add to Railway (Nimmi):"
  echo ""
  echo "  CRON_SECRET=<generate with: openssl rand -hex 32>"
  echo ""
  echo "📋 EXPIRY NOTIFICATIONS — set up cron:"
  echo ""
  echo "  Pick one of:"
  echo "    (a) Railway cron service (cleanest)"
  echo "    (b) cron-job.org (free, easy)"
  echo "    (c) GitHub Actions scheduled workflow"
  echo ""
  echo "  Schedule daily 9am Vancouver, calling:"
  echo "    GET https://www.nimmi.solutions/api/cron/expiry-notifications?key=\$CRON_SECRET"
  echo ""
  echo "  Test now (dry run — finds users but doesn't send):"
  echo "    curl 'https://www.nimmi.solutions/api/cron/expiry-notifications?key=YOUR_KEY&dry_run=1'"
  echo ""
  echo "📋 AI PARSING:"
  echo ""
  echo "  Already wired into upload flow. When user uploads a passport/permit,"
  echo "  CRM extracts expiry date and document number, pre-fills the row."
  echo "  Requires: ANTHROPIC_API_KEY env var on CRM side."
  echo ""
  echo "📋 NEWTON BRIEFING:"
  echo ""
  echo "  Open NEWTON-BRIEFING.md in repo root."
  echo "  Convert to PDF, share with team, OR paste into Notion/Slack."
  echo ""
  echo "📋 DEPLOY:"
  echo ""
  echo "  git add ."
  echo "  git commit -m 'feat: AI doc parsing + expiry emails + logo component'"
  echo "  git push"
  echo "  railway up"

elif [ "$SIDE" = "crm" ]; then
  echo ""
  echo "📋 ENV VARS — ensure these exist on CRM Railway:"
  echo ""
  echo "  ANTHROPIC_API_KEY=sk-ant-..."
  echo "  NIMMI_WEBHOOK_SECRET=<same as CRM_WEBHOOK_SECRET on Nimmi side>"
  echo ""
  echo "📋 DEPLOY CRM:"
  echo ""
  echo "  cd \"\$(git rev-parse --show-toplevel)\""
  echo "  git add ."
  echo "  git commit -m 'feat: nimmi parse-doc endpoint'"
  echo "  git push"
  echo ""
  echo "  (auto-deploys via Railway based on your CRM setup)"
  echo ""
  echo "📋 TEST:"
  echo ""
  echo "  After deploy, test the endpoint:"
  echo "    curl -X POST https://crm.newtonimmigration.com/api/integrations/nimmi/parse-doc \\"
  echo "      -H \"X-Webhook-Secret: \$NIMMI_WEBHOOK_SECRET\" \\"
  echo "      -F \"file=@/path/to/test-passport.jpg\" \\"
  echo "      -F \"client_name=Test User\""
  echo ""
  echo "  Should return JSON with extracted fields like expiryDate, documentNumber, etc."
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Run this script on the OTHER side too (CRM and Nimmi)"
echo "  to ship the full integration."
echo "═══════════════════════════════════════════════════════"
