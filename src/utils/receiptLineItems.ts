/**
 * Receipt line-item extraction (#222).
 *
 * `detectPricesInText` (from currencyExchange) finds isolated prices but
 * throws away the line context — you get `{currency: "USD", amount: 12.99}`
 * with no idea what item it belonged to. For the Receipt Assistant feature
 * we need the pair: `{name: "PERFUME", amount: 12.99, currency: "USD"}`.
 *
 * Shape we're extracting from (most OCR receipts look like one of these):
 *
 *     PERFUME 50ML             $89.50
 *     CHOCOLATE BOX ......     €12.00
 *     Item name goes here
 *     continuing description   HK$780.00
 *
 * Strategy — two-pass:
 *   1. Per line, try to find a trailing price (regex anchored to end-of-line
 *      with optional leading whitespace/dots used as leader filler). If the
 *      line has both a name-ish prefix AND a price, emit a single line item.
 *   2. If a line contains ONLY a price (no alphabetic content before it),
 *      walk upward to find the most recent line that was name-only (no
 *      price, has letters). That's the two-line "name on one line, price
 *      on the next" shape common on narrow thermal receipts.
 *
 * This is NOT a formal receipt parser — OCR receipts are inherently noisy
 * and there's no universal grammar. The parser is tuned to the common
 * shapes that users actually photograph (duty-free, cafes, restaurants,
 * hotels) and is deliberately permissive: false negatives (line dropped)
 * are preferred over false positives (wrong name bound to a price).
 *
 * The parser also applies `preprocessOCRPriceWraps` first so line-wrapped
 * prices (#215) survive into the extraction pass — otherwise a wrapped
 * `$1,2\n34.56` would look like "price-only line" followed by a garbage
 * line and nothing would be emitted.
 *
 * Returns lineItems in document order. Order matters for the LLM prompt —
 * it lets the model answer positional questions ("the second item") and
 * lets the rules fallback preserve original line numbering in its output.
 */

import { parsePrice } from "../services/currencyExchange";
import { preprocessOCRPriceWraps } from "./ocrPricePreprocess";

export interface ReceiptLineItem {
  /** Human-readable name or description from the line (trimmed, single-spaced). */
  name: string;
  /** ISO-ish currency code from `parsePrice` (e.g. "USD", "EUR", "HKD"). */
  currency: string;
  /** Numeric amount in the line's currency. */
  amount: number;
  /** The raw price string as captured from the OCR line (useful for UI hover/debug). */
  raw: string;
  /** 0-indexed line number within the cleaned OCR text (post line-wrap merge). */
  lineIndex: number;
}

export interface ReceiptExtraction {
  /** Line items in document order. */
  items: ReceiptLineItem[];
  /** Currencies observed across all items, in first-seen order. */
  currencies: string[];
  /** `true` if every item shares the same currency; useful for the "just sum" fast path. */
  singleCurrency: boolean;
  /** The cleaned OCR text (after line-wrap preprocessing) — this is what should
   *  be passed to the LLM so on-device prompts see the exact same input the
   *  rules fallback saw, making answers reproducible across both paths. */
  cleanedText: string;
}

// A price sub-pattern reused in both the trailing-price and standalone-price
// regexes. Matches the shape `detectPricesInText` accepts end-to-end so we
// don't drift from the parser. The outer `|` alternation mirrors MONEY_RE in
// currencyExchange.ts — multi-char prefix first, then single sigil, then
// letter code suffix. Trailing anchor `$` in the usage site is what makes
// "line ends in a price" work.
const TRAILING_PRICE_RE =
  /(?:\bHK\$|\bNT\$|\bMX\$|\bS\$|\bA\$|\bUS\$|\bRM|[$€£¥₹₩฿₫₱]|د\.إ)\s*\d(?:[\d.,]*\d)?\s*$|\b(?:USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|PHP|IDR|MXN|dollars?|euros?|pounds?|yen|yuan|won|baht|pesos?)\b\s*\d(?:[\d.,]*\d)?\s*$|\d(?:[\d.,]*\d)?\s*(?:\bHK\$|\bNT\$|\bMX\$|\bS\$|[$€£¥₹₩฿₫₱]|\b(?:RM|dollars?|euros?|pounds?|yen|yuan|won|baht|pesos?|USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|MXN)\b)\s*$/i;

// True when a line contains ONLY a price (and optional whitespace / leader
// dots). Used for the two-line "name above, price below" fallback path.
const PRICE_ONLY_LINE_RE =
  /^[\s.]*(?:(?:\bHK\$|\bNT\$|\bMX\$|\bS\$|\bA\$|\bUS\$|\bRM|[$€£¥₹₩฿₫₱]|د\.إ)\s*\d(?:[\d.,]*\d)?|\b(?:USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|PHP|IDR|MXN|dollars?|euros?|pounds?|yen|yuan|won|baht|pesos?)\b\s*\d(?:[\d.,]*\d)?|\d(?:[\d.,]*\d)?\s*(?:\bHK\$|\bNT\$|\bMX\$|\bS\$|[$€£¥₹₩฿₫₱]|\b(?:RM|dollars?|euros?|pounds?|yen|yuan|won|baht|pesos?|USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB|SGD|AUD|INR|AED|VND|MYR|MXN)\b))[\s.]*$/i;

// A "name line" must have at least one letter and no price-shaped
// substring. This is the anchor we walk backward to when we find an
// orphan price-only line. Two-char minimum filters "$$$" decoration rows.
const NAME_LINE_RE = /[A-Za-z\u00C0-\uFFFF]{2}/;

// Lines that are obviously headers/footers we should not mistake for an
// item name. Matching is lower-cased substring — the list is conservative
// on purpose. A false positive here (valid item name skipped) is preferable
// to a false negative (e.g. "TOTAL" being bound to a price as if it were a
// product). Users can still see the total via a separate aggregate; the
// line-item list should only contain *items*.
const SKIP_NAME_PATTERNS = [
  /^\s*(?:sub\s*)?total\b/i,
  /^\s*tax\b/i,
  /^\s*vat\b/i,
  /^\s*gst\b/i,
  /^\s*tip\b/i,
  /^\s*service\s*charge/i,
  /^\s*balance\b/i,
  /^\s*change\b/i,
  /^\s*cash\b/i,
  /^\s*card\b/i,
  /^\s*credit\b/i,
  /^\s*debit\b/i,
  /^\s*payment\b/i,
  /^\s*amount\s*(due|paid)/i,
  /^\s*grand\s*total/i,
  /^\s*(?:net|gross)\s*total/i,
  /^\s*thank\s*you/i,
  /^\s*receipt\b/i,
  /^\s*invoice\b/i,
];

function isSkipName(name: string): boolean {
  return SKIP_NAME_PATTERNS.some((re) => re.test(name));
}

/**
 * Strip leader dots and excess whitespace from a receipt line name. OCR
 * often renders "ITEM ........ $5" with multiple dots as leader; the final
 * name should collapse to "ITEM". Also trims stray punctuation at the tail
 * that's left over after the trailing price was sliced off.
 */
function cleanName(raw: string): string {
  return raw
    .replace(/[.\s]{2,}$/g, "") // trailing leader dots + whitespace
    .replace(/[.\s]+$/g, "") // then any single trailing dot/space
    .replace(/\s+/g, " ") // collapse internal runs
    .trim();
}

/**
 * Extract line items from receipt OCR text. See module docstring for the
 * two-pass strategy. Pure function — idempotent, no side effects, safe to
 * call repeatedly. An empty/whitespace input returns a zero-item extraction
 * with `singleCurrency: true` (vacuously true — no items means no conflict),
 * which keeps the rules fallback simple.
 */
export function extractReceiptLineItems(text: string): ReceiptExtraction {
  if (!text || !text.trim()) {
    return { items: [], currencies: [], singleCurrency: true, cleanedText: "" };
  }

  // Normalize line wraps first so `$1,2\n34.56` becomes a single line the
  // parser can see end-to-end. This is the same preprocessor the currency
  // detector uses, so the two paths stay in lockstep.
  const cleanedText = preprocessOCRPriceWraps(text);
  const lines = cleanedText.split("\n");
  const items: ReceiptLineItem[] = [];
  const seenCurrencies = new Set<string>();
  const currencyOrder: string[] = [];

  const pushItem = (item: ReceiptLineItem) => {
    items.push(item);
    if (!seenCurrencies.has(item.currency)) {
      seenCurrencies.add(item.currency);
      currencyOrder.push(item.currency);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Pass 1: trailing price on the same line as the name.
    const trailingMatch = line.match(TRAILING_PRICE_RE);
    if (trailingMatch) {
      const priceStart = trailingMatch.index ?? 0;
      const namePart = cleanName(line.slice(0, priceStart));
      const priceRaw = trailingMatch[0].trim();
      const parsed = parsePrice(priceRaw);
      if (parsed && parsed.amount > 0 && namePart && !isSkipName(namePart)) {
        pushItem({
          name: namePart,
          currency: parsed.currency,
          amount: parsed.amount,
          raw: priceRaw,
          lineIndex: i,
        });
        continue;
      }
      // If the name part is empty or a skip-word, treat this like a
      // price-only line and fall through to the two-line fallback.
    }

    // Pass 2: standalone price line — walk backward for a name line.
    if (PRICE_ONLY_LINE_RE.test(line)) {
      const priceRaw = line.trim().replace(/^[.\s]+|[.\s]+$/g, "");
      const parsed = parsePrice(priceRaw);
      if (!parsed || parsed.amount <= 0) continue;

      // Walk upward at most 3 lines to find a name candidate. Three is
      // enough for "CHOCOLATE BOX\n(detail line)\n€12.00" shapes without
      // binding a price to a name several sections above. A bigger
      // window risks dragging a stale header down onto an unrelated
      // price block.
      let nameCandidate = "";
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const candidate = lines[j];
        if (!candidate || !candidate.trim()) continue;
        // A candidate line must have letters (not just digits/dots/dashes)
        // and must NOT itself contain a trailing price (otherwise we'd
        // rebind the previous item's name to this price).
        if (!NAME_LINE_RE.test(candidate)) continue;
        if (TRAILING_PRICE_RE.test(candidate)) break;
        if (PRICE_ONLY_LINE_RE.test(candidate)) break;
        const cleaned = cleanName(candidate);
        if (cleaned && !isSkipName(cleaned)) {
          nameCandidate = cleaned;
        }
        break;
      }

      if (nameCandidate) {
        pushItem({
          name: nameCandidate,
          currency: parsed.currency,
          amount: parsed.amount,
          raw: priceRaw,
          lineIndex: i,
        });
      }
      // A price-only line with no plausible name upstream is silently
      // dropped. That's the trade-off — binding it to the wrong name is
      // worse than omitting it from the item list (the user-facing total
      // aggregate can still include it via detectPricesInText if needed).
    }
  }

  return {
    items,
    currencies: currencyOrder,
    singleCurrency: currencyOrder.length <= 1,
    cleanedText,
  };
}
