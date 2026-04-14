/**
 * Pure validation helpers for the user glossary.
 *
 * Extracted from GlossaryContext so a jest-environment-node test can exercise
 * the #130 load-time validator and #130-follow-up corruption threshold
 * directly, without reaching through React context plumbing. The context
 * still owns the AsyncStorage read, the state machine, and the log calls —
 * this module only answers "is a single entry well-formed?" and "is this
 * parsed payload too broken to trust?".
 */

export interface GlossaryEntry {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
}

/**
 * BCP-47-ish language code matcher. Two or three lowercase letters, optional
 * region subtag of 2–4 alphanumeric chars. Tight enough to reject blank
 * strings, numeric rows, or stray metadata; loose enough to accept real
 * entries like `en`, `zh-CN`, `pt-BR`, `nan-Hant`.
 *
 * Any change here must stay compile-safe with the LANGUAGES table in
 * src/services/translation.ts — all 20 supported codes pass this regex.
 */
export const LANG_CODE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/**
 * Single-entry validator. Returns a type predicate so the caller can
 * narrow `unknown[]` to `GlossaryEntry[]` after `Array.prototype.filter`.
 * Rejects:
 *   - non-object / null
 *   - missing or non-string `source` / `target`
 *   - blank `source` / `target` (whitespace-only strings)
 *   - language codes that don't match LANG_CODE_RE (#130 ghost-row fix)
 */
export function isValidGlossaryEntry(e: unknown): e is GlossaryEntry {
  if (!e || typeof e !== "object") return false;
  const entry = e as Record<string, unknown>;
  if (typeof entry.source !== "string" || entry.source.trim() === "") return false;
  if (typeof entry.target !== "string" || entry.target.trim() === "") return false;
  if (typeof entry.sourceLang !== "string" || !LANG_CODE_RE.test(entry.sourceLang)) return false;
  if (typeof entry.targetLang !== "string" || !LANG_CODE_RE.test(entry.targetLang)) return false;
  return true;
}

/**
 * If more than this ratio of parsed entries fail validation, the caller
 * should treat the payload as structurally corrupted and fall back to an
 * empty glossary rather than leaking a half-sanitized dictionary.
 *
 * 0.5 is deliberately lenient — the common case is a stray bad CSV import
 * adding a handful of bogus rows that we still want to keep around the
 * valid ones. A true file corruption usually wrecks almost everything and
 * trips this guard. Tune only if real prod data justifies it (#137).
 */
export const CORRUPTION_DROP_RATIO = 0.5;

export interface GlossaryValidationResult {
  /** Entries that passed `isValidGlossaryEntry`. */
  valid: GlossaryEntry[];
  /** How many rows in the parsed payload were rejected. */
  dropped: number;
  /**
   * True when the drop ratio exceeds CORRUPTION_DROP_RATIO for a non-empty
   * payload — caller should fall back to empty rather than use `valid`.
   */
  corrupted: boolean;
}

/**
 * Runs every parsed row through `isValidGlossaryEntry` and decides whether
 * the payload is trustworthy. An empty `parsed` array returns `corrupted:
 * false` (empty glossary is a legitimate state, not corruption).
 */
export function validateGlossaryPayload(parsed: unknown[]): GlossaryValidationResult {
  const valid = parsed.filter(isValidGlossaryEntry);
  const dropped = parsed.length - valid.length;
  const corrupted = parsed.length > 0 && dropped / parsed.length > CORRUPTION_DROP_RATIO;
  return { valid, dropped, corrupted };
}
