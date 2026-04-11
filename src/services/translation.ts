// Translation service using MyMemory API (free, no API key required)
// For production, consider Google Cloud Translation or DeepL

const MYMEMORY_API = "https://api.mymemory.translated.net/get";

export interface TranslationResult {
  translatedText: string;
  detectedLanguage?: string;
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<TranslationResult> {
  if (!text.trim()) {
    return { translatedText: "" };
  }

  const langPair = `${sourceLang}|${targetLang}`;
  const url = `${MYMEMORY_API}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Translation failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.responseStatus !== 200) {
    throw new Error(data.responseDetails || "Translation failed");
  }

  return {
    translatedText: data.responseData.translatedText,
    detectedLanguage: data.responseData.detectedLanguage,
  };
}

export interface Language {
  code: string;
  name: string;
  speechCode: string; // BCP-47 code for speech recognition
}

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
