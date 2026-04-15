/**
 * Production-friendly telemetry counters.
 *
 * The Settings diagnostics dashboard previously computed type-ahead stats by
 * querying the logger's debug ring buffer (`logger.query({ levels: ["debug"]
 * })`), which is gated on `__DEV__` and therefore returns empty in release
 * builds. This module provides a lightweight counter store that works
 * regardless of build configuration so the dashboard — and crash reports that
 * include a diagnostics block — shows real numbers in production too.
 *
 * Scope: counters live in-memory for fast reads/writes, and are optionally
 * persisted to AsyncStorage so a crash mid-session doesn't lose the telemetry
 * baseline that would have helped diagnose the crash (#122). Persistence is
 * debounced — we never write on every `increment` — so the hot path stays
 * lock-free and allocation-free. Callers wire `initTelemetry()` during app
 * start to hydrate counters from disk.
 *
 * Intentionally small: no tags, no time windows, no rates. Just a typed key
 * and integer counters. Callers compose these into higher-level metrics
 * (e.g. the type-ahead dashboard computes `local / total` itself).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { logger } from "./logger";

const TELEMETRY_STORAGE_KEY = "@live_translator_telemetry_v1";
/** Debounced write delay. 5s matches what #122 recommends — short enough
 * that a crash usually still flushes the last write, long enough that a
 * type-ahead burst at 2 increments/sec batches into a single writeback. */
const PERSIST_DEBOUNCE_MS = 5000;

/**
 * Known telemetry keys, split into per-feature unions (#124) so adding a new
 * namespace (OCR, offline queue, ...) doesn't force every caller to re-import
 * a sprawling flat union. `TelemetryKey` is the aggregate type consumers pass
 * to `increment()` / `get()`; the narrower unions are exported so callsites
 * that only touch one namespace can constrain their parameter types.
 *
 * Unknown strings are rejected at compile time so a typo can't silently create
 * an orphan counter.
 */
export type TypeAheadKey =
  | "typeAhead.glossary"
  | "typeAhead.offlineHit"
  | "typeAhead.offlineMiss"
  | "typeAhead.network"
  | "typeAhead.error";

export type SpeechKey =
  | "speech.translateSuccess"
  | "speech.translateFail"
  // #152: routine no-speech recognition errors are logged at debug level so
  // they don't flood the error ring, but in production the debug ring is
  // `__DEV__`-gated and the signal vanishes. A dedicated counter lets the
  // dashboard distinguish "silent user / quiet environment" from "broken
  // mic" without relying on the error ring.
  | "speech.noSpeech"
  // #180: OS-level mic-permission denials surfaced via the recognition
  // error event. Separate from translateFail so "user revoked the mic in
  // Settings" is distinguishable from "translate API returned 500" in the
  // Settings diagnostics dashboard — the recovery flow is completely
  // different (deep-link to Settings vs retry/switch provider).
  | "speech.permissionDenied";

/**
 * Offline-queue reliability counters (#174). The offline translation queue
 * already logs `Network` warns on per-item success/failure/dead-letter, but
 * debug-ring-gated logs vanish in production and the `Network` warn tag is a
 * bucket shared with every other network path, so a reader couldn't tell
 * "offline queue broken" apart from "general connectivity issues". Dedicated
 * counters make the offline-queue health surface in the Settings diagnostics
 * dashboard and crash report independently of network errors.
 *
 * Semantics:
 *   - `offlineQueue.success`: a queued item translated successfully
 *   - `offlineQueue.failed`: a per-item translate attempt failed (bumped on
 *     every failure, not just terminal ones; a retried item can bump this
 *     multiple times before eventually succeeding or being dead-lettered)
 *   - `offlineQueue.deadLetter`: an item hit MAX_ATTEMPTS and was dropped
 */
export type OfflineQueueKey =
  | "offlineQueue.success"
  | "offlineQueue.failed"
  | "offlineQueue.deadLetter";

export type TelemetryKey = TypeAheadKey | SpeechKey | OfflineQueueKey;

const counters: Record<TelemetryKey, number> = {
  "typeAhead.glossary": 0,
  "typeAhead.offlineHit": 0,
  "typeAhead.offlineMiss": 0,
  "typeAhead.network": 0,
  "typeAhead.error": 0,
  "speech.translateSuccess": 0,
  "speech.translateFail": 0,
  "speech.noSpeech": 0,
  "speech.permissionDenied": 0,
  "offlineQueue.success": 0,
  "offlineQueue.failed": 0,
  "offlineQueue.deadLetter": 0,
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistEnabled = false;
/**
 * Hydration race guard (#134). `initTelemetry()` is fire-and-forget from
 * App.tsx's mount useEffect, so any `increment()` that lands while the
 * AsyncStorage read is still in flight would otherwise be clobbered when the
 * hydration loop copies the stored values on top of the in-memory counters.
 *
 * We track the in-flight hydration promise plus a staging deltas map: while
 * hydration is pending, `increment()` both updates the live counter (so
 * current-session reads stay accurate) and records the delta so we can re-
 * apply it on top of the hydrated baseline once the read resolves. After
 * hydration the deltas map is discarded and `increment()` takes its normal
 * fast path.
 */
let hydrationInFlight: Promise<void> | null = null;
const pendingDeltas: Partial<Record<TelemetryKey, number>> = {};

/**
 * Safety cap on the pendingDeltas map (#139). In practice only one entry per
 * known key lands during hydration (~7 keys today), but a pathologically slow
 * AsyncStorage read plus a future telemetry namespace explosion could let the
 * map drift. Keyed-by-TelemetryKey means the effective ceiling is the union
 * size — but we enforce an explicit ceiling so a bug that starts writing with
 * a fresh string key per increment can't balloon memory silently.
 */
const PENDING_DELTAS_MAX_KEYS = 64;
let pendingDeltasCapLogged = false;

/**
 * Module-load metadata from the most recent `initTelemetry()` run. Consumers
 * (Settings → Translation Diagnostics crash-report builder) read this to
 * surface "the persisted blob contained unknown keys — your client may have
 * rolled back from a newer build" events (#143). `info`-level logger entries
 * don't land in the error ring so the prune event is otherwise invisible in
 * production crash reports.
 *
 * #147: holds the actual key names that were dropped — not just a boolean —
 * so the crash report can distinguish "forward-compat field cleanup"
 * (1–2 keys, expected) from "major downgrade" (many keys, possibly harmful).
 */
let prunedKeyNames: string[] = [];

function schedulePersist(): void {
  if (!persistEnabled) return;
  if (persistTimer) return; // already scheduled — coalesce
  persistTimer = setTimeout(() => {
    persistTimer = null;
    AsyncStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(counters)).catch((err) =>
      logger.warn("Telemetry", "Failed to persist telemetry counters", err)
    );
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Hydrate counters from AsyncStorage and enable debounced persistence for
 * subsequent writes. Call once at app startup; subsequent calls are no-ops.
 * Silently falls back to empty counters if the stored blob is missing or
 * malformed so a corrupted write can't prevent the app from booting.
 *
 * Returns the in-flight hydration promise so callers that specifically want
 * to await completion can; App.tsx's mount useEffect fires-and-forgets and
 * relies on the hydration race guard (see `hydrationInFlight` / `pendingDeltas`
 * above) to preserve increments that landed during the read.
 */
export async function initTelemetry(): Promise<void> {
  if (persistEnabled) return;
  if (hydrationInFlight) return hydrationInFlight;

  hydrationInFlight = (async () => {
    const localPruned: string[] = [];
    prunedKeyNames = [];
    try {
      const raw = await AsyncStorage.getItem(TELEMETRY_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const stored = parsed as Record<string, unknown>;
          const knownKeys = Object.keys(counters) as TelemetryKey[];
          const knownSet = new Set<string>(knownKeys);
          for (const k of Object.keys(stored)) {
            if (!knownSet.has(k)) {
              // #147: collect every pruned key instead of a boolean so the
              // diagnostics dashboard and crash report can list them. A prune
              // of 2 keys is a normal cleanup; a prune of 10 is a warning.
              localPruned.push(k);
            }
          }
          for (const key of knownKeys) {
            const v = stored[key];
            if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
              // Stored baseline + any delta that landed during the read.
              const delta = pendingDeltas[key] ?? 0;
              counters[key] = Math.floor(v) + delta;
            }
          }
        }
      }
    } catch (err) {
      logger.warn("Telemetry", "Failed to hydrate telemetry counters", err);
    } finally {
      if (localPruned.length > 0) {
        prunedKeyNames = localPruned;
        // Promote to `warn` so the prune event lands in the error ring — the
        // crash report and Settings → Translation Diagnostics can then surface
        // it. An `info`-level entry would be invisible in production.
        logger.warn(
          "Telemetry",
          `Pruning ${localPruned.length} unknown key(s) from persisted telemetry blob: ${localPruned.join(", ")}`
        );
      }
      // Discard pending deltas now that they've been folded in.
      for (const k of Object.keys(pendingDeltas) as TelemetryKey[]) {
        delete pendingDeltas[k];
      }
      // Reset the one-shot cap-breach log so a *future* hydration (after a
      // manual reset, say) can log the breach again if it recurs.
      pendingDeltasCapLogged = false;
      hydrationInFlight = null;
      persistEnabled = true;
      // Schedule a flush so the post-hydration state (baseline + deltas) is
      // durable even if the app crashes before the next increment.
      schedulePersist();
    }
  })();

  return hydrationInFlight;
}

/** Increment a counter by 1 (or a given delta). No-ops on unknown keys. */
export function increment(key: TelemetryKey, delta: number = 1): void {
  counters[key] = (counters[key] ?? 0) + delta;
  // If hydration is still in flight, stash the delta so it survives the
  // baseline copy-over inside initTelemetry(). See hydrationInFlight above.
  if (hydrationInFlight) {
    // Safety cap (#139): a pathologically slow AsyncStorage read combined
    // with a future bug that writes a fresh string per call could let the
    // staging map grow unboundedly. Keys are type-constrained to
    // `TelemetryKey` today so the effective ceiling is ~7, but enforce an
    // explicit cap — dropping new deltas once it's hit rather than risking
    // memory pressure. Already-tracked keys still accumulate so existing
    // counters stay accurate.
    if (
      pendingDeltas[key] !== undefined ||
      Object.keys(pendingDeltas).length < PENDING_DELTAS_MAX_KEYS
    ) {
      pendingDeltas[key] = (pendingDeltas[key] ?? 0) + delta;
    } else if (!pendingDeltasCapLogged) {
      pendingDeltasCapLogged = true;
      logger.warn(
        "Telemetry",
        `pendingDeltas cap reached (${PENDING_DELTAS_MAX_KEYS}) during hydration; dropping new-key delta for ${key}`
      );
    }
  }
  schedulePersist();
}

/** Read a single counter's current value. */
export function get(key: TelemetryKey): number {
  return counters[key] ?? 0;
}

/** Snapshot of every counter. Returns a fresh object so callers can
 * safely store it in React state without aliasing the module-private store. */
export function getAll(): Record<TelemetryKey, number> {
  return { ...counters };
}

/** Zero every counter. Useful in tests and for a future "reset telemetry"
 * action in the diagnostics dashboard. */
export function reset(): void {
  for (const key of Object.keys(counters) as TelemetryKey[]) {
    counters[key] = 0;
  }
  // Persist the zero state immediately — otherwise a fresh install or a user
  // who just hit "Reset Telemetry" could get their old numbers back after a
  // quick restart, since the debounced writer wouldn't have flushed yet.
  if (persistEnabled) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    AsyncStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(counters)).catch((err) =>
      logger.warn("Telemetry", "Failed to persist reset telemetry", err)
    );
  }
}

/**
 * Namespaced helper: total of every `typeAhead.*` counter, for computing
 * "local short-circuit %" in the dashboard and crash report. Kept here so
 * the reduction logic lives next to the counter definitions.
 */
export function getTypeAheadTotal(): number {
  return (
    counters["typeAhead.glossary"] +
    counters["typeAhead.offlineHit"] +
    counters["typeAhead.offlineMiss"] +
    counters["typeAhead.network"]
  );
}

/** Ratio of requests served without a network round-trip (glossary or
 * offline dictionary hits) to total type-ahead events. Returns 0 when
 * there's no traffic so dashboards can render "—" instead of NaN. */
export function getTypeAheadLocalRatio(): number {
  const total = getTypeAheadTotal();
  if (total === 0) return 0;
  return (counters["typeAhead.glossary"] + counters["typeAhead.offlineHit"]) / total;
}

/**
 * Offline-queue aggregate stats for the diagnostics dashboard and crash
 * report. `total` counts every attempt that resolved (success + failed);
 * dead-lettered items are a subset of `failed` that also hit the retry cap.
 * Returns 0s when there's no traffic so dashboards can short-circuit.
 */
export interface OfflineQueueStats {
  success: number;
  failed: number;
  deadLetter: number;
  total: number;
  /** Fail rate over resolved attempts (0..1), 0 when there's no traffic. */
  failRate: number;
}

export function getOfflineQueueStats(): OfflineQueueStats {
  const success = counters["offlineQueue.success"];
  const failed = counters["offlineQueue.failed"];
  const deadLetter = counters["offlineQueue.deadLetter"];
  const total = success + failed;
  const failRate = total === 0 ? 0 : failed / total;
  return { success, failed, deadLetter, total, failRate };
}

/**
 * Names of every key that the most recent `initTelemetry()` run dropped from
 * the persisted blob because this build doesn't recognize them. Typically
 * indicates a client downgrade (a newer build wrote keys this build doesn't
 * know about) or a forward-compat field that was later removed. Surfaced by
 * Settings → Translation Diagnostics and the crash-report builder so the
 * signal isn't lost in production where `info`-level logs aren't ringed
 * (#143/#147).
 *
 * Returns an empty array until hydration completes; cleared back to empty on
 * the next `initTelemetry()` that finds a clean blob. Callers that only need
 * a yes/no signal can use `.length > 0`.
 *
 * The returned array is a stable reference across renders until the next
 * hydration — callers that want to drop into React state should copy it.
 */
export function prunedUnknownKeys(): readonly string[] {
  return prunedKeyNames;
}

/**
 * Backwards-compatible boolean shorthand around `prunedUnknownKeys()`.
 * Prefer `prunedUnknownKeys()` in new code so the specific key names are
 * available for display.
 */
export function didPruneUnknownKeys(): boolean {
  return prunedKeyNames.length > 0;
}

/**
 * #158: exposes the `PENDING_DELTAS_MAX_KEYS` constant so tests (and any
 * future diagnostics consumer) can assert against the cap without hardcoding
 * a magic number or reaching into module internals. Kept as a getter rather
 * than a plain export so the constant stays module-private and the public
 * API can continue to treat it as an implementation detail we reserve the
 * right to tune.
 *
 * The cap itself is still a compile-time constant — callers that want to
 * *change* it should edit `PENDING_DELTAS_MAX_KEYS` directly; there is no
 * setter. The getter exists purely so #154's cap-breach test can say
 * `getPendingDeltasCap() + overshoot` instead of hardcoding 64.
 */
export function getPendingDeltasCap(): number {
  return PENDING_DELTAS_MAX_KEYS;
}
