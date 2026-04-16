/**
 * Rules-based answer engine for Receipt Assistant (#222).
 *
 * This is the deterministic fallback used when:
 *   - The device doesn't support Apple Foundation Models (non-iOS, iOS < 18.2,
 *     Apple Intelligence disabled, or Expo Go where native modules aren't
 *     loaded).
 *   - The user picks a preset question — presets are always routed through
 *     rules first even on LLM-capable devices, because an LLM is overkill for
 *     `min(prices)` and adds latency + battery cost per frame.
 *   - The on-device LLM call fails (network-adjacent code paths like model
 *     cold-load, memory pressure, timeout).
 *
 * The LLM path only kicks in for free-text questions ("why is tax so high?",
 * "which item would cost the most in Japan?"). Everything else resolves here
 * in <5ms against the ReceiptExtraction tuple.
 *
 * Contract: `answerWithRules(extraction, question, rates)` is pure given its
 * rate input and returns a `ReceiptAnswer` or null if the question shape
 * isn't one the rules engine handles. Null means "fall through to LLM or
 * give up" — callers decide which based on LLM availability.
 *
 * Async only because the "convert to X" branch needs the exchange-rate
 * cache. The min/max/count branches resolve synchronously internally but
 * wear the async hat for a uniform caller surface.
 */

import type { ExchangeRates } from "./currencyExchange";
import { CURRENCIES } from "./currencyExchange";
import type { ReceiptExtraction, ReceiptLineItem } from "../utils/receiptLineItems";

/**
 * The preset question palette the UI offers. Free-text questions go
 * through the `"custom"` bucket and may or may not resolve in rules.
 *
 * Each preset is paired with a resolver below; adding a new one means:
 *   1. Append to this union.
 *   2. Add a branch in `answerWithRules`.
 *   3. Add a UI chip in `ReceiptAssistantModal` (the chip list reads the
 *      same type so a missing branch would fail tsc).
 */
export type ReceiptQuestionKind =
  | "cheapest"
  | "mostExpensive"
  | "count"
  | "totalInCurrency"
  | "custom";

export interface ReceiptQuestion {
  kind: ReceiptQuestionKind;
  /** Required for `totalInCurrency`; ignored otherwise. ISO code like "USD". */
  targetCurrency?: string;
  /** The raw user text for `custom` questions. Unused by rules resolvers. */
  rawText?: string;
}

export interface ReceiptAnswer {
  /** Human-readable answer text, localized to English today. */
  text: string;
  /** The line item(s) the answer references, if any. Drives UI highlighting. */
  highlightItems: ReceiptLineItem[];
  /** Which path produced the answer — used for telemetry and UI badge. */
  source: "rules" | "llm";
  /** The question that produced this answer, echoed back for UI display. */
  question: ReceiptQuestion;
}

/**
 * Convert an amount from one currency to another via USD pivot (mirrors
 * `convertPrice` in currencyExchange.ts but pure — takes a rates table
 * instead of fetching). Returns null if either currency isn't in the
 * rates table, so the caller can surface a clear error instead of a NaN.
 */
function convertViaRates(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: ExchangeRates
): number | null {
  if (fromCurrency === toCurrency) return amount;
  const fromRate = rates.rates[fromCurrency];
  const toRate = rates.rates[toCurrency];
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}

/**
 * Format an amount with the target currency's display symbol and decimal
 * count. Mirrors `formatAmount` in currencyExchange.ts (which is private),
 * but uses `Intl.NumberFormat` for robust thousands grouping instead of
 * the hand-rolled regex — receipt totals have bigger numbers than the
 * single-price inline converter and benefit from locale-aware grouping.
 */
function formatWithSymbol(amount: number, currency: string): string {
  const meta = CURRENCIES[currency];
  const symbol = meta?.symbol ?? currency;
  const decimals = meta?.decimals ?? 2;
  const rounded = decimals === 0 ? Math.round(amount) : amount;
  const grouped = rounded.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol}${grouped}`;
}

/**
 * Main entry point. Returns a ReceiptAnswer or null if the rules engine
 * doesn't know how to answer this question. Null callers: LLM path or
 * final "I can't answer that" UI state.
 */
export async function answerWithRules(
  extraction: ReceiptExtraction,
  question: ReceiptQuestion,
  rates: ExchangeRates
): Promise<ReceiptAnswer | null> {
  const { items } = extraction;

  // No items? Every branch is vacuously unanswerable — bail with a clear
  // message so the UI can show "I couldn't find any priced items on this
  // receipt" instead of a NaN or undefined.
  if (items.length === 0) {
    return {
      text: "No priced items were detected on this receipt.",
      highlightItems: [],
      source: "rules",
      question,
    };
  }

  switch (question.kind) {
    case "cheapest": {
      // Pure min — normalize to USD via rates so the comparison is fair
      // across mixed-currency receipts. If any item is in a currency the
      // rates table doesn't cover, we fall back to comparing raw amounts
      // and flag it in the answer text. Better "probably wrong on
      // exotic currency" than "null because one rate is missing".
      const scored = scoreItemsInUSD(items, rates);
      const cheapest = scored.reduce((min, cur) =>
        cur.usdAmount < min.usdAmount ? cur : min
      );
      const item = cheapest.item;
      const priceLabel = formatWithSymbol(item.amount, item.currency);
      const note = cheapest.missingRate ? " (currency rate unavailable — compared raw amounts)" : "";
      return {
        text: `Cheapest: ${item.name} — ${priceLabel}${note}`,
        highlightItems: [item],
        source: "rules",
        question,
      };
    }

    case "mostExpensive": {
      const scored = scoreItemsInUSD(items, rates);
      const priciest = scored.reduce((max, cur) =>
        cur.usdAmount > max.usdAmount ? cur : max
      );
      const item = priciest.item;
      const priceLabel = formatWithSymbol(item.amount, item.currency);
      const note = priciest.missingRate ? " (currency rate unavailable — compared raw amounts)" : "";
      return {
        text: `Most expensive: ${item.name} — ${priceLabel}${note}`,
        highlightItems: [item],
        source: "rules",
        question,
      };
    }

    case "count": {
      return {
        text: `${items.length} priced item${items.length === 1 ? "" : "s"}.`,
        highlightItems: items,
        source: "rules",
        question,
      };
    }

    case "totalInCurrency": {
      const target = question.targetCurrency;
      if (!target) return null; // Malformed question; let caller handle
      let total = 0;
      const unconvertedItems: ReceiptLineItem[] = [];
      for (const item of items) {
        const converted = convertViaRates(item.amount, item.currency, target, rates);
        if (converted === null) {
          unconvertedItems.push(item);
          continue;
        }
        total += converted;
      }
      const totalLabel = formatWithSymbol(total, target);
      if (unconvertedItems.length > 0) {
        const skipped = unconvertedItems
          .map((i) => `${i.name} (${i.currency})`)
          .join(", ");
        return {
          text: `Total: ${totalLabel} (${unconvertedItems.length} item${unconvertedItems.length === 1 ? "" : "s"} skipped — missing exchange rate: ${skipped})`,
          highlightItems: items.filter((i) => !unconvertedItems.includes(i)),
          source: "rules",
          question,
        };
      }
      return {
        text: `Total: ${totalLabel} (${items.length} item${items.length === 1 ? "" : "s"})`,
        highlightItems: items,
        source: "rules",
        question,
      };
    }

    case "custom":
      // The rules engine deliberately doesn't try to guess at free-text
      // questions. Returning null tells the router to try the LLM path,
      // and if that's also unavailable the UI shows a clear "need Apple
      // Intelligence for custom questions" state.
      return null;
  }
}

interface ScoredItem {
  item: ReceiptLineItem;
  usdAmount: number;
  missingRate: boolean;
}

/**
 * Helper for the min/max branches: score every item by its USD-equivalent
 * price via the rates table, with a graceful fallback for currencies the
 * rates table doesn't cover (use the raw amount and flag it). Exported
 * for testing only.
 */
function scoreItemsInUSD(items: ReceiptLineItem[], rates: ExchangeRates): ScoredItem[] {
  return items.map((item) => {
    const usdAmount = convertViaRates(item.amount, item.currency, "USD", rates);
    if (usdAmount === null) {
      return { item, usdAmount: item.amount, missingRate: true };
    }
    return { item, usdAmount, missingRate: false };
  });
}
