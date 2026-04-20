import { resolveApplicationChecklistKey } from "@/lib/application-checklists";

export type IntakeRecord = Record<string, string>;

type ChecklistKey = ReturnType<typeof resolveApplicationChecklistKey>;

type QuestionFlow = {
  prompts: string[];
  requiredFields: string[];
};

const DEFAULT_REQUIRED_FIELDS = [
  "fullName",
  "phone",
  "maritalStatus",
  "address",
  "travelHistorySixMonths",
  "nativeLanguage",
  "englishTestTaken",
  "originalEntryDate",
  "originalEntryPlacePurpose",
  "employmentHistory",
  "education",
  "refusedAnyCountry",
  "criminalHistory",
  "medicalHistory"
];

const QUESTION_FLOWS: Record<ChecklistKey, QuestionFlow> = {
  pgwp: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
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
      "Employment details — list all jobs most recent first. For each: From (YYYY-MM), To (YYYY-MM), Job Title, Employer Name, City. Reply NONE if no employment.",
      "Education after 12th grade (if any). For each: From (YYYY-MM), To (YYYY-MM), Field of Study, Name of Institute, City. Reply NONE if none.",
      "What is your native language?",
      "Have you taken an English language proficiency test? (Yes/No — if Yes: test name, score, and date)",
      "Do you plan to work in the medical field in Canada in the future? (Yes/No — if Yes: please provide your medical exam/test details)"
    ]
  },
  trv_inside: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    prompts: [
      "Have you used any other name? (Yes/No — if Yes, provide full other name)",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: provide partner's full name, DOB, citizenship. Reply NA if not applicable.",
      "Current mailing address in Canada including postal code (Apt/Unit, Street Number, Street Name, City, Province, Postal Code)",
      "Telephone number",
      "What is your current immigration status in Canada and expiry date? (e.g. Visitor — expires YYYY-MM-DD)",
      "What country do you currently live in and what is your immigration status there? (e.g. India — Citizen)",
      "What is the purpose of your visit to Canada? (Tourism / Visiting family / Business / Other — provide details)",
      "What date does your visit start? (YYYY-MM-DD) and when do you plan to leave Canada? (YYYY-MM-DD)",
      "Address in Canada where you will stay (full address including postal code)",
      "Will you be visiting anyone in Canada? (Yes/No — if Yes: full name, relationship, and their address)",
      "How much money do you have available for your stay in Canada? (amount in CAD)",
      "Who will pay your expenses in Canada? (Myself / Parents / Other — if Other: name and relationship)",
      "Date and place you first entered Canada (YYYY-MM-DD, city/port of entry)",
      "Have you ever been refused a visa or permit for Canada or any other country? (Yes/No — if Yes: details)",
      "Do you have any medical history? (Yes/No — if Yes: provide details)",
      "Do you have any criminal history? (Yes/No — if Yes: provide details)",
      "What is your native language? Can you communicate in English or French? (Yes/No)"
    ]
  },
  visitor_visa: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
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
  work_permit: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
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
      "Employment details — list all jobs most recent first. For each: From (YYYY-MM), To (YYYY-MM), Job Title, Employer Name, City. Reply NONE if no employment.",
      "Education after 12th grade (if any). For each: From (YYYY-MM), To (YYYY-MM), Field of Study, Name of Institute, City. Reply NONE if none.",
      "What is your native language?",
      "Have you taken an English language proficiency test? (Yes/No — if Yes: test name, score, and date)",
      "Do you plan to work in the medical field in Canada in the future? (Yes/No — if Yes: please provide your medical exam/test details)"
    ]
  },
  study_permit: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
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
  super_visa: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
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
    requiredFields: [
      "fullName", "phone", "maritalStatus", "address", "nativeLanguage",
      "englishTestTaken", "employmentHistory", "education",
      "refusedAnyCountry", "criminalHistory", "medicalHistory"
    ],
    prompts: [
      // SECTION 1 — PERSONAL DETAILS
      "🍁 Welcome! Let's get started with your Express Entry application!\n\nHave you ever used any other name? (e.g. maiden name, nickname) — If Yes, please list them. If No, just say No!",
      "What is your current marital status? (Single / Married / Common-Law / Divorced / Widowed / Separated)",
      "If Married or Common-Law: spouse's full name, date of birth, citizenship, education level, and occupation. Reply NA if not applicable.",
      "What is your height in cm and eye colour?",
      "What is your native language?",
      "What is your current phone number and email address?",
      "What is your complete residential and mailing address? (Unit/Apt No., Street No., Street Name, City, Province, Postal Code)",

      // SECTION 2 — PR FAMILY MEMBER IN CANADA
      "Do you have a sibling who is a Canadian PR or Citizen? (Yes/No)\nIf Yes, please provide: Full name, relationship to you, date of birth, city and country of birth, and their Canadian address.\n\nThis can add points to your CRS score! 🇨🇦",

      // SECTION 3 — ADDRESS HISTORY
      "🏠 Please provide your complete address history for the past 10 years. No gaps allowed!\n\nFor each address:\n- From (MM-YYYY)\n- To (MM-YYYY)\n- Unit/Apt No. & Street No.\n- Street Name\n- City & Province/State\n- Country\n- Postal Code\n\n⚠️ Every month must be covered!",

      // SECTION 4 — EDUCATION
      "🎓 Please provide your complete education history from 10+2 onwards.\n\nFor each:\n- Field of study\n- From (MM-YYYY)\n- To (MM-YYYY)\n- Country of study\n- Name of school/institution\n- Level of education (10+2 / Diploma / Bachelor's / Master's / PhD)\n\nDo you have an ECA (Educational Credential Assessment) report? (Yes/No — if Yes: which organization e.g. WES)",

      // SECTION 5 — PERSONAL/WORK HISTORY
      "💼 Please provide your complete personal history for the past 10 years. No gaps!\n\nFor each period:\n- From (MM-YYYY)\n- To (MM-YYYY)\n- Activity type (Employed / Student / Unemployed / Travelling / Other)\n- Employer/School/Facility name\n- Country/Territory\n\n⚠️ Every month must be covered!",

      "What is your primary job title and NOC code (if known)? How many years of skilled work experience do you have in this field?",

      "For each SKILLED work position (NOC 0/A/B), please provide:\n- Job title + NOC code\n- Employer name + city + country\n- From (YYYY-MM) to (YYYY-MM)\n- Hours per week\n- Key duties (2-3 sentences)",

      // SECTION 6 — LANGUAGE
      "🌐 Language test results:\n- Test name (IELTS / CELPIP / TEF)\n- Reading score\n- Writing score\n- Listening score\n- Speaking score\n- Test date (YYYY-MM-DD)\n- TRF/Reference number",

      "Spouse language test results (if applicable) — same format as above. Reply NA if not applicable.",

      // SECTION 7 — BONUS FACTORS
      "Do you have a provincial nomination (PNP)? (Yes/No — if Yes: province and program name)",
      "Do you have a valid Canadian job offer? (Yes/No — if Yes: employer name, NOC code, job title, and LMIA number if applicable)",
      "What is your proof of settlement funds available? (amount in CAD)\n\nMinimum required for single applicant: $14,690 CAD",
      "Have you ever lived or worked in Canada? (Yes/No — if Yes: permit type, dates, and province)",

      // SECTION 8 — BACKGROUND
      "📝 Last section! Please answer Yes or No for each — if ALL are No, just say 'No to all' 😊\n\n1. Have you ever been refused a visa or permit for Canada or any other country?\n2. Have you ever been ordered to leave any country?\n3. Do you have any medical conditions?\n4. Do you have any criminal history?\n5. Have you ever claimed refugee status?"
    ]
  },
  family_sponsorship: {
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    prompts: [
      // SECTION 1 — PERSONAL DETAILS
      "👤 Let's start with some personal details!\n\nWhat is your eye color and height (in cm)?",
      "What is your native language?",
      "What is your current Canadian phone number and personal email address?",
      "What is your current home address in Canada? (Full address including postal code)",
      "When did you last enter Canada? Please share the date and city of entry.",
      "Have you ever used any other names? (e.g. maiden name, nickname) — If Yes, list them and the reason for change. If No, just say No!",

      // SECTION 2 — MARRIAGE & RELATIONSHIP
      "💍 Now let's talk about your beautiful relationship!\n\nWas your marriage arranged? (Yes/No) — If Yes, please describe by whom, when and where.",
      "Were there any formal ceremonies or events? (engagement, reception, honeymoon, etc.)\nIf Yes, for each event please share: date, location, number of guests, and who performed the ceremony.",
      "Did the following people attend your ceremonies? Please answer Yes or No for each:\n1. Your parents\n2. Your other family/relatives\n3. Sponsor's parents\n4. Sponsor's other family/relatives\n\nIf anyone did not attend, please explain why.",
      "How did you meet your spouse? Share your story! 😊",
      "What language(s) do you use when communicating with each other? And how often do you communicate when not together? (phone, WhatsApp, video calls, etc.)",
      "Do your close friends and family know about your relationship? (Yes/No)\nIf Yes, please list 2-4 people: their name, relationship to you or sponsor, and date they met you/sponsor.",
      "Are either of you currently pregnant? (Yes/No — if Yes, please share the due date)",
      "Have you ever been married or in a common-law relationship before? (Yes/No)\nIf Yes: previous spouse's full name, date of birth, dates of relationship, and how it ended.",
      "Before this relationship, was your sponsor related to you in any way? (Yes/No — if Yes, please explain)",

      // SECTION 3 — PARENTS
      "👨‍👩‍👧 Now some details about your parents!\n\nMother's full name, date of birth (DD/MM/YYYY), city and country of birth, current address, and current occupation. Is your mother alive? (If not, please share date and place of passing 🙏)",
      "Father's full name, date of birth (DD/MM/YYYY), city and country of birth, current address, and current occupation. Is your father alive? (If not, please share date and place of passing 🙏)",

      // SECTION 4 — SIBLINGS
      "👫 How many brothers and sisters do you have?\n\nFor EACH sibling please share: full name, brother or sister, date of birth (DD/MM/YYYY), city and country of birth, current address (city and country is enough), marital status, and occupation.",

      // SECTION 5 — CHILDREN
      "👶 Do you have any children? (Yes/No)\nIf Yes, for EACH child please share: full name, date of birth (DD/MM/YYYY), city and country of birth, current address, and occupation (or N/A if child).",

      // SECTION 6 — EDUCATION
      "🎓 Let's talk about your education!\n\nWhat is the highest level of education you completed? (e.g. 10th, 12th, Diploma, Bachelor's, Master's)\n\nTotal years completed in:\n- Primary school (Grade 1-8)\n- Secondary/high school (Grade 9-12)\n- College/university\n- Trade/vocational school (e.g. GNM, ITI, nursing)",
      "Please list ALL schools/colleges you attended after Grade 10:\nFor each: full name of school/college, city and country, start and end date (MM/YYYY), name of certificate/diploma, and field of study.",

      // SECTION 7 — WORK HISTORY
      "💼 Now your work and personal history — this is important!\n\nPlease list EVERY period from your 18th birthday (or last 10 years) to today. Include employment, education, unemployment, and travel periods.\n\nFor each period:\n- From (MM/YYYY) to (MM/YYYY)\n- Activity type (Student / Employed / Unemployed / Housewife / Travelling)\n- Employer/school name\n- City, province/state, country\n\n⚠️ No gaps — every month must be covered!",
      "What is your current occupation? And what is your intended occupation in Canada?",

      // SECTION 8 — ADDRESS HISTORY
      "🏠 Please list ALL addresses where you have lived in the last 10 years.\n\nFor each address:\n- Full street address\n- City/Town, Province/State, Country\n- Postal code\n- Date moved in (MM/YYYY)\n- Date moved out (MM/YYYY) or 'still living here'\n\n⚠️ No gaps — every month must be covered!",

      // SECTION 9 — TRAVEL HISTORY
      "✈️ Please list ALL trips outside your home country in the last 10 years.\n\nFor each trip:\n- Country and city visited\n- Date left (YYYY-MM-DD)\n- Date returned (YYYY-MM-DD)\n- Number of days\n- Purpose (Tourism / Business / Study / Work / Family Visit / Transit / Religious / Marriage / Other)\n\nIf you did NOT travel outside your country at all, just say: 'I did not travel.'",
      "Now the same travel details for your SPOUSE — all trips outside their country of residence in the last 10 years. (Same format as above)",

      // SECTION 10 — BACKGROUND
      "📝 Almost done! Just a few background questions. Please answer Yes or No for each — if ALL answers are No, just say 'No to all' and that's it! 😊\n\nHealth:\n1. Have you or any family member had tuberculosis or been in contact with someone with TB?\n2. Have you or any family member had a serious physical or mental illness?\n\nLegal/Immigration:\n3. Have you or any family member ever been convicted of or charged with a crime?\n4. Have you or any family member ever been refused a visa or entry to any country?\n5. Have you or any family member ever been ordered to leave any country?\n6. Have you ever been arrested, charged, or detained?\n7. Have you ever claimed refugee status anywhere?\n\nSecurity:\n8. Have you or any family member committed or been involved in war crimes or terrorism?\n9. Have you ever served in a military or armed group?\n10. Have you ever been a member of a political party, rebel group, or union?\n11. Have you ever worked in prisons, police, or intelligence agencies?\n12. Have you ever held a government, judiciary, or state-owned enterprise position?",

      // SECTION 11 — SPONSOR DETAILS
      "🇨🇦 Now some details about your sponsor (your spouse in Canada)!\n\nSponsor's Canadian phone number, personal email, and current home address in Canada (full address with postal code)",
      "Is the sponsor currently employed? (Yes/No)\nIf Yes: employer name, full employer address, employer phone, job title, NOC code (if known), start date, and monthly gross income.\nIf No: source of income / how they support themselves.",
      "Sponsor's employment history for the last 5 years (no gaps):\nFor each: employer name, address, phone, occupation/position, dates (MM/YYYY – MM/YYYY), monthly gross income.",
      "Sponsor's highest level of education completed and total years of education.",
      "Sponsor's address history for the last 5 years (no gaps) — full addresses with dates moved in and out.",
      "Has the sponsor ever been married or in a common-law relationship before? (Yes/No — if Yes, full details)",
      "Has the sponsor ever sponsored anyone for immigration before? (Yes/No)\nIf Yes: their full name, date of birth, and relationship to sponsor.",
      "Has the sponsor ever: received social assistance/welfare? Been convicted of a crime? Been bankrupt? (Please answer Yes or No for each — if all No, just say 'No to all')",
      "Does the sponsor have any relatives (aunts, uncles, cousins, etc.) currently living in Canada? (Yes/No)\nIf Yes, for each: full name, date of birth, place of birth, marital status, relationship to sponsor, and current address.",

      // SECTION 12 — LANGUAGE
      "🌐 Last question! Did you take an English language test? (Yes/No)\nIf Yes: which test? (IELTS / CELPIP / PTE)\n\nDon't worry — we will extract the test date, scores, and TRF number from your score card document. 😊"
    ]
  },
  citizenship_prcard: {
    requiredFields: [
      "fullName",
      "phone",
      "address",
      "nativeLanguage"
    ],
    prompts: [
      "Address history and travel history summary",
      "Current status and prior travel documents/passports"
    ]
  },
  us_b1b2: {
    requiredFields: [
      "fullName",
      "phone",
      "address",
      "maritalStatus",
      "employmentHistory",
      "education",
      "criminalHistory",
      "medicalHistory"
    ],
    prompts: [
      "US trip purpose, intended dates, and address in US",
      "US point of contact details",
      "Family details (parents/spouse)",
      "Social media handles used in last 5 years"
    ]
  },
  uk_visitor: {
    requiredFields: [
      "fullName",
      "phone",
      "address",
      "maritalStatus",
      "employmentHistory",
      "criminalHistory",
      "medicalHistory"
    ],
    prompts: [
      "UK visit purpose and expected arrival date",
      "Address history for the past 2 years",
      "Travel history and past refusals",
      "Family in UK (if any) with details"
    ]
  },
  refugee: {
    requiredFields: [
      "fullName",
      "phone",
      "address",
      "maritalStatus",
      "nativeLanguage",
      "employmentHistory",
      "education",
      "refusedAnyCountry",
      "criminalHistory",
      "medicalHistory"
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
    requiredFields: [
      "fullName",
      "phone",
      "address",
      "maritalStatus",
      "refusedAnyCountry",
      "criminalHistory",
      "medicalHistory"
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

  const education = asText(intake.education).toLowerCase();
  if (["bachelor", "master", "other"].includes(education) && !hasValue(intake, "educationDetails")) {
    return false;
  }

  const specific = parseSpecificAnswers(intake.applicationSpecificAnswers, flow.prompts);
  const promptsOk = flow.prompts.every((prompt) => asText(specific[prompt]).length > 0);
  return promptsOk;
}

