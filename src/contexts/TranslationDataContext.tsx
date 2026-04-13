import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNetInfo } from "@react-native-community/netinfo";
import { impactLight, impactMedium, notifySuccess, notifyWarning } from "../services/haptics";
import { translateText } from "../services/translation";
import { useSettings } from "./SettingsContext";
import { useLanguage } from "./LanguageContext";
import type { HistoryItem } from "../types";

const HISTORY_KEY = "translation_history";
const GLOSSARY_KEY = "user_glossary";
const STREAK_KEY = "usage_streak";
const OFFLINE_QUEUE_KEY = "offline_translation_queue";
const HISTORY_PAGE_SIZE = 20;

interface GlossaryEntry {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
}

interface OfflineQueueItem {
  text: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
}

interface Streak {
  current: number;
  lastDate: string;
}

interface TranslationDataContextValue {
  history: HistoryItem[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  hasMoreHistory: boolean;
  loadMoreHistory: () => void;
  glossary: GlossaryEntry[];
  glossaryLookup: (text: string, srcLang: string, tgtLang: string) => string | null;
  addGlossaryEntry: (src: string, tgt: string) => void;
  removeGlossaryEntry: (index: number) => void;
  importGlossaryEntries: (entries: GlossaryEntry[]) => void;
  streak: Streak;
  updateStreak: () => void;
  offlineQueue: OfflineQueueItem[];
  addToOfflineQueue: (text: string, fromCode: string, toCode: string) => void;
  isOffline: boolean;
  notesRefreshKey: number;
  incrementNotesRefresh: () => void;
  updateWidgetData: (original: string, translated: string, from: string, to: string) => Promise<void>;
}

const TranslationDataContext = createContext<TranslationDataContextValue | null>(null);

export function TranslationDataProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const { sourceLang, targetLang } = useLanguage();

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const allHistoryRef = useRef<HistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);

  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [streak, setStreak] = useState<Streak>({ current: 0, lastDate: "" });
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const isProcessingQueue = useRef(false);
  const [notesRefreshKey, setNotesRefreshKey] = useState(0);

  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;

  const hasMoreHistory = useMemo(
    () => allHistoryRef.current.length > history.length,
    [history.length]
  );

  // Load persisted data on mount (single batch read for faster startup)
  useEffect(() => {
    AsyncStorage.multiGet([HISTORY_KEY, GLOSSARY_KEY, STREAK_KEY, OFFLINE_QUEUE_KEY])
      .then((results) => {
        const parse = <T,>(val: string | null): T | null => {
          if (!val) return null;
          try { return JSON.parse(val) as T; } catch { return null; }
        };

        const historyData = parse<HistoryItem[]>(results[0][1]);
        if (historyData) {
          allHistoryRef.current = historyData;
          const startIdx = Math.max(0, historyData.length - HISTORY_PAGE_SIZE);
          setHistory(historyData.slice(startIdx));
        }
        const glossaryData = parse<GlossaryEntry[]>(results[1][1]);
        if (glossaryData) setGlossary(glossaryData);
        const streakData = parse<Streak>(results[2][1]);
        if (streakData) setStreak(streakData);
        const queueData = parse<OfflineQueueItem[]>(results[3][1]);
        if (queueData) setOfflineQueue(queueData);
      })
      .catch((err) => console.warn("Failed to load translation data:", err));
  }, []);

  // Persist history
  const historyLoaded = useRef(false);
  useEffect(() => {
    if (!historyLoaded.current) {
      historyLoaded.current = true;
      return;
    }
    allHistoryRef.current = history;
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-100)));
  }, [history]);

  const loadMoreHistory = useCallback(() => {
    if (allHistoryRef.current.length <= history.length) return;
    const all = allHistoryRef.current;
    const nextPage = historyPage + 1;
    const startIdx = Math.max(0, all.length - nextPage * HISTORY_PAGE_SIZE);
    setHistory(all.slice(startIdx));
    setHistoryPage(nextPage);
  }, [history.length, historyPage]);

  // Glossary — Map-based O(1) lookup instead of O(n) array scan
  const glossaryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of glossary) {
      const key = `${g.sourceLang}|${g.targetLang}|${g.source.toLowerCase()}`;
      map.set(key, g.target);
    }
    return map;
  }, [glossary]);

  const glossaryLookup = useCallback((text: string, srcLang: string, tgtLang: string): string | null => {
    const key = `${srcLang}|${tgtLang}|${text.trim().toLowerCase()}`;
    return glossaryMap.get(key) ?? null;
  }, [glossaryMap]);

  const addGlossaryEntry = useCallback((src: string, tgt: string) => {
    if (!src || !tgt) return;
    impactLight();
    setGlossary((prev) => {
      const filtered = prev.filter(
        (g) => !(g.source.toLowerCase() === src.toLowerCase() && g.sourceLang === sourceLang.code && g.targetLang === targetLang.code)
      );
      const updated = [...filtered, { source: src, target: tgt, sourceLang: sourceLang.code, targetLang: targetLang.code }];
      AsyncStorage.setItem(GLOSSARY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, [sourceLang.code, targetLang.code]);

  const removeGlossaryEntry = useCallback((index: number) => {
    impactMedium();
    setGlossary((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      AsyncStorage.setItem(GLOSSARY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const importGlossaryEntries = useCallback((entries: GlossaryEntry[]) => {
    setGlossary(entries);
    AsyncStorage.setItem(GLOSSARY_KEY, JSON.stringify(entries));
  }, []);

  // Streak
  const updateStreak = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    setStreak((prev) => {
      if (prev.lastDate === today) return prev;
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const newStreak = prev.lastDate === yesterday
        ? { current: prev.current + 1, lastDate: today }
        : { current: 1, lastDate: today };
      AsyncStorage.setItem(STREAK_KEY, JSON.stringify(newStreak));
      return newStreak;
    });
  }, []);

  // Offline queue
  const addToOfflineQueue = useCallback((text: string, fromCode: string, toCode: string) => {
    const item = { text, sourceLang: fromCode, targetLang: toCode, timestamp: Date.now() };
    setOfflineQueue((prev) => {
      const updated = [...prev, item];
      AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updated));
      return updated;
    });
    setHistory((prev) => [...prev, { original: text, translated: "Queued — will translate when online", pending: true, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code, timestamp: Date.now() }]);
    notifyWarning();
  }, [sourceLang.code, targetLang.code]);

  const processOfflineQueue = useCallback(async () => {
    if (isProcessingQueue.current) return;
    let queue: OfflineQueueItem[] = [];
    setOfflineQueue((prev) => { queue = prev; return prev; });
    if (queue.length === 0) return;
    isProcessingQueue.current = true;

    const failed: OfflineQueueItem[] = [];
    let processed = 0;
    let consecutiveFailures = 0;

    for (const item of queue) {
      if (consecutiveFailures >= 3) { failed.push(item); continue; }
      try {
        const result = await translateText(item.text, item.sourceLang, item.targetLang, { provider: settings.translationProvider });
        setHistory((prev) => {
          const pendingIdx = prev.findIndex((h) => h.pending && h.original === item.text);
          if (pendingIdx !== -1) {
            const updated = [...prev];
            updated[pendingIdx] = { original: item.text, translated: result.translatedText };
            return updated;
          }
          return [...prev, { original: item.text, translated: result.translatedText, timestamp: Date.now() }];
        });
        processed++;
        consecutiveFailures = 0;
      } catch (err) {
        console.warn("Offline queue translation failed:", err);
        failed.push(item);
        consecutiveFailures++;
      }
    }

    setOfflineQueue(failed);
    AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(failed)).catch(() => {});
    isProcessingQueue.current = false;
    if (processed > 0) {
      notifySuccess();
    }
  }, [offlineQueue, settings.translationProvider]);

  useEffect(() => {
    if (netInfo.isConnected && offlineQueue.length > 0) {
      processOfflineQueue();
    }
  }, [netInfo.isConnected, offlineQueue.length, processOfflineQueue]);

  // Widget
  const updateWidgetData = useCallback(async (original: string, translated: string, from: string, to: string) => {
    try {
      await AsyncStorage.setItem(
        "widget_last_translation",
        JSON.stringify({ lastOriginal: original, lastTranslated: translated, sourceLang: from.toUpperCase(), targetLang: to.toUpperCase() })
      );
      if (Platform.OS === "android") {
        import("react-native-android-widget").then(({ requestWidgetUpdate }) => {
          import("../widgets/TranslateWidget").then(({ TranslateWidget }) => {
            requestWidgetUpdate({
              widgetName: "TranslateWidget",
              renderWidget: () => (
                <TranslateWidget lastOriginal={original} lastTranslated={translated} sourceLang={from.toUpperCase()} targetLang={to.toUpperCase()} />
              ),
            });
          });
        }).catch((err: any) => console.warn("Widget update failed:", err));
      } else if (Platform.OS === "ios") {
        import("../../modules/apple-translation").then((AppleTranslation) => {
          AppleTranslation.saveWidgetData({
            lastOriginal: original,
            lastTranslated: translated,
            sourceLang: from.toUpperCase(),
            targetLang: to.toUpperCase(),
          });
        }).catch((err: any) => console.warn("iOS widget update failed:", err));
      }
    } catch (err) {
      console.warn("Widget data save failed:", err);
    }
  }, []);

  const incrementNotesRefresh = useCallback(() => {
    setNotesRefreshKey((k) => k + 1);
  }, []);

  const value = useMemo(() => ({
    history,
    setHistory,
    hasMoreHistory,
    loadMoreHistory,
    glossary,
    glossaryLookup,
    addGlossaryEntry,
    removeGlossaryEntry,
    importGlossaryEntries,
    streak,
    updateStreak,
    offlineQueue,
    addToOfflineQueue,
    isOffline,
    notesRefreshKey,
    incrementNotesRefresh,
    updateWidgetData,
  }), [history, hasMoreHistory, loadMoreHistory, glossary, glossaryLookup, addGlossaryEntry, removeGlossaryEntry, importGlossaryEntries, streak, updateStreak, offlineQueue, addToOfflineQueue, isOffline, notesRefreshKey, incrementNotesRefresh, updateWidgetData]);

  return (
    <TranslationDataContext.Provider value={value}>{children}</TranslationDataContext.Provider>
  );
}

export function useTranslationData(): TranslationDataContextValue {
  const ctx = useContext(TranslationDataContext);
  if (!ctx) throw new Error("useTranslationData must be used within a TranslationDataProvider");
  return ctx;
}
