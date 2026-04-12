// Translation service — on-device first (Apple Neural Engine, ML Kit), MyMemory cloud as fallback

import { Platform } from "react-native";
import { offlineTranslate } from "./offlinePhrases";

export type TranslationProvider = "mymemory" | "apple" | "mlkit";

const MYMEMORY_API = "https://api.mymemory.translated.net/get";

const CACHE_MAX_SIZE = 200;
const translationCache = new Map<string, string>();

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
    } catch (err: any) {
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

  const data = await response.json();

  if (data.responseStatus === 429) {
    throw new Error("Too many translation requests. Wait a moment and try again.");
  }
  if (data.responseStatus !== 200) {
    throw new Error(data.responseDetails || "Translation failed. Try again.");
  }

  const match = data.responseData.match;
  return {
    translatedText: data.responseData.translatedText,
    detectedLanguage: data.responseData.detectedLanguage,
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
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    throw new Error(err?.message || "Apple on-device translation failed. Try another provider.");
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
  } catch {
    return false;
  }
}

// Detect language using Apple's NaturalLanguage framework (on-device, uses Neural Engine)
export async function detectLanguageOnDevice(text: string): Promise<string | null> {
  if (Platform.OS !== "ios") return null;
  try {
    const AppleTranslation = require("../../modules/apple-translation");
    return await AppleTranslation.detectLanguage(text);
  } catch {
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
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    // If ML Kit module isn't installed, give a helpful error
    if (err?.message?.includes("Cannot find module") || err?.code === "MODULE_NOT_FOUND") {
      throw new Error("ML Kit translation not installed. Run: npx expo install @react-native-ml-kit/translate-text");
    }
    throw new Error(err?.message || "ML Kit on-device translation failed. The language model may need to download first.");
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

  // Check cache first
  const cacheKey = getCacheKey(text.trim(), sourceLang, targetLang, provider);
  const cached = translationCache.get(cacheKey);
  if (cached) {
    return { translatedText: cached };
  }

  const trimmed = text.trim();
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
  } catch (err: any) {
    // Auto-fallback: if on-device provider fails, try MyMemory cloud as fallback
    if (provider !== "mymemory") {
      try {
        result = await translateMyMemory(trimmed, sourceLang, targetLang, signal);
      } catch {
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

  const data = await response.json();
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
}

export const AUTO_DETECT_LANGUAGE: Language = {
  code: "autodetect",
  name: "Auto-Detect",
  speechCode: "", // Not used for speech input with auto-detect
};

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", speechCode: "en-US" },
  { code: "es", name: "Spanish", speechCode: "es-ES" },
  { code: "fr", name: "French", speechCode: "fr-FR" },
  { code: "de", name: "German", speechCode: "de-DE" },
  { code: "it", name: "Italian", speechCode: "it-IT" },
  { code: "pt", name: "Portuguese", speechCode: "pt-BR" },
  { code: "zh", name: "Chinese", speechCode: "zh-CN" },
  { code: "ja", name: "Japanese", speechCode: "ja-JP" },
  { code: "ko", name: "Korean", speechCode: "ko-KR" },
  { code: "ar", name: "Arabic", speechCode: "ar-SA" },
  { code: "hi", name: "Hindi", speechCode: "hi-IN" },
  { code: "ru", name: "Russian", speechCode: "ru-RU" },
  { code: "nl", name: "Dutch", speechCode: "nl-NL" },
  { code: "sv", name: "Swedish", speechCode: "sv-SE" },
  { code: "pl", name: "Polish", speechCode: "pl-PL" },
  { code: "tr", name: "Turkish", speechCode: "tr-TR" },
  { code: "th", name: "Thai", speechCode: "th-TH" },
  { code: "vi", name: "Vietnamese", speechCode: "vi-VN" },
  { code: "uk", name: "Ukrainian", speechCode: "uk-UA" },
  { code: "cs", name: "Czech", speechCode: "cs-CZ" },
];
