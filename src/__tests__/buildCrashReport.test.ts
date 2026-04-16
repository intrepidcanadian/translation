/**
 * @jest-environment node
 *
 * Unit tests for `src/utils/buildCrashReport.ts` — the pure crash report
 * builder extracted from SettingsModal (#224).
 *
 * The function reads live state from several services (translation cache,
 * circuit breakers, telemetry, logger, exchange rates). All are mocked here
 * so the test pins the *formatting* contract without relying on real service
 * state. Coverage goals:
 *
 *  1. Diagnostics redacted when `shareDiagnostics=false`
 *  2. Basic report shape: version, platform, crash message, timestamp, stack
 *  3. Cache stats rendered when present
 *  4. Circuit breaker state rendered when open/failures > 0
 *  5. Type-ahead telemetry rendered when total > 0
 *  6. Speech stats rendered including mic-muted hint
 *  7. Offline queue stats rendered
 *  8. Recent errors appended at the bottom
 */

import type { CrashReport } from "../types/crashReport";

// ---- Service mocks ----

const mockGetCircuitSnapshots = jest.fn().mockReturnValue([]);
const mockGetTranslationCacheStats = jest.fn().mockReturnValue({
  size: 0,
  max: 200,
  hits: 0,
  misses: 0,
});
jest.mock("../services/translation", () => ({
  getCircuitSnapshots: (...args: unknown[]) => mockGetCircuitSnapshots(...args),
  getTranslationCacheStats: (...args: unknown[]) => mockGetTranslationCacheStats(...args),
}));

const mockGetRecentErrors = jest.fn().mockReturnValue([]);
const mockCountBy = jest.fn().mockReturnValue({});
const mockCountByRolling = jest.fn().mockReturnValue({});
jest.mock("../services/logger", () => ({
  logger: {
    getRecentErrors: (...args: unknown[]) => mockGetRecentErrors(...args),
    countBy: (...args: unknown[]) => mockCountBy(...args),
    countByRolling: (...args: unknown[]) => mockCountByRolling(...args),
  },
}));

const EMPTY_TELEMETRY: Record<string, number> = {
  "typeAhead.glossary": 0,
  "typeAhead.offlineHit": 0,
  "typeAhead.offlineMiss": 0,
  "typeAhead.network": 0,
  "speech.translateSuccess": 0,
  "speech.translateFail": 0,
  "speech.noSpeech": 0,
  "speech.permissionDenied": 0,
  "rates.manualRefresh": 0,
  "rates.manualRefreshFailed": 0,
  "rates.validationFailed": 0,
};

const mockGetAll = jest.fn().mockReturnValue({ ...EMPTY_TELEMETRY });
const mockPrunedUnknownKeys = jest.fn().mockReturnValue([]);
const mockGetOfflineQueueStats = jest.fn().mockReturnValue({
  success: 0,
  failed: 0,
  total: 0,
  failRate: 0,
  deadLetter: 0,
});
const mockGetRatesServedStats = jest.fn().mockReturnValue({
  staleServed: 0,
  fallbackServed: 0,
});
jest.mock("../services/telemetry", () => ({
  getAll: (...args: unknown[]) => mockGetAll(...args),
  prunedUnknownKeys: (...args: unknown[]) => mockPrunedUnknownKeys(...args),
  getOfflineQueueStats: (...args: unknown[]) => mockGetOfflineQueueStats(...args),
  getRatesServedStats: (...args: unknown[]) => mockGetRatesServedStats(...args),
}));

const mockGetRatesCacheState = jest.fn().mockReturnValue({
  hasCache: false,
  isFresh: false,
  ageMs: null,
  willThrottleNextFetch: false,
  lastAttemptAgeMs: null,
  nextRefetchInMs: null,
});
const mockGetRatesFreshnessGrade = jest.fn().mockReturnValue("none");
jest.mock("../services/currencyExchange", () => ({
  getRatesCacheState: (...args: unknown[]) => mockGetRatesCacheState(...args),
  getRatesFreshnessGrade: (...args: unknown[]) => mockGetRatesFreshnessGrade(...args),
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios", Version: "18.0" },
}));

import { buildCrashReport } from "../utils/buildCrashReport";

// ---- Helpers ----

function baseCrash(overrides?: Partial<CrashReport>): CrashReport {
  return {
    schemaVersion: 1,
    message: "Test crash",
    timestamp: Date.now(),
    ...overrides,
  };
}

function resetMocks() {
  mockGetCircuitSnapshots.mockReturnValue([]);
  mockGetTranslationCacheStats.mockReturnValue({ size: 0, max: 200, hits: 0, misses: 0 });
  mockGetRecentErrors.mockReturnValue([]);
  mockCountBy.mockReturnValue({});
  mockCountByRolling.mockReturnValue({});
  mockGetAll.mockReturnValue({ ...EMPTY_TELEMETRY });
  mockPrunedUnknownKeys.mockReturnValue([]);
  mockGetOfflineQueueStats.mockReturnValue({ success: 0, failed: 0, total: 0, failRate: 0, deadLetter: 0 });
  mockGetRatesServedStats.mockReturnValue({ staleServed: 0, fallbackServed: 0 });
  mockGetRatesCacheState.mockReturnValue({ hasCache: false, isFresh: false, ageMs: null, willThrottleNextFetch: false, lastAttemptAgeMs: null, nextRefetchInMs: null });
  mockGetRatesFreshnessGrade.mockReturnValue("none");
}

beforeEach(resetMocks);

// ---- Tests ----

describe("buildCrashReport", () => {
  describe("basic report shape", () => {
    it("includes crash message, platform, and timestamp", () => {
      const report = buildCrashReport(baseCrash({ message: "RangeError: oops" }), false);
      expect(report).toContain("Live Translator crash report");
      expect(report).toContain("Crash: RangeError: oops");
      expect(report).toContain("Platform:");
    });

    it("includes version and build number when present", () => {
      const report = buildCrashReport(
        baseCrash({ appVersion: "2.1.0", buildNumber: "42" }),
        false
      );
      expect(report).toContain("Version: 2.1.0 (42)");
    });

    it("omits version line when no appVersion", () => {
      const report = buildCrashReport(baseCrash(), false);
      expect(report).not.toContain("Version:");
    });

    it("includes stack trace when present", () => {
      const report = buildCrashReport(
        baseCrash({ stack: "Error: boom\n  at foo (bar.ts:1)" }),
        false
      );
      expect(report).toContain("Stack: Error: boom");
    });

    it("uses crash.platform when set", () => {
      const report = buildCrashReport(baseCrash({ platform: "android 14" }), false);
      expect(report).toContain("Platform: android 14");
    });
  });

  describe("shareDiagnostics=false", () => {
    it("redacts diagnostics block", () => {
      // Provide data that WOULD render diagnostics if enabled
      mockGetTranslationCacheStats.mockReturnValue({ size: 50, max: 200, hits: 10, misses: 5 });
      const report = buildCrashReport(baseCrash(), false);
      expect(report).toContain("Diagnostics redacted");
      expect(report).not.toContain("Translation diagnostics:");
      expect(report).not.toContain("Cache:");
    });
  });

  describe("shareDiagnostics=true", () => {
    it("renders cache stats when cache has entries", () => {
      mockGetTranslationCacheStats.mockReturnValue({ size: 50, max: 200, hits: 30, misses: 10 });
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("Translation diagnostics:");
      expect(report).toContain("Cache: 50/200");
      expect(report).toContain("Cache hit rate: 75% (30/40)");
    });

    it("renders open circuit breaker", () => {
      mockGetCircuitSnapshots.mockReturnValue([
        { provider: "DeepL", open: true, failures: 3, msUntilReset: 15000 },
      ]);
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("DeepL: OPEN (15s) · failures 3");
    });

    it("renders closed breaker with failures", () => {
      mockGetCircuitSnapshots.mockReturnValue([
        { provider: "Google", open: false, failures: 1, msUntilReset: 0 },
      ]);
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("Google: closed · failures 1");
    });

    it("renders type-ahead telemetry when total > 0", () => {
      mockGetAll.mockReturnValue({
        ...EMPTY_TELEMETRY,
        "typeAhead.glossary": 5,
        "typeAhead.offlineHit": 12,
        "typeAhead.offlineMiss": 3,
        "typeAhead.network": 8,
      });
      // Need some cache data too for diagnostics to render
      mockGetTranslationCacheStats.mockReturnValue({ size: 1, max: 200, hits: 0, misses: 0 });
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("Type-ahead: glossary=5 offHit=12 offMiss=3 net=8");
    });

    it("renders speech translate stats with fail percentage", () => {
      mockGetAll.mockReturnValue({
        ...EMPTY_TELEMETRY,
        "speech.translateSuccess": 18,
        "speech.translateFail": 2,
      });
      mockGetTranslationCacheStats.mockReturnValue({ size: 1, max: 200, hits: 0, misses: 0 });
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("Speech translate: ok=18 fail=2 (10% fail)");
    });

    it("renders no-speech events", () => {
      mockGetAll.mockReturnValue({
        ...EMPTY_TELEMETRY,
        "speech.noSpeech": 5,
      });
      mockGetTranslationCacheStats.mockReturnValue({ size: 1, max: 200, hits: 0, misses: 0 });
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("Speech recognition: 5 no-speech event(s)");
    });

    it("renders mic-muted hint when pattern matches", () => {
      // MIC_MUTED_HINT_THRESHOLD = 3, no successes → mic muted
      mockGetAll.mockReturnValue({
        ...EMPTY_TELEMETRY,
        "speech.noSpeech": 4,
        "speech.translateSuccess": 0,
        "speech.translateFail": 0,
      });
      mockGetTranslationCacheStats.mockReturnValue({ size: 1, max: 200, hits: 0, misses: 0 });
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("Mic may be muted");
    });

    it("renders offline queue stats", () => {
      mockGetOfflineQueueStats.mockReturnValue({
        success: 8,
        failed: 2,
        total: 10,
        failRate: 0.2,
        deadLetter: 1,
      });
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("Offline queue: ok=8 fail=2 (20% fail of 10)");
      expect(report).toContain("Offline queue dead-lettered: 1");
    });

    it("renders manual rate refresh stats", () => {
      mockGetAll.mockReturnValue({
        ...EMPTY_TELEMETRY,
        "rates.manualRefresh": 5,
        "rates.manualRefreshFailed": 2,
      });
      mockGetTranslationCacheStats.mockReturnValue({ size: 1, max: 200, hits: 0, misses: 0 });
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("Manual rate refresh: 5 attempts, 2 failed (40%)");
    });

    it("renders pruned telemetry keys", () => {
      mockPrunedUnknownKeys.mockReturnValue(["old.key1", "old.key2"]);
      mockGetTranslationCacheStats.mockReturnValue({ size: 1, max: 200, hits: 0, misses: 0 });
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("Telemetry: pruned 2 unknown key(s)");
      expect(report).toContain("old.key1, old.key2");
    });

    it("truncates pruned keys beyond 8 with overflow count", () => {
      const keys = Array.from({ length: 12 }, (_, i) => `stale.key${i}`);
      mockPrunedUnknownKeys.mockReturnValue(keys);
      mockGetTranslationCacheStats.mockReturnValue({ size: 1, max: 200, hits: 0, misses: 0 });
      const report = buildCrashReport(baseCrash(), true);
      expect(report).toContain("pruned 12 unknown key(s)");
      expect(report).toContain("(+4 more)");
    });

    it("omits diagnostics block when no data exists", () => {
      const report = buildCrashReport(baseCrash(), true);
      expect(report).not.toContain("Translation diagnostics:");
      expect(report).not.toContain("Diagnostics redacted");
    });
  });

  describe("recent errors", () => {
    it("appends recent errors at the bottom", () => {
      mockGetRecentErrors.mockReturnValue([
        { tag: "Translation", message: "DeepL timeout" },
        { tag: "Network", message: "fetch failed" },
      ]);
      const report = buildCrashReport(baseCrash(), false);
      expect(report).toContain("Recent errors (2):");
      expect(report).toContain("[Translation] DeepL timeout");
      expect(report).toContain("[Network] fetch failed");
    });

    it("limits recent errors to last 10", () => {
      const errors = Array.from({ length: 15 }, (_, i) => ({
        tag: "Test",
        message: `error ${i}`,
      }));
      mockGetRecentErrors.mockReturnValue(errors);
      const report = buildCrashReport(baseCrash(), false);
      // Should contain errors 5-14 (last 10)
      expect(report).toContain("[Test] error 5");
      expect(report).toContain("[Test] error 14");
      expect(report).not.toContain("[Test] error 4");
    });
  });
});
