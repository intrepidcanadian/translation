// Location-based phrasebook service
// Uses device location to suggest relevant phrases and language when traveling abroad

import * as Location from "expo-location";
import { getLocales } from "expo-localization";
import {
  PHRASE_CATEGORIES,
  getPhrasesForCategory,
  type PhraseCategory,
  type OfflinePhrase,
} from "./offlinePhrases";

// ── Country → Language mapping ──────────────────────────────────────────────

export const COUNTRY_TO_LANGUAGE: Record<string, string> = {
  // English
  US: "en", GB: "en", AU: "en", CA: "en", NZ: "en", IE: "en", ZA: "en",
  // Spanish
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es",
  EC: "es", GT: "es", CU: "es", DO: "es", HN: "es", SV: "es", NI: "es",
  CR: "es", PA: "es", UY: "es", PY: "es", BO: "es",
  // French
  FR: "fr", BE: "fr", CH: "fr", SN: "fr", CI: "fr", ML: "fr", CM: "fr",
  MG: "fr", HT: "fr",
  // German
  DE: "de", AT: "de", LI: "de",
  // Italian
  IT: "it", SM: "it",
  // Portuguese
  BR: "pt", PT: "pt", AO: "pt", MZ: "pt",
  // Japanese
  JP: "ja",
  // Chinese
  CN: "zh", TW: "zh", HK: "zh", SG: "zh",
  // Korean
  KR: "ko",
  // Arabic
  SA: "ar", AE: "ar", EG: "ar", MA: "ar", DZ: "ar", IQ: "ar", JO: "ar",
  LB: "ar", KW: "ar", QA: "ar", BH: "ar", OM: "ar", TN: "ar", LY: "ar",
  YE: "ar",
  // Hindi
  IN: "hi",
};

// ── Types ───────────────────────────────────────────────────────────────────

export interface LocationContext {
  countryCode: string | null;
  countryName: string | null;
  suggestedLanguage: string | null;
  categoryOrder: string[];
  isAbroad: boolean;
}

// ── Cache ───────────────────────────────────────────────────────────────────

const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

let cachedContext: LocationContext | null = null;
let cacheTimestamp = 0;

// ── Default category order ──────────────────────────────────────────────────

const DEFAULT_CATEGORY_ORDER: string[] = PHRASE_CATEGORIES.map((c) => c.key);

const ABROAD_CATEGORY_ORDER: string[] = [
  "travel",
  "food",
  "emergency",
  ...PHRASE_CATEGORIES.map((c) => c.key).filter(
    (k) => k !== "travel" && k !== "food" && k !== "emergency"
  ),
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function getDeviceLanguageCode(): string {
  try {
    const locales = getLocales();
    if (locales.length > 0 && locales[0].languageCode) {
      return locales[0].languageCode;
    }
  } catch (err) {
    console.warn("Failed to get device language:", err);
  }
  return "en";
}

// ── getLocationContext ───────────────────────────────────────────────────────

export async function getLocationContext(): Promise<LocationContext | null> {
  // Return cached result if still fresh
  if (cachedContext && Date.now() - cacheTimestamp < CACHE_DURATION_MS) {
    return cachedContext;
  }

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      return null;
    }

    // Try last known position first (fast), fall back to current position
    let position: Location.LocationObject | null = null;
    try {
      position = await Location.getLastKnownPositionAsync();
    } catch (err) {
      console.warn("Last known position unavailable:", err);
    }

    if (!position) {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      });
    }

    if (!position) {
      return null;
    }

    // Reverse geocode to get country
    const [geocode] = await Location.reverseGeocodeAsync({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });

    if (!geocode) {
      return null;
    }

    const countryCode = geocode.isoCountryCode ?? null;
    const countryName = geocode.country ?? null;
    const suggestedLanguage = countryCode
      ? COUNTRY_TO_LANGUAGE[countryCode] ?? null
      : null;

    const deviceLang = getDeviceLanguageCode();
    const isAbroad =
      suggestedLanguage !== null && suggestedLanguage !== deviceLang;

    const categoryOrder = isAbroad
      ? ABROAD_CATEGORY_ORDER
      : DEFAULT_CATEGORY_ORDER;

    const result: LocationContext = {
      countryCode,
      countryName,
      suggestedLanguage,
      categoryOrder,
      isAbroad,
    };

    // Cache the result
    cachedContext = result;
    cacheTimestamp = Date.now();

    return result;
  } catch (err) {
    console.warn("Location services unavailable:", err);
    return null;
  }
}

// ── getNearbyPhrases ────────────────────────────────────────────────────────

const NEARBY_CATEGORIES: PhraseCategory[] = [
  "travel",
  "food",
  "emergency",
  "basic",
];
const PHRASES_PER_CATEGORY = 3;

export function getNearbyPhrases(
  _countryCode: string
): Record<string, OfflinePhrase[]> {
  const result: Record<string, OfflinePhrase[]> = {};

  for (const category of NEARBY_CATEGORIES) {
    const phrases = getPhrasesForCategory(category);
    result[category] = phrases.slice(0, PHRASES_PER_CATEGORY);
  }

  return result;
}
