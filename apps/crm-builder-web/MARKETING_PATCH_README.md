# Newton CRM — Marketing Build + AI-Powered Rep Letter (v5)

Drop the contents of this zip into `apps/crm-builder-web/` in your repo,
replacing the existing files at the same paths.

## What's new in v5: AI-powered Rep Letter ✨

Each client has their own story — transfers, gaps, hardships, achievements.
The rep letter generator now lets staff write the client's story and Claude AI
weaves it into a properly structured IRCC submission letter.

### Flow

1. Open any case → click **"✍️ Write Story & Generate"** (purple button)
2. Modal opens with a textarea + pronoun selector
3. Staff writes the client's situation — anything relevant:
   academic journey, transfers, achievements, refusals, gaps, personal hardships, unique circumstances
4. Click **"🪄 Generate with AI"**
5. **Claude Haiku 4.5** analyses the story and produces a structured letter body:
   intro paragraphs → 2-4 themed sections (e.g. "Background and Academic Journey",
   "Eligibility for Study Permit Extension", "Request for Consideration") →
   eligibility bullets → polite closing
6. PDF generates with Newton letterhead + the AI-personalized body
7. Auto-downloads + uploads to the client's Drive folder

### Example

**Story written by staff:**

> Aarti began her studies at Capilano University and was progressing well. Due
> to outside influence she transferred to Granville College for one semester,
> but realized this was not the right fit. She returned to Capilano University
> to continue her Associate of Arts degree.

**AI-generated section in the letter:**

> **Background and Academic Journey**
>
> Aarti initially began her studies at Capilano University and was progressing
> well in her chosen program. However, due to unforeseen circumstances and
> external influence, she was convinced to transfer to Granville College.
> After one semester at Granville College, Aarti realized that this decision
> was not in her best interest...

The AI is also smart about the Enclosed Documents — it added "(Capilano
University and Granville College)" to the transcripts entry because both
institutions were relevant to the story.

### Fallback

If AI fails or no story is provided (or the story is under 20 characters),
the letter falls back to the existing template-based body. The button always
works even without `ANTHROPIC_API_KEY` set.

### Required env var

```
ANTHROPIC_API_KEY=sk-ant-...
```

Already set on Railway from the existing AI features. No env change needed.

## Files in this patch

```
app/api/cases/[id]/rep-letter/route.ts             [REWRITTEN — adds AI body generation]
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
components/simple-shell.tsx                        [MODIFIED — adds Rep Letter modal]
lib/rbac.ts                                        [MODIFIED]
public/newton_logo.png                             [REPLACED — high-res 1275x1650]
public/newton_emblem.png                           [NEW — clean colour emblem]
public/newton_emblem_dark.png                      [NEW — white-on-black variant]
public/newton_lockup.png                           [NEW — emblem + wordmark stack]
```

## Rep letter design

- Clean Newton emblem on white (no awkward black box)
- "NEWTON IMMIGRATION" wordmark with elegant letter spacing
- Contact strip top-right (phone, email, website)
- Red separator with thin grey hairline below
- **Section headings**: red vertical accent bar + bold heading + thin grey rule
- **Bullets**: red dots with bold labels
- **Title**: centred, red underline
- **Enclosed Documents**: red-numbered list with the new heading style
- Red gradient strip at the bottom of every page
- Letterhead repeats on every page

Form types with custom template fallbacks:
Study Permit Extension, PGWP, SOWP, Visitor Visa/TRV, Visitor Record,
Family Sponsorship, plus a generic fallback.

## Marketing CRM features

### Lead Pipeline (Kanban)

6-stage board: New → Contacted → Consult Booked → Consult Done → Converted → Lost
- Lead source tagging (WhatsApp, Facebook, Instagram, TikTok, Referral, Walk-in, Google, Website, Other)
- Auto-detects source from FB/IG click-to-WhatsApp ad referrals
- Auto-detects service interest from message content
- Per-lead notes, tags, assigned-to, next follow-up date
- Per-thread AI auto-reply toggle
- Convert lead → real Case in one click

### Marketing Dashboard

- Today's stats: New today, Inbound today, Unread, Follow-ups due, Converted today
- Pipeline breakdown bar chart
- Lead source breakdown
- 14-day new-leads trend chart

### Marketing Inbox upgrades

- Stage badges and service interest tags on every thread
- AI on/off toggle in chat header
- Stage selector + "→ Case" button in chat header
- Auto mark-read when opening a thread

### Broadcast

- Send single message to many leads
- Filter by stage, source, or tags
- `{name}` and `{phone}` template variables
- Throttled at 800ms per send, capped at 250 recipients

## Database schema

Auto-creates on first hit. No manual migration needed.

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

```sql
INSERT INTO marketing_leads (phone, contact_name, stage, ai_enabled)
SELECT DISTINCT phone, MAX(contact_name), 'new', TRUE
FROM marketing_inbox
WHERE phone NOT IN (SELECT phone FROM marketing_leads)
GROUP BY phone;
```

## Deployment

```bash
cd ~/Documents/New\ project/newton-crm-test
unzip -o ~/Downloads/newton-marketing-patch-v5.zip
git add apps/crm-builder-web
git commit -m "feat: marketing CRM + AI-powered rep letter"
git push origin codex/crm-production-launch
```

Railway redeploys automatically.

## Endpoints reference

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/cases/[id]/rep-letter` | **Body: `{ clientStory?, pronouns? }`** — AI-personalized rep letter PDF |
| GET | `/api/marketing-inbox` | List all messages + leads map |
| POST | `/api/marketing-inbox` | Send · `action: saveName/markRead/deleteThread/toggleAI` |
| GET | `/api/marketing-leads` | List leads with filters |
| POST | `/api/marketing-leads` | Manually create/upsert a lead |
| PATCH | `/api/marketing-leads/[phone]` | Update any lead field |
| DELETE | `/api/marketing-leads/[phone]` | Remove a lead |
| POST | `/api/marketing-leads/[phone]/convert` | Convert lead → real Case |
| POST | `/api/marketing-broadcast` | Send to many leads |
| GET | `/api/marketing-stats` | Pipeline / source / today / trend counts |

## Rep letter API direct usage

```bash
curl -X POST https://yourapp/api/cases/CASE-1234/rep-letter \
  -H "Content-Type: application/json" \
  -d '{
    "systemToken": "newton-recovery-2024",
    "clientStory": "Aarti began at Capilano, transferred to Granville for one semester, returned to Capilano...",
    "pronouns": "she"
  }' --output letter.pdf
```

Body parameters:
- `clientStory` (optional): if 20+ chars and `ANTHROPIC_API_KEY` is set, AI generates the body
- `pronouns` (optional): `"they"` (default), `"he"`, or `"she"`
- `passportNumber`, `uci`, `institution`, `program`, `arrivalDate`, `permitExpiry`, `programEndDate` (optional): override case data
- `systemToken` (optional): bypasses auth if equals `AUTH_RECOVERY_TOKEN`

## Things to test on first deploy

1. Open a Study Permit Extension case → click "✍️ Write Story & Generate"
2. Modal opens — type a 2-3 sentence story, pick pronouns, click "🪄 Generate with AI"
3. Wait ~3-5 seconds → PDF downloads
4. Open PDF → verify the body has section headings woven from your story
5. Try with empty story → should still generate a default-template letter
6. Open Marketing Inbox → existing threads visible with stage badges
7. Open Lead Pipeline → Kanban board with 6 columns
8. Open Marketing Stats → counts and trend chart
9. Test broadcast with 1-2 recipients first
