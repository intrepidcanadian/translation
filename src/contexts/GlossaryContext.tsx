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

// Cheap validator for a single parsed entry. Tightened beyond the previous
// "is it an object with 4 string fields" check so that entries with blank
// source/target or obviously-bogus language codes get dropped at load time
// instead of leaking into the live app as "ghost" rows (#130).
const LANG_CODE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

function isValidGlossaryEntry(e: unknown): e is GlossaryEntry {
  if (!e || typeof e !== "object") return false;
  const entry = e as Record<string, unknown>;
  if (typeof entry.source !== "string" || entry.source.trim() === "") return false;
  if (typeof entry.target !== "string" || entry.target.trim() === "") return false;
  if (typeof entry.sourceLang !== "string" || !LANG_CODE_RE.test(entry.sourceLang)) return false;
  if (typeof entry.targetLang !== "string" || !LANG_CODE_RE.test(entry.targetLang)) return false;
  return true;
}

// If more than half of the entries in a stored glossary fail validation we
// treat the file as corrupted and fall back to empty rather than leaking a
// half-sanitized dictionary into the UI (#130 follow-up). The 50% threshold
// is deliberately lenient — the common case is "one bad CSV import added a
// handful of bogus rows"; a true file corruption usually wrecks almost
// everything and trips this guard.
const CORRUPTION_DROP_RATIO = 0.5;

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
              // Strict per-entry validation + whole-file corruption check.
              // A partial corruption still salvages the valid rows, but if
              // the majority of the file fails validation we treat it as
              // structural corruption and fall back to empty rather than
              // leaking a half-sanitized glossary into the live app.
              const valid = parsed.filter(isValidGlossaryEntry);
              const dropped = parsed.length - valid.length;
              if (parsed.length > 0 && dropped / parsed.length > CORRUPTION_DROP_RATIO) {
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
