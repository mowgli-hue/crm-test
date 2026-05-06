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
      { title: "👤 Personal Info", questions: [0, 1, 2, 3] },
      { title: "🎓 Current Study Details", questions: [4, 5, 6, 7, 8] },
      { title: "📋 Extension Reason & Background", questions: [9, 10, 11, 12, 13] },
    ],
    prompts: [
      "Have you used any other name? (Yes/No — if Yes, provide full other name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "Current mailing address including postal code (Apt/Unit, Street Number, Street Name, City, Province, Postal Code)",
      "Telephone number",
      "Current study permit number and expiry date (YYYY-MM-DD)",
      "Current institution name and city",
      "Current program of study and expected completion date (YYYY-MM-DD)",
      "Are you changing colleges/institutions? (Yes/No — if Yes: new institution name, program, start date YYYY-MM-DD and reason for change)",
      "Are you changing your program of study? (Yes/No — if Yes: old program and new program details)",
      "Reason for extension — are you still enrolled or did you need more time to complete? (provide details)",
      "Have you maintained full-time enrollment throughout your studies? (Yes/No — if No: explain)",
      "Have you ever been refused a visa or permit? (Yes/No — if Yes: details)",
      "Do you have any medical history? (Yes/No — if Yes: provide details)",
      "Do you have any criminal history? (Yes/No — if Yes: provide details)"
    ]
  },

  visitor_visa: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    batches: [
      { title: "👤 Personal & Passport", questions: [0, 1, 2, 3, 4, 5] },
      { title: "💍 Marital & Residence", questions: [6, 7, 8, 9, 10] },
      { title: "✈️ Visit Details", questions: [11, 12, 13, 14] },
      { title: "💼 Education & Employment", questions: [15, 16] },
      { title: "🌍 Travel & Background", questions: [17, 18, 19, 20, 21] },
    ],
    prompts: [
      "Full name as on passport (Family name, Given name)",
      "Date of birth (YYYY-MM-DD)",
      "Gender (Male / Female)",
      "Country of birth and city of birth",
      "Country of citizenship",
      "Passport number, issuing country, issue date (YYYY-MM-DD) and expiry date (YYYY-MM-DD)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: spouse full name, DOB, citizenship. Reply NA if not applicable.",
      "Current country of residence and your immigration status there (Citizen / PR / Worker / Student / Visitor)",
      "Any other countries you have lived in last 5 years? For each: country, status, from date, to date. Reply NONE if none.",
      "Current home address (Street, City, Postal Code, Country) and phone number with country code",
      "Purpose of visit to Canada (Tourism / Visit family / Business / Conference — provide full details)",
      "Planned travel dates — arriving Canada (YYYY-MM-DD) and leaving Canada (YYYY-MM-DD)",
      "Contact in Canada — full name, relationship to you, their address, phone, and email",
      "How much money do you have available for this trip in CAD? Will funds be shared with anyone? (Yes/No)",
      "Education history — for each: school name, country, field of study, from/to dates (YYYY-MM)",
      "Employment history (no gaps since age 18) — for each: from (YYYY-MM), to (YYYY-MM or present), job title, employer, city, country",
      "Travel history last 5 years — for each trip: country visited, from (YYYY-MM), to (YYYY-MM), purpose",
      "Have you ever overstayed a visa, been refused entry, or been deported from any country? (Yes/No — if Yes: details)",
      "Have you ever been refused a Canadian visa or permit? (Yes/No — if Yes: details)",
      "Do you have any criminal history or medical conditions? (Yes/No for each — if Yes: provide details)",
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
      { title: "👤 Personal Info", questions: [0, 1, 2, 3, 4] },
      { title: "📋 Status & Visit", questions: [5, 6, 7, 8, 9, 10] },
      { title: "💰 Funds & Entry", questions: [11, 12, 13] },
      { title: "📋 Background", questions: [14, 15, 16, 17] },
    ],
    prompts: [
      "Have you used any other name? (Yes/No — if Yes, provide full other name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: provide partner's full name, DOB, citizenship. Reply NA if not applicable.",
      "Current mailing address in Canada including postal code (Apt/Unit, Street Number, Street Name, City, Province, Postal Code)",
      "Telephone number",
      "What is your current immigration status in Canada and expiry date? (e.g. Study Permit — expires YYYY-MM-DD)",
      "What country do you currently have status in and what is your immigration status there? (e.g. India — Citizen)",
      "What is the purpose of your travel outside Canada? (Tourism / Visit family / Business / Other — provide details)",
      "What are your planned travel dates — leaving Canada (YYYY-MM-DD) and returning to Canada (YYYY-MM-DD)?",
      "Which countries do you plan to visit?",
      "Address in Canada where you will return to (full address including postal code)",
      "How much money do you have available for your trip? (amount in CAD)",
      "Who will pay your expenses? (Myself / Parents / Other — if Other: name and relationship)",
      "Date and place you first entered Canada (YYYY-MM-DD, city/port of entry)",
      "Have you ever been refused a visa or permit for Canada or any other country? (Yes/No — if Yes: details)",
      "Do you have any medical history? (Yes/No — if Yes: provide details)",
      "Do you have any criminal history? (Yes/No — if Yes: provide details)",
      "What is your native language? Can you communicate in English or French? (Yes/No)"
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
    requiredFields: ["fullName", "phone", "address", "nativeLanguage"],
    batches: [
      { title: "📋 Details", questions: [0, 1] },
    ],
    prompts: [
      "Address history and travel history summary",
      "Current status and prior travel documents/passports"
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
