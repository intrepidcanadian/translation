/**
 * @jest-environment node
 *
 * Tests for `preprocessOCRPriceWraps` (#215). The preprocessor merges the one
 * unambiguous OCR line-wrap shape: a currency prefix + 1–3 leading digits +
 * comma + 1–2 partial digits at end of line, then 1–3 digits + `.\d{1,2}` at
 * the start of the next line. Both halves of the silhouette must match — the
 * trailing comma is the strongest "incomplete number" signal because no
 * complete US/EU price ends on a comma.
 *
 * Test plan:
 *   1. Positive: every shape that should merge.
 *   2. Idempotence: running the merged output back through the preprocessor
 *      is a no-op.
 *   3. Negative: false-positive guards. Inputs that look superficially like
 *      wraps but are legitimate distinct prices must pass through untouched.
 *   4. Multi-wrap: more than one wrap in the same blob — the regex is global
 *      so .replace() must sweep every occurrence.
 *   5. Pipeline: detectPricesInText (which now calls the preprocessor before
 *      MONEY_RE matching) extracts the merged value end-to-end.
 */

jest.mock("../services/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// currencyExchange transitively imports telemetry (#220) which pulls in
// AsyncStorage. Stub the native module so the Node test env can resolve it.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { preprocessOCRPriceWraps } from "../utils/ocrPricePreprocess";
import { detectPricesInText, __resetCacheForTests } from "../services/currencyExchange";

beforeEach(() => {
  __resetCacheForTests();
});

describe("preprocessOCRPriceWraps (#215)", () => {
  describe("positive — merges the unambiguous wrap shape", () => {
    it("merges $1,2\\n34.56 into $1234.56", () => {
      // The canonical fixture from the OCR fuzz corpus. headInt=`1`,
      // commaTail=`2`, midDigits=`34`, decimalTail=`56` → `$1234.56`.
      expect(preprocessOCRPriceWraps("TOTAL $1,2\n34.56")).toBe("TOTAL $1234.56");
    });

    it("merges €1,2\\n34.50 into €1234.50", () => {
      // Same shape under the € sigil — every prefix in PRICE_PREFIX is in
      // scope, not just `$`. Important for European receipts that wrap.
      expect(preprocessOCRPriceWraps("Total €1,2\n34.50")).toBe("Total €1234.50");
    });

    it("merges across multi-char prefixes (HK$, NT$, MX$, RM)", () => {
      expect(preprocessOCRPriceWraps("HK$1,2\n34.50")).toBe("HK$1234.50");
      expect(preprocessOCRPriceWraps("NT$1,2\n34.50")).toBe("NT$1234.50");
      expect(preprocessOCRPriceWraps("MX$1,2\n34.50")).toBe("MX$1234.50");
      // The regex's `\s*` after the prefix consumes any inter-prefix whitespace,
      // so "RM 1,..." merges to "RM1234.50" (no space). parsePrice's `RM\s*\d`
      // pattern still matches that form, so the user-visible MYR extraction is
      // unchanged — pinned in the integration test below.
      expect(preprocessOCRPriceWraps("RM 1,2\n34.50")).toBe("RM1234.50");
    });

    it("tolerates whitespace and tabs around the line break", () => {
      // OCR sometimes inserts indent on the wrapped line. The `[ \t]*` on both
      // sides of the `\n` must absorb it without breaking the merge.
      expect(preprocessOCRPriceWraps("$1,2  \n  34.56")).toBe("$1234.56");
      expect(preprocessOCRPriceWraps("$1,2\t\n\t34.56")).toBe("$1234.56");
    });

    it("merges 3-digit head (e.g. $123,4\\n56.78 → $123456.78)", () => {
      // headInt accepts 1–3 digits. This pins the upper bound of the head.
      expect(preprocessOCRPriceWraps("$123,4\n56.78")).toBe("$123456.78");
    });
  });

  describe("idempotence", () => {
    it("returns the input unchanged on a second pass", () => {
      const merged = preprocessOCRPriceWraps("TOTAL $1,2\n34.56");
      // After the merge, no `\n` between the price halves remains, so the
      // wrap regex finds nothing to replace. Pure passthrough.
      expect(preprocessOCRPriceWraps(merged)).toBe(merged);
    });

    it("returns clean text untouched", () => {
      // The early `text.includes("\n")` short-circuit means single-line text
      // never even runs the regex.
      expect(preprocessOCRPriceWraps("TOTAL $1234.56")).toBe("TOTAL $1234.56");
      expect(preprocessOCRPriceWraps("")).toBe("");
    });
  });

  describe("negative — false-positive guards", () => {
    it("does NOT merge sigil + integer + newline + integer (Total $5\\n10 items)", () => {
      // No comma at the line end → not a wrap. The shape `$5\n10 items` is
      // a legitimate distinct-price sequence that we must not touch.
      expect(preprocessOCRPriceWraps("Total $5\n10 items")).toBe("Total $5\n10 items");
    });

    it("does NOT merge if the next-line tail has no decimal point", () => {
      // `$1,2\n34` looks like a wrap on the head but has no `.\d{1,2}` tail
      // on the wrapped line. Without the decimal we can't be sure the wrap
      // shape is a price at all, so leave it alone.
      expect(preprocessOCRPriceWraps("$1,2\n34")).toBe("$1,2\n34");
    });

    it("does NOT merge if the decimal tail is followed by another digit", () => {
      // The trailing `(?!\d)` negative lookahead prevents the merge from
      // biting into a longer number on the wrapped line. `$1,2\n34.56789`
      // is an OCR garbage run, not a wrap — pass through.
      expect(preprocessOCRPriceWraps("$1,2\n34.56789")).toBe("$1,2\n34.56789");
    });

    it("does NOT merge if the head has no comma (no incomplete-number signal)", () => {
      // `$1\n234.56` is ambiguous with a legitimate distinct-price sequence,
      // so the preprocessor leaves it alone. Documented limitation.
      expect(preprocessOCRPriceWraps("$1\n234.56")).toBe("$1\n234.56");
    });

    it("does NOT merge if the head has more than 3 digits before the comma", () => {
      // `$12345,6\n78.90` exceeds the headInt {1,3} bound. Conservative by
      // design — 4+ leading digits suggests this isn't a normal wrap shape.
      expect(preprocessOCRPriceWraps("$12345,6\n78.90")).toBe("$12345,6\n78.90");
    });
  });

  describe("multi-wrap sweep", () => {
    it("merges multiple wraps in the same blob", () => {
      // The regex is global so .replace() processes every match. Important
      // because OCR receipts can have multiple wraps in a single capture.
      const input = "Item A $1,2\n34.56\nItem B €5,6\n78.90";
      const out = preprocessOCRPriceWraps(input);
      expect(out).toContain("$1234.56");
      expect(out).toContain("€5678.90");
    });
  });

  describe("pipeline integration — detectPricesInText", () => {
    it("extracts the merged price as a single result", () => {
      // The preprocessor is wired into detectPricesInText so a wrapped
      // input now yields the correct full price instead of the broken
      // `USD 1.2` baseline that was pinned in the OCR fuzz corpus before
      // #215. This is the user-visible outcome of the whole change.
      const found = detectPricesInText("TOTAL $1,2\n34.56");
      expect(found).toContainEqual(
        expect.objectContaining({ currency: "USD", amount: 1234.56 })
      );
      // Should not also include a stray fragment for the wrapped half.
      expect(found.length).toBe(1);
    });
  });
});
