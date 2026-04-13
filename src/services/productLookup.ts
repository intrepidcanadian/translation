// Product lookup service — barcode/UPC lookup via Open Food Facts + UPCitemdb, with OCR text search fallback
import { logger } from "./logger";

// API response types for external product APIs
interface OFFProduct {
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  generic_name?: string;
  categories?: string;
  categories_tags?: string[];
  image_url?: string;
  image_front_url?: string;
  nutriscore_grade?: string;
  ecoscore_grade?: string;
  nova_group?: number;
  quantity?: string;
  ingredients_text?: string;
  allergens_tags?: string[];
  countries_tags?: string[];
  code?: string;
}

interface UPCItem {
  title?: string;
  brand?: string;
  description?: string;
  category?: string;
  images?: string[];
  weight?: string;
  offers?: Array<{ price?: string; merchant?: string; domain?: string; link?: string }>;
}

function safeParseJSON(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({}));
}

// Runtime type guards for external API responses
function isOFFResponse(data: Record<string, unknown>): data is { status: number; product: OFFProduct } {
  return typeof data.status === "number" && data.product != null && typeof data.product === "object";
}

function isOFFSearchResponse(data: Record<string, unknown>): data is { products: OFFProduct[] } {
  return Array.isArray(data.products) && data.products.length > 0;
}

function isUPCResponse(data: Record<string, unknown>): data is { items: UPCItem[] } {
  return Array.isArray(data.items) && data.items.length > 0;
}

export interface ProductInfo {
  name: string;
  brand?: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  barcode?: string;
  prices?: Array<{ source: string; price: string; url?: string }>;
  attributes?: Array<{ label: string; value: string }>;
}

export interface ProductSearchResult {
  found: boolean;
  product?: ProductInfo;
  searchQuery?: string;
  error?: string;
}

// Look up a barcode/UPC via free APIs
export async function lookupBarcode(barcode: string, signal?: AbortSignal): Promise<ProductSearchResult> {
  // Try Open Food Facts first (food/grocery items, large free DB)
  try {
    const offRes = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { signal, headers: { "User-Agent": "LiveTranslator/1.0" } }
    );
    if (offRes.ok) {
      const data = await safeParseJSON(offRes);
      if (isOFFResponse(data) && data.status === 1) {
        const p = data.product;
        const attributes: ProductInfo["attributes"] = [];
        if (p.nutriscore_grade) attributes.push({ label: "Nutri-Score", value: p.nutriscore_grade.toUpperCase() });
        if (p.ecoscore_grade && p.ecoscore_grade !== "unknown") attributes.push({ label: "Eco-Score", value: p.ecoscore_grade.toUpperCase() });
        if (p.nova_group) attributes.push({ label: "NOVA Group", value: String(p.nova_group) });
        if (p.quantity) attributes.push({ label: "Quantity", value: p.quantity });
        if (p.ingredients_text) attributes.push({ label: "Ingredients", value: p.ingredients_text.slice(0, 200) });
        if (p.allergens_tags?.length) attributes.push({ label: "Allergens", value: p.allergens_tags.map((a: string) => a.replace("en:", "")).join(", ") });
        if (p.countries_tags?.length) attributes.push({ label: "Origin", value: p.countries_tags.slice(0, 3).map((c: string) => c.replace("en:", "")).join(", ") });

        return {
          found: true,
          product: {
            name: p.product_name || p.product_name_en || "Unknown Product",
            brand: p.brands,
            description: p.generic_name || p.categories,
            category: p.categories_tags?.[0]?.replace("en:", ""),
            imageUrl: p.image_url || p.image_front_url,
            barcode,
            attributes,
          },
        };
      }
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    logger.warn("Product", "Open Food Facts lookup failed", err);
  }

  // Try UPCitemdb (general products)
  try {
    const upcRes = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`,
      { signal }
    );
    if (upcRes.ok) {
      const data = await safeParseJSON(upcRes);
      if (isUPCResponse(data)) {
        const item = data.items[0];
        const prices: ProductInfo["prices"] = [];
        if (item.offers?.length) {
          for (const offer of item.offers.slice(0, 5)) {
            if (offer.price) {
              prices.push({
                source: offer.merchant || offer.domain || "Store",
                price: `$${offer.price}`,
                url: offer.link,
              });
            }
          }
        }

        return {
          found: true,
          product: {
            name: item.title || "Unknown Product",
            brand: item.brand,
            description: item.description,
            category: item.category,
            imageUrl: item.images?.[0],
            barcode,
            prices,
            attributes: item.weight ? [{ label: "Weight", value: item.weight }] : [],
          },
        };
      }
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    logger.warn("Product", "UPCitemdb lookup failed", err);
  }

  return { found: false, searchQuery: barcode };
}

// Search for a product by text (OCR-extracted brand/name)
export async function searchProductByText(query: string, signal?: AbortSignal): Promise<ProductSearchResult> {
  if (!query.trim()) return { found: false };

  // Try Open Food Facts text search
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`,
      { signal, headers: { "User-Agent": "LiveTranslator/1.0" } }
    );
    if (res.ok) {
      const data = await safeParseJSON(res);
      if (isOFFSearchResponse(data)) {
        const p = data.products[0];
        return {
          found: true,
          searchQuery: query,
          product: {
            name: p.product_name || p.product_name_en || query,
            brand: p.brands,
            description: p.generic_name || p.categories,
            imageUrl: p.image_url || p.image_front_url,
            barcode: p.code,
          },
        };
      }
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    logger.warn("Product", "Product text search failed", err);
  }

  return { found: false, searchQuery: query };
}

// Generate marketplace search URLs for a product
export function getMarketplaceLinks(productName: string): Array<{ name: string; icon: string; url: string }> {
  const q = encodeURIComponent(productName);
  return [
    { name: "Amazon", icon: "🛒", url: `https://www.amazon.com/s?k=${q}` },
    { name: "eBay", icon: "🏷️", url: `https://www.ebay.com/sch/i.html?_nkw=${q}` },
    { name: "Google Shopping", icon: "🔍", url: `https://www.google.com/search?tbm=shop&q=${q}` },
    { name: "Walmart", icon: "🏪", url: `https://www.walmart.com/search?q=${q}` },
  ];
}

// Generate price comparison links including eBay sold/completed listings
export function getPriceCompLinks(productName: string): Array<{ name: string; icon: string; url: string; description: string }> {
  const q = encodeURIComponent(productName);
  return [
    {
      name: "eBay Sold",
      icon: "✅",
      url: `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Complete=1&LH_Sold=1&_sop=13`,
      description: "Recently sold — best comp data",
    },
    {
      name: "eBay Active",
      icon: "🏷️",
      url: `https://www.ebay.com/sch/i.html?_nkw=${q}&_sop=15`,
      description: "Current listings — see asking prices",
    },
    {
      name: "Amazon",
      icon: "🛒",
      url: `https://www.amazon.com/s?k=${q}`,
      description: "New retail price",
    },
    {
      name: "Google Shopping",
      icon: "🔍",
      url: `https://www.google.com/search?tbm=shop&q=${q}`,
      description: "Compare across stores",
    },
  ];
}

export interface PriceCompResult {
  query: string;
  retailPrice?: { source: string; price: string };
  links: Array<{ name: string; icon: string; url: string; description: string }>;
}

// Fetch price comps for a product name/brand+model
export async function fetchPriceComps(
  query: string,
  signal?: AbortSignal,
): Promise<PriceCompResult> {
  const links = getPriceCompLinks(query);
  const result: PriceCompResult = { query, links };

  // Try UPCitemdb text search for retail price
  try {
    const res = await fetch(
      `https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(query)}&match_mode=0&type=product`,
      { signal },
    );
    if (res.ok) {
      const data = await safeParseJSON(res);
      if (isUPCResponse(data)) {
        const item = data.items[0];
        // Find lowest offer price
        if (item.offers?.length) {
          const prices = item.offers
            .filter((o) => o.price && parseFloat(o.price) > 0)
            .map((o) => ({ source: o.merchant || o.domain || "Retailer", price: parseFloat(o.price!) }))
            .sort((a, b) => a.price - b.price);
          if (prices.length > 0) {
            result.retailPrice = { source: prices[0].source, price: `$${prices[0].price.toFixed(2)}` };
          }
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    logger.warn("Product", "Price comp lookup failed", err);
  }

  return result;
}
