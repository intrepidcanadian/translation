import {
  translateText,
  clearTranslationCache,
  getTranslationCacheStats,
  resetCacheCounters,
} from "../services/translation";

// Mock fetch for MyMemory API tests
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock Platform
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

// Mock offlinePhrases — let real offlineTranslate run for known phrases
jest.mock("../services/offlinePhrases", () => {
  const actual = jest.requireActual("../services/offlinePhrases");
  return actual;
});

// Mock logger
jest.mock("../services/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

function mockMyMemoryResponse(translatedText: string, match = 0.95) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        responseStatus: 200,
        responseData: { translatedText, match },
      }),
  };
}

beforeEach(() => {
  clearTranslationCache();
  mockFetch.mockReset();
});

describe("translateText", () => {
  it("returns empty string for empty input", async () => {
    const result = await translateText("", "en", "es");
    expect(result.translatedText).toBe("");
  });

  it("returns offline translation for known phrases without calling API", async () => {
    const result = await translateText("Thank you", "en", "es", {
      provider: "mymemory",
    });
    expect(result.translatedText).toBe("Gracias");
    expect(result.confidence).toBe(1.0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls MyMemory API for unknown text", async () => {
    mockFetch.mockResolvedValueOnce(
      mockMyMemoryResponse("La casa es grande", 0.85)
    );

    const result = await translateText("The house is big", "en", "es", {
      provider: "mymemory",
    });
    expect(result.translatedText).toBe("La casa es grande");
    expect(result.confidence).toBe(0.85);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("api.mymemory.translated.net");
  });

  it("caches API results and reuses them", async () => {
    mockFetch.mockResolvedValueOnce(
      mockMyMemoryResponse("La casa es grande")
    );

    await translateText("The house is big", "en", "es", {
      provider: "mymemory",
    });
    const cached = await translateText("The house is big", "en", "es", {
      provider: "mymemory",
    });

    expect(cached.translatedText).toBe("La casa es grande");
    // Only one fetch call — second was served from cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("handles API rate limit (429 status)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({}),
    });

    await expect(
      translateText("Something new", "en", "es", { provider: "mymemory" })
    ).rejects.toThrow(/rate limit/i);
  });

  it("handles API error response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    await expect(
      translateText("Something else new", "en", "es", { provider: "mymemory" })
    ).rejects.toThrow();
  });

  it("trims input before translating", async () => {
    mockFetch.mockResolvedValueOnce(mockMyMemoryResponse("Hola mundo"));

    await translateText("  Hello world  ", "en", "es", {
      provider: "mymemory",
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent("Hello world"));
    expect(url).not.toContain(encodeURIComponent("  Hello world  "));
  });
});

describe("translation cache hit/miss counters (#117)", () => {
  beforeEach(() => {
    resetCacheCounters();
  });

  it("increments misses on the first call and hits on the second", async () => {
    mockFetch.mockResolvedValueOnce(
      mockMyMemoryResponse("La casa es grande")
    );

    // First call: cache miss (request reaches the provider)
    await translateText("The house is big", "en", "es", {
      provider: "mymemory",
    });

    let stats = getTranslationCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
    expect(stats.size).toBe(1);

    // Second call with identical args: cache hit (no new fetch)
    await translateText("The house is big", "en", "es", {
      provider: "mymemory",
    });

    stats = getTranslationCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not count offline-dictionary short-circuits as misses", async () => {
    // "Thank you" is in the offline phrase dictionary, so translateText
    // returns without reaching a provider. That path must be excluded from
    // hit/miss counters — otherwise the ratio in Settings → Translation
    // Diagnostics would drift every time a user translates a known phrase.
    await translateText("Thank you", "en", "es", { provider: "mymemory" });
    const stats = getTranslationCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resets hit/miss counters on a full clearTranslationCache call", async () => {
    mockFetch.mockResolvedValueOnce(mockMyMemoryResponse("Quantum foobar"));
    // Use a phrase guaranteed NOT to be in the offline dictionary so the
    // provider path runs and the miss counter actually increments.
    await translateText("Quantum foobar xyzzy", "en", "es", { provider: "mymemory" });
    expect(getTranslationCacheStats().misses).toBe(1);

    clearTranslationCache();
    const stats = getTranslationCacheStats();
    // Counters zero alongside the cache so the denominator stays meaningful
    // after the dashboard's "Clear Cache" action.
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.size).toBe(0);
  });
});
