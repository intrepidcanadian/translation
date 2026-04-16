/**
 * Unit tests for `services/smartProductAnalysis.ts`.
 *
 * Why pin this:
 *  - The smart product analysis powers the listing generator and product
 *    scanner. On Android (and iOS when Neural Engine is unavailable),
 *    ALL entity extraction is regex-based — these functions ARE the
 *    product analysis pipeline. A broken spec regex silently drops
 *    product attributes from listings, and a broken brand regex means
 *    the listing generator can't auto-populate the brand field.
 *  - `generateInsights` is the main entry point for the listing
 *    generator's smart path. Its confidence scoring drives UI decisions
 *    (show/hide the "Smart analysis" badge). A regression in the
 *    scoring weights could silently change which listings get the badge.
 *  - `detectCategoryFromEntities` maps keyword signals to category
 *    labels used by the listing template system. A miscategorized
 *    product gets the wrong description template.
 */

import {
  extractBrandsFromText,
  extractSpecsFromText,
  extractPricesFromText,
  detectCategoryFromEntities,
  generateInsights,
  type ProductEntities,
} from "../services/smartProductAnalysis";

function emptyEntities(): ProductEntities {
  return {
    brands: [], people: [], places: [], prices: [],
    dates: [], phones: [], urls: [], specs: [],
    detectedLanguage: null,
  };
}

describe("smartProductAnalysis", () => {
  describe("extractBrandsFromText", () => {
    it("finds a known brand by exact lowercase match", () => {
      expect(extractBrandsFromText("New Apple iPhone 15 Pro")).toContain("Apple");
    });

    it("finds brands case-insensitively (text is lowercased internally)", () => {
      expect(extractBrandsFromText("SAMSUNG Galaxy S24")).toContain("Samsung");
    });

    it("returns the canonical form regardless of input casing", () => {
      const result = extractBrandsFromText("bought a new DYSON vacuum");
      expect(result).toContain("Dyson");
    });

    it("finds multiple brands and deduplicates", () => {
      const result = extractBrandsFromText("Apple case for Samsung phone with Anker charger");
      expect(result).toContain("Apple");
      expect(result).toContain("Samsung");
      expect(result).toContain("Anker");
    });

    it("caps results at 3 brands", () => {
      const text = "Apple Samsung Sony LG Nike Adidas Puma Canon";
      const result = extractBrandsFromText(text);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns empty array when no known brands are found", () => {
      expect(extractBrandsFromText("generic unknown product")).toEqual([]);
    });

    it("returns empty array for empty input", () => {
      expect(extractBrandsFromText("")).toEqual([]);
    });

    it("matches multi-word brands like 'under armour'", () => {
      expect(extractBrandsFromText("Under Armour running shoes")).toContain("Under Armour");
    });

    it("matches 'north face' as 'The North Face'", () => {
      expect(extractBrandsFromText("north face jacket")).toContain("The North Face");
    });
  });

  describe("extractSpecsFromText", () => {
    it("extracts weight specs", () => {
      const result = emptyEntities();
      extractSpecsFromText("Net weight: 250g", result);
      expect(result.specs).toContainEqual(expect.stringContaining("Weight:"));
      expect(result.specs.join(" ")).toContain("250g");
    });

    it("extracts storage specs", () => {
      const result = emptyEntities();
      extractSpecsFromText("Storage: 512 GB SSD", result);
      expect(result.specs.some(s => s.includes("Storage") && s.includes("512 GB"))).toBe(true);
    });

    it("extracts battery specs", () => {
      const result = emptyEntities();
      extractSpecsFromText("Battery: 5000 mAh fast charge", result);
      expect(result.specs.some(s => s.includes("Battery") && s.includes("5000 mAh"))).toBe(true);
    });

    it("extracts dimension specs", () => {
      const result = emptyEntities();
      extractSpecsFromText("Dimensions: 150 x 73 x 8mm", result);
      expect(result.specs.some(s => s.includes("Dimensions"))).toBe(true);
    });

    it("extracts color specs", () => {
      const result = emptyEntities();
      extractSpecsFromText("Color: Midnight Black", result);
      // The regex captures original casing — match case-insensitively
      expect(result.specs.some(s => s.includes("Color") && /midnight/i.test(s))).toBe(true);
    });

    it("extracts model number specs", () => {
      const result = emptyEntities();
      extractSpecsFromText("Model: A2442 MacBook Pro", result);
      expect(result.specs.some(s => s.includes("Model") && s.includes("A2442"))).toBe(true);
    });

    it("deduplicates identical specs", () => {
      const result = emptyEntities();
      extractSpecsFromText("Weight 500g and weight 500g repeated", result);
      const weightSpecs = result.specs.filter(s => s.includes("500g"));
      expect(weightSpecs.length).toBe(1);
    });

    it("extracts multiple different spec types from one text", () => {
      const result = emptyEntities();
      extractSpecsFromText("iPhone 15 Pro: 256 GB storage, 3274 mAh battery, 6.1\" display", result);
      expect(result.specs.length).toBeGreaterThanOrEqual(2);
    });

    it("handles empty text gracefully", () => {
      const result = emptyEntities();
      extractSpecsFromText("", result);
      expect(result.specs).toEqual([]);
    });
  });

  describe("extractPricesFromText", () => {
    it("extracts dollar prices", () => {
      const result = emptyEntities();
      extractPricesFromText("Price: $29.99 on sale", result);
      expect(result.prices).toContain("$29.99");
    });

    it("extracts euro prices", () => {
      const result = emptyEntities();
      extractPricesFromText("€49.00 shipping included", result);
      expect(result.prices).toContain("€49.00");
    });

    it("extracts prices with trailing currency words", () => {
      const result = emptyEntities();
      extractPricesFromText("Only 999 dollars for this item", result);
      expect(result.prices.length).toBe(1);
      expect(result.prices[0]).toContain("999");
    });

    it("extracts multiple prices", () => {
      const result = emptyEntities();
      extractPricesFromText("Was $99.99, now $79.99", result);
      expect(result.prices).toContain("$99.99");
      expect(result.prices).toContain("$79.99");
    });

    it("deduplicates identical prices", () => {
      const result = emptyEntities();
      extractPricesFromText("$50 and $50 again", result);
      const fifties = result.prices.filter(p => p.includes("50"));
      expect(fifties.length).toBe(1);
    });

    it("handles text with no prices", () => {
      const result = emptyEntities();
      extractPricesFromText("No price information here", result);
      expect(result.prices).toEqual([]);
    });
  });

  describe("detectCategoryFromEntities", () => {
    it("detects electronics from spec keywords", () => {
      const ent = emptyEntities();
      ent.specs = ["Storage: 512 GB", "Battery: 5000 mAh"];
      expect(detectCategoryFromEntities("Samsung Galaxy phone with bluetooth", ent)).toBe("electronics");
    });

    it("detects clothing from apparel keywords", () => {
      const ent = emptyEntities();
      expect(detectCategoryFromEntities("Cotton shirt size M blue jeans", ent)).toBe("clothing");
    });

    it("detects books from publishing keywords", () => {
      const ent = emptyEntities();
      expect(detectCategoryFromEntities("ISBN 978-0-123456-78-9 First Edition Paperback", ent)).toBe("books");
    });

    it("detects furniture from furniture keywords", () => {
      const ent = emptyEntities();
      expect(detectCategoryFromEntities("Oak desk with adjustable chair", ent)).toBe("furniture");
    });

    it('returns "other" when no category scores high enough', () => {
      const ent = emptyEntities();
      expect(detectCategoryFromEntities("random miscellaneous item", ent)).toBe("other");
    });

    it('routes beauty/cosmetics to "beauty" category', () => {
      const ent = emptyEntities();
      const result = detectCategoryFromEntities("Shiseido moisturizer cream SPF 50 skincare serum", ent);
      expect(result).toBe("beauty");
    });

    it('routes food/drink to "food" category', () => {
      const ent = emptyEntities();
      const result = detectCategoryFromEntities("Ingredients: sugar, flour. Nutrition: 200 calories protein", ent);
      expect(result).toBe("food");
    });

    it("uses specs in scoring alongside text", () => {
      const ent = emptyEntities();
      ent.specs = ["Resolution: 3840 x 2160", "Display: 55\" OLED"];
      // The specs carry electronics keywords that boost the score
      expect(detectCategoryFromEntities("Flat panel television", ent)).toBe("electronics");
    });
  });

  describe("generateInsights", () => {
    it("detects brand from NER entities", () => {
      const ent = emptyEntities();
      ent.brands = ["Apple"];
      const insights = generateInsights("Apple iPhone 15 Pro", ent);
      expect(insights.suggestedBrand).toBe("Apple");
      expect(insights.confidence).toBeGreaterThan(0);
    });

    it("falls back to text-based brand detection when NER is empty", () => {
      const ent = emptyEntities();
      // No brands from NER, but text contains a known brand
      const insights = generateInsights("New Samsung Galaxy S24 Ultra", ent);
      expect(insights.suggestedBrand).toBe("Samsung");
    });

    it("detects model numbers from specs", () => {
      const ent = emptyEntities();
      ent.specs = ["Model: A2442"];
      const insights = generateInsights("MacBook Pro A2442", ent);
      expect(insights.suggestedModel).toBe("A2442");
    });

    it("falls back to regex model detection when specs lack Model label", () => {
      const ent = emptyEntities();
      const insights = generateInsights("Product code: RT-AX88U router", ent);
      expect(insights.suggestedModel).not.toBeNull();
    });

    it("detects category and adds confidence", () => {
      const ent = emptyEntities();
      ent.specs = ["Storage: 256 GB", "Battery: 4000 mAh"];
      const insights = generateInsights("Smartphone with bluetooth and wifi", ent);
      expect(insights.suggestedCategory).toBe("electronics");
      expect(insights.confidence).toBeGreaterThan(0);
    });

    it("includes detected prices from entities", () => {
      const ent = emptyEntities();
      ent.prices = ["$299.99", "€249.00"];
      const insights = generateInsights("Product for sale", ent);
      expect(insights.detectedPrices).toEqual(["$299.99", "€249.00"]);
    });

    it("caps key specs at 8", () => {
      const ent = emptyEntities();
      ent.specs = Array.from({ length: 12 }, (_, i) => `Spec${i}: Value${i}`);
      const insights = generateInsights("Many specs product", ent);
      expect(insights.keySpecs.length).toBeLessThanOrEqual(8);
    });

    it("excludes Model specs from keySpecs", () => {
      const ent = emptyEntities();
      ent.specs = ["Model: A2442", "Weight: 1.4 kg", "Storage: 512 GB"];
      const insights = generateInsights("MacBook Pro", ent);
      expect(insights.keySpecs.some(s => s.label === "Model")).toBe(false);
      expect(insights.keySpecs.some(s => s.label === "Weight")).toBe(true);
    });

    it("adds detected language as a spec when non-English", () => {
      const ent = emptyEntities();
      ent.detectedLanguage = "ja";
      const insights = generateInsights("日本語テキスト", ent);
      expect(insights.keySpecs.some(s => s.label === "Text Language" && s.value === "Japanese")).toBe(true);
      expect(insights.detectedLanguage).toBe("ja");
    });

    it("does not add English as a language spec", () => {
      const ent = emptyEntities();
      ent.detectedLanguage = "en";
      const insights = generateInsights("English text", ent);
      expect(insights.keySpecs.some(s => s.label === "Text Language")).toBe(false);
    });

    it("confidence is capped at 1.0", () => {
      const ent = emptyEntities();
      ent.brands = ["Apple"];
      ent.prices = ["$999"];
      ent.specs = ["Storage: 1 TB", "Battery: 5000 mAh", "Display: 6.7\""];
      const insights = generateInsights("Apple iPhone 15 Pro Max with bluetooth and wifi SSD", ent);
      expect(insights.confidence).toBeLessThanOrEqual(1.0);
    });

    it("returns zero confidence for empty input", () => {
      const ent = emptyEntities();
      const insights = generateInsights("", ent);
      expect(insights.confidence).toBe(0);
      expect(insights.suggestedBrand).toBeNull();
      expect(insights.suggestedModel).toBeNull();
    });
  });
});
