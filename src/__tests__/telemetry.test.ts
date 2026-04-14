/**
 * @jest-environment node
 *
 * Unit tests for src/services/telemetry.ts (#123).
 *
 * Covers the pure in-memory surface: increment/get/getAll/reset, the
 * type-ahead namespaced helpers, and the hydration-race guard + unknown-key
 * prune metadata (#139/#143/#147). AsyncStorage is mocked so we can drive
 * the async code paths deterministically with flushed microtasks.
 */

// Shared store for the AsyncStorage mock. Defined at module scope so both
// the jest.mock factory below and the individual tests can mutate the same
// object across jest.resetModules() cycles — jest.mock's factory re-runs per
// reset, so we must close over an *outer* reference to preserve state.
const storage: { store: Record<string, string>; hydrateDelayMs: number } = {
  store: {},
  hydrateDelayMs: 0,
};

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => {
      if (storage.hydrateDelayMs > 0) {
        await new Promise((r) => setTimeout(r, storage.hydrateDelayMs));
      }
      return storage.store[key] ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      storage.store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete storage.store[key];
    }),
  },
}));

jest.mock("../services/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const STORAGE_KEY = "@live_translator_telemetry_v1";

// Re-require telemetry (and its mock deps) fresh per test so each test gets
// a pristine module-private counter store + hydration flag. jest.resetModules
// invalidates the require cache without touching jest.mock registrations.
type TelemetryModule = typeof import("../services/telemetry");
function loadTelemetry(): TelemetryModule {
  jest.resetModules();
  return require("../services/telemetry") as TelemetryModule;
}

beforeEach(() => {
  storage.store = {};
  storage.hydrateDelayMs = 0;
  // Re-read logger after resetModules in each test via require.
});

describe("telemetry counters", () => {
  it("increments and reads individual keys", () => {
    const tm = loadTelemetry();
    tm.increment("typeAhead.glossary");
    tm.increment("typeAhead.glossary", 3);
    tm.increment("speech.translateSuccess");

    expect(tm.get("typeAhead.glossary")).toBe(4);
    expect(tm.get("speech.translateSuccess")).toBe(1);
    expect(tm.get("typeAhead.offlineHit")).toBe(0);
  });

  it("getAll returns a snapshot clone (not aliased)", () => {
    const tm = loadTelemetry();
    tm.increment("typeAhead.network", 2);
    const snap = tm.getAll();
    expect(snap["typeAhead.network"]).toBe(2);

    // Mutating the snapshot must not leak into the module state.
    snap["typeAhead.network"] = 999;
    expect(tm.get("typeAhead.network")).toBe(2);
  });

  it("reset zeroes every counter", () => {
    const tm = loadTelemetry();
    tm.increment("typeAhead.glossary", 5);
    tm.increment("speech.translateFail", 3);
    tm.reset();
    expect(tm.get("typeAhead.glossary")).toBe(0);
    expect(tm.get("speech.translateFail")).toBe(0);
  });

  it("getTypeAheadTotal sums only type-ahead counters", () => {
    const tm = loadTelemetry();
    tm.increment("typeAhead.glossary", 2);
    tm.increment("typeAhead.offlineHit", 3);
    tm.increment("typeAhead.offlineMiss", 1);
    tm.increment("typeAhead.network", 4);
    // speech.* should not contribute
    tm.increment("speech.translateSuccess", 10);
    expect(tm.getTypeAheadTotal()).toBe(10);
  });

  it("getTypeAheadLocalRatio is 0 when no traffic, else glossary+offlineHit / total", () => {
    const tm = loadTelemetry();
    expect(tm.getTypeAheadLocalRatio()).toBe(0);
    tm.increment("typeAhead.glossary", 3);
    tm.increment("typeAhead.offlineHit", 1);
    tm.increment("typeAhead.network", 6);
    // total = 10, local = 4 → 0.4
    expect(tm.getTypeAheadLocalRatio()).toBeCloseTo(0.4, 5);
  });
});

describe("telemetry hydration", () => {
  it("hydrates known counters and drops unknown keys (#147 surfaces key names)", async () => {
    storage.store[STORAGE_KEY] = JSON.stringify({
      "typeAhead.glossary": 7,
      "speech.translateSuccess": 2,
      "typeAhead.futureField": 5, // unknown → pruned
      "speech.otherFuture": 9, // unknown → pruned
    });

    const tm = loadTelemetry();
    await tm.initTelemetry();

    expect(tm.get("typeAhead.glossary")).toBe(7);
    expect(tm.get("speech.translateSuccess")).toBe(2);

    const pruned = tm.prunedUnknownKeys();
    expect(pruned).toEqual(
      expect.arrayContaining(["typeAhead.futureField", "speech.otherFuture"])
    );
    expect(pruned.length).toBe(2);
    expect(tm.didPruneUnknownKeys()).toBe(true);
  });

  it("leaves prunedUnknownKeys empty when stored blob is clean", async () => {
    storage.store[STORAGE_KEY] = JSON.stringify({
      "typeAhead.network": 3,
    });
    const tm = loadTelemetry();
    await tm.initTelemetry();
    expect(tm.prunedUnknownKeys()).toEqual([]);
    expect(tm.didPruneUnknownKeys()).toBe(false);
    expect(tm.get("typeAhead.network")).toBe(3);
  });

  it("survives corrupted JSON and starts from empty counters", async () => {
    storage.store[STORAGE_KEY] = "{not-json";
    const tm = loadTelemetry();
    // Re-require the mocked logger from inside the freshly reset module
    // graph so we're asserting against the same instance telemetry.ts saw.
    const { logger } = require("../services/logger") as typeof import("../services/logger");
    await tm.initTelemetry();
    expect(tm.get("typeAhead.glossary")).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("preserves deltas that land during an in-flight hydrate (#134)", async () => {
    storage.store[STORAGE_KEY] = JSON.stringify({
      "typeAhead.glossary": 5,
    });
    storage.hydrateDelayMs = 20; // slow the AsyncStorage read

    const tm = loadTelemetry();
    const hydrationPromise = tm.initTelemetry();
    // Increment during hydration — this delta must survive.
    tm.increment("typeAhead.glossary", 2);
    tm.increment("typeAhead.network", 4);

    await hydrationPromise;

    // stored 5 + in-flight delta 2 = 7
    expect(tm.get("typeAhead.glossary")).toBe(7);
    // network had no stored value, only the in-flight delta
    expect(tm.get("typeAhead.network")).toBe(4);
  });

  /**
   * #154: pins the PENDING_DELTAS_MAX_KEYS = 64 safety cap on the hydration
   * staging map. Real TelemetryKey space is ~8 keys today so the cap is
   * anti-bug insurance rather than a live constraint — but if a future
   * refactor drops the cap (or raises it unbounded) a type-safety regression
   * in the caller could balloon memory during a slow hydrate. This test
   * casts synthetic string keys through `as unknown as TelemetryKey` to
   * exercise the cap path deterministically without having to explode the
   * real TelemetryKey union.
   *
   * Asserts three things:
   *  1. Already-tracked keys keep accumulating even after the cap is hit
   *     (the cap rejects *new* keys, not updates to existing staging entries).
   *  2. The cap-breach warn fires exactly once (one-shot via
   *     `pendingDeltasCapLogged`, not once per dropped delta).
   *  3. After the hydrate finally flushes, counters for staged keys still
   *     reflect the deltas that landed before the cap.
   */
  it("enforces the pendingDeltas cap during a slow hydrate (#139/#154)", async () => {
    storage.store[STORAGE_KEY] = JSON.stringify({ "typeAhead.glossary": 1 });
    // Long enough that we can pump 70+ synchronous increments in before
    // the AsyncStorage read resolves. Jest's timer is real here so the
    // setTimeout in the mock runs against wall-clock time.
    storage.hydrateDelayMs = 50;

    const tm = loadTelemetry();
    const { logger } = require("../services/logger") as typeof import("../services/logger");
    (logger.warn as jest.Mock).mockClear();

    const hydrationPromise = tm.initTelemetry();

    // Pump 70 distinct synthetic keys — more than the 64-key ceiling — so
    // the last 6 must be dropped. Cast through `unknown` so TypeScript lets
    // us invoke `increment` with strings the real union doesn't know about;
    // this is exactly the pathological case the cap defends against.
    const CAP = 64;
    const OVERSHOOT = 6;
    type UnsafeKey = Parameters<typeof tm.increment>[0];
    for (let i = 0; i < CAP + OVERSHOOT; i++) {
      tm.increment(`fake.k${i}` as unknown as UnsafeKey);
    }
    // Bump an already-tracked staging entry *after* the cap. This must
    // still accumulate — the cap rejects new keys, not updates to existing
    // ones, otherwise legitimate keys would stop counting mid-hydrate.
    tm.increment(`fake.k0` as unknown as UnsafeKey, 2);

    await hydrationPromise;

    // One-shot warn: one cap-breach log covers every dropped new-key delta,
    // not one warn per rejected increment. Check by tag so unrelated
    // AsyncStorage / JSON warnings in the same test file don't pollute the
    // count.
    const warnCalls = (logger.warn as jest.Mock).mock.calls.filter((call) => {
      const msg = typeof call[1] === "string" ? call[1] : "";
      return msg.includes("pendingDeltas cap reached");
    });
    expect(warnCalls.length).toBe(1);

    // Staged key k0 accumulated 1 (initial) + 2 (post-cap bump) = 3.
    expect(tm.get(`fake.k0` as unknown as UnsafeKey)).toBe(3);
    // Real typed key from the persisted baseline is unaffected.
    expect(tm.get("typeAhead.glossary")).toBe(1);
  });
});
