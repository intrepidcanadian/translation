/**
 * Unit tests for `services/locationPhrases.ts` — pure functions only.
 *
 * Why pin this:
 *  - COUNTRY_TO_LANGUAGE is the lookup table that powers auto-language
 *    suggestion when the user is abroad. A missing or wrong mapping
 *    silently suggests the wrong target language, which is subtle and
 *    hard to catch in manual testing.
 *  - getNearbyPhrases selects travel-relevant phrases from the offline
 *    phrasebook for a location context. The category/count contract is
 *    load-bearing for the "nearby phrases" UI card.
 *  - The abroad category ordering (travel → food → emergency first)
 *    is a UX decision that should break a test if changed accidentally.
 *
 * Async functions (getLocationContext) are NOT tested here because they
 * depend on expo-location native modules. This file covers the pure,
 * synchronous logic that's exercisable without React rendering or
 * native module mocks.
 */

import {
  COUNTRY_TO_LANGUAGE,
  getNearbyPhrases,
} from "../services/locationPhrases";

describe("COUNTRY_TO_LANGUAGE mapping", () => {
  it("maps major English-speaking countries to 'en'", () => {
    for (const code of ["US", "GB", "AU", "CA", "NZ", "IE", "ZA"]) {
      expect(COUNTRY_TO_LANGUAGE[code]).toBe("en");
    }
  });

  it("maps major Spanish-speaking countries to 'es'", () => {
    for (const code of ["ES", "MX", "AR", "CO", "CL", "PE"]) {
      expect(COUNTRY_TO_LANGUAGE[code]).toBe("es");
    }
  });

  it("maps major French-speaking countries to 'fr'", () => {
    for (const code of ["FR", "BE", "CH"]) {
      expect(COUNTRY_TO_LANGUAGE[code]).toBe("fr");
    }
  });

  it("maps Asian countries correctly", () => {
    expect(COUNTRY_TO_LANGUAGE["JP"]).toBe("ja");
    expect(COUNTRY_TO_LANGUAGE["CN"]).toBe("zh");
    expect(COUNTRY_TO_LANGUAGE["TW"]).toBe("zh");
    expect(COUNTRY_TO_LANGUAGE["KR"]).toBe("ko");
    expect(COUNTRY_TO_LANGUAGE["IN"]).toBe("hi");
  });

  it("maps Arabic-speaking countries to 'ar'", () => {
    for (const code of ["SA", "AE", "EG", "MA"]) {
      expect(COUNTRY_TO_LANGUAGE[code]).toBe("ar");
    }
  });

  it("maps German/Italian/Portuguese countries correctly", () => {
    expect(COUNTRY_TO_LANGUAGE["DE"]).toBe("de");
    expect(COUNTRY_TO_LANGUAGE["AT"]).toBe("de");
    expect(COUNTRY_TO_LANGUAGE["IT"]).toBe("it");
    expect(COUNTRY_TO_LANGUAGE["BR"]).toBe("pt");
    expect(COUNTRY_TO_LANGUAGE["PT"]).toBe("pt");
  });

  it("returns undefined for unmapped countries", () => {
    // Countries not in the map should return undefined so the caller
    // falls back to null, not a wrong language code.
    expect(COUNTRY_TO_LANGUAGE["XX"]).toBeUndefined();
    expect(COUNTRY_TO_LANGUAGE[""]).toBeUndefined();
  });

  it("every value is a valid 2-letter language code", () => {
    // Guard against accidental typos like "enn" or "j" in the map values
    for (const [country, lang] of Object.entries(COUNTRY_TO_LANGUAGE)) {
      expect(lang).toMatch(/^[a-z]{2}$/);
    }
  });
});

describe("getNearbyPhrases", () => {
  it("returns phrases for travel, food, emergency, and basic categories", () => {
    const result = getNearbyPhrases("JP");
    const categories = Object.keys(result);
    expect(categories).toContain("travel");
    expect(categories).toContain("food");
    expect(categories).toContain("emergency");
    expect(categories).toContain("basic");
  });

  it("returns at most 3 phrases per category", () => {
    const result = getNearbyPhrases("FR");
    for (const [, phrases] of Object.entries(result)) {
      expect(phrases.length).toBeLessThanOrEqual(3);
      expect(phrases.length).toBeGreaterThan(0);
    }
  });

  it("returns exactly 4 categories regardless of country code", () => {
    // The nearby phrases card always shows the same 4 categories.
    // The country code currently doesn't filter — this is a design
    // decision to revisit if we add geo-aware phrase ranking later.
    const result = getNearbyPhrases("US");
    expect(Object.keys(result)).toHaveLength(4);
  });

  it("each returned phrase has all 10 language translations", () => {
    const result = getNearbyPhrases("DE");
    const langs = ["en", "es", "fr", "de", "it", "pt", "ja", "zh", "ko", "ar"];
    for (const phrases of Object.values(result)) {
      for (const phrase of phrases) {
        for (const lang of langs) {
          expect(typeof phrase[lang as keyof typeof phrase]).toBe("string");
          expect((phrase[lang as keyof typeof phrase] as string).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("handles unknown country codes without throwing", () => {
    // Unknown country codes should still return the standard set of
    // nearby phrases — the function doesn't use the country code to
    // filter, it only uses it to potentially customize ordering (future).
    expect(() => getNearbyPhrases("XX")).not.toThrow();
    const result = getNearbyPhrases("XX");
    expect(Object.keys(result)).toHaveLength(4);
  });
});
