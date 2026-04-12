import { requireNativeModule, Platform } from "expo-modules-core";

interface AppleTranslationModuleType {
  translate(text: string, sourceLanguage: string, targetLanguage: string): Promise<string>;
  translateBatch(texts: string[], sourceLanguage: string, targetLanguage: string): Promise<string[]>;
  isAvailable(): Promise<boolean>;
  getSupportedLanguages(): Promise<string[]>;
  downloadLanguage(languageCode: string): Promise<void>;
  detectLanguage(text: string): Promise<string | null>;
}

const isIOS = Platform.OS === "ios";

let nativeModule: AppleTranslationModuleType | undefined;

function getModule(): AppleTranslationModuleType {
  if (!nativeModule) {
    if (!isIOS) {
      throw new Error("AppleTranslation is only available on iOS");
    }
    nativeModule = requireNativeModule("AppleTranslation") as AppleTranslationModuleType;
  }
  return nativeModule;
}

export async function translate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<string> {
  return getModule().translate(text, sourceLanguage, targetLanguage);
}

export async function translateBatch(
  texts: string[],
  sourceLanguage: string,
  targetLanguage: string
): Promise<string[]> {
  return getModule().translateBatch(texts, sourceLanguage, targetLanguage);
}

export async function isAvailable(): Promise<boolean> {
  if (!isIOS) return false;
  try {
    return await getModule().isAvailable();
  } catch {
    return false;
  }
}

export async function getSupportedLanguages(): Promise<string[]> {
  if (!isIOS) return [];
  try {
    return await getModule().getSupportedLanguages();
  } catch {
    return [];
  }
}

export async function downloadLanguage(languageCode: string): Promise<void> {
  return getModule().downloadLanguage(languageCode);
}

export async function detectLanguage(text: string): Promise<string | null> {
  if (!isIOS) return null;
  try {
    return await getModule().detectLanguage(text);
  } catch {
    return null;
  }
}
