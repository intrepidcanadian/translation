jest.mock("@react-native-async-storage/async-storage", () =>
  require("./__mocks__/asyncStorage").asyncStorageMockFactory()
);

import {
  answerWithRules,
  type ReceiptQuestion,
} from "../services/receiptAssistantRules";
import type { ExchangeRates } from "../services/currencyExchange";
import type { ReceiptExtraction, ReceiptLineItem } from "../utils/receiptLineItems";

let lineIdx = 0;
function makeItem(name: string, amount: number, currency = "USD"): ReceiptLineItem {
  return { name, amount, currency, raw: `${currency} ${amount}`, lineIndex: lineIdx++ };
}

function makeExtraction(items: ReceiptLineItem[]): ReceiptExtraction {
  const currencies = [...new Set(items.map((i) => i.currency))];
  return { items, currencies, singleCurrency: currencies.length <= 1, cleanedText: "" };
}

const RATES: ExchangeRates = {
  base: "USD",
  rates: { USD: 1, EUR: 0.85, GBP: 0.73, JPY: 150, CAD: 1.36 },
  timestamp: Date.now(),
};

describe("answerWithRules", () => {
  describe("empty items", () => {
    it("returns 'no items' for any question kind", async () => {
      const extraction = makeExtraction([]);
      const answer = await answerWithRules(extraction, { kind: "cheapest" }, RATES);
      expect(answer).not.toBeNull();
      expect(answer!.text).toMatch(/no priced items/i);
      expect(answer!.highlightItems).toHaveLength(0);
      expect(answer!.source).toBe("rules");
    });
  });

  describe("cheapest", () => {
    it("finds the cheapest item in a single-currency receipt", async () => {
      const items = [makeItem("Coffee", 4.5), makeItem("Sandwich", 8.0), makeItem("Water", 1.5)];
      const answer = await answerWithRules(makeExtraction(items), { kind: "cheapest" }, RATES);
      expect(answer!.text).toMatch(/Water/);
      expect(answer!.highlightItems).toHaveLength(1);
      expect(answer!.highlightItems[0].name).toBe("Water");
    });

    it("normalizes to USD when comparing mixed currencies", async () => {
      const items = [
        makeItem("Wine", 10, "EUR"),
        makeItem("Beer", 5, "USD"),
      ];
      const answer = await answerWithRules(makeExtraction(items), { kind: "cheapest" }, RATES);
      expect(answer!.text).toMatch(/Beer/);
    });

    it("falls back to raw amount when rate is missing and notes it", async () => {
      const items = [
        makeItem("Item A", 100, "XYZ"),
        makeItem("Item B", 200, "XYZ"),
      ];
      const answer = await answerWithRules(makeExtraction(items), { kind: "cheapest" }, RATES);
      expect(answer!.text).toMatch(/Item A/);
      expect(answer!.text).toMatch(/currency rate unavailable/i);
    });
  });

  describe("mostExpensive", () => {
    it("finds the most expensive item", async () => {
      const items = [makeItem("Appetizer", 12), makeItem("Steak", 45), makeItem("Dessert", 9)];
      const answer = await answerWithRules(makeExtraction(items), { kind: "mostExpensive" }, RATES);
      expect(answer!.text).toMatch(/Steak/);
      expect(answer!.highlightItems[0].name).toBe("Steak");
    });

    it("normalizes across currencies", async () => {
      const items = [
        makeItem("Cheap JPY item", 500, "JPY"),
        makeItem("Expensive USD item", 50, "USD"),
      ];
      const answer = await answerWithRules(makeExtraction(items), { kind: "mostExpensive" }, RATES);
      expect(answer!.text).toMatch(/Expensive USD item/);
    });
  });

  describe("count", () => {
    it("returns correct count for multiple items", async () => {
      const items = [makeItem("A", 1), makeItem("B", 2), makeItem("C", 3)];
      const answer = await answerWithRules(makeExtraction(items), { kind: "count" }, RATES);
      expect(answer!.text).toBe("3 priced items.");
      expect(answer!.highlightItems).toHaveLength(3);
    });

    it("uses singular for single item", async () => {
      const items = [makeItem("Solo", 10)];
      const answer = await answerWithRules(makeExtraction(items), { kind: "count" }, RATES);
      expect(answer!.text).toBe("1 priced item.");
    });
  });

  describe("totalInCurrency", () => {
    it("converts and sums all items to target currency", async () => {
      const items = [makeItem("A", 10, "USD"), makeItem("B", 20, "USD")];
      const question: ReceiptQuestion = { kind: "totalInCurrency", targetCurrency: "EUR" };
      const answer = await answerWithRules(makeExtraction(items), question, RATES);
      expect(answer!.text).toMatch(/Total/);
      expect(answer!.text).toMatch(/€/);
      expect(answer!.text).toMatch(/2 items/);
    });

    it("returns null when targetCurrency is missing", async () => {
      const items = [makeItem("A", 10)];
      const question: ReceiptQuestion = { kind: "totalInCurrency" };
      const answer = await answerWithRules(makeExtraction(items), question, RATES);
      expect(answer).toBeNull();
    });

    it("reports skipped items with missing rates", async () => {
      const items = [makeItem("A", 10, "USD"), makeItem("B", 20, "XYZ")];
      const question: ReceiptQuestion = { kind: "totalInCurrency", targetCurrency: "EUR" };
      const answer = await answerWithRules(makeExtraction(items), question, RATES);
      expect(answer!.text).toMatch(/1 item skipped/i);
      expect(answer!.text).toMatch(/XYZ/);
    });

    it("converts same-currency items without rate lookup", async () => {
      const items = [makeItem("A", 10, "EUR"), makeItem("B", 5, "EUR")];
      const question: ReceiptQuestion = { kind: "totalInCurrency", targetCurrency: "EUR" };
      const answer = await answerWithRules(makeExtraction(items), question, RATES);
      expect(answer!.text).toMatch(/€15/);
    });
  });

  describe("custom", () => {
    it("returns null for custom questions (LLM fallback)", async () => {
      const items = [makeItem("A", 10)];
      const question: ReceiptQuestion = { kind: "custom", rawText: "why is tax so high?" };
      const answer = await answerWithRules(makeExtraction(items), question, RATES);
      expect(answer).toBeNull();
    });
  });

  describe("answer metadata", () => {
    it("echoes the question back in the answer", async () => {
      const question: ReceiptQuestion = { kind: "count" };
      const answer = await answerWithRules(makeExtraction([makeItem("A", 1)]), question, RATES);
      expect(answer!.question).toBe(question);
    });

    it("always reports source as rules", async () => {
      const items = [makeItem("A", 1)];
      for (const kind of ["cheapest", "mostExpensive", "count"] as const) {
        const answer = await answerWithRules(makeExtraction(items), { kind }, RATES);
        expect(answer!.source).toBe("rules");
      }
    });
  });
});
