import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNetInfo } from "@react-native-community/netinfo";
import { notifySuccess } from "../services/haptics";
import { translateText } from "../services/translation";
import { useSettings } from "./SettingsContext";

const OFFLINE_QUEUE_KEY = "offline_translation_queue";

interface OfflineQueueItem {
  text: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
}

type OnTranslatedCallback = (original: string, translated: string) => void;

interface OfflineQueueContextValue {
  offlineQueue: OfflineQueueItem[];
  addToOfflineQueue: (item: OfflineQueueItem) => void;
  isOffline: boolean;
  registerOnTranslated: (cb: OnTranslatedCallback) => void;
}

const OfflineQueueContext = createContext<OfflineQueueContextValue | null>(null);

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const isProcessingQueue = useRef(false);
  const onTranslatedRef = useRef<OnTranslatedCallback | null>(null);

  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;

  useEffect(() => {
    AsyncStorage.getItem(OFFLINE_QUEUE_KEY)
      .then((val) => {
        if (val) {
          try {
            const data = JSON.parse(val) as OfflineQueueItem[];
            setOfflineQueue(data);
          } catch {}
        }
      })
      .catch((err) => console.warn("Failed to load offline queue:", err));
  }, []);

  const addToOfflineQueue = useCallback((item: OfflineQueueItem) => {
    setOfflineQueue((prev) => {
      const updated = [...prev, item];
      AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const registerOnTranslated = useCallback((cb: OnTranslatedCallback) => {
    onTranslatedRef.current = cb;
  }, []);

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
        onTranslatedRef.current?.(item.text, result.translatedText);
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
    if (processed > 0) notifySuccess();
  }, [offlineQueue, settings.translationProvider]);

  useEffect(() => {
    if (netInfo.isConnected && offlineQueue.length > 0) {
      processOfflineQueue();
    }
  }, [netInfo.isConnected, offlineQueue.length, processOfflineQueue]);

  const value = useMemo(() => ({
    offlineQueue,
    addToOfflineQueue,
    isOffline,
    registerOnTranslated,
  }), [offlineQueue, addToOfflineQueue, isOffline, registerOnTranslated]);

  return (
    <OfflineQueueContext.Provider value={value}>{children}</OfflineQueueContext.Provider>
  );
}

export function useOfflineQueue(): OfflineQueueContextValue {
  const ctx = useContext(OfflineQueueContext);
  if (!ctx) throw new Error("useOfflineQueue must be used within an OfflineQueueProvider");
  return ctx;
}
