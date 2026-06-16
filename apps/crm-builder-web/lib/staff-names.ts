// ─────────────────────────────────────────────────────────────────────
// Staff name canonicalizer — the single place that collapses a free-text
// assignee / note-author name onto a real staff account name, so a person's
// stats don't fragment across spelling variants.
//
// Three tiers, safest first:
//   1. exact full-name match
//   2. unique first-name match ("Sukhman" -> "Sukhman Kaur" when only one)
//   3. CONSERVATIVE 1-edit fuzzy on the first name ("sarbleen" -> "Serbleen
//      Kaur") — only when exactly one staff first name is within edit distance 1
//      and it maps to exactly one account, so we never merge two real people.
//
// Returns "" for blank / "unassigned".
// The proper long-term fix is keying on user IDs (see roadmap); this keeps the
// existing name-based boards honest until then.
// ─────────────────────────────────────────────────────────────────────

export function normName(s: string): string {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

export type Canonicalizer = (raw: string) => string;

// Returns the staff DISPLAY name (original casing). "" for blank/unassigned;
// the trimmed input unchanged when no staff account matches.
export function buildCanonicalizer(staffNames: string[]): Canonicalizer {
  const normToDisp = new Map<string, string>();
  const firstToDisp = new Map<string, string[]>();
  for (const name of staffNames) {
    const disp = String(name || "").trim();
    const n = normName(disp);
    if (!n) continue;
    normToDisp.set(n, disp);
    const f = n.split(" ")[0];
    const arr = firstToDisp.get(f) || [];
    if (!arr.includes(disp)) arr.push(disp);
    firstToDisp.set(f, arr);
  }
  const firstNames = Array.from(firstToDisp.keys());

  const PLACEHOLDER = new Set(["unassigned", "n/a", "na", "n.a.", "none", "tbd", "test", "—", "-"]);
  return (raw: string): string => {
    const n = normName(raw);
    if (!n || PLACEHOLDER.has(n)) return "";
    if (normToDisp.has(n)) return normToDisp.get(n)!;
    const f = n.split(" ")[0];

    const exact = firstToDisp.get(f);
    if (exact && exact.length === 1) return exact[0];

    // Conservative fuzzy — only for longer first names (>=6 chars), so short
    // common names like Karan/Kiran or Sima/Simi are never merged.
    if (f.length >= 6) {
      const near = firstNames.filter((sf) => sf !== f && levenshtein(sf, f) <= 1);
      if (near.length === 1) {
        const arr = firstToDisp.get(near[0])!;
        if (arr.length === 1) return arr[0];
      }
    }
    return String(raw || "").trim();
  };
}
