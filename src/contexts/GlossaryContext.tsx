import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { impactLight, impactMedium } from "../services/haptics";
import { logger } from "../services/logger";
import { normalizeForLookup, lookupKey } from "../utils/stringNormalize";
import { useLanguage } from "./LanguageContext";

const GLOSSARY_KEY = "user_glossary";

export interface GlossaryEntry {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
}

interface GlossaryContextValue {
  glossary: GlossaryEntry[];
  glossaryLookup: (text: string, srcLang: string, tgtLang: string) => string | null;
  addGlossaryEntry: (src: string, tgt: string) => void;
  removeGlossaryEntry: (index: number) => void;
  importGlossaryEntries: (entries: GlossaryEntry[]) => void;
}

const GlossaryContext = createContext<GlossaryContextValue | null>(null);

export function GlossaryProvider({ children }: { children: React.ReactNode }) {
  const { sourceLang, targetLang } = useLanguage();
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(GLOSSARY_KEY)
      .then((val) => {
        if (val) {
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) {
              // Filter to only well-formed entries so a partial corruption
              // doesn't poison the whole glossary.
              const valid = parsed.filter(
                (e): e is GlossaryEntry =>
                  e &&
                  typeof e === "object" &&
                  typeof e.source === "string" &&
                  typeof e.target === "string" &&
                  typeof e.sourceLang === "string" &&
                  typeof e.targetLang === "string"
              );
              if (valid.length < parsed.length) {
                logger.warn(
                  "Glossary",
                  `Dropped ${parsed.length - valid.length} malformed glossary entries`
                );
              }
              setGlossary(valid);
            } else {
              logger.warn("Glossary", "Stored glossary was not an array, discarding");
            }
          } catch (err) {
            logger.warn("Glossary", "Corrupted glossary JSON, starting fresh", err);
          }
        }
        loaded.current = true;
      })
      .catch((err) => logger.warn("Glossary", "Failed to load glossary", err));
  }, []);

  // Persist glossary changes (skip initial load)
  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(GLOSSARY_KEY, JSON.stringify(glossary)).catch((err) =>
      logger.warn("Glossary", "Failed to save glossary", err)
    );
  }, [glossary]);

  const glossaryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of glossary) {
      // Use shared normalizer so trailing punctuation ("hello!" / "hello")
      // collapses to the same key as the offline phrase dictionary.
      const key = lookupKey(g.sourceLang, g.targetLang, normalizeForLookup(g.source));
      map.set(key, g.target);
    }
    return map;
  }, [glossary]);

  const glossaryLookup = useCallback(
    (text: string, srcLang: string, tgtLang: string): string | null => {
      const key = lookupKey(srcLang, tgtLang, normalizeForLookup(text));
      return glossaryMap.get(key) ?? null;
    },
    [glossaryMap]
  );

  const addGlossaryEntry = useCallback(
    (src: string, tgt: string) => {
      if (!src || !tgt) return;
      impactLight();
      const normalizedSrc = normalizeForLookup(src);
      setGlossary((prev) => {
        const filtered = prev.filter(
          (g) =>
            !(
              normalizeForLookup(g.source) === normalizedSrc &&
              g.sourceLang === sourceLang.code &&
              g.targetLang === targetLang.code
            )
        );
        return [...filtered, { source: src, target: tgt, sourceLang: sourceLang.code, targetLang: targetLang.code }];
      });
    },
    [sourceLang.code, targetLang.code]
  );

  const removeGlossaryEntry = useCallback((index: number) => {
    impactMedium();
    setGlossary((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const importGlossaryEntries = useCallback((entries: GlossaryEntry[]) => {
    setGlossary(entries);
  }, []);

  const value = useMemo(
    () => ({
      glossary,
      glossaryLookup,
      addGlossaryEntry,
      removeGlossaryEntry,
      importGlossaryEntries,
    }),
    [glossary, glossaryLookup, addGlossaryEntry, removeGlossaryEntry, importGlossaryEntries]
  );

  return <GlossaryContext.Provider value={value}>{children}</GlossaryContext.Provider>;
}

export function useGlossary(): GlossaryContextValue {
  const ctx = useContext(GlossaryContext);
  if (!ctx) throw new Error("useGlossary must be used within a GlossaryProvider");
  return ctx;
}
