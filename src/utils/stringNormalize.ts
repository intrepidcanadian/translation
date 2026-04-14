/**
 * Shared string normalization helpers for dictionary-style lookups
 * (offline phrase dictionary, glossary, etc.).
 *
 * Trailing punctuation is stripped so "hello!" / "hello" / "hello?" all resolve
 * to the same key — case is folded to lowercase for latin scripts but matters
 * in most non-latin scripts, which is fine because those scripts don't
 * typically have case.
 */
const TRAILING_PUNCT = /[?!.,。？！、]+$/;

/**
 * Normalize a single string for dictionary lookup:
 *  - trim whitespace
 *  - lowercase
 *  - strip trailing punctuation (ASCII + CJK)
 */
export function normalizeForLookup(s: string): string {
  return s.trim().toLowerCase().replace(TRAILING_PUNCT, "");
}

/**
 * Build a composite lookup key for per-language-pair dictionaries.
 * Keeps formatting consistent between offlinePhrases.ts and GlossaryContext
 * so changing the key shape in one place doesn't silently diverge.
 */
export function lookupKey(...parts: string[]): string {
  return parts.join("|");
}
