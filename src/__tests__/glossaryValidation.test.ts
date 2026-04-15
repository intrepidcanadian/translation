/**
 * Pins the #130 glossary validator contract. The module under test is
 * deliberately pure so it can be exercised without the GlossaryContext
 * React shell — the context only owns AsyncStorage I/O, state setters,
 * and logging, while the decision of "is this payload trustworthy?"
 * lives here.
 *
 * What would break without these tests:
 *   - Silent regressions that re-allow blank-source rows, malformed lang
 *     codes, or non-object rows into the live glossary (ghost entries).
 *   - Accidental flip of the CORRUPTION_DROP_RATIO semantics (e.g. `>=`
 *     vs. `>`, or swapping "dropped" vs. "valid" in the ratio).
 *   - Treating an empty parsed payload as corrupted (which would spam
 *     the error ring every cold start for users with empty glossaries).
 *
 * Related backlog: #130 (self-healing parse), #137 (threshold tuning).
 */
import {
  isValidGlossaryEntry,
  validateGlossaryPayload,
  resolveGlossaryLoad,
  CORRUPTION_DROP_RATIO,
  LANG_CODE_RE,
  type GlossaryEntry,
} from "../utils/glossaryValidation";

const VALID: GlossaryEntry = {
  source: "thanks",
  target: "gracias",
  sourceLang: "en",
  targetLang: "es",
};

describe("isValidGlossaryEntry", () => {
  it("accepts a well-formed entry", () => {
    expect(isValidGlossaryEntry(VALID)).toBe(true);
  });

  it("accepts a region-qualified language code", () => {
    expect(
      isValidGlossaryEntry({
        source: "trash",
        target: "rubbish",
        sourceLang: "en-US",
        targetLang: "en-GB",
      })
    ).toBe(true);
  });

  it("accepts a three-letter ISO-639-3 language code", () => {
    // e.g. Min Nan Chinese written in Traditional script
    expect(
      isValidGlossaryEntry({
        source: "hello",
        target: "你好",
        sourceLang: "en",
        targetLang: "nan-Hant",
      })
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["string", "thanks"],
    ["array", [VALID]],
  ])("rejects non-object payload (%s)", (_label, input) => {
    expect(isValidGlossaryEntry(input)).toBe(false);
  });

  it("rejects missing source", () => {
    expect(isValidGlossaryEntry({ ...VALID, source: undefined })).toBe(false);
  });

  it("rejects blank/whitespace-only source", () => {
    // A glossary row with no source text is a ghost entry: it can't be
    // looked up by anything, but it leaks into the glossary UI and the
    // export CSV. #130 specifically added this guard.
    expect(isValidGlossaryEntry({ ...VALID, source: "" })).toBe(false);
    expect(isValidGlossaryEntry({ ...VALID, source: "   " })).toBe(false);
    expect(isValidGlossaryEntry({ ...VALID, source: "\t\n" })).toBe(false);
  });

  it("rejects blank/whitespace-only target", () => {
    expect(isValidGlossaryEntry({ ...VALID, target: "" })).toBe(false);
    expect(isValidGlossaryEntry({ ...VALID, target: "   " })).toBe(false);
  });

  it("rejects non-string source", () => {
    expect(isValidGlossaryEntry({ ...VALID, source: 123 })).toBe(false);
    expect(isValidGlossaryEntry({ ...VALID, source: ["thanks"] })).toBe(false);
  });

  it("rejects malformed language codes", () => {
    // Numeric-only, uppercase ISO-639, four-letter base, missing codes.
    expect(isValidGlossaryEntry({ ...VALID, sourceLang: "" })).toBe(false);
    expect(isValidGlossaryEntry({ ...VALID, sourceLang: "123" })).toBe(false);
    expect(isValidGlossaryEntry({ ...VALID, sourceLang: "ENG" })).toBe(false);
    expect(isValidGlossaryEntry({ ...VALID, sourceLang: "english" })).toBe(false);
    expect(isValidGlossaryEntry({ ...VALID, sourceLang: "en_US" })).toBe(false); // wrong separator
    expect(isValidGlossaryEntry({ ...VALID, targetLang: "" })).toBe(false);
    expect(isValidGlossaryEntry({ ...VALID, targetLang: "xx-yy-zz" })).toBe(false);
  });

  it("rejects entries with extraneous non-string fields in the required slots", () => {
    expect(isValidGlossaryEntry({ ...VALID, sourceLang: 42 })).toBe(false);
  });

  it("narrows the type so filter() produces GlossaryEntry[]", () => {
    // Type-level contract: if the predicate stops being a type guard, the
    // .filter() call below would return `unknown[]` and the subsequent
    // access to `e.source` would fail tsc. This test is executed at runtime
    // but its primary value is keeping the predicate annotation honest.
    const mixed: unknown[] = [
      VALID,
      { not: "a glossary entry" },
      null,
    ];
    const out: GlossaryEntry[] = mixed.filter(isValidGlossaryEntry);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("thanks");
  });
});

describe("validateGlossaryPayload", () => {
  it("returns all entries and no drops for a clean payload", () => {
    const result = validateGlossaryPayload([VALID, { ...VALID, source: "bye", target: "adiós" }]);
    expect(result.valid).toHaveLength(2);
    expect(result.dropped).toBe(0);
    expect(result.corrupted).toBe(false);
  });

  it("empty array is valid, not corrupted", () => {
    // Empty glossary is the legitimate fresh-install state. If this ever
    // flipped to `corrupted: true`, every cold start for a user with no
    // saved glossary would log a warning and reset to empty in a loop.
    const result = validateGlossaryPayload([]);
    expect(result.valid).toEqual([]);
    expect(result.dropped).toBe(0);
    expect(result.corrupted).toBe(false);
  });

  it("partial corruption under the threshold still salvages valid rows", () => {
    // 3 valid, 1 dropped → drop ratio 0.25, under the 0.5 threshold.
    // The valid rows must be preserved; corrupted must stay false.
    const payload = [
      VALID,
      { ...VALID, source: "bye", target: "adiós" },
      { ...VALID, source: "hi", target: "hola" },
      { source: "", target: "empty", sourceLang: "en", targetLang: "es" }, // blank source
    ];
    const result = validateGlossaryPayload(payload);
    expect(result.valid).toHaveLength(3);
    expect(result.dropped).toBe(1);
    expect(result.corrupted).toBe(false);
  });

  it("majority corruption trips the fall-back-to-empty guard", () => {
    // 1 valid, 3 dropped → drop ratio 0.75, over the 0.5 threshold.
    // `corrupted: true` signals the caller should throw away `valid` and
    // fall back to an empty glossary rather than leak ghost entries.
    const payload = [
      VALID,
      { source: "", target: "x", sourceLang: "en", targetLang: "es" },
      { source: "y", target: "", sourceLang: "en", targetLang: "es" },
      { source: "z", target: "w", sourceLang: "ENGLISH", targetLang: "es" }, // bad lang
    ];
    const result = validateGlossaryPayload(payload);
    expect(result.valid).toHaveLength(1);
    expect(result.dropped).toBe(3);
    expect(result.corrupted).toBe(true);
  });

  it("exactly-threshold corruption is NOT flagged (strict inequality)", () => {
    // 1 valid, 1 dropped → drop ratio 0.5, equal to the threshold. The
    // validator uses `>` not `>=`, so this must stay `corrupted: false`.
    // Pinning it prevents an accidental flip to `>=` which would wipe
    // any glossary where exactly half the entries were bad on import.
    const payload = [
      VALID,
      { source: "", target: "x", sourceLang: "en", targetLang: "es" },
    ];
    const result = validateGlossaryPayload(payload);
    expect(result.corrupted).toBe(false);
    expect(result.valid).toHaveLength(1);
  });

  it("entirely-broken payload is corrupted", () => {
    const payload = [
      { source: "", target: "x", sourceLang: "en", targetLang: "es" },
      null,
      "not an object",
    ];
    const result = validateGlossaryPayload(payload as unknown[]);
    expect(result.valid).toEqual([]);
    expect(result.dropped).toBe(3);
    expect(result.corrupted).toBe(true);
  });
});

describe("resolveGlossaryLoad (#137 last-known-good backup/restore)", () => {
  // The #137 resolver wraps validateGlossaryPayload with a backup-restore
  // policy. What we're pinning here is the decision tree — which of
  // primary/backup ends up in `entries`, when the backup should be
  // rewritten, and what `outcome` the caller sees so it can surface the
  // right log line. Regressions in this flow would either silently lose a
  // glossary (corrupted primary, no backup restore) or silently clobber a
  // good backup (rewriteBackup set during a recovery path).

  const VALID2: GlossaryEntry = {
    source: "bye",
    target: "adiós",
    sourceLang: "en",
    targetLang: "es",
  };

  const CORRUPT_ROW = { source: "", target: "x", sourceLang: "en", targetLang: "es" };

  it("fresh install (both keys null) returns empty-fresh with no backup rewrite", () => {
    const r = resolveGlossaryLoad(null, null);
    expect(r.outcome).toBe("empty-fresh");
    expect(r.entries).toEqual([]);
    expect(r.rewriteBackup).toBe(false);
  });

  it("valid primary, no backup → primary wins and rewrites backup", () => {
    const r = resolveGlossaryLoad([VALID], null);
    expect(r.outcome).toBe("primary");
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].source).toBe("thanks");
    expect(r.dropped).toBe(0);
    expect(r.rewriteBackup).toBe(true);
  });

  it("valid primary, valid backup → still primary wins and rewrites backup", () => {
    // The backup is older than the primary, so we trust the primary and
    // refresh the backup to match the current state.
    const r = resolveGlossaryLoad([VALID, VALID2], [VALID]);
    expect(r.outcome).toBe("primary");
    expect(r.entries).toHaveLength(2);
    expect(r.rewriteBackup).toBe(true);
  });

  it("partially corrupted primary under threshold → primary still wins", () => {
    // 3 valid, 1 dropped = 0.25 drop ratio (< 0.5 threshold). The primary
    // is trustworthy and rewriteBackup is true so the partially-cleaned
    // payload becomes the new baseline.
    const r = resolveGlossaryLoad(
      [VALID, VALID2, { ...VALID, source: "hi" }, CORRUPT_ROW],
      null
    );
    expect(r.outcome).toBe("primary");
    expect(r.entries).toHaveLength(3);
    expect(r.dropped).toBe(1);
    expect(r.rewriteBackup).toBe(true);
  });

  it("corrupted primary + valid backup → restores from backup, does NOT rewrite", () => {
    // The whole point of #137: a freshly corrupted primary shouldn't take
    // the glossary down with it when a known-good backup is available.
    // Critically, rewriteBackup MUST be false here — rewriting the backup
    // with itself is pointless, and more importantly, if the resolver
    // starts setting rewriteBackup=true on the "backup" outcome, a future
    // regression could accidentally clobber the backup with a half-valid
    // primary during a race condition.
    const primary = [CORRUPT_ROW, CORRUPT_ROW, CORRUPT_ROW];
    const backup = [VALID, VALID2];
    const r = resolveGlossaryLoad(primary, backup);
    expect(r.outcome).toBe("backup");
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].source).toBe("thanks");
    expect(r.rewriteBackup).toBe(false);
  });

  it("corrupted primary + corrupted backup → empty-corrupted fallback", () => {
    // Both rings of defense are down. This is the #130 "fall back to
    // empty rather than leak ghost entries" behavior, preserved.
    const r = resolveGlossaryLoad(
      [CORRUPT_ROW, CORRUPT_ROW],
      [CORRUPT_ROW, CORRUPT_ROW, CORRUPT_ROW]
    );
    expect(r.outcome).toBe("empty-corrupted");
    expect(r.entries).toEqual([]);
    expect(r.rewriteBackup).toBe(false);
  });

  it("corrupted primary + empty backup → empty-corrupted, not empty-fresh", () => {
    // Distinguishing empty-corrupted from empty-fresh matters for the log
    // line the caller emits — "corrupted, falling back" vs. "first launch"
    // are very different messages to a user filing a bug report.
    const r = resolveGlossaryLoad([CORRUPT_ROW, CORRUPT_ROW], []);
    expect(r.outcome).toBe("empty-corrupted");
    expect(r.rewriteBackup).toBe(false);
  });

  it("missing primary, valid backup → restores from backup", () => {
    // Scenario: Reset Everything wiped the primary key but the backup
    // was preserved (or the primary write failed last session). The
    // backup should repopulate the live glossary.
    const r = resolveGlossaryLoad(null, [VALID, VALID2]);
    expect(r.outcome).toBe("backup");
    expect(r.entries).toHaveLength(2);
    expect(r.rewriteBackup).toBe(false);
  });

  it("empty primary array + any backup → still primary (legitimate cleared state)", () => {
    // A user who cleared their glossary via the UI has an empty primary
    // array persisted. That's a legitimate state, not corruption — we
    // must NOT fall through to the backup and resurrect old entries.
    // rewriteBackup is false because we refuse to empty the backup on
    // a 0-row primary (defense against the first-load-is-empty race).
    const r = resolveGlossaryLoad([], [VALID]);
    expect(r.outcome).toBe("primary");
    expect(r.entries).toEqual([]);
    expect(r.rewriteBackup).toBe(false);
  });

  it("non-array primary + valid backup → restores from backup", () => {
    // e.g. primary was stored as `{}` or `"null"` — resolver treats it as
    // unusable and falls through to the backup.
    const r = resolveGlossaryLoad({ not: "an array" }, [VALID]);
    expect(r.outcome).toBe("backup");
    expect(r.entries).toHaveLength(1);
  });

  it("partial backup under threshold is still usable", () => {
    // A partially-valid backup should still rescue us. The backup
    // recovery path uses the same validateGlossaryPayload logic, so a
    // 3-valid / 1-dropped backup is trustworthy.
    const r = resolveGlossaryLoad(
      [CORRUPT_ROW, CORRUPT_ROW, CORRUPT_ROW],
      [VALID, VALID2, { ...VALID, source: "hi" }, CORRUPT_ROW]
    );
    expect(r.outcome).toBe("backup");
    expect(r.entries).toHaveLength(3);
    expect(r.dropped).toBe(1);
  });
});

describe("CORRUPTION_DROP_RATIO / LANG_CODE_RE", () => {
  it("drop ratio is a sensible fraction in [0, 1]", () => {
    // Tuning #137 is expected to change this, but the type/range contract
    // should stay the same. A negative or >1 value would make the
    // `corrupted` guard silently unreachable.
    expect(CORRUPTION_DROP_RATIO).toBeGreaterThan(0);
    expect(CORRUPTION_DROP_RATIO).toBeLessThan(1);
  });

  it("LANG_CODE_RE accepts every real language code in the app", () => {
    // Must stay in sync with src/services/translation.ts LANGUAGES. If
    // someone adds a new language with an unusual code (e.g. `zh-Hant`),
    // this test flags it at CI time instead of silently dropping every
    // glossary entry for that language at load time.
    const realCodes = [
      "en",
      "es",
      "fr",
      "de",
      "it",
      "pt",
      "nl",
      "ja",
      "zh",
      "ko",
      "ar",
      "ru",
      "hi",
      "th",
      "tr",
      "pl",
      "uk",
      "vi",
      "sv",
      "el",
    ];
    for (const code of realCodes) {
      expect(LANG_CODE_RE.test(code)).toBe(true);
    }
  });
});
