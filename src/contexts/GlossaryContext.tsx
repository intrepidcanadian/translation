import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { impactLight, impactMedium } from "../services/haptics";
import { logger } from "../services/logger";
import { normalizeForLookup, lookupKey } from "../utils/stringNormalize";
import {
  isValidGlossaryEntry,
  validateGlossaryPayload,
  type GlossaryEntry,
} from "../utils/glossaryValidation";
import { useLanguage } from "./LanguageContext";

const GLOSSARY_KEY = "user_glossary";

export type { GlossaryEntry };

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
              // #130: shared pure-validator module decides whether the
              // payload is structurally corrupted. A partial corruption
              // still salvages the valid rows; a majority-broken payload
              // falls back to empty rather than leaking a half-sanitized
              // glossary. See src/utils/glossaryValidation.ts + its
              // dedicated test suite for the exact contract.
              const { valid, dropped, corrupted } = validateGlossaryPayload(parsed);
              if (corrupted) {
                logger.warn(
                  "Glossary",
                  `Glossary looks corrupted (${dropped}/${parsed.length} invalid); falling back to empty`
                );
                setGlossary([]);
              } else {
                if (dropped > 0) {
                  logger.warn(
                    "Glossary",
                    `Dropped ${dropped} malformed glossary entries`
                  );
                }
                setGlossary(valid);
              }
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
    // Validate imported entries so CSV/clipboard imports can't sneak bogus
    // lang codes or blank rows past the same guards that run on load (#130).
    const valid = entries.filter(isValidGlossaryEntry);
    const dropped = entries.length - valid.length;
    if (dropped > 0) {
      logger.warn(
        "Glossary",
        `Dropped ${dropped} invalid entries during import`
      );
    }
    setGlossary(valid);
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
