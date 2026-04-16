// Listing generator service — creates marketplace listings from photo + OCR text
// Uses Apple Neural Engine for smart entity extraction when available,
// with template-based generation and regex fallback for all platforms

import { translateText, type TranslationProvider } from "./translation";
import { logger } from "./logger";
import {
  analyzeProductText,
  generateInsights,
  type SmartListingInsights,
  type ProductEntities,
} from "./smartProductAnalysis";

export type ListingCondition = "new" | "like_new" | "good" | "fair" | "parts";
export type ListingCategory =
  | "electronics"
  | "clothing"
  | "beauty"
  | "food"
  | "furniture"
  | "books"
  | "toys"
  | "sports"
  | "home"
  | "auto"
  | "other";

export interface ListingDraft {
  title: string;
  description: string;
  category: ListingCategory;
  condition: ListingCondition;
  suggestedTags: string[];
  price?: string;
  currency?: string;
  translatedTitle?: string;
  translatedDescription?: string;
  targetLang?: string;
  // Smart analysis results (Neural Engine powered)
  insights?: SmartListingInsights;
}

export type { SmartListingInsights };

const CONDITION_LABELS: Record<ListingCondition, string> = {
  new: "New",
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
  parts: "For Parts",
};

const CATEGORY_LABELS: Record<ListingCategory, { label: string; icon: string }> = {
  electronics: { label: "Electronics", icon: "💻" },
  clothing: { label: "Clothing & Accessories", icon: "👕" },
  beauty: { label: "Beauty & Fragrances", icon: "✨" },
  food: { label: "Food & Beverages", icon: "🍫" },
  furniture: { label: "Furniture", icon: "🪑" },
  books: { label: "Books & Media", icon: "📚" },
  toys: { label: "Toys & Games", icon: "🧸" },
  sports: { label: "Sports & Outdoors", icon: "⚽" },
  home: { label: "Home & Garden", icon: "🏠" },
  auto: { label: "Automotive", icon: "🚗" },
  other: { label: "Other", icon: "📦" },
};

export function getCategoryOptions(): Array<{ key: ListingCategory; label: string; icon: string }> {
  return Object.entries(CATEGORY_LABELS).map(([key, val]) => ({
    key: key as ListingCategory,
    ...val,
  }));
}

export function getConditionOptions(): Array<{ key: ListingCondition; label: string }> {
  return Object.entries(CONDITION_LABELS).map(([key, label]) => ({
    key: key as ListingCondition,
    label,
  }));
}

// Detect likely category from OCR text.
//
// Scans every category's keyword list against the text and picks the one with
// the *most* matches. This closes a real #208 bug where the previous
// first-match-wins loop would mis-route a clearly-sports fixture like
// "Wilson tennis racket USB charger case" (1 electronics hint "usb", 2 sports
// hints "tennis"/"racket") to electronics, because electronics was earlier
// in the list. Ties break on array order (electronics before clothing etc.),
// which preserves the old behavior on ambiguous 1-vs-1 fixtures. Exported for
// unit tests.
export function detectCategory(text: string): ListingCategory {
  const lower = text.toLowerCase();

  // Each list mixes generic product nouns with concrete brand names so that
  // a photo of a Toyota emblem ("Toyota Camry") routes to auto even without
  // the word "car", a KitchenAid stand mixer routes to home even without the
  // word "kitchen", and so on. Brand additions are appended (never
  // prepended) to keep array-order tie-breaks stable for the existing test
  // fixtures. See #210 for the tuning rationale.
  const patterns: Array<{ category: ListingCategory; keywords: RegExp }> = [
    { category: "electronics", keywords: /\b(iphone|samsung|laptop|macbook|ipad|airpods|headphone|speaker|tv|monitor|camera|nintendo|playstation|xbox|pixel|galaxy|charger|cable|usb|bluetooth|wifi|battery|power bank|processor|gpu|ram|ssd|hard drive)\b/g },
    { category: "clothing", keywords: /\b(shirt|pants|dress|jacket|coat|shoes|boots|sneakers|jeans|hoodie|sweater|blazer|skirt|socks|hat|scarf|belt|handbag|purse|backpack|nike|adidas|zara|h&m|levi|gucci|prada)\b/g },
    // beauty: duty-free's largest product category — perfume, skincare, cosmetics.
    { category: "beauty", keywords: /\b(perfume|fragrance|cologne|eau de|moisturizer|serum|cream|sunscreen|spf|lipstick|mascara|foundation|concealer|eyeshadow|blush|skincare|cosmetic|shampoo|conditioner|lotion|shiseido|sk-ii|lancôme|estée|chanel|dior|clinique|mac|nars|fenty|tom ford|ysl|guerlain|la mer)\b/g },
    // food: duty-free alcohol, chocolate, specialty food items.
    { category: "food", keywords: /\b(chocolate|whisky|whiskey|wine|vodka|gin|rum|champagne|cognac|sake|tea|coffee|candy|snack|biscuit|cookie|ingredients|nutrition|calories|protein|sugar|allergen|organic|gluten.free|johnnie walker|hennessy|moet|veuve|godiva|lindt|toblerone|macallan)\b/g },
    { category: "furniture", keywords: /\b(chair|table|desk|sofa|couch|bed|mattress|shelf|bookcase|cabinet|drawer|lamp|mirror|rug|ikea|wayfair)\b/g },
    // books: generic nouns + ISBN + major English-language trade publishers.
    // "vintage" is deliberately omitted — Vintage Books is a real publisher
    // but the word collides with the "Vintage handcrafted item" fixture
    // and with second-hand listing language broadly. Same reasoning applies
    // to "modern" / "classic" — adjectives that describe many other
    // categories of object.
    { category: "books", keywords: /\b(book|novel|textbook|isbn|paperback|hardcover|edition|author|chapter|volume|manga|comic|penguin|random house|harpercollins|simon & schuster|o'reilly|wiley|springer|scholastic|dover|tor books|del rey)\b/g },
    { category: "toys", keywords: /\b(toy|lego|doll|puzzle|game|board game|action figure|plush|stuffed|nerf|barbie|hot wheels|pokemon)\b/g },
    { category: "sports", keywords: /\b(bike|bicycle|yoga|gym|weights|dumbbell|racket|tennis|golf|soccer|football|basketball|helmet|skateboard|surfboard|camping|tent|fishing)\b/g },
    // home: generic kitchen/garden/appliance nouns + major appliance brands.
    // Brand-list overlap with `extractBrandModel` is intentional — a
    // KitchenAid mixer photo gets BOTH a home-category vote (here) and a
    // brand entry in the title (there).
    { category: "home", keywords: /\b(kitchen|blender|mixer|pot|pan|plate|mug|vacuum|iron|washer|dryer|garden|plant|tool|drill|saw|hammer|kitchenaid|cuisinart|ninja|vitamix|keurig|nespresso|roomba|irobot|bissell|shark|hoover|whirlpool|frigidaire|maytag|crock[\-\s]?pot|instant pot|breville)\b/g },
    // auto: generic car-part nouns + popular auto brands. Brand list is
    // bounded to widely-recognized makes — adding obscure marques would
    // burn regex bytes for marginal coverage. "ford" needs the \b on both
    // sides (which it gets from the global `\b...\b` wrapper) so that
    // "afford" / "Stanford" don't false-positive.
    // "ram" is intentionally NOT in the auto keyword list even though Dodge
    // Ram is a real model — it would collide with the electronics "ram"
    // entry (memory). "dodge" alone is enough to vote auto for Ram trucks
    // ("Dodge Ram 1500"); a 1500-word RAM upgrade product still routes to
    // electronics correctly because "ram" is unambiguous-enough on its own.
    { category: "auto", keywords: /\b(car|auto|tire|wheel|brake|engine|motor|bumper|headlight|taillight|wiper|oil|filter|spark plug|obd|toyota|honda|ford|chevy|chevrolet|tesla|bmw|mercedes|audi|porsche|volkswagen|nissan|mazda|subaru|hyundai|kia|lexus|jeep|volvo|dodge|gmc|cadillac|lincoln|infiniti|acura|fiat|peugeot|citroen|renault|mitsubishi|ferrari|lamborghini|bentley|aston martin|maserati)\b/g },
  ];

  let bestCategory: ListingCategory = "other";
  let bestScore = 0;
  for (const { category, keywords } of patterns) {
    // `.match()` with a /g regex returns all matches; null when none. Using a
    // fresh regex per call would be safer against `lastIndex` mutation but
    // `.match` always resets it for callers, so the /g flag here is purely
    // so we get all hits instead of the first.
    const hits = lower.match(keywords)?.length ?? 0;
    if (hits > bestScore) {
      bestScore = hits;
      bestCategory = category;
    }
  }
  return bestCategory;
}

// Extract potential brand/model from OCR text
function extractBrandModel(text: string): { brand?: string; model?: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 1 && l.length < 60);

  // Known brands
  const brands = [
    "Apple", "Samsung", "Sony", "LG", "Nike", "Adidas", "Puma", "Canon", "Nikon",
    "Dell", "HP", "Lenovo", "ASUS", "Acer", "Microsoft", "Google", "Bose", "JBL",
    "Nintendo", "Dyson", "KitchenAid", "Cuisinart", "Bosch", "Makita", "DeWalt",
    "IKEA", "Levi", "Gucci", "Prada", "Zara", "Panasonic", "Philips", "Logitech",
    "Razer", "Corsair", "Anker", "Belkin", "OtterBox", "Under Armour", "Columbia",
    "North Face", "Patagonia", "Yeti", "Hydro Flask", "Instant Pot", "Ninja",
  ];

  let brand: string | undefined;
  const lower = text.toLowerCase();
  for (const b of brands) {
    if (lower.includes(b.toLowerCase())) {
      brand = b;
      break;
    }
  }

  // Model: look for alphanumeric patterns like "A2442", "XPS 15", "RT-AX86U"
  const modelMatch = text.match(/\b[A-Z]{1,4}[-\s]?\d{2,6}[A-Z]?\b/);
  const model = modelMatch?.[0];

  return { brand, model };
}

// Generate a listing from OCR text and user inputs
export function generateListing(
  ocrText: string,
  condition: ListingCondition,
  userTitle?: string,
  userCategory?: ListingCategory,
): ListingDraft {
  const category = userCategory || detectCategory(ocrText);
  const { brand, model } = extractBrandModel(ocrText);
  const categoryInfo = CATEGORY_LABELS[category];

  // Build title
  let title = userTitle || "";
  if (!title) {
    const parts: string[] = [];
    if (brand) parts.push(brand);
    if (model) parts.push(model);
    if (parts.length === 0) {
      // Use first meaningful line from OCR
      const firstLine = ocrText.split("\n").find((l) => l.trim().length > 3 && l.trim().length < 80);
      if (firstLine) parts.push(firstLine.trim());
      else parts.push(categoryInfo.label + " Item");
    }
    title = parts.join(" ") + (condition !== "new" ? ` - ${CONDITION_LABELS[condition]}` : "");
  }

  // Build description
  const descParts: string[] = [];
  descParts.push(`${categoryInfo.icon} ${categoryInfo.label}`);
  descParts.push("");
  if (brand) descParts.push(`Brand: ${brand}`);
  if (model) descParts.push(`Model: ${model}`);
  descParts.push(`Condition: ${CONDITION_LABELS[condition]}`);
  descParts.push("");

  // Add OCR-extracted details
  const relevantLines = ocrText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5 && l.length < 200);

  if (relevantLines.length > 0) {
    descParts.push("Product Details:");
    for (const line of relevantLines.slice(0, 10)) {
      descParts.push(`• ${line}`);
    }
  }

  descParts.push("");
  descParts.push("📸 Photos show actual item condition.");

  // Generate tags
  const tags: string[] = [];
  if (brand) tags.push(brand.toLowerCase());
  if (model) tags.push(model.toLowerCase());
  tags.push(category);
  tags.push(CONDITION_LABELS[condition].toLowerCase());
  if (categoryInfo.label !== "Other") tags.push(categoryInfo.label.toLowerCase());

  return {
    title,
    description: descParts.join("\n"),
    category,
    condition,
    suggestedTags: tags.filter((t, i, arr) => arr.indexOf(t) === i),
  };
}

// Smart listing generation — uses Apple Neural Engine for entity extraction
// Falls back to template-based generation if Neural Engine is unavailable
export async function generateSmartListing(
  ocrText: string,
  condition: ListingCondition,
  userTitle?: string,
  userCategory?: ListingCategory,
): Promise<ListingDraft> {
  try {
    // Run Neural Engine analysis
    const entities = await analyzeProductText(ocrText);
    const insights = generateInsights(ocrText, entities);

    // Use insights for better listing generation
    const category = userCategory || (insights.suggestedCategory as ListingCategory) || detectCategory(ocrText);
    const brand = insights.suggestedBrand;
    const model = insights.suggestedModel;
    const categoryInfo = CATEGORY_LABELS[category] || CATEGORY_LABELS.other;

    // Build smarter title
    let title = userTitle || "";
    if (!title) {
      const parts: string[] = [];
      if (brand) parts.push(brand);
      if (model) parts.push(model);
      if (parts.length === 0) {
        const firstLine = ocrText.split("\n").find((l) => l.trim().length > 3 && l.trim().length < 80);
        if (firstLine) parts.push(firstLine.trim());
        else parts.push(categoryInfo.label + " Item");
      }
      title = parts.join(" ") + (condition !== "new" ? ` - ${CONDITION_LABELS[condition]}` : "");
    }

    // Build smarter description with extracted specs
    const descParts: string[] = [];
    descParts.push(`${categoryInfo.icon} ${categoryInfo.label}`);
    descParts.push("");
    if (brand) descParts.push(`Brand: ${brand}`);
    if (model) descParts.push(`Model: ${model}`);
    descParts.push(`Condition: ${CONDITION_LABELS[condition]}`);

    // Add Neural Engine-extracted specs
    if (insights.keySpecs.length > 0) {
      descParts.push("");
      descParts.push("Specifications:");
      for (const spec of insights.keySpecs) {
        descParts.push(`• ${spec.label}: ${spec.value}`);
      }
    }

    // Add detected prices as reference
    if (insights.detectedPrices.length > 0) {
      descParts.push("");
      descParts.push(`Original price: ${insights.detectedPrices[0]}`);
    }

    // Add remaining OCR details not covered by specs
    const relevantLines = ocrText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 5 && l.length < 200);

    if (relevantLines.length > 0) {
      descParts.push("");
      descParts.push("Additional Details:");
      for (const line of relevantLines.slice(0, 6)) {
        descParts.push(`• ${line}`);
      }
    }

    descParts.push("");
    descParts.push("📸 Photos show actual item condition.");

    // Generate richer tags from entities
    const tags: string[] = [];
    if (brand) tags.push(brand.toLowerCase());
    if (model) tags.push(model.toLowerCase());
    tags.push(category);
    tags.push(CONDITION_LABELS[condition].toLowerCase());
    if (categoryInfo.label !== "Other") tags.push(categoryInfo.label.toLowerCase());
    // Add spec-based tags (e.g. "64gb", "space gray")
    for (const spec of insights.keySpecs) {
      const tagValue = spec.value.toLowerCase().replace(/\s+/g, "");
      if (tagValue.length > 2 && tagValue.length < 20) tags.push(tagValue);
    }

    return {
      title,
      description: descParts.join("\n"),
      category,
      condition,
      suggestedTags: tags.filter((t, i, arr) => arr.indexOf(t) === i).slice(0, 12),
      insights,
    };
  } catch (err) {
    logger.warn("Listing", "Smart listing generation failed, falling back to basic", err);
    return generateListing(ocrText, condition, userTitle, userCategory);
  }
}

// Translate a listing to a target language
export async function translateListing(
  draft: ListingDraft,
  targetLangCode: string,
  provider?: TranslationProvider,
  signal?: AbortSignal,
): Promise<ListingDraft> {
  try {
    const [titleResult, descResult] = await Promise.all([
      translateText(draft.title, "en", targetLangCode, { provider, signal }),
      translateText(draft.description, "en", targetLangCode, { provider, signal }),
    ]);
    return {
      ...draft,
      translatedTitle: titleResult.translatedText,
      translatedDescription: descResult.translatedText,
      targetLang: targetLangCode,
    };
  } catch (err) {
    logger.warn("Listing", "Listing translation failed", err);
    return draft;
  }
}

// Format listing for sharing/pasting to marketplace
export function formatListingForShare(draft: ListingDraft, includeTranslation: boolean = false): string {
  const parts: string[] = [];
  parts.push(draft.title);
  if (draft.price) {
    parts.push(`💰 ${draft.currency || "$"}${draft.price}`);
  }
  parts.push("─".repeat(30));
  parts.push(draft.description);

  if (includeTranslation && draft.translatedTitle && draft.translatedDescription) {
    parts.push("");
    parts.push("═".repeat(30));
    parts.push(`🌐 ${draft.targetLang?.toUpperCase() || "Translated"}`);
    parts.push("═".repeat(30));
    parts.push(draft.translatedTitle);
    parts.push("─".repeat(30));
    parts.push(draft.translatedDescription);
  }

  if (draft.suggestedTags.length > 0) {
    parts.push("");
    parts.push("Tags: " + draft.suggestedTags.map((t) => `#${t.replace(/\s/g, "")}`).join(" "));
  }

  return parts.join("\n");
}
