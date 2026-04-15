import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { impactLight, impactMedium } from "../services/haptics";
import { logger } from "../services/logger";
import { normalizeForLookup, lookupKey } from "../utils/stringNormalize";
import {
  isValidGlossaryEntry,
  resolveGlossaryLoad,
  type GlossaryEntry,
} from "../utils/glossaryValidation";
import { useLanguage } from "./LanguageContext";

const GLOSSARY_KEY = "user_glossary";
// #137: last-known-good backup key. Written alongside the primary glossary
// whenever validateGlossaryPayload returns a non-corrupted result; read as a
// fallback when the primary key is structurally corrupted. Lets a user
// survive a single AsyncStorage corruption event without losing their
// glossary to the #130 "fall back to empty" branch.
const GLOSSARY_BACKUP_KEY = "user_glossary_backup";

export type { GlossaryEntry };

/**
 * Parse a stored glossary blob. Returns `null` for empty/missing values and
 * for malformed JSON — either case means "no usable payload", which
 * `resolveGlossaryLoad` knows how to handle.
 */
function parseGlossaryJSON(raw: string | null, label: "primary" | "backup"): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn("Glossary", `Corrupted ${label} glossary JSON`, err);
    return null;
  }
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
    // #137: read primary + backup in a single batched AsyncStorage call and
    // run the pure resolver to decide which one feeds the live glossary.
    // The resolver also tells us whether to rewrite the backup — we only
    // do it for known-good primary payloads, never when we just fell back
    // to the backup itself.
    AsyncStorage.multiGet([GLOSSARY_KEY, GLOSSARY_BACKUP_KEY])
      .then((pairs) => {
        const primaryRaw = pairs.find((p) => p[0] === GLOSSARY_KEY)?.[1] ?? null;
        const backupRaw = pairs.find((p) => p[0] === GLOSSARY_BACKUP_KEY)?.[1] ?? null;
        const parsedPrimary = parseGlossaryJSON(primaryRaw, "primary");
        const parsedBackup = parseGlossaryJSON(backupRaw, "backup");

        const resolution = resolveGlossaryLoad(parsedPrimary, parsedBackup);

        if (resolution.outcome === "primary") {
          if (resolution.dropped > 0) {
            logger.warn(
              "Glossary",
              `Dropped ${resolution.dropped} malformed glossary entries`
            );
          }
          setGlossary(resolution.entries);
        } else if (resolution.outcome === "backup") {
          // Surfaced so the user can see their glossary was rescued — this
          // is the exact incident #137 was designed for.
          logger.warn(
            "Glossary",
            `Primary glossary corrupted; restored ${resolution.entries.length} entries from last-known-good backup`
          );
          setGlossary(resolution.entries);
        } else if (resolution.outcome === "empty-corrupted") {
          logger.warn(
            "Glossary",
            `Glossary looks corrupted (${resolution.dropped} invalid) and no usable backup; falling back to empty`
          );
          setGlossary([]);
        }
        // "empty-fresh": first launch — leave state at its default [] without logging.

        if (resolution.rewriteBackup) {
          // Rewrite the backup to match the known-good primary so future
          // corruption events can recover to the current state rather than
          // a stale snapshot. Fire-and-forget; a single write failure just
          // means the next app launch rehydrates from the previous backup.
          AsyncStorage.setItem(
            GLOSSARY_BACKUP_KEY,
            JSON.stringify(resolution.entries)
          ).catch((err) => logger.warn("Glossary", "Failed to persist glossary backup", err));
        }

        loaded.current = true;
      })
      .catch((err) => {
        logger.warn("Glossary", "Failed to load glossary", err);
        loaded.current = true;
      });
  }, []);

  // Debounced backup-write timer. The primary glossary write happens on
  // every change so the user's edits are durable immediately; the backup
  // write is debounced so a burst of edits (e.g. importing a CSV row by row
  // or rapidly adding entries via the modal) coalesces into a single backup
  // rewrite. The backup is the "last-known-good" snapshot — it only matters
  // for catastrophic corruption recovery (#137), which is much rarer than
  // routine writes, so trading some recency for less I/O is the right call.
  const backupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #189: holds the most recently scheduled (but not yet written) serialized
  // backup so the unmount cleanup can flush it synchronously instead of
  // dropping it. Cleared whenever the timer fires successfully.
  const pendingBackupRef = useRef<string | null>(null);

  // Flush any pending debounced backup write to disk and clear the timer.
  // Used by both the unmount cleanup and the AppState "background" listener
  // (#189) — the latter fires earlier than unmount on a real app-close on
  // iOS, where the JS context can be torn down before the AsyncStorage
  // bridge flushes pending writes. Force-quit recovery would otherwise lose
  // up to ~5s of LKG-backup recency relative to the last edit.
  //
  // Stable identity (empty deps) so the AppState listener's `useEffect`
  // doesn't have to re-subscribe on every render — both refs are mutated
  // in place so the closure always reads the latest values.
  const flushBackupNow = useCallback((): void => {
    if (backupTimerRef.current !== null) {
      clearTimeout(backupTimerRef.current);
      backupTimerRef.current = null;
    }
    if (pendingBackupRef.current !== null) {
      const flushPayload = pendingBackupRef.current;
      pendingBackupRef.current = null;
      AsyncStorage.setItem(GLOSSARY_BACKUP_KEY, flushPayload).catch((err) =>
        logger.warn("Glossary", "Failed to flush glossary backup", err)
      );
    }
  }, []);

  // On unmount, flush any pending debounced backup write instead of just
  // cancelling it. The previous behavior (cancel-only) meant a fast
  // app-close within 5s of the last edit lost up to one debounce window of
  // LKG-backup recency — primary writes are immediate so the data wasn't
  // lost, but the corruption-recovery snapshot lagged by one cycle.
  useEffect(() => {
    return () => {
      flushBackupNow();
    };
  }, [flushBackupNow]);

  // #189: AppState listener fires before unmount on a real app
  // background/close event. On iOS in particular the JS context can be
  // torn down before the AsyncStorage native bridge flushes pending
  // writes from the unmount cleanup; flushing on the
  // `active → background` transition gives the bridge a chance to land
  // the write while the runtime is still alive. Cheap — `flushBackupNow`
  // is a no-op when there's nothing staged.
  useEffect(() => {
    const handleAppStateChange = (next: AppStateStatus): void => {
      if (next === "background" || next === "inactive") {
        flushBackupNow();
      }
    };
    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, [flushBackupNow]);

  // Persist glossary changes (skip initial load). The primary write is
  // immediate so the live glossary on disk always matches state — losing an
  // edit during a crash window would surprise users. The backup write is
  // debounced (#186) so an edit burst doesn't double the AsyncStorage I/O on
  // every keystroke; the LKG snapshot only needs to be roughly current to
  // serve its corruption-recovery role.
  useEffect(() => {
    if (!loaded.current) return;
    const serialized = JSON.stringify(glossary);
    AsyncStorage.setItem(GLOSSARY_KEY, serialized).catch((err) =>
      logger.warn("Glossary", "Failed to save glossary", err)
    );
    // Only mirror to the backup when we have at least one entry — an empty
    // in-memory state could mean "user cleared glossary" (legitimate) OR
    // "load failed so state is [] and backup is still good" (which we must
    // not clobber). Since clearing via the UI produces a non-empty -> empty
    // transition that we can't distinguish from the second case at this
    // layer, we leave the backup alone and let the next real save refresh
    // it. Tradeoff: a cleared-but-never-re-added glossary keeps its stale
    // backup until the next add, which is harmless.
    if (glossary.length > 0) {
      // Debounce 5s — long enough that a typical "add 10 entries in a row"
      // session collapses to a single backup write, short enough that a
      // crash within seconds of the last edit still has a fresh backup.
      // Matches the telemetry persist debounce (PERSIST_DEBOUNCE_MS) for
      // consistency with the rest of the app's "expensive write" knobs.
      if (backupTimerRef.current !== null) {
        clearTimeout(backupTimerRef.current);
      }
      // #189: stage the latest serialized payload so the unmount cleanup
      // can flush it synchronously if the timer hasn't fired yet. The ref
      // always reflects the *latest* state — bursts overwrite earlier
      // staged values, which is correct because the timer body would have
      // done the same thing.
      pendingBackupRef.current = serialized;
      backupTimerRef.current = setTimeout(() => {
        backupTimerRef.current = null;
        const payload = pendingBackupRef.current;
        pendingBackupRef.current = null;
        if (payload !== null) {
          AsyncStorage.setItem(GLOSSARY_BACKUP_KEY, payload).catch((err) =>
            logger.warn("Glossary", "Failed to save glossary backup", err)
          );
        }
      }, 5_000);
    }
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
