import {
  offlineTranslate,
  getPhrasesForCategory,
  getAllCategorizedPhrases,
  getPhraseOfTheDay,
  PHRASE_CATEGORIES,
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
});
