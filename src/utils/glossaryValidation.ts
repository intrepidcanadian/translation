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

/**
 * Outcome codes from `resolveGlossaryLoad`. Callers use this to decide
 * whether to surface a warning, whether to rewrite the backup key, and
 * what went into the live glossary state.
 *
 *   - "primary"          primary payload was valid (or partially valid);
 *                        `entries` holds the valid rows.
 *   - "backup"           primary was majority-corrupted but the backup
 *                        was trustworthy; `entries` came from the backup.
 *   - "empty-corrupted"  primary was corrupted AND the backup was either
 *                        missing or also corrupted; `entries` is empty.
 *   - "empty-fresh"      neither key held any data; first launch state.
 */
export type GlossaryLoadOutcome =
  | "primary"
  | "backup"
  | "empty-corrupted"
  | "empty-fresh";

export interface GlossaryLoadResolution {
  outcome: GlossaryLoadOutcome;
  /** Rows that should end up in the live glossary. */
  entries: GlossaryEntry[];
  /**
   * How many rows were dropped during the successful validation run (from
   * whichever source produced `entries`). Useful so the caller can log
   * "dropped N malformed rows" without re-validating.
   */
  dropped: number;
  /**
   * True when the caller should rewrite the backup key from `entries`.
   * Only set on "primary" outcomes with at least one valid row — the
   * backup tracks the last confirmed-good primary payload, not intermediate
   * partially-corrupted states and not the backup itself (rewriting it with
   * itself is pointless).
   */
  rewriteBackup: boolean;
}

/**
 * Pure resolver for the glossary load path (#137). Given the already-parsed
 * primary payload and backup payload (both `null` when the underlying
 * AsyncStorage key was absent, both arrays when present), decides what the
 * live glossary should hold and whether the backup should be refreshed.
 *
 * The flow:
 *   1. Primary is valid (or partially valid under the corruption threshold)
 *      → use primary, rewrite backup to match.
 *   2. Primary is corrupted but backup is valid (partial allowed)
 *      → restore from backup, do NOT rewrite the backup (would clobber a
 *      known-good snapshot with itself).
 *   3. Primary is corrupted and backup is missing or also corrupted
 *      → fall back to empty.
 *   4. Primary is absent (fresh install or wiped by Reset Everything)
 *      → fall back to backup if available, otherwise "empty-fresh".
 *
 * Extracted from GlossaryContext so it can be unit-tested without an
 * AsyncStorage mock and so the decision tree stays readable.
 */
export function resolveGlossaryLoad(
  parsedPrimary: unknown,
  parsedBackup: unknown
): GlossaryLoadResolution {
  const primaryArr = Array.isArray(parsedPrimary) ? (parsedPrimary as unknown[]) : null;
  const backupArr = Array.isArray(parsedBackup) ? (parsedBackup as unknown[]) : null;

  // Case 4a: no primary AND no backup → fresh install.
  if (!primaryArr && !backupArr) {
    return { outcome: "empty-fresh", entries: [], dropped: 0, rewriteBackup: false };
  }

  if (primaryArr) {
    const primaryResult = validateGlossaryPayload(primaryArr);
    if (!primaryResult.corrupted) {
      // Case 1: primary is trustworthy. Even an empty-but-valid primary
      // rewrites the backup so a legitimate "I cleared my glossary" state
      // propagates to the backup eventually; but we only rewrite when we
      // have at least one row so a momentary 0-row parse glitch can't
      // erase a good backup.
      return {
        outcome: "primary",
        entries: primaryResult.valid,
        dropped: primaryResult.dropped,
        rewriteBackup: primaryResult.valid.length > 0,
      };
    }
  }

  // Primary missing or corrupted — try the backup.
  if (backupArr) {
    const backupResult = validateGlossaryPayload(backupArr);
    if (!backupResult.corrupted && backupResult.valid.length > 0) {
      return {
        outcome: "backup",
        entries: backupResult.valid,
        dropped: backupResult.dropped,
        rewriteBackup: false,
      };
    }
  }

  // Corrupted primary and no usable backup — the #130 fall-back-to-empty
  // behavior, preserved unchanged.
  if (primaryArr) {
    return { outcome: "empty-corrupted", entries: [], dropped: primaryArr.length, rewriteBackup: false };
  }
  // Primary absent, backup exists but is corrupted — "fresh-ish" state.
  // Treat as fresh install rather than corrupted since the user never had
  // a valid primary in this session.
  return { outcome: "empty-fresh", entries: [], dropped: 0, rewriteBackup: false };
}
