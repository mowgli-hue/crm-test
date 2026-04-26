import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const MARKETING_PHONE_ID = process.env.WHATSAPP_MARKETING_PHONE_ID || "1047138985153613";
const WA_TOKEN = process.env.WHATSAPP_TOKEN || "";

// ── Service-specific follow-up templates ──
// Maps service type → { fee, checklist, intro }
const SERVICE_FOLLOWUPS: Record<string, { name: string; fee: string; processingFee?: string; ircc?: string; checklist: string[] }> = {
  "PGWP": {
    name: "Post-Graduation Work Permit (PGWP)",
    fee: "$520 total",
    processingFee: "$265 (Newton)",
    ircc: "$255 (IRCC)",
    checklist: [
      "College Completion Letter",
      "Official Transcripts",
      "Valid Study Permit",
      "Passport (all pages)",
      "Digital Photo (IRCC compliant)",
      "Employment Details / Resume",
      "Language Test (if available)",
    ],
  },
  "Study Permit Extension": {
    name: "Study Permit Extension",
    fee: "$465 total",
    processingFee: "$315 (Newton)",
    ircc: "$150 (IRCC)",
    checklist: [
      "Letter of Acceptance / Confirmation of Enrollment",
      "Current address proof",
      "Provincial Attestation Letter (PAL)",
      "Email & phone",
      "Confirmation letter from school",
      "Tuition fee receipts",
      "Study gap explanation (if any)",
      "Previous refusal letter (if any)",
      "Passport (all pages)",
    ],
  },
  "Study Permit": {
    name: "Study Permit (Outside Canada)",
    fee: "$1,050 + IRCC fees on client card",
    processingFee: "$1,050 (Newton, includes taxes)",
    checklist: [
      "Letter of Acceptance from DLI",
      "Provincial Attestation Letter (PAL)",
      "Proof of Funds (bank statements)",
      "Education documents (transcripts, certificates)",
      "IELTS / Language test results",
      "Passport (all pages)",
      "Digital Photo (IRCC compliant)",
      "Statement of Purpose",
    ],
  },
  "SOWP": {
    name: "Spousal Open Work Permit",
    fee: "Inside Canada: $1,260 (excl. IRCC) / Outside: $1,575 (excl. IRCC)",
    checklist: [
      "Passport (both spouses)",
      "Marriage Certificate",
      "Principal applicant's Work/Study Permit",
      "Bank Balance Certificate",
      "Address Proof",
      "If Student: Enrollment letter, Transcripts, Fees payment proof",
      "If Worker: Employment letter + duties, 3 paystubs, NOA 2022",
    ],
  },
  "Visitor Visa": {
    name: "Visitor Visa (TRV)",
    fee: "$710 total",
    processingFee: "$525 (Newton)",
    ircc: "$185 (IRCC)",
    checklist: [
      "Passport (all pages)",
      "Bank statements (last 6 months)",
      "Family information",
      "Travel history",
      "Employment details / Job letter",
      "Education details",
      "Invitation Letter (if visiting family)",
      "Sponsor's documents (if invited): Passport/PR, NOA, Job letter, Bank statement",
    ],
  },
  "TRV Inside": {
    name: "TRV (Inside Canada)",
    fee: "$415 total",
    processingFee: "$315 (Newton)",
    ircc: "$100 (Embassy)",
    checklist: [
      "Passport (all pages)",
      "Current Permit / Status Document",
      "Current address",
      "Digital photo",
      "Marital status documents",
    ],
  },
  "Visitor Record": {
    name: "Visitor Record",
    fee: "$415 total",
    processingFee: "$315 (Newton)",
    ircc: "$100 (IRCC)",
    checklist: [
      "Passport (all pages)",
      "Digital photo",
      "Current address",
      "Marital status",
      "Education history",
      "Employment history",
      "Refusal history (if any)",
    ],
  },
  "Super Visa": {
    name: "Super Visa",
    fee: "$1,050 + IRCC $185 per applicant",
    checklist: [
      "Sponsor: Canadian Passport / PR Card, Proof of Relationship, NOA, Job letter, Bank balance, Marriage cert, Medical insurance (1 yr)",
      "Applicant: Passport, Vaccination cert, Digital photo, Bank docs, Upfront medical, Job letter, Marriage cert, ITR (2 yrs), Property valuation",
    ],
  },
  "Spousal Sponsorship": {
    name: "Spousal Sponsorship",
    fee: "Inside Canada: $2,100 / Outside: $3,000 + taxes",
    checklist: [
      "Sponsor: Passport, PR Card / Canadian Passport, Job documents, NOA, Education, Proof of relationship, Financial docs",
      "Applicant: Passport, Permit, Education docs, Travel history, Medical, Police certificates",
      "Joint: Marriage certificate, Photos together, Communication history, Joint financial documents",
    ],
  },
  "Express Entry": {
    name: "Express Entry",
    fee: "Profile: $525 / After ITA: $2,000 / Final stage: $500",
    checklist: [
      "Passport",
      "IELTS / CELPIP test results",
      "Education documents (ECA / WES)",
      "Employment details (reference letters, NOC code)",
      "Spouse details (if applicable)",
      "Work experience proof (paystubs, T4s)",
    ],
  },
  "PR": {
    name: "Permanent Residence",
    fee: "Varies by program — consultation recommended",
    checklist: [
      "Passport",
      "Education documents",
      "Work experience proof",
      "IELTS / Language test",
      "Police clearance certificates (all countries lived in)",
      "Medical exam",
      "Photos (IRCC compliant)",
    ],
  },
  "PR Card Renewal": {
    name: "PR Card Renewal",
    fee: "$525 per applicant",
    checklist: [
      "Passport (all pages)",
      "Current PR Card (front and back)",
      "Travel history (last 5 years)",
      "Canadian education documents (if applicable)",
      "Recent address proof",
    ],
  },
  "Citizenship": {
    name: "Canadian Citizenship",
    fee: "$1,050 (Newton, incl. taxes)",
    checklist: [
      "Passport (all pages)",
      "PR Card",
      "Digital photo",
      "Police Certificate",
      "English / French proficiency proof",
      "Travel history",
    ],
  },
  "LMIA Work Permit": {
    name: "LMIA Work Permit",
    fee: "With LMIA: $1,260 / With all employer docs: $840",
    checklist: [
      "Passport",
      "LMIA copy",
      "Job offer letter",
      "Recent paystubs",
      "Employment contract",
      "Current Work Permit (if any)",
    ],
  },
  "Consultation": {
    name: "Consultation",
    fee: "$52.50 (incl. taxes) — 15 min",
    checklist: [],
  },
};

const NEWTON_FOOTER = `
*Payment via Interac e-transfer:*
newtonimmigration@gmail.com

*Send your documents to our processing team:*
WhatsApp: +1 604-779-5700

— Newton Immigration Team 🍁`;

async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  const cleanPhone = phone.replace(/\D/g, "");
  if (!cleanPhone) return false;

  const res = await fetch(`https://graph.facebook.com/v18.0/${MARKETING_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: cleanPhone,
      type: "text",
      text: { body: message },
    }),
  });

  if (res.ok) {
    // Save to inbox so staff sees what was sent
    try {
      const id = `mkt-followup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await pool.query(
        `INSERT INTO marketing_inbox (id, phone, message, direction, is_read, created_at)
         VALUES ($1, $2, $3, 'outbound', TRUE, NOW())`,
        [id, phone, message]
      );
    } catch (e) { /* table might not exist yet, fine */ }
    return true;
  }

  const errText = await res.text().catch(() => "");
  console.error("WA send failed:", res.status, errText);
  return false;
}

// POST /api/call-followup
// Body: {
//   phone: string,           // recipient phone
//   service: string,         // service type key (e.g. "PGWP")
//   mode: "checklist" | "fee_only",
//   callId?: string,         // call_log ID to link this followup to
//   personalNote?: string,   // optional personalized note from staff (added at top)
// }
export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { phone, service, mode = "checklist", callId, personalNote } = body;

  if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 });
  if (!service) return NextResponse.json({ error: "service is required" }, { status: 400 });

  const followup = SERVICE_FOLLOWUPS[service];
  if (!followup) {
    return NextResponse.json({ error: `Unknown service '${service}'. Available: ${Object.keys(SERVICE_FOLLOWUPS).join(", ")}` }, { status: 400 });
  }

  // Build the message
  const lines: string[] = [];

  if (personalNote && String(personalNote).trim()) {
    lines.push(String(personalNote).trim());
    lines.push("");
  } else {
    lines.push(`Hi! 🍁 Thank you for calling Newton Immigration today.`);
    lines.push("");
  }

  lines.push(`*${followup.name}*`);
  lines.push("");
  lines.push(`💰 *Total Fee:* ${followup.fee}`);
  if (followup.processingFee) lines.push(`   • Processing: ${followup.processingFee}`);
  if (followup.ircc) lines.push(`   • Government: ${followup.ircc}`);
  lines.push("");

  if (mode === "checklist" && followup.checklist.length > 0) {
    lines.push(`📋 *Document Checklist:*`);
    followup.checklist.forEach((item, i) => {
      lines.push(`${i + 1}. ${item}`);
    });
    lines.push("");
  }

  lines.push(NEWTON_FOOTER.trim());

  const message = lines.join("\n");
  const sent = await sendWhatsApp(phone, message);

  if (!sent) {
    return NextResponse.json({ error: "Failed to send WhatsApp message" }, { status: 500 });
  }

  // Update call_log entry to mark followup sent
  if (callId) {
    try {
      await pool.query(
        `UPDATE call_log
         SET notes = COALESCE(notes, '') ||
             CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n\n' END ||
             $1,
             outcome = CASE WHEN outcome IS NULL OR outcome = 'no_answer' THEN $2 ELSE outcome END,
             service_interest = COALESCE(service_interest, $3),
             updated_at = NOW()
         WHERE id = $4`,
        [
          `📲 Sent ${mode === "checklist" ? "checklist + fee" : "fee quote"} for ${followup.name} via WhatsApp`,
          mode === "checklist" ? "info_provided" : "fee_quoted",
          service,
          callId,
        ]
      );
    } catch (e) { /* non-fatal */ }
  }

  // Update marketing lead
  try {
    await pool.query(
      `UPDATE marketing_leads
       SET service_interest = COALESCE(service_interest, $2),
           stage = CASE WHEN stage IN ('new', 'contacted') THEN 'contacted' ELSE stage END,
           updated_at = NOW()
       WHERE phone = $1`,
      [phone, service]
    );
  } catch (e) { /* non-fatal */ }

  return NextResponse.json({ ok: true, message, sent: true });
}

// GET /api/call-followup?services=1 — list available service types
export async function GET() {
  const services = Object.entries(SERVICE_FOLLOWUPS).map(([key, val]) => ({
    key,
    name: val.name,
    fee: val.fee,
    hasChecklist: val.checklist.length > 0,
  }));
  return NextResponse.json({ services });
}
