// Translation service — on-device first (Apple Neural Engine, ML Kit), MyMemory cloud as fallback

import { Platform } from "react-native";
import { offlineTranslate } from "./offlinePhrases";
import { logger } from "./logger";

export type TranslationProvider = "mymemory" | "apple" | "mlkit";

const MYMEMORY_API = "https://api.mymemory.translated.net/get";

const CACHE_MAX_SIZE = 200;
const translationCache = new Map<string, string>();

// Circuit breaker: stops calling a failing provider after consecutive failures
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_MS = 30_000; // 30s cooldown before retrying
const circuitState = new Map<string, { failures: number; openedAt: number | null }>();

function getCircuit(provider: string) {
  if (!circuitState.has(provider)) {
    circuitState.set(provider, { failures: 0, openedAt: null });
  }
  return circuitState.get(provider)!;
}

function isCircuitOpen(provider: string): boolean {
  const circuit = getCircuit(provider);
  if (!circuit.openedAt) return false;
  // Auto-reset after cooldown (half-open → allow one attempt)
  if (Date.now() - circuit.openedAt >= CIRCUIT_BREAKER_RESET_MS) {
    circuit.openedAt = null;
    circuit.failures = 0;
    return false;
  }
  return true;
}

function recordSuccess(provider: string) {
  const circuit = getCircuit(provider);
  circuit.failures = 0;
  circuit.openedAt = null;
}

function recordFailure(provider: string) {
  const circuit = getCircuit(provider);
  circuit.failures++;
  if (circuit.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuit.openedAt = Date.now();
  }
}

function getCacheKey(text: string, sourceLang: string, targetLang: string, provider: string) {
  return `${provider}|${sourceLang}|${targetLang}|${text}`;
}

export interface TranslationResult {
  translatedText: string;
  detectedLanguage?: string;
  confidence?: number; // 0-1 match quality from API
}

export interface TranslateOptions {
  provider?: TranslationProvider;
  signal?: AbortSignal;
}

// Retry with exponential backoff for rate-limit (429) and transient server errors (5xx)
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  signal?: AbortSignal
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Only retry on rate-limit or server errors, not on auth/client errors
      const isRetryable =
        lastError.message.includes("rate limit") ||
        lastError.message.includes("Too many") ||
        lastError.message.includes("429") ||
        lastError.message.includes("500") ||
        lastError.message.includes("502") ||
        lastError.message.includes("503");
      if (!isRetryable || attempt === maxRetries) throw lastError;
      // Exponential backoff: 1s, 2s
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError!;
}

function createTimeoutSignal(signal?: AbortSignal): { controller: AbortController; timeoutId: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        controller.abort();
      });
    }
  }

  return { controller, timeoutId };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<Response> {
  const { controller, timeoutId } = createTimeoutSignal(signal);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      if (signal?.aborted) throw err;
      throw new Error("Translation timed out. Check your connection and try again.");
    }
    throw new Error("No internet connection. Check your network and try again.");
  }
}

async function translateMyMemory(text: string, sourceLang: string, targetLang: string, signal?: AbortSignal): Promise<TranslationResult> {
  const langPair = `${sourceLang}|${targetLang}`;
  const url = `${MYMEMORY_API}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;

  const response = await fetchWithTimeout(url, {}, signal);

  if (response.status === 429) {
    throw new Error("Translation rate limit reached. Wait a moment and try again.");
  }
  if (!response.ok) {
    throw new Error(`Translation service error (${response.status}). Try again.`);
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    throw new Error("Translation service returned invalid data. Try again.");
  }

  if (data.responseStatus === 429) {
    throw new Error("Too many translation requests. Wait a moment and try again.");
  }
  if (data.responseStatus !== 200) {
    throw new Error((data.responseDetails as string) || "Translation failed. Try again.");
  }

  const responseData = data.responseData as Record<string, unknown> | undefined;
  if (!responseData?.translatedText) {
    throw new Error("Translation service returned an empty result. Try again.");
  }

  const match = responseData.match;
  return {
    translatedText: responseData.translatedText as string,
    detectedLanguage: responseData.detectedLanguage as string | undefined,
    confidence: typeof match === "number" ? match : undefined,
  };
}

// Apple on-device translation (iOS 17.4+, uses Neural Engine)
async function translateApple(text: string, sourceLang: string, targetLang: string, signal?: AbortSignal): Promise<TranslationResult> {
  if (Platform.OS !== "ios") {
    throw new Error("Apple Translation is only available on iOS.");
  }

  try {
    const AppleTranslation = require("../../modules/apple-translation");

    const available = await AppleTranslation.isAvailable();
    if (!available) {
      throw new Error("Apple Translation requires iOS 17.4+. Update your device or choose another provider.");
    }

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    // Use "en" if auto-detect (Apple handles auto-detection internally)
    const srcLang = sourceLang === "autodetect" ? "en" : sourceLang;

    const translatedText = await AppleTranslation.translate(text, srcLang, targetLang);

    // Also try to detect language if auto-detect was requested
    let detectedLanguage: string | undefined;
    if (sourceLang === "autodetect") {
      detectedLanguage = await AppleTranslation.detectLanguage(text) || undefined;
    }

    return { translatedText, detectedLanguage, confidence: 1.0 };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : "Apple on-device translation failed. Try another provider.";
    throw new Error(message);
  }
}

// Apple on-device batch translation (more efficient for multiple texts)
export async function translateAppleBatch(
  texts: string[],
  sourceLang: string,
  targetLang: string
): Promise<string[]> {
  if (Platform.OS !== "ios") {
    throw new Error("Apple Translation is only available on iOS.");
  }

  const AppleTranslation = require("../../modules/apple-translation");
  const available = await AppleTranslation.isAvailable();
  if (!available) {
    throw new Error("Apple Translation requires iOS 17.4+.");
  }

  const srcLang = sourceLang === "autodetect" ? "en" : sourceLang;
  return AppleTranslation.translateBatch(texts, srcLang, targetLang);
}

// Check if Apple on-device translation is available
export async function isAppleTranslationAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    const AppleTranslation = require("../../modules/apple-translation");
    return await AppleTranslation.isAvailable();
  } catch (err) {
    logger.warn("Translation", "Apple Translation availability check failed", err);
    return false;
  }
}

// Detect language using Apple's NaturalLanguage framework (on-device, uses Neural Engine)
export async function detectLanguageOnDevice(text: string): Promise<string | null> {
  if (Platform.OS !== "ios") return null;
  try {
    const AppleTranslation = require("../../modules/apple-translation");
    return await AppleTranslation.detectLanguage(text);
  } catch (err) {
    logger.warn("Translation", "On-device language detection failed", err);
    return null;
  }
}

// ML Kit on-device translation (cross-platform, models downloaded on demand ~30MB each)
async function translateMLKit(text: string, sourceLang: string, targetLang: string, signal?: AbortSignal): Promise<TranslationResult> {
  try {
    const MLKitTranslate = require("@react-native-ml-kit/translate-text");

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const srcLang = sourceLang === "autodetect" ? "en" : sourceLang;

    const translatedText = await MLKitTranslate.translate(text, srcLang, targetLang);

    return { translatedText, confidence: 0.9 };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : "";
    const code = (err as { code?: string })?.code;
    // If ML Kit module isn't installed, give a helpful error
    if (message.includes("Cannot find module") || code === "MODULE_NOT_FOUND") {
      throw new Error("ML Kit translation not installed. Run: npx expo install @react-native-ml-kit/translate-text");
    }
    throw new Error(message || "ML Kit on-device translation failed. The language model may need to download first.");
  }
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  signalOrOptions?: AbortSignal | TranslateOptions
): Promise<TranslationResult> {
  if (!text.trim()) {
    return { translatedText: "" };
  }

  // Parse options - backward compatible with plain AbortSignal
  let signal: AbortSignal | undefined;
  let provider: TranslationProvider = "apple";

  if (signalOrOptions instanceof AbortSignal) {
    signal = signalOrOptions;
  } else if (signalOrOptions) {
    signal = signalOrOptions.signal;
    provider = signalOrOptions.provider || "apple";
  }

  // Try offline phrase dictionary first (instant, no network needed)
  const offlineResult = offlineTranslate(text, sourceLang, targetLang);
  if (offlineResult) {
    return { translatedText: offlineResult, confidence: 1.0 };
  }

  // Check cache first (re-insert on hit for true LRU eviction)
  const cacheKey = getCacheKey(text.trim(), sourceLang, targetLang, provider);
  const cached = translationCache.get(cacheKey);
  if (cached) {
    // Move to end of Map iteration order so frequently-used entries survive eviction
    translationCache.delete(cacheKey);
    translationCache.set(cacheKey, cached);
    return { translatedText: cached };
  }

  const trimmed = text.trim();

  // Circuit breaker: skip provider if it has failed too many times recently
  if (isCircuitOpen(provider)) {
    logger.warn("Translation", `Circuit breaker open for ${provider}, falling back`);
    if (provider !== "mymemory" && !isCircuitOpen("mymemory")) {
      const fallback = await translateMyMemory(trimmed, sourceLang, targetLang, signal);
      recordSuccess("mymemory");
      return { ...fallback, translatedText: fallback.translatedText };
    }
    throw new Error(`Translation service temporarily unavailable. Try again in 30 seconds.`);
  }

  const doTranslate = async (): Promise<TranslationResult> => {
    switch (provider) {
      case "apple":
        return translateApple(trimmed, sourceLang, targetLang, signal);
      case "mlkit":
        return translateMLKit(trimmed, sourceLang, targetLang, signal);
      default:
        return translateMyMemory(trimmed, sourceLang, targetLang, signal);
    }
  };

  let result: TranslationResult;
  try {
    result = await withRetry(doTranslate, 2, signal);
    recordSuccess(provider);
  } catch (err: unknown) {
    recordFailure(provider);
    // Auto-fallback: if on-device provider fails, try MyMemory cloud as fallback
    if (provider !== "mymemory") {
      try {
        result = await translateMyMemory(trimmed, sourceLang, targetLang, signal);
        recordSuccess("mymemory");
      } catch (fallbackErr) {
        recordFailure("mymemory");
        logger.warn("Translation", "MyMemory fallback also failed", fallbackErr);
        throw err; // Throw original error if fallback also fails
      }
    } else {
      throw err;
    }
  }

  // Store in cache, evicting oldest entries if at capacity
  if (translationCache.size >= CACHE_MAX_SIZE) {
    const firstKey = translationCache.keys().next().value!;
    translationCache.delete(firstKey);
  }
  translationCache.set(cacheKey, result.translatedText);

  return result;
}

export function clearTranslationCache() {
  translationCache.clear();
}

export interface WordAlternative {
  translation: string;
  quality: number; // 0-100
  source: string; // e.g. "MyMemory"
}

/**
 * Get alternative translations for a word/phrase using MyMemory's matches array.
 * Returns multiple translation options ranked by quality.
 */
export async function getWordAlternatives(
  word: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal
): Promise<WordAlternative[]> {
  if (!word.trim()) return [];

  const langPair = `${sourceLang}|${targetLang}`;
  const url = `${MYMEMORY_API}?q=${encodeURIComponent(word.trim())}&langpair=${encodeURIComponent(langPair)}`;

  const response = await fetchWithTimeout(url, {}, signal);
  if (!response.ok) return [];

  let data: { responseData?: { translatedText?: string; match?: number }; matches?: Array<{ translation?: string; quality?: number; match?: number; "created-by"?: string }> };
  try {
    data = await response.json();
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const alternatives: WordAlternative[] = [];

  // Primary result
  if (data.responseData?.translatedText) {
    const text = data.responseData.translatedText.trim();
    if (text) {
      seen.add(text.toLowerCase());
      alternatives.push({
        translation: text,
        quality: Math.round((data.responseData.match || 0) * 100),
        source: "Primary",
      });
    }
  }

  // Additional matches from the API
  if (Array.isArray(data.matches)) {
    for (const match of data.matches) {
      const text = (match.translation || "").trim();
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      alternatives.push({
        translation: text,
        quality: Math.round((match.quality || match.match || 0) * (match.quality ? 1 : 100)),
        source: match["created-by"] || "Community",
      });
      if (alternatives.length >= 8) break;
    }
  }

  return alternatives;
}

export interface Language {
  code: string;
  name: string;
  speechCode: string; // BCP-47 code for speech recognition
  flag: string; // Emoji flag for visual identification
}

export const AUTO_DETECT_LANGUAGE: Language = {
  code: "autodetect",
  name: "Auto-Detect",
  speechCode: "", // Not used for speech input with auto-detect
  flag: "🌐",
};

// O(1) lookup by language code — use instead of LANGUAGES.find()
export const LANGUAGE_MAP: Map<string, Language> = new Map();

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", speechCode: "en-US", flag: "🇺🇸" },
  { code: "es", name: "Spanish", speechCode: "es-ES", flag: "🇪🇸" },
  { code: "fr", name: "French", speechCode: "fr-FR", flag: "🇫🇷" },
  { code: "de", name: "German", speechCode: "de-DE", flag: "🇩🇪" },
  { code: "it", name: "Italian", speechCode: "it-IT", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", speechCode: "pt-BR", flag: "🇧🇷" },
  { code: "zh", name: "Chinese", speechCode: "zh-CN", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", speechCode: "ja-JP", flag: "🇯🇵" },
  { code: "ko", name: "Korean", speechCode: "ko-KR", flag: "🇰🇷" },
  { code: "ar", name: "Arabic", speechCode: "ar-SA", flag: "🇸🇦" },
  { code: "hi", name: "Hindi", speechCode: "hi-IN", flag: "🇮🇳" },
  { code: "ru", name: "Russian", speechCode: "ru-RU", flag: "🇷🇺" },
  { code: "nl", name: "Dutch", speechCode: "nl-NL", flag: "🇳🇱" },
  { code: "sv", name: "Swedish", speechCode: "sv-SE", flag: "🇸🇪" },
  { code: "pl", name: "Polish", speechCode: "pl-PL", flag: "🇵🇱" },
  { code: "tr", name: "Turkish", speechCode: "tr-TR", flag: "🇹🇷" },
  { code: "th", name: "Thai", speechCode: "th-TH", flag: "🇹🇭" },
  { code: "vi", name: "Vietnamese", speechCode: "vi-VN", flag: "🇻🇳" },
  { code: "uk", name: "Ukrainian", speechCode: "uk-UA", flag: "🇺🇦" },
  { code: "cs", name: "Czech", speechCode: "cs-CZ", flag: "🇨🇿" },
];

// Populate lookup map
for (const lang of LANGUAGES) {
  LANGUAGE_MAP.set(lang.code, lang);
}
