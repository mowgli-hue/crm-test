# Adding a Second WhatsApp Number to the Newton CRM

This guide walks you (or your dev) through registering a phone number with
the **WhatsApp Business Cloud API** and wiring it into the Newton CRM the same
way as the existing marketing number `+1 236-501-3524`.

## What you need to know first

There are **two WhatsApp products**, and only one of them works with a CRM:

| Product | Where it runs | CRM integration? |
|---|---|---|
| **WhatsApp Business app** | On a phone | ❌ No (TOS violation to scrape) |
| **WhatsApp Business Cloud API** | Meta servers, webhooks → your CRM | ✅ Yes — this is what we use |

Your Google Voice number is currently on the **app** (running on a phone).
To get its messages into the CRM, the number has to migrate to the **Cloud API**.

**A phone number can only be on one of these at a time.** Once you migrate to
Cloud API, the WhatsApp app on the phone will stop working for that number.
This is by design — Meta wants strict separation between consumer apps and
business APIs.

## What this costs

- **WhatsApp Business Cloud API**: Free for the first 1,000 conversations/month,
  then ~$0.005-$0.08 per conversation depending on type. Marketing-initiated
  conversations cost more than user-initiated.
- **Meta Business Manager**: Free.
- **Phone number verification**: Meta sends an SMS or voice call to verify.
  If your number is on Google Voice and Google Voice can receive SMS, this works.
  If not, you'll need a phone that can receive SMS at that number temporarily.

## Step-by-step migration

### 1. Decide on the number

If the Google Voice number can receive SMS, you can verify it with WhatsApp.
Google Voice **does** support SMS reception, so this should work.

Make sure no one is currently using the WhatsApp app on this number — once you
start the migration, that account is gone.

### 2. Set up Meta Business Manager (if not already)

Go to [business.facebook.com](https://business.facebook.com).

You should already have a Business Manager account from when you set up
`+1 236-501-3524`. Use the same one — you can have multiple numbers under
one Business Manager.

### 3. Add a new WhatsApp Business Account (WABA)

In Business Manager:
1. **Settings** → **Accounts** → **WhatsApp Accounts** → **Add**
2. Or: just go to [business.facebook.com/wa/manage](https://business.facebook.com/wa/manage)
3. Click **Add phone number**
4. Enter the Google Voice number (full international format, e.g. `+1 604-XXX-XXXX`)
5. Choose a display name (e.g. "Newton Immigration") — must match the legal/brand name
6. Choose a category (Professional Services or Legal Services)

### 4. Verify the number

Meta will offer two verification methods:
- **SMS** — they send a code, you type it in. Google Voice should receive this in the Google Voice app or web inbox.
- **Voice call** — they call the number and speak the code.

If both fail (e.g. Google blocks Meta's SMS), you may need to temporarily
forward the number to a phone that can receive SMS, verify there, then turn
forwarding off.

### 5. Get the credentials

Once the number is verified and added to your WABA, in **WhatsApp Manager**:

1. Click on the new phone number
2. Note the **Phone number ID** (long numeric string, e.g. `1234567890123456`).
   This is what gets passed in the API URL — NOT the human-readable phone number.
3. Click **Settings** → **Webhook** → set the webhook URL to:
   ```
   https://junglecrm-builder-web-production-d358.up.railway.app/api/marketing-whatsapp
   ```
   (Or whatever your Railway URL is.)
4. Verify token: use the same value that's already in your env vars (`WHATSAPP_VERIFY_TOKEN` — defaults to `newton_verify_2024`).
5. Subscribe to: `messages`, `message_status` (these are the events the CRM uses).
6. Generate a **Permanent Access Token** (System User Token) under
   **Business Settings → System Users → Generate Token**. Pick the asset (your WhatsApp Business Account)
   and assign permissions: `whatsapp_business_messaging`, `whatsapp_business_management`.

### 6. Add the number to the CRM

You have **two options** depending on whether you want to:

#### Option A — Replace the existing marketing number entirely
(Simpler. The Google number takes over.)

In Railway, update these env vars:
```
WHATSAPP_MARKETING_PHONE_ID=<new-phone-number-id>
WHATSAPP_TOKEN=<new-permanent-token>
```

Then redeploy. The existing inbox keeps all history; new messages come in on the new number.

#### Option B — Run BOTH numbers simultaneously
(More complex. Both numbers come into the same inbox.)

This requires a code change to support multiple numbers. If you want this,
ask Claude to add multi-number support to `marketing-whatsapp/route.ts`.

### 7. Test

1. Send a WhatsApp message from your personal phone to the new number
2. Within ~5 seconds it should appear in the CRM Marketing Inbox
3. The AI should auto-reply
4. The lead should appear in the Lead Pipeline as "New"

### 8. Update the AI's contact info

In `lib/marketing-knowledge.ts`, update the `OFFICES` section if the new
number replaces the old one — the AI tells callers what number to reach
Newton on.

Currently it says:
```
Surrey: +1 604-897-5894 / +1 604-653-5031 / +1 (236) 877-2225
```

Update to whichever numbers Newton wants in client-facing AI responses.

## How the CRM handles WhatsApp messages once wired

1. **Inbound message** → Meta sends webhook → `/api/marketing-whatsapp/route.ts`
2. **Lead row** auto-created (or updated) in `marketing_leads` table
3. **Source** auto-detected from FB/IG ad referral header if present
4. **Service interest** auto-detected from message content (PGWP, Study Permit, etc.)
5. **AI reply** generated by Claude Haiku 4.5 using Newton fee schedule + doc checklists
6. **Reply sent** back to client; both messages saved to `marketing_inbox` table
7. **Stage** auto-promoted from "new" → "contacted"
8. **Notification** dropped on Admin/Marketing/ProcessingLead users in the CRM
9. Staff sees the conversation in Marketing Inbox, can take over manually with the 🤚 Manual toggle

## How phone calls work in this CRM

Phone calls are **not automatic** — Google Voice has no public API that lets us
pull call data into the CRM. Instead:

- Staff finishes a call (incoming or outgoing)
- Opens the **📞 Call Log** tab
- Clicks **Log Call**
- Types name, phone, duration, outcome, rough notes
- Toggles **🤖 Use AI to polish my rough notes** — Claude turns the rough notes
  into a clean 2-4 sentence summary (e.g. "Raj called about PGWP. He has all
  documents ready and will send via WhatsApp later today. Cousin referred him.")
- Saves

Each call entry is searchable, links to a phone number (so you can see all calls
from one client), and supports outcome tracking (consultation booked, fee quoted,
no answer, etc.).

If you later want full call recording + AI transcription, that requires
moving away from Google Voice to Twilio (or similar) — happy to build that
later if it becomes a priority.

## Questions / issues

- Webhook not receiving anything? Check: webhook URL is correct, verify token matches, subscribed to `messages` event.
- Token expired? Generate a new permanent access token and update `WHATSAPP_TOKEN` in Railway.
- Messages stuck in queue? Check the `marketing_inbox` table directly in Postgres to see if rows are inserting.
