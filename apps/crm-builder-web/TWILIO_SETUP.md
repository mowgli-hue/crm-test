# Twilio Setup Guide — Newton Immigration

This is the step-by-step for setting up Twilio so calls coming into Newton's
phone number get auto-logged in the CRM, and after the call your team can send
checklists + fee quotes to the caller via WhatsApp with one click.

## Architecture (Path 2 — without recording)

```
Customer dials Newton number
         ↓
       Twilio
         ↓ (webhook)
Newton CRM logs the call (caller, time)
         ↓ (TwiML response)
Twilio rings staff phones in parallel
         ↓
Staff answers OR voicemail kicks in after 20s
         ↓ (status webhook)
CRM updates call entry: duration, answered/missed
         ↓
Voicemail (if any) auto-transcribed by Twilio → CRM
         ↓
Staff opens Call Log → adds notes → AI summarizes
         ↓
Staff clicks 📋 Send Checklist or 💰 Send Fee Quote
         ↓
WhatsApp message goes out automatically
         ↓
Lead moves to "Contacted" in pipeline
```

## What you do (one-time, ~30 minutes)

### Step 1 — Create Twilio account

1. Go to [twilio.com/try-twilio](https://www.twilio.com/try-twilio)
2. Sign up with your email
3. Verify phone (use your personal phone)
4. Skip the optional questionnaire OR pick "I'm building voice/messaging for my business"
5. Twilio gives you free trial credit (~$15) to start

### Step 2 — Decide: test number first, OR port Newton's number?

**RECOMMENDED: Test number first.**

Buy a brand-new Twilio number (~$1.15/month):
- Twilio Console → **Phone Numbers** → **Buy a number**
- Filter: **Country: Canada**, **Capabilities: Voice + SMS**
- Pick any number — area code doesn't matter for testing
- Click **Buy**

Then test the full flow before touching Newton's actual number.

**Once tested and working**, you have two options:
- **(a) Port Newton's existing Google Voice number to Twilio.** Takes 5-7 business days. Number stays the same on Google Maps.
- **(b) Get a new Twilio number permanently** and update Google Maps + website to it.

**I recommend (a)** — keeps your existing brand recognition and Google Maps reviews tied to the number.

### Step 3 — Find your Twilio credentials

In Twilio Console → **Account → API keys & tokens**:

- **Account SID** — copy this (starts with `AC...`)
- **Auth Token** — click "View", copy this

### Step 4 — Add env vars to Railway

In Railway → **Variables**, add these:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxx
TWILIO_FORWARD_TO=+16048975894,+16046535031,+16049070314
TWILIO_CALLER_ID=+16041234567
TWILIO_RING_TIMEOUT=20
PUBLIC_URL=https://junglecrm-builder-web-production-d358.up.railway.app
```

Variables explained:

| Variable | What | Example |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Your Twilio account ID | `AC...` |
| `TWILIO_AUTH_TOKEN` | Your Twilio auth token | (long string) |
| `TWILIO_FORWARD_TO` | Comma-separated list of Newton staff phones to ring on inbound calls | `+16048975894,+16046535031` |
| `TWILIO_CALLER_ID` | Your Twilio number (used as caller ID when forwarding to landlines) | `+16041234567` |
| `TWILIO_RING_TIMEOUT` | How many seconds to ring staff before falling back to voicemail | `20` |
| `PUBLIC_URL` | Your CRM's public URL (no trailing slash) | `https://...railway.app` |

After saving, Railway redeploys automatically.

### Step 5 — Configure webhook on the Twilio number

1. Twilio Console → **Phone Numbers** → click your Newton/test number
2. Scroll to **Voice Configuration**
3. Set **A call comes in** to:
   - **Webhook**: `https://yourapp.up.railway.app/api/twilio-voice`
   - **HTTP method**: `POST`
4. Set **Call status changes** to:
   - **Webhook**: (leave blank — we set the status webhook from inside the TwiML)
5. Save

### Step 6 — Test it

Call your Twilio number from your personal phone. You should hear:

1. Brief silence as Twilio routes
2. The call should ring on whichever phones are in `TWILIO_FORWARD_TO`
3. If staff answers → normal call
4. If nobody answers in 20 seconds → "Sorry, we could not reach our team. Please leave a message after the tone."
5. After leaving voicemail → "Thank you. We will return your call shortly." → call ends

In Newton CRM → **📞 Call Log** tab → the call should appear with:
- Caller: your phone number
- Outcome: `info_provided` (answered) or `voicemail` / `no_answer`
- Duration in seconds/minutes
- Voicemail transcript (if you left one) — appears 30-60 seconds after the call

### Step 7 — After the call: send WhatsApp follow-up

In Call Log, click the call card:
- **📋 Send Checklist + Fee** → pick service type → WhatsApp goes out
- **💰 Send Fee Quote** → just the fee, no checklist

The WhatsApp message uses Newton's existing marketing WhatsApp number (`+1 236-501-3524`) and includes:
- Service name + total fee + breakdown (Newton fee vs IRCC fee)
- Document checklist (if "Send Checklist" was clicked)
- Newton's payment instructions (Interac to `newtonimmigration@gmail.com`)
- Link to send docs (`+1 604-779-5700` processing line)

## Recurring costs (Path 2 — no recording)

For Newton's expected volume (~30 calls/day, 5 min average):

| Item | Monthly cost |
|---|---|
| Twilio phone number | $1.15 |
| Inbound call routing | ~$25 ($0.0085/min × 750 min/wk × 4 wks) |
| Voicemail storage | ~$2 |
| Voicemail transcription (free, 2 min limit) | $0 |
| **Total** | **~$30/month** |

If you later decide to enable recording + AI transcription, add ~$70-100/month
on top.

## Porting Newton's existing number

If you want to port your existing Google Voice number to Twilio:

1. **First, check portability**: Twilio Console → **Phone Numbers** → **Port a number** → enter the number → it'll tell you if it's portable.
2. **If portable**:
   - Get your Google Voice account number / PIN (Google Voice account → Settings)
   - Submit port-in request in Twilio
   - Provide a Letter of Authorization (LOA) — Twilio gives you the form
   - Wait 5-7 business days
   - During the port, the number keeps working on Google Voice
   - When complete, Google Voice releases the number, Twilio takes over
   - Update the webhook on the new Twilio number (same as Step 5 above)
   - Update Google Maps and website if anything else points to the number
3. **If NOT portable** (some Google Voice numbers can't leave): get a new Twilio number, update Google Maps to use it.

## Troubleshooting

**Calls don't ring on staff phones.**
Check `TWILIO_FORWARD_TO` env var — must be E.164 format (`+1604...`), comma-separated, no spaces inside numbers.

**Calls go straight to voicemail.**
Either no numbers in `TWILIO_FORWARD_TO`, or staff phones rejecting the call (some carriers flag forwarded calls as spam — staff might need to add the Twilio caller ID to contacts).

**No calls appear in CRM Call Log.**
Webhook URL wrong (check Step 5), or `PUBLIC_URL` env var wrong, or the database connection failed. Check Railway logs.

**Voicemail transcripts not appearing.**
Twilio's free transcription is async — gives up after ~2 min. Check that the voicemail was under 2 minutes. For longer voicemails, consider adding paid transcription later.

**Want to add recording later?**
Edit `app/api/twilio-voice/route.ts` and add `record="record-from-answer-dual"` to the `<Dial>` element, plus a recording status callback. Required: legal disclosure greeting before the `<Dial>`. Ask Claude to wire this in when you're ready.

## What this gives you vs Path 1 (recording + AI)

| | Path 2 (this) | Path 1 (recording) |
|---|---|---|
| Caller auto-logged | ✅ | ✅ |
| Call duration tracked | ✅ | ✅ |
| Voicemail captured | ✅ | ✅ |
| Voicemail transcribed | ✅ (Twilio free, basic) | ✅ (Whisper, accurate) |
| Answered call recorded | ❌ | ✅ |
| Answered call AI-summarized | ❌ (manual notes) | ✅ |
| Auto WhatsApp follow-up | ✅ (1 click after call) | ✅ (auto-triggered) |
| Convert lead → case | ✅ | ✅ |
| Cost | ~$30/mo | ~$130/mo |
| PIPEDA compliance | Easy | Strict |

You can upgrade from Path 2 to Path 1 anytime — same Twilio account, same number, just enable recording in the TwiML.
