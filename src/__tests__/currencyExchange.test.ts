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
  getRatesCacheState,
  __resetCacheForTests,
} from "../services/currencyExchange";

beforeEach(() => {
  // #202: per-test reset of module-private cache + lastFetchAttempt so the
  // throttle and validation cases don't leak state across tests. Avoids the
  // jest.isolateModules+require dance for cases where the test only needs
  // a clean cache, not a fresh module instance.
  __resetCacheForTests();
});

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

  // #199 regression fence: the old `[\d,]+` accepted comma-only fragments
  // like `$,` which then bottomed out as parsePrice null. Tightening to
  // `\d[\d,]*` requires at least one digit so noisy OCR input doesn't
  // generate phantom matches.
  it("does not match a sigil followed only by punctuation", () => {
    expect(detectPricesInText("$,")).toEqual([]);
    expect(detectPricesInText("$,,, ")).toEqual([]);
    expect(detectPricesInText("€,.")).toEqual([]);
  });

  it("still matches a sigil followed by digits-with-commas", () => {
    // The tightened regex must not regress the legitimate "$1,234" case.
    const found = detectPricesInText("Total: $1,234.56");
    expect(found).toContainEqual(
      expect.objectContaining({ currency: "USD", amount: 1234.56 })
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

describe("getExchangeRates refetch throttling (#200)", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("does not refetch within the throttle window after a validation failure", async () => {
    // First call: malformed payload → falls back to hardcoded.
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ rates: "not an object" }),
    }));
    // @ts-expect-error mocking fetch
    global.fetch = fetchMock;

    await getExchangeRates();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Immediately retry. Without the throttle, this would re-fetch and
    // re-fail. With the throttle (#200), we short-circuit to the fallback
    // and do NOT touch the network for at least 60s.
    await getExchangeRates();
    await getExchangeRates();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns hardcoded fallback when throttled with no prior cache", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ rates: "garbage" }),
    }));
    // @ts-expect-error mocking fetch
    global.fetch = fetchMock;

    const first = await getExchangeRates();
    expect(first.timestamp).toBe(0);

    const second = await getExchangeRates();
    expect(second.timestamp).toBe(0);
    // hardcoded fallback shape — USD self-rate of 1
    expect(second.rates.USD).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});

describe("getRatesCacheState diagnostics", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("reports empty state on a fresh module", () => {
    const state = getRatesCacheState();
    expect(state.hasCache).toBe(false);
    expect(state.ageMs).toBeNull();
    expect(state.lastAttemptAgeMs).toBeNull();
    expect(state.isFresh).toBe(false);
    expect(state.willThrottleNextFetch).toBe(false);
  });

  it("reports a fresh cache after a successful fetch", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, HKD: 7.8, JPY: 150, EUR: 0.9, GBP: 0.79, CNY: 7.2 },
      }),
    }));
    await getExchangeRates();
    const state = getRatesCacheState();
    expect(state.hasCache).toBe(true);
    expect(state.ageMs).not.toBeNull();
    expect(state.ageMs!).toBeLessThan(1000); // just fetched
    expect(state.isFresh).toBe(true);
    expect(state.willThrottleNextFetch).toBe(true); // attempt just landed
  });

  it("reports throttled state after a failed fetch with no cache", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ rates: "garbage" }),
    }));
    await getExchangeRates();
    const state = getRatesCacheState();
    expect(state.hasCache).toBe(false); // validation failed, cache still null
    expect(state.lastAttemptAgeMs).not.toBeNull();
    expect(state.willThrottleNextFetch).toBe(true);
  });
});
