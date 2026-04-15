/**
 * Shared display formatters for `RatesFreshnessGrade`.
 *
 * Two consumers currently format the same grade type for user-visible surfaces:
 *  - `SettingsModal` Translation Diagnostics dashboard renders a short
 *    square-bracket tag next to the Exchange rates line, and `buildCrashReport`
 *    appends the same tag to shared diagnostics.
 *  - `PriceTagConverter` renders a longer warning chip in the results header
 *    when the cache is anything worse than fresh, and the chip's amber-vs-red
 *    tint is driven by a "soft warning" predicate.
 *
 * Until now both lived inline in their consumers with no unit test coverage.
 * Promoting them here has three concrete benefits:
 *
 *  1. Single source of truth for how each grade is spelled in the UI. A future
 *     threshold tuning (e.g. narrowing "stale-critical" to >36h) only needs to
 *     touch `getRatesFreshnessGrade`, and both surfaces update together; the
 *     user never sees "stale" in one place and "critical" in another for the
 *     same cache.
 *  2. Testable in isolation. Both functions are pure — no clock reads, no
 *     component state — so the boundary behaviour (fresh → null, stale-ok →
 *     informational, stale-critical → hard warning, none → fallback notice)
 *     can be pinned by trivial unit tests rather than waiting on #111's React
 *     rendering test infra.
 *  3. Keeps SettingsModal's 1900-line file a touch smaller and removes a
 *     second untested inline function from PriceTagConverter.
 *
 * The two functions intentionally return *different* strings for the same
 * grade — the dashboard tag is terse ("stale", "critical · refresh now")
 * because the surrounding row already carries the age + "Exchange rates:"
 * label, while the PriceTagConverter chip is standalone and must explain the
 * whole situation to a user staring at a results screen. Keeping them in one
 * module makes that distinction visible at a glance.
 */

import type { RatesFreshnessGrade } from "../services/currencyExchange";

/**
 * Short human-readable tag for a `RatesFreshnessGrade`. Used in square brackets
 * next to the Exchange rates line on the Translation Diagnostics dashboard and
 * appended to the shared crash-report Exchange rates line. `null` means
 * "don't render a tag" — the healthy `fresh` grade stays uncluttered so the
 * dashboard doesn't grow a `[fresh]` label on every row.
 *
 * Kept short (< 30 chars) so it fits inline with the age label without
 * wrapping on narrow screens.
 */
export function freshnessGradeTag(grade: RatesFreshnessGrade): string | null {
  switch (grade) {
    case "fresh":
      return null;
    case "stale-ok":
      return "stale";
    case "stale-warn":
      return "stale · consider refresh";
    case "stale-critical":
      return "critical · refresh now";
    case "none":
      return "no cache · using built-in";
  }
}

/**
 * Longer user-facing warning message for the PriceTagConverter results-header
 * chip. Accepts `null` (no grade computed yet — e.g. before the first
 * conversion) and returns `null` to mean "don't render the chip". The
 * returned strings are kept under 40 characters so the chip doesn't wrap on a
 * narrow phone width, and include emoji severity cues (⚠️) on the hard-warning
 * grades to draw the eye.
 *
 * Grade thresholds come from `getRatesFreshnessGrade`:
 *  - `fresh`           — no warning, returns `null`
 *  - `stale-ok`        — soft informational (age 1–12h, prices probably fine)
 *  - `stale-warn`      — hard warning (age 12–24h, refresh recommended)
 *  - `stale-critical`  — strongest warning (age > 24h, prices may be off by %)
 *  - `none`            — no cache at all or fallback payload served
 */
export function gradeWarningText(grade: RatesFreshnessGrade | null): string | null {
  if (grade === null || grade === "fresh") return null;
  switch (grade) {
    case "stale-ok":
      return "Rates are a few hours old";
    case "stale-warn":
      return "⚠️ Rates are stale — refresh in Settings";
    case "stale-critical":
      return "⚠️ Rates over 24h old — refresh now";
    case "none":
      return "⚠️ Using offline fallback rates";
  }
}

/**
 * Returns true when a grade should render as a "soft" informational warning
 * (amber tint on the chip) rather than a hard alert (red tint). Currently
 * only `stale-ok` qualifies — stale-warn/critical/none are all hard alerts —
 * but keeping this as a dedicated predicate lets a future tuning (e.g. treat
 * the first N hours of `stale-warn` as soft) change in one place.
 */
export function isSoftWarning(grade: RatesFreshnessGrade | null): boolean {
  return grade === "stale-ok";
}
