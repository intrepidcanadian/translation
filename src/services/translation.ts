// Translation service using MyMemory API (free, no API key required)
// For production, consider Google Cloud Translation or DeepL

const MYMEMORY_API = "https://api.mymemory.translated.net/get";

const CACHE_MAX_SIZE = 200;
const translationCache = new Map<string, string>();

function getCacheKey(text: string, sourceLang: string, targetLang: string) {
  return `${sourceLang}|${targetLang}|${text}`;
}

export interface TranslationResult {
  translatedText: string;
  detectedLanguage?: string;
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal
): Promise<TranslationResult> {
  if (!text.trim()) {
    return { translatedText: "" };
  }

  // Check cache first
  const cacheKey = getCacheKey(text.trim(), sourceLang, targetLang);
  const cached = translationCache.get(cacheKey);
  if (cached) {
    return { translatedText: cached };
  }

  const langPair = `${sourceLang}|${targetLang}`;
  const url = `${MYMEMORY_API}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;

  // Timeout after 8 seconds to prevent hanging requests
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 8000);

  // If a caller-provided signal exists, forward its abort to our timeout controller
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      timeoutController.abort();
    } else {
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        timeoutController.abort();
      });
    }
  }

  let response: Response;
  try {
    response = await fetch(url, { signal: timeoutController.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      // If the caller's signal caused the abort, re-throw as-is
      if (signal?.aborted) throw err;
      // Otherwise it was our timeout
      throw new Error("Translation timed out. Check your connection and try again.");
    }
    throw new Error("No internet connection. Check your network and try again.");
  }
  clearTimeout(timeoutId);

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

  const translatedText: string = data.responseData.translatedText;

  // Store in cache, evicting oldest entries if at capacity
  if (translationCache.size >= CACHE_MAX_SIZE) {
    const firstKey = translationCache.keys().next().value!;
    translationCache.delete(firstKey);
  }
  translationCache.set(cacheKey, translatedText);

  return {
    translatedText,
    detectedLanguage: data.responseData.detectedLanguage,
  };
}

export function clearTranslationCache() {
  translationCache.clear();
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
