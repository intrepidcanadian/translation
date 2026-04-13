// PriceTagConverter — Scan any price tag → instant multi-currency conversion
// Point camera at price tag, captures photo, extracts all prices via OCR,
// shows instant conversion to HKD, CNY, TWD, JPY, USD, KRW, EUR and more.
// Uses cached or live exchange rates with offline fallback.

import React, { useRef, useState, useEffect, useCallback } from "react";
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
import TextRecognition, {
  TextRecognitionScript,
} from "@react-native-ml-kit/text-recognition";
import * as Clipboard from "expo-clipboard";
import { impactMedium, impactLight, notifySuccess } from "../services/haptics";
import { logger } from "../services/logger";
import {
  detectPricesInText,
  convertPrice,
  parsePrice,
  CURRENCIES,
  CREW_CURRENCIES,
  type ConvertedPrice,
} from "../services/currencyExchange";
import type { ThemeColors } from "../theme";

interface PriceTagConverterProps {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
  sourceLangCode?: string;
}

type Phase = "camera" | "processing" | "results";

interface DetectedPrice {
  raw: string;
  currency: string;
  amount: number;
  conversions: ConvertedPrice[];
}

function getMLKitScript(langCode: string): TextRecognitionScript {
  switch (langCode) {
    case "zh": return TextRecognitionScript.CHINESE;
    case "ja": return TextRecognitionScript.JAPANESE;
    case "ko": return TextRecognitionScript.KOREAN;
    case "hi": return TextRecognitionScript.DEVANAGARI;
    default: return TextRecognitionScript.LATIN;
  }
}

export default function PriceTagConverter({
  visible,
  onClose,
  colors,
  sourceLangCode = "en",
}: PriceTagConverterProps) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);

  const [phase, setPhase] = useState<Phase>("camera");
  const [processingStep, setProcessingStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [detectedPrices, setDetectedPrices] = useState<DetectedPrice[]>([]);
  const [rawText, setRawText] = useState("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [ratesAge, setRatesAge] = useState<string>("");

  useEffect(() => {
    if (visible && !hasPermission) {
      requestPermission();
    }
  }, [visible, hasPermission, requestPermission]);

  const captureAndConvert = useCallback(async () => {
    if (!cameraRef.current) return;
    impactMedium();

    setPhase("processing");
    setError(null);
    setDetectedPrices([]);
    setExpandedIdx(null);

    try {
      // Step 1: Capture
      setProcessingStep("Capturing price tag...");
      const photo: PhotoFile = await cameraRef.current.takePhoto({
        enableShutterSound: true,
      });
      const imageUri = Platform.OS === "android" ? `file://${photo.path}` : photo.path;

      // Step 2: OCR
      setProcessingStep("Reading text...");
      const script = getMLKitScript(sourceLangCode);
      const result = await TextRecognition.recognize(imageUri, script);

      if (!result.blocks.length) {
        setError("No text detected. Try again with a clearer photo.");
        setPhase("camera");
        return;
      }

      const fullText = result.blocks.map((b) => b.text).join("\n");
      setRawText(fullText);

      // Step 3: Detect prices
      setProcessingStep("Detecting prices...");
      const prices = detectPricesInText(fullText);

      if (prices.length === 0) {
        setError("No prices found in image. Try pointing at a price tag.");
        setPhase("camera");
        return;
      }

      // Step 4: Convert all prices
      setProcessingStep(`Converting ${prices.length} price${prices.length > 1 ? "s" : ""}...`);
      const converted: DetectedPrice[] = [];

      for (const price of prices) {
        const conversions = await convertPrice(price.amount, price.currency);
        converted.push({
          raw: price.raw,
          currency: price.currency,
          amount: price.amount,
          conversions,
        });
      }

      // Determine rates freshness
      const { getExchangeRates } = require("../services/currencyExchange");
      const rates = await getExchangeRates();
      if (rates.timestamp === 0) {
        setRatesAge("Offline rates (approximate)");
      } else {
        const ageMin = Math.round((Date.now() - rates.timestamp) / 60000);
        setRatesAge(ageMin < 60 ? `Updated ${ageMin}m ago` : `Updated ${Math.round(ageMin / 60)}h ago`);
      }

      setDetectedPrices(converted);
      setPhase("results");
      notifySuccess();
    } catch (err) {
      logger.warn("Scanner", "Capture failed", err);
      setError(err instanceof Error ? err.message : "Conversion failed");
      setPhase("camera");
    }
  }, [sourceLangCode]);

  const copyConversion = useCallback(async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      notifySuccess();
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 1500);
    } catch (err) {
      logger.warn("Scanner", "Copy failed", err);
    }
  }, []);

  const shareAllConversions = useCallback(async () => {
    const lines: string[] = ["💱 Price Conversion\n"];
    for (const price of detectedPrices) {
      const meta = CURRENCIES[price.currency];
      lines.push(`Original: ${meta?.symbol ?? ""}${price.amount} ${price.currency}`);
      for (const conv of price.conversions) {
        lines.push(`  ${conv.flag} ${conv.formatted} ${conv.currency}`);
      }
      lines.push("");
    }
    if (ratesAge) lines.push(`\n${ratesAge}`);
    try {
      await Share.share({ message: lines.join("\n") });
    } catch (err) {
      logger.warn("Scanner", "Share failed", err);
    }
  }, [detectedPrices, ratesAge]);

  if (!visible) return null;

  if (!device || !hasPermission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.containerBg }]}>
        <View style={styles.centerContent}>
          <Text style={[styles.errorText, { color: colors.primaryText }]}>
            {!device ? "No camera found" : "Camera permission required"}
          </Text>
          {!hasPermission && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} onPress={requestPermission}>
              <Text style={styles.actionBtnText}>Grant Permission</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={styles.closeLink}>
            <Text style={[styles.closeLinkText, { color: colors.primary }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Camera phase
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

        {/* Frame guide */}
        <View style={styles.frameGuide}>
          <View style={[styles.frameCorner, styles.frameTL]} />
          <View style={[styles.frameCorner, styles.frameTR]} />
          <View style={[styles.frameCorner, styles.frameBL]} />
          <View style={[styles.frameCorner, styles.frameBR]} />
        </View>

        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.topButton} onPress={onClose}>
            <Text style={styles.topButtonText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>💱 Price Tag</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}

        {/* Bottom */}
        <View style={styles.bottomArea}>
          <Text style={styles.instructionText}>Point at a price tag</Text>
          <TouchableOpacity style={styles.captureButton} onPress={captureAndConvert} activeOpacity={0.7}>
            <View style={styles.captureInner}>
              <Text style={styles.captureIcon}>💱</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.hintText}>Instant multi-currency conversion</Text>
        </View>
      </View>
    );
  }

  // Processing phase
  if (phase === "processing") {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>💱</Text>
          <ActivityIndicator size="large" color="#6c63ff" />
          <Text style={styles.processingText}>{processingStep}</Text>
        </View>
      </View>
    );
  }

  // Results phase
  return (
    <ScrollView style={[styles.resultsContainer, { backgroundColor: colors.containerBg }]} contentContainerStyle={styles.resultsContent}>
      {/* Header */}
      <View style={styles.resultsHeader}>
        <Text style={[styles.resultsTitle, { color: colors.titleText }]}>💱 Price Conversion</Text>
        <Text style={[styles.ratesAge, { color: colors.mutedText }]}>{ratesAge}</Text>
      </View>

      {/* Price cards */}
      {detectedPrices.map((price, idx) => {
        const meta = CURRENCIES[price.currency];
        const isExpanded = expandedIdx === idx || detectedPrices.length === 1;

        return (
          <View key={`${price.raw}-${idx}`} style={[styles.priceCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            {/* Original price header */}
            <TouchableOpacity
              style={styles.priceCardHeader}
              onPress={() => {
                impactLight();
                setExpandedIdx(isExpanded && detectedPrices.length > 1 ? null : idx);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.originalPriceRow}>
                <Text style={styles.originalFlag}>{meta?.flag ?? "🏷️"}</Text>
                <View>
                  <Text style={[styles.originalAmount, { color: colors.primaryText }]}>
                    {meta?.symbol}{price.amount.toLocaleString(undefined, { minimumFractionDigits: meta?.decimals ?? 2, maximumFractionDigits: meta?.decimals ?? 2 })}
                  </Text>
                  <Text style={[styles.originalCurrency, { color: colors.mutedText }]}>
                    {price.currency} {meta?.name ? `· ${meta.name}` : ""}
                  </Text>
                </View>
              </View>
              {detectedPrices.length > 1 && (
                <Text style={[styles.expandArrow, { color: colors.mutedText }]}>
                  {isExpanded ? "▼" : "▶"}
                </Text>
              )}
            </TouchableOpacity>

            {/* Conversion grid */}
            {isExpanded && (
              <View style={styles.conversionsGrid}>
                {price.conversions.map((conv) => (
                  <TouchableOpacity
                    key={conv.currency}
                    style={[styles.conversionCell, { backgroundColor: colors.containerBg, borderColor: colors.borderLight }]}
                    onPress={() => copyConversion(`${conv.formatted} ${conv.currency}`)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.convFlag}>{conv.flag}</Text>
                    <Text style={[styles.convAmount, { color: colors.primaryText }]} numberOfLines={1} adjustsFontSizeToFit>
                      {copiedText === `${conv.formatted} ${conv.currency}` ? "Copied!" : conv.formatted}
                    </Text>
                    <Text style={[styles.convCode, { color: colors.mutedText }]}>{conv.currency}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        );
      })}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtnOutline, { borderColor: colors.border, backgroundColor: colors.cardBg }]}
          onPress={shareAllConversions}
        >
          <Text style={[styles.actionBtnOutlineText, { color: colors.primary }]}>↑ Share</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.primary }]}
          onPress={() => { setPhase("camera"); setError(null); }}
        >
          <Text style={styles.actionBtnText}>Scan Again</Text>
        </TouchableOpacity>
      </View>

      {/* Raw OCR text (collapsible) */}
      {rawText && (
        <View style={[styles.rawTextSection, { borderColor: colors.borderLight }]}>
          <Text style={[styles.rawTextLabel, { color: colors.mutedText }]}>Detected Text</Text>
          <Text style={[styles.rawTextContent, { color: colors.dimText }]} numberOfLines={5}>{rawText}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000", zIndex: 999 },
  centerContent: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  errorText: { fontSize: 18, fontWeight: "600", textAlign: "center", marginBottom: 16 },

  // Camera phase
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
  badge: { backgroundColor: "rgba(108,99,255,0.8)", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 16 },
  badgeText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  frameGuide: { position: "absolute", top: "25%", left: "10%", right: "10%", bottom: "35%" },
  frameCorner: { position: "absolute", width: 30, height: 30, borderColor: "#ffd93d" },
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
    width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: "#ffd93d",
    justifyContent: "center", alignItems: "center", marginBottom: 12,
  },
  captureInner: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: "rgba(255,215,61,0.2)",
    justifyContent: "center", alignItems: "center",
  },
  captureIcon: { fontSize: 28 },
  hintText: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: "600" },

  // Processing
  processingText: { color: "#fff", fontSize: 18, fontWeight: "600", marginTop: 24, textAlign: "center" },

  // Results
  resultsContainer: { flex: 1 },
  resultsContent: { padding: 16, paddingTop: 20, paddingBottom: 40 },
  resultsHeader: { alignItems: "center", marginBottom: 16 },
  resultsTitle: { fontSize: 22, fontWeight: "800" },
  ratesAge: { fontSize: 12, marginTop: 4 },

  priceCard: { borderRadius: 16, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  priceCardHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 16,
  },
  originalPriceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  originalFlag: { fontSize: 32 },
  originalAmount: { fontSize: 24, fontWeight: "800" },
  originalCurrency: { fontSize: 12, marginTop: 1 },
  expandArrow: { fontSize: 14 },

  conversionsGrid: {
    flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8, paddingBottom: 12, gap: 6,
  },
  conversionCell: {
    width: "31%", borderRadius: 10, borderWidth: 1, padding: 10, alignItems: "center",
  },
  convFlag: { fontSize: 20, marginBottom: 4 },
  convAmount: { fontSize: 14, fontWeight: "700", textAlign: "center" },
  convCode: { fontSize: 10, fontWeight: "600", marginTop: 2 },

  actionsRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  actionBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  actionBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  actionBtnOutline: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", borderWidth: 1 },
  actionBtnOutlineText: { fontSize: 15, fontWeight: "700" },

  rawTextSection: { marginTop: 20, borderTopWidth: 1, paddingTop: 12 },
  rawTextLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  rawTextContent: { fontSize: 12, lineHeight: 18 },

  closeLink: { paddingVertical: 12 },
  closeLinkText: { fontSize: 16, fontWeight: "600" },
});
