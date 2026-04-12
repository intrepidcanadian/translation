// Translation service supporting multiple providers
// MyMemory (free, no key), DeepL, Google Cloud Translation

import { offlineTranslate } from "./offlinePhrases";

export type TranslationProvider = "mymemory" | "deepl" | "google";

const MYMEMORY_API = "https://api.mymemory.translated.net/get";
const DEEPL_API = "https://api-free.deepl.com/v2/translate";
const GOOGLE_API = "https://translation.googleapis.com/language/translate/v2";

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
  apiKey?: string;
  signal?: AbortSignal;
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

// DeepL language code mapping (DeepL uses uppercase and some variants)
function toDeepLLang(code: string, isTarget: boolean): string {
  const map: Record<string, string> = { en: isTarget ? "EN-US" : "EN", pt: isTarget ? "PT-BR" : "PT", zh: "ZH" };
  return (map[code] || code).toUpperCase();
}

async function translateDeepL(text: string, sourceLang: string, targetLang: string, apiKey: string, signal?: AbortSignal): Promise<TranslationResult> {
  if (!apiKey) throw new Error("DeepL API key required. Add it in Settings.");

  const body = new URLSearchParams({
    text,
    target_lang: toDeepLLang(targetLang, true),
    ...(sourceLang !== "autodetect" ? { source_lang: toDeepLLang(sourceLang, false) } : {}),
  });

  const response = await fetchWithTimeout(DEEPL_API, {
    method: "POST",
    headers: {
      "Authorization": `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  }, signal);

  if (response.status === 403) throw new Error("Invalid DeepL API key. Check Settings.");
  if (response.status === 456) throw new Error("DeepL quota exceeded.");
  if (!response.ok) throw new Error(`DeepL error (${response.status}). Try again.`);

  const data = await response.json();
  const translation = data.translations?.[0];
  return {
    translatedText: translation?.text || "",
    detectedLanguage: translation?.detected_source_language?.toLowerCase(),
  };
}

async function translateGoogle(text: string, sourceLang: string, targetLang: string, apiKey: string, signal?: AbortSignal): Promise<TranslationResult> {
  if (!apiKey) throw new Error("Google Cloud API key required. Add it in Settings.");

  const params = new URLSearchParams({
    q: text,
    target: targetLang,
    format: "text",
    key: apiKey,
    ...(sourceLang !== "autodetect" ? { source: sourceLang } : {}),
  });

  const response = await fetchWithTimeout(`${GOOGLE_API}?${params}`, {}, signal);

  if (response.status === 403) throw new Error("Invalid Google API key. Check Settings.");
  if (!response.ok) throw new Error(`Google Translate error (${response.status}). Try again.`);

  const data = await response.json();
  const translation = data.data?.translations?.[0];
  return {
    translatedText: translation?.translatedText || "",
    detectedLanguage: translation?.detectedSourceLanguage,
  };
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
  let provider: TranslationProvider = "mymemory";
  let apiKey = "";

  if (signalOrOptions instanceof AbortSignal) {
    signal = signalOrOptions;
  } else if (signalOrOptions) {
    signal = signalOrOptions.signal;
    provider = signalOrOptions.provider || "mymemory";
    apiKey = signalOrOptions.apiKey || "";
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

  let result: TranslationResult;
  switch (provider) {
    case "deepl":
      result = await translateDeepL(text.trim(), sourceLang, targetLang, apiKey, signal);
      break;
    case "google":
      result = await translateGoogle(text.trim(), sourceLang, targetLang, apiKey, signal);
      break;
    default:
      result = await translateMyMemory(text.trim(), sourceLang, targetLang, signal);
      break;
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
