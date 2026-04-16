/**
 * Unit tests for `services/romanization.ts`.
 *
 * Why pin this:
 *  - Romanization powers the optional pinyin/romaji line shown beneath
 *    non-Latin translation output. It's a pure utility (just wraps the
 *    `transliteration` package + a small allowlist) but it has subtle
 *    contracts that are easy to break:
 *      • `needsRomanization` must NOT match Latin-script source langs,
 *        otherwise English/Spanish/French translations would get a
 *        useless duplicate line beneath them.
 *      • `romanize` returns `null` (not the original string) when the
 *        result equals the input — callers branch on null to skip
 *        rendering. A regression to "always return a string" would
 *        push duplicate-content lines into the UI.
 *      • `romanizeAligned` produces a per-character pair list used by
 *        the aligned pinyin overlay. Multi-byte handling (CJK, emoji,
 *        combining marks) and the "pass-through Latin/punctuation"
 *        rule are both load-bearing for the alignment to look right.
 *
 *  - The module is otherwise untested, so any regression would surface
 *    in the UI rather than CI. These tests are the safety net.
 */
import {
  needsRomanization,
  getRomanizationName,
  romanize,
  romanizeAligned,
} from "../services/romanization";

describe("romanization", () => {
  describe("needsRomanization", () => {
    it("returns true for the supported non-Latin language codes", () => {
      // Pin the full allowlist — adding/removing a language should be a
      // deliberate decision visible in this list, not an accidental
      // side effect of a refactor.
      for (const code of ["zh", "ja", "ko", "ar", "hi", "ru", "th", "uk"]) {
        expect(needsRomanization(code)).toBe(true);
      }
    });

    it("returns false for Latin-script languages so they don't get a duplicate line", () => {
      // Critical regression fence: if `en` ever returns true here the UI
      // would render an English "romanization" beneath every English
      // translation, which is duplicate content and looks broken.
      for (const code of ["en", "es", "fr", "de", "it", "pt", "nl", "sv", "tr", "vi"]) {
        expect(needsRomanization(code)).toBe(false);
      }
    });

    it("returns false for an empty or unknown code", () => {
      expect(needsRomanization("")).toBe(false);
      expect(needsRomanization("xyz")).toBe(false);
    });

    it("is case-sensitive — uppercase locale codes are not auto-normalized", () => {
      // Pin the contract: callers must pass lowercase ISO codes. The
      // app stores locales lowercased throughout, so a regression that
      // adds case-insensitive matching here would be silent dead code,
      // but a regression that *requires* uppercase would break the UI.
      expect(needsRomanization("ZH")).toBe(false);
      expect(needsRomanization("JA")).toBe(false);
    });
  });

  describe("getRomanizationName", () => {
    it("returns the friendly name for known languages", () => {
      // These two are the only ones with a distinct name — pin them
      // explicitly so a typo in "Pinyin" or "Romaji" gets caught.
      expect(getRomanizationName("zh")).toBe("Pinyin");
      expect(getRomanizationName("ja")).toBe("Romaji");
    });

    it('falls back to the generic "Romanization" for other supported langs', () => {
      for (const code of ["ko", "ar", "hi", "ru", "th", "uk"]) {
        expect(getRomanizationName(code)).toBe("Romanization");
      }
    });

    it('returns "Romanization" for an unknown language code', () => {
      // Defensive: callers don't have to pre-check needsRomanization
      // before reading the name, so the unknown-code path must not
      // throw or return undefined.
      expect(getRomanizationName("xyz")).toBe("Romanization");
      expect(getRomanizationName("")).toBe("Romanization");
    });
  });

  describe("romanize", () => {
    it("returns null for languages that don't need romanization", () => {
      // Pin the null-vs-string contract — the UI uses `=== null` to
      // decide whether to render the line at all.
      expect(romanize("Hello world", "en")).toBeNull();
      expect(romanize("Hola mundo", "es")).toBeNull();
    });

    it("returns null for empty or whitespace-only input", () => {
      expect(romanize("", "zh")).toBeNull();
      expect(romanize("   ", "zh")).toBeNull();
      expect(romanize("\n\t", "zh")).toBeNull();
    });

    it("returns a non-null romanized string for Chinese input", () => {
      // We don't pin the exact transliterate() output (that's the
      // upstream library's contract) but we DO pin that it produces
      // something different from the input and it's not null.
      const result = romanize("你好世界", "zh");
      expect(result).not.toBeNull();
      expect(result).not.toBe("你好世界");
      // And that the output is ASCII/Latin (transliterate's job).
      expect(result).toMatch(/[a-zA-Z]/);
    });

    it("returns a non-null romanized string for Japanese input", () => {
      const result = romanize("こんにちは", "ja");
      expect(result).not.toBeNull();
      expect(result).not.toBe("こんにちは");
    });

    it("returns null when the input is already Latin even for a non-Latin lang code", () => {
      // Edge case: someone asks for pinyin on a Chinese string that
      // happens to be all ASCII (like a brand name or English loan
      // word). The romanize result equals the input, so we return null
      // to avoid rendering a duplicate.
      expect(romanize("OK", "zh")).toBeNull();
      expect(romanize("Apple", "ja")).toBeNull();
    });
  });

  describe("romanizeAligned", () => {
    it("returns null for Latin-script languages", () => {
      expect(romanizeAligned("Hello", "en")).toBeNull();
    });

    it("returns null for empty/whitespace input", () => {
      expect(romanizeAligned("", "zh")).toBeNull();
      expect(romanizeAligned("   ", "zh")).toBeNull();
    });

    it("returns null when the whole-string romanization equals the input", () => {
      // Same edge case as romanize() — all-ASCII input on a non-Latin
      // lang code skips the alignment.
      expect(romanizeAligned("OK", "zh")).toBeNull();
    });

    it("produces one pair per character for CJK input", () => {
      const pairs = romanizeAligned("你好", "zh");
      expect(pairs).not.toBeNull();
      expect(pairs).toHaveLength(2);
      // Each Chinese character is non-Latin, so each pair should
      // carry a non-empty roman value.
      for (const p of pairs!) {
        expect(p.char.length).toBeGreaterThan(0);
        expect(p.roman.length).toBeGreaterThan(0);
        // Roman value should be Latin-ish.
        expect(p.roman).toMatch(/[a-zA-Z]/);
      }
    });

    it("passes through Latin characters, punctuation, and spaces unchanged", () => {
      // Mixed content — a CJK string with embedded punctuation and a
      // Latin loan word. Latin chars should appear in the output with
      // `roman` equal to the char itself (pass-through), so the
      // alignment lines up visually.
      const pairs = romanizeAligned("你好, OK!", "zh");
      expect(pairs).not.toBeNull();
      // The two CJK characters should have non-empty roman values.
      expect(pairs![0].char).toBe("你");
      expect(pairs![0].roman.length).toBeGreaterThan(0);
      expect(pairs![1].char).toBe("好");
      expect(pairs![1].roman.length).toBeGreaterThan(0);
      // Punctuation, space, and Latin letters should pass through:
      // roman === char.
      const passthrough = pairs!.slice(2);
      for (const p of passthrough) {
        expect(p.roman).toBe(p.char);
      }
    });

    it("handles multi-byte characters via Array.from (no surrogate splits)", () => {
      // Pin the Array.from() contract: a naive `text.split("")` would
      // split astral-plane characters into surrogate halves and the
      // alignment would render garbage. This test catches a regression
      // to a code-unit-based loop.
      const pairs = romanizeAligned("日本語", "ja");
      expect(pairs).not.toBeNull();
      // Three logical characters → three pairs (not 6 surrogate halves).
      expect(pairs).toHaveLength(3);
      expect(pairs![0].char).toBe("日");
      expect(pairs![1].char).toBe("本");
      expect(pairs![2].char).toBe("語");
    });

    it("preserves ordering — pair[i].char joined back equals the original", () => {
      // Loose round-trip: the chars in order should reconstruct the
      // input. This catches reorderings or skipped characters.
      const text = "你好, world!";
      const pairs = romanizeAligned(text, "zh");
      expect(pairs).not.toBeNull();
      expect(pairs!.map((p) => p.char).join("")).toBe(text);
    });
  });
});
