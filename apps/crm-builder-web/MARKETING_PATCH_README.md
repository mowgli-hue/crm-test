# Newton CRM — Marketing Build + Rep Letter Rebuild

This patch contains every file changed across the three turns. Drop these into
`apps/crm-builder-web/` in your repo, replacing the existing files at the same paths.

## Files in this patch

```
app/api/cases/[id]/rep-letter/route.ts             [REWRITTEN]
app/api/marketing-inbox/route.ts                   [REWRITTEN]
app/api/marketing-whatsapp/route.ts                [REWRITTEN]
app/api/marketing-leads/route.ts                   [NEW]
app/api/marketing-leads/[phone]/route.ts           [NEW]
app/api/marketing-leads/[phone]/convert/route.ts   [NEW]
app/api/marketing-broadcast/route.ts               [NEW]
app/api/marketing-stats/route.ts                   [NEW]
components/marketing-inbox.tsx                     [MODIFIED]
components/marketing-leads.tsx                     [NEW]
components/marketing-dashboard.tsx                 [NEW]
components/simple-shell.tsx                        [MODIFIED]
lib/rbac.ts                                        [MODIFIED]
```

## What's new

### 1. Representative Letter (matches the Aarti reference format)
- Newton logo embedded directly from `public/newton_logo.png`
- "NEWTON IMMIGRATION" wordmark (red NEWTON, black IMMIGRATION)
- Contact strip top-right (phone, email, website)
- Red separator line under the header
- Red gradient strip at the bottom of every page
- Letterhead repeats on every page (multi-page support)
- Body copy matches the Aarti tone for Study Permit Extension; 8 other form
  types have their own templates
- Pronoun support: pass `pronouns: "he"` or `"she"` in the POST body, or set
  `pronouns` in `pgwpIntake`. Defaults to they/them/their.
- Keep-together logic prevents the signature block from being split across pages

### 2. Marketing Lead Pipeline (new feature)
- 6-stage Kanban board: New → Contacted → Consult Booked → Consult Done → Converted → Lost
- Lead source tagging (WhatsApp, Facebook, Instagram, TikTok, Referral, Walk-in, Google, Website, Other)
- Auto-detection of source from FB/IG click-to-WhatsApp ad referrals
- Service interest auto-detection from message content (PGWP, Study Permit, Visitor Visa, etc.)
- Per-lead notes, tags, assigned-to, next follow-up date
- Per-thread AI auto-reply toggle (so staff can take over a conversation)
- Convert lead → real Case in one click (creates Drive folder, client record, etc.)

### 3. Marketing Dashboard (new feature)
- Today's stats cards: New today, Inbound today, Unread, Follow-ups due, Converted today
- Pipeline breakdown bar chart by stage
- Lead source breakdown
- 14-day new-leads trend chart
- Stat cards are clickable — jump to the relevant screen

### 4. Marketing Inbox upgrades
- Stage badges visible on every thread in the left list
- Service interest tag visible on every thread
- "Manual" indicator when AI auto-reply is off for that thread
- AI on/off toggle in the chat header
- Stage selector in the chat header
- "→ Case" button to convert lead to case without leaving the inbox
- Linked case ID shown in header for converted leads
- `saveName` action now properly handled by backend (was previously broken)
- Auto mark-read when opening a thread

### 5. Broadcast feature
- Send a single message to many leads at once
- Filter by stage, source, or tags
- `{name}` and `{phone}` template variables
- Throttled at 800ms per send to respect WhatsApp rate limits
- Capped at 250 recipients per broadcast
- Auto-excludes converted/lost leads
- Sent messages saved to inbox so staff can see what was sent

## Database schema

The `marketing_leads` table is auto-created on first hit by any of the
marketing endpoints. No manual migration needed.

```sql
CREATE TABLE marketing_leads (
  phone TEXT PRIMARY KEY,
  contact_name TEXT,
  stage TEXT NOT NULL DEFAULT 'new',
  source TEXT,
  service_interest TEXT,
  tags TEXT[],
  notes TEXT,
  assigned_to TEXT,
  next_follow_up DATE,
  consultation_paid BOOLEAN NOT NULL DEFAULT FALSE,
  converted_case_id TEXT,
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Optional back-fill

To populate `marketing_leads` rows for phone numbers that already exist in
`marketing_inbox` (so existing chats show up in the pipeline), run this once
after deploying:

```sql
INSERT INTO marketing_leads (phone, contact_name, stage, ai_enabled)
SELECT DISTINCT phone, MAX(contact_name), 'new', TRUE
FROM marketing_inbox
WHERE phone NOT IN (SELECT phone FROM marketing_leads)
GROUP BY phone;
```

## Deployment

1. Copy the files in this patch into `apps/crm-builder-web/` (preserving the
   directory structure).
2. Commit + push to `codex/crm-production-launch`.
3. Railway redeploys automatically — no env var changes needed.
4. (Optional) Run the back-fill SQL above in your Postgres console.
5. (Optional) Test the Aarti rep letter by opening any Study Permit Extension
   case and clicking 📜 Representative Letter → 📥 Generate & Download.

## Endpoints reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/marketing-inbox` | List all messages + leads map |
| POST | `/api/marketing-inbox` | Send message · `action: saveName` · `markRead` · `deleteThread` · `toggleAI` |
| GET | `/api/marketing-leads?stage=&source=&dueToday=&q=` | List leads with filters |
| POST | `/api/marketing-leads` | Manually create/upsert a lead |
| PATCH | `/api/marketing-leads/[phone]` | Update any lead field |
| DELETE | `/api/marketing-leads/[phone]` | Remove a lead |
| POST | `/api/marketing-leads/[phone]/convert` | Convert lead → real Case |
| POST | `/api/marketing-broadcast` | Send to many leads with filter or explicit phone list |
| GET | `/api/marketing-stats` | Pipeline / source / today / trend counts |

## Roles & access

- **Admin**: full access to all marketing screens
- **Marketing**: full access to all marketing screens
- **Processing / ProcessingLead / Reviewer**: cannot see marketing screens

## Things to test on first deploy

1. Open Marketing Inbox → existing threads should show up. Threads from new
   phone numbers will get a `marketing_leads` row auto-created on the next
   inbound message.
2. Click a thread → should mark inbound messages as read. AI toggle button
   visible. Stage selector visible.
3. Click "→ Case" button → modal opens with form-type dropdown. Pick one,
   submit → success alert with case ID.
4. Open Lead Pipeline tab → should see Kanban board with 6 columns. Existing
   leads grouped by stage.
5. Open Marketing Stats tab → should see counts. New leads chart should show
   trend over last 14 days.
6. Test broadcast with stage filter and 1-2 recipients first.
7. Generate a rep letter for a Study Permit Extension case → PDF should look
   like the Aarti reference (logo top-left, red strips, body copy matches).
