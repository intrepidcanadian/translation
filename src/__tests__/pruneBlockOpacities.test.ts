import { pruneBlockOpacities } from "../utils/pruneBlockOpacities";

describe("pruneBlockOpacities", () => {
  it("does nothing when map is under cap", () => {
    const map = new Map([["a", 1], ["b", 2]]);
    const result = pruneBlockOpacities(map, new Set(["a", "b"]), 5);
    expect(result).toBe(0);
    expect(map.size).toBe(2);
  });

  it("evicts stale entries not in active set first", () => {
    const map = new Map([["a", 1], ["b", 2], ["c", 3]]);
    // Only "c" is active — "a" and "b" are stale
    const result = pruneBlockOpacities(map, new Set(["c"]), 3);
    expect(result).toBe(1);
    expect(map.has("a")).toBe(false); // oldest stale entry removed
    expect(map.has("b")).toBe(true);  // not yet needed
    expect(map.has("c")).toBe(true);  // active, kept
    expect(map.size).toBe(2);
  });

  it("evicts multiple stale entries to get under cap", () => {
    const map = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5]]);
    // Only "e" is active
    const result = pruneBlockOpacities(map, new Set(["e"]), 3);
    // Should evict "a", "b", "c" (3 stale entries) to get from 5 to 2
    expect(result).toBe(3);
    expect(map.size).toBe(2);
    expect(map.has("d")).toBe(true);
    expect(map.has("e")).toBe(true);
  });

  it("falls back to oldest-first when all entries are active", () => {
    const map = new Map([["a", 1], ["b", 2], ["c", 3]]);
    const allActive = new Set(["a", "b", "c"]);
    const result = pruneBlockOpacities(map, allActive, 3);
    expect(result).toBe(1);
    expect(map.has("a")).toBe(false); // oldest by insertion order
    expect(map.size).toBe(2);
  });

  it("falls back to oldest when stale sweep doesn't free enough", () => {
    const map = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
    // "a" is stale, rest are active — but cap is 3 so we need to remove 2
    const result = pruneBlockOpacities(map, new Set(["b", "c", "d"]), 3);
    // Phase 1 removes "a" (stale) → size 3, still >= cap
    // Phase 2 removes "b" (oldest remaining) → size 2
    expect(result).toBe(2);
    expect(map.size).toBe(2);
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(false);
    expect(map.has("c")).toBe(true);
    expect(map.has("d")).toBe(true);
  });

  it("handles exact cap boundary (size === cap)", () => {
    const map = new Map([["a", 1], ["b", 2], ["c", 3]]);
    const result = pruneBlockOpacities(map, new Set(["a", "c"]), 3);
    // "b" is stale → removed
    expect(result).toBe(1);
    expect(map.size).toBe(2);
    expect(map.has("b")).toBe(false);
  });

  it("handles empty map gracefully", () => {
    const map = new Map<string, number>();
    const result = pruneBlockOpacities(map, new Set(), 50);
    expect(result).toBe(0);
    expect(map.size).toBe(0);
  });

  it("handles cap of 1 correctly", () => {
    const map = new Map([["a", 1]]);
    const result = pruneBlockOpacities(map, new Set(["a"]), 1);
    expect(result).toBe(1);
    expect(map.size).toBe(0);
  });

  it("preserves Map insertion order after pruning", () => {
    const map = new Map([["a", 1], ["stale1", 2], ["b", 3], ["stale2", 4], ["c", 5]]);
    const activeIds = new Set(["a", "b", "c"]);
    pruneBlockOpacities(map, activeIds, 5);
    // stale1 removed first, then stale2 if needed
    const keys = Array.from(map.keys());
    // "a" should still be before "b" which is before "c"
    expect(keys.indexOf("a")).toBeLessThan(keys.indexOf("b"));
    expect(keys.indexOf("b")).toBeLessThan(keys.indexOf("c"));
  });
});
