import { transliterate } from "transliteration";

// Language codes that use non-Latin scripts and benefit from romanization
const NON_LATIN_LANGS = new Set([
  "zh", // Chinese → Pinyin
  "ja", // Japanese → Romaji
  "ko", // Korean → Romanization
  "ar", // Arabic → Romanization
  "hi", // Hindi → Romanization
  "ru", // Russian → Romanization
  "th", // Thai → Romanization
  "uk", // Ukrainian → Romanization
]);

// Friendly names for the romanization system used by each language
const ROMANIZATION_NAMES: Record<string, string> = {
  zh: "Pinyin",
  ja: "Romaji",
  ko: "Romanization",
  ar: "Romanization",
  hi: "Romanization",
  ru: "Romanization",
  th: "Romanization",
  uk: "Romanization",
};

/**
 * Check if a language code uses a non-Latin script
 */
export function needsRomanization(langCode: string): boolean {
  return NON_LATIN_LANGS.has(langCode);
}

/**
 * Get the romanization system name for a language (e.g., "Pinyin" for Chinese)
 */
export function getRomanizationName(langCode: string): string {
  return ROMANIZATION_NAMES[langCode] || "Romanization";
}

/**
 * Convert non-Latin text to its romanized form.
 * Returns null if the language doesn't need romanization.
 */
export function romanize(text: string, langCode: string): string | null {
  if (!needsRomanization(langCode) || !text.trim()) {
    return null;
  }

  const result = transliterate(text);

  // Don't return romanization if it's identical to the original (already Latin)
  if (result === text) {
    return null;
  }

  return result;
}

// Regex to test if a character is non-Latin (CJK, Cyrillic, Arabic, Devanagari, Thai, etc.)
function isNonLatin(char: string): boolean {
  return /[^\u0000-\u024F\u1E00-\u1EFF]/.test(char);
}

export interface AlignedPair {
  char: string;
  roman: string;
}

/**
 * Produce character-level aligned romanization pairs.
 * Groups punctuation/spaces with the preceding character.
 * Returns null if romanization isn't needed.
 */
export function romanizeAligned(text: string, langCode: string): AlignedPair[] | null {
  if (!needsRomanization(langCode) || !text.trim()) {
    return null;
  }

  // Check if whole-string romanization produces anything different
  const fullRoman = transliterate(text);
  if (fullRoman === text) {
    return null;
  }

  const pairs: AlignedPair[] = [];
  const chars = Array.from(text); // handle multi-byte chars

  for (const char of chars) {
    if (isNonLatin(char)) {
      const roman = transliterate(char);
      pairs.push({ char, roman: roman !== char ? roman : "" });
    } else {
      // Latin char, punctuation, space — pass through
      pairs.push({ char, roman: char });
    }
  }

  return pairs;
}
