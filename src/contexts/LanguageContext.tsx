import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Language, LANGUAGES } from "../services/translation";
import { impactLight, impactMedium } from "../services/haptics";

const RECENT_LANGS_KEY = "recent_languages";
const LANG_PAIRS_KEY = "saved_language_pairs";

interface SavedPair {
  sourceCode: string;
  targetCode: string;
}

interface LanguageContextValue {
  sourceLang: Language;
  targetLang: Language;
  setSourceLang: (lang: Language) => void;
  setTargetLang: (lang: Language) => void;
  swapLanguages: () => void;
  recentLangCodes: string[];
  trackRecentLang: (code: string) => void;
  savedPairs: SavedPair[];
  isCurrentPairSaved: boolean;
  toggleSavePair: () => void;
  applyPair: (sourceCode: string, targetCode: string) => void;
  removeSavedPair: (sourceCode: string, targetCode: string) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [sourceLang, setSourceLang] = useState<Language>(LANGUAGES[0]); // English
  const [targetLang, setTargetLang] = useState<Language>(LANGUAGES[1]); // Spanish
  const [recentLangCodes, setRecentLangCodes] = useState<string[]>([]);
  const [savedPairs, setSavedPairs] = useState<SavedPair[]>([]);

  useEffect(() => {
    AsyncStorage.multiGet([RECENT_LANGS_KEY, LANG_PAIRS_KEY])
      .then((results) => {
        if (results[0][1]) setRecentLangCodes(JSON.parse(results[0][1]));
        if (results[1][1]) setSavedPairs(JSON.parse(results[1][1]));
      })
      .catch((err) => console.warn("Failed to load language data:", err));
  }, []);

  const trackRecentLang = useCallback((code: string) => {
    if (code === "autodetect") return;
    setRecentLangCodes((prev) => {
      const updated = [code, ...prev.filter((c) => c !== code)].slice(0, 5);
      AsyncStorage.setItem(RECENT_LANGS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

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

  const isCurrentPairSaved = useMemo(
    () => savedPairs.some((p) => p.sourceCode === sourceLang.code && p.targetCode === targetLang.code),
    [savedPairs, sourceLang.code, targetLang.code]
  );

  const toggleSavePair = useCallback(() => {
    if (sourceLang.code === "autodetect") return;
    impactLight();
    setSavedPairs((prev) => {
      const exists = prev.some(
        (p) => p.sourceCode === sourceLang.code && p.targetCode === targetLang.code
      );
      const updated = exists
        ? prev.filter((p) => !(p.sourceCode === sourceLang.code && p.targetCode === targetLang.code))
        : [...prev, { sourceCode: sourceLang.code, targetCode: targetLang.code }].slice(0, 8);
      AsyncStorage.setItem(LANG_PAIRS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, [sourceLang.code, targetLang.code]);

  const applyPair = useCallback((sourceCode: string, targetCode: string) => {
    const src = LANGUAGES.find((l) => l.code === sourceCode);
    const tgt = LANGUAGES.find((l) => l.code === targetCode);
    if (src && tgt) {
      impactLight();
      setSourceLang(src);
      setTargetLang(tgt);
    }
  }, []);

  const removeSavedPair = useCallback((sourceCode: string, targetCode: string) => {
    impactMedium();
    setSavedPairs((prev) => {
      const updated = prev.filter((p) => !(p.sourceCode === sourceCode && p.targetCode === targetCode));
      AsyncStorage.setItem(LANG_PAIRS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const value = useMemo(() => ({
    sourceLang,
    targetLang,
    setSourceLang,
    setTargetLang,
    swapLanguages,
    recentLangCodes,
    trackRecentLang,
    savedPairs,
    isCurrentPairSaved,
    toggleSavePair,
    applyPair,
    removeSavedPair,
  }), [sourceLang, targetLang, swapLanguages, recentLangCodes, trackRecentLang, savedPairs, isCurrentPairSaved, toggleSavePair, applyPair, removeSavedPair]);

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}
