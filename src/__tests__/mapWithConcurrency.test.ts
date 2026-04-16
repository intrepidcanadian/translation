/**
 * Unit tests for `utils/mapWithConcurrency.ts`.
 *
 * Why pin this:
 *  - `mapWithConcurrency` is the concurrent task runner used by the OCR
 *    translation pipeline. It controls how many simultaneous translation
 *    requests are in flight during a camera scan. A regression in order
 *    preservation would scramble overlay positions; a regression in the
 *    concurrency limit would hammer the translation API and trigger
 *    rate-limiting.
 *  - The function is non-trivial: it uses a worker-pool pattern with a
 *    shared atomic `next` index. Subtle bugs (off-by-one in the index,
 *    workers not returning, unhandled rejection in one worker killing
 *    others) are hard to catch by eye.
 */

import { mapWithConcurrency } from "../utils/mapWithConcurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order in the result array", async () => {
    // Each item resolves after a different delay so out-of-order
    // completion is guaranteed — if order preservation breaks,
    // the result will be scrambled.
    const items = [3, 1, 2, 5, 4];
    const result = await mapWithConcurrency(items, 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 10));
      return n * 10;
    });
    expect(result).toEqual([30, 10, 20, 50, 40]);
  });

  it("passes the correct index to the callback", async () => {
    const items = ["a", "b", "c"];
    const indices: number[] = [];
    await mapWithConcurrency(items, 5, async (_, idx) => {
      indices.push(idx);
    });
    // All three indices should appear (order may vary due to concurrency)
    expect(indices.sort()).toEqual([0, 1, 2]);
  });

  it("limits concurrency to the specified cap", async () => {
    let activeConcurrent = 0;
    let maxConcurrent = 0;

    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async () => {
      activeConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, activeConcurrent);
      // Simulate async work so workers overlap
      await new Promise((r) => setTimeout(r, 20));
      activeConcurrent--;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    // Should actually reach 3 concurrent with 10 items
    expect(maxConcurrent).toBe(3);
  });

  it("works when limit exceeds item count", async () => {
    const items = [1, 2];
    const result = await mapWithConcurrency(items, 100, async (n) => n * 2);
    expect(result).toEqual([2, 4]);
  });

  it("works with an empty array", async () => {
    const result = await mapWithConcurrency([], 5, async () => "never");
    expect(result).toEqual([]);
  });

  it("works with a single item", async () => {
    const result = await mapWithConcurrency(["hello"], 3, async (s) => s.toUpperCase());
    expect(result).toEqual(["HELLO"]);
  });

  it("propagates errors from the callback", async () => {
    const items = [1, 2, 3];
    await expect(
      mapWithConcurrency(items, 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      })
    ).rejects.toThrow("boom");
  });

  it("handles limit of 1 (sequential execution)", async () => {
    const order: number[] = [];
    const items = [1, 2, 3, 4, 5];
    await mapWithConcurrency(items, 1, async (n) => {
      order.push(n);
      await new Promise((r) => setTimeout(r, 5));
    });
    // With limit=1, items must be processed in order
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns results of the correct type", async () => {
    const items = [1, 2, 3];
    const result = await mapWithConcurrency(items, 2, async (n) => String(n));
    expect(result).toEqual(["1", "2", "3"]);
  });

  it("correctly handles a large batch", async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const result = await mapWithConcurrency(items, 5, async (n) => n * 2);
    expect(result).toHaveLength(100);
    expect(result[0]).toBe(0);
    expect(result[99]).toBe(198);
    // Verify every element is correct
    for (let i = 0; i < 100; i++) {
      expect(result[i]).toBe(i * 2);
    }
  });
});
