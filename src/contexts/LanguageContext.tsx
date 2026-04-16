import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Language, LANGUAGES, LANGUAGE_MAP } from "../services/translation";
import { impactLight } from "../services/haptics";
import { logger } from "../services/logger";

// Selection context: sourceLang/targetLang/setters/swap/applyPair
// Pairs context (see LanguagePairsContext.tsx): savedPairs + recent langs
//
// Kept separate so consumers that only need sourceLang/targetLang
// (GlossaryContext, SettingsScreen, ScanScreen, SplitConversation,
// ConversationPlayback) don't re-render when the user stars a pair
// or picks a new recent language.

interface LanguageContextValue {
  sourceLang: Language;
  targetLang: Language;
  setSourceLang: (lang: Language) => void;
  setTargetLang: (lang: Language) => void;
  swapLanguages: () => void;
  applyPair: (sourceCode: string, targetCode: string) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [sourceLang, setSourceLang] = useState<Language>(LANGUAGES[0]); // English
  const [targetLang, setTargetLang] = useState<Language>(LANGUAGES[1]); // Spanish

  const swapLanguages = useCallback(() => {
    impactLight();
    if (sourceLang.code === "autodetect") {
      setSourceLang(targetLang);
      setTargetLang(LANGUAGES[0]); // English
    } else {
      const prev = sourceLang;
      setSourceLang(targetLang);
      setTargetLang(prev);
    }
  }, [sourceLang, targetLang]);

  const applyPair = useCallback((sourceCode: string, targetCode: string) => {
    const src = LANGUAGE_MAP.get(sourceCode);
    const tgt = LANGUAGE_MAP.get(targetCode);
    if (src && tgt) {
      impactLight();
      setSourceLang(src);
      setTargetLang(tgt);
    }
  }, []);

  const value = useMemo(() => ({
    sourceLang,
    targetLang,
    setSourceLang,
    setTargetLang,
    swapLanguages,
    applyPair,
  }), [sourceLang, targetLang, swapLanguages, applyPair]);

  return (
    <LanguageContext.Provider value={value}>
      <LanguagePairsProvider>{children}</LanguagePairsProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}

// --- Language Pairs Context (saved pairs + recent langs) ---

const RECENT_LANGS_KEY = "recent_languages";
const LANG_PAIRS_KEY = "saved_language_pairs";

interface SavedPair {
  sourceCode: string;
  targetCode: string;
}

interface LanguagePairsContextValue {
  recentLangCodes: string[];
  trackRecentLang: (code: string) => void;
  savedPairs: SavedPair[];
  addSavedPair: (sourceCode: string, targetCode: string) => void;
  removeSavedPair: (sourceCode: string, targetCode: string) => void;
}

const LanguagePairsContext = createContext<LanguagePairsContextValue | null>(null);

function LanguagePairsProvider({ children }: { children: React.ReactNode }) {
  const [recentLangCodes, setRecentLangCodes] = useState<string[]>([]);
  const [savedPairs, setSavedPairs] = useState<SavedPair[]>([]);

  useEffect(() => {
    AsyncStorage.multiGet([RECENT_LANGS_KEY, LANG_PAIRS_KEY])
      .then((results) => {
        if (results[0][1]) {
          try {
            const parsed = JSON.parse(results[0][1]);
            if (Array.isArray(parsed)) setRecentLangCodes(parsed);
          } catch (err) {
            logger.warn("Settings", "Corrupted recent languages data, using defaults", err);
          }
        }
        if (results[1][1]) {
          try {
            const parsed = JSON.parse(results[1][1]);
            if (Array.isArray(parsed)) setSavedPairs(parsed);
          } catch (err) {
            logger.warn("Settings", "Corrupted saved pairs data, using defaults", err);
          }
        }
      })
      .catch((err) => logger.warn("Settings", "Failed to load language data", err));
  }, []);

  const trackRecentLang = useCallback((code: string) => {
    if (code === "autodetect") return;
    setRecentLangCodes((prev) => {
      const updated = [code, ...prev.filter((c) => c !== code)].slice(0, 5);
      AsyncStorage.setItem(RECENT_LANGS_KEY, JSON.stringify(updated))
        .catch((err) => logger.warn("Settings", "Failed to persist recent languages", err));
      return updated;
    });
  }, []);

  const addSavedPair = useCallback((sourceCode: string, targetCode: string) => {
    if (sourceCode === "autodetect") return;
    impactLight();
    setSavedPairs((prev) => {
      if (prev.some((p) => p.sourceCode === sourceCode && p.targetCode === targetCode)) return prev;
      const updated = [...prev, { sourceCode, targetCode }].slice(0, 8);
      AsyncStorage.setItem(LANG_PAIRS_KEY, JSON.stringify(updated))
        .catch((err) => logger.warn("Settings", "Failed to persist saved pairs", err));
      return updated;
    });
  }, []);

  const removeSavedPair = useCallback((sourceCode: string, targetCode: string) => {
    impactLight();
    setSavedPairs((prev) => {
      const updated = prev.filter((p) => !(p.sourceCode === sourceCode && p.targetCode === targetCode));
      AsyncStorage.setItem(LANG_PAIRS_KEY, JSON.stringify(updated))
        .catch((err) => logger.warn("Settings", "Failed to persist saved pairs", err));
      return updated;
    });
  }, []);

  const value = useMemo(() => ({
    recentLangCodes,
    trackRecentLang,
    savedPairs,
    addSavedPair,
    removeSavedPair,
  }), [recentLangCodes, trackRecentLang, savedPairs, addSavedPair, removeSavedPair]);

  return (
    <LanguagePairsContext.Provider value={value}>{children}</LanguagePairsContext.Provider>
  );
}

export function useLanguagePairs(): LanguagePairsContextValue {
  const ctx = useContext(LanguagePairsContext);
  if (!ctx) throw new Error("useLanguagePairs must be used within a LanguageProvider");
  return ctx;
}
