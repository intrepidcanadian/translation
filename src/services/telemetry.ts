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
 * Scope: counters are session-scoped (cleared when the JS runtime restarts).
 * If we ever need cross-session persistence, wire this through AsyncStorage
 * but watch out for write frequency — don't persist on every `increment`.
 *
 * Intentionally small: no tags, no time windows, no rates. Just a typed key
 * and integer counters. Callers compose these into higher-level metrics
 * (e.g. the type-ahead dashboard computes `local / total` itself).
 */

/**
 * Known telemetry keys. Adding a new key here gives it type-safe access
 * everywhere; unknown strings are rejected at compile time so a typo can't
 * silently create an orphan counter.
 */
export type TelemetryKey =
  | "typeAhead.glossary"
  | "typeAhead.offlineHit"
  | "typeAhead.offlineMiss"
  | "typeAhead.network"
  | "typeAhead.error";

const counters: Record<TelemetryKey, number> = {
  "typeAhead.glossary": 0,
  "typeAhead.offlineHit": 0,
  "typeAhead.offlineMiss": 0,
  "typeAhead.network": 0,
  "typeAhead.error": 0,
};

/** Increment a counter by 1 (or a given delta). No-ops on unknown keys. */
export function increment(key: TelemetryKey, delta: number = 1): void {
  counters[key] = (counters[key] ?? 0) + delta;
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
