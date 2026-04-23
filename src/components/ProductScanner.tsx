import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Linking,
  Image,
  Platform,
  Share,
} from "react-native";
import { logger } from "../services/logger";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from "react-native-vision-camera";
import { Camera as OCRCamera } from "react-native-vision-camera-ocr-plus";
import { copyWithAutoClear } from "../services/clipboard";
import { impactMedium, notifySuccess } from "../services/haptics";
import { useAutoClearFlag } from "../hooks/useAutoClearFlag";
import {
  lookupBarcode,
  searchProductByText,
  getMarketplaceLinks,
  type ProductInfo,
} from "../services/productLookup";
import GlassBackdrop from "./GlassBackdrop";
import type { ThemeColors } from "../theme";

interface ProductScannerProps {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
}

type Phase = "scanning" | "loading" | "results" | "not_found" | "ocr";

// Shape returned by react-native-vision-camera-ocr-plus's frame callback.
// Mirrors the parsing in src/hooks/useLiveOCR.ts so we don't depend on
// that hook's translation pipeline (we just want the raw text here).
// Field names must match the native plugin exactly — it prefixes every
// field with its container name (lineText/blockText) and emits no
// `result` wrapper around the top-level `blocks` array.
interface OCRLine { lineText?: string }
interface OCRBlock { blockText?: string; lines?: OCRLine[] }
interface OCRFrameData { blocks?: OCRBlock[] }

function ProductScanner({ visible, onClose, colors }: ProductScannerProps) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>("scanning");
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // useAutoClearFlag cancels the pending 1.5s timer on unmount so navigating
  // away from the scanner mid-copy can't setState on a torn-down component.
  const [copiedText, setCopiedText] = useAutoClearFlag<string>(1500);
  const lastScannedRef = useRef<string>("");
  // Live OCR text accumulated from the frame processor in `ocr` phase.
  // We keep the most recent non-empty frame; the user picks the moment
  // to actually search by tapping the Search button (rather than auto-
  // firing on every frame, which would spam the API).
  const [ocrText, setOcrText] = useState<string>("");

  useEffect(() => {
    if (visible && !hasPermission) {
      requestPermission();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [visible, hasPermission, requestPermission]);

  const resetScan = useCallback(() => {
    setPhase("scanning");
    setScannedCode(null);
    setProduct(null);
    setError(null);
    setOcrText("");
    lastScannedRef.current = "";
  }, []);

  // Frame processor callback for OCRCamera. Mirrors the parser in
  // useLiveOCR but only extracts a flat text string — we don't need
  // bounding boxes here since we're not overlaying live translations,
  // just feeding text into a product search.
  const handleOCRFrame = useCallback((data: unknown) => {
    const ocrData = data as OCRFrameData | null;
    const blocks: OCRBlock[] = ocrData?.blocks || [];
    if (!blocks.length) return;
    const lines: string[] = [];
    for (const block of blocks) {
      if (block.lines?.length) {
        for (const line of block.lines) {
          const t = line.lineText?.trim();
          if (t) lines.push(t);
        }
      } else if (block.blockText?.trim()) {
        lines.push(block.blockText.trim());
      }
    }
    if (!lines.length) return;
    // Cap to first ~8 lines so a busy label (ingredients, fine print)
    // doesn't drown out the brand/name we actually want to search on.
    const joined = lines.slice(0, 8).join(" ");
    setOcrText((prev) => (prev === joined ? prev : joined));
  }, []);

  const handleTextSearch = useCallback(async () => {
    const query = ocrText.trim();
    if (!query) return;
    impactMedium();
    setPhase("loading");
    setError(null);
    setScannedCode(query);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await searchProductByText(query, controller.signal);
      if (controller.signal.aborted) return;
      if (result.found && result.product) {
        setProduct(result.product);
        setPhase("results");
        notifySuccess();
      } else {
        setPhase("not_found");
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Search failed");
      setPhase("not_found");
    }
  }, [ocrText]);

  const enterOCRPhase = useCallback(() => {
    impactMedium();
    abortRef.current?.abort();
    setOcrText("");
    setError(null);
    setPhase("ocr");
  }, []);

  const handleBarcodeLookup = useCallback(async (code: string) => {
    if (code === lastScannedRef.current) return;
    lastScannedRef.current = code;

    impactMedium();
    setScannedCode(code);
    setPhase("loading");
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await lookupBarcode(code, controller.signal);
      if (controller.signal.aborted) return;
      if (result.found && result.product) {
        setProduct(result.product);
        setPhase("results");
        notifySuccess();
      } else {
        setPhase("not_found");
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Lookup failed");
      setPhase("not_found");
    }
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: ["ean-13", "ean-8", "upc-a", "upc-e", "qr", "code-128", "code-39", "code-93", "data-matrix"],
    onCodeScanned: (codes) => {
      if (phase !== "scanning" || codes.length === 0) return;
      const code = codes[0];
      if (code.value) {
        handleBarcodeLookup(code.value);
      }
    },
  });

  const copyText = useCallback(async (text: string) => {
    try {
      // copyWithAutoClear: product scans can include private purchase details.
      // 60s auto-wipe keeps parity with history copies. (#128)
      await copyWithAutoClear(text);
      notifySuccess();
      setCopiedText(text);
    } catch (err) {
      logger.warn("Product", "Copy to clipboard failed", err instanceof Error ? err.message : String(err));
    }
  }, []);

  const shareProduct = useCallback(async () => {
    if (!product) return;
    const parts: string[] = [];
    parts.push(product.name);
    if (product.brand) parts.push(`Brand: ${product.brand}`);
    if (product.description) parts.push(product.description);
    if (product.barcode) parts.push(`Barcode: ${product.barcode}`);
    if (product.prices?.length) {
      parts.push("\nPrices:");
      for (const p of product.prices) {
        parts.push(`  ${p.source}: ${p.price}`);
      }
    }
    try {
      await Share.share({ message: parts.join("\n") });
    } catch (err) {
      logger.warn("Product", "Product share failed", err);
    }
  }, [product]);

  if (!visible) return null;

  if (!device) {
    return (
      <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
        <Text style={[styles.errorText, { color: colors.errorText }]}>No camera device found</Text>
        <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: colors.cardBg }]}>
          <Text style={[styles.closeBtnText, { color: colors.primaryText }]}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
        <Text style={[styles.permText, { color: colors.primaryText }]}>Camera permission required</Text>
        <TouchableOpacity onPress={requestPermission} style={[styles.permBtn, { backgroundColor: colors.primary }]} accessibilityRole="button" accessibilityLabel="Grant camera permission" accessibilityHint="Opens system permission dialog for camera access">
          <Text style={[styles.permBtnText, { color: colors.destructiveText }]}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera view (always active for scanning) */}
      {phase === "scanning" && (
        <View style={styles.cameraContainer}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={visible && phase === "scanning"}
            codeScanner={codeScanner}
          />
          {/* Scanning overlay */}
          <View style={styles.scanOverlay}>
            <View style={styles.scanFrame}>
              <View style={[styles.scanCorner, styles.scanCornerTL, { borderColor: colors.primary }]} />
              <View style={[styles.scanCorner, styles.scanCornerTR, { borderColor: colors.primary }]} />
              <View style={[styles.scanCorner, styles.scanCornerBL, { borderColor: colors.primary }]} />
              <View style={[styles.scanCorner, styles.scanCornerBR, { borderColor: colors.primary }]} />
            </View>
            <Text style={styles.scanHint}>Point camera at a barcode or QR code</Text>
            {/* Fallback for products without a barcode (loose produce,
                imported items, things where the barcode is damaged or
                hidden). Switches to the OCR phase which uses the device
                vision OCR to read brand/name text off packaging and
                feeds it into searchProductByText. */}
            <TouchableOpacity
              onPress={enterOCRPhase}
              style={[styles.fallbackBtn, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Identify product by text on packaging"
              accessibilityHint="Switches to OCR mode to read product name from packaging"
            >
              <Text style={[styles.fallbackBtnText, { color: colors.destructiveText }]}>
                No barcode? Identify by text →
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* OCR (text-based identification) phase */}
      {phase === "ocr" && (
        <View style={styles.cameraContainer}>
          <OCRCamera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={visible && phase === "ocr"}
            mode="recognize"
            options={{ language: "latin" }}
            callback={handleOCRFrame}
          />
          <View style={styles.scanOverlay}>
            <View style={styles.scanFrame}>
              <View style={[styles.scanCorner, styles.scanCornerTL, { borderColor: colors.primary }]} />
              <View style={[styles.scanCorner, styles.scanCornerTR, { borderColor: colors.primary }]} />
              <View style={[styles.scanCorner, styles.scanCornerBL, { borderColor: colors.primary }]} />
              <View style={[styles.scanCorner, styles.scanCornerBR, { borderColor: colors.primary }]} />
            </View>
            <Text style={styles.scanHint}>
              Point at the brand or product name on the packaging
            </Text>
          </View>
          {/* Live OCR preview + Search button at the bottom */}
          <View style={styles.ocrBottomBar}>
            <View style={[styles.ocrPreview, { backgroundColor: "rgba(0,0,0,0.65)" }]}>
              <Text style={styles.ocrPreviewLabel}>Detected text</Text>
              <Text style={styles.ocrPreviewText} numberOfLines={2}>
                {ocrText || "Looking for text…"}
              </Text>
            </View>
            <View style={styles.ocrActionsRow}>
              <TouchableOpacity
                onPress={resetScan}
                style={[styles.actionBtn, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderWidth: 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Back to barcode scanning"
                accessibilityHint="Returns to the barcode scanner view"
              >
                <Text style={[styles.actionBtnText, { color: colors.primary }]}>Back to Barcode</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleTextSearch}
                disabled={!ocrText.trim()}
                style={[
                  styles.actionBtn,
                  { backgroundColor: ocrText.trim() ? colors.primary : colors.cardBg },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Search for this product"
                accessibilityHint="Looks up the detected text to find product information"
                accessibilityState={{ disabled: !ocrText.trim() }}
              >
                <Text style={[styles.actionBtnText, { color: ocrText.trim() ? colors.destructiveText : colors.mutedText }]}>
                  Search
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Loading state */}
      {phase === "loading" && (
        <View style={[styles.resultContainer, { backgroundColor: colors.safeBg }]}>
          <GlassBackdrop />
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.primaryText }]}>
            Looking up {scannedCode}...
          </Text>
        </View>
      )}

      {/* Not found */}
      {phase === "not_found" && (
        <View style={[styles.resultContainer, { backgroundColor: colors.safeBg }]}>
          <GlassBackdrop />
          <Text style={styles.notFoundIcon}>🔍</Text>
          <Text style={[styles.notFoundTitle, { color: colors.primaryText }]}>Product Not Found</Text>
          <Text style={[styles.notFoundCode, { color: colors.mutedText }]}>
            Barcode: {scannedCode}
          </Text>
          {error && <Text style={[styles.errorMsg, { color: colors.errorText }]}>{error}</Text>}

          {/* Marketplace search links */}
          <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Search Online</Text>
          <View style={styles.linksRow}>
            {getMarketplaceLinks(scannedCode || "").map((link) => (
              <TouchableOpacity
                key={link.name}
                style={[styles.linkPill, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
                onPress={() => Linking.openURL(link.url)}
                accessibilityRole="link"
                accessibilityLabel={`Search on ${link.name}`}
                accessibilityHint={`Opens ${link.name} in browser`}
              >
                <Text style={styles.linkIcon}>{link.icon}</Text>
                <Text style={[styles.linkText, { color: colors.primary }]}>{link.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              onPress={enterOCRPhase}
              style={[styles.actionBtn, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderWidth: 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Identify by text on packaging"
              accessibilityHint="Switches to OCR mode to read product name from packaging"
            >
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>Identify by Text</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={resetScan} style={[styles.actionBtn, { backgroundColor: colors.primary }]} accessibilityRole="button" accessibilityLabel="Scan another product" accessibilityHint="Returns to the barcode scanner to scan a different product">
              <Text style={[styles.actionBtnText, { color: colors.destructiveText }]}>Scan Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Product results */}
      {phase === "results" && product && (
        <View style={[styles.resultContainer, { backgroundColor: colors.safeBg, padding: 0 }]}>
          <GlassBackdrop />
          <ScrollView style={styles.flex} contentContainerStyle={[styles.resultContent, { paddingHorizontal: 20 }]}>
          {/* Product header */}
          <View style={[styles.productHeader, { backgroundColor: colors.glassBgStrong, borderColor: colors.glassBorder }]}>
            {product.imageUrl && (
              <Image source={{ uri: product.imageUrl }} style={styles.productImage} resizeMode="contain" />
            )}
            <Text style={[styles.productName, { color: colors.primaryText }]}>{product.name}</Text>
            {product.brand && (
              <Text style={[styles.productBrand, { color: colors.mutedText }]}>{product.brand}</Text>
            )}
            {product.description && (
              <Text style={[styles.productDesc, { color: colors.secondaryText }]} numberOfLines={3}>
                {product.description}
              </Text>
            )}
            {product.barcode && (
              <TouchableOpacity onPress={() => copyText(product.barcode!)} accessibilityRole="button" accessibilityLabel={`Copy barcode ${product.barcode}`} accessibilityHint="Copies the barcode number to clipboard">
                <Text style={[styles.barcodeText, { color: colors.dimText }]}>
                  {copiedText === product.barcode ? "Copied!" : `Barcode: ${product.barcode}`}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Prices */}
          {product.prices && product.prices.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Prices Found</Text>
              {product.prices.map((price, i) => (
                <TouchableOpacity
                  key={`${price.source}-${i}`}
                  style={[styles.priceRow, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
                  onPress={() => price.url && Linking.openURL(price.url)}
                  disabled={!price.url}
                  accessibilityRole={price.url ? "link" : "text"}
                  accessibilityLabel={`${price.source}: ${price.price}`}
                  accessibilityHint={price.url ? `Opens ${price.source} in browser` : undefined}
                >
                  <Text style={[styles.priceSource, { color: colors.primaryText }]}>{price.source}</Text>
                  <Text style={[styles.priceValue, { color: colors.successText }]}>{price.price}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Attributes */}
          {product.attributes && product.attributes.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Details</Text>
              {product.attributes.map((attr, i) => (
                <TouchableOpacity
                  key={`${attr.label}-${i}`}
                  style={[styles.attrRow, { borderBottomColor: colors.borderLight }]}
                  onPress={() => copyText(attr.value)}
                  accessibilityRole="button"
                  accessibilityLabel={`${attr.label}: ${attr.value}`}
                  accessibilityHint="Tap to copy this value to clipboard"
                >
                  <Text style={[styles.attrLabel, { color: colors.mutedText }]}>{attr.label}</Text>
                  <Text style={[styles.attrValue, { color: colors.primaryText }]} numberOfLines={2}>
                    {copiedText === attr.value ? "Copied!" : attr.value}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Marketplace links */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Find Online</Text>
            <View style={styles.linksRow}>
              {getMarketplaceLinks(product.name).map((link) => (
                <TouchableOpacity
                  key={link.name}
                  style={[styles.linkPill, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
                  onPress={() => Linking.openURL(link.url)}
                  accessibilityRole="link"
                  accessibilityLabel={`Search on ${link.name}`}
                  accessibilityHint={`Opens ${link.name} in browser to search for this product`}
                >
                  <Text style={styles.linkIcon}>{link.icon}</Text>
                  <Text style={[styles.linkText, { color: colors.primary }]}>{link.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity onPress={shareProduct} style={[styles.actionBtn, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderWidth: 1 }]} accessibilityRole="button" accessibilityLabel="Share product details" accessibilityHint="Opens the share sheet with product information">
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={resetScan} style={[styles.actionBtn, { backgroundColor: colors.primary }]} accessibilityRole="button" accessibilityLabel="Scan another product" accessibilityHint="Returns to the barcode scanner to scan a different product">
              <Text style={[styles.actionBtnText, { color: colors.destructiveText }]}>Scan Again</Text>
            </TouchableOpacity>
          </View>
          </ScrollView>
        </View>
      )}

      {/* Back button (always visible) */}
      <TouchableOpacity
        style={[styles.backBtn, { backgroundColor: colors.cardBg + "CC" }]}
        onPress={phase === "scanning" ? onClose : resetScan}
        accessibilityRole="button"
        accessibilityLabel={phase === "scanning" ? "Close product scanner" : "Back to scanning"}
        accessibilityHint={phase === "scanning" ? "Closes the product scanner" : "Returns to the scanner view"}
        hitSlop={10}
      >
        <Text style={[styles.backBtnText, { color: colors.primaryText }]}>
          {phase === "scanning" ? "✕" : "←"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default React.memo(ProductScanner);

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  cameraContainer: { flex: 1 },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    width: 260,
    height: 260,
    position: "relative",
  },
  scanCorner: {
    position: "absolute",
    width: 40,
    height: 40,
    borderWidth: 3,
  },
  scanCornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 12 },
  scanCornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 12 },
  scanCornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 12 },
  scanCornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 12 },
  scanHint: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
    marginTop: 24,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  resultContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  resultContent: { paddingBottom: 40, paddingTop: 60 },
  loadingText: { fontSize: 16, fontWeight: "600", marginTop: 16 },
  notFoundIcon: { fontSize: 48, marginBottom: 12 },
  notFoundTitle: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  notFoundCode: { fontSize: 14, marginBottom: 16 },
  errorMsg: { fontSize: 13, marginBottom: 12 },
  errorText: { fontSize: 16, textAlign: "center", padding: 40 },
  permText: { fontSize: 18, fontWeight: "600", marginBottom: 16, textAlign: "center" },
  permBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  productHeader: {
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 1,
    width: "100%",
  },
  productImage: { width: 160, height: 160, marginBottom: 12, borderRadius: 8 },
  productName: { fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 4 },
  productBrand: { fontSize: 15, fontWeight: "600", marginBottom: 8 },
  productDesc: { fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 8 },
  barcodeText: { fontSize: 12, marginTop: 4 },
  section: { width: "100%", marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
  },
  priceSource: { fontSize: 15, fontWeight: "600" },
  priceValue: { fontSize: 17, fontWeight: "700" },
  attrRow: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  attrLabel: { fontSize: 13, fontWeight: "600", width: 100 },
  attrValue: { fontSize: 14, flex: 1 },
  linksRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  linkPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  linkIcon: { fontSize: 16 },
  linkText: { fontSize: 14, fontWeight: "600" },
  actionsRow: { flexDirection: "row", gap: 12, marginTop: 8, width: "100%" },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  actionBtnText: { fontSize: 15, fontWeight: "700" },
  backBtn: {
    position: "absolute",
    top: Platform.OS === "android" ? 10 : 0,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
  },
  backBtnText: { fontSize: 18, fontWeight: "700" },
  closeBtnText: { fontSize: 16 },
  permBtnText: { fontWeight: "700" },
  closeBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, marginTop: 16 },
  fallbackBtn: {
    marginTop: 32,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  fallbackBtnText: { fontSize: 14, fontWeight: "700" },
  ocrBottomBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: Platform.OS === "ios" ? 40 : 24,
    gap: 10,
  },
  ocrPreview: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  ocrPreviewLabel: {
    color: "#bbb",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  ocrPreviewText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  ocrActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
});
