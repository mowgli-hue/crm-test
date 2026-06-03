// app/api/admin/office-voice/route.ts
//
// "Learn how the office talks." Reads past marketing conversations, isolates the
// replies that were typed by Newton staff (filtering out the bot's own
// auto-replies), and distills a short OFFICE VOICE guide — language mix, tone,
// length/structure, emoji & greetings — that gets injected into the marketing
// bot's prompt so it sounds like the team, not a generic chatbot.
//
//   GET                      → { active, draft }                (latest of each)
//   POST { action:"learn" }  → analyse convos, save a DRAFT guide for review
//   POST { action:"approve", guide } → store edited guide as the ACTIVE one
//
// Auth: Admin only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getPool, saveOfficeVoiceDraft, getOfficeVoiceState, approveOfficeVoice } from "@/lib/postgres-store";

export const runtime = "nodejs";
export const maxDuration = 60;

async function requireAdmin(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.userType !== "staff" || user.role !== "Admin") {
    return { error: NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 }) };
  }
  return { user };
}

// Heuristics: does this outbound message look like the BOT wrote it (vs a human
// staffer)? We want to exclude bot text so the guide reflects the real office.
function looksBotGenerated(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return true;
  // Strong bot tells
  if (t.includes("nimmi.solutions") || t.includes("nimmi.")) return true;
  if (/🚨\s*newton/.test(text)) return true;                 // owner alert text
  if (/reply\s+yes\s+with\s+your\s+full\s+name/.test(t)) return true;
  if (/ready\s+to\s+(get\s+)?(start|begin)/.test(t)) return true;
  if (/consultation\s+fee|\$52\.50|\$315|\$525|\$265|\$350/.test(t)) return true;
  if (/processing\s+team\s+whatsapp|604-779-5700|604-653-5031/.test(t)) return true;
  if (/eligibility\s+(check|list)|document\s+checklist|here'?s?\s+the\s+doc/.test(t)) return true;
  // Structural tells: long walls of text or many bulleted lines = templated bot output
  const lines = text.split(/\n/).filter((l) => l.trim());
  const bulletLines = lines.filter((l) => /^[\s]*[•\-\*✓✅📋📏💪🔍📞👍]/.test(l)).length;
  if (text.length > 600) return true;
  if (bulletLines >= 3) return true;
  if (lines.length >= 8) return true;
  return false;
}

// A human reply we'd actually want to learn from.
function isUsableHumanReply(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 2) return false;
  if (looksBotGenerated(t)) return false;
  // Skip pure links / single emoji / system-ish strings
  if (/^https?:\/\/\S+$/.test(t)) return false;
  return true;
}

const clip = (s: string, n: number) => {
  const v = String(s || "").replace(/\s+/g, " ").trim();
  return v.length > n ? v.slice(0, n) + "…" : v;
};

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(request);
  if (gate.error) return gate.error;
  const state = await getOfficeVoiceState();
  return NextResponse.json({ ok: true, ...state });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin(request);
  if (gate.error) return gate.error;
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "").trim();

  // ── Approve (store edited/approved guide as ACTIVE) ──
  if (action === "approve") {
    const guide = String(body?.guide || "").trim();
    if (guide.length < 20) {
      return NextResponse.json({ error: "Guide text is empty or too short to approve." }, { status: 400 });
    }
    const sampleCount = Number(body?.sampleCount || 0);
    const active = await approveOfficeVoice(guide, gate.user!.name || gate.user!.id, sampleCount);
    return NextResponse.json({ ok: true, active });
  }

  // ── Learn (analyse conversations → draft guide) ──
  if (action === "learn") {
    const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

    // Pull recent marketing messages (both directions) and reconstruct short
    // client→office exchanges, keeping only human-typed office replies.
    const pool = getPool();
    let rows: Array<{ phone: string; message: string; direction: string; created_at: string }> = [];
    try {
      const res = await pool.query(
        `SELECT phone, message, direction, created_at
           FROM marketing_inbox
          WHERE created_at > NOW() - INTERVAL '180 days'
          ORDER BY phone, created_at ASC
          LIMIT 6000`
      );
      rows = res.rows as any;
    } catch (e) {
      return NextResponse.json({ error: "Could not read marketing_inbox: " + (e as Error).message }, { status: 500 });
    }

    // Build {client, office} pairs: an outbound human reply + the inbound that
    // preceded it (for context). One pair per office reply.
    type Pair = { client: string; office: string };
    const pairs: Pair[] = [];
    let lastInboundByPhone: Record<string, string> = {};
    let currentPhone = "";
    for (const r of rows) {
      if (r.phone !== currentPhone) { currentPhone = r.phone; lastInboundByPhone[r.phone] = ""; }
      if (r.direction === "inbound") {
        lastInboundByPhone[r.phone] = r.message;
      } else if (r.direction === "outbound" && isUsableHumanReply(r.message)) {
        pairs.push({
          client: clip(lastInboundByPhone[r.phone] || "(start of chat)", 240),
          office: clip(r.message, 320),
        });
        lastInboundByPhone[r.phone] = ""; // avoid reusing same context repeatedly
      }
    }

    if (pairs.length < 8) {
      return NextResponse.json({
        ok: false,
        error: `Only found ${pairs.length} human-written office replies to learn from — too few for a reliable style guide. (The bot's own replies are filtered out.) Try again after staff have handled more chats manually.`,
        sampleCount: pairs.length,
      });
    }

    // Sample up to 90, spread across the set (newest-weighted but varied).
    const MAX = 90;
    let sample = pairs;
    if (pairs.length > MAX) {
      const step = pairs.length / MAX;
      sample = Array.from({ length: MAX }, (_, i) => pairs[Math.floor(i * step)]);
    }

    const examplesBlock = sample
      .map((p, i) => `${i + 1}. Client: "${p.client}"\n   Office: "${p.office}"`)
      .join("\n");

    const learnPrompt = `Below are ${sample.length} real reply pairs from Newton Immigration's WhatsApp — each shows what a client said and how a HUMAN staff member replied. Study them and write a concise OFFICE VOICE GUIDE that another assistant can follow to sound exactly like this team.

Cover these four areas, with specific observations and short real examples drawn from the data (quote actual phrasings the team uses):
1. LANGUAGE MIX — which languages they use (English / Punjabi / Hindi / Hinglish), transliteration habits, and when they switch.
2. TONE & WARMTH — formality, friendliness, how they reassure or nudge clients, terms of address (e.g. "ji", "veer", first names).
3. LENGTH & STRUCTURE — typical reply length, line breaks, whether they use lists, how they open/close.
4. EMOJI & GREETINGS — which emojis they actually use and how often, greeting and sign-off patterns.

Then add a short list of 5–7 "DO write like this" example replies taken or lightly adapted from the data.

Rules: be specific and grounded in the examples — no generic advice. Keep the whole guide under ~450 words. Output plain text with simple headers (no markdown tables). Do NOT invent fees, phone numbers, or policies; this guide is ONLY about HOW they talk, not what they say.

REPLY PAIRS:
${examplesBlock}`;

    let guide = "";
    try {
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1400,
          messages: [{ role: "user", content: learnPrompt }],
        }),
      });
      const data = await aiRes.json();
      if (!aiRes.ok) {
        return NextResponse.json({ error: "Claude error: " + (data?.error?.message || aiRes.status) }, { status: 502 });
      }
      guide = (data?.content?.[0]?.text || "").trim();
    } catch (e) {
      return NextResponse.json({ error: "Learning failed: " + (e as Error).message }, { status: 500 });
    }

    if (!guide) return NextResponse.json({ error: "Model returned an empty guide." }, { status: 502 });

    const draft = await saveOfficeVoiceDraft(guide, sample.length);
    return NextResponse.json({ ok: true, draft, sampleCount: sample.length });
  }

  return NextResponse.json({ error: "Unknown action. Use 'learn' or 'approve'." }, { status: 400 });
}
