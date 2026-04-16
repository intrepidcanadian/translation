/**
 * @jest-environment node
 *
 * Tests for `extractReceiptLineItems` (#222). The receipt line-item extractor
 * is the core of the Receipt Assistant feature — it binds item names to their
 * prices from noisy OCR text. A regression here silently breaks the entire
 * receipt analysis pipeline.
 *
 * Test plan:
 *   1. Single-line items: name + trailing price on one line.
 *   2. Two-line items: name on one line, price on the next.
 *   3. Header/footer skip patterns: TOTAL, TAX, etc. must NOT appear as items.
 *   4. Multi-currency receipts: singleCurrency flag and currencies array.
 *   5. Edge cases: empty input, price-only with no name, whitespace.
 *   6. Leader-dot cleanup: "ITEM ......... $5" → name "ITEM".
 *   7. Preprocessor integration: line-wrapped prices survive extraction.
 */

jest.mock("../services/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  require("./__mocks__/asyncStorage").asyncStorageMockFactory()
);

import { extractReceiptLineItems } from "../utils/receiptLineItems";

describe("extractReceiptLineItems (#222)", () => {
  describe("empty / whitespace input", () => {
    it("returns zero items for empty string", () => {
      const result = extractReceiptLineItems("");
      expect(result.items).toHaveLength(0);
      expect(result.currencies).toHaveLength(0);
      expect(result.singleCurrency).toBe(true);
      expect(result.cleanedText).toBe("");
    });

    it("returns zero items for whitespace-only input", () => {
      const result = extractReceiptLineItems("   \n  \n  ");
      expect(result.items).toHaveLength(0);
      expect(result.singleCurrency).toBe(true);
    });
  });

  describe("single-line items (name + trailing price)", () => {
    it("extracts a simple item with $ price", () => {
      const result = extractReceiptLineItems("PERFUME 50ML $89.50");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("PERFUME 50ML");
      expect(result.items[0].currency).toBe("USD");
      expect(result.items[0].amount).toBeCloseTo(89.5);
    });

    it("extracts an item with € price", () => {
      const result = extractReceiptLineItems("CHOCOLATE BOX €12.00");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("CHOCOLATE BOX");
      expect(result.items[0].currency).toBe("EUR");
      expect(result.items[0].amount).toBeCloseTo(12);
    });

    it("extracts an item with HK$ price", () => {
      const result = extractReceiptLineItems("JADE BRACELET HK$780.00");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("JADE BRACELET");
      expect(result.items[0].currency).toBe("HKD");
      expect(result.items[0].amount).toBeCloseTo(780);
    });

    it("extracts multiple items from multi-line receipt", () => {
      const receipt = [
        "COFFEE $4.50",
        "MUFFIN $3.25",
        "WATER $1.99",
      ].join("\n");
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(3);
      expect(result.items[0].name).toBe("COFFEE");
      expect(result.items[0].amount).toBeCloseTo(4.5);
      expect(result.items[1].name).toBe("MUFFIN");
      expect(result.items[1].amount).toBeCloseTo(3.25);
      expect(result.items[2].name).toBe("WATER");
      expect(result.items[2].amount).toBeCloseTo(1.99);
      expect(result.singleCurrency).toBe(true);
    });

    it("preserves document order via lineIndex", () => {
      const receipt = "ITEM A $10\n\nITEM B $20";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].lineIndex).toBeLessThan(result.items[1].lineIndex);
    });
  });

  describe("two-line items (name above, price below)", () => {
    it("binds a name line to a price-only line below it", () => {
      const receipt = "DESIGNER HANDBAG\n$450.00";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("DESIGNER HANDBAG");
      expect(result.items[0].amount).toBeCloseTo(450);
    });

    it("walks up at most 3 lines to find a name candidate", () => {
      // Name → blank → blank → price should still bind.
      const receipt = "LUXURY WATCH\n\n\n$2500.00";
      const result = extractReceiptLineItems(receipt);
      // The blank lines are skipped; the walk finds "LUXURY WATCH".
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("LUXURY WATCH");
    });

    it("drops a price-only line with no plausible name above", () => {
      // Just a price by itself — no name within 3 lines above.
      const receipt = "$99.99";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(0);
    });
  });

  describe("header/footer skip patterns", () => {
    it("skips TOTAL lines", () => {
      const receipt = "COFFEE $4.50\nTOTAL $4.50";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("COFFEE");
    });

    it("skips SUBTOTAL lines", () => {
      const receipt = "CAKE $8.00\nSubtotal $8.00";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("CAKE");
    });

    it("skips TAX lines", () => {
      const receipt = "ITEM $10.00\nTax $0.80";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("ITEM");
    });

    it("skips TIP, SERVICE CHARGE, GRAND TOTAL", () => {
      const receipt = [
        "STEAK $25.00",
        "Tip $5.00",
        "Service Charge $3.00",
        "Grand Total $33.00",
      ].join("\n");
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("STEAK");
    });

    it("skips PAYMENT and CHANGE lines", () => {
      const receipt = "BREAD $3.00\nPayment $5.00\nChange $2.00";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(1);
    });

    it("skips THANK YOU and RECEIPT header", () => {
      const receipt = "Receipt\nCOOKIE $2.00\nThank you";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("COOKIE");
    });
  });

  describe("multi-currency receipts", () => {
    it("detects multiple currencies and sets singleCurrency=false", () => {
      const receipt = "WHISKY $45.00\nCHOCOLATE €12.00";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(2);
      expect(result.singleCurrency).toBe(false);
      expect(result.currencies).toContain("USD");
      expect(result.currencies).toContain("EUR");
    });

    it("preserves first-seen currency order", () => {
      const receipt = "ITEM A €10.00\nITEM B $5.00\nITEM C €3.00";
      const result = extractReceiptLineItems(receipt);
      expect(result.currencies[0]).toBe("EUR");
      expect(result.currencies[1]).toBe("USD");
      expect(result.currencies).toHaveLength(2);
    });

    it("singleCurrency=true when all items share the same currency", () => {
      const receipt = "A $1.00\nB $2.00\nC $3.00";
      const result = extractReceiptLineItems(receipt);
      expect(result.singleCurrency).toBe(true);
      expect(result.currencies).toEqual(["USD"]);
    });
  });

  describe("leader-dot cleanup", () => {
    it("strips trailing leader dots from item names", () => {
      const receipt = "PERFUME ........ $89.50";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("PERFUME");
    });

    it("collapses internal whitespace in names", () => {
      const receipt = "LUXURY    ITEM   $50.00";
      const result = extractReceiptLineItems(receipt);
      expect(result.items[0].name).toBe("LUXURY ITEM");
    });
  });

  describe("preprocessor integration (line-wrapped prices)", () => {
    it("merges a wrapped $1,2\\n34.56 before extraction", () => {
      // Without preprocessing, "$1,2" on line 1 and "34.56" on line 2 would
      // not form a single price. The preprocessor merges them into "$1234.56".
      const receipt = "ITEM $1,2\n34.56";
      const result = extractReceiptLineItems(receipt);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].amount).toBeCloseTo(1234.56);
    });

    it("cleanedText reflects the post-preprocessing state", () => {
      const receipt = "ITEM $1,2\n34.56\nOTHER $5.00";
      const result = extractReceiptLineItems(receipt);
      expect(result.cleanedText).not.toContain("$1,2\n34.56");
      expect(result.cleanedText).toContain("$1234.56");
    });
  });

  describe("raw price string preservation", () => {
    it("preserves the raw price match for debug/UI purposes", () => {
      const result = extractReceiptLineItems("WINE $24.99");
      expect(result.items[0].raw).toContain("24.99");
    });
  });
});
