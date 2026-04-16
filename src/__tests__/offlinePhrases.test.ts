import {
  offlineTranslate,
  getPhrasesForCategory,
  getAllCategorizedPhrases,
  getPhraseOfTheDay,
  PHRASE_CATEGORIES,
  type PhraseCategory,
} from "../services/offlinePhrases";

describe("offlineTranslate", () => {
  it("translates a basic phrase en→es", () => {
    expect(offlineTranslate("Thank you", "en", "es")).toBe("Gracias");
  });

  it("translates a basic phrase es→en", () => {
    expect(offlineTranslate("Gracias", "es", "en")).toBe("Thank you");
  });

  it("is case-insensitive", () => {
    expect(offlineTranslate("thank you", "en", "es")).toBe("Gracias");
    expect(offlineTranslate("THANK YOU", "en", "es")).toBe("Gracias");
  });

  it("strips trailing punctuation before matching", () => {
    expect(offlineTranslate("Thank you!", "en", "es")).toBe("Gracias");
    expect(offlineTranslate("Thank you.", "en", "es")).toBe("Gracias");
    expect(offlineTranslate("Thank you?", "en", "es")).toBe("Gracias");
  });

  it("trims whitespace", () => {
    expect(offlineTranslate("  Thank you  ", "en", "es")).toBe("Gracias");
  });

  it("returns null for unsupported language pairs", () => {
    expect(offlineTranslate("Hello", "en", "xx")).toBeNull();
    expect(offlineTranslate("Hello", "xx", "en")).toBeNull();
  });

  it("returns null for unrecognized text", () => {
    expect(offlineTranslate("supercalifragilistic", "en", "es")).toBeNull();
  });

  it("supports autodetect as source language", () => {
    const result = offlineTranslate("Gracias", "autodetect", "en");
    expect(result).toBe("Thank you");
  });

  it("translates between non-English pairs", () => {
    expect(offlineTranslate("Merci", "fr", "de")).toBe("Danke");
  });

  it("translates Yes across languages", () => {
    expect(offlineTranslate("Yes", "en", "ja")).toBe("はい");
    expect(offlineTranslate("Oui", "fr", "ko")).toBe("네");
  });

  // --- Common-word dictionary tests ---

  it("translates common words via phrase or word index", () => {
    // "water" exists in both CATEGORIZED_PHRASES ("Water"/"Eau") and
    // COMMON_WORDS ("water"/"eau"). Phrase index wins, so capitalized form.
    expect(offlineTranslate("water", "en", "fr")).toBe("Eau");
    // "beautiful" is only in COMMON_WORDS
    expect(offlineTranslate("beautiful", "en", "es")).toBe("hermoso");
    expect(offlineTranslate("friend", "en", "ja")).toBe("友達");
  });

  it("translates common words across non-English pairs", () => {
    // "amor" is in COMMON_WORDS (love)
    expect(offlineTranslate("amor", "es", "en")).toBe("love");
    expect(offlineTranslate("freund", "de", "ja")).toBe("友達");
  });

  it("phrase index takes priority over common-word index", () => {
    // "Hello" exists in both CATEGORIZED_PHRASES (capitalized) and
    // COMMON_WORDS (lowercase). Phrase lookup runs first, so the
    // capitalized phrase entry wins.
    expect(offlineTranslate("Hello", "en", "es")).toBe("Hola");
    expect(offlineTranslate("HELLO", "en", "es")).toBe("Hola");
  });

  it("translates CJK phrases ja→en", () => {
    expect(offlineTranslate("ありがとう", "ja", "en")).toBe("Thank you");
  });

  it("translates CJK phrases zh→ko", () => {
    expect(offlineTranslate("请", "zh", "ko")).toBe("부탁합니다");
  });

  it("translates Arabic ar→en", () => {
    expect(offlineTranslate("شكرا", "ar", "en")).toBe("Thank you");
  });

  it("returns null for empty string", () => {
    expect(offlineTranslate("", "en", "es")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(offlineTranslate("   ", "en", "es")).toBeNull();
  });

  it("returns null for text longer than any dictionary entry", () => {
    const longText = "This is a very long sentence that is definitely not in the offline dictionary and should short-circuit immediately";
    expect(offlineTranslate(longText, "en", "es")).toBeNull();
  });

  it("translates emergency phrases", () => {
    // "Help!" strips trailing punctuation → "Help" → "Ayuda"
    expect(offlineTranslate("Help!", "en", "es")).toBe("Ayuda");
    expect(offlineTranslate("Call the police", "en", "fr")).toBe("Appelez la police");
  });

  it("translates medical phrases", () => {
    expect(offlineTranslate("I need a doctor", "en", "de")).toBe("Ich brauche einen Arzt");
  });

  it("autodetect scans all supported languages", () => {
    // Japanese input should be detected even without specifying source
    expect(offlineTranslate("はい", "autodetect", "en")).toBe("Yes");
    // Korean input
    expect(offlineTranslate("네", "autodetect", "en")).toBe("Yes");
  });

  it("strips CJK trailing punctuation", () => {
    // Chinese period (。) and question mark (？) should be stripped
    expect(offlineTranslate("请。", "zh", "en")).toBe("Please");
  });
});

describe("getPhrasesForCategory", () => {
  it("returns phrases for a valid category", () => {
    const basic = getPhrasesForCategory("basic");
    expect(basic.length).toBeGreaterThan(0);
    expect(basic[0]).toHaveProperty("en");
    expect(basic[0]).toHaveProperty("es");
  });

  it("returns empty array for unknown category", () => {
    const result = getPhrasesForCategory("nonexistent" as any);
    expect(result).toEqual([]);
  });

  it("returns all 9 categories with non-empty phrase lists", () => {
    const expectedCategories: PhraseCategory[] = [
      "basic", "greetings", "travel", "emergency",
      "food", "shopping", "numbers", "directions", "medical",
    ];
    for (const cat of expectedCategories) {
      expect(getPhrasesForCategory(cat).length).toBeGreaterThan(0);
    }
  });

  it("every phrase has all 10 language fields", () => {
    const langs = ["en", "es", "fr", "de", "it", "pt", "ja", "zh", "ko", "ar"] as const;
    const basic = getPhrasesForCategory("basic");
    for (const phrase of basic) {
      for (const lang of langs) {
        expect(typeof phrase[lang]).toBe("string");
        expect(phrase[lang].length).toBeGreaterThan(0);
      }
    }
  });
});

describe("getAllCategorizedPhrases", () => {
  it("returns phrases for every category", () => {
    const all = getAllCategorizedPhrases();
    for (const cat of PHRASE_CATEGORIES) {
      expect(all[cat.key]).toBeDefined();
      expect(all[cat.key].length).toBeGreaterThan(0);
    }
  });
});

describe("getPhraseOfTheDay", () => {
  it("returns a phrase with category info", () => {
    const result = getPhraseOfTheDay("es");
    expect(result).not.toBeNull();
    expect(result!.phrase).toHaveProperty("en");
    expect(result!.phrase).toHaveProperty("es");
    expect(typeof result!.category).toBe("string");
  });

  it("returns consistent result for same day", () => {
    const a = getPhraseOfTheDay("es");
    const b = getPhraseOfTheDay("es");
    expect(a!.phrase.en).toBe(b!.phrase.en);
  });

  it("returns null for unsupported target language", () => {
    expect(getPhraseOfTheDay("xx")).toBeNull();
  });

  it("category is a valid PHRASE_CATEGORIES key", () => {
    const result = getPhraseOfTheDay("fr");
    expect(result).not.toBeNull();
    const validCategories = PHRASE_CATEGORIES.map((c) => c.key);
    expect(validCategories).toContain(result!.category);
  });

  it("returns result for autodetect target (allowed by guard)", () => {
    // getPhraseOfTheDay explicitly allows "autodetect" through its guard.
    // The returned phrase won't have an "autodetect" field, but the function
    // still returns a valid phrase object — the caller handles the missing key.
    const result = getPhraseOfTheDay("autodetect");
    expect(result).not.toBeNull();
    expect(result!.phrase).toHaveProperty("en");
  });
});

describe("PHRASE_CATEGORIES metadata", () => {
  it("has 9 categories", () => {
    expect(PHRASE_CATEGORIES.length).toBe(9);
  });

  it("each category has key, label, and icon", () => {
    for (const cat of PHRASE_CATEGORIES) {
      expect(typeof cat.key).toBe("string");
      expect(typeof cat.label).toBe("string");
      expect(typeof cat.icon).toBe("string");
      expect(cat.icon.length).toBeGreaterThan(0);
    }
  });
});
