import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNetInfo } from "@react-native-community/netinfo";
import { notifySuccess } from "../services/haptics";
import { translateText } from "../services/translation";
import { logger } from "../services/logger";
import { increment as telemetryIncrement } from "../services/telemetry";
import { useSettings } from "./SettingsContext";

const OFFLINE_QUEUE_KEY = "offline_translation_queue";

// Exponential backoff tuning for per-item retries. After MAX_ATTEMPTS failures
// an item is dead-lettered (dropped + logged) so one permanently-failing phrase
// can't wedge the queue forever.
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2_000;    // 2s before the first retry
const MAX_BACKOFF_MS = 300_000;   // cap at 5 minutes

/** Exponential backoff with a ceiling. attempts starts at 1 (first failure). */
function computeBackoff(attempts: number): number {
  const expo = BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(expo, MAX_BACKOFF_MS);
}

interface OfflineQueueItem {
  text: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
  /** Number of failed attempts so far. Undefined = never attempted (legacy items). */
  attempts?: number;
  /** Epoch ms when this item becomes eligible for another attempt. Undefined = ready now. */
  nextAttemptAt?: number;
}

type OnTranslatedCallback = (original: string, translated: string) => void;

interface OfflineQueueContextValue {
  offlineQueue: OfflineQueueItem[];
  queueLength: number;
  addToOfflineQueue: (item: OfflineQueueItem) => void;
  isOffline: boolean;
  /**
   * #126: true while a queue drain is actively translating items. Consumers
   * can show a "processing…" indicator on the pending badge instead of just
   * the queue count. Backed by useState so context consumers re-render on
   * transitions (the previous ref-only flag was invisible to the UI).
   */
  isProcessingQueue: boolean;
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
  // #126: isProcessingQueue is now both a ref (for tight loop guard) AND a
  // state value (for UI subscription). The ref keeps the synchronous
  // re-entrance check — a second processOfflineQueue() call that lands
  // before React flushes the setter would still see `false` in state and
  // double-process. The state value trails the ref by a render and is what
  // consumers render off of.
  const isProcessingQueueRef = useRef(false);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
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
    if (isProcessingQueueRef.current) return;
    const queue = offlineQueueRef.current;
    if (queue.length === 0) return;
    isProcessingQueueRef.current = true;
    setIsProcessingQueue(true);

    // Track remaining queue so we can persist progress after each item. If the
    // app is killed mid-processing we don't want to re-run already-translated
    // items on the next launch — the listener fired and any history row was
    // already written, so re-processing would create duplicates.
    let remaining: OfflineQueueItem[] = [...queue];
    let processed = 0;
    let consecutiveFailures = 0;
    const now = Date.now();

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
        // Per-item backoff: an item failed recently and isn't eligible yet.
        // Leave it in `remaining` untouched and move on. The sweep effect
        // below will re-trigger processing when the soonest item is ready.
        if (item.nextAttemptAt !== undefined && item.nextAttemptAt > now) {
          continue;
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
          // #174: bump the offline-queue success counter so the Settings
          // diagnostics dashboard and crash report can distinguish "offline
          // queue healthy" from "offline queue quietly failing" independent
          // of the broader Network warn bucket.
          telemetryIncrement("offlineQueue.success");
          // Remove this item from remaining and persist. The reference comparison
          // is safe here because `remaining` was seeded from `queue` and items
          // are plain objects we never mutate.
          remaining = remaining.filter((r) => r !== item);
          persistRemaining();
        } catch (err) {
          logger.warn("Network", "Offline queue translation failed", err);
          consecutiveFailures++;
          // #174: every per-item failure increments the counter, including
          // intermediate retries. Dashboards show fail-rate over resolved
          // attempts so retries don't double-book — a succeed-after-2-retries
          // item reads as 2 failed + 1 success, which is the honest picture.
          telemetryIncrement("offlineQueue.failed");
          // Per-item backoff + dead-letter: count the failure, schedule the
          // next attempt, and drop the item entirely once it's been tried
          // MAX_ATTEMPTS times. Dead-lettering stops one poison phrase from
          // blocking the whole queue forever.
          const attempts = (item.attempts ?? 0) + 1;
          if (attempts >= MAX_ATTEMPTS) {
            logger.warn("Network", "Offline queue item dead-lettered after max attempts", {
              text: item.text.slice(0, 40),
              attempts,
            });
            // #174: dead-letter is a strict subset of failed — a poison
            // phrase that burned through all retries. Separating it lets
            // the dashboard flag "N items permanently dropped" without
            // conflating them with recoverable transient failures.
            telemetryIncrement("offlineQueue.deadLetter");
            remaining = remaining.filter((r) => r !== item);
          } else {
            const nextAttemptAt = Date.now() + computeBackoff(attempts);
            remaining = remaining.map((r) =>
              r === item ? { ...r, attempts, nextAttemptAt } : r
            );
          }
          persistRemaining();
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
      isProcessingQueueRef.current = false;
      setIsProcessingQueue(false);
    }
  }, [settings.translationProvider]);

  useEffect(() => {
    if (netInfo.isConnected && offlineQueueRef.current.length > 0) {
      processOfflineQueue();
    }
  }, [netInfo.isConnected, processOfflineQueue]);

  // Sweep scheduler: if every ready item has failed and the remaining items
  // are all in a backoff window, schedule a one-shot timer for the soonest
  // nextAttemptAt so the queue self-heals without needing a network toggle.
  // Re-runs whenever the queue changes (including after a failure bumps
  // nextAttemptAt) so the timer always points at the current soonest.
  useEffect(() => {
    if (!netInfo.isConnected) return;
    const now = Date.now();
    const pending = offlineQueue
      .filter((i) => i.nextAttemptAt !== undefined && i.nextAttemptAt > now)
      .map((i) => i.nextAttemptAt as number);
    if (pending.length === 0) return;
    const soonest = Math.min(...pending);
    const delay = Math.max(0, soonest - now);
    const timer = setTimeout(() => {
      processOfflineQueue();
    }, delay);
    return () => clearTimeout(timer);
  }, [offlineQueue, netInfo.isConnected, processOfflineQueue]);

  const queueLength = offlineQueue.length;

  const value = useMemo(() => ({
    offlineQueue,
    queueLength,
    addToOfflineQueue,
    isOffline,
    isProcessingQueue,
    registerOnTranslated,
  }), [offlineQueue, queueLength, addToOfflineQueue, isOffline, isProcessingQueue, registerOnTranslated]);

  return (
    <OfflineQueueContext.Provider value={value}>{children}</OfflineQueueContext.Provider>
  );
}

export function useOfflineQueue(): OfflineQueueContextValue {
  const ctx = useContext(OfflineQueueContext);
  if (!ctx) throw new Error("useOfflineQueue must be used within an OfflineQueueProvider");
  return ctx;
}
