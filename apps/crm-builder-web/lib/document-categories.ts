/**
 * Document categorization for PGWP submission packaging.
 *
 * Infers a document's category from its filename, since the CRM doesn't
 * currently have an explicit `documentCategory` field. We use case-insensitive
 * keyword matching against the filename.
 *
 * If/when an explicit category field is added to the document model, replace
 * `categorizeDocumentByFilename` with a direct lookup on that field.
 *
 * Categories used:
 *   - passport          → IRCC passport copy
 *   - photo             → digital photo
 *   - study_permit      → current or previous study permit
 *   - language_test     → IELTS / CELPIP / TEF / TCF score report
 *   - transcript        → academic transcript (current or previous school)
 *   - completion_letter → program completion letter
 *   - loa               → letter of acceptance
 *   - bank_statement    → financial documents (not used for PGWP, included for completeness)
 *   - imm_form          → IRCC form PDFs (5710, 5476, etc.) — auto-generated, excluded from bundles
 *   - submission_letter → representative submission letter — auto-generated, excluded from bundles
 *   - other             → anything not matched
 */

export type DocCategory =
  | "passport"
  | "photo"
  | "study_permit"
  | "work_permit"
  | "language_test"
  | "transcript"
  | "completion_letter"
  | "loa"
  | "medical"
  | "bank_statement"
  | "imm_form"
  | "submission_letter"
  | "other";

interface CategoryRule {
  category: DocCategory;
  // Filename patterns (case-insensitive substring match). First-match wins.
  patterns: RegExp[];
}

// Order matters: more specific rules first. For example `imm_form` must match
// before `study_permit` so an "IMM 5710 Study Permit Application" form goes to
// `imm_form` rather than `study_permit`.
const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "imm_form",
    patterns: [/\bimm[\s_-]?\d{4}/i, /\b5710[a-z]?\b/i, /\b5476[a-z]?\b/i, /\b5709[a-z]?\b/i],
  },
  {
    category: "submission_letter",
    patterns: [
      /representative\s+submission/i,
      /submission\s+letter/i,
      /support\s+letter/i,
      // Newton's actual generated filename pattern: "<Client> - Representative Letter.pdf"
      /representative\s+letter/i,
      // Alt generator produces: "<Client>_Rep_Letter.docx" — \b doesn't work
      // around underscores, so match either separator explicitly.
      /(^|[\s_-])rep[\s_-]+letter([\s_-]|\.|$)/i,
    ],
  },
  {
    category: "completion_letter",
    patterns: [/completion\s+letter/i, /\bcompletion\b/i, /program\s+complet/i],
  },
  {
    category: "loa",
    patterns: [
      /letter\s+of\s+acceptance/i,
      /\bloa\b/i,
      /\boffer\s+letter/i,
      /admission\s+letter/i,
    ],
  },
  {
    category: "transcript",
    patterns: [/\btranscript/i, /academic\s+record/i, /grade\s+report/i],
  },
  {
    category: "language_test",
    patterns: [
      /\bielts\b/i,
      /\bcelpip\b/i,
      /\btef\b/i,
      /\btcf\b/i,
      /test\s+report\s+form/i,
      /\btrf\b/i,
      /language\s+(test|proficiency)/i,
    ],
  },
  {
    category: "work_permit",
    patterns: [
      /work\s+permit/i,
      /\bWP\b/i,
    ],
  },
  {
    category: "study_permit",
    patterns: [
      /study\s+permit/i,
      /\bstudent\s+visa\b/i,
      /\bSP\s+extension\b/i,
      // Naked "permit" is too aggressive (matches work permit etc.); require qualifier
    ],
  },
  {
    category: "photo",
    patterns: [
      /digital\s+(picture|photo)/i,
      /passport\s+photo/i,
      /\bphoto\b/i,
      /\bpicture\b/i,
      /\bheadshot\b/i,
    ],
  },
  {
    category: "passport",
    patterns: [/\bpassport\b/i, /travel\s+document/i],
  },
  {
    category: "medical",
    patterns: [
      /medical[\s_-]+exam/i,
      /upfront[\s_-]+medical/i,
      /immigration[\s_-]+medical/i,
      /\bIME\b/,
      /panel[\s_-]+physician/i,
      /\beMedical\b/i,
      // Bare "medical" only as a fallback if nothing more specific matched
      // (placed last so terms like "medical exam" hit the specific rule first)
      /(^|[\s_-])medical([\s_-]|\.|$)/i,
    ],
  },
  {
    category: "bank_statement",
    patterns: [/bank\s+statement/i, /financial\s+statement/i, /proof\s+of\s+funds/i],
  },
];

export function categorizeDocumentByFilename(filename: string): DocCategory {
  if (!filename) return "other";
  // Strip directory portion if present
  const name = filename.split("/").pop() || filename;
  for (const rule of CATEGORY_RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(name)) return rule.category;
    }
  }
  return "other";
}

/**
 * Inclusion order for the PGWP Client_Info bundle (Increment 2 of submission package automation).
 * Per scope confirmed by Newton:
 *   1. Current study permit
 *   2. Previous study permit (if exists — included as additional study_permit docs)
 *   3. Language test (IELTS / CELPIP / etc.)
 *   4. Previous school transcripts (if applicant switched schools)
 *   5. Previous school LOA / acceptance letters
 *
 * Within each category, docs are sorted by upload date (newest first), matching
 * the typical "current then historical" reading order.
 */
/**
 * Inclusion order for the Client_Info bundle. Order confirmed with Newton:
 *   1. Current + previous study/work permits
 *   2. English language test (IELTS / CELPIP)
 *   3. Older transcripts (previous schools)
 *   4. Older LOAs (previous schools)
 *   5. Medical exam (if uploaded)
 *
 * "Other" docs are explicitly NOT bundled — staff handles them manually.
 *
 * Within each category, docs are sorted by upload date (newest first), matching
 * the typical "current then historical" reading order.
 */
export const PGWP_CLIENT_INFO_BUNDLE_ORDER: DocCategory[] = [
  "study_permit",
  "work_permit",
  "language_test",
  "transcript",
  "loa",
  "medical",
];

/**
 * Categories that the SUBMISSION PACKAGE includes as standalone (top-level) files,
 * NOT bundled into Client_Info.
 *   - passport                → Passport_<First>_<Last>.pdf
 *   - photo                   → Photo_<First>_<Last>.jpg
 *   - completion_letter       → Completion_Letter_<First>_<Last>.pdf
 *   - transcript (CURRENT)    → Transcript_<First>_<Last>.pdf
 *     (Note: only the most-recent / current-school transcript is top-level. Older
 *      school transcripts go into Client_Info bundle. Heuristic in the orchestration
 *      endpoint will pick which is "current" — likely the most-recently uploaded.)
 *   - imm_form                → IMM5710e_<First>_<Last>.pdf, IMM5476e_<First>_<Last>.pdf
 *   - submission_letter       → Representative_Submission_Letter_<First>_<Last>.pdf
 */
export const PGWP_TOP_LEVEL_CATEGORIES: DocCategory[] = [
  "passport",
  "photo",
  "completion_letter",
  "transcript",          // ONLY the current school's; older ones go into bundle
  "imm_form",
  "submission_letter",
];
