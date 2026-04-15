import {
  BASE_BACKOFF_MS,
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  computeBackoff,
} from "../utils/offlineQueueBackoff";

/**
 * Pins the offline-queue retry schedule. Any change to BASE / MAX / MAX_ATTEMPTS
 * must update both the constants in src/utils/offlineQueueBackoff.ts AND these
 * tests, which is the whole point — making the tuning visible during review.
 */
describe("offlineQueueBackoff.computeBackoff", () => {
  it("returns BASE on the first failure (attempts=1)", () => {
    expect(computeBackoff(1)).toBe(BASE_BACKOFF_MS);
  });

  it("doubles each subsequent attempt", () => {
    expect(computeBackoff(2)).toBe(BASE_BACKOFF_MS * 2);
    expect(computeBackoff(3)).toBe(BASE_BACKOFF_MS * 4);
    expect(computeBackoff(4)).toBe(BASE_BACKOFF_MS * 8);
    expect(computeBackoff(5)).toBe(BASE_BACKOFF_MS * 16);
  });

  it("clamps at MAX_BACKOFF_MS for very large attempt counts", () => {
    // 2 ** (20-1) * 2_000 = ~1 billion ms — way past the ceiling
    expect(computeBackoff(20)).toBe(MAX_BACKOFF_MS);
    expect(computeBackoff(50)).toBe(MAX_BACKOFF_MS);
  });

  it("never returns below BASE for attempts=1 (no off-by-one regression)", () => {
    // The original inline implementation used `Math.max(0, attempts - 1)`
    // which returned BASE * 2^0 = BASE on the first failure. Pinning that.
    expect(computeBackoff(1)).toBeGreaterThanOrEqual(BASE_BACKOFF_MS);
  });

  it("clamps zero / negative / NaN to a first-failure delay", () => {
    expect(computeBackoff(0)).toBe(BASE_BACKOFF_MS);
    expect(computeBackoff(-1)).toBe(BASE_BACKOFF_MS);
    expect(computeBackoff(-100)).toBe(BASE_BACKOFF_MS);
    expect(computeBackoff(Number.NaN)).toBe(BASE_BACKOFF_MS);
  });

  it("monotonically increases until the ceiling", () => {
    let prev = computeBackoff(1);
    for (let n = 2; n < 15; n++) {
      const next = computeBackoff(n);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  it("MAX_ATTEMPTS-th delay is still under or at the ceiling", () => {
    // MAX_ATTEMPTS = 5, so the last retry (attempts=5) should land at
    // BASE * 2^4 = 32_000ms — well under the 5-minute ceiling. If we ever
    // bump MAX_ATTEMPTS such that the last delay exceeds MAX_BACKOFF_MS,
    // this test will catch it and force a re-think.
    const lastDelay = computeBackoff(MAX_ATTEMPTS);
    expect(lastDelay).toBeLessThanOrEqual(MAX_BACKOFF_MS);
  });
});
