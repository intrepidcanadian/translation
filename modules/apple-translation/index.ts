import { requireNativeModule, Platform } from "expo-modules-core";

export interface DocumentAnalysis {
  detectedLanguage: string | null;
  persons: string[];
  organizations: string[];
  places: string[];
  dates: string[];
  phoneNumbers: string[];
  urls: string[];
  addresses: string[];
  moneyAmounts: string[];
  sentenceCount: number;
  wordCount: number;
}

interface AppleTranslationModuleType {
  translate(text: string, sourceLanguage: string, targetLanguage: string): Promise<string>;
  translateBatch(texts: string[], sourceLanguage: string, targetLanguage: string): Promise<string[]>;
  isAvailable(): Promise<boolean>;
  getSupportedLanguages(): Promise<string[]>;
  downloadLanguage(languageCode: string): Promise<void>;
  detectLanguage(text: string): Promise<string | null>;
  extractEntities(text: string): Promise<{ persons: string[]; organizations: string[]; places: string[] }>;
  analyzeDocument(text: string): Promise<DocumentAnalysis>;
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

export async function extractEntities(
  text: string
): Promise<{ persons: string[]; organizations: string[]; places: string[] }> {
  if (!isIOS) return { persons: [], organizations: [], places: [] };
  try {
    return await getModule().extractEntities(text);
  } catch {
    return { persons: [], organizations: [], places: [] };
  }
}

export async function analyzeDocument(text: string): Promise<DocumentAnalysis> {
  if (!isIOS) {
    return {
      detectedLanguage: null,
      persons: [],
      organizations: [],
      places: [],
      dates: [],
      phoneNumbers: [],
      urls: [],
      addresses: [],
      moneyAmounts: [],
      sentenceCount: 0,
      wordCount: 0,
    };
  }
  return getModule().analyzeDocument(text);
}
