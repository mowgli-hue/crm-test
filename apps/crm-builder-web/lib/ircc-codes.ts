// ─────────────────────────────────────────────────────────────────────
// IRCC Code Tables
//
// Source: extracted from IMM5710's embedded XFA LOV (List Of Values)
// streams. These are IRCC's OFFICIAL code → label mappings.
//
// Many IRCC PDF dropdowns require NUMERIC codes, not text. E.g.:
//   country='India'  WRONG — IRCC expects '205'
//   marital='Single' WRONG — IRCC expects '02'
//   province='BC'    WRONG — IRCC expects '11'
//
// Use textToCountryCode(), textToProvinceCode(), etc., to convert.
// All conversions are case-insensitive and handle common aliases.
// ─────────────────────────────────────────────────────────────────────

// ── Country codes (works for birth/citizenship/passport-issue) ──
// Note: IRCC has slightly different country lists for different fields,
// but the codes for COMMON countries (India, Canada, etc.) are the same.
// We use the broadest list (Country) here as the canonical mapping.

export const COUNTRY_CODES: Record<string, string> = {
  "*": "*",
  "afghanistan": "252",
  "africa nes": "199",
  "aland island": "401",
  "albania": "081",
  "algeria": "131",
  "andorra": "082",
  "angola": "151",
  "anguilla": "620",
  "antigua and barbuda": "621",
  "argentina": "703",
  "armenia": "049",
  "aruba": "658",
  "asia nes": "299",
  "australia": "305",
  "australia nes": "399",
  "austria": "011",
  "azerbaijan": "050",
  "bahamas": "622",
  "bahrain": "253",
  "bailwick of jersey": "412",
  "bangladesh": "212",
  "barbados": "610",
  "belarus": "051",
  "belau republic of": "228",
  "belgium": "012",
  "belize": "541",
  "benin": "160",
  "bermuda": "601",
  "bhutan": "254",
  "bolivia": "751",
  "bonaire, sint eustatius, saba": "402",
  "bosnia and herzegovina": "048",
  "botswana": "153",
  "bouvet island": "403",
  "brazil": "709",
  "british indian ocean territory": "404",
  "british virgin islands": "633",
  "brunei darussalam": "255",
  "bulgaria": "083",
  "burkina faso": "188",
  "burma (myanmar)": "241",
  "burundi": "154",
  "cabo verde": "911",
  "cambodia": "256",
  "cameroon": "155",
  "canada": "511",
  "canary islands": "039",
  "cayman islands": "624",
  "central african republic": "157",
  "central america nes": "549",
  "chad": "156",
  "channel islands": "009",
  "chile": "721",
  "china": "202",
  "china (hong kong sar)": "200",
  "china (macao sar)": "198",
  "christmas island": "405",
  "colombia": "722",
  "comoros": "905",
  "cook islands": "840",
  "costa rica": "542",
  "croatia": "043",
  "crozet islands": "129",
  "cuba": "650",
  "curaçao": "406",
  "cyprus": "221",
  "czech republic": "015",
  "czechoslovakia": "014",
  "democratic rep. of congo": "158",
  "denmark": "017",
  "djibouti": "183",
  "dominica": "625",
  "dominican republic": "651",
  "east timor": "916",
  "ecuador": "753",
  "egypt": "101",
  "el salvador": "543",
  "england": "002",
  "equatorial guinea": "178",
  "eritrea": "162",
  "estonia": "018",
  "ethiopia": "161",
  "europe nes": "099",
  "falkland islands": "912",
  "faroe islands": "408",
  "federated states of micronesia": "835",
  "fiji": "801",
  "finland": "021",
  "fr. south. and antarctic lands": "821",
  "france": "022",
  "french guiana": "754",
  "french polynesia": "845",
  "gabon": "163",
  "gambia": "164",
  "georgia": "052",
  "german democratic republic": "046",
  "germany, federal republic of": "024",
  "ghana": "165",
  "gibraltar": "084",
  "greece": "025",
  "greenland": "521",
  "grenada": "626",
  "guadeloupe": "653",
  "guam": "832",
  "guatemala": "544",
  "guernsey": "409",
  "guinea": "166",
  "guinea-bissau": "167",
  "guyana": "711",
  "haiti": "654",
  "heard and macdonald islands": "410",
  "honduras": "545",
  "hong kong": "204",
  "hungary": "026",
  "iraq": "IRAQ",
  "iceland": "085",
  "india": "205",
  "indonesia": "222",
  "iran": "223",
  "ireland": "027",
  "isle of man": "411",
  "israel": "206",
  "italy": "028",
  "ivory coast": "169",
  "jordan": "JORDAN",
  "jamaica": "602",
  "japan": "207",
  "kampuchea democratic rep.": "211",
  "kazakhstan": "053",
  "kenya": "132",
  "kiribati": "831",
  "korea, north (dprk)": "257",
  "korea, south": "258",
  "kosovo": "064",
  "kuwait": "226",
  "kyrgyzstan": "054",
  "laos": "260",
  "latvia": "019",
  "lebanon": "208",
  "lesotho": "152",
  "liberia": "170",
  "libya": "171",
  "liechtenstein": "086",
  "lithuania": "020",
  "luxembourg": "013",
  "macao": "261",
  "macedonia": "070",
  "madagascar": "172",
  "madeira": "036",
  "malawi": "111",
  "malaysia": "242",
  "maldives": "901",
  "mali": "173",
  "malta": "030",
  "marinas": "833",
  "marshall is": "230",
  "marshall islands": "834",
  "martinique": "655",
  "mauritania": "174",
  "mauritius": "902",
  "mayotte": "906",
  "mexico": "501",
  "micronesia": "259",
  "moldova": "055",
  "monaco": "087",
  "mongolia": "262",
  "montenegro": "063",
  "montserrat": "627",
  "morocco": "133",
  "mozambique": "175",
  "namibia": "122",
  "nauru": "341",
  "nepal": "264",
  "netherlands antilles, the": "652",
  "netherlands, the": "031",
  "nevis": "628",
  "new caledonia": "822",
  "new zealand": "339",
  "newfoundland, dominion of": "512",
  "nicaragua": "546",
  "niger": "176",
  "nigeria": "177",
  "niue": "414",
  "north vietnam": "271",
  "northern ireland": "006",
  "northern mariana islands": "830",
  "norway": "032",
  "oceania nes": "899",
  "oman": "263",
  "pakistan": "209",
  "palau": "229",
  "palestinian authority": "213",
  "panama": "547",
  "panama canal zone": "548",
  "papau": "343",
  "papua new guinea": "342",
  "paraguay": "755",
  "peru": "723",
  "philippines": "227",
  "pitcairn islands": "842",
  "poland": "033",
  "portugal": "034",
  "puerto rico": "656",
  "qatar": "265",
  "republic of congo": "159",
  "republic of palau": "836",
  "romania": "088",
  "russia": "056",
  "rwanda": "179",
  "réunion": "903",
  "saint helena": "915",
  "saint kitts and nevis": "629",
  "saint lucia": "630",
  "saint pierre and miquelon": "531",
  "saint-barthelemy": "407",
  "saint-martin": "415",
  "samoa": "844",
  "samoa, american": "843",
  "san marino": "089",
  "sao tome and principe": "914",
  "saudi arabia": "231",
  "scotland": "007",
  "senegal": "180",
  "serbia and montenegro": "061",
  "serbia, republic of": "062",
  "seychelles": "904",
  "sierra leone": "181",
  "sikkim (asia)": "266",
  "singapore": "246",
  "sint-maarten": "416",
  "slovakia": "016",
  "slovenia": "047",
  "soloman islands": "825",
  "solomon islands": "824",
  "somalia": "182",
  "south africa, republic of": "121",
  "south america nes": "799",
  "south sudan": "189",
  "spain": "037",
  "sri lanka": "201",
  "st. vincent and the grenadines": "631",
  "stateless": "979",
  "sudan": "185",
  "suriname": "752",
  "swaziland": "186",
  "sweden": "040",
  "switzerland": "041",
  "syria": "210",
  "taiwan": "203",
  "tajikistan": "057",
  "tanzania": "130",
  "thailand": "267",
  "togo": "187",
  "tokelau": "417",
  "tonga": "846",
  "trinidad and tobago": "605",
  "tuamotu archipelago": "847",
  "tunisia": "135",
  "turkey": "045",
  "turkmenistan": "058",
  "turks and caicos islands": "632",
  "tuvalu": "826",
  "u.s. minor outlying islands": "418",
  "uk - brit. ntl. overseas": "010",
  "uk - brit. overseas citizen": "004",
  "uk - brit. overseas terr.": "005",
  "uk - brit. protected person": "917",
  "uk - british citizen": "003",
  "uk - british subject": "001",
  "un or official": "980",
  "un specialized agency": "981",
  "uganda": "136",
  "ukraine": "059",
  "union of soviet socialist rep": "042",
  "united arab emirates": "280",
  "united states of america": "461",
  "unknown": "000",
  "uruguay": "724",
  "uzbekistan": "060",
  "vanuatu": "823",
  "vatican city state": "090",
  "venezuela": "725",
  "vietnam": "270",
  "virgin islands, u.s.": "657",
  "wales": "008",
  "wallis and futuna is., terr.": "841",
  "west indies nes": "699",
  "western sahara": "184",
  "yemen": "273",
  "yemen, people's dem. rep": "274",
  "yugoslavia": "044",
  "zambia": "112",
  "zimbabwe": "113",
};

// Common aliases — what people actually type
export const COUNTRY_ALIASES: Record<string, string> = {
  "usa": "461",
  "us": "461",
  "u.s.": "461",
  "u.s.a.": "461",
  "america": "461",
  "united states": "461",
  "united kingdom": "247",   // UK
  "uk": "247",
  "england": "247",
  "britain": "247",
  "great britain": "247",
  "uae": "210",
  "u.a.e.": "210",
  "emirates": "210",
  "south korea": "189",
  "korea": "189",   // assume south korea unless DPRK explicit
  "burma": "262",   // Myanmar
};

// ── Province codes ──
export const PROVINCE_CODES: Record<string, string> = {
  "ab": "09",
  "bc": "11",
  "mb": "07",
  "nb": "04",
  "nl": "01",
  "ns": "03",
  "nt": "10",
  "nu": "64",
  "on": "06",
  "pe": "02",
  "qc": "05",
  "sk": "08",
  "yt": "12",
};

export const PROVINCE_ALIASES: Record<string, string> = {
  "alberta": "09",
  "british columbia": "11",
  "b.c.": "11",
  "manitoba": "07",
  "new brunswick": "04",
  "newfoundland": "01",
  "newfoundland and labrador": "01",
  "nova scotia": "03",
  "northwest territories": "10",
  "nunavut": "64",
  "ontario": "06",
  "prince edward island": "02",
  "p.e.i.": "02",
  "quebec": "05",
  "qu\u00e9bec": "05",
  "saskatchewan": "08",
  "yukon": "12",
};

// ── Marital status codes ──
export const MARITAL_CODES: Record<string, string> = {
  "annulled marriage": "09",
  "common-law": "03",
  "divorced": "04",
  "married": "01",
  "separated": "05",
  "single": "02",
  "unknown": "00",
  "widowed": "06",
};

export const MARITAL_ALIASES: Record<string, string> = {
  "common law": "03",
  "common-law partner": "03",
  "common law partner": "03",
  "cl": "03",
  "married/cl": "01",  // assume married if mixed
  "single/never married": "02",
  "never married": "02",
};

// ── Phone type codes ──
// Note: IRCC's official 'mobile' is called 'Cellular' (code 02)
export const PHONE_TYPE_CODES: Record<string, string> = {
  "business": "03",
  "cellular": "02",
  "entered in error": "06",
  "other": "05",
  "residence": "01",
};

export const PHONE_TYPE_ALIASES: Record<string, string> = {
  "mobile": "02",     // → Cellular
  "cell": "02",
  "cellphone": "02",
  "cell phone": "02",
  "home": "01",       // → Residence
  "work": "03",       // → Business
};

// ── Visit purpose codes (original entry to Canada) ──
export const VISIT_PURPOSE_CODES: Record<string, string> = {
  "business": "01",
  "family visit": "06",
  "other": "03",
  "study": "04",
  "tourism": "02",
  "work": "05",
};

export const VISIT_PURPOSE_ALIASES: Record<string, string> = {
  "study permit": "04",
  "studies": "04",
  "studying": "04",
  "school": "04",
  "college": "04",
  "university": "04",
  "work permit": "05",
  "working": "05",
  "job": "05",
  "tourism": "02",
  "tourist": "02",
  "visit": "02",
  "visiting": "02",
  "trv": "02",
  "vacation": "02",
  "holiday": "02",
  "family": "06",
  "visit family": "06",
};

// ── Immigration status codes (current status in Canada) ──
export const STATUS_CODES: Record<string, string> = {
  "citizen": "01",
  "foreign national": "09",
  "other": "06",
  "permanent resident": "02",
  "protected person": "07",
  "refugee claimant": "08",
  "student": "05",
  "visitor": "03",
  "worker": "04",
};

export const STATUS_ALIASES: Record<string, string> = {
  "study permit": "05",  // → Student
  "student visa": "05",
  "work permit": "04",   // → Worker
  "pgwp": "04",          // PGWP holder = Worker
  "trv": "03",           // → Visitor
  "tourist": "03",
  "pr": "02",
  "permanent": "02",
};

// ── Native language codes (from IRCC's ContactLanguage LOV) ──
// Full list has 474 languages; this is the ~30 Newton sees most.
export const LANGUAGE_CODES: Record<string, string> = {
  "arabic": "250",
  "bengali": "322",
  "cantonese": "300",
  "dari": "195",
  "english": "001",
  "farsi": "223",
  "french": "002",
  "german": "116",
  "gujarati": "330",
  "hindi": "321",
  "italian": "123",
  "japanese": "303",
  "kannada": "612",
  "korean": "305",
  "malayalam": "323",
  "mandarin": "301",
  "marathi": "332",
  "nepali": "320",
  "pashto": "326",
  "persian": "251",
  "polish": "115",
  "portuguese": "122",
  "punjabi": "324",
  "russian": "101",
  "sinhala": "328",
  "spanish": "120",
  "tagalog": "309",
  "tamil": "327",
  "telugu": "334",
  "thai": "307",
  "turkish": "131",
  "ukrainian": "106",
  "urdu": "325",
  "vietnamese": "306",
};

export const LANGUAGE_ALIASES: Record<string, string> = {
  "filipino": "309",       // → Tagalog
  "pilipino": "309",
  "tagalog": "309",
  "chinese": "301",        // → Mandarin (most common Chinese in Canada)
  "putonghua": "301",
  "farsi": "223",
  "iranian": "223",
  "persian": "251",
  "ukrainian": "104",
  "italian": "036",
  "polish": "098",
  "german": "017",
  "portuguese": "100",
  "japanese": "303",
  "russian": "101",
};

// ── Sex / gender codes ──
export const SEX_CODES: Record<string, string> = {
  "female": "F Female",
  "male": "M Male",
  "unknown": "U Unknown",
  "unspecified": "X Another gender",
};

export const SEX_ALIASES: Record<string, string> = {
  "f": "F Female",
  "m": "M Male",
  "u": "U Unknown",
  "x": "X Another gender",
  "non-binary": "X Another gender",
  "other": "X Another gender",
};

// ─── Lookup helpers (case-insensitive, alias-aware) ───

function lookup(table: Record<string, string>, aliases: Record<string, string>, raw: string): string {
  if (!raw) return "";
  const key = raw.toLowerCase().trim();
  if (table[key]) return table[key];
  if (aliases[key]) return aliases[key];
  // Last resort: try first word only (e.g., 'India ' or 'India,')
  const firstWord = key.split(/[\s,]+/)[0];
  if (firstWord && table[firstWord]) return table[firstWord];
  if (firstWord && aliases[firstWord]) return aliases[firstWord];
  return "";
}

export const textToCountryCode = (raw: string): string =>
  lookup(COUNTRY_CODES, COUNTRY_ALIASES, raw);

export const textToProvinceCode = (raw: string): string =>
  lookup(PROVINCE_CODES, PROVINCE_ALIASES, raw);

export const textToMaritalCode = (raw: string): string =>
  lookup(MARITAL_CODES, MARITAL_ALIASES, raw);

export const textToPhoneTypeCode = (raw: string): string =>
  lookup(PHONE_TYPE_CODES, PHONE_TYPE_ALIASES, raw);

export const textToVisitPurposeCode = (raw: string): string =>
  lookup(VISIT_PURPOSE_CODES, VISIT_PURPOSE_ALIASES, raw);

export const textToStatusCode = (raw: string): string =>
  lookup(STATUS_CODES, STATUS_ALIASES, raw);

export const textToLanguageCode = (raw: string): string =>
  lookup(LANGUAGE_CODES, LANGUAGE_ALIASES, raw);

export const textToSexCode = (raw: string): string =>
  lookup(SEX_CODES, SEX_ALIASES, raw);
