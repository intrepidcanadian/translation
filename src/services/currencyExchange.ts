// Multi-currency exchange rate service
// Uses cached rates with periodic refresh from a free API
// Falls back to hardcoded rates when offline

import { logger } from "./logger";

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
 * Runtime validator for the API response shape. The previous code accepted
 * anything truthy in `data.rates`, so a malformed response (e.g. an array,
 * a string, or a Record with non-numeric values) would poison the in-memory
 * cache for 4 hours and break every downstream conversion until the cache
 * expired. Reject anything that isn't a plain object whose values are all
 * finite numbers and includes USD as the self-rate.
 */
function isValidRatesPayload(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  // Need USD self-rate (~1) since we treat USD as the base
  if (typeof rec.USD !== "number" || !Number.isFinite(rec.USD)) return false;
  let validCount = 0;
  for (const v of Object.values(rec)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return false;
    validCount += 1;
  }
  // Sanity floor — a valid response has many currencies, not just USD
  return validCount >= 5;
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
  const rmFirst = cleaned.match(/^RM\s*([\d,]+(?:\.\d{1,2})?)/);
  if (rmFirst) {
    const num = parseFloat(rmFirst[1].replace(/,/g, ""));
    if (!isNaN(num)) return { currency: "MYR", amount: num };
  }
  const rmLast = cleaned.match(/([\d,]+(?:\.\d{1,2})?)\s*RM\b/);
  if (rmLast) {
    const num = parseFloat(rmLast[1].replace(/,/g, ""));
    if (!isNaN(num)) return { currency: "MYR", amount: num };
  }

  // Symbol-first patterns: $100, €50, £30, ¥1000, ₹500, ₩1000, ฿100
  const symbolFirst = cleaned.match(/^([HKNTSAد.إ]*[$€£¥₹₩฿₫₱¢])\s*([\d,]+(?:\.\d{1,2})?)/);
  if (symbolFirst) {
    const sym = symbolFirst[1];
    const num = parseFloat(symbolFirst[2].replace(/,/g, ""));
    if (!isNaN(num)) {
      return { currency: symbolToCurrency(sym), amount: num };
    }
  }

  // Symbol-last patterns: 100$, 100€
  const symbolLast = cleaned.match(/([\d,]+(?:\.\d{1,2})?)\s*([HKNTSAد.إ]*[$€£¥₹₩฿₫₱¢])/);
  if (symbolLast) {
    const num = parseFloat(symbolLast[1].replace(/,/g, ""));
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
  const codePattern = cleaned.match(/(?:^|\s)(USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|PHP|IDR|dollars?|euros?|pounds?|yen|yuan|won|baht)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (codePattern) {
    const num = parseFloat(codePattern[2].replace(/,/g, ""));
    if (!isNaN(num)) {
      return { currency: nameToCurrency(codePattern[1].toUpperCase()), amount: num };
    }
  }

  // #208: `baht` was missing from the trailing word alternatives so
  // `parsePrice("120 baht")` returned null even though `nameToCurrency("BAHT")`
  // already had a THB branch. The OCR fuzz corpus pinned the bug as a
  // current-behavior fixture — flipping the corpus expectation to include
  // THB 120 is part of this fix.
  const codeAfter = cleaned.match(/([\d,]+(?:\.\d{1,2})?)\s*(USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|PHP|IDR|dollars?|euros?|pounds?|yen|yuan|won|baht)/i);
  if (codeAfter) {
    const num = parseFloat(codeAfter[1].replace(/,/g, ""));
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
  const MONEY_RE = /(?:\bHK\$|\bNT\$|\bS\$|\bA\$|\bUS\$|\bRM|[$€£¥₹₩฿₫₱]|د\.إ)\s*\d[\d,]*(?:\.\d{1,2})?|\b(?:USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|PHP|IDR|dollars?|euros?|pounds?|yen|yuan|won|baht)\b\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*(?:\bHK\$|\bNT\$|\bS\$|[$€£¥₹₩฿₫₱]|\b(?:RM|dollars?|euros?|pounds?|yen|yuan|won|baht|USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR)\b)/gi;

  const matches = text.match(MONEY_RE) || [];
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
  // Handle multi-char prefixes first
  if (symbol.includes("HK$") || symbol === "HK$") return "HKD";
  if (symbol.includes("NT$") || symbol === "NT$") return "TWD";
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
