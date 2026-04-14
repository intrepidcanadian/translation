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
import * as Clipboard from "expo-clipboard";
import { impactMedium, notifySuccess } from "../services/haptics";
import {
  lookupBarcode,
  searchProductByText,
  getMarketplaceLinks,
  type ProductInfo,
  type ProductSearchResult,
} from "../services/productLookup";
import type { ThemeColors } from "../theme";

interface ProductScannerProps {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
}

type Phase = "scanning" | "loading" | "results" | "not_found";

function ProductScanner({ visible, onClose, colors }: ProductScannerProps) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>("scanning");
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const lastScannedRef = useRef<string>("");

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
    lastScannedRef.current = "";
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
      await Clipboard.setStringAsync(text);
      notifySuccess();
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 1500);
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
      <View style={[styles.container, { backgroundColor: colors.containerBg }]}>
        <Text style={[styles.errorText, { color: colors.errorText }]}>No camera device found</Text>
        <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: colors.cardBg }]}>
          <Text style={{ color: colors.primaryText }}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.containerBg }]}>
        <Text style={[styles.permText, { color: colors.primaryText }]}>Camera permission required</Text>
        <TouchableOpacity onPress={requestPermission} style={[styles.permBtn, { backgroundColor: colors.primary }]}>
          <Text style={{ color: colors.destructiveText, fontWeight: "700" }}>Grant Permission</Text>
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
          </View>
        </View>
      )}

      {/* Loading state */}
      {phase === "loading" && (
        <View style={[styles.resultContainer, { backgroundColor: colors.containerBg }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.primaryText }]}>
            Looking up {scannedCode}...
          </Text>
        </View>
      )}

      {/* Not found */}
      {phase === "not_found" && (
        <View style={[styles.resultContainer, { backgroundColor: colors.containerBg }]}>
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
                style={[styles.linkPill, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
                onPress={() => Linking.openURL(link.url)}
                accessibilityLabel={`Search on ${link.name}`}
              >
                <Text style={styles.linkIcon}>{link.icon}</Text>
                <Text style={[styles.linkText, { color: colors.primary }]}>{link.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={resetScan} style={[styles.actionBtn, { backgroundColor: colors.primary }]}>
            <Text style={[styles.actionBtnText, { color: colors.destructiveText }]}>Scan Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Product results */}
      {phase === "results" && product && (
        <ScrollView style={[styles.resultContainer, { backgroundColor: colors.containerBg }]} contentContainerStyle={styles.resultContent}>
          {/* Product header */}
          <View style={[styles.productHeader, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
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
              <TouchableOpacity onPress={() => copyText(product.barcode!)}>
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
                  style={[styles.priceRow, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
                  onPress={() => price.url && Linking.openURL(price.url)}
                  disabled={!price.url}
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
                  style={[styles.linkPill, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
                  onPress={() => Linking.openURL(link.url)}
                  accessibilityLabel={`Search on ${link.name}`}
                >
                  <Text style={styles.linkIcon}>{link.icon}</Text>
                  <Text style={[styles.linkText, { color: colors.primary }]}>{link.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity onPress={shareProduct} style={[styles.actionBtn, { backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1 }]}>
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={resetScan} style={[styles.actionBtn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.actionBtnText, { color: colors.destructiveText }]}>Scan Again</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Back button (always visible) */}
      <TouchableOpacity
        style={[styles.backBtn, { backgroundColor: colors.cardBg + "CC" }]}
        onPress={phase === "scanning" ? onClose : resetScan}
        accessibilityLabel={phase === "scanning" ? "Close product scanner" : "Back to scanning"}
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
  closeBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, marginTop: 16 },
});
