/**
 * Exponential-backoff schedule for the offline translation queue's per-item
 * retry policy. Hoisted out of OfflineQueueContext so the math can be unit
 * tested without dragging the React provider, useNetInfo, AsyncStorage, and
 * the translation service into the test environment.
 *
 * Tuning rationale (kept here so future-me has the why next to the knobs):
 *
 *   - BASE_BACKOFF_MS: 2s. Long enough that a hung network can settle for
 *     one retry without immediate hammering, short enough that a transient
 *     blip resolves on the first retry without making the user wait.
 *
 *   - MAX_BACKOFF_MS: 5min. Past this, the user has almost certainly moved
 *     on; a longer ceiling just means stale items take forever to surface
 *     when the network comes back. The sweep effect in OfflineQueueContext
 *     re-triggers a drain on connectivity restoration regardless.
 *
 *   - MAX_ATTEMPTS: 5. Five attempts × the ceiling (2 + 4 + 8 + 16 + 32 =
 *     ~60s of total wait + 5×network timeout) is enough to ride out a
 *     reasonable outage; beyond that the item is dead-lettered to stop one
 *     poison phrase from blocking the queue forever.
 *
 * Negative or zero `attempts` clamps to 1 (treated as "first failure")
 * instead of returning the base value × 0.5; this matches the original
 * inline implementation's `Math.max(0, attempts - 1)` clamping but is
 * easier to reason about for callers.
 */

export const BASE_BACKOFF_MS = 2_000;
export const MAX_BACKOFF_MS = 300_000;
export const MAX_ATTEMPTS = 5;

/**
 * Exponential backoff with a ceiling. `attempts` is the number of failures
 * so far (1 = first failure, 2 = second failure after one retry, etc.).
 * Returns the ms to wait before the next attempt.
 *
 * Schedule for default constants:
 *   attempts=1 → 2_000ms
 *   attempts=2 → 4_000ms
 *   attempts=3 → 8_000ms
 *   attempts=4 → 16_000ms
 *   attempts=5 → 32_000ms
 *   attempts=10 → 300_000ms (clamped at MAX_BACKOFF_MS)
 */
export function computeBackoff(attempts: number): number {
  // Defensive clamp: 0 / negative / NaN all become "first failure" so a
  // miscounted call site doesn't return a sub-base delay or NaN.
  const safe = Number.isFinite(attempts) && attempts >= 1 ? attempts : 1;
  const expo = BASE_BACKOFF_MS * 2 ** (safe - 1);
  return Math.min(expo, MAX_BACKOFF_MS);
}
