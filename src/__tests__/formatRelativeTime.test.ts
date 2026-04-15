/**
 * Unit tests for `formatRelativeTime` — the helper every TranslationBubble /
 * ChatBubble calls on every render to label when a translation happened
 * ("Just now", "5m ago", "Yesterday 3:45 PM", "Apr 3").
 *
 * Why it's worth pinning: the function mixes relative ranges (seconds /
 * minutes / hours) with absolute day boundaries (`today.setHours(0,0,0,0)`
 * + `yesterday = today - 1 day`). A naive off-by-one on the `today`
 * comparison or the minute-to-hour cutover would quietly start printing the
 * wrong bucket on every bubble — a subtle correctness regression that's
 * very hard to spot in review because the code looks fine at a glance.
 *
 * We pin the real wall-clock via `jest.useFakeTimers` + `setSystemTime` so
 * the "today" boundary is deterministic, and we assert structural contracts
 * (`/Yesterday \d/`, `/^\d+m ago$/`, etc.) rather than locale-specific
 * strings so the test survives CI locale differences. The locale-dependent
 * hour/minute output from `toLocaleTimeString` is matched loosely with a
 * regex that accepts both 12h and 24h formats.
 */
import { formatRelativeTime } from "../utils/formatRelativeTime";

describe("formatRelativeTime", () => {
  // Fixed "now" — Wednesday 2026-04-15 15:00:00 local time. Using a
  // deterministic wall clock eliminates flakiness from real Date.now()
  // drifting across the minute/hour boundary mid-test.
  const FIXED_NOW = new Date(2026, 3, 15, 15, 0, 0).getTime(); // April 15, 2026 15:00 local

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns null when no timestamp is provided", () => {
    expect(formatRelativeTime()).toBeNull();
    expect(formatRelativeTime(undefined)).toBeNull();
    expect(formatRelativeTime(0)).toBeNull();
  });

  it("returns 'Just now' for timestamps within the last minute", () => {
    expect(formatRelativeTime(FIXED_NOW)).toBe("Just now");
    expect(formatRelativeTime(FIXED_NOW - 1_000)).toBe("Just now");
    expect(formatRelativeTime(FIXED_NOW - 30_000)).toBe("Just now");
    expect(formatRelativeTime(FIXED_NOW - 59_000)).toBe("Just now");
  });

  it("crosses the minute boundary at exactly 60 seconds", () => {
    // Exactly 60s old rounds to 1 minute — not "Just now" any more. This is
    // the boundary condition most likely to regress if someone swaps the
    // comparison for `<= 60`.
    expect(formatRelativeTime(FIXED_NOW - 60_000)).toBe("1m ago");
  });

  it("returns 'Nm ago' for timestamps within the last hour", () => {
    expect(formatRelativeTime(FIXED_NOW - 5 * 60_000)).toBe("5m ago");
    expect(formatRelativeTime(FIXED_NOW - 30 * 60_000)).toBe("30m ago");
    expect(formatRelativeTime(FIXED_NOW - 59 * 60_000)).toBe("59m ago");
  });

  it("crosses the hour boundary at exactly 60 minutes", () => {
    expect(formatRelativeTime(FIXED_NOW - 60 * 60_000)).toBe("1h ago");
  });

  it("returns 'Nh ago' for timestamps within the last 24 hours", () => {
    expect(formatRelativeTime(FIXED_NOW - 2 * 60 * 60_000)).toBe("2h ago");
    expect(formatRelativeTime(FIXED_NOW - 6 * 60 * 60_000)).toBe("6h ago");
    expect(formatRelativeTime(FIXED_NOW - 14 * 60 * 60_000)).toBe("14h ago");
  });

  it("switches to absolute time-of-day once the timestamp is in today's calendar day but >24h ago is out of scope", () => {
    // Earlier today (e.g. 09:30 this morning — 5.5 hours ago still counted as
    // relative hours, not absolute). Verify we STAY in relative "Nh ago"
    // mode because the 24h check bites first.
    const thisMorning = new Date(2026, 3, 15, 9, 30, 0).getTime();
    expect(formatRelativeTime(thisMorning)).toBe("5h ago");
  });

  it("returns 'Yesterday HH:MM' for timestamps from the previous calendar day", () => {
    // Yesterday at 13:45 — 25h 15m ago, so we're past the `<24h` branch and
    // fall into the day-boundary comparison.
    const yesterday1345 = new Date(2026, 3, 14, 13, 45, 0).getTime();
    const result = formatRelativeTime(yesterday1345);
    expect(result).not.toBeNull();
    // Locale-agnostic check — "Yesterday" prefix + some hour:minute form.
    expect(result).toMatch(/^Yesterday \d/);
  });

  it("returns a short date for timestamps older than yesterday", () => {
    // 5 days ago — outside yesterday, falls through to toLocaleDateString.
    const fiveDaysAgo = new Date(2026, 3, 10, 12, 0, 0).getTime();
    const result = formatRelativeTime(fiveDaysAgo);
    expect(result).not.toBeNull();
    // Should NOT match the relative or yesterday buckets.
    expect(result).not.toMatch(/ago$/);
    expect(result).not.toMatch(/^Yesterday/);
    // Shouldn't be the "Just now" sentinel either.
    expect(result).not.toBe("Just now");
  });

  it("treats the earliest instant of today as today, not yesterday", () => {
    // Midnight today — the strict boundary at today.getTime(). `timestamp >=
    // today.getTime()` means midnight itself renders as time-of-day.
    const todayMidnight = new Date(2026, 3, 15, 0, 0, 0).getTime();
    const result = formatRelativeTime(todayMidnight);
    // 15 hours ago → still in the "< 24h" hours branch, so we expect the
    // relative-hours bucket to win over the day-boundary bucket. This pins
    // the precedence: relative ranges > absolute day buckets.
    expect(result).toBe("15h ago");
  });

  it("handles timestamps in the far past gracefully", () => {
    // A year ago — should fall through to the absolute-date branch without
    // throwing.
    const oneYearAgo = new Date(2025, 3, 15, 15, 0, 0).getTime();
    expect(() => formatRelativeTime(oneYearAgo)).not.toThrow();
    const result = formatRelativeTime(oneYearAgo);
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
  });
});
