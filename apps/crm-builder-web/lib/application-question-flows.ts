import { resolveApplicationChecklistKey } from "@/lib/application-checklists";

export type IntakeRecord = Record<string, string>;

type ChecklistKey = ReturnType<typeof resolveApplicationChecklistKey>;

type QuestionFlow = {
  prompts: string[];
  requiredFields: string[];
  batches?: Array<{ title: string; questions: number[] }>; // indices into prompts
};

const DEFAULT_REQUIRED_FIELDS = [
  "fullName", "phone", "maritalStatus", "address",
  "travelHistorySixMonths", "nativeLanguage", "englishTestTaken",
  "originalEntryDate", "originalEntryPlacePurpose",
  "employmentHistory", "education", "refusedAnyCountry",
  "criminalHistory", "medicalHistory"
];

const QUESTION_FLOWS: Record<ChecklistKey, QuestionFlow> = {
  pgwp: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    batches: [
      { title: "👤 Personal Info", questions: [0, 1, 2, 3] },
      { title: "🏠 Address & Contact", questions: [4, 5, 6] },
      { title: "🛬 Entry to Canada", questions: [7, 8, 9] },
      { title: "💼 Work & Education", questions: [13, 14, 15] },
      { title: "🌐 Language & Background", questions: [10, 11, 12, 16, 17, 18] },
    ],
    prompts: [
      "Have you used any other name? (Yes/No — if Yes, provide full other name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: provide partner's full name and date of marriage (YYYY-MM-DD). Reply NA if not applicable.",
      "Any previous marriage or common-law partnership? (Yes/No — if Yes: partner's name, date of birth, start and end date of relationship YYYY-MM-DD)",
      "Current mailing address including postal code (Apt/Unit, Street Number, Street Name, City, Province, Postal Code)",
      "Residential address if different from mailing address. Reply SAME if same.",
      "Telephone number",
      "Date and place you first entered Canada (YYYY-MM-DD, city/airport e.g. 2019-09-01, Toronto Pearson)",
      "Purpose of your original visit to Canada (Study / Work / Visit)",
      "Any recent entry to Canada? (Yes/No — if Yes: provide date YYYY-MM-DD and reason)",
      "Have you ever been refused a visa or permit, denied entry, or ordered to leave Canada or any other country? (Yes/No — if Yes: provide details)",
      "Do you have any medical history? (Yes/No — if Yes: provide details)",
      "Do you have any criminal history? (Yes/No — if Yes: provide details)",
      "Employment details — list ALL jobs including foreign experience, most recent first. For each: From (YYYY-MM), To (YYYY-MM), Job Title, Employer Name, City, Country. Include any work done outside Canada. Reply NONE if no employment.",
      "Education after 12th grade (if any). For each: From (YYYY-MM), To (YYYY-MM), Field of Study, Name of Institute, City. Reply NONE if none.",
      "Have you been at the same college/institution since you arrived in Canada? (Yes/No — if No, please share documents from your previous college(s) under Documents — completion letter, transcripts, LOA — so we can include them in your application)",
      "What is your native language?",
      "Have you taken an English language proficiency test? (Yes/No — if Yes: test name and date. We'll get the actual score from the result document you upload — no need to type it.)",
      "Do you plan to work in the medical field in Canada in the future (e.g. nurse, healthcare worker, doctor, in a hospital or clinic)? (Yes/No — if Yes, you'll likely need an Immigration Medical Exam (IME) before submission. We'll guide you on booking it after your application is reviewed.)"
    ]
  },

  work_permit: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    batches: [
      { title: "👤 Personal Info", questions: [0, 1, 2, 3] },
      { title: "🏠 Address & Contact", questions: [4, 5, 6] },
      { title: "🛬 Entry to Canada", questions: [7, 8, 9] },
      { title: "💼 Work & Education", questions: [13, 14] },
      { title: "🌐 Language & Background", questions: [10, 11, 12, 15, 16, 17] },
    ],
    prompts: [
      "Have you used any other name? (Yes/No — if Yes, provide full other name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: provide partner's full name and date of marriage (YYYY-MM-DD). Reply NA if not applicable.",
      "Any previous marriage or common-law partnership? (Yes/No — if Yes: partner's name, date of birth, start and end date of relationship YYYY-MM-DD)",
      "Current mailing address including postal code (Apt/Unit, Street Number, Street Name, City, Province, Postal Code)",
      "Residential address if different from mailing address. Reply SAME if same.",
      "Telephone number",
      "Date and place you first entered Canada (YYYY-MM-DD, city/airport)",
      "Purpose of your original visit to Canada (Study / Work / Visit)",
      "Any recent entry to Canada? (Yes/No — if Yes: provide date YYYY-MM-DD and reason)",
      "Have you ever been refused a visa or permit, denied entry, or ordered to leave Canada or any other country? (Yes/No — if Yes: provide details)",
      "Do you have any medical history? (Yes/No — if Yes: provide details)",
      "Do you have any criminal history? (Yes/No — if Yes: provide details)",
      "Employment details — list ALL jobs including foreign experience, most recent first. For each: From (YYYY-MM), To (YYYY-MM), Job Title, Employer Name, City, Country. Include any work done outside Canada. Reply NONE if no employment.",
      "Education after 12th grade (if any). For each: From (YYYY-MM), To (YYYY-MM), Field of Study, Name of Institute, City. Reply NONE if none.",
      "What is your native language?",
      "Have you taken an English language proficiency test? (Yes/No — if Yes: test name, score, and date)",
      "Do you plan to work in the medical field in Canada in the future? (Yes/No)"
    ]
  },

  // SOWP — Spousal Open Work Permit. SPOUSE is the applicant; principal
  // worker / student / PGWP holder is the SPONSORING partner. Most refused
  // because principal doesn't qualify (TEER 4/5 worker, bachelor student,
  // final-term student) or marriage evidence is weak.
  // 16 questions in 6 batches.
  sowp: {
    requiredFields: ["fullName", "phone", "address", "maritalStatus", "employmentHistory", "education"],
    batches: [
      { title: "📤 Upload Documents", questions: [0] },
      { title: "👤 Your Info (Applicant)", questions: [1, 2, 3, 4, 5] },
      { title: "💍 Marriage / Common-Law", questions: [6, 7, 8] },
      { title: "👫 Principal Partner (sponsoring spouse)", questions: [9, 10, 11, 12] },
      { title: "🛬 Status in Canada", questions: [13, 14] },
      { title: "📋 Background", questions: [15] },
    ],
    prompts: [
      // Q0 — Documents needed
      "📎 *Please upload these documents first* (one by one is fine):\n\n• Your passport (bio page + all stamped pages)\n• Your current Canadian permit (if you have one)\n• Marriage certificate (or proof of 12-month cohabitation if common-law)\n• Your spouse's current work permit / study permit / PGWP\n• Your spouse's employment letter (with NOC, duties, salary, hours, start date)\n• Your spouse's recent pay stubs (last 3 months)\n• Photos of you both together, joint bank accounts, joint lease, etc.\n\nReply *DONE* once you've sent them. We'll extract personal details from your passport.",

      // Q1 — Full legal name
      "Your *full legal name* (exactly as on passport).",

      // Q2 — DOB
      "Your date of birth (YYYY-MM-DD).",

      // Q3 — Citizenship + place of birth
      "Your country of citizenship and place of birth (city, country).",

      // Q4 — Current address in Canada
      "Your current address (street, city, province, postal code) and phone number.",

      // Q5 — Email
      "Your email address.",

      // Q6 — Marriage / common-law type and date
      "Are you legally married OR in a common-law relationship? (Married / Common-Law)\n\n• If MARRIED: date of marriage (YYYY-MM-DD), city/country where married\n• If COMMON-LAW: date you started living together (YYYY-MM-DD), and current cohabitation address (must show 12+ months continuous cohabitation)",

      // Q7 — Spouse / partner basics
      "Your spouse / partner's full name, date of birth (YYYY-MM-DD), country of citizenship, and current location (city, country).",

      // Q8 — Any previous marriages
      "Have you OR your spouse been married or in a common-law relationship before? (Yes/No — if Yes: who, partner's name, dates, how it ended)",

      // Q9 — Principal eligibility path (CRITICAL — determines if SOWP even possible)
      "What is your spouse's current status in Canada? Pick ONE:\n\n*A — Foreign Worker* (working on a closed/employer-specific work permit, NOT PGWP)\n*B — International Student* (study permit, currently studying)\n*C — PGWP Holder* (post-graduation work permit)\n*D — Other* (PR, citizen, refugee, visitor, etc. — note: PR/citizen spouses go through Spousal SPONSORSHIP not SOWP)\n\nReply with the letter. We'll ask follow-up questions based on your choice.",

      // Q10 — Principal's job / school details (the BIG eligibility question)
      "Your spouse's *current employment or studies* details. Provide ALL that apply:\n\n*If working (paths A or C):*\n• Employer name + address\n• Job title + actual day-to-day duties (IMPORTANT: duties matter more than title for NOC)\n• NOC code if known (TEER 0 / 1 / 2 / 3 / 4 / 5)\n• Salary + hours per week\n• Permit start date and END date (YYYY-MM-DD)\n\n*If studying (path B):*\n• School name + DLI number\n• Program name (master's? doctoral? bachelor's? diploma?)\n• Program length (must be 16+ months for master's to qualify)\n• Current term (NOT final term — refused even on renewal as of March 4 2026)\n• Program start and end dates (YYYY-MM-DD)",

      // Q11 — Principal lives in Canada
      "Does your spouse currently *physically live in Canada*? (Yes/No — if living separately, give the city/province where they live)",

      // Q12 — Months remaining on principal's permit
      "How many months of valid work/study authorization does your spouse have remaining? (For SOWP, IRCC requires AT LEAST 16 MONTHS remaining at the time of your SOWP application — fewer = refused.)",

      // Q13 — Applicant's current status in Canada
      "Are you currently *inside Canada* or *outside Canada*?\n\n• If INSIDE: your current status (visitor record / work permit / study permit / no status / maintained status), permit number + expiry, and where you live\n• If OUTSIDE: country where you currently live, and when you plan to come to Canada",

      // Q14 — Restoration check
      "If you're inside Canada AND your current status has expired or expires soon: when did/will it expire? (YYYY-MM-DD — restoration only available within 90 days of expiry, $350 fee. Reply NA if your status is fine or you're outside Canada.)",

      // Q15 — Refusals + criminal + medical
      "Have you ever:\n• Been refused a visa, permit, or status by Canada or any country?\n• Been arrested, charged, or convicted of any crime?\n• Had any serious medical conditions in the past 12 months?\n\n(Yes/No for each — if Yes, give brief details: country, year, what happened)",
    ]
  },

  study_permit: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    batches: [
      { title: "👤 Personal Info", questions: [0, 1, 2, 3] },
      { title: "🏠 Address & Contact", questions: [4, 5, 6] },
      { title: "🎓 Study Details", questions: [7, 8, 9, 10] },
      { title: "💰 Funding & Sponsor", questions: [11, 12, 13] },
      { title: "📋 Background", questions: [14, 15, 16, 17] },
    ],
    prompts: [
      "Have you used any other name? (Yes/No — if Yes, provide full other name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: provide partner's full name and date of marriage (YYYY-MM-DD). Reply NA if not applicable.",
      "Any previous marriage or common-law partnership? (Yes/No — if Yes: partner's name, DOB, start and end date YYYY-MM-DD)",
      "Current mailing address including postal code (Apt/Unit, Street Number, Street Name, City, Province, Postal Code)",
      "Residential address if different from mailing address. Reply SAME if same.",
      "Telephone number",
      "Date and place you first entered Canada (YYYY-MM-DD, city/airport). If applying from outside Canada reply OUTSIDE.",
      "Name and address of the institution you plan to attend in Canada",
      "Program of study and expected start date (YYYY-MM-DD) and end date (YYYY-MM-DD)",
      "Highest education completed (school name, field, country, from/to dates YYYY-MM)",
      "How are you funding your studies? (Savings / Sponsor / Scholarship / Loan — provide amount available in CAD)",
      "Who is your financial sponsor? (Name, relationship, occupation, country of residence). Reply SELF if self-funded.",
      "Have you ever studied in Canada before? (Yes/No — if Yes: institution, program, permit expiry date)",
      "Have you ever been refused a visa or permit for Canada or any other country? (Yes/No — if Yes: country, year, reason)",
      "Do you have any medical history? (Yes/No — if Yes: provide details)",
      "Do you have any criminal history? (Yes/No — if Yes: provide details)",
      "What is your native language? Have you taken an English proficiency test? (Yes/No — if Yes: test name, score, date)"
    ]
  },

  study_permit_extension: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    batches: [
      { title: "📤 Upload Documents", questions: [0] },
      { title: "👤 Personal Info", questions: [1, 2, 3, 4] },
      { title: "🏠 Address & Contact", questions: [5, 6] },
      { title: "🎓 School Continuity", questions: [7, 8] },
      { title: "💰 Funds & Reason", questions: [9, 10, 11, 12] },
      { title: "🛬 Entry & History", questions: [13, 14, 15, 16] },
      { title: "📋 Background", questions: [17, 18, 19, 20, 21] },
    ],
    prompts: [
      // Q0 — Upload prompt. OCR fills: identity (passport), permit#+UCI+permit
      // expiry (current study permit), school+DLI+program+dates+tuition (LOA),
      // PAL number+expiry (PAL doc). Saves the client typing 12+ fields.
      "📎 Please send photos of: (1) your passport bio page, (2) your current Canadian study permit, (3) your Letter of Acceptance (LOA) from your school, (4) your Provincial Attestation Letter (PAL) if you have one (most students need it — graduate students don't), (5) proof of funds (bank letter / GIC / sponsorship). Reply 'done' once uploaded. (We'll auto-fill your name, passport, permit, school, and program details from these documents.)",
      // Q1 — Alias (cannot be OCR'd, must ask)
      "Have you used any other name (alias, maiden name, nickname on documents)? (Yes/No — if Yes, provide full other name)",
      // Q2 — Marital
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      // Q3 — Spouse details (only if married/common-law)
      "If Married or Common-Law: spouse full name, DOB (YYYY-MM-DD), citizenship, date of marriage (YYYY-MM-DD), and is your spouse currently in Canada? (Yes/No — if Yes: their immigration status). Reply NA if not applicable.",
      // Q4 — Previously married
      "Have you been previously married or in a common-law partnership? (Yes/No — if Yes: previous partner's name, DOB, relationship type Married/Common-Law, start and end dates YYYY-MM-DD)",
      // Q5 — Mailing address
      "Current mailing address in Canada (Apt/Unit, Street Number, Street Name, City, Province, Postal Code)",
      // Q6 — Phone + email
      "Telephone number and email address",
      // Q7 — Same college? (drives PAL exemption logic)
      "Have you been at the same college since your last study permit? (Yes/No — if you've changed colleges, share OLD school documents in the upload too — old completion letter, transcripts, LOAs)",
      // Q8 — Canada history if changed schools
      "If you changed colleges: please explain what you have been doing in Canada from when you arrived until now (which schools, what programs, dates, and why you changed). Reply NA if you've stayed at the same college.",
      // Q9 — Reason for extension
      "Reason for extension — are you continuing the same program, or starting a new program? Provide details on why you need the extension.",
      // Q10 — Graduate program (drives PAL exemption)
      "Are you currently in a Master's, PhD, or other graduate-level program? (Yes/No — graduate students are PAL-exempt)",
      // Q11 — Funds (total + source + breakdown)
      "How will you fund your studies and stay in Canada? Provide: (a) Total funds available in CAD, (b) Source — Self / Parents / Sponsor / Scholarship / GIC / Other, (c) Estimated room & board cost per year (CAD), (d) Other expected costs per year (textbooks, travel, etc., in CAD)",
      // Q12 — Co-op or open work permit alongside study
      "Are you also applying for a Co-op Work Permit or Open Work Permit alongside this study permit? (Yes/No — if Yes: which type — Co-op / Open / Post Graduation)",
      // Q13 — Original entry to Canada
      "When did you first enter Canada and what was the original purpose? (provide: date YYYY-MM-DD, city/airport of entry, purpose — Study / Work / Visit / Other)",
      // Q14 — Past education
      "Past education before your current Canadian study (most recent before this) — provide: From (YYYY-MM), To (YYYY-MM), Field of Study, Name of School, City, Country. Reply NONE if you came right after high school.",
      // Q15 — Employment
      "Employment history — list jobs (Canadian or foreign), most recent first, up to 3 entries. For each: From (YYYY-MM), To (YYYY-MM or 'present'), Job Title, Employer Name, City, Country. Reply NONE if you have not worked.",
      // Q16 — Travel history
      "Travel history last 5 years — for each trip outside Canada: country, from (YYYY-MM), to (YYYY-MM), purpose. Reply NONE if no travel.",
      // Q17 — Full-time enrollment
      "Have you maintained full-time enrollment throughout your studies in Canada so far? (Yes/No — if No: explain any breaks or part-time periods)",
      // Q18 — Refusals
      "Have you ever been refused a visa or permit by Canada or any other country? (Yes/No — if Yes: country, year, reason)",
      // Q19 — Criminal/medical
      "Do you have any criminal history or medical conditions? (Yes/No for each — if Yes: provide details)",
      // Q20 — Background (military/govt/ill)
      "Background — please answer Yes/No for each: (a) Have you served in any military, militia, or armed group? (b) Have you held a government or political position? (c) Have you witnessed war crimes, genocide, or ill treatment? — if Yes to any: provide details",
      // Q21 — Native language
      "Native language and can you communicate in English or French? (English / French / Both / Neither). Have you taken an English language test? (Yes/No — no need to provide score, we'll get it from the doc you upload if applicable)"
    ]
  },

  visitor_visa: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    batches: [
      { title: "📤 Upload Documents", questions: [0] },
      { title: "👤 Personal Info", questions: [1] },
      { title: "💍 Marital & Residence", questions: [2, 3, 4, 5, 6] },
      { title: "✈️ Visit Details", questions: [7, 8, 9, 10] },
      { title: "💼 Education & Employment", questions: [11, 12] },
      { title: "🌍 Travel & Background", questions: [13, 14, 15, 16, 17, 18] },
    ],
    prompts: [
      // Q0: Upload prompt — bot will OCR these to fill name, DOB, gender, birthplace,
      // citizenship, passport details, UCI. No need for client to type any of these.
      "📎 Please send photos of: (1) your passport bio page, (2) your current Canadian permit if you have one (study/work). Reply 'done' once uploaded. (We'll auto-fill your name, date of birth, passport, and other details from these documents.)",
      // Q1: Alias — can't be OCR'd
      "Have you ever used another name (alias, maiden name, nickname on documents)? (Yes/No — if Yes: provide the other name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: spouse full name, DOB, citizenship, and date of marriage (YYYY-MM-DD). Reply NA if not applicable.",
      "Have you been previously married or in a common-law partnership? (Yes/No — if Yes: previous partner's full name, DOB, relationship type, start and end dates YYYY-MM-DD)",
      "Current country of residence and your immigration status there (Citizen / PR / Worker / Student / Visitor) — also when did this status start? (YYYY-MM-DD) and when does it expire? (YYYY-MM-DD or 'permanent')",
      "Any other countries you have lived in last 5 years? For each: country, status, from date, to date. Reply NONE if none.",
      "Current home address (Street, City, Province/State, Postal Code, Country) and phone number with country code, and email",
      "Purpose of visit to Canada (Tourism / Visit family / Business / Conference — provide full details)",
      "Planned travel dates — arriving Canada (YYYY-MM-DD) and leaving Canada (YYYY-MM-DD)",
      "Contact(s) in Canada — for each contact: full name, relationship to you, address, phone, and email. Up to 2 contacts. Reply NONE if no contacts in Canada.",
      "How much money do you have available for this trip in CAD? Will funds be shared with anyone? (Yes/No)",
      "Education history — for each: school name, country, field of study, from/to dates (YYYY-MM)",
      "Employment history (no gaps since age 18) — for each: from (YYYY-MM), to (YYYY-MM or present), job title, employer, city, country",
      "Travel history last 5 years — for each trip: country visited, from (YYYY-MM), to (YYYY-MM), purpose. Reply NONE if no travel.",
      "Have you ever overstayed a visa, been refused entry, or been deported from any country? (Yes/No — if Yes: details)",
      "Have you ever been refused a Canadian visa or permit? (Yes/No — if Yes: details)",
      "Do you have any criminal history or medical conditions? (Yes/No for each — if Yes: provide details)",
      "Background — please answer Yes/No for each: (a) Have you served in any military, militia, or armed group? (b) Have you held a government or political position? (c) Have you witnessed war crimes, genocide, or ill treatment? — if Yes to any: provide details",
      "Native language and can you communicate in English or French? (English / French / Both / Neither)"
    ]
  },

  visitor_record: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    batches: [
      { title: "👤 Personal Info", questions: [0, 1, 2, 3, 4] },
      { title: "📋 Status & Application", questions: [5, 6, 7, 8] },
      { title: "💰 Funds & Contacts", questions: [9, 10, 11, 12] },
      { title: "📋 Background", questions: [13, 14, 15, 16] },
    ],
    prompts: [
      "Have you used any other name? (Yes/No — if Yes, provide full other name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: provide partner's full name and date of marriage (YYYY-MM-DD). Reply NA if not applicable.",
      "Current mailing address in Canada including postal code (Apt/Unit, Street Number, Street Name, City, Province, Postal Code)",
      "Telephone number",
      "What is your current immigration status in Canada? (Visitor / Student / Worker) and what is your status expiry date? (YYYY-MM-DD)",
      "What are you applying for? (Extend my stay as a visitor / Restore my status as a visitor)",
      "What is the purpose of your visit to Canada? (Tourism / Visiting family / Business / Other — provide details)",
      "What date does your visit start? (YYYY-MM-DD) and when do you plan to leave Canada? (YYYY-MM-DD)",
      "How much money do you have available for your stay in Canada? (amount in CAD)",
      "Who will pay your expenses in Canada? (Myself / Parents / Other — if Other: provide name and relationship)",
      "Will you be visiting anyone in Canada? (Yes/No — if Yes: their full name, relationship, and address in Canada)",
      "Date and place you first entered Canada (YYYY-MM-DD, city/port of entry)",
      "Have you ever been refused a visa or permit for Canada or any other country? (Yes/No — if Yes: country, year, reason)",
      "Do you have any medical history that may affect your stay? (Yes/No — if Yes: provide details)",
      "Do you have any criminal history? (Yes/No — if Yes: provide details)",
      "What is your native language? Can you communicate in English or French? (Yes/No)"
    ]
  },

  trv_inside: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    batches: [
      { title: "📤 Upload Documents", questions: [0] },
      { title: "👤 Personal Info", questions: [1, 2, 3, 4, 5, 6] },
      { title: "📋 Status & Visit", questions: [7, 8, 9, 10, 11, 12] },
      { title: "💰 Funds & Entry", questions: [13, 14, 15] },
      { title: "📋 Background", questions: [16, 17, 18, 19, 20] },
    ],
    prompts: [
      // Q0: Upload prompt — OCR fills name, DOB, gender, birthplace, citizenship,
      // passport, and current permit details + UCI. Saves the client typing.
      "📎 Please send photos of: (1) your passport bio page, (2) your current Canadian permit (study/work). Reply 'done' once uploaded. (We'll auto-fill your name, date of birth, passport, and permit details from these documents.)",
      "Have you used any other name (alias, maiden name, nickname on documents)? (Yes/No — if Yes, provide full other name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: provide partner's full name, DOB, citizenship, and date of marriage (YYYY-MM-DD). Reply NA if not applicable.",
      "Have you been previously married or in a common-law partnership? (Yes/No — if Yes: previous partner's name, DOB, relationship type, start and end dates YYYY-MM-DD)",
      "Current mailing address in Canada including postal code (Apt/Unit, Street Number, Street Name, City, Province, Postal Code)",
      "Telephone number and email",
      "What is your current immigration status in Canada and expiry date? (e.g. Study Permit — expires YYYY-MM-DD)",
      "What country do you currently have status in (other than Canada) and what is your immigration status there? (e.g. India — Citizen)",
      "What is the purpose of your travel outside Canada? (Tourism / Visit family / Business / Other — provide details)",
      "What are your planned travel dates — leaving Canada (YYYY-MM-DD) and returning to Canada (YYYY-MM-DD)?",
      "Which countries do you plan to visit?",
      "Address in Canada where you will return to (full address including postal code)",
      "How much money do you have available for your trip? (amount in CAD)",
      "Who will pay your expenses? (Myself / Parents / Other — if Other: name and relationship)",
      "Date and place you first entered Canada (YYYY-MM-DD, city/port of entry)",
      "Have you ever been refused a visa or permit for Canada or any other country? (Yes/No — if Yes: country, year, reason)",
      "Do you have any medical history? (Yes/No — if Yes: provide details)",
      "Do you have any criminal history? (Yes/No — if Yes: provide details)",
      "Background — please answer Yes/No for each: (a) Have you served in any military, militia, or armed group? (b) Have you held a government or political position? (c) Have you witnessed war crimes, genocide, or ill treatment? — if Yes to any: provide details",
      "What is your native language? Can you communicate in English or French? (English / French / Both / Neither)"
    ]
  },

  super_visa: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    batches: [
      { title: "👤 Personal Info", questions: [0, 1, 2, 3, 4] },
      { title: "🇨🇦 Sponsor Details", questions: [5, 6, 7, 8] },
      { title: "✈️ Visit & Family", questions: [9, 10, 11] },
      { title: "📋 Background", questions: [12, 13, 14] },
    ],
    prompts: [
      "Have you used any other name? (Yes/No — if Yes, provide full other name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married: provide spouse full name, DOB, and citizenship. Reply NA if not applicable.",
      "Current address in your home country (full address)",
      "Telephone number",
      "Sponsor full name and relationship to you (son/daughter/etc.)",
      "Sponsor address in Canada (full address including postal code)",
      "Sponsor immigration status in Canada (Canadian Citizen / Permanent Resident) and document number",
      "Sponsor occupation, employer name, and annual income in CAD",
      "Date you plan to enter Canada (YYYY-MM-DD) and expected length of stay",
      "List your children (name, DOB, relationship, country of residence for each). Reply NONE if no children.",
      "Do you have medical insurance arranged? (Yes/No — if Yes: insurance company name and coverage amount in CAD)",
      "Have you ever been refused a visa or permit for Canada or any other country? (Yes/No — if Yes: details)",
      "Do you have any medical history? (Yes/No — if Yes: provide details)",
      "Do you have any criminal history? (Yes/No — if Yes: provide details)"
    ]
  },

  express_entry: {
    requiredFields: ["fullName", "phone", "maritalStatus", "address", "nativeLanguage", "englishTestTaken", "employmentHistory", "education", "refusedAnyCountry", "criminalHistory", "medicalHistory"],
    batches: [
      { title: "👤 Personal Info", questions: [0, 1, 2, 3] },
      { title: "💼 Work Experience", questions: [4, 5] },
      { title: "🎓 Education & Language", questions: [6, 7, 8] },
      { title: "🇨🇦 Job Offer & Funds", questions: [9, 10, 11] },
      { title: "📋 Background", questions: [12, 13] },
    ],
    prompts: [
      "Have you used any other name? (Yes/No — if Yes, provide full name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: spouse full name, DOB, citizenship, education level, occupation. Reply NA if not applicable.",
      "Current address (full address with postal code) and phone number",
      "Primary job title and NOC code (if known). How many years of skilled work experience?",
      "List all skilled work experience — for each: From (YYYY-MM), To (YYYY-MM), Job Title, NOC code, Employer, City, Country, Hours/week",
      "Highest education — institution name, field of study, country, from/to dates. Do you have an ECA? (Yes/No — if Yes: organization e.g. WES)",
      "Language test — test name (IELTS/CELPIP/TEF), scores for Reading/Writing/Listening/Speaking, test date (YYYY-MM-DD)",
      "Spouse language test results if applicable — same format. Reply NA if not applicable.",
      "Do you have a provincial nomination? (Yes/No — if Yes: province and program)",
      "Do you have a Canadian job offer? (Yes/No — if Yes: employer, NOC, LMIA if applicable)",
      "Settlement funds available in CAD",
      "Have you ever been refused a visa or permit for Canada or any other country? (Yes/No — if Yes: details)",
      "Any medical or criminal history? (Yes/No for each — if Yes: details)"
    ]
  },

  express_entry_pr: {
    requiredFields: ["fullName", "phone", "maritalStatus", "address", "nativeLanguage", "englishTestTaken", "employmentHistory", "education"],
    batches: [
      { title: "👤 Personal Info", questions: [0, 1, 2, 3] },
      { title: "🏠 Address & Sibling", questions: [4, 5, 6] },
      { title: "🎓 Education & Work History", questions: [7, 8] },
      { title: "💼 Skilled Work Details", questions: [9] },
      { title: "🌐 Language & Funds", questions: [10, 11] },
      { title: "✈️ Travel History", questions: [12] },
      { title: "📋 Background", questions: [13] },
    ],
    prompts: [
      "🎉 Congratulations on your ITA!\n\nHave you used any other name? (Yes/No — if Yes, list them and reason for change)\nAlso: what is your height in cm and eye colour?",
      "What is your native language? And your current phone number and personal email address?",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)\nIf Married or Common-Law: spouse full name, DOB, citizenship, education level, occupation.",
      "What is your complete residential AND mailing address? (Unit/Apt, Street No., Street Name, City, Province, Postal Code)",
      "🏠 Complete address history for the past 10 years — NO GAPS!\n\nFor each address:\n- From (MM-YYYY) to (MM-YYYY)\n- Full address (Unit, Street, City, Province/State, Country, Postal Code)",
      "Do you have a sibling who is a Canadian PR or Citizen? (Yes/No)\nIf Yes: full name, relationship, date of birth, city and country of birth, Canadian address.\n\n🇨🇦 This adds CRS points!",
      "🎓 Complete education history from 10+2 onwards:\n\nFor each:\n- Field of study\n- From (MM-YYYY) to (MM-YYYY)\n- Country, Institution name, Level (10+2 / Diploma / Bachelor's / Master's / PhD)\n\nDo you have an ECA report? (Yes/No — if Yes: organization e.g. WES)",
      "💼 Complete personal history for past 10 years — NO GAPS!\n\nFor each period:\n- From (MM-YYYY) to (MM-YYYY)\n- Activity (Employed / Student / Unemployed / Travelling)\n- Employer/School name, City, Country",
      "For each SKILLED work position please provide:\n- Job title + NOC code\n- Employer name, address, phone\n- From (YYYY-MM) to (YYYY-MM)\n- Hours per week\n- Key duties (3-4 sentences)",
      "Language test results:\n- Test name (IELTS / CELPIP / TEF)\n- Reading, Writing, Listening, Speaking scores\n- Test date (YYYY-MM-DD), TRF/Reference number\n\nSpouse language test results (same format). Reply NA if not applicable.",
      "Settlement funds available in CAD.\nCurrent minimum for single applicant: $14,690 CAD",
      "✈️ Travel history for the past 10 years:\n\nFor each trip outside your home country:\n- Country visited\n- From (YYYY-MM-DD) to (YYYY-MM-DD)\n- Purpose (Tourism / Business / Study / Work)\n\nIf no travel, say: 'I did not travel outside my country.'",
      "📝 Background — answer Yes or No for each. If ALL are No, just say 'No to all' 😊\n\n1. Tuberculosis or serious illness (you or family)?\n2. Ever convicted of a crime?\n3. Ever refused a visa or entry to any country?\n4. Ever ordered to leave any country?\n5. Ever claimed refugee status?\n6. Ever served in military or armed group?\n7. Ever held government or law enforcement position?"
    ]
  },

  family_sponsorship: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    batches: [
      { title: "👤 Personal Info", questions: [0, 1, 2, 3, 4, 5] },
      { title: "💍 Relationship Story", questions: [6, 7, 8, 9, 10, 11, 12, 13, 14] },
      { title: "👨‍👩‍👧 Parents & Siblings", questions: [15, 16, 17, 18] },
      { title: "🎓 Education & Work", questions: [19, 20, 21, 22] },
      { title: "🏠 Address & Travel", questions: [23, 24, 25] },
      { title: "📋 Background", questions: [26] },
      { title: "🇨🇦 Sponsor Details", questions: [27, 28, 29, 30, 31, 32, 33, 34, 35] },
      { title: "🌐 Language", questions: [36] },
    ],
    prompts: [
      "👤 Let's start with some personal details!\n\nWhat is your eye color and height (in cm)?",
      "What is your native language?",
      "What is your current Canadian phone number and personal email address?",
      "What is your current home address in Canada? (Full address including postal code)",
      "When did you last enter Canada? Please share the date and city of entry.",
      "Have you ever used any other names? (e.g. maiden name, nickname) — If Yes, list them and the reason for change. If No, just say No!",
      "💍 Now let's talk about your beautiful relationship!\n\nWas your marriage arranged? (Yes/No) — If Yes, please describe by whom, when and where.",
      "Were there any formal ceremonies or events? (engagement, reception, honeymoon, etc.)\nIf Yes, for each event please share: date, location, number of guests, and who performed the ceremony.",
      "Did the following people attend your ceremonies? Please answer Yes or No for each:\n1. Your parents\n2. Your other family/relatives\n3. Sponsor's parents\n4. Sponsor's other family/relatives\n\nIf anyone did not attend, please explain why.",
      "How did you meet your spouse? Share your story! 😊",
      "What language(s) do you use when communicating with each other? And how often do you communicate when not together?",
      "Do your close friends and family know about your relationship? (Yes/No)\nIf Yes, please list 2-4 people: their name, relationship to you or sponsor, and date they met you/sponsor.",
      "Are either of you currently pregnant? (Yes/No — if Yes, please share the due date)",
      "Have you ever been married or in a common-law relationship before? (Yes/No)\nIf Yes: previous spouse's full name, date of birth, dates of relationship, and how it ended.",
      "Before this relationship, was your sponsor related to you in any way? (Yes/No — if Yes, please explain)",
      "👨‍👩‍👧 Now some details about your parents!\n\nMother's full name, date of birth (DD/MM/YYYY), city and country of birth, current address, and current occupation. Is your mother alive?",
      "Father's full name, date of birth (DD/MM/YYYY), city and country of birth, current address, and current occupation. Is your father alive?",
      "👫 How many brothers and sisters do you have?\n\nFor EACH sibling please share: full name, brother or sister, date of birth (DD/MM/YYYY), city and country of birth, current address, marital status, and occupation.",
      "👶 Do you have any children? (Yes/No)\nIf Yes, for EACH child please share: full name, date of birth (DD/MM/YYYY), city and country of birth, current address, and occupation.",
      "🎓 What is the highest level of education you completed?\n\nTotal years completed in:\n- Primary school (Grade 1-8)\n- Secondary/high school (Grade 9-12)\n- College/university\n- Trade/vocational school",
      "Please list ALL schools/colleges you attended after Grade 10:\nFor each: full name of school/college, city and country, start and end date (MM/YYYY), name of certificate/diploma, and field of study.",
      "💼 Complete work and personal history — NO GAPS from age 18!\n\nFor each period:\n- From (MM/YYYY) to (MM/YYYY)\n- Activity type (Student / Employed / Unemployed / Housewife / Travelling)\n- Employer/school name, City, Province/State, Country",
      "What is your current occupation? And what is your intended occupation in Canada?",
      "🏠 Please list ALL addresses where you have lived in the last 10 years — NO GAPS!\n\nFor each:\n- Full street address\n- City/Town, Province/State, Country\n- Postal code\n- Date moved in (MM/YYYY) and moved out (MM/YYYY)",
      "✈️ Please list ALL trips outside your home country in the last 10 years.\n\nFor each trip:\n- Country and city visited\n- Date left (YYYY-MM-DD) and returned (YYYY-MM-DD)\n- Purpose (Tourism / Business / Study / Work / Family Visit / Other)\n\nIf no travel, say: 'I did not travel.'",
      "Now the same travel details for your SPOUSE — all trips outside their country of residence in the last 10 years.",
      "📝 Almost done! Background questions — answer Yes or No for each. If ALL No, just say 'No to all' 😊\n\nHealth:\n1. Tuberculosis or serious illness (you or family)?\n2. Serious physical or mental illness?\n\nLegal/Immigration:\n3. Ever convicted of or charged with a crime?\n4. Ever refused a visa or entry to any country?\n5. Ever ordered to leave any country?\n6. Ever arrested, charged, or detained?\n7. Ever claimed refugee status?\n\nSecurity:\n8. Ever involved in war crimes or terrorism?\n9. Ever served in military or armed group?\n10. Ever been a member of political party or union?\n11. Ever worked in prisons, police, or intelligence?\n12. Ever held government or state-owned enterprise position?",
      "🇨🇦 Now some details about your sponsor (your spouse in Canada)!\n\nSponsor's Canadian phone number, personal email, and current home address in Canada (full address with postal code)",
      "Is the sponsor currently employed? (Yes/No)\nIf Yes: employer name, full employer address, employer phone, job title, NOC code, start date, and monthly gross income.\nIf No: source of income.",
      "Sponsor's employment history for the last 5 years (no gaps):\nFor each: employer name, address, phone, occupation/position, dates (MM/YYYY – MM/YYYY), monthly gross income.",
      "Sponsor's highest level of education completed and total years of education.",
      "Sponsor's address history for the last 5 years (no gaps) — full addresses with dates moved in and out.",
      "Has the sponsor ever been married or in a common-law relationship before? (Yes/No — if Yes, full details)",
      "Has the sponsor ever sponsored anyone for immigration before? (Yes/No)\nIf Yes: their full name, date of birth, and relationship to sponsor.",
      "Has the sponsor ever: received social assistance/welfare? Been convicted of a crime? Been bankrupt? (Yes or No for each)",
      "Does the sponsor have any relatives currently living in Canada? (Yes/No)\nIf Yes, for each: full name, date of birth, place of birth, marital status, relationship to sponsor, and current address.",
      "🌐 Last question! Did you take an English language test? (Yes/No)\nIf Yes: which test? (IELTS / CELPIP / PTE)\n\nDon't worry — we will extract scores from your score card document. 😊"
    ]
  },

  citizenship_prcard: {
    requiredFields: ["fullName", "phone", "address", "nativeLanguage", "maritalStatus"],
    batches: [
      { title: "📤 Upload Documents", questions: [0] },
      { title: "👤 Personal Info", questions: [1, 2, 3] },
      { title: "🏠 Address History (last 5 years)", questions: [4, 5] },
      { title: "💼 Work & Education (last 5 years)", questions: [6, 7] },
      { title: "✈️ Travel & Absences from Canada", questions: [8, 9] },
      { title: "💰 Taxes & Language Proof", questions: [10, 11, 12] },
      { title: "🌍 Other Citizenship & Police Records", questions: [13, 14, 15] },
      { title: "📋 Background", questions: [16, 17, 18] },
      { title: "✅ Consents", questions: [19, 20] },
    ],
    prompts: [
      // Q0 — upload prompt (OCR extracts name, DOB, citizenship, PR card #, UCI from these)
      "📎 *Please upload these documents first* (one by one is fine):\n\n• Current passport (bio page)\n• Any expired passports from the last 5 years\n• PR card (BOTH sides)\n• PR landing document — IMM 1000, IMM 5292, or IMM 5688\n\nReply *DONE* once you've sent them. We'll extract your name, DOB, UCI, PR card number from the PR card and passport.",

      // Q1 — alias / other names
      "Have you used any other name (maiden name, nickname, alias)? (Yes/No — if Yes, provide full other name(s) and dates used)",

      // Q2 — current marital status + spouse details
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)\n\nIf Married or Common-Law: spouse's full name, DOB (YYYY-MM-DD), citizenship, date of marriage/start of cohabitation, and is your spouse a Canadian citizen or PR? Reply NA for the spouse fields if Single/Divorced/Widowed.",

      // Q3 — children / dependents
      "Do you have any children? (Yes/No — if Yes: each child's full name, DOB YYYY-MM-DD, and are they Canadian citizens? If too many to type, reply 'will email')",

      // Q4 — current home address
      "Your current home address in Canada (street, city, province, postal code), and the date you moved in (YYYY-MM-DD).",

      // Q5 — past addresses (last 5 years)
      "Past addresses in the last 5 years (each: full address + move-in date + move-out date YYYY-MM-DD). List ALL — Canada and abroad. Reply 'only current' if you've lived at the same place for 5+ years.",

      // Q6 — employment history (last 5 years)
      "Employment / occupations in the last 5 years (each: employer name, your job title, start date, end date YYYY-MM-DD, city/country). Include unemployment, study periods, retired, stay-at-home — any gap MUST be accounted for. Reply 'will email' if extensive.",

      // Q7 — education history (last 5 years)
      "Education in the last 5 years (each: institution name, program / degree, start–end dates YYYY-MM-DD, city/country). Reply NA if none.",

      // Q8 — physical presence in Canada (residency calculator data)
      "Approximately how many days have you been *physically present in Canada* in the last 5 years? (We need 1,095 days minimum.) If you've used the IRCC Physical Presence Calculator, send the printout — otherwise just give your best estimate.",

      // Q9 — absences from Canada
      "List ALL trips OUTSIDE Canada in the last 5 years — each trip: country visited, date left Canada (YYYY-MM-DD), date returned, reason for trip. Reply 'no trips' if you never left Canada. If too many, reply 'will email'.",

      // Q10 — tax filing
      "Have you filed Canadian taxes for *at least 3 of the last 5 years*? (Yes/No — if Yes: list which tax years you filed, e.g. 2021, 2022, 2023). IRCC verifies this with CRA — please be accurate.",

      // Q11 — language proof status
      "Language proof for citizenship (CLB 4+ required if 18-54 years old):\n• If you took IELTS / CELPIP-G / TEF / TCF — which test, when, and your scores?\n• If you completed *secondary or post-secondary education in English/French* (in Canada or abroad) — name of school + degree (we'll use the diploma/transcript as proof)\n• If you took a government-funded class (LINC / CLIC) — name of program\n• If you're 55+ and exempt — reply *exempt — age 55+*",

      // Q12 — second piece of ID
      "Two pieces of valid ID required (one with photo). One can be your PR card. For the SECOND ID, what is it? (e.g. driver's licence / provincial ID / health card / foreign passport — give type + number + expiry date YYYY-MM-DD)",

      // Q13 — other citizenships / status in last 5 years
      "Do you currently hold OR have you held immigration status / citizenship in any country other than Canada in the last 5 years? (Yes/No — if Yes: country, type of status, dates)",

      // Q14 — countries lived 183+ days (police certs)
      "In the last 4 years, were you physically present in any country *outside Canada* for 183 or more consecutive days? (Yes/No — if Yes: list each country and approx dates. We'll need a police certificate from each.)",

      // Q15 — refusals
      "Have you ever been refused a visa, permit, or status by Canada or any other country? Have you ever been deported, removed, or asked to leave any country? (Yes/No — if Yes, give details: country, year, type of refusal)",

      // Q16 — criminal history
      "Any criminal charges, convictions, or arrests anywhere in the world (including Canada)? (Yes/No — if Yes, give country, year, charge, and outcome)",

      // Q17 — security / military
      "Have you ever served in any military, intelligence, or security organization, OR been involved in any armed conflict, OR a member of any organization involved in violence? (Yes/No — if Yes, brief details)",

      // Q18 — medical condition affecting oath/language (waiver)
      "Do you have any medical or cognitive condition that prevents you from taking the citizenship oath or meeting the language requirement? (Yes/No — if Yes, you may apply for a waiver with a doctor's letter. We'll guide you.)",

      // Q19 — MP letter consent
      "Would you like IRCC to send your name and address to your federal Member of Parliament so they can mail you a letter of congratulations after you become a citizen? (Yes/No)",

      // Q20 — Elections Canada consent
      "Would you like IRCC to share your info with Elections Canada to add you to the voter register automatically after you become a citizen? (Yes/No — if No, you can still vote, you'd just register yourself later)",
    ]
  },

  // PR Card Renewal — distinct from citizenship.
  // 730-day residency obligation (NOT 1095), $50 fee (NOT $630), IMM 5444 form.
  // 14 questions in 5 batches. No language test, no police certs, no tax-filing
  // 3-of-5-years question — those are citizenship-specific.
  pr_card_renewal: {
    requiredFields: ["fullName", "phone", "address", "maritalStatus", "employmentHistory"],
    batches: [
      { title: "📤 Upload Documents", questions: [0] },
      { title: "👤 Personal Info", questions: [1, 2, 3, 4] },
      { title: "🇨🇦 PR Status & Card", questions: [5, 6, 7, 8] },
      { title: "✈️ Travel History (last 5 years)", questions: [9] },
      { title: "💼 Work in Canada (last 5 years)", questions: [10, 11] },
      { title: "📋 Final Details", questions: [12, 13] },
    ],
    prompts: [
      // Q0 — Upload prompt. Heavy on docs because PR card renewal is
      // 90% about residency proof — bot needs every doc that establishes
      // physical presence.
      "📎 *Please upload these documents first* (one by one is fine):\n\n• Current passport (bio page + every page with stamps/visas)\n• Any expired passports from last 5 years (with stamps)\n• Current/expiring PR card — *FRONT and BACK*\n• PR landing document — IMM 1000, IMM 5292, IMM 5688, or COPR\n• Last 3 years' CRA Notice of Assessment (NOA)\n• T4 slips (last 3-5 years if available)\n• Address proofs — utility bills, lease, bank statements (covering last 5 years)\n\nReply *DONE* once you've sent them. We'll extract your name, DOB, UCI, PR card #, and PR start date from the docs.",

      // Q1 — Full legal name (must match landing doc exactly)
      "Your *full legal name* — exactly as it appears on your PR landing document (IMM 1000 / 5292 / 5688 / COPR). If your current legal name is different (after marriage etc.), give BOTH names: 'Landing doc name' and 'Current legal name'.",

      // Q2 — DOB
      "Your date of birth (YYYY-MM-DD).",

      // Q3 — Current address in Canada
      "Your current address in Canada (street, city, province, postal code) and the date you moved in (YYYY-MM-DD).",

      // Q4 — Marital status (needed for IMM 5444 family info section)
      "Current marital status (Single / Married / Common-Law / Divorced / Widowed / Separated). If Married or Common-Law: spouse's full name + date of marriage / start of cohabitation YYYY-MM-DD.",

      // Q5 — INSIDE CANADA check (CRITICAL — wrong path = refusal)
      "Are you currently *physically inside Canada*? (Yes / No)\n\nIMPORTANT: PR card renewal can ONLY be filed from inside Canada. If you're outside, you need a Permanent Resident Travel Document (PRTD) to come back first. Please confirm.",

      // Q6 — UCI / Client ID
      "Your UCI / Client ID (8-10 digits — found on your PR landing document and PR card). If you can't find it, reply 'not sure' — we'll extract it from your documents.",

      // Q7 — Date became PR
      "The date you *became a Permanent Resident* (date on your PR landing document, YYYY-MM-DD).",

      // Q8 — Current PR card details
      "Your current PR card number + expiry date (YYYY-MM-DD). Found on the back of your PR card.",

      // Q9 — Travel history (the BIG one — 730-day check basis)
      "*Every trip OUTSIDE Canada in the last 5 years.* For each trip:\n• Date you LEFT Canada (YYYY-MM-DD)\n• Date you RETURNED to Canada (YYYY-MM-DD)\n• Country/countries visited\n• Reason (vacation, family visit, work, etc.)\n\nList ALL trips — IRCC cross-checks with CBSA records. Even short trips (a weekend in the US) count. Missing or wrong dates = misrepresentation = 5-year ban. If you have many trips, reply 'will email' and we'll send a spreadsheet to fill out. If you never left Canada, reply 'no trips'.",

      // Q10 — Employment in Canada
      "Your employment in Canada in the last 5 years (each job: employer name, your position, start date, end date YYYY-MM-DD, city). Include any unemployment / study periods / stay-at-home / retired periods — any gap MUST be accounted for. Reply 'will email' if extensive.",

      // Q11 — Education in Canada
      "Education in Canada in the last 5 years (each: school name, program, start–end dates YYYY-MM-DD, city). Reply NA if none.",

      // Q12 — Name / appearance changes since last PR card
      "Has your *legal name, gender marker, or appearance* changed since your last PR card was issued? (Yes / No — if Yes, briefly explain. We'll need supporting documents like marriage certificate or court order.)",

      // Q13 — Inadmissibility / removal / criminal
      "In the last 5 years, have you:\n• Been refused entry to Canada or any country?\n• Been under any IRCC removal order or criminal investigation?\n• Had any arrests, charges, or convictions anywhere in the world?\n\n(Yes / No — if Yes, briefly describe each: country, year, what happened, outcome)",
    ]
  },

  us_b1b2: {
    requiredFields: ["fullName", "phone", "address", "maritalStatus", "employmentHistory", "education", "criminalHistory", "medicalHistory"],
    batches: [
      { title: "✈️ Trip Details", questions: [0, 1] },
      { title: "👨‍👩‍👧 Family & Social", questions: [2, 3] },
    ],
    prompts: [
      "US trip purpose, intended dates, and address in US",
      "US point of contact details",
      "Family details (parents/spouse)",
      "Social media handles used in last 5 years"
    ]
  },

  uk_visitor: {
    requiredFields: ["fullName", "phone", "address", "maritalStatus", "employmentHistory", "criminalHistory", "medicalHistory"],
    batches: [
      { title: "✈️ Visit Details", questions: [0, 1] },
      { title: "📋 Background", questions: [2, 3] },
    ],
    prompts: [
      "UK visit purpose and expected arrival date",
      "Address history for the past 2 years",
      "Travel history and past refusals",
      "Family in UK (if any) with details"
    ]
  },

  refugee: {
    requiredFields: ["fullName", "phone", "address", "maritalStatus", "nativeLanguage", "employmentHistory", "education", "refusedAnyCountry", "criminalHistory", "medicalHistory"],
    batches: [
      { title: "📋 Claim Details", questions: [0, 1] },
      { title: "🏠 History", questions: [2, 3, 4] },
    ],
    prompts: [
      "Detailed explanation of why you left your country",
      "Key incidents (dates, threats, people/groups involved)",
      "Address history for last 10 years",
      "Travel history for last 5 years",
      "Parents/siblings/children details"
    ]
  },

  canadian_passport_doc: {
    requiredFields: ["fullName", "phone", "address"],
    batches: [
      { title: "👤 Personal", questions: [0, 1, 2] },
      { title: "📋 References", questions: [3, 4, 5] },
    ],
    prompts: [
      "Any previous names used",
      "Eye color and height (cm)",
      "Address history for past 2 years",
      "Occupation history for past 2 years",
      "Guarantor details",
      "References and emergency contact details"
    ]
  },

  generic: {
    requiredFields: ["fullName", "phone", "address", "maritalStatus", "refusedAnyCountry", "criminalHistory", "medicalHistory"],
    batches: [
      { title: "📋 Details", questions: [0, 1, 2] },
    ],
    prompts: [
      "Provide key details relevant to your application",
      "Any refusals, criminal, or medical history details",
      "Any additional notes for your case team"
    ]
  }
};

function asText(value: unknown): string {
  return String(value || "").trim();
}

function parseSpecificAnswers(raw: unknown, prompts: string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const prompt of prompts) output[prompt] = "";
  const source = asText(raw);
  if (!source) return output;
  try {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    for (const prompt of prompts) output[prompt] = asText(parsed[prompt]);
    return output;
  } catch {
    return output;
  }
}

function isYes(value: string): boolean {
  const normalized = asText(value).toLowerCase();
  return normalized.startsWith("y");
}

function hasValue(intake: IntakeRecord, key: string): boolean {
  return asText(intake[key]).length > 0;
}

export function getQuestionFlowForFormType(formType: string): QuestionFlow {
  const key = resolveApplicationChecklistKey(formType || "generic");
  return QUESTION_FLOWS[key] || QUESTION_FLOWS.generic;
}

export function getQuestionPromptsForFormType(formType: string): string[] {
  return getQuestionFlowForFormType(formType).prompts;
}

export function getQuestionBatchesForFormType(formType: string): Array<{ title: string; questions: string[] }> {
  const flow = getQuestionFlowForFormType(formType);
  if (!flow.batches) {
    // Default: split into groups of 4
    const batches = [];
    for (let i = 0; i < flow.prompts.length; i += 4) {
      batches.push({
        title: `Part ${Math.floor(i/4) + 1}`,
        questions: flow.prompts.slice(i, i + 4)
      });
    }
    return batches;
  }
  return flow.batches.map(b => ({
    title: b.title,
    questions: b.questions.map(idx => flow.prompts[idx])
  }));
}

export function isQuestionnaireComplete(formType: string, intake: IntakeRecord): boolean {
  const flow = getQuestionFlowForFormType(formType);
  const requiredBaseOk = flow.requiredFields.every((field) => hasValue(intake, field));
  if (!requiredBaseOk) return false;

  if (isYes(asText(intake.usedOtherName)) && !hasValue(intake, "otherNameDetails")) return false;

  const marital = asText(intake.maritalStatus).toLowerCase();
  const requiresSpouse = marital.includes("married") || marital.includes("common");
  if (requiresSpouse && (!hasValue(intake, "spouseName") || !hasValue(intake, "spouseDateOfMarriage"))) {
    return false;
  }

  if (isYes(asText(intake.previousMarriageCommonLaw)) && !hasValue(intake, "previousRelationshipDetails")) {
    return false;
  }

  if (isYes(asText(intake.refusedAnyCountry)) && !hasValue(intake, "refusalDetails")) return false;

  if (isYes(asText(intake.travelHistorySixMonths)) && !hasValue(intake, "travelHistoryDetails")) return false;

  const specific = parseSpecificAnswers(intake.applicationSpecificAnswers, flow.prompts);
  const promptsOk = flow.prompts.every((prompt) => asText(specific[prompt]).length > 0);
  return promptsOk;
}
