/**
 * @jest-environment node
 *
 * Tests for the pure surface of `src/services/currencyExchange.ts` —
 * `parsePrice`, `detectPricesInText`, and `convertPrice`/`batchConvertPrices`
 * via a stubbed exchange-rates fetch. The fetch path itself is also tested
 * with a `validation` regression fence: a malformed response must not poison
 * the in-memory cache (`isValidRatesPayload` guard).
 *
 * #191 follow-up — pins the parsePrice("RM 100") regression that previously
 * returned null even though `symbolToCurrency("RM")` had a branch waiting.
 */

jest.mock("../services/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import {
  parsePrice,
  detectPricesInText,
  convertPrice,
  batchConvertPrices,
  getExchangeRates,
} from "../services/currencyExchange";

describe("parsePrice", () => {
  it("parses leading $ as USD", () => {
    expect(parsePrice("$100")).toEqual({ currency: "USD", amount: 100 });
  });

  it("parses HK$ as HKD", () => {
    expect(parsePrice("HK$50.5")).toEqual({ currency: "HKD", amount: 50.5 });
  });

  it("parses NT$ as TWD", () => {
    expect(parsePrice("NT$1,200")).toEqual({ currency: "TWD", amount: 1200 });
  });

  it("parses S$ as SGD", () => {
    expect(parsePrice("S$25")).toEqual({ currency: "SGD", amount: 25 });
  });

  it("parses A$ as AUD", () => {
    expect(parsePrice("A$10")).toEqual({ currency: "AUD", amount: 10 });
  });

  it("parses € as EUR", () => {
    expect(parsePrice("€50")).toEqual({ currency: "EUR", amount: 50 });
  });

  it("parses £ as GBP", () => {
    expect(parsePrice("£30")).toEqual({ currency: "GBP", amount: 30 });
  });

  it("parses ¥ as JPY (default for ambiguous yen/yuan)", () => {
    expect(parsePrice("¥1000")).toEqual({ currency: "JPY", amount: 1000 });
  });

  it("parses ₹ as INR", () => {
    expect(parsePrice("₹500")).toEqual({ currency: "INR", amount: 500 });
  });

  it("parses ₩ as KRW", () => {
    expect(parsePrice("₩1500")).toEqual({ currency: "KRW", amount: 1500 });
  });

  it("parses ฿ as THB", () => {
    expect(parsePrice("฿100")).toEqual({ currency: "THB", amount: 100 });
  });

  it("parses comma-separated thousands", () => {
    expect(parsePrice("$1,234.56")).toEqual({ currency: "USD", amount: 1234.56 });
  });

  // #191 regression fence: parsePrice("RM 100") used to return null because
  // the symbol-first regex required a sigil character and "RM" doesn't have
  // one. detectPricesInText would find the raw "RM 100" string, hand it to
  // parsePrice, and silently drop it — so MYR prices vanished from results.
  it("recognizes RM (Malaysian Ringgit) leading prefix", () => {
    expect(parsePrice("RM 100")).toEqual({ currency: "MYR", amount: 100 });
    expect(parsePrice("RM50.50")).toEqual({ currency: "MYR", amount: 50.5 });
    expect(parsePrice("RM1,234.99")).toEqual({ currency: "MYR", amount: 1234.99 });
  });

  it("recognizes RM (Malaysian Ringgit) trailing suffix", () => {
    expect(parsePrice("100 RM")).toEqual({ currency: "MYR", amount: 100 });
  });

  it("parses USD code suffix", () => {
    expect(parsePrice("100 USD")).toEqual({ currency: "USD", amount: 100 });
  });

  it("parses USD code prefix", () => {
    // codePattern accepts code-then-amount with optional whitespace
    expect(parsePrice("USD 100")).toEqual({ currency: "USD", amount: 100 });
  });

  it("parses 'dollars' word suffix as USD", () => {
    expect(parsePrice("100 dollars")).toEqual({ currency: "USD", amount: 100 });
  });

  it("parses 'yen' word suffix as JPY", () => {
    expect(parsePrice("1000 yen")).toEqual({ currency: "JPY", amount: 1000 });
  });

  it("returns null for non-price strings", () => {
    expect(parsePrice("hello world")).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("price unknown")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parsePrice("  $100  ")).toEqual({ currency: "USD", amount: 100 });
  });
});

describe("detectPricesInText", () => {
  it("finds multiple distinct prices in a paragraph", () => {
    const text = "Coffee was $4.50 and lunch came to €15. Total ¥2000.";
    const found = detectPricesInText(text);
    expect(found).toContainEqual(
      expect.objectContaining({ currency: "USD", amount: 4.5 })
    );
    expect(found).toContainEqual(
      expect.objectContaining({ currency: "EUR", amount: 15 })
    );
    expect(found).toContainEqual(
      expect.objectContaining({ currency: "JPY", amount: 2000 })
    );
  });

  it("deduplicates exact repeated price strings", () => {
    const text = "$100 and another $100";
    const found = detectPricesInText(text);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ currency: "USD", amount: 100 });
  });

  it("skips non-positive amounts", () => {
    // amount > 0 filter
    const found = detectPricesInText("$0");
    expect(found).toHaveLength(0);
  });

  it("returns an empty array when no prices are present", () => {
    expect(detectPricesInText("hello world")).toEqual([]);
  });

  it("recognizes RM prefix in mixed text", () => {
    // Without the parsePrice RM fix, detectPricesInText would find the raw
    // "RM 50" but parsePrice would return null, dropping it from results.
    const text = "Lunch was RM 50 and coffee was $5.";
    const found = detectPricesInText(text);
    expect(found).toContainEqual(
      expect.objectContaining({ currency: "MYR", amount: 50 })
    );
  });
});

describe("convertPrice (with stubbed rates)", () => {
  // Patch global.fetch with a deterministic rates response so we don't hit
  // the network. open.er-api.com returns { result, rates: { USD: 1, ... } }.
  const realFetch = global.fetch;

  beforeEach(() => {
    // @ts-expect-error — installing a jest mock as global.fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        result: "success",
        rates: {
          USD: 1,
          HKD: 7.8,
          JPY: 150,
          EUR: 0.9,
          THB: 35,
          KRW: 1300,
          CNY: 7.2,
          TWD: 32,
          SGD: 1.35,
        },
      }),
    }));
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("converts USD to multiple targets", async () => {
    const results = await convertPrice(100, "USD", ["HKD", "JPY", "EUR"]);
    const byCode = Object.fromEntries(results.map((r) => [r.currency, r.amount]));
    expect(byCode.HKD).toBeCloseTo(780);
    expect(byCode.JPY).toBeCloseTo(15000);
    expect(byCode.EUR).toBeCloseTo(90);
  });

  it("skips the source currency in the conversion list", async () => {
    const results = await convertPrice(100, "USD", ["USD", "HKD"]);
    expect(results.find((r) => r.currency === "USD")).toBeUndefined();
    expect(results.find((r) => r.currency === "HKD")).toBeDefined();
  });

  it("returns empty array for an unknown source currency", async () => {
    const results = await convertPrice(100, "XYZ", ["HKD"]);
    expect(results).toEqual([]);
  });

  it("batchConvertPrices handles per-item rate misses without crashing", async () => {
    const results = await batchConvertPrices(
      [
        { amount: 100, currency: "USD" },
        { amount: 50, currency: "XYZ" }, // unknown — should yield empty conversions
      ],
      ["HKD"]
    );
    expect(results).toHaveLength(2);
    expect(results[0].conversions).toHaveLength(1);
    expect(results[1].conversions).toEqual([]);
  });
});

describe("getExchangeRates response validation", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  // jest.isolateModules + require keeps each test on a fresh module-private
  // `cachedRates`. Dynamic `await import()` would need experimental-vm-modules
  // and isn't worth the harness change for this batch.
  function loadFreshModule(): typeof import("../services/currencyExchange") {
    let mod: typeof import("../services/currencyExchange") | null = null;
    jest.isolateModules(() => {
      jest.doMock("../services/logger", () => ({
        logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("../services/currencyExchange");
    });
    if (!mod) throw new Error("module load failed");
    return mod;
  }

  it("falls back to hardcoded rates when API returns malformed payload", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      // rates is a string instead of an object — the old code would have
      // accepted it because `if (data.rates)` is truthy.
      json: async () => ({ rates: "definitely not an object" }),
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    expect(rates.timestamp).toBe(0); // 0 sentinel = hardcoded fallback
    expect(rates.rates.USD).toBe(1);
    expect(rates.rates.HKD).toBeGreaterThan(0);
  });

  it("falls back to hardcoded rates when API returns non-JSON body", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    expect(rates.timestamp).toBe(0);
  });

  it("accepts a well-formed payload and caches it", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, HKD: 7.8, JPY: 150, EUR: 0.9, GBP: 0.79, CNY: 7.2 },
      }),
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    expect(rates.timestamp).toBeGreaterThan(0);
    expect(rates.rates.HKD).toBe(7.8);
    // Second call should hit the in-memory cache, not refetch
    const fetchMock = global.fetch as unknown as jest.Mock;
    fetchMock.mockClear();
    await mod.getExchangeRates();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects payloads with too few currencies (likely truncated/malformed)", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ rates: { USD: 1, HKD: 7.8 } }), // only 2 currencies
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    expect(rates.timestamp).toBe(0);
  });

  it("rejects payloads with non-numeric rate values", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, HKD: "7.8", JPY: 150, EUR: 0.9, GBP: 0.79, CNY: 7.2 },
      }),
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    expect(rates.timestamp).toBe(0);
  });
});
