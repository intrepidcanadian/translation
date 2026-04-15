// Multi-currency exchange rate service
// Uses cached rates with periodic refresh from a free API
// Falls back to hardcoded rates when offline

import { logger } from "./logger";
import { increment as incrementTelemetry } from "./telemetry";
import { preprocessOCRPriceWraps } from "../utils/ocrPricePreprocess";

export interface ExchangeRates {
  base: string;
  timestamp: number;
  rates: Record<string, number>; // currency code → rate relative to base (USD)
}

export interface ConvertedPrice {
  currency: string;
  symbol: string;
  amount: number;
  formatted: string;
  flag: string;
}

// Currency metadata for display
export const CURRENCIES: Record<string, { symbol: string; flag: string; name: string; decimals: number }> = {
  USD: { symbol: "$", flag: "🇺🇸", name: "US Dollar", decimals: 2 },
  HKD: { symbol: "HK$", flag: "🇭🇰", name: "Hong Kong Dollar", decimals: 2 },
  CNY: { symbol: "¥", flag: "🇨🇳", name: "Chinese Yuan", decimals: 2 },
  TWD: { symbol: "NT$", flag: "🇹🇼", name: "New Taiwan Dollar", decimals: 0 },
  JPY: { symbol: "¥", flag: "🇯🇵", name: "Japanese Yen", decimals: 0 },
  KRW: { symbol: "₩", flag: "🇰🇷", name: "Korean Won", decimals: 0 },
  EUR: { symbol: "€", flag: "🇪🇺", name: "Euro", decimals: 2 },
  GBP: { symbol: "£", flag: "🇬🇧", name: "British Pound", decimals: 2 },
  SGD: { symbol: "S$", flag: "🇸🇬", name: "Singapore Dollar", decimals: 2 },
  THB: { symbol: "฿", flag: "🇹🇭", name: "Thai Baht", decimals: 2 },
  VND: { symbol: "₫", flag: "🇻🇳", name: "Vietnamese Dong", decimals: 0 },
  AUD: { symbol: "A$", flag: "🇦🇺", name: "Australian Dollar", decimals: 2 },
  INR: { symbol: "₹", flag: "🇮🇳", name: "Indian Rupee", decimals: 2 },
  AED: { symbol: "د.إ", flag: "🇦🇪", name: "UAE Dirham", decimals: 2 },
  MYR: { symbol: "RM", flag: "🇲🇾", name: "Malaysian Ringgit", decimals: 2 },
  PHP: { symbol: "₱", flag: "🇵🇭", name: "Philippine Peso", decimals: 2 },
  IDR: { symbol: "Rp", flag: "🇮🇩", name: "Indonesian Rupiah", decimals: 0 },
  // #219: Mexican Peso. Common at duty-free counters in Cancun / Mexico City
  // and a frequent OCR target for crew on Latin America routes. Symbol is
  // `MX$` (or sometimes `Mex$`) so it can't share the bare `$` parsing path
  // — has to be handled via the multi-char prefix list and the trailing
  // letter-code path. `pesos?` word form folds Argentine/Chilean pesos into
  // MXN by default, which is a known compromise documented in nameToCurrency.
  MXN: { symbol: "MX$", flag: "🇲🇽", name: "Mexican Peso", decimals: 2 },
};

// Default display currencies for airline crew (most relevant markets)
export const CREW_CURRENCIES = ["HKD", "CNY", "TWD", "JPY", "USD", "KRW", "SGD", "EUR", "THB"];

// Hardcoded fallback rates (USD base) — updated periodically
// These are approximate and used only when offline
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  HKD: 7.82,
  CNY: 7.24,
  TWD: 32.5,
  JPY: 154.5,
  KRW: 1380,
  EUR: 0.92,
  GBP: 0.79,
  SGD: 1.35,
  THB: 36.2,
  VND: 25400,
  AUD: 1.55,
  INR: 83.5,
  AED: 3.67,
  MYR: 4.72,
  PHP: 56.8,
  IDR: 15900,
  MXN: 17.05,
};

// Module-level cache
let cachedRates: ExchangeRates | null = null;
const CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours

/**
 * #200: track the last fetch *attempt* (success or failure) separately from
 * `cachedRates.timestamp` so a sustained validation failure doesn't cause
 * every conversion call to hammer the API. Without this guard the early
 * return at the top of `getExchangeRates()` only fires for a fresh, validated
 * cache — once the cache ages past CACHE_DURATION while the upstream API is
 * returning malformed payloads, every call would re-fetch, re-validate, and
 * fall through to the stale cache. The refetch interval is short enough
 * (60s) that a transient hiccup is corrected quickly, but long enough that
 * a sustained outage doesn't generate hundreds of network round-trips per
 * minute under heavy catalog scanning.
 */
const MIN_REFETCH_INTERVAL_MS = 60 * 1000;
let lastFetchAttempt = 0;

/**
 * Currencies that MUST be present in a valid API response for it to be
 * cached. This is stricter than the previous "any 5 currencies" floor:
 * without requiring specific major currencies, an upstream API regression
 * that returned `{ USD: 1, XYZ: 2, ABC: 3, DEF: 4, GHI: 5 }` would pass
 * validation and poison the cache with a shape that can't actually convert
 * any price the app cares about. EUR/GBP/JPY are the three most commonly-
 * seen non-USD currencies in real crew usage (duty-free receipts, Asian
 * travel, European stopovers), so their absence is a strong "this response
 * is malformed, reject and fall through to the stale cache or hardcoded
 * fallback" signal.
 */
const REQUIRED_RATE_CODES = ["USD", "EUR", "GBP", "JPY"] as const;

/**
 * Runtime validator for the API response shape. The previous code accepted
 * anything truthy in `data.rates`, so a malformed response (e.g. an array,
 * a string, or a Record with non-numeric values) would poison the in-memory
 * cache for 4 hours and break every downstream conversion until the cache
 * expired. Reject anything that isn't a plain object whose values are all
 * finite numbers and includes the `REQUIRED_RATE_CODES` set.
 */
function isValidRatesPayload(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  // Every required currency must be present as a positive finite number.
  // Using a strict list instead of the previous "USD only + count ≥ 5"
  // check so a partial response that happens to ship 5 minor currencies
  // but no EUR/GBP/JPY is rejected — those are the three we actually care
  // about in practice and their absence is usually a rollout bug upstream.
  for (const code of REQUIRED_RATE_CODES) {
    const v = rec[code];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return false;
  }
  // USD is the self-rate; sanity check that it's ~1 (within ±1% to tolerate
  // floating point but reject obviously-bad bases). A 2 or 0.5 here usually
  // means the upstream shipped a different base currency under the USD key.
  if (Math.abs((rec.USD as number) - 1) > 0.01) return false;
  // Remaining values must be finite positives too — one bad field in an
  // otherwise valid response could poison downstream conversions silently.
  for (const v of Object.values(rec)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return false;
  }
  // Sanity floor — a valid response has many currencies, not just the
  // required ones. 5 is the minimum; real responses usually have 150+.
  return Object.keys(rec).length >= 5;
}

/**
 * Fetch exchange rates (with caching and offline fallback)
 */
export async function getExchangeRates(): Promise<ExchangeRates> {
  const now = Date.now();
  // Return cached if fresh
  if (cachedRates && now - cachedRates.timestamp < CACHE_DURATION) {
    return cachedRates;
  }

  // #200: even when the cache is stale, throttle re-fetch attempts so a
  // sustained API outage doesn't generate one network round-trip per
  // conversion call. The 60s window is short enough to recover from a
  // transient hiccup quickly, long enough to keep heavy catalog scanning
  // from spamming the upstream while it's down.
  if (lastFetchAttempt > 0 && now - lastFetchAttempt < MIN_REFETCH_INTERVAL_MS) {
    if (cachedRates) return cachedRates;
    return {
      base: "USD",
      timestamp: 0,
      rates: FALLBACK_RATES,
    };
  }

  lastFetchAttempt = now;

  // Try fetching from free API
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      "https://open.er-api.com/v6/latest/USD",
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (response.ok) {
      // Wrap response.json() — a malformed/non-JSON body would otherwise
      // surface as an unhandled SyntaxError. Mirrors the safeParseJSON
      // pattern in translation.ts.
      let data: unknown = null;
      try {
        data = await response.json();
      } catch (parseErr) {
        logger.warn("Product", "Exchange rates response was not valid JSON", parseErr);
      }
      if (data && typeof data === "object" && "rates" in data && isValidRatesPayload((data as { rates: unknown }).rates)) {
        cachedRates = {
          base: "USD",
          timestamp: Date.now(),
          rates: (data as { rates: Record<string, number> }).rates,
        };
        logger.info("Product", "Exchange rates refreshed from API");
        return cachedRates;
      }
      if (data) {
        // #220: surface "API up but payload broken" as a distinct counter so
        // diagnostics can tell it apart from network failures (which fall
        // through the catch below). A non-zero value with a quiet manual-
        // refresh failure counter means users are silently on stale rates
        // because every refresh path is being rejected at validation.
        incrementTelemetry("rates.validationFailed");
        logger.warn("Product", "Exchange rates response failed validation, using fallback");
      }
    }
  } catch (err) {
    logger.warn("Product", "Failed to fetch exchange rates, using fallback", err);
  }

  // Fallback to hardcoded rates
  if (cachedRates) return cachedRates; // Stale cache better than hardcoded

  return {
    base: "USD",
    timestamp: 0, // Indicates fallback
    rates: FALLBACK_RATES,
  };
}

/**
 * Diagnostic snapshot of the exchange-rate cache. Used by Settings →
 * Diagnostics surfaces and tests; does not mutate state. `ageMs` is the
 * time since `cachedRates.timestamp` (the last *successful* validated
 * response), `lastAttemptAgeMs` is the time since the last fetch *attempt*
 * regardless of outcome — together they let a reader distinguish "cache is
 * fresh" from "cache is stale but we backed off retrying" from "cache is
 * stale and we just retried but failed validation". Returns 0/null fields
 * when there's been no traffic so consumers can short-circuit cleanly.
 */
export interface RatesCacheState {
  hasCache: boolean;
  ageMs: number | null;
  lastAttemptAgeMs: number | null;
  isFresh: boolean;
  willThrottleNextFetch: boolean;
  /**
   * #211: when the throttle is active, the number of milliseconds until the
   * next `getExchangeRates()` call will actually hit the network. `null` when
   * the throttle isn't active (no prior attempt, or the window already
   * elapsed). Lets a UI render a "Refreshing in 42s" countdown next to the
   * Refresh Rates button instead of a stuck-looking disabled state, and lets
   * tests assert on the throttle window without poking module internals.
   */
  nextRefetchInMs: number | null;
}

export function getRatesCacheState(): RatesCacheState {
  const now = Date.now();
  const ageMs = cachedRates && cachedRates.timestamp > 0 ? now - cachedRates.timestamp : null;
  const lastAttemptAgeMs = lastFetchAttempt > 0 ? now - lastFetchAttempt : null;
  const willThrottleNextFetch =
    lastAttemptAgeMs !== null && lastAttemptAgeMs < MIN_REFETCH_INTERVAL_MS;
  return {
    hasCache: cachedRates !== null,
    ageMs,
    lastAttemptAgeMs,
    isFresh: ageMs !== null && ageMs < CACHE_DURATION,
    willThrottleNextFetch,
    nextRefetchInMs: willThrottleNextFetch
      ? Math.max(0, MIN_REFETCH_INTERVAL_MS - (lastAttemptAgeMs ?? 0))
      : null,
  };
}

/**
 * Test-only escape hatch (#202) for clearing the module-private cache and
 * refetch-attempt timestamp without going through `jest.isolateModules`.
 * Tests that need a clean slate per case can call this in `beforeEach`
 * instead of paying the per-test module-load cost. Production code MUST
 * NOT call this — it would silently invalidate a perfectly good cache.
 */
export function __resetCacheForTests(): void {
  cachedRates = null;
  lastFetchAttempt = 0;
}

/**
 * Outcome of an explicit user-driven refresh. The previous version returned
 * the resolved `ExchangeRates` payload only, which conflated three very
 * different states: (1) we successfully fetched fresh rates, (2) the API
 * call failed and we fell back to a stale cache, (3) the API call failed and
 * we have no cache so we returned hardcoded fallback. From a UI perspective
 * those three deserve different feedback ("✓ Refreshed · 1s ago" vs.
 * "⚠ Refresh failed · using cache 1h old" vs. "⚠ Refresh failed · using
 * built-in rates"). #207.
 */
export type RefreshResult =
  | { ok: true; ageMs: number; hadStaleCache: boolean }
  | { ok: false; reason: "network"; ageMs: number | null; usedFallback: boolean };

/**
 * Force a fresh fetch, bypassing both the 4-hour cache TTL and the
 * 60s refetch-attempt throttle (#200). Wired to the "Refresh Rates"
 * button in Settings → Translation Diagnostics so users can override
 * the throttle when they suspect cached rates are stale (e.g. after
 * a long flight crossing currency zones). Falls through to the same
 * fallback paths as `getExchangeRates()` if the API call fails — i.e.
 * stale cache > hardcoded fallback.
 *
 * Returns a `RefreshResult` so the caller can render distinct feedback
 * for "succeeded with fresh rates", "failed but stale cache covers us",
 * and "failed and we're running on hardcoded fallback". (#207)
 *
 * Production code that just wants fresh rates should still call
 * `getExchangeRates()` — the throttle exists to protect the upstream
 * from heavy catalog scanning. This escape hatch is for explicit user
 * intent only.
 */
export async function forceRefreshExchangeRates(): Promise<RefreshResult> {
  // Capture the pre-existing cache so we can report whether the user was
  // already running on stale rates before the manual refresh — useful UX
  // for "we found something fresher" vs. "we just confirmed what you had".
  const hadStaleCache = cachedRates !== null && (Date.now() - cachedRates.timestamp >= CACHE_DURATION);
  cachedRates = null;
  lastFetchAttempt = 0;
  const rates = await getExchangeRates();
  if (rates.timestamp > 0) {
    return {
      ok: true,
      ageMs: Date.now() - rates.timestamp,
      hadStaleCache,
    };
  }
  // timestamp === 0 sentinel means we fell through to hardcoded fallback.
  // If `cachedRates` is still null after the call, neither validation nor
  // any prior cache survived — UI should warn that conversions will use
  // built-in rates. If a stale cache *did* survive, the surface is gentler.
  const survivingState = getRatesCacheState();
  return {
    ok: false,
    reason: "network",
    ageMs: survivingState.ageMs,
    usedFallback: !survivingState.hasCache,
  };
}

/**
 * #209: Locale-aware numeric parser for price amounts. The OCR fuzz corpus
 * pinned `€4,50` → EUR 450 as current behavior because `parseFloat` after a
 * naive `,`-strip treats comma as a thousands separator. That's wrong for
 * every European locale that uses `,` as the decimal separator.
 *
 * Heuristic — deliberately conservative to avoid mis-parsing legitimate
 * thousands-separated inputs:
 *
 *   1a. (#218) If the input matches the strict European thousands shape
 *       `^\d{1,3}(\.\d{3})+,\d{1,2}$` (e.g. `1.234,56` / `12.345.678,90`),
 *       treat `.` as the thousands separator and `,` as decimal. The shape
 *       is unambiguous because (a) every period must be followed by exactly
 *       3 digits, which is the *only* way thousands grouping can look in any
 *       locale, and (b) the trailing comma must be followed by 1–2 digits,
 *       which is the canonical European decimal tail. Both constraints
 *       together rule out US-style inputs like `1.234` (which would be a
 *       non-grouped decimal in en-US) or `1.234,567` (3 trailing digits, so
 *       not a decimal tail). This rule must be checked *before* rule 1 because
 *       a `1.234,56` input contains a period and would otherwise be Rule 1'd
 *       through `parseFloat("1234,56")` → NaN.
 *   1.  If the input contains a `.`, treat `.` as decimal and commas as
 *       thousands separators (current behavior). This matches US/UK/Asian
 *       formats where thousands separation is the dominant pattern.
 *   2.  If the input has NO `.` and exactly one `,` followed by exactly 1 or
 *       2 digits at the end of the string, treat `,` as the decimal separator.
 *       This is the canonical European format (`4,50`, `3,2`).
 *   3.  Otherwise, treat commas as thousands separators and strip them.
 *
 * Rule 2's "1 or 2 digits" constraint is the important guard. A thousands
 * separator always produces groups of exactly 3 digits (`1,234` / `12,345`),
 * so any trailing run of 1 or 2 digits after a single comma cannot be a
 * thousands separator by construction. Multi-comma inputs (`1,234,567`) fall
 * through to rule 3 and keep the current thousands-strip behavior.
 *
 * Returns NaN for empty/unparseable input; callers guard with !isNaN.
 */
export function parseLocaleAmount(raw: string): number {
  if (!raw) return NaN;
  const s = raw.trim();
  if (!s) return NaN;
  // Rule 1a (#218): strict European thousands form `1.234,56` — every period
  // followed by exactly 3 digits, then a single trailing comma + 1–2 decimal
  // digits. Must be checked before Rule 1 because the input contains a `.`
  // and would otherwise be misinterpreted as `parseFloat("1234,56")` → NaN
  // by Rule 1's comma-strip path.
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) {
    // Strip thousands periods, swap decimal comma for a period.
    return parseFloat(s.replace(/\./g, "").replace(",", "."));
  }
  // Rule 1: period present → comma is thousands.
  if (s.includes(".")) {
    return parseFloat(s.replace(/,/g, ""));
  }
  // Rule 2: single comma + 1–2 trailing digits (no other digits after) →
  // comma is decimal. `\b,(\d{1,2})$` is anchored to end so `1,234` (3 trailing
  // digits) fails to match and falls through to rule 3 as thousands. The
  // single-comma guard prevents mis-parsing inputs like `1,23,45` which
  // aren't legitimate in any locale we care about.
  const commaCount = (s.match(/,/g) || []).length;
  if (commaCount === 1) {
    const euroDecimal = s.match(/^(\d+),(\d{1,2})$/);
    if (euroDecimal) {
      return parseFloat(`${euroDecimal[1]}.${euroDecimal[2]}`);
    }
  }
  // Rule 3: commas are thousands separators; strip and parse as integer-ish.
  return parseFloat(s.replace(/,/g, ""));
}

/**
 * Detect source currency from a price string
 * Returns currency code and numeric amount
 */
export function parsePrice(priceStr: string): { currency: string; amount: number } | null {
  const cleaned = priceStr.trim();

  // Multi-char prefix currencies that don't end in a sigil character
  // (RM = Malaysian Ringgit). Previously this returned null because the
  // symbol-first regex required a trailing $/€/£/¥/etc. and `RM` doesn't
  // match. detectPricesInText() *did* recognize "RM 100" via its own
  // regex and then handed the raw match to parsePrice() which silently
  // returned null — so MYR prices vanished from price-detection results
  // even though `symbolToCurrency("RM")` had a branch waiting for them.
  // #218: amount sub-pattern widened from `[\d,]+(?:[.,]\d{1,2})?` to
  // `\d(?:[\d.,]*\d)?` so European-thousands inputs like `1.234,56` survive
  // capture intact. The old pattern only allowed commas inside the integer
  // part and a 1–2 digit decimal tail, so `1.234,56` would have captured only
  // `1.23` and dropped the `4,56` tail. The new shape requires a leading and
  // trailing digit (no dangling separators) and lets parseLocaleAmount sort
  // out the locale heuristic.
  const rmFirst = cleaned.match(/^RM\s*(\d(?:[\d.,]*\d)?)/);
  if (rmFirst) {
    const num = parseLocaleAmount(rmFirst[1]);
    if (!isNaN(num)) return { currency: "MYR", amount: num };
  }
  const rmLast = cleaned.match(/(\d(?:[\d.,]*\d)?)\s*RM\b/);
  if (rmLast) {
    const num = parseLocaleAmount(rmLast[1]);
    if (!isNaN(num)) return { currency: "MYR", amount: num };
  }

  // Symbol-first patterns: $100, €50, £30, ¥1000, ₹500, ₩1000, ฿100
  // #209: the decimal character class accepts both `.` and `,` so the
  // locale-aware helper can see the full number (`4,50` → EUR 4.50). A
  // naive `.`-only class would have dropped the last two digits before
  // parseLocaleAmount got a chance to interpret them.
  // #218: amount sub-pattern widened — see the rmFirst comment above.
  const symbolFirst = cleaned.match(/^([HKNTSAMXد.إ]*[$€£¥₹₩฿₫₱¢])\s*(\d(?:[\d.,]*\d)?)/);
  if (symbolFirst) {
    const sym = symbolFirst[1];
    const num = parseLocaleAmount(symbolFirst[2]);
    if (!isNaN(num)) {
      return { currency: symbolToCurrency(sym), amount: num };
    }
  }

  // Symbol-last patterns: 100$, 100€
  const symbolLast = cleaned.match(/(\d(?:[\d.,]*\d)?)\s*([HKNTSAMXد.إ]*[$€£¥₹₩฿₫₱¢])/);
  if (symbolLast) {
    const num = parseLocaleAmount(symbolLast[1]);
    const sym = symbolLast[2];
    if (!isNaN(num)) {
      return { currency: symbolToCurrency(sym), amount: num };
    }
  }

  // Code patterns: 100 USD, USD 100, 100 JPY
  // #208: word forms (BAHT, YEN, YUAN, WON, DOLLARS, EUROS, POUNDS) are now
  // also accepted as leading codes so "BAHT 120" rounds-trips through
  // nameToCurrency() the same way "120 baht" does on the trailing path.
  // Without this, `parsePrice("BAHT 120")` would have to fall through to the
  // codeAfter branch which only matches digit-then-word, so leading-word
  // forms silently returned null.
  const codePattern = cleaned.match(/(?:^|\s)(USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|PHP|IDR|MXN|dollars?|euros?|pounds?|yen|yuan|won|baht|pesos?)\s*(\d(?:[\d.,]*\d)?)/i);
  if (codePattern) {
    const num = parseLocaleAmount(codePattern[2]);
    if (!isNaN(num)) {
      return { currency: nameToCurrency(codePattern[1].toUpperCase()), amount: num };
    }
  }

  // #208: `baht` was missing from the trailing word alternatives so
  // `parsePrice("120 baht")` returned null even though `nameToCurrency("BAHT")`
  // already had a THB branch. The OCR fuzz corpus pinned the bug as a
  // current-behavior fixture — flipping the corpus expectation to include
  // THB 120 is part of this fix.
  const codeAfter = cleaned.match(/(\d(?:[\d.,]*\d)?)\s*(USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|PHP|IDR|MXN|dollars?|euros?|pounds?|yen|yuan|won|baht|pesos?)/i);
  if (codeAfter) {
    const num = parseLocaleAmount(codeAfter[1]);
    const code = codeAfter[2].toUpperCase();
    if (!isNaN(num)) {
      return { currency: nameToCurrency(code), amount: num };
    }
  }

  return null;
}

/**
 * Convert an amount from one currency to multiple target currencies
 */
export async function convertPrice(
  amount: number,
  fromCurrency: string,
  targetCurrencies: string[] = CREW_CURRENCIES,
): Promise<ConvertedPrice[]> {
  const rates = await getExchangeRates();
  const results: ConvertedPrice[] = [];

  const fromRate = rates.rates[fromCurrency];
  if (!fromRate) return results;

  // Convert to USD first, then to each target
  const usdAmount = amount / fromRate;

  for (const toCurrency of targetCurrencies) {
    if (toCurrency === fromCurrency) continue;
    const toRate = rates.rates[toCurrency];
    if (!toRate) continue;

    const converted = usdAmount * toRate;
    const meta = CURRENCIES[toCurrency];
    if (!meta) continue;

    const formatted = formatAmount(converted, meta.symbol, meta.decimals);

    results.push({
      currency: toCurrency,
      symbol: meta.symbol,
      amount: converted,
      formatted,
      flag: meta.flag,
    });
  }

  return results;
}

/**
 * Batch convert multiple prices at once (efficient for catalog scanning)
 */
export async function batchConvertPrices(
  prices: Array<{ amount: number; currency: string }>,
  targetCurrencies: string[] = CREW_CURRENCIES,
): Promise<Array<{ original: { amount: number; currency: string }; conversions: ConvertedPrice[] }>> {
  const rates = await getExchangeRates();
  const results: Array<{ original: { amount: number; currency: string }; conversions: ConvertedPrice[] }> = [];

  for (const price of prices) {
    const fromRate = rates.rates[price.currency];
    if (!fromRate) {
      results.push({ original: price, conversions: [] });
      continue;
    }

    const usdAmount = price.amount / fromRate;
    const conversions: ConvertedPrice[] = [];

    for (const toCurrency of targetCurrencies) {
      if (toCurrency === price.currency) continue;
      const toRate = rates.rates[toCurrency];
      if (!toRate) continue;

      const converted = usdAmount * toRate;
      const meta = CURRENCIES[toCurrency];
      if (!meta) continue;

      conversions.push({
        currency: toCurrency,
        symbol: meta.symbol,
        amount: converted,
        formatted: formatAmount(converted, meta.symbol, meta.decimals),
        flag: meta.flag,
      });
    }

    results.push({ original: price, conversions });
  }

  return results;
}

/**
 * Detect all prices in a text block and return parsed results
 */
export function detectPricesInText(text: string): Array<{ raw: string; currency: string; amount: number }> {
  // Comprehensive money pattern. Multi-char prefixes (RM, HK$, NT$, S$, A$,
  // US$) are alternations *outside* the character class because a class only
  // matches single chars — putting `RM` inside `[…RM]` would only match `R`
  // or `M` individually, which silently broke MYR detection until #191 fixed
  // both this regex and `parsePrice`.
  //
  // #199 v1: amount sub-patterns require at least one *digit* so a stray sigil
  // followed by punctuation only (e.g. `$,` or `$,,`) doesn't get matched
  // and hand a NaN-yielding fragment to parsePrice. The previous `[\d,]+`
  // matched `,` alone, which would still bottom out as a parsePrice null
  // but wasted a regex pass per false positive on noisy OCR input.
  //
  // #199 v2: alphabetic prefixes (RM, HK$, NT$, S$, A$, US$) are anchored to
  // a leading `\b` so a stray letter on the left can't drag them in — `ARM
  // 100` no longer matches `RM 100` (false positive: parsed as MYR 100), and
  // `WAS$5` no longer matches `S$5` (false positive: parsed as SGD 5). On the
  // *trailing* code side, the letter-only currency codes are wrapped in
  // `\b(...)\b` so `100 EUROPEAN COUNTRIES` no longer matches `100 EURO`
  // (false positive: parsed as EUR 100 because the `euros?` alternation
  // accepts `EURO`). Sigil-only branches stay un-anchored because `$/€/£`
  // aren't word characters and `\b` between a digit and `$` would be a no-op
  // anyway.
  //
  // #210: a third alternation handles the leading letter-code form
  // (`USD 234.56`, `EUR 100`). Previously the regex only generated trailing-
  // code matches for letter-only codes, so `Subtotal: USD 234.56` parsed as
  // null end-to-end even though `parsePrice("USD 234.56")` recognized it
  // via the `codePattern` branch. Bracketed in `\b(...)\b` for the same
  // false-positive reasons as the trailing branch — a stray `EURO` inside
  // `EUROPEAN` shouldn't drag a sibling number along. The full word forms
  // (BAHT, YEN, etc.) are also accepted to match the parsePrice surface.
  // #209: the trailing decimal sub-pattern accepts both `.\d{1,2}` and
  // `,\d{1,2}` so `€4,50` is captured end-to-end. parseLocaleAmount then
  // decides per-match whether the separator is a decimal (European) or a
  // thousands group (US/UK) based on digit grouping — see its docstring.
  // Without this change the regex only captured `€4`, truncating the price.
  // #218: amount sub-pattern widened from `\d[\d,]*(?:[.,]\d{1,2})?` to
  // `\d(?:[\d.,]*\d)?` so European-thousands inputs like `1.234,56` survive
  // capture intact. Both leading and trailing chars must be digits — that
  // prevents trailing `,` or `.` from being captured as part of the price.
  // parseLocaleAmount sorts out the locale heuristic for the captured tail.
  // #219: MX$ joins the multi-char prefix list and `MXN` / `pesos?` join the
  // letter-code alternations so Mexican Peso receipts extract end-to-end.
  const MONEY_RE = /(?:\bHK\$|\bNT\$|\bMX\$|\bS\$|\bA\$|\bUS\$|\bRM|[$€£¥₹₩฿₫₱]|د\.إ)\s*\d(?:[\d.,]*\d)?|\b(?:USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|PHP|IDR|MXN|dollars?|euros?|pounds?|yen|yuan|won|baht|pesos?)\b\s*\d(?:[\d.,]*\d)?|\d(?:[\d.,]*\d)?\s*(?:\bHK\$|\bNT\$|\bMX\$|\bS\$|[$€£¥₹₩฿₫₱]|\b(?:RM|dollars?|euros?|pounds?|yen|yuan|won|baht|pesos?|USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|MXN)\b)/gi;

  // #215: merge OCR line-wrap fragments before regex matching. Pure passthrough
  // for clean text — only mutates inputs that match the unambiguous wrap shape
  // documented in `preprocessOCRPriceWraps`. Wired here (not at every caller)
  // so the preprocessor runs uniformly for camera, paste, and speech inputs.
  const matches = preprocessOCRPriceWraps(text).match(MONEY_RE) || [];
  const results: Array<{ raw: string; currency: string; amount: number }> = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    const trimmed = raw.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);

    const parsed = parsePrice(trimmed);
    if (parsed && parsed.amount > 0) {
      results.push({ raw: trimmed, ...parsed });
    }
  }

  return results;
}

// --- Helpers ---

function symbolToCurrency(symbol: string): string {
  // Handle multi-char prefixes first. Order matters — `MX$` must precede the
  // single-char `$` fallthrough below, and the `S$` / `A$` checks must come
  // after `MX$` so a `MXS$` (impossible, but defensive) isn't mis-classified.
  if (symbol.includes("HK$") || symbol === "HK$") return "HKD";
  if (symbol.includes("NT$") || symbol === "NT$") return "TWD";
  if (symbol.includes("MX$") || symbol === "MX$") return "MXN";
  if (symbol.includes("S$") || symbol === "S$") return "SGD";
  if (symbol.includes("A$") || symbol === "A$") return "AUD";
  if (symbol.includes("د.إ")) return "AED";
  if (symbol === "RM") return "MYR";

  switch (symbol) {
    case "$": return "USD"; // Default dollar to USD
    case "€": return "EUR";
    case "£": return "GBP";
    case "¥": return "JPY"; // Ambiguous (JPY/CNY) — default to JPY, context can override
    case "₹": return "INR";
    case "₩": return "KRW";
    case "฿": return "THB";
    case "₫": return "VND";
    case "₱": return "PHP";
    default: return "USD";
  }
}

function nameToCurrency(name: string): string {
  const upper = name.toUpperCase();
  if (["DOLLAR", "DOLLARS"].includes(upper)) return "USD";
  if (["EURO", "EUROS"].includes(upper)) return "EUR";
  if (["POUND", "POUNDS"].includes(upper)) return "GBP";
  if (upper === "YEN") return "JPY";
  if (upper === "YUAN") return "CNY";
  if (upper === "WON") return "KRW";
  if (upper === "BAHT") return "THB";
  // #219: `peso`/`pesos` is ambiguous — could be MXN, ARS, CLP, COP, etc.
  // Default to MXN because it's by far the highest-volume "peso" the app
  // sees in practice (Cancun/Mexico City duty-free OCR). Users on Latin
  // America routes who scan an Argentine receipt will get the wrong code,
  // but the UI exposes the parsed currency so they can see the mismatch.
  // A future per-region locale picker (#216) would fix this properly.
  if (upper === "PESO" || upper === "PESOS") return "MXN";
  // If it's already a code, pass through
  if (CURRENCIES[upper]) return upper;
  return upper;
}

function formatAmount(amount: number, symbol: string, decimals: number): string {
  if (decimals === 0) {
    return `${symbol}${Math.round(amount).toLocaleString()}`;
  }
  return `${symbol}${amount.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
