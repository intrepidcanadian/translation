import { translateText, clearTranslationCache } from "../services/translation";

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
