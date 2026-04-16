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
// Uses the shared no-op mock factory (#199) — previously each suite hand-
// rolled an identical copy.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("./__mocks__/asyncStorage").asyncStorageMockFactory()
);

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

  // #198: context-aware no-comma wrap pass. Gated by a TOTAL-style keyword
  // so we only merge shapes where the surrounding context makes it
  // unambiguous — legitimate distinct-price sequences without the keyword
  // must still pass through untouched.
  describe("keyword-gated no-comma wrap (#198)", () => {
    describe("positive — merges when gated by a total-style keyword", () => {
      it("merges GRAND TOTAL $1\\n234.56 into GRAND TOTAL $1234.56", () => {
        expect(preprocessOCRPriceWraps("GRAND TOTAL $1\n234.56")).toBe("GRAND TOTAL $1234.56");
      });

      it("merges TOTAL €1\\n234.50 into TOTAL €1234.50", () => {
        expect(preprocessOCRPriceWraps("TOTAL €1\n234.50")).toBe("TOTAL €1234.50");
      });

      it("merges SUBTOTAL $12\\n345.67 (2-digit head) into SUBTOTAL $12345.67", () => {
        expect(preprocessOCRPriceWraps("SUBTOTAL $12\n345.67")).toBe("SUBTOTAL $12345.67");
      });

      it("merges AMOUNT DUE £1\\n234.56 (keyword with trailing word) into AMOUNT DUE £1234.56", () => {
        expect(preprocessOCRPriceWraps("AMOUNT DUE £1\n234.56")).toBe("AMOUNT DUE £1234.56");
      });

      it("merges BALANCE DUE: $1\\n234.56 (colon + space)", () => {
        expect(preprocessOCRPriceWraps("BALANCE DUE: $1\n234.56")).toBe("BALANCE DUE: $1234.56");
      });

      it("merges TO PAY ¥1\\n234.00 (TO PAY variant)", () => {
        expect(preprocessOCRPriceWraps("TO PAY ¥1\n234.00")).toBe("TO PAY ¥1234.00");
      });

      it("merges NET TOTAL ₹1\\n234.56 (NET TOTAL variant)", () => {
        expect(preprocessOCRPriceWraps("NET TOTAL ₹1\n234.56")).toBe("NET TOTAL ₹1234.56");
      });

      it("merges Total $123\\n456.78 (3-digit head → 6-digit integer)", () => {
        expect(preprocessOCRPriceWraps("Total $123\n456.78")).toBe("Total $123456.78");
      });

      it("keyword match is case-insensitive", () => {
        expect(preprocessOCRPriceWraps("grand total $1\n234.56")).toBe("grand total $1234.56");
        expect(preprocessOCRPriceWraps("Total $1\n234.56")).toBe("Total $1234.56");
      });
    });

    describe("negative — false-positive guards for no-comma pass", () => {
      it("does NOT merge when there is no total-style keyword", () => {
        // Without the keyword, `$1\n234.56` is ambiguous with a distinct-price
        // sequence and must pass through. This is the #215 baseline behavior.
        expect(preprocessOCRPriceWraps("Item $1\n234.56")).toBe("Item $1\n234.56");
        expect(preprocessOCRPriceWraps("$1\n234.56")).toBe("$1\n234.56");
      });

      it("does NOT merge when the wrapped segment is not exactly 3 digits", () => {
        // 3 digits is the thousands-grouping constraint. A 4-digit wrapped
        // segment `$1\n2345.67` doesn't fit the shape and may be ambiguous.
        expect(preprocessOCRPriceWraps("TOTAL $1\n2345.67")).toBe("TOTAL $1\n2345.67");
        // And a 2-digit wrapped segment would collapse to a 3-digit number
        // which doesn't need thousands grouping — not the target shape.
        expect(preprocessOCRPriceWraps("TOTAL $1\n23.45")).toBe("TOTAL $1\n23.45");
      });

      it("does NOT merge when the decimal tail is followed by another digit", () => {
        // `(?!\d)` negative lookahead — prevents eating into garbage digit runs.
        expect(preprocessOCRPriceWraps("TOTAL $1\n234.56789")).toBe("TOTAL $1\n234.56789");
      });

      it("does NOT merge when the keyword is on a distant earlier line", () => {
        // The `.{0,20}?` lazy fill between keyword and sigil caps how much
        // text can bridge them, so a keyword 3 lines above can't anchor.
        const distant = "TOTAL COUNT\n\n\nItem $1\n234.56";
        expect(preprocessOCRPriceWraps(distant)).toBe(distant);
      });

      it("does NOT merge when the keyword has more than 20 chars before the sigil", () => {
        // Keyword + long filler + sigil exceeds the 20-char window — the
        // lazy fill won't match, so the wrap stays as-is. Protects against
        // a keyword 5 words away anchoring to an unrelated number.
        const longFiller = "TOTAL purchases made during the trip $1\n234.56";
        expect(preprocessOCRPriceWraps(longFiller)).toBe(longFiller);
      });

      it("does NOT double-merge a comma wrap that the #215 pass already handled", () => {
        // #215 merges `$1,2\n34.56` first; the no-comma pass then sees
        // `TOTAL $1234.56` on a single line with no `\n` between head and
        // tail, so it finds nothing to change. Idempotence across passes.
        const merged = preprocessOCRPriceWraps("TOTAL $1,2\n34.56");
        expect(merged).toBe("TOTAL $1234.56");
        expect(preprocessOCRPriceWraps(merged)).toBe(merged);
      });
    });

    describe("pipeline integration with detectPricesInText", () => {
      it("extracts a keyword-gated merge as a single USD price", () => {
        const found = detectPricesInText("GRAND TOTAL $1\n234.56");
        expect(found).toContainEqual(
          expect.objectContaining({ currency: "USD", amount: 1234.56 })
        );
        // Should not see a stray fragment for either half of the wrap.
        expect(found.length).toBe(1);
      });

      it("leaves ungated shapes alone so distinct prices still extract", () => {
        // No keyword → both halves parse as distinct prices. This is the
        // control case that proves the keyword gate is actually gating.
        const found = detectPricesInText("Total $5\n10 items cost $234.56");
        // The conservative reading finds $5 and $234.56 as two distinct
        // prices, not a merged $510 or $5234.56. The "Total $5" is a
        // distinct line from the "10 items" count.
        expect(found.map((p) => p.amount)).toEqual(
          expect.arrayContaining([5, 234.56])
        );
      });
    });
  });

  // #203: the third wrap shape — a complete thousands-grouped integer head
  // on line 1 and a bare `.\d{1,2}` fractional tail on line 2. The trigger is
  // stricter than the previous two because the fractional tail alone is more
  // likely to be OCR garbage than an intended decimal — gated on BOTH a
  // TOTAL-style keyword AND a thousands-grouped head to keep false-positives
  // near zero.
  describe("keyword-gated no-decimal wrap (#203)", () => {
    describe("positive — merges when gated by a total-style keyword + thousands head", () => {
      it("merges TOTAL $1,234\\n.56 into TOTAL $1,234.56", () => {
        // Canonical fixture. Head has one thousands group (`1,234`), tail is
        // a bare `.56`. parseLocaleAmount Rule 1 handles the `1,234.56`
        // form (period present → comma is thousands) → USD 1234.56.
        expect(preprocessOCRPriceWraps("TOTAL $1,234\n.56")).toBe("TOTAL $1,234.56");
      });

      it("merges GRAND TOTAL €12,345\\n.67 into GRAND TOTAL €12,345.67", () => {
        // 2-digit head before the comma — the `\\d{1,3}` bound still accepts.
        expect(preprocessOCRPriceWraps("GRAND TOTAL €12,345\n.67")).toBe(
          "GRAND TOTAL €12,345.67"
        );
      });

      it("merges AMOUNT DUE £123,456\\n.78 (3-digit head → 6-digit integer)", () => {
        expect(preprocessOCRPriceWraps("AMOUNT DUE £123,456\n.78")).toBe(
          "AMOUNT DUE £123,456.78"
        );
      });

      it("merges multiple thousands groups (BALANCE $1,234,567\\n.89)", () => {
        // The `(?:,\\d{3})+` quantifier accepts any number of thousands
        // groups, not just one — million-dollar totals wrap the same way.
        expect(preprocessOCRPriceWraps("BALANCE $1,234,567\n.89")).toBe(
          "BALANCE $1,234,567.89"
        );
      });

      it("tolerates whitespace and tabs around the line break", () => {
        expect(preprocessOCRPriceWraps("TOTAL $1,234  \n  .56")).toBe("TOTAL $1,234.56");
        expect(preprocessOCRPriceWraps("TOTAL $1,234\t\n\t.56")).toBe("TOTAL $1,234.56");
      });

      it("keyword match is case-insensitive", () => {
        expect(preprocessOCRPriceWraps("total $1,234\n.56")).toBe("total $1,234.56");
        expect(preprocessOCRPriceWraps("Grand Total $1,234\n.56")).toBe(
          "Grand Total $1,234.56"
        );
      });
    });

    describe("negative — false-positive guards for no-decimal pass", () => {
      it("does NOT merge when there is no total-style keyword", () => {
        // Without the keyword, `$1,234\n.56` is still ambiguous (the
        // fractional tail could be OCR garbage), so pass through untouched.
        expect(preprocessOCRPriceWraps("Item $1,234\n.56")).toBe("Item $1,234\n.56");
      });

      it("does NOT merge when the head has no thousands comma (guards against $5\\n.56)", () => {
        // A bare `$5` head could legitimately be "$5" followed by OCR
        // garbage `.56`. The thousands-grouping requirement rejects it.
        expect(preprocessOCRPriceWraps("TOTAL $5\n.56")).toBe("TOTAL $5\n.56");
        // Two-digit head, still no comma — same rejection.
        expect(preprocessOCRPriceWraps("TOTAL $42\n.56")).toBe("TOTAL $42\n.56");
      });

      it("does NOT merge when the wrapped line has leading digits before the decimal", () => {
        // `$1,234\n5.67` looks superficially like a wrap but `5.67` on its
        // own is a valid standalone price — could be a line count, not a
        // decimal tail. The regex requires `\\.\\d{1,2}` with no leading
        // integer on the wrapped line.
        expect(preprocessOCRPriceWraps("TOTAL $1,234\n5.67")).toBe("TOTAL $1,234\n5.67");
      });

      it("does NOT merge when the decimal tail is followed by another digit", () => {
        // `(?!\\d)` lookahead — protects against garbage digit runs.
        expect(preprocessOCRPriceWraps("TOTAL $1,234\n.56789")).toBe("TOTAL $1,234\n.56789");
      });

      it("does NOT merge when the keyword is on a distant line", () => {
        // 20-char lazy-fill window — a keyword three lines above can't anchor.
        const distant = "TOTAL COUNT\n\n\nItem $1,234\n.56";
        expect(preprocessOCRPriceWraps(distant)).toBe(distant);
      });

      it("does NOT merge when the keyword is far from the sigil within the same line", () => {
        // Same 20-char window applies to in-line distance. Keyword + 25 chars
        // of filler + sigil exceeds the cap → no merge.
        const longFiller = "TOTAL purchases made during the trip $1,234\n.56";
        expect(preprocessOCRPriceWraps(longFiller)).toBe(longFiller);
      });

      it("idempotence: merged output does not re-merge on a second pass", () => {
        const merged = preprocessOCRPriceWraps("TOTAL $1,234\n.56");
        expect(merged).toBe("TOTAL $1,234.56");
        // Second pass: no newline between head and tail anymore → nothing
        // to match.
        expect(preprocessOCRPriceWraps(merged)).toBe(merged);
      });
    });

    describe("pipeline integration with detectPricesInText", () => {
      it("extracts a keyword-gated no-decimal merge as a single USD price", () => {
        const found = detectPricesInText("TOTAL $1,234\n.56");
        expect(found).toContainEqual(
          expect.objectContaining({ currency: "USD", amount: 1234.56 })
        );
        expect(found.length).toBe(1);
      });

      it("leaves ungated no-decimal shapes alone", () => {
        // No TOTAL keyword — distinct prices. Ideally `$1,234` still parses
        // as USD 1234 while the `.56` is dropped as an unparseable fragment.
        const found = detectPricesInText("Cost $1,234\nMisc .56");
        expect(found.map((p) => p.amount)).toContain(1234);
      });
    });
  });
});
