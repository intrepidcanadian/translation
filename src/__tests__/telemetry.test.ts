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
});
