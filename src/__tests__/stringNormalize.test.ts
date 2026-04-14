/**
 * Pins the shared `normalizeForLookup` / `lookupKey` helpers that back both
 * the offline phrase dictionary and the user glossary. A regression here
 * silently breaks glossary lookups for any entry typed with terminal
 * punctuation — exactly the fix that landed as #109. The offlinePhrases
 * suite covers the phrase path; these tests cover the util directly so a
 * future refactor (e.g. promoting normalization to the API provider layer)
 * can't drop the trailing-punctuation stripping without tripping a test.
 *
 * Related: #114 (glossary trailing-punctuation regression test).
 */
import { normalizeForLookup, lookupKey } from "../utils/stringNormalize";

describe("normalizeForLookup", () => {
  it("lowercases and trims", () => {
    expect(normalizeForLookup("  Hello  ")).toBe("hello");
    expect(normalizeForLookup("WORLD")).toBe("world");
  });

  it("strips a single trailing ASCII punctuation mark", () => {
    expect(normalizeForLookup("hello!")).toBe("hello");
    expect(normalizeForLookup("hello?")).toBe("hello");
    expect(normalizeForLookup("hello.")).toBe("hello");
    expect(normalizeForLookup("hello,")).toBe("hello");
  });

  it("strips repeated trailing punctuation", () => {
    expect(normalizeForLookup("hello!!!")).toBe("hello");
    expect(normalizeForLookup("wait?!")).toBe("wait");
  });

  it("strips CJK terminal punctuation", () => {
    expect(normalizeForLookup("你好。")).toBe("你好");
    expect(normalizeForLookup("你好？")).toBe("你好");
    expect(normalizeForLookup("こんにちは！")).toBe("こんにちは");
  });

  it("leaves interior punctuation alone", () => {
    // Only trailing punctuation is stripped — interior chars are significant
    // (e.g. "isn't" / "don't" must round-trip).
    expect(normalizeForLookup("don't!")).toBe("don't");
    expect(normalizeForLookup("U.S.A.")).toBe("u.s.a");
  });

  it("collapses punctuation variants to the same key for glossary lookups", () => {
    // The #109 contract: a glossary entry saved as "thanks" matches
    // "thanks!" at query time, exactly like the offline phrase dictionary.
    // GlossaryContext + offlinePhrases both build their Map keys via this
    // helper — if a future refactor breaks it, typed users lose every
    // punctuated phrase silently, so the regression deserves a dedicated pin.
    const base = normalizeForLookup("thanks");
    expect(normalizeForLookup("thanks!")).toBe(base);
    expect(normalizeForLookup("Thanks.")).toBe(base);
    expect(normalizeForLookup("  THANKS?  ")).toBe(base);
  });

  it("returns empty for empty or whitespace-only input", () => {
    expect(normalizeForLookup("")).toBe("");
    expect(normalizeForLookup("   ")).toBe("");
  });
});

describe("lookupKey", () => {
  it("joins parts with the pipe separator", () => {
    expect(lookupKey("en", "es", "hello")).toBe("en|es|hello");
  });

  it("produces distinct keys when any part differs", () => {
    // Composite keys must be collision-free across language-pair directions,
    // otherwise an en→es glossary entry could leak into es→en lookups.
    const a = lookupKey("en", "es", normalizeForLookup("Hello!"));
    const b = lookupKey("es", "en", normalizeForLookup("Hello!"));
    expect(a).not.toBe(b);
  });

  it("is stable across punctuation variants when fed through normalizeForLookup", () => {
    // The real contract: caller runs the query text through normalizeForLookup
    // before composing the key, so "Hello!" and "hello" collide at the key
    // level — which is what GlossaryContext relies on.
    const k1 = lookupKey("en", "es", normalizeForLookup("Hello!"));
    const k2 = lookupKey("en", "es", normalizeForLookup("hello"));
    expect(k1).toBe(k2);
  });
});
