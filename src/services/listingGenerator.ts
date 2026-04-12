// Listing generator service — creates marketplace listings from photo + OCR text
// Uses template-based generation now, upgradeable to LLM later

import { translateText, type TranslationProvider } from "./translation";

export type ListingCondition = "new" | "like_new" | "good" | "fair" | "parts";
export type ListingCategory =
  | "electronics"
  | "clothing"
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
  translatedTitle?: string;
  translatedDescription?: string;
  targetLang?: string;
}

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

// Detect likely category from OCR text
function detectCategory(text: string): ListingCategory {
  const lower = text.toLowerCase();

  const patterns: Array<{ category: ListingCategory; keywords: RegExp }> = [
    { category: "electronics", keywords: /\b(iphone|samsung|laptop|macbook|ipad|airpods|headphone|speaker|tv|monitor|camera|nintendo|playstation|xbox|pixel|galaxy|charger|cable|usb|bluetooth|wifi|battery|power bank|processor|gpu|ram|ssd|hard drive)\b/ },
    { category: "clothing", keywords: /\b(shirt|pants|dress|jacket|coat|shoes|boots|sneakers|jeans|hoodie|sweater|blazer|skirt|socks|hat|scarf|belt|handbag|purse|backpack|nike|adidas|zara|h&m|levi|gucci|prada)\b/ },
    { category: "furniture", keywords: /\b(chair|table|desk|sofa|couch|bed|mattress|shelf|bookcase|cabinet|drawer|lamp|mirror|rug|ikea|wayfair)\b/ },
    { category: "books", keywords: /\b(book|novel|textbook|isbn|paperback|hardcover|edition|author|chapter|volume|manga|comic)\b/ },
    { category: "toys", keywords: /\b(toy|lego|doll|puzzle|game|board game|action figure|plush|stuffed|nerf|barbie|hot wheels|pokemon)\b/ },
    { category: "sports", keywords: /\b(bike|bicycle|yoga|gym|weights|dumbbell|racket|tennis|golf|soccer|football|basketball|helmet|skateboard|surfboard|camping|tent|fishing)\b/ },
    { category: "home", keywords: /\b(kitchen|blender|mixer|pot|pan|plate|mug|vacuum|iron|washer|dryer|garden|plant|tool|drill|saw|hammer)\b/ },
    { category: "auto", keywords: /\b(car|auto|tire|wheel|brake|engine|motor|bumper|headlight|taillight|wiper|oil|filter|spark plug|obd)\b/ },
  ];

  for (const { category, keywords } of patterns) {
    if (keywords.test(lower)) return category;
  }
  return "other";
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
    console.warn("Listing translation failed:", err);
    return draft;
  }
}

// Format listing for sharing/pasting to marketplace
export function formatListingForShare(draft: ListingDraft, includeTranslation: boolean = false): string {
  const parts: string[] = [];
  parts.push(draft.title);
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
