import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listCases } from "@/lib/store";
import { isValidSystemToken } from "@/lib/auth-recovery-token";

const NEWTON_KNOWLEDGE = `
# NEWTON IMMIGRATION — COMPLETE KNOWLEDGE BASE

## COMPANY
Newton Immigration Inc. | RCIC: Navdeep Singh Sandhu (R705964)
Phone: +1 778-723-6662 | Email: newtonimmigration@gmail.com
Address: 8327 120 Street, Delta BC V4C 6R1
Staff: Navdeep (Principal), Serbleen, Manisha, Rapneet, Sukhman, Avneet, Ramandeep, Lavisha, Rajwinder

## ALL APPLICATION TYPES
PGWP, SOWP, BOWP, VOWP, LMIA Work Permit, Study Permit (in/out Canada),
Study Permit Extension, TRV (in/out), Visitor Record, Super Visa,
Spousal Sponsorship (in/out), Express Entry (CEC/FSW/FST), PNP,
Citizenship, PR Card Renewal, Restoration of Status, LMIA

## IRCC FORMS
IMM5710: Worker extension/change | IMM5709: Student extension
IMM5708: Visitor extension | IMM5257: Visitor Visa TRV
IMM0008: Generic PR/Sponsorship | IMM5406: Additional Family Info
IMM5669: Schedule A Background | IMM5562: Travel History | IMM5476: Use of Representative

## FEES (2026 CAD)
Work Permit: $155 | Study Permit: $150 | TRV: $100 | Open WP: $155
PR: $1,050 | Spousal Sponsorship: $1,080+$1,050 | Citizenship: $630
Biometrics: $85 individual / $170 family

## PROCESSING TIMES (2026)
PGWP: 3-5 months | SOWP: 4-6 months | Study Extension: 4-8 weeks
TRV Outside: 4-8 weeks | LMIA Work Permit: 3-5 months
Express Entry CEC: 6 months | Spousal Outside: 12-18 months | Spousal Inside: 12 months

## ELIGIBILITY RULES
PGWP: DLI program 8+ months, apply within 180 days of completion letter, never held PGWP, valid status, length = program length (max 3yr)
SOWP: Sponsor holds PGWP/LMIA WP(1yr+)/Study Permit, married/common-law 12+ months
BOWP: PR applied, current WP expiring, valid status
TRV: Valid passport, sufficient funds, strong ties to home country

## DOCUMENT CHECKLISTS
PGWP: Passport, Completion Letter, Transcripts, Study Permit, IELTS/CELPIP, Digital Photo, IMM5710, IMM5476
SOWP: Both passports, Marriage Certificate, Sponsor WP/SP, Proof of relationship, IMM5710, IMM5476
Study Extension: Passport, Current SP, Enrollment Letter, Transcripts, Financial proof, IMM5709, IMM5476
TRV Outside: Passport, Bank statements (3-6mo), Employment proof, Property docs, Itinerary, IMM5257, IMM5476
LMIA WP: Passport, Positive LMIA, Job Offer Letter, Resume, Education credentials, IMM5710, IMM5476
Spousal Sponsorship: Both passports, Marriage cert, Proof of relationship (photos/communication/joint docs), IMM0008, IMM5406, IMM5669, IMM5562

## COMMON REFUSALS & RESPONSES
TRV: Insufficient ties → property, employment, family docs | Insufficient funds → 3-6mo bank statements
Work Permit: LMIA concerns → additional employer docs | Misrepresentation → LOE + supporting docs
Study Permit: Financial → more bank statements + sponsor letter | Not genuine student → LOE + career plan

## LETTER TYPES NEWTON WRITES
1. Representative Submission Letter | 2. Letter of Explanation (LOE)
3. Cover Letter | 4. Employment Verification Letter | 5. Employer Support Letter
6. Financial Support Letter | 7. Reconsideration Request | 8. LMIA Support Letter

## PROVINCIAL NOMINEE PROGRAMS
BC PNP: Skills Immigration, Express Entry BC, Tech Pilot, Rural Stream
Alberta AAIP: Opportunity Stream, Express Entry Stream, Rural Renewal
Saskatchewan: SINP — International Skilled Worker, Experience
Ontario: OINP — Human Capital, Employer Job Offer
Manitoba: MPNP — Skilled Worker, Business Investor

## EXPRESS ENTRY
Pool based on CRS score | Draws every 2 weeks | Category-based draws: Healthcare, STEM, Trades, French
PNP nomination adds 600 CRS points | French language adds significant points

## NEWTON CRM WORKFLOW
1. New case → WhatsApp intake auto-starts
2. Client answers → saved to case automatically
3. Client sends docs → AI scans, renames, saves to Drive + S3
4. Intake complete → IRCC forms auto-generated
5. Under review → assigned staff notified
6. Submission → Google Sheets updated + WhatsApp to client
7. Daily 8am briefing → team notified of urgent cases + IRCC news
`;

export async function POST(request: NextRequest) {
  try {
    let user = null;
    try { user = await getCurrentUserFromRequest(request); } catch {}
    const bodyRaw = await request.json().catch(() => ({}));
    const systemToken = bodyRaw?.systemToken || request.headers.get("x-system-token");
    if (!user && !isValidSystemToken(systemToken)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!user) user = { name: "Staff", role: "Admin", companyId: process.env.DEFAULT_COMPANY_ID || "newton" } as any;

    const { message, history } = bodyRaw;
    const cases = await listCases((user as any).companyId);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver", weekday: "long", year: "numeric", month: "long", day: "numeric" });

    // Build case list with full details
    const caseList = cases.slice(0, 60).map((c: any) => {
      const intake = (c.pgwpIntake || {}) as any;
      const permitExpiry = intake.studyPermitExpiryDate || intake.workPermitExpiryDate || c.permitExpiryDate || "";
      const daysLeft = permitExpiry ? Math.floor((new Date(permitExpiry).getTime() - Date.now()) / 86400000) : null;
      const passport = intake.passportNumber ? ` | passport: ${intake.passportNumber}` : "";
      const phone = c.leadPhone ? ` | phone: ${c.leadPhone}` : "";
      return `${c.id}: ${c.client} | ${c.formType} | ${c.processingStatus || "docs_pending"} | assigned: ${c.assignedTo || "unassigned"}${c.isUrgent ? " | 🚨URGENT" : ""}${daysLeft !== null ? ` | permit expires: ${daysLeft}d` : ""}${passport}${phone}`;
    }).join("\n");

    // Handle message content — could be string or array (with attachments)
    let messageContent: any = message;

    // Build messages array for API
    const historyMessages = (history || []).slice(-10).map((m: any) => ({
      role: m.role,
      content: m.content
    }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: `You are Newton — the expert AI assistant for Newton Immigration Inc., a RCIC regulated firm in Surrey BC, Canada.

TODAY: ${today}
STAFF: ${(user as any).name} (${(user as any).role})

${NEWTON_KNOWLEDGE}

ACTIVE CASES (${cases.length} total):
${caseList}

YOUR CAPABILITIES:
1. Answer any Canadian immigration question with expert RCIC-level knowledge
2. Search the web for latest IRCC news, policy changes, processing times
3. Analyze cases — flag urgent, expiring permits, missing docs
4. Generate COMPLETE ready-to-use letters (rep letters, LOE, cover letters, employer letters)
5. Draft WhatsApp messages in English AND Punjabi
6. Create document checklists for any application type
7. Check eligibility for any program
8. Read and analyze attached documents (passports, permits, letters)
9. Strategy for refusals and reconsiderations
10. Generate IMM forms guidance

LETTER WRITING:
When asked to write any letter — write the COMPLETE letter, fully formatted, ready to send.
Always include:
- Date (today's date)
- TO: Immigration, Refugees and Citizenship Canada (IRCC)
- RE/Subject line
- Salutation: To Whom It May Concern,
- Full professional body with bold key terms using **bold**
- Newton Immigration signature block:
  Yours sincerely,
  
  Navdeep Singh Sandhu, RCIC (R705964)
  Founder & Principal Consultant
  Newton Immigration Inc.
  📞 +1 778-723-6662
  ✉ newtonimmigration@gmail.com
  📍 8327 120 Street, Delta, BC, V4C 6R1

Never write a partial letter. Always write the complete ready-to-send document.
For rep letters include: legal basis, eligibility checklist, supporting documents, request for consideration.

DOCUMENT ANALYSIS:
When a document is attached — read it carefully and extract all relevant information. Identify document type, key dates, names, numbers. Flag any issues or concerns.

RESPONSE STYLE:
- Be direct, specific, and professional
- For urgent matters use 🚨
- For letters write the COMPLETE document
- Reference actual case data when discussing specific cases
- Search web for current IRCC news when asked
- Write in Punjabi when requested (ਪੰਜਾਬੀ)
- Never say you cannot do something — find a way to help`,
        messages: [
          ...historyMessages,
          { role: "user", content: messageContent }
        ]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Newton AI error:", err);
      return NextResponse.json({ error: "AI service error", details: err }, { status: 500 });
    }

    const data = await res.json() as any;
    // Extract text from response (may include tool use blocks)
    const reply = data.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || "No response generated.";
      
    return NextResponse.json({ reply });
  } catch (e) {
    console.error("Newton AI error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
