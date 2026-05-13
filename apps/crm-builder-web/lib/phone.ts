/**
 * Centralized phone-number normalization for the Newton CRM.
 *
 * Background: previously, two different normalization logics existed in
 * different places:
 *
 *   (a) app/api/whatsapp/route.ts canonicalized to "1XXXXXXXXXX" for North
 *       American numbers before writing to whatsapp_inbox.
 *
 *   (b) lib/whatsapp-ai-intake.ts used a digits-only form and bidirectional
 *       suffix match (n.endsWith(cp) || cp.endsWith(n)) for lookups.
 *
 * These mostly worked together because of the suffix-match's symmetry, but
 * (1) the dual code paths drift over time, and (2) bidirectional suffix
 * match can produce false positives for very short stored phones.
 *
 * This module is the SINGLE source of truth. New code should call
 * normalizePhone() for any phone touching the DB or any phone comparison.
 *
 * Existing stored data may NOT be normalized — see legacy notes below.
 */

/**
 * Canonical phone form. Strips all non-digit characters; for North American
 * numbers (10 digits), prepends "1". Other lengths are returned as the
 * digits-only string.
 *
 * Examples:
 *   normalizePhone("+1 (604) 123-4567")   -> "16041234567"
 *   normalizePhone("604-123-4567")        -> "16041234567"
 *   normalizePhone("16041234567")         -> "16041234567"
 *   normalizePhone("447911123456")        -> "447911123456"   (UK, unchanged)
 *   normalizePhone(null)                   -> ""
 *   normalizePhone(undefined)              -> ""
 */
export function normalizePhone(raw: unknown): string {
  if (raw == null) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return "1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return digits;
}

/**
 * Returns the canonical last-10-digits form of a phone, for fuzzy matching
 * against legacy unnormalized data. Use this for the lookup side when you
 * cannot guarantee the stored value is normalized.
 *
 * Example:
 *   phoneLast10("16041234567") -> "6041234567"
 *   phoneLast10("604-123-4567") -> "6041234567"
 */
export function phoneLast10(raw: unknown): string {
  if (raw == null) return "";
  const digits = String(raw).replace(/\D/g, "");
  return digits.slice(-10);
}

/**
 * True if two phones refer to the same number under canonical normalization.
 * Uses last-10-digits comparison for North American numbers; falls back to
 * full digits-only equality otherwise.
 *
 * Robust against:
 *   - "+1 (604) 123-4567" vs "6041234567" vs "16041234567"
 *   - leading/trailing whitespace, separators
 *   - null/undefined (returns false)
 */
export function samePhone(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  const da = String(a).replace(/\D/g, "");
  const db = String(b).replace(/\D/g, "");
  if (da.length === 0 || db.length === 0) return false;
  // For NA numbers (10-11 digits) compare on last 10 to absorb the "1" prefix.
  if (da.length >= 10 && db.length >= 10) {
    return da.slice(-10) === db.slice(-10);
  }
  // Non-NA: exact digits-only comparison.
  return da === db;
}
