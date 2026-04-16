// DutyFreeCatalogScanner — Scan duty-free catalog pages
// Captures photo → OCR → extracts products with prices → translates descriptions
// → shows cross-border price comparison (HKD vs JPY vs SGD vs USD)
// Combines Neural Engine ecommerce intelligence with currency conversion

import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  ActivityIndicator,
  Share,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  type PhotoFile,
} from "react-native-vision-camera";
import TextRecognition from "@react-native-ml-kit/text-recognition";
import { getMLKitScript } from "../utils/getMLKitScript";
import { copyWithAutoClear } from "../services/clipboard";
import { impactMedium, impactLight, notifySuccess } from "../services/haptics";
import { useAutoClearFlag } from "../hooks/useAutoClearFlag";
import { logger } from "../services/logger";
import { translateText, translateAppleBatch, type TranslationProvider } from "../services/translation";
import {
  analyzeProductText,
  generateInsights,
  type ProductEntities,
  type SmartListingInsights,
} from "../services/smartProductAnalysis";
import {
  detectPricesInText,
  convertPrice,
  getExchangeRates,
  CURRENCIES,
  CREW_CURRENCIES,
  type ConvertedPrice,
} from "../services/currencyExchange";
import { primaryAlpha, type ThemeColors } from "../theme";

interface DutyFreeCatalogScannerProps {
  visible: boolean;
  onClose: () => void;
  sourceLangCode: string;
  targetLangCode: string;
  translationProvider?: TranslationProvider;
  colors: ThemeColors;
}

type Phase = "camera" | "processing" | "results";

interface CatalogProduct {
  name: string;
  translatedName: string;
  brand: string | null;
  category: string | null;
  description: string;
  translatedDescription: string;
  prices: Array<{
    raw: string;
    currency: string;
    amount: number;
    conversions: ConvertedPrice[];
  }>;
  specs: Array<{ label: string; value: string }>;
  confidence: number;
}

interface ProductCardProps {
  product: CatalogProduct;
  index: number;
  isExpanded: boolean;
  onToggleExpand: (index: number) => void;
  onCopyPrice: (text: string) => void;
  copiedText: string | null;
  colors: ThemeColors;
}

const ProductCard = React.memo(function ProductCard({
  product, index, isExpanded, onToggleExpand, onCopyPrice, copiedText, colors,
}: ProductCardProps) {
  const handleToggle = useCallback(() => {
    impactLight();
    onToggleExpand(index);
  }, [index, onToggleExpand]);

  return (
    <View style={[styles.productCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.productHeader}
        onPress={handleToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${product.brand ? product.brand + " " : ""}${product.translatedName !== product.name ? product.translatedName : product.name}`}
        accessibilityHint={isExpanded ? "Collapse product details" : "Expand product details"}
        accessibilityState={{ expanded: isExpanded }}
      >
        <View style={{ flex: 1 }}>
          {product.brand && (
            <Text style={[styles.productBrand, { color: colors.primary }]}>{product.brand}</Text>
          )}
          <Text style={[styles.productName, { color: colors.primaryText }]} numberOfLines={2}>
            {product.translatedName !== product.name ? product.translatedName : product.name}
          </Text>
          {product.translatedName !== product.name && (
            <Text style={[styles.productOriginal, { color: colors.dimText }]} numberOfLines={1}>
              {product.name}
            </Text>
          )}
          {product.category && product.category !== "other" && (
            <View style={[styles.categoryBadge, { backgroundColor: colors.containerBg }]}>
              <Text style={[styles.categoryBadgeText, { color: colors.mutedText }]}>
                {product.category}
              </Text>
            </View>
          )}
        </View>
        {product.prices.length > 0 && (
          <View style={styles.quickPriceCol}>
            <Text style={[styles.quickPrice, { color: colors.successText }]}>
              {CURRENCIES[product.prices[0].currency]?.symbol}{product.prices[0].amount.toLocaleString()}
            </Text>
            <Text style={[styles.quickPriceCurrency, { color: colors.mutedText }]}>
              {product.prices[0].currency}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.expandedContent}>
          {product.translatedDescription && product.translatedDescription !== product.translatedName && (
            <Text style={[styles.productDesc, { color: colors.secondaryText }]}>
              {product.translatedDescription}
            </Text>
          )}
          {product.specs.length > 0 && (
            <View style={styles.specsRow}>
              {product.specs.slice(0, 6).map((spec, si) => (
                <View key={si} style={[styles.specChip, { backgroundColor: colors.containerBg }]}>
                  <Text style={[styles.specLabel, { color: colors.mutedText }]}>{spec.label}</Text>
                  <Text style={[styles.specValue, { color: colors.primaryText }]}>{spec.value}</Text>
                </View>
              ))}
            </View>
          )}
          {product.prices.map((price, pi) => (
            <View key={pi} style={styles.priceComparisonBlock}>
              <Text style={[styles.priceComparisonTitle, { color: colors.primaryText }]}>
                💱 {CURRENCIES[price.currency]?.flag} {CURRENCIES[price.currency]?.symbol}{price.amount.toLocaleString()} {price.currency}
              </Text>
              <View style={styles.priceGrid}>
                {price.conversions.map((conv) => (
                  <TouchableOpacity
                    key={conv.currency}
                    style={[styles.priceGridCell, { backgroundColor: colors.containerBg, borderColor: colors.borderLight }]}
                    onPress={() => onCopyPrice(`${conv.formatted} ${conv.currency}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Copy ${conv.formatted} ${conv.currency}`}
                  >
                    <Text style={styles.priceGridFlag}>{conv.flag}</Text>
                    <Text style={[styles.priceGridAmount, { color: colors.primaryText }]} numberOfLines={1} adjustsFontSizeToFit>
                      {copiedText === `${conv.formatted} ${conv.currency}` ? "✓" : conv.formatted}
                    </Text>
                    <Text style={[styles.priceGridCode, { color: colors.mutedText }]}>{conv.currency}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
});

export default function DutyFreeCatalogScanner({
  visible,
  onClose,
  sourceLangCode,
  targetLangCode,
  translationProvider,
  colors,
}: DutyFreeCatalogScannerProps) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);

  const [phase, setPhase] = useState<Phase>("camera");
  const [processingStep, setProcessingStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [rawText, setRawText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [expandedProduct, setExpandedProduct] = useState<number | null>(null);
  const [copiedText, setCopiedText] = useAutoClearFlag<string>(1500);
  const [ratesAge, setRatesAge] = useState("");
  const [totalItems, setTotalItems] = useState(0);

  useEffect(() => {
    if (visible && !hasPermission) requestPermission();
  }, [visible, hasPermission, requestPermission]);

  const captureAndAnalyze = useCallback(async () => {
    if (!cameraRef.current) return;
    impactMedium();

    setPhase("processing");
    setError(null);
    setProducts([]);
    setExpandedProduct(null);

    try {
      // Step 1: Capture
      setProcessingStep("Capturing catalog page...");
      const photo: PhotoFile = await cameraRef.current.takePhoto({ enableShutterSound: true });
      const imageUri = Platform.OS === "android" ? `file://${photo.path}` : photo.path;

      // Step 2: OCR
      setProcessingStep("Reading text (on-device OCR)...");
      const script = getMLKitScript(sourceLangCode);
      const result = await TextRecognition.recognize(imageUri, script);

      if (!result.blocks.length) {
        setError("No text detected. Try again with a clearer photo.");
        setPhase("camera");
        return;
      }

      const fullText = result.blocks.map((b) => b.text).join("\n");
      setRawText(fullText);

      // Step 3: Neural Engine product analysis
      setProcessingStep("Analyzing products (Neural Engine)...");
      const entities: ProductEntities = await analyzeProductText(fullText);
      const insights: SmartListingInsights = generateInsights(fullText, entities);

      // Step 4: Detect all prices
      setProcessingStep("Detecting prices...");
      const detectedPrices = detectPricesInText(fullText);

      // Step 5: Translate the full text
      setProcessingStep("Translating descriptions...");
      const srcLang = sourceLangCode === "autodetect"
        ? (entities.detectedLanguage || "en")
        : sourceLangCode;

      // Split into paragraphs for better translation
      const paragraphs = fullText.split("\n").filter((p) => p.trim());
      let translated: string;

      const translateParagraphs = async (paras: string[]): Promise<string> => {
        const results: string[] = [];
        for (const para of paras) {
          if (!para.trim()) { results.push(""); continue; }
          const res = await translateText(para, srcLang, targetLangCode, { provider: translationProvider });
          results.push(res.translatedText);
        }
        return results.join("\n");
      };

      if (translationProvider === "apple" && Platform.OS === "ios" && paragraphs.length > 1) {
        try {
          const results = await translateAppleBatch(paragraphs, srcLang, targetLangCode);
          translated = results.join("\n");
        } catch (err) {
          // Apple batch path failed — fall back to per-paragraph translate.
          // Worth logging so we can measure how often the fast path breaks.
          logger.warn("Translation", "Apple batch translate failed in DutyFree scanner, falling back per-paragraph", err);
          translated = await translateParagraphs(paragraphs);
        }
      } else {
        translated = await translateParagraphs(paragraphs);
      }
      setTranslatedText(translated);

      // Step 6: Convert all prices to multiple currencies
      setProcessingStep("Converting currencies...");
      const priceConversions = await Promise.all(
        detectedPrices.map(async (p) => ({
          raw: p.raw,
          currency: p.currency,
          amount: p.amount,
          conversions: await convertPrice(p.amount, p.currency),
        }))
      );

      // Step 7: Build product cards
      // Try to segment text into individual products using price anchors
      setProcessingStep("Building catalog...");
      const catalogProducts = buildProductCards(
        fullText,
        translated,
        paragraphs,
        priceConversions,
        insights,
        entities,
      );

      // Get rates age
      const rates = await getExchangeRates();
      if (rates.timestamp === 0) {
        setRatesAge("Offline rates (approximate)");
      } else {
        const ageMin = Math.round((Date.now() - rates.timestamp) / 60000);
        setRatesAge(ageMin < 60 ? `Updated ${ageMin}m ago` : `Updated ${Math.round(ageMin / 60)}h ago`);
      }

      setProducts(catalogProducts);
      setTotalItems(catalogProducts.length);
      setPhase("results");
      notifySuccess();
    } catch (err) {
      logger.warn("Scanner", "Catalog scan failed", err);
      setError(err instanceof Error ? err.message : "Scan failed");
      setPhase("camera");
    }
  }, [sourceLangCode, targetLangCode, translationProvider]);

  const toggleExpand = useCallback((idx: number) => {
    setExpandedProduct((prev) => (prev === idx ? null : idx));
  }, []);

  const copyText = useCallback(async (text: string) => {
    try {
      // copyWithAutoClear: duty-free catalog copies follow the same auto-wipe
      // rule as the rest of the content-copy surfaces. (#128)
      await copyWithAutoClear(text);
      notifySuccess();
      setCopiedText(text);
    } catch (err) {
      logger.warn("Scanner", "Copy failed", err);
    }
  }, []);

  const shareResults = useCallback(async () => {
    const lines: string[] = ["🛍️ DUTY-FREE CATALOG SCAN\n"];

    for (const product of products) {
      lines.push(`━━━━━━━━━━━━━━━━`);
      if (product.brand) lines.push(`Brand: ${product.brand}`);
      lines.push(`${product.name}`);
      if (product.translatedName !== product.name) {
        lines.push(`→ ${product.translatedName}`);
      }

      for (const price of product.prices) {
        const meta = CURRENCIES[price.currency];
        lines.push(`\nPrice: ${meta?.symbol ?? ""}${price.amount} ${price.currency}`);
        for (const conv of price.conversions.slice(0, 5)) {
          lines.push(`  ${conv.flag} ${conv.formatted}`);
        }
      }
      lines.push("");
    }

    if (ratesAge) lines.push(`\n${ratesAge}`);

    try {
      await Share.share({ message: lines.join("\n") });
    } catch (err) {
      logger.warn("Scanner", "Share failed", err);
    }
  }, [products, ratesAge]);

  if (!visible) return null;

  if (!device || !hasPermission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.containerBg }]}>
        <View style={styles.centerContent}>
          <Text style={[styles.errorText, { color: colors.primaryText }]}>
            {!device ? "No camera found" : "Camera permission required"}
          </Text>
          {!hasPermission && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} onPress={requestPermission} accessibilityRole="button" accessibilityLabel="Grant camera permission">
              <Text style={styles.actionBtnText}>Grant Permission</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close duty-free scanner"><Text style={[styles.closeLinkText, { color: colors.primary }]}>Close</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  // Camera
  if (phase === "camera") {
    return (
      <View style={styles.container}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={visible && phase === "camera"}
          photo={true}
        />
        <View style={styles.frameGuide}>
          <View style={[styles.frameCorner, styles.frameTL]} />
          <View style={[styles.frameCorner, styles.frameTR]} />
          <View style={[styles.frameCorner, styles.frameBL]} />
          <View style={[styles.frameCorner, styles.frameBR]} />
        </View>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.topButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close duty-free scanner">
            <Text style={styles.topButtonText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>🛍️ Duty-Free Catalog</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}
        <View style={styles.bottomArea}>
          <Text style={styles.instructionText}>Capture a catalog page</Text>
          <TouchableOpacity style={styles.captureButton} onPress={captureAndAnalyze} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Capture catalog page" accessibilityHint="Takes a photo and extracts products with prices">
            <View style={styles.captureInner}>
              <Text style={styles.captureIcon}>🛍️</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.hintText}>
            {sourceLangCode.toUpperCase()} → {targetLangCode.toUpperCase()} | Products + Prices + Translation
          </Text>
        </View>
      </View>
    );
  }

  // Processing
  if (phase === "processing") {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>🛍️</Text>
          <ActivityIndicator size="large" color="#6c63ff" />
          <Text style={styles.processingText}>{processingStep}</Text>
          <Text style={styles.processingHint}>Neural Engine + OCR + Currency</Text>
        </View>
      </View>
    );
  }

  // Results
  return (
    <View style={{ flex: 1, backgroundColor: colors.containerBg }}>
      {/* Fixed header */}
      <View style={[styles.resultsHeader, { backgroundColor: colors.containerBg, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => { setPhase("camera"); setError(null); }} accessibilityRole="button" accessibilityLabel="Back to scanner">
          <Text style={[styles.headerBackText, { color: colors.primary }]}>← Scan</Text>
        </TouchableOpacity>
        <Text style={[styles.resultsTitle, { color: colors.titleText }]}>🛍️ {totalItems} Product{totalItems !== 1 ? "s" : ""}</Text>
        <TouchableOpacity onPress={shareResults} accessibilityRole="button" accessibilityLabel="Share scan results">
          <Text style={[styles.headerBackText, { color: colors.primary }]}>Share</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.resultsContent} showsVerticalScrollIndicator={false}>
        {ratesAge ? (
          <Text style={[styles.ratesAgeText, { color: colors.mutedText }]}>{ratesAge}</Text>
        ) : null}

        {products.map((product, idx) => (
          <ProductCard
            key={idx}
            product={product}
            index={idx}
            isExpanded={expandedProduct === idx}
            onToggleExpand={toggleExpand}
            onCopyPrice={copyText}
            copiedText={copiedText}
            colors={colors}
          />
        ))}

        {/* Full translated text */}
        {translatedText && (
          <TouchableOpacity
            style={[styles.fullTextCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
            onPress={() => copyText(translatedText)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Full translation text"
            accessibilityHint="Tap to copy full translation to clipboard"
          >
            <Text style={[styles.fullTextLabel, { color: colors.mutedText }]}>Full Translation (tap to copy)</Text>
            <Text style={[styles.fullTextContent, { color: colors.secondaryText }]} numberOfLines={8}>
              {copiedText === translatedText ? "Copied to clipboard!" : translatedText}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

// --- Product segmentation logic ---

/** Lines starting with a currency sigil are prices, not product names. */
const CURRENCY_SIGIL_RE = /^[$€£¥₹₩฿₫₱]/;

function buildProductCards(
  originalText: string,
  translatedText: string,
  paragraphs: string[],
  prices: Array<{ raw: string; currency: string; amount: number; conversions: ConvertedPrice[] }>,
  insights: SmartListingInsights,
  entities: ProductEntities,
): CatalogProduct[] {
  // Strategy: if we have prices, try to associate nearby text with each price
  // Otherwise, treat the whole page as one product

  if (prices.length === 0) {
    // No prices found — single product card with just translation
    return [{
      name: paragraphs[0]?.slice(0, 80) || "Catalog Item",
      translatedName: translatedText.split("\n")[0]?.slice(0, 80) || "Catalog Item",
      brand: insights.suggestedBrand,
      category: insights.suggestedCategory,
      description: originalText.slice(0, 300),
      translatedDescription: translatedText.slice(0, 300),
      prices: [],
      specs: insights.keySpecs,
      confidence: insights.confidence,
    }];
  }

  // Find the line index of each price in the original text
  const lines = originalText.split("\n");
  const translatedLines = translatedText.split("\n");

  // If single price, single product
  if (prices.length === 1) {
    return [{
      name: findBestProductName(lines, insights),
      translatedName: findBestProductName(translatedLines, insights) || findBestProductName(lines, insights),
      brand: insights.suggestedBrand,
      category: insights.suggestedCategory,
      description: originalText.slice(0, 300),
      translatedDescription: translatedText.slice(0, 300),
      prices,
      specs: insights.keySpecs,
      confidence: insights.confidence,
    }];
  }

  // Multiple prices — try to segment into products
  // Build a line-index lookup: for each raw price string, find its first line
  const rawPriceToLine = new Map<string, number>();
  for (let li = 0; li < lines.length; li++) {
    for (let pi = 0; pi < prices.length; pi++) {
      if (!rawPriceToLine.has(prices[pi].raw) && lines[li].includes(prices[pi].raw)) {
        rawPriceToLine.set(prices[pi].raw, li);
      }
    }
  }
  const priceLineMap: Array<{ priceIdx: number; lineIdx: number }> = [];
  for (let pi = 0; pi < prices.length; pi++) {
    const lineIdx = rawPriceToLine.get(prices[pi].raw);
    if (lineIdx !== undefined) {
      priceLineMap.push({ priceIdx: pi, lineIdx });
    }
  }

  // If we couldn't map prices to lines, fall back to one card per price
  if (priceLineMap.length === 0) {
    return prices.map((p, i) => ({
      name: `Item ${i + 1}`,
      translatedName: `Item ${i + 1}`,
      brand: i === 0 ? insights.suggestedBrand : null,
      category: insights.suggestedCategory,
      description: p.raw,
      translatedDescription: p.raw,
      prices: [p],
      specs: i === 0 ? insights.keySpecs : [],
      confidence: insights.confidence * 0.5,
    }));
  }

  // Segment: each product gets the lines between its price and the next price
  const products: CatalogProduct[] = [];

  for (let i = 0; i < priceLineMap.length; i++) {
    const currentLine = priceLineMap[i].lineIdx;
    const nextLine = i < priceLineMap.length - 1 ? priceLineMap[i + 1].lineIdx : lines.length;
    const prevLine = i > 0 ? priceLineMap[i - 1].lineIdx + 1 : 0;

    // Product text: lines before the price (up to previous product) + price line
    const startLine = Math.max(prevLine, currentLine - 5); // Look up to 5 lines before price
    const endLine = Math.min(nextLine, currentLine + 2); // Include 1 line after price

    const productLines = lines.slice(startLine, endLine);
    const productTranslatedLines = translatedLines.slice(startLine, Math.min(endLine, translatedLines.length));

    // Find the best name from these lines (non-price, non-empty, short enough)
    const nameLine = productLines.find((l) =>
      l.trim().length > 2 &&
      l.trim().length < 80 &&
      !CURRENCY_SIGIL_RE.test(l) &&
      l !== prices[priceLineMap[i].priceIdx].raw
    ) || `Product ${i + 1}`;

    const translatedNameLine = productTranslatedLines.find((l) =>
      l.trim().length > 2 &&
      l.trim().length < 80 &&
      !CURRENCY_SIGIL_RE.test(l)
    ) || nameLine;

    products.push({
      name: nameLine.trim(),
      translatedName: translatedNameLine.trim(),
      brand: i === 0 ? insights.suggestedBrand : extractBrandFromLine(nameLine),
      category: insights.suggestedCategory,
      description: productLines.join("\n"),
      translatedDescription: productTranslatedLines.join("\n"),
      prices: [prices[priceLineMap[i].priceIdx]],
      specs: i === 0 ? insights.keySpecs : [],
      confidence: insights.confidence,
    });
  }

  return products;
}

function findBestProductName(lines: string[], insights: SmartListingInsights): string {
  // Prefer: brand + model, then first non-trivial line
  if (insights.suggestedBrand && insights.suggestedModel) {
    return `${insights.suggestedBrand} ${insights.suggestedModel}`;
  }

  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim();
    if (trimmed.length > 3 && trimmed.length < 80 && !CURRENCY_SIGIL_RE.test(trimmed)) {
      return trimmed;
    }
  }

  return insights.suggestedBrand || "Catalog Item";
}

// Single-word brands: O(1) word-level lookup via Set
const SINGLE_WORD_BRANDS = new Set([
  "apple", "samsung", "sony", "lg", "nike", "adidas", "canon", "nikon", "bose", "jbl",
  "dyson", "shiseido", "chanel", "dior", "gucci", "prada", "coach", "tiffany", "swarovski",
  "rolex", "omega", "seiko", "casio", "burberry", "cartier", "bulgari", "ysl", "givenchy",
  "armani", "versace", "dolce",
]);
// Multi-word brands: kept as array for substring matching
const MULTI_WORD_BRANDS = [
  "sk-ii", "lancôme", "estée", "hermès", "louis vuitton", "michael kors",
  "jo malone", "tom ford", "mont blanc",
] as const;

function extractBrandFromLine(line: string): string | null {
  const lower = line.toLowerCase();
  // O(words) check against Set for single-word brands
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (SINGLE_WORD_BRANDS.has(word)) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
  }
  // O(9) linear scan for multi-word / hyphenated brands
  for (const brand of MULTI_WORD_BRANDS) {
    if (lower.includes(brand)) {
      return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
  }
  return null;
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000", zIndex: 999 },
  centerContent: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  errorText: { fontSize: 18, fontWeight: "600", textAlign: "center", marginBottom: 16 },

  // Camera
  topBar: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 54 : 40, paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  topButton: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)", justifyContent: "center", alignItems: "center",
  },
  topButtonText: { color: "#fff", fontSize: 20, fontWeight: "700" },
  badge: { backgroundColor: primaryAlpha.strong, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 16 },
  badgeText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  frameGuide: { position: "absolute", top: "18%", left: "6%", right: "6%", bottom: "25%" },
  frameCorner: { position: "absolute", width: 30, height: 30, borderColor: "#6c63ff" },
  frameTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  frameTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  frameBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  frameBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },

  errorBanner: {
    position: "absolute", top: Platform.OS === "ios" ? 120 : 100, left: 20, right: 20,
    backgroundColor: "rgba(255,71,87,0.9)", borderRadius: 12, padding: 12,
  },
  errorBannerText: { color: "#fff", fontSize: 14, textAlign: "center" },

  bottomArea: {
    position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center",
    paddingBottom: Platform.OS === "ios" ? 44 : 30, paddingTop: 16, backgroundColor: "rgba(0,0,0,0.6)",
  },
  instructionText: { color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: "500", marginBottom: 16 },
  captureButton: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: "#6c63ff",
    justifyContent: "center", alignItems: "center", marginBottom: 12,
  },
  captureInner: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: primaryAlpha.soft,
    justifyContent: "center", alignItems: "center",
  },
  captureIcon: { fontSize: 28 },
  hintText: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: "600" },

  // Processing
  processingText: { color: "#fff", fontSize: 18, fontWeight: "600", marginTop: 24, textAlign: "center" },
  processingHint: { color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 8 },

  // Results
  resultsHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 54 : 40, paddingBottom: 12, paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerBackText: { fontSize: 15, fontWeight: "600" },
  resultsTitle: { fontSize: 17, fontWeight: "800" },
  resultsContent: { padding: 16, paddingBottom: 40 },
  ratesAgeText: { fontSize: 11, textAlign: "center", marginBottom: 12 },

  // Product cards
  productCard: { borderRadius: 16, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  productHeader: { flexDirection: "row", justifyContent: "space-between", padding: 14, gap: 12 },
  productBrand: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  productName: { fontSize: 16, fontWeight: "700" },
  productOriginal: { fontSize: 12, marginTop: 2 },
  categoryBadge: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  categoryBadgeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  quickPriceCol: { alignItems: "flex-end", justifyContent: "center" },
  quickPrice: { fontSize: 18, fontWeight: "800" },
  quickPriceCurrency: { fontSize: 10, fontWeight: "600" },

  // Expanded
  expandedContent: { paddingHorizontal: 14, paddingBottom: 14 },
  productDesc: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  specsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  specChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  specLabel: { fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
  specValue: { fontSize: 12, fontWeight: "600" },

  priceComparisonBlock: { marginTop: 8 },
  priceComparisonTitle: { fontSize: 14, fontWeight: "700", marginBottom: 8 },
  priceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  priceGridCell: { width: "31%", borderRadius: 8, borderWidth: 1, padding: 8, alignItems: "center" },
  priceGridFlag: { fontSize: 18, marginBottom: 2 },
  priceGridAmount: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  priceGridCode: { fontSize: 9, fontWeight: "600", marginTop: 1 },

  fullTextCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 16 },
  fullTextLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  fullTextContent: { fontSize: 13, lineHeight: 18 },

  actionBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  actionBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  closeLinkText: { fontSize: 16, fontWeight: "600", paddingVertical: 12 },
});
