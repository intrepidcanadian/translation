// Smart product analysis service — uses Apple Neural Engine for on-device ecommerce intelligence
// Runs entirely offline: NER, language detection, entity extraction, price detection, document analysis
// Falls back gracefully to regex-based extraction on Android or older iOS

import { Platform } from "react-native";
import { logger } from "./logger";

export interface ProductEntities {
  brands: string[];       // Organization names likely to be brands
  people: string[];       // Person names (useful for author/designer extraction)
  places: string[];       // Place names (origin, manufacturing location)
  prices: string[];       // Detected monetary amounts
  dates: string[];        // Expiry dates, manufacture dates
  phones: string[];       // Contact numbers on packaging
  urls: string[];         // Website URLs on packaging
  specs: string[];        // Extracted specs (weight, dimensions, model numbers)
  detectedLanguage: string | null;
}

export interface SmartListingInsights {
  suggestedBrand: string | null;
  suggestedModel: string | null;
  suggestedCategory: string | null;
  detectedPrices: string[];
  keySpecs: Array<{ label: string; value: string }>;
  detectedLanguage: string | null;
  confidence: number;  // 0-1 how much we trust the extraction
}

// Known brand names mapped to their canonical form (handles OCR casing issues)
const KNOWN_BRANDS_MAP: Record<string, string> = {
  apple: "Apple", samsung: "Samsung", sony: "Sony", lg: "LG", nike: "Nike",
  adidas: "Adidas", puma: "Puma", canon: "Canon", nikon: "Nikon", dell: "Dell",
  hp: "HP", lenovo: "Lenovo", asus: "ASUS", acer: "Acer", microsoft: "Microsoft",
  google: "Google", bose: "Bose", jbl: "JBL", nintendo: "Nintendo", dyson: "Dyson",
  kitchenaid: "KitchenAid", cuisinart: "Cuisinart", bosch: "Bosch", makita: "Makita",
  dewalt: "DeWalt", ikea: "IKEA", panasonic: "Panasonic", philips: "Philips",
  logitech: "Logitech", razer: "Razer", corsair: "Corsair", anker: "Anker",
  belkin: "Belkin", otterbox: "OtterBox", "under armour": "Under Armour",
  columbia: "Columbia", "north face": "The North Face", patagonia: "Patagonia",
  yeti: "Yeti", "hydro flask": "Hydro Flask", "instant pot": "Instant Pot",
  ninja: "Ninja", gucci: "Gucci", prada: "Prada", zara: "Zara", uniqlo: "Uniqlo",
  muji: "MUJI", xiaomi: "Xiaomi", huawei: "Huawei", oppo: "OPPO", vivo: "vivo",
  oneplus: "OnePlus", realme: "realme", "hong kong": "Hong Kong",
  rolex: "Rolex", omega: "Omega", seiko: "Seiko", casio: "Casio",
  shiseido: "Shiseido", "sk-ii": "SK-II", lancôme: "Lancôme", estée: "Estée Lauder",
  chanel: "Chanel", dior: "Dior", hermès: "Hermès", "louis vuitton": "Louis Vuitton",
  coach: "Coach", "michael kors": "Michael Kors", tiffany: "Tiffany & Co.",
  swarovski: "Swarovski",
};

// Spec-like patterns: dimensions, weights, capacities, etc.
const SPEC_PATTERNS = [
  { label: "Weight", pattern: /\b(\d+(?:\.\d+)?\s*(?:kg|g|lb|lbs|oz|mg))\b/gi },
  { label: "Volume", pattern: /\b(\d+(?:\.\d+)?\s*(?:ml|mL|L|l|fl\s*oz|gal))\b/gi },
  { label: "Dimensions", pattern: /\b(\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|m|in|inches|ft)?)\b/gi },
  { label: "Storage", pattern: /\b(\d+\s*(?:TB|GB|MB|tb|gb|mb))\b/gi },
  { label: "Display", pattern: /\b(\d+(?:\.\d+)?[""]\s*(?:inch|display|screen|retina|oled|lcd|amoled)?)\b/gi },
  { label: "Resolution", pattern: /\b(\d{3,4}\s*[x×]\s*\d{3,4})\b/gi },
  { label: "Battery", pattern: /\b(\d+\s*(?:mAh|Wh|wh))\b/gi },
  { label: "Power", pattern: /\b(\d+\s*(?:W|watt|watts))\b/gi },
  { label: "Processor", pattern: /\b((?:A\d{1,2}|M\d|Snapdragon\s*\d+|Exynos\s*\d+|i[3579]-\d+|Ryzen\s*\d)\w*)\b/gi },
  { label: "Color", pattern: /\b((?:midnight|starlight|silver|gold|rose gold|space gray|space grey|black|white|red|blue|green|purple|pink|graphite|sierra blue|alpine green|deep purple|product red))\b/gi },
  { label: "Model", pattern: /\b([A-Z]{1,5}[-\s]?\d{2,6}[A-Z]{0,3})\b/g },
  { label: "Voltage", pattern: /\b(\d+\s*(?:V|v|volt|volts))\b/gi },
];

// Money pattern (mirrors the one in AppleTranslationModule.swift)
const MONEY_PATTERN = /(?:[$€£¥₹₩฿¢])\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:dollars?|euros?|pounds?|yen|yuan|won|USD|EUR|GBP|JPY|CNY|KRW|HKD|TWD|THB)/gi;

/**
 * Extract product entities using Apple Neural Engine (on-device NER + document analysis)
 * Falls back to regex-only extraction on Android or when Neural Engine is unavailable
 */
export async function analyzeProductText(ocrText: string): Promise<ProductEntities> {
  const result: ProductEntities = {
    brands: [],
    people: [],
    places: [],
    prices: [],
    dates: [],
    phones: [],
    urls: [],
    specs: [],
    detectedLanguage: null,
  };

  if (!ocrText.trim()) return result;

  // Always run regex-based extraction (works on all platforms)
  extractSpecsFromText(ocrText, result);
  extractPricesFromText(ocrText, result);

  // Try Apple Neural Engine for richer extraction
  if (Platform.OS === "ios") {
    try {
      const AppleTranslation = await import("../../modules/apple-translation");
      const available = await AppleTranslation.isAvailable();

      if (available) {
        // Run NER and document analysis in parallel
        const [entities, analysis] = await Promise.all([
          AppleTranslation.extractEntities(ocrText),
          AppleTranslation.analyzeDocument(ocrText),
        ]);

        // NER results — organizations are likely brands
        result.brands = entities.organizations;
        result.people = entities.persons;
        result.places = entities.places;

        // Document analysis — structured data
        if (analysis.detectedLanguage) result.detectedLanguage = analysis.detectedLanguage;
        if (analysis.dates.length) result.dates = analysis.dates;
        if (analysis.phoneNumbers.length) result.phones = analysis.phoneNumbers;
        if (analysis.urls.length) result.urls = analysis.urls;
        if (analysis.moneyAmounts.length) {
          // Merge with regex-detected prices, deduplicate
          const allPrices = [...new Set([...result.prices, ...analysis.moneyAmounts])];
          result.prices = allPrices;
        }
      }
    } catch (err) {
      logger.warn("Product", "Neural Engine analysis failed, using regex fallback", err);
    }
  }

  // If Neural Engine didn't find brands, try regex-based brand matching
  if (result.brands.length === 0) {
    result.brands = extractBrandsFromText(ocrText);
  }

  return result;
}

/**
 * Generate smart listing insights from product entities + OCR text
 * Combines Neural Engine NER with heuristic rules for best results
 */
export function generateInsights(
  ocrText: string,
  entities: ProductEntities,
): SmartListingInsights {
  let confidence = 0;

  // --- Brand detection ---
  let suggestedBrand: string | null = null;

  // First: check NER-detected organizations against known brands
  for (const org of entities.brands) {
    const normalized = org.toLowerCase().trim();
    if (KNOWN_BRANDS_MAP[normalized]) {
      suggestedBrand = KNOWN_BRANDS_MAP[normalized];
      confidence += 0.3;
      break;
    }
  }

  // Second: fallback to text scanning
  if (!suggestedBrand) {
    const textBrands = extractBrandsFromText(ocrText);
    if (textBrands.length > 0) {
      suggestedBrand = textBrands[0];
      confidence += 0.2;
    }
  }

  // --- Model detection ---
  let suggestedModel: string | null = null;
  const modelSpecs = entities.specs.filter((s) => s.startsWith("Model:"));
  if (modelSpecs.length > 0) {
    suggestedModel = modelSpecs[0].replace("Model: ", "");
    confidence += 0.2;
  } else {
    // Fallback: look for alphanumeric model patterns
    const modelMatch = ocrText.match(/\b[A-Z]{1,5}[-\s]?\d{2,6}[A-Z]{0,3}\b/);
    if (modelMatch) {
      suggestedModel = modelMatch[0];
      confidence += 0.1;
    }
  }

  // --- Category detection ---
  const suggestedCategory = detectCategoryFromEntities(ocrText, entities);
  if (suggestedCategory !== "other") confidence += 0.2;

  // --- Key specs (non-model, non-price) ---
  const keySpecs: Array<{ label: string; value: string }> = [];
  for (const spec of entities.specs) {
    const [label, ...rest] = spec.split(": ");
    const value = rest.join(": ");
    if (label && value && label !== "Model") {
      // Avoid duplicates
      if (!keySpecs.some((s) => s.label === label && s.value === value)) {
        keySpecs.push({ label, value });
      }
    }
  }

  // Add detected language as a spec if not English
  if (entities.detectedLanguage && entities.detectedLanguage !== "en") {
    const langNames: Record<string, string> = {
      zh: "Chinese", ja: "Japanese", ko: "Korean", fr: "French", de: "German",
      es: "Spanish", it: "Italian", pt: "Portuguese", ar: "Arabic", th: "Thai",
      vi: "Vietnamese", ru: "Russian", "zh-Hans": "Chinese (Simplified)",
      "zh-Hant": "Chinese (Traditional)",
    };
    const langName = langNames[entities.detectedLanguage] ?? entities.detectedLanguage;
    keySpecs.push({ label: "Text Language", value: langName });
  }

  // Bonus confidence for having rich data
  if (entities.prices.length > 0) confidence += 0.1;
  if (keySpecs.length >= 3) confidence += 0.1;

  return {
    suggestedBrand,
    suggestedModel,
    suggestedCategory,
    detectedPrices: entities.prices,
    keySpecs: keySpecs.slice(0, 8), // Cap at 8 specs
    detectedLanguage: entities.detectedLanguage,
    confidence: Math.min(confidence, 1.0),
  };
}

// --- Extraction helpers (exported for unit testing) ---

export function extractBrandsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [key, canonical] of Object.entries(KNOWN_BRANDS_MAP)) {
    if (lower.includes(key)) {
      found.push(canonical);
    }
  }
  // Deduplicate and return max 3
  return [...new Set(found)].slice(0, 3);
}

export function extractSpecsFromText(text: string, result: ProductEntities): void {
  for (const { label, pattern } of SPEC_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[1]?.trim();
      if (value) {
        const specStr = `${label}: ${value}`;
        if (!result.specs.includes(specStr)) {
          result.specs.push(specStr);
        }
      }
    }
  }
}

export function extractPricesFromText(text: string, result: ProductEntities): void {
  MONEY_PATTERN.lastIndex = 0;
  let match;
  while ((match = MONEY_PATTERN.exec(text)) !== null) {
    const price = match[0]?.trim();
    if (price && !result.prices.includes(price)) {
      result.prices.push(price);
    }
  }
}

export function detectCategoryFromEntities(text: string, entities: ProductEntities): string {
  const lower = text.toLowerCase();
  const allText = [lower, ...entities.specs.map((s) => s.toLowerCase())].join(" ");

  // Score each category based on spec types + keywords
  const scores: Record<string, number> = {
    electronics: 0, clothing: 0, furniture: 0, books: 0,
    toys: 0, sports: 0, home: 0, auto: 0, beauty: 0, food: 0, other: 0,
  };

  // Electronics signals
  if (allText.match(/\b(storage|battery|processor|resolution|display|mah|wh|gb|tb|amoled|oled|lcd|bluetooth|wifi|usb|hdmi|ram|ssd)\b/)) scores.electronics += 3;
  if (allText.match(/\b(iphone|samsung|laptop|macbook|ipad|airpods|headphone|speaker|tv|monitor|camera|pixel|galaxy|charger)\b/)) scores.electronics += 3;

  // Clothing signals
  if (allText.match(/\b(size\s*[smlx]{1,3}|shirt|pants|dress|jacket|shoes|boots|sneakers|jeans|cotton|polyester|wool|silk|linen)\b/)) scores.clothing += 3;
  if (allText.match(/\b(nike|adidas|zara|h&m|uniqlo|gucci|prada|levi)\b/)) scores.clothing += 2;

  // Beauty/cosmetics (important for duty-free)
  if (allText.match(/\b(skin|cream|serum|moisturizer|sunscreen|spf|lipstick|mascara|foundation|concealer|perfume|fragrance|cologne|eau de|shampoo|conditioner)\b/)) scores.beauty += 3;
  if (allText.match(/\b(shiseido|sk-ii|lancôme|estée|chanel|dior|clinique|mac|nars|fenty)\b/)) scores.beauty += 2;

  // Food/drink (important for duty-free)
  if (allText.match(/\b(ingredients|nutrition|calories|protein|carb|fat|sugar|sodium|serving|allergen|contains|may contain)\b/)) scores.food += 3;
  if (allText.match(/\b(chocolate|whisky|whiskey|wine|vodka|gin|rum|champagne|cognac|sake|tea|coffee)\b/)) scores.food += 2;

  // Furniture
  if (allText.match(/\b(chair|table|desk|sofa|couch|bed|mattress|shelf|bookcase|cabinet)\b/)) scores.furniture += 3;

  // Books
  if (allText.match(/\b(isbn|author|chapter|edition|paperback|hardcover|volume|publisher|copyright)\b/)) scores.books += 3;

  // Find highest scoring category
  let best = "other";
  let bestScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }

  return bestScore >= 2 ? best : "other";
}
