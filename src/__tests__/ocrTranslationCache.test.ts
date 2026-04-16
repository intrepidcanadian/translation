/**
 * Unit tests for the OCR translation LRU cache in `services/ocrTranslation.ts`.
 *
 * Why pin this:
 *  - The OCR cache prevents redundant translation API calls during live
 *    camera scanning. ML Kit fires on every frame (~12-30fps) and
 *    repeatedly detects the same text lines. Without the cache, each
 *    detected line would trigger a network request per frame — thousands
 *    of calls per minute for a single scene. The cache is the primary
 *    cost-control mechanism.
 *  - The cache implements LRU (promote-on-hit) eviction with a 2000-entry
 *    cap. If eviction regresses to FIFO, frequently-viewed labels get
 *    evicted by a burst of one-off scans, causing visible flicker as
 *    the overlay re-fetches translations for stable text.
 *  - These tests exercise the cache via exported test hooks
 *    (__seedOCRCache, __readOCRCache, __getOCRCacheStats) so the
 *    internal LRU contract is pinned without mocking the translation
 *    service or native modules.
 */

import {
  clearOCRCache,
  __getOCRCacheStats,
  __seedOCRCache,
  __readOCRCache,
} from "../services/ocrTranslation";

beforeEach(() => {
  clearOCRCache();
});

describe("OCR translation cache", () => {
  it("starts empty after clearOCRCache", () => {
    expect(__getOCRCacheStats().size).toBe(0);
  });

  it("stores and retrieves a cached translation", () => {
    __seedOCRCache("en", "fr", "Hello", "Bonjour");
    expect(__readOCRCache("en", "fr", "Hello")).toBe("Bonjour");
  });

  it("returns undefined for cache misses", () => {
    expect(__readOCRCache("en", "fr", "not cached")).toBeUndefined();
  });

  it("keys are scoped by source/target language pair", () => {
    __seedOCRCache("en", "fr", "Hello", "Bonjour");
    __seedOCRCache("en", "es", "Hello", "Hola");
    expect(__readOCRCache("en", "fr", "Hello")).toBe("Bonjour");
    expect(__readOCRCache("en", "es", "Hello")).toBe("Hola");
    // Reversed pair should miss
    expect(__readOCRCache("fr", "en", "Hello")).toBeUndefined();
  });

  it("reports correct cache size", () => {
    __seedOCRCache("en", "fr", "One", "Un");
    __seedOCRCache("en", "fr", "Two", "Deux");
    __seedOCRCache("en", "fr", "Three", "Trois");
    expect(__getOCRCacheStats().size).toBe(3);
  });

  it("clearOCRCache empties the cache", () => {
    __seedOCRCache("en", "fr", "Test", "Test");
    expect(__getOCRCacheStats().size).toBe(1);
    clearOCRCache();
    expect(__getOCRCacheStats().size).toBe(0);
    expect(__readOCRCache("en", "fr", "Test")).toBeUndefined();
  });

  it("overwrites existing entries with the same key", () => {
    __seedOCRCache("en", "fr", "Hello", "Bonjour");
    __seedOCRCache("en", "fr", "Hello", "Salut");
    expect(__readOCRCache("en", "fr", "Hello")).toBe("Salut");
    // Overwrite should not increase size
    expect(__getOCRCacheStats().size).toBe(1);
  });

  it("evicts the oldest entry when exceeding MAX_CACHE_SIZE", () => {
    const maxSize = __getOCRCacheStats().maxSize;
    // Fill cache to max
    for (let i = 0; i < maxSize; i++) {
      __seedOCRCache("en", "fr", `text_${i}`, `trans_${i}`);
    }
    expect(__getOCRCacheStats().size).toBe(maxSize);

    // Add one more — should evict the oldest (text_0)
    __seedOCRCache("en", "fr", "overflow", "débordement");
    expect(__getOCRCacheStats().size).toBe(maxSize);
    // First entry should be evicted
    expect(__readOCRCache("en", "fr", "text_0")).toBeUndefined();
    // New entry should exist
    expect(__readOCRCache("en", "fr", "overflow")).toBe("débordement");
    // An entry from the middle should survive
    expect(__readOCRCache("en", "fr", `text_${maxSize - 1}`)).toBe(`trans_${maxSize - 1}`);
  });

  it("promotes entries on read (LRU, not FIFO)", () => {
    const maxSize = __getOCRCacheStats().maxSize;
    // Fill cache
    for (let i = 0; i < maxSize; i++) {
      __seedOCRCache("en", "fr", `text_${i}`, `trans_${i}`);
    }

    // Read text_0 to promote it to most-recently-used
    expect(__readOCRCache("en", "fr", "text_0")).toBe("trans_0");

    // Now text_1 is the oldest (text_0 was promoted). Add a new entry
    // to force eviction — text_1 should be evicted, NOT text_0.
    __seedOCRCache("en", "fr", "new_entry", "nouvelle");

    // text_0 should survive (it was promoted by the read)
    expect(__readOCRCache("en", "fr", "text_0")).toBe("trans_0");
    // text_1 should be evicted (it's now the oldest)
    expect(__readOCRCache("en", "fr", "text_1")).toBeUndefined();
    // New entry should exist
    expect(__readOCRCache("en", "fr", "new_entry")).toBe("nouvelle");
  });

  it("maxSize is 2000", () => {
    // Pin the cache size constant. A change here should be a deliberate
    // tuning decision, not an accident.
    expect(__getOCRCacheStats().maxSize).toBe(2000);
  });
});
