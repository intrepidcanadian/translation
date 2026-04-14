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

/**
 * #114 regression fence — pins the Map-building + query pipeline that
 * GlossaryContext relies on, directly at the util layer. This test doesn't
 * import GlossaryContext (which would require React rendering infra) but
 * mirrors its storage/query shape exactly:
 *   - Map key  = lookupKey(entry.sourceLang, entry.targetLang, normalizeForLookup(entry.source))
 *   - Query    = lookupKey(querySrcLang, queryTgtLang, normalizeForLookup(queryText))
 *
 * If a future refactor splits the helpers, promotes them somewhere else, or
 * quietly changes the normalization contract, the glossary's "thanks" / "thanks!"
 * collision breaks silently in production and users lose every punctuated entry
 * without a single surfaced error. That's exactly what #109 fixed — this block
 * exists to keep it fixed.
 */
describe("glossary lookup pipeline contract (#114)", () => {
  // Replicate the exact code path GlossaryContext.tsx uses (see the
  // glossaryMap / glossaryLookup hooks). Inlined here so a misnamed helper
  // or a regressed implementation shows up as a failing unit test.
  interface Entry {
    source: string;
    target: string;
    sourceLang: string;
    targetLang: string;
  }
  function buildMap(entries: Entry[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const e of entries) {
      const key = lookupKey(e.sourceLang, e.targetLang, normalizeForLookup(e.source));
      map.set(key, e.target);
    }
    return map;
  }
  function lookup(
    map: Map<string, string>,
    text: string,
    src: string,
    tgt: string
  ): string | null {
    const key = lookupKey(src, tgt, normalizeForLookup(text));
    return map.get(key) ?? null;
  }

  it("entry stored without punctuation is hit by a query with trailing punctuation", () => {
    // Exactly the #109 scenario: user saved "thanks" → "gracias" back when
    // glossary keys were case-sensitive exact matches; after the normalize
    // fix, typing "thanks!" in the translate box should still hit the glossary.
    const map = buildMap([{ source: "thanks", target: "gracias", sourceLang: "en", targetLang: "es" }]);
    expect(lookup(map, "thanks!", "en", "es")).toBe("gracias");
    expect(lookup(map, "Thanks.", "en", "es")).toBe("gracias");
    expect(lookup(map, "  THANKS?  ", "en", "es")).toBe("gracias");
  });

  it("entry stored with punctuation is hit by a plain query", () => {
    // Mirror case: a careful user types "Hello!" into the glossary modal.
    // Query text "hello" (no punctuation, lowercase) still finds it.
    const map = buildMap([{ source: "Hello!", target: "Hola", sourceLang: "en", targetLang: "es" }]);
    expect(lookup(map, "hello", "en", "es")).toBe("Hola");
    expect(lookup(map, "HELLO", "en", "es")).toBe("Hola");
  });

  it("scopes lookups by language-pair direction", () => {
    // An en→es entry must not leak into the es→en direction. GlossaryContext
    // composes the key from both lang codes specifically to keep the two
    // directions isolated.
    const map = buildMap([{ source: "thanks", target: "gracias", sourceLang: "en", targetLang: "es" }]);
    expect(lookup(map, "thanks", "en", "es")).toBe("gracias");
    expect(lookup(map, "thanks", "es", "en")).toBeNull();
    expect(lookup(map, "thanks", "en", "fr")).toBeNull();
  });

  it("returns null for unknown text", () => {
    const map = buildMap([{ source: "thanks", target: "gracias", sourceLang: "en", targetLang: "es" }]);
    expect(lookup(map, "goodbye", "en", "es")).toBeNull();
    expect(lookup(map, "", "en", "es")).toBeNull();
  });

  it("later entry overwrites earlier entry for the same normalized key", () => {
    // Dedup-on-add is enforced by GlossaryContext's addGlossaryEntry filter,
    // but the Map itself also inherently dedupes by key — pinning that here
    // guards against someone replacing the Map with a multi-value structure.
    const map = buildMap([
      { source: "thanks", target: "gracias", sourceLang: "en", targetLang: "es" },
      { source: "Thanks!", target: "gracias muchas", sourceLang: "en", targetLang: "es" },
    ]);
    expect(lookup(map, "thanks", "en", "es")).toBe("gracias muchas");
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
