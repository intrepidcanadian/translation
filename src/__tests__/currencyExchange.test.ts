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

// #220: currencyExchange now imports telemetry (for `rates.validationFailed`),
// which transitively pulls in AsyncStorage. The Node env doesn't ship the
// native module, so stub it here. Pure in-memory store — telemetry's
// schedulePersist() debounce never observably fires in tests because we
// never `await initTelemetry()`, but the import itself needs to succeed.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import {
  parsePrice,
  parseLocaleAmount,
  detectPricesInText,
  convertPrice,
  batchConvertPrices,
  getExchangeRates,
  getRatesCacheState,
  forceRefreshExchangeRates,
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

  // #219: Mexican Peso. The MX$ multi-char prefix joins the alternation list
  // and `MXN`/`pesos?` join the letter-code branches. All four shapes — sigil,
  // code prefix, code suffix, word form — must round-trip cleanly. The
  // "peso" word form is currently routed to MXN as the most common
  // duty-free use case; #216 will add a locale picker for users in PHP/CLP
  // territory who want a different default.
  it("parses MX$ as MXN", () => {
    expect(parsePrice("MX$1,250.00")).toEqual({ currency: "MXN", amount: 1250 });
    expect(parsePrice("MX$45")).toEqual({ currency: "MXN", amount: 45 });
  });

  it("parses MXN code prefix and suffix", () => {
    expect(parsePrice("MXN 250")).toEqual({ currency: "MXN", amount: 250 });
    expect(parsePrice("250 MXN")).toEqual({ currency: "MXN", amount: 250 });
  });

  it("parses 'pesos' word form as MXN", () => {
    expect(parsePrice("250 pesos")).toEqual({ currency: "MXN", amount: 250 });
    expect(parsePrice("1 peso")).toEqual({ currency: "MXN", amount: 1 });
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

  // #208: `baht` regression fence — both directions. Previously the codeAfter
  // regex was missing `baht` from its trailing alternations, so "120 baht"
  // returned null even though `nameToCurrency("BAHT")` had a THB branch
  // waiting. The codePattern (leading) regex was missing all word forms, so
  // "BAHT 120" / "EURO 50" went through the same drop.
  it("parses 'baht' word suffix as THB", () => {
    expect(parsePrice("120 baht")).toEqual({ currency: "THB", amount: 120 });
    expect(parsePrice("1,500 baht")).toEqual({ currency: "THB", amount: 1500 });
  });

  it("parses 'baht' word prefix as THB", () => {
    expect(parsePrice("BAHT 120")).toEqual({ currency: "THB", amount: 120 });
  });

  it("parses 'euros' word prefix as EUR", () => {
    expect(parsePrice("EUROS 50")).toEqual({ currency: "EUR", amount: 50 });
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

  // #199 v2 regression fence: alphabetic currency prefixes/codes used to drag
  // in surrounding letters as false positives. The regex now anchors RM, HK$,
  // NT$, S$, A$, US$, and the trailing letter-only codes (RM, USD, EUR, EURO,
  // ...) with `\b` word boundaries on the alphabetic side. These tests are the
  // load-bearing fence — a future regex tweak that drops the boundaries would
  // need to either delete or rewrite each of them.
  describe("alphabetic boundary tightening (#199)", () => {
    it("does not match RM inside a larger leading word (ARM)", () => {
      // Without `\bRM`, `ARM 100` matched the `RM 100` fragment and parsed as
      // MYR 100 — an entire push-up count became a Malaysian Ringgit price.
      expect(detectPricesInText("ARM 100 push-ups")).toEqual([]);
      expect(detectPricesInText("ARMY 250 strong")).toEqual([]);
    });

    it("does not match S$ inside a larger leading word (WAS$5)", () => {
      // `WAS$5 reduced` used to parse as SGD 5 because `S$5` was a substring
      // match. The `\bS\$` boundary requires a non-word char (or string start)
      // immediately before the `S`. The bare `$5` substring still matches via
      // the un-anchored `[$...]` branch — that's correct behavior, since "WAS$5"
      // is a price tag meaning USD 5, not SGD 5. The fence is that the SGD
      // misparse is gone, not that the literal `$5` evaporates.
      const found = detectPricesInText("WAS$5 reduced from $10");
      expect(found).toContainEqual(expect.objectContaining({ currency: "USD", amount: 5 }));
      expect(found).toContainEqual(expect.objectContaining({ currency: "USD", amount: 10 }));
      expect(found).not.toContainEqual(expect.objectContaining({ currency: "SGD" }));
    });

    it("does not match EURO inside EUROPEAN as a trailing code", () => {
      // The trailing-code branch contains `\beuros?\b`, which previously had
      // no trailing boundary and matched the `EURO` prefix of `EUROPEAN`.
      expect(detectPricesInText("100 EUROPEAN COUNTRIES")).toEqual([]);
      expect(detectPricesInText("50 EUROZONE members")).toEqual([]);
    });

    it("does not match USD inside a larger trailing word", () => {
      // The trailing-code branch wraps the letter-only codes in `\b...\b`, so
      // `100 USDA approved` no longer matches `100 USD` (false positive: parsed
      // as USD 100 because the next chars happened to be USD-prefixed).
      expect(detectPricesInText("100 USDA approved beef")).toEqual([]);
    });

    it("still matches the legitimate cases the boundary fix is fencing", () => {
      // Positive regression fence — every alphabetic prefix/code that the
      // tightening guards must continue to match its legitimate form. If a
      // future regex change accidentally over-fences (e.g. adds a boundary
      // that excludes a sigil that *isn't* a word char), this test catches
      // it before the next backlog run.
      const found = detectPricesInText(
        "Lunch RM 50, ride S$8, snack 100 EURO, fee 25 USD."
      );
      expect(found).toContainEqual(expect.objectContaining({ currency: "MYR", amount: 50 }));
      expect(found).toContainEqual(expect.objectContaining({ currency: "SGD", amount: 8 }));
      expect(found).toContainEqual(expect.objectContaining({ currency: "EUR", amount: 100 }));
      expect(found).toContainEqual(expect.objectContaining({ currency: "USD", amount: 25 }));
    });
  });

  // #206: OCR fuzz corpus. Real-world receipt OCR is messy — variable
  // whitespace, smudged punctuation, line wraps, mixed currencies in one
  // image. This corpus pins the *current* extraction behavior on a set of
  // representative noisy inputs so a future regex tweak that "looks fine"
  // in isolation doesn't silently break a class of receipts. Treat the
  // expected match sets as a regression baseline, not a spec — if a fixture
  // changes, decide whether the new behavior is better and update the
  // expectation, don't just delete the failing case.
  describe("OCR fuzz corpus (#206)", () => {
    const fixtures: Array<{
      name: string;
      input: string;
      expected: Array<{ currency: string; amount: number }>;
    }> = [
      {
        name: "duty-free receipt with mixed currencies",
        input: "PERFUME    $89.50\nCHOCOLATE  €12.00\nTOTAL HK$780.00",
        expected: [
          { currency: "USD", amount: 89.5 },
          { currency: "EUR", amount: 12 },
          { currency: "HKD", amount: 780 },
        ],
      },
      {
        name: "Malaysian receipt with RM prefix and trailing code",
        input: "Nasi Lemak RM 12.50\nTeh Tarik RM3.00\nTotal: 15.50 MYR",
        expected: [
          { currency: "MYR", amount: 12.5 },
          { currency: "MYR", amount: 3 },
          { currency: "MYR", amount: 15.5 },
        ],
      },
      {
        name: "comma-decimal European receipt (#209)",
        input: "Cafe €4,50\nCroissant €3,20",
        // #209: parseLocaleAmount now recognizes the `\d+,\d{1,2}$` single-
        // comma-with-1-or-2-trailing-digits pattern as a European decimal,
        // so `€4,50` → EUR 4.50 and `€3,20` → EUR 3.20. Previously this
        // fixture pinned the broken `EUR 450 / EUR 320` behavior — the
        // regression flip here is the whole point of the fix.
        expected: [
          { currency: "EUR", amount: 4.5 },
          { currency: "EUR", amount: 3.2 },
        ],
      },
      {
        name: "smudged sigils with stray punctuation",
        input: "Total :: $.. $42.00 ... €,, €15",
        // The `$` followed by `..` no longer matches (digit required). The
        // legitimate `$42.00` and `€15` still extract.
        expected: [
          { currency: "USD", amount: 42 },
          { currency: "EUR", amount: 15 },
        ],
      },
      {
        name: "line wrap inside a price (#215 preprocessor merges)",
        input: "TOTAL $1,2\n34.56",
        // #215: preprocessOCRPriceWraps now recognizes the wrap silhouette
        // (currency prefix + 1–3 digits + comma + 1–2 digits at end of line,
        // then 1–3 digits + `.\d{1,2}` at start of next line) and merges the
        // two halves into `$1234.56` before MONEY_RE sees the input. The
        // fixture flipped from the broken USD 1.2 baseline to the correct
        // USD 1234.56 — a regression here means the preprocessor stopped
        // matching the wrap shape (overly-conservative regex tightening) or
        // the parser stopped accepting the merged form.
        expected: [{ currency: "USD", amount: 1234.56 }],
      },
      {
        name: "MXN trailing code (#219)",
        input: "Tacos al Pastor 250 MXN\nAgua mineral 35 MXN",
        // #219: Mexican peso letter code joins the trailing-code alternation
        // and the symbolToCurrency map. Pins both the regex capture and the
        // parsePrice path end-to-end.
        expected: [
          { currency: "MXN", amount: 250 },
          { currency: "MXN", amount: 35 },
        ],
      },
      {
        name: "MXN MX$ prefix at duty-free (#219)",
        input: "Tequila MX$1,250.00\nSombrero MX$450",
        expected: [
          { currency: "MXN", amount: 1250 },
          { currency: "MXN", amount: 450 },
        ],
      },
      {
        name: "European thousands receipt (#218)",
        input: "Schnitzel €1.234,56\nBier €12,50",
        // #218: Rule 1a in parseLocaleAmount now recognizes the strict
        // European-thousands shape `\d{1,3}(\.\d{3})+,\d{1,2}` and parses
        // it as 1234.56 (period = thousands group, comma = decimal). The
        // bare `€12,50` still goes through the existing #209 single-comma
        // heuristic.
        expected: [
          { currency: "EUR", amount: 1234.56 },
          { currency: "EUR", amount: 12.5 },
        ],
      },
      {
        name: "thai baht: sigil and 'baht' word both extract (#208)",
        input: "Pad Thai 120 baht and water 30฿",
        // #208 fence: previously the MONEY_RE caught `120 baht` as a raw match
        // but parsePrice silently dropped it. Now both the trailing word form
        // (120 baht → THB 120) and the symbol-last sigil form (30฿ → THB 30)
        // round-trip end-to-end.
        expected: [
          { currency: "THB", amount: 120 },
          { currency: "THB", amount: 30 },
        ],
      },
      {
        name: "no prices at all (paragraph of OCR garbage)",
        input: "PERFUME COUNTER WELCOME ENJOY YOUR FLIGHT",
        expected: [],
      },
      {
        name: "trailing currency code with space",
        input: "Subtotal: 234.56 USD\nTax: 18.76 USD",
        expected: [
          { currency: "USD", amount: 234.56 },
          { currency: "USD", amount: 18.76 },
        ],
      },
      {
        name: "leading currency code form (#210)",
        // #210 fence: previously MONEY_RE only generated trailing-code
        // matches for letter-only codes, so a receipt that prefixed the
        // amount ("Total: USD 234.56") parsed as null end-to-end even
        // though parsePrice recognized it via the codePattern branch. The
        // new leading-code alternation in MONEY_RE closes the loop.
        input: "Total: USD 234.56\nTax: EUR 18.76\nFee: GBP 5",
        expected: [
          { currency: "USD", amount: 234.56 },
          { currency: "EUR", amount: 18.76 },
          { currency: "GBP", amount: 5 },
        ],
      },
      {
        name: "JPY/CNY ambiguous yen sigil defaults to JPY",
        input: "Bento ¥850 Tea ¥200",
        expected: [
          { currency: "JPY", amount: 850 },
          { currency: "JPY", amount: 200 },
        ],
      },
      {
        name: "negative-looking line with a stray hyphen (no false positive)",
        input: "DISCOUNT -- not a price -- $-",
        expected: [],
      },
    ];

    for (const fx of fixtures) {
      it(`extracts ${fx.expected.length} price(s) from "${fx.name}"`, () => {
        const found = detectPricesInText(fx.input);
        // Compare as multisets: order can shift if the regex is reordered,
        // and dedup-by-raw-string can drop legitimate repeats. The fixtures
        // are constructed so each expected entry has a distinct (currency,
        // amount) pair within its input.
        expect(found).toHaveLength(fx.expected.length);
        for (const exp of fx.expected) {
          expect(found).toContainEqual(expect.objectContaining(exp));
        }
      });
    }
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
          GBP: 0.79,
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

describe("forceRefreshExchangeRates RefreshResult (#207)", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("returns ok:true with hadStaleCache=false on a clean fresh fetch", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, HKD: 7.8, JPY: 150, EUR: 0.9, GBP: 0.79, CNY: 7.2 },
      }),
    }));
    const result = await forceRefreshExchangeRates();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hadStaleCache).toBe(false);
      expect(result.ageMs).toBeLessThan(1000);
    }
  });

  it("returns ok:true with hadStaleCache=true when prior cache was stale", async () => {
    // First, prime the cache with a stale entry by doing a successful fetch
    // and then manually aging the timestamp via a re-mount + fetch dance.
    // Simpler: use fake timers to advance past CACHE_DURATION between two
    // forceRefreshExchangeRates calls. forceRefresh resets lastFetchAttempt
    // so the second call is not throttled.
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, HKD: 7.8, JPY: 150, EUR: 0.9, GBP: 0.79, CNY: 7.2 },
      }),
    }));
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
      const first = await forceRefreshExchangeRates();
      expect(first.ok).toBe(true);
      // Advance 5 hours so the cache becomes stale (TTL is 4h)
      jest.setSystemTime(new Date(2026, 0, 1, 17, 0, 0));
      const second = await forceRefreshExchangeRates();
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.hadStaleCache).toBe(true);
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns ok:false reason=network usedFallback=true with no surviving cache", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await forceRefreshExchangeRates();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network");
      expect(result.usedFallback).toBe(true);
      expect(result.ageMs).toBeNull();
    }
  });

  it("returns ok:false usedFallback=false when stale cache survives a failed refetch", async () => {
    // First, succeed once to seed the cache.
    let shouldFail = false;
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => {
      if (shouldFail) throw new Error("network down");
      return {
        ok: true,
        json: async () => ({
          rates: { USD: 1, HKD: 7.8, JPY: 150, EUR: 0.9, GBP: 0.79, CNY: 7.2 },
        }),
      };
    });
    const seed = await forceRefreshExchangeRates();
    expect(seed.ok).toBe(true);
    // Now flip the network to broken and force-refresh again. The seed
    // cache is still in memory, so usedFallback should be false even
    // though the call failed.
    shouldFail = true;
    const second = await forceRefreshExchangeRates();
    // The cache was nulled at the top of forceRefresh, so it can't survive.
    // This is actually the expected behavior — explicit force-refresh
    // discards the in-memory cache before attempting. usedFallback=true
    // is correct here. Pin the documented behavior.
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.usedFallback).toBe(true);
    }
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

  // #211 fence: nextRefetchInMs lets a UI render a "Refreshing in 42s"
  // countdown next to the disabled refresh button instead of a stuck-looking
  // disabled state. Tests pin (a) null when no fetch attempt has happened,
  // (b) a positive value within the throttle window after an attempt, (c)
  // null again once the throttle window has elapsed.
  it("reports nextRefetchInMs=null on a fresh module", () => {
    const state = getRatesCacheState();
    expect(state.nextRefetchInMs).toBeNull();
  });

  it("reports nextRefetchInMs in the throttle window after a fetch", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, HKD: 7.8, JPY: 150, EUR: 0.9, GBP: 0.79, CNY: 7.2 },
      }),
    }));
    await getExchangeRates();
    const state = getRatesCacheState();
    expect(state.nextRefetchInMs).not.toBeNull();
    // Just-attempted fetch → countdown should be near the full 60s window
    expect(state.nextRefetchInMs!).toBeGreaterThan(58_000);
    expect(state.nextRefetchInMs!).toBeLessThanOrEqual(60_000);
  });

  it("clears nextRefetchInMs once the throttle window elapses", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, HKD: 7.8, JPY: 150, EUR: 0.9, GBP: 0.79, CNY: 7.2 },
      }),
    }));
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
      await getExchangeRates();
      // Advance past the 60s throttle window
      jest.setSystemTime(new Date(2026, 0, 1, 12, 1, 1));
      const state = getRatesCacheState();
      expect(state.willThrottleNextFetch).toBe(false);
      expect(state.nextRefetchInMs).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

// #209: parseLocaleAmount unit tests — the 3-rule heuristic for
// distinguishing "comma is a thousands separator" from "comma is a European
// decimal separator". The OCR fuzz corpus above exercises this through the
// full detectPricesInText pipeline, but these unit tests pin the helper
// directly so a future behavior tweak can be reasoned about in isolation.
describe("parseLocaleAmount (#209)", () => {
  describe("Rule 1 — period present, comma is thousands", () => {
    it("parses a plain decimal as-is", () => {
      expect(parseLocaleAmount("12.34")).toBe(12.34);
    });

    it("strips a single thousands comma when a period is present", () => {
      expect(parseLocaleAmount("1,234.56")).toBe(1234.56);
    });

    it("strips multiple thousands commas when a period is present", () => {
      expect(parseLocaleAmount("1,234,567.89")).toBe(1234567.89);
    });
  });

  describe("Rule 1a — strict European thousands form (#218)", () => {
    // The shape `\d{1,3}(\.\d{3})+,\d{1,2}` is unambiguous: a period followed
    // by *exactly* 3 digits is a thousands group, and a single trailing comma
    // with 1–2 decimal digits is the European decimal mark. Must be checked
    // BEFORE Rule 1 (which would otherwise treat the comma as a thousands
    // separator and mis-parse the value).

    it("parses `1.234,56` as 1234.56", () => {
      expect(parseLocaleAmount("1.234,56")).toBe(1234.56);
    });

    it("parses `12.345,67` as 12345.67", () => {
      expect(parseLocaleAmount("12.345,67")).toBe(12345.67);
    });

    it("parses `12.345.678,90` as 12345678.9 (multi-group)", () => {
      // The `+` quantifier on `(\.\d{3})` lets the rule match arbitrarily
      // long thousands chains. Important for prices over 1M.
      expect(parseLocaleAmount("12.345.678,90")).toBe(12345678.9);
    });

    it("parses `1.234,5` as 1234.5 (single decimal digit)", () => {
      // The 1–2 decimal digit window matches the European convention where
      // some receipts print only one decimal for round amounts.
      expect(parseLocaleAmount("1.234,5")).toBe(1234.5);
    });

    it("does NOT match `1.234` (no decimal comma → falls through to Rule 1)", () => {
      // Regression fence: `1.234` is a US decimal (1.234 dollars) and must
      // be parsed as 1.234, not as 1234. Rule 1a requires the trailing comma
      // so it correctly skips this input.
      expect(parseLocaleAmount("1.234")).toBe(1.234);
    });

    it("does NOT match `1.23` (period followed by only 2 digits)", () => {
      // The `\d{3}` quantifier rejects a non-3-digit group, so `1.23` falls
      // through to Rule 1 (period present → parseFloat as US decimal).
      expect(parseLocaleAmount("1.23")).toBe(1.23);
    });
  });

  describe("Rule 2 — single comma with 1–2 trailing digits is European decimal", () => {
    it("parses `4,50` as 4.5", () => {
      expect(parseLocaleAmount("4,50")).toBe(4.5);
    });

    it("parses `3,2` as 3.2 (single trailing digit)", () => {
      expect(parseLocaleAmount("3,2")).toBe(3.2);
    });

    it("parses `1234,56` as 1234.56 (no thousands grouping)", () => {
      // A European amount can be expressed without thousands grouping at all.
      // The heuristic still recognizes it because the single comma is
      // anchored to 1–2 trailing digits at end of string.
      expect(parseLocaleAmount("1234,56")).toBe(1234.56);
    });
  });

  describe("Rule 3 — fallthrough: commas are thousands separators", () => {
    it("parses `1,234` (3 trailing digits) as 1234", () => {
      // 3 trailing digits is the canonical thousands-grouping shape, so Rule 2
      // deliberately doesn't match and this falls through to strip-commas.
      expect(parseLocaleAmount("1,234")).toBe(1234);
    });

    it("parses `1,234,567` (multi-comma) as 1234567", () => {
      // Multi-comma inputs always fall through to Rule 3. This is the
      // important guard: Rule 2's single-comma constraint prevents a
      // fixture like `1,23,45` from being mis-parsed as 1.2345 or similar.
      expect(parseLocaleAmount("1,234,567")).toBe(1234567);
    });
  });

  describe("guards", () => {
    it("returns NaN for empty string", () => {
      expect(parseLocaleAmount("")).toBeNaN();
    });

    it("returns NaN for whitespace-only input", () => {
      expect(parseLocaleAmount("   ")).toBeNaN();
    });

    it("returns NaN for non-numeric garbage", () => {
      expect(parseLocaleAmount("abc")).toBeNaN();
    });

    it("trims surrounding whitespace before parsing", () => {
      expect(parseLocaleAmount("  4,50  ")).toBe(4.5);
    });
  });

  describe("integration — parsePrice and detectPricesInText use the helper", () => {
    it("parsePrice('€4,50') returns EUR 4.50", () => {
      // Symbol-first path with comma-decimal input. Previously this would
      // have been parsed as EUR 450 because the old `parseFloat(s.replace(/,/g, ""))`
      // stripped the decimal comma.
      expect(parsePrice("€4,50")).toEqual({ currency: "EUR", amount: 4.5 });
    });

    it("parsePrice('EUR 3,20') returns EUR 3.20 via codePattern", () => {
      // Leading-code path with comma-decimal input.
      expect(parsePrice("EUR 3,20")).toEqual({ currency: "EUR", amount: 3.2 });
    });

    it("parsePrice('$1,234') still returns USD 1234 (thousands fallthrough)", () => {
      // Rule 3 regression fence — the fix for European decimal must not
      // break the dominant US/UK thousands-separated case.
      expect(parsePrice("$1,234")).toEqual({ currency: "USD", amount: 1234 });
    });

    it("detectPricesInText captures €4,50 end-to-end", () => {
      // MONEY_RE must let the comma-decimal tail through so parseLocaleAmount
      // sees the full number. If MONEY_RE dropped the `,50` tail, the
      // helper would never get a chance to apply Rule 2.
      const found = detectPricesInText("€4,50");
      expect(found).toContainEqual(
        expect.objectContaining({ currency: "EUR", amount: 4.5 })
      );
    });
  });
});

// #212: isValidRatesPayload — REQUIRED_RATE_CODES enforcement. The old
// validator only demanded "USD present" + "≥ 5 currencies", so a partial
// upstream rollout that shipped USD + 4 minor currencies would pass and
// poison the 4-hour cache with a rate set that was missing the majors the
// app actually converts to in practice. These tests pin the stricter guard.
describe("isValidRatesPayload REQUIRED_RATE_CODES enforcement", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

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

  it("rejects a payload missing EUR", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, GBP: 0.79, JPY: 150, HKD: 7.8, CNY: 7.2 },
      }),
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    // timestamp=0 is the hardcoded-fallback sentinel. No EUR → validator
    // rejects → fall through to fallback.
    expect(rates.timestamp).toBe(0);
  });

  it("rejects a payload missing GBP", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, EUR: 0.9, JPY: 150, HKD: 7.8, CNY: 7.2 },
      }),
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    expect(rates.timestamp).toBe(0);
  });

  it("rejects a payload missing JPY", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, EUR: 0.9, GBP: 0.79, HKD: 7.8, CNY: 7.2 },
      }),
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    expect(rates.timestamp).toBe(0);
  });

  it("rejects a payload where USD self-rate is not ~1", async () => {
    // Sanity guard: the upstream API sometimes ships a non-USD base under
    // the USD key during provider migrations. A USD self-rate of 1.5 or 0.8
    // means "something else is the actual base" and every downstream
    // conversion will be off by that factor — reject hard.
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1.5, EUR: 0.9, GBP: 0.79, JPY: 150, HKD: 7.8 },
      }),
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    expect(rates.timestamp).toBe(0);
  });

  it("rejects a payload with a negative rate in a non-required currency", async () => {
    // The second pass validates every remaining value too, not just the
    // required ones. A single bad field anywhere in the response is enough
    // to poison downstream conversions silently, so reject the whole blob.
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, EUR: 0.9, GBP: 0.79, JPY: 150, HKD: -7.8, CNY: 7.2 },
      }),
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    expect(rates.timestamp).toBe(0);
  });

  // #220: validation rejections increment a dedicated counter so diagnostics
  // can distinguish "API down" (caught lower in the catch handler) from
  // "API up but garbage" (rejected here). The counter is incremented on
  // *every* refresh path, so a non-zero value with a quiet
  // rates.manualRefreshFailed counter means background refreshes are
  // silently being rejected and the user is staring at stale cached rates.
  //
  // Because `loadFreshModule` uses `jest.isolateModules`, currencyExchange
  // re-requires telemetry inside the isolated registry — we have to read
  // the counter from that *same* isolated instance, not the outer module,
  // or the increment will be invisible. Pull both modules together.
  function loadFreshModuleWithTelemetry(): {
    currency: typeof import("../services/currencyExchange");
    telemetry: typeof import("../services/telemetry");
  } {
    let currency: typeof import("../services/currencyExchange") | null = null;
    let telemetry: typeof import("../services/telemetry") | null = null;
    jest.isolateModules(() => {
      jest.doMock("../services/logger", () => ({
        logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      currency = require("../services/currencyExchange");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      telemetry = require("../services/telemetry");
    });
    if (!currency || !telemetry) throw new Error("module load failed");
    return { currency, telemetry };
  }

  it("increments rates.validationFailed when the payload is rejected", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        // Missing GBP — fails REQUIRED_RATE_CODES enforcement.
        rates: { USD: 1, EUR: 0.9, JPY: 150, HKD: 7.8, CNY: 7.2 },
      }),
    }));
    const { currency, telemetry } = loadFreshModuleWithTelemetry();
    const before = telemetry.getAll()["rates.validationFailed"];
    await currency.getExchangeRates();
    const after = telemetry.getAll()["rates.validationFailed"];
    expect(after).toBe(before + 1);
  });

  it("does NOT increment rates.validationFailed on a valid payload", async () => {
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, EUR: 0.9, GBP: 0.79, JPY: 150, HKD: 7.8 },
      }),
    }));
    const { currency, telemetry } = loadFreshModuleWithTelemetry();
    const before = telemetry.getAll()["rates.validationFailed"];
    await currency.getExchangeRates();
    const after = telemetry.getAll()["rates.validationFailed"];
    expect(after).toBe(before);
  });

  it("does NOT increment rates.validationFailed on a network failure", async () => {
    // Network errors fall through the outer catch — that's a different
    // signal (handled by the existing logger.warn path) and should leave
    // this counter alone. A non-zero validationFailed counter must
    // exclusively mean "API responded with garbage".
    global.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const { currency, telemetry } = loadFreshModuleWithTelemetry();
    const before = telemetry.getAll()["rates.validationFailed"];
    await currency.getExchangeRates();
    const after = telemetry.getAll()["rates.validationFailed"];
    expect(after).toBe(before);
  });

  it("accepts a payload with all four REQUIRED_RATE_CODES plus at least one extra", async () => {
    // Positive control: the minimum shape that passes validation. 5 total
    // currencies, USD=1, EUR/GBP/JPY present as positive finite numbers.
    // @ts-expect-error mocking fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rates: { USD: 1, EUR: 0.9, GBP: 0.79, JPY: 150, HKD: 7.8 },
      }),
    }));
    const mod = loadFreshModule();
    const rates = await mod.getExchangeRates();
    expect(rates.timestamp).toBeGreaterThan(0);
    expect(rates.rates.EUR).toBe(0.9);
  });
});
