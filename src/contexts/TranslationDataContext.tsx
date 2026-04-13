import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { migrateHistoryItem, type HistoryItem } from "../types";
import { logger } from "../services/logger";

const HISTORY_KEY = "translation_history";
const HISTORY_PAGE_SIZE = 20;

interface TranslationDataContextValue {
  history: HistoryItem[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  hasMoreHistory: boolean;
  loadMoreHistory: () => void;
  notesRefreshKey: number;
  incrementNotesRefresh: () => void;
  updateWidgetData: (original: string, translated: string, from: string, to: string) => Promise<void>;
}

const TranslationDataContext = createContext<TranslationDataContextValue | null>(null);

export function TranslationDataProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const allHistoryRef = useRef<HistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [notesRefreshKey, setNotesRefreshKey] = useState(0);

  const hasMoreHistory = useMemo(
    () => allHistoryRef.current.length > history.length,
    [history.length]
  );

  // Load persisted history on mount
  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY)
      .then((val) => {
        if (val) {
          try {
            const raw = JSON.parse(val) as Record<string, unknown>[];
            const data = raw.map(migrateHistoryItem);
            allHistoryRef.current = data;
            const startIdx = Math.max(0, data.length - HISTORY_PAGE_SIZE);
            setHistory(data.slice(startIdx));
          } catch (err) {
            logger.warn("Storage", "Failed to parse history JSON", err);
          }
        }
      })
      .catch((err) => logger.warn("Storage", "Failed to load history", err));
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
        }).catch((err: unknown) => logger.warn("Widget", "Widget update failed", err));
      } else if (Platform.OS === "ios") {
        import("../../modules/apple-translation").then((AppleTranslation) => {
          AppleTranslation.saveWidgetData({
            lastOriginal: original,
            lastTranslated: translated,
            sourceLang: from.toUpperCase(),
            targetLang: to.toUpperCase(),
          });
        }).catch((err: unknown) => logger.warn("Widget", "iOS widget update failed", err));
      }
    } catch (err) {
      logger.warn("Widget", "Widget data save failed", err);
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
    notesRefreshKey,
    incrementNotesRefresh,
    updateWidgetData,
  }), [history, hasMoreHistory, loadMoreHistory, notesRefreshKey, incrementNotesRefresh, updateWidgetData]);

  return (
    <TranslationDataContext.Provider value={value}>{children}</TranslationDataContext.Provider>
  );
}

export function useTranslationData(): TranslationDataContextValue {
  const ctx = useContext(TranslationDataContext);
  if (!ctx) throw new Error("useTranslationData must be used within a TranslationDataProvider");
  return ctx;
}
