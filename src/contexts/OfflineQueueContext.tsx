import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNetInfo } from "@react-native-community/netinfo";
import { notifySuccess } from "../services/haptics";
import { translateText } from "../services/translation";
import { logger } from "../services/logger";
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
  queueLength: number;
  addToOfflineQueue: (item: OfflineQueueItem) => void;
  isOffline: boolean;
  /**
   * Register a listener invoked when a queued translation completes.
   * Returns an unsubscribe function. Multiple listeners are supported —
   * each is invoked in registration order on completion.
   */
  registerOnTranslated: (cb: OnTranslatedCallback) => () => void;
}

const OfflineQueueContext = createContext<OfflineQueueContextValue | null>(null);

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const offlineQueueRef = useRef<OfflineQueueItem[]>([]);
  const isProcessingQueue = useRef(false);
  const onTranslatedListenersRef = useRef<Set<OnTranslatedCallback>>(new Set());

  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;

  useEffect(() => {
    AsyncStorage.getItem(OFFLINE_QUEUE_KEY)
      .then((val) => {
        if (val) {
          try {
            const data = JSON.parse(val) as OfflineQueueItem[];
            offlineQueueRef.current = data;
            setOfflineQueue(data);
          } catch (err) {
            logger.warn("Storage", "Failed to parse offline queue JSON", err);
          }
        }
      })
      .catch((err) => logger.warn("Storage", "Failed to load offline queue", err));
  }, []);

  const addToOfflineQueue = useCallback((item: OfflineQueueItem) => {
    setOfflineQueue((prev) => {
      // Dedup on same (text, sourceLang, targetLang) — typing the same phrase
      // twice while offline shouldn't balloon the queue. The most recent
      // timestamp wins so the item stays "fresh" relative to other entries.
      const filtered = prev.filter(
        (q) =>
          !(
            q.text === item.text &&
            q.sourceLang === item.sourceLang &&
            q.targetLang === item.targetLang
          )
      );
      const updated = [...filtered, item];
      offlineQueueRef.current = updated;
      AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updated)).catch((err) =>
        logger.warn("Storage", "Failed to persist offline queue", err)
      );
      return updated;
    });
  }, []);

  const registerOnTranslated = useCallback((cb: OnTranslatedCallback) => {
    onTranslatedListenersRef.current.add(cb);
    return () => {
      onTranslatedListenersRef.current.delete(cb);
    };
  }, []);

  const processOfflineQueue = useCallback(async () => {
    if (isProcessingQueue.current) return;
    const queue = offlineQueueRef.current;
    if (queue.length === 0) return;
    isProcessingQueue.current = true;

    // Track remaining queue so we can persist progress after each item. If the
    // app is killed mid-processing we don't want to re-run already-translated
    // items on the next launch — the listener fired and any history row was
    // already written, so re-processing would create duplicates.
    let remaining: OfflineQueueItem[] = [...queue];
    let processed = 0;
    let consecutiveFailures = 0;

    const persistRemaining = () => {
      offlineQueueRef.current = remaining;
      setOfflineQueue(remaining);
      AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining)).catch((e) =>
        logger.warn("Storage", "Failed to persist offline queue", e)
      );
    };

    // try/finally guarantees isProcessingQueue is released even if an
    // unexpected throw escapes the loop — previously a hidden exception from
    // translateText or notifySuccess could leave the flag stuck true,
    // silently blocking every future processOfflineQueue() call until the
    // app was restarted.
    try {
      for (const item of queue) {
        if (consecutiveFailures >= 3) {
          // Circuit-break: leave the rest in the queue for a future attempt.
          break;
        }
        try {
          const result = await translateText(item.text, item.sourceLang, item.targetLang, { provider: settings.translationProvider });
          onTranslatedListenersRef.current.forEach((cb) => {
            try {
              cb(item.text, result.translatedText);
            } catch (cbErr) {
              logger.warn("Network", "Offline queue listener threw", cbErr);
            }
          });
          processed++;
          consecutiveFailures = 0;
          // Remove this item from remaining and persist. The reference comparison
          // is safe here because `remaining` was seeded from `queue` and items
          // are plain objects we never mutate.
          remaining = remaining.filter((r) => r !== item);
          persistRemaining();
        } catch (err) {
          logger.warn("Network", "Offline queue translation failed", err);
          consecutiveFailures++;
          // Leave failed items in `remaining` so they'll be retried next time
          // the network comes back.
        }
      }

      // Final persist in case the loop exited via the circuit breaker (no success
      // branch ran) — ensures the queue state on disk matches what's in memory.
      persistRemaining();
      if (processed > 0) {
        try {
          notifySuccess();
        } catch (hapticErr) {
          // A haptic failure is cosmetic; never let it stick the queue flag.
          logger.warn("Network", "notifySuccess failed after queue drain", hapticErr);
        }
      }
    } finally {
      isProcessingQueue.current = false;
    }
  }, [settings.translationProvider]);

  useEffect(() => {
    if (netInfo.isConnected && offlineQueueRef.current.length > 0) {
      processOfflineQueue();
    }
  }, [netInfo.isConnected, processOfflineQueue]);

  const queueLength = offlineQueue.length;

  const value = useMemo(() => ({
    offlineQueue,
    queueLength,
    addToOfflineQueue,
    isOffline,
    registerOnTranslated,
  }), [offlineQueue, queueLength, addToOfflineQueue, isOffline, registerOnTranslated]);

  return (
    <OfflineQueueContext.Provider value={value}>{children}</OfflineQueueContext.Provider>
  );
}

export function useOfflineQueue(): OfflineQueueContextValue {
  const ctx = useContext(OfflineQueueContext);
  if (!ctx) throw new Error("useOfflineQueue must be used within an OfflineQueueProvider");
  return ctx;
}
