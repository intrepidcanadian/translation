/**
 * @jest-environment node
 *
 * Unit tests for src/services/logger.ts. Primary target is the rolling-window
 * query helper `logger.countByRolling` (#140) which pins the semantics that:
 *   - only entries within the last `windowMs` are counted,
 *   - and that any existing `LogQuery.since` composes with the window by
 *     taking the *later* of the two cutoffs — narrower wins, so a caller
 *     that already restricted to a specific range isn't accidentally widened.
 * Also spot-checks countBy and the configureBufferSize / ring drain path so
 * we have a regression fence around the whole helpers section.
 */

import { logger } from "../services/logger";

// Silence the native console.warn bleed-through — logger.warn piggy-backs on
// console.warn for dev visibility, which otherwise floods test output with
// dozens of drain-path entries from the configureBufferSize test.
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  logger.clearRecentErrors();
  logger.configureBufferSize(50);
  // Freeze time so Date.now() advances only when we say so — the rolling
  // window tests rely on a stable "now" reference.
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-04-15T12:00:00Z"));
});

afterEach(() => {
  jest.useRealTimers();
  warnSpy.mockRestore();
});

describe("logger.countBy", () => {
  it("groups warn/error entries by tag", () => {
    logger.warn("Translation", "timeout");
    logger.warn("Translation", "rate limit");
    logger.error("Network", "offline");
    logger.warn("Speech", "no mic");

    // Cast to a string-keyed bag so the test isn't tied to the private
    // LogTag union exported shape.
    const counts = logger.countBy(
      { levels: ["warn", "error"] },
      (e) => e.tag as string
    );
    expect(counts).toEqual({ Translation: 2, Network: 1, Speech: 1 });
  });

  it("drops entries when keyFn returns null", () => {
    logger.warn("Translation", "keep");
    logger.warn("Network", "drop");

    const counts = logger.countBy(
      { levels: ["warn", "error"] },
      (e) => (e.tag === "Network" ? null : (e.tag as string))
    );
    expect(counts).toEqual({ Translation: 1 });
    expect(counts["Network"]).toBeUndefined();
  });
});

describe("logger.countByRolling", () => {
  it("counts only entries within the last windowMs", () => {
    // Entry at T+0
    logger.warn("Speech", "fail 1");
    // Entry at T+30s
    jest.advanceTimersByTime(30_000);
    logger.warn("Speech", "fail 2");
    // Entry at T+90s
    jest.advanceTimersByTime(60_000);
    logger.warn("Speech", "fail 3");

    // Now we're at T+90s. A 60s rolling window should cover T+30s..T+90s,
    // capturing the last two entries only.
    const rolling = logger.countByRolling(
      { tags: ["Speech"], levels: ["warn", "error"] },
      () => "speech" as string,
      60_000
    );
    expect(rolling).toEqual({ speech: 2 });
  });

  it("takes the later cutoff when composed with LogQuery.since", () => {
    logger.warn("Translation", "early");
    jest.advanceTimersByTime(10_000);
    logger.warn("Translation", "middle");
    jest.advanceTimersByTime(50_000);
    logger.warn("Translation", "recent");
    // Now we're at T+60s. Three entries: T+0, T+10s, T+60s.

    // since=T+5s caller restriction, windowMs=120_000 (cutoff T-60s).
    // effectiveSince = max(T+5s, T-60s) = T+5s → picks up T+10s and T+60s.
    const sinceMs = Date.now() - 55_000; // 5s after the first entry
    const rolling = logger.countByRolling(
      { levels: ["warn", "error"], since: sinceMs },
      (e) => e.tag as string,
      120_000
    );
    expect(rolling).toEqual({ Translation: 2 });
  });

  it("returns {} when nothing is in the window", () => {
    logger.warn("Translation", "old");
    jest.advanceTimersByTime(120_000);
    // 30s window at T+120s only covers T+90s..T+120s; nothing there.
    const rolling = logger.countByRolling(
      { levels: ["warn", "error"] },
      (e) => e.tag as string,
      30_000
    );
    expect(rolling).toEqual({});
  });

  it("clamps negative windowMs to 0 (only the current instant is in range)", () => {
    logger.warn("Network", "burst");
    const rolling = logger.countByRolling(
      { levels: ["warn", "error"] },
      (e) => e.tag as string,
      -5000
    );
    // A clamped-to-0 window should still include entries that landed at
    // exactly the current Date.now() (the rolling cutoff becomes Date.now()).
    expect(rolling).toEqual({ Network: 1 });
  });
});

describe("logger.query defaults", () => {
  // Regression fence for #150: `query()` without an explicit `levels` filter
  // must return warn/error entries only (errors ring), NOT debug entries.
  // The dashboards that depend on the debug ring opt in via `levels: ["debug"]`
  // explicitly, so silently widening the default to include debug would both
  // change semantics and, in production, silently start returning empty arrays
  // because the debug ring is `__DEV__`-gated.
  it("omitted levels filter returns errors ring only (excludes debug)", () => {
    logger.warn("Translation", "warn entry");
    logger.error("Network", "error entry");
    logger.debug("Translation", "debug entry");

    // No `levels` field — should scan the errors ring only.
    const all = logger.query({});
    const levels = all.map((e) => e.level).sort();
    expect(levels).toEqual(["error", "warn"]);
    expect(all.some((e) => e.level === "debug")).toBe(false);
  });

  it("explicit levels: ['debug'] opts into the debug ring", () => {
    logger.warn("Translation", "warn entry");
    logger.debug("Translation", "debug entry 1");
    logger.debug("Translation", "debug entry 2");

    // Explicit debug opt-in. In __DEV__ the debug ring holds entries; in a
    // production build it would be empty. Jest runs with __DEV__=true by
    // default under jest-expo, so this assertion is meaningful here.
    const debugOnly = logger.query({ levels: ["debug"] });
    expect(debugOnly.length).toBe(2);
    expect(debugOnly.every((e) => e.level === "debug")).toBe(true);
  });

  it("mixed levels (debug + warn) scans both rings", () => {
    logger.warn("Translation", "warn entry");
    logger.debug("Translation", "debug entry");

    const mixed = logger.query({ levels: ["debug", "warn"] });
    const levels = mixed.map((e) => e.level).sort();
    expect(levels).toEqual(["debug", "warn"]);
  });
});

describe("logger buffer configuration", () => {
  it("drains excess entries when buffer size is lowered at runtime", () => {
    for (let i = 0; i < 30; i++) logger.warn("Translation", `e${i}`);
    expect(logger.getRecentErrors().length).toBe(30);

    logger.configureBufferSize(10);
    expect(logger.getBufferSize()).toBe(10);
    expect(logger.getRecentErrors().length).toBe(10);
  });

  it("clamps configureBufferSize to [10, 500]", () => {
    expect(logger.configureBufferSize(0)).toBe(10);
    expect(logger.configureBufferSize(9999)).toBe(500);
  });
});
