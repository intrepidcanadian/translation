import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  ScrollView,
  Dimensions,
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
import { translateText, translateAppleBatch, type TranslateOptions } from "../services/translation";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

interface DocumentAnalysis {
  detectedLanguage: string | null;
  persons: string[];
  organizations: string[];
  places: string[];
  dates: string[];
  phoneNumbers: string[];
  urls: string[];
  addresses: string[];
  moneyAmounts: string[];
  sentenceCount: number;
  wordCount: number;
}

interface DocumentScannerProps {
  visible: boolean;
  onClose: () => void;
  sourceLangCode: string;
  targetLangCode: string;
  translationProvider?: string;
  apiKey?: string;
  hapticsEnabled?: boolean;
  colors: any;
}

// Map language codes to ML Kit scripts
function getMLKitScript(langCode: string): TextRecognitionScript {
  switch (langCode) {
    case "zh": return TextRecognitionScript.CHINESE;
    case "ja": return TextRecognitionScript.JAPANESE;
    case "ko": return TextRecognitionScript.KOREAN;
    case "hi": return TextRecognitionScript.DEVANAGARI;
    default: return TextRecognitionScript.LATIN;
  }
}

type AnalysisPhase = "camera" | "processing" | "results";

export default function DocumentScanner({
  visible,
  onClose,
  sourceLangCode,
  targetLangCode,
  translationProvider,
  apiKey,
  hapticsEnabled = true,
  colors,
}: DocumentScannerProps) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);
  const [phase, setPhase] = useState<AnalysisPhase>("camera");
  const [processingStep, setProcessingStep] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Results
  const [originalText, setOriginalText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    if (visible && !hasPermission) {
      requestPermission();
    }
  }, [visible, hasPermission, requestPermission]);

  // Reset state when opening
  useEffect(() => {
    if (visible) {
      setPhase("camera");
      setOriginalText("");
      setTranslatedText("");
      setAnalysis(null);
      setError(null);
    }
  }, [visible]);

  const copyText = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    if (hapticsEnabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 1500);
  }, [hapticsEnabled]);

  const shareResults = useCallback(async () => {
    const sections: string[] = [];
    sections.push("=== DOCUMENT INTELLIGENCE REPORT ===\n");

    if (analysis?.detectedLanguage) {
      sections.push(`Detected Language: ${analysis.detectedLanguage}`);
    }
    if (analysis) {
      sections.push(`Words: ${analysis.wordCount} | Sentences: ${analysis.sentenceCount}\n`);
    }

    sections.push("--- ORIGINAL TEXT ---");
    sections.push(originalText);
    sections.push("\n--- TRANSLATED TEXT ---");
    sections.push(translatedText);

    if (analysis) {
      const entities: string[] = [];
      if (analysis.persons.length > 0) entities.push(`People: ${analysis.persons.join(", ")}`);
      if (analysis.organizations.length > 0) entities.push(`Organizations: ${analysis.organizations.join(", ")}`);
      if (analysis.places.length > 0) entities.push(`Places: ${analysis.places.join(", ")}`);
      if (analysis.dates.length > 0) entities.push(`Dates: ${analysis.dates.join(", ")}`);
      if (analysis.moneyAmounts.length > 0) entities.push(`Amounts: ${analysis.moneyAmounts.join(", ")}`);
      if (analysis.phoneNumbers.length > 0) entities.push(`Phone Numbers: ${analysis.phoneNumbers.join(", ")}`);
      if (analysis.addresses.length > 0) entities.push(`Addresses: ${analysis.addresses.join(", ")}`);

      if (entities.length > 0) {
        sections.push("\n--- KEY INFORMATION ---");
        sections.push(entities.join("\n"));
      }
    }

    try {
      await Share.share({ message: sections.join("\n") });
    } catch {}
  }, [originalText, translatedText, analysis]);

  const captureAndAnalyze = useCallback(async () => {
    if (!cameraRef.current) return;
    if (hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    setPhase("processing");
    setError(null);

    try {
      // Step 1: Capture photo
      setProcessingStep("Capturing document...");
      const photo: PhotoFile = await cameraRef.current.takePhoto({
        enableShutterSound: true,
      });

      const imageUri = Platform.OS === "android" ? `file://${photo.path}` : photo.path;

      // Step 2: OCR
      setProcessingStep("Reading text (on-device OCR)...");
      const script = getMLKitScript(sourceLangCode);
      const result = await TextRecognition.recognize(imageUri, script);

      if (!result.blocks.length) {
        setError("No text detected in the image. Try again with a clearer photo.");
        setPhase("camera");
        return;
      }

      // Combine all text blocks into full document text
      const fullText = result.blocks.map((b) => b.text).join("\n");
      setOriginalText(fullText);

      // Step 3: Analyze original text with on-device NER
      setProcessingStep("Analyzing document (on-device AI)...");
      let docAnalysis: DocumentAnalysis;

      if (Platform.OS === "ios") {
        try {
          const AppleTranslation = require("../../../modules/apple-translation");
          docAnalysis = await AppleTranslation.analyzeDocument(fullText);
        } catch {
          // Fallback: basic analysis without native module
          docAnalysis = basicAnalysis(fullText);
        }
      } else {
        docAnalysis = basicAnalysis(fullText);
      }

      setAnalysis(docAnalysis);

      // Step 4: Translate the full document
      setProcessingStep("Translating document...");
      const srcLang = sourceLangCode === "autodetect"
        ? (docAnalysis.detectedLanguage || "en")
        : sourceLangCode;

      let translated: string;

      // For longer documents, translate paragraph by paragraph for better quality
      const paragraphs = fullText.split("\n").filter((p) => p.trim());

      if (translationProvider === "apple" && Platform.OS === "ios" && paragraphs.length > 1) {
        try {
          const results = await translateAppleBatch(paragraphs, srcLang, targetLangCode);
          translated = results.join("\n");
        } catch {
          // Fallback to sequential
          const results: string[] = [];
          for (const para of paragraphs) {
            const res = await translateText(para, srcLang, targetLangCode, {
              provider: translationProvider as any,
              apiKey,
            });
            results.push(res.translatedText);
          }
          translated = results.join("\n");
        }
      } else {
        const results: string[] = [];
        for (const para of paragraphs) {
          if (!para.trim()) { results.push(""); continue; }
          const res = await translateText(para, srcLang, targetLangCode, {
            provider: translationProvider as any,
            apiKey,
          });
          results.push(res.translatedText);
        }
        translated = results.join("\n");
      }

      setTranslatedText(translated);

      // Step 5: Also analyze the translated text for additional entity extraction
      setProcessingStep("Extracting key information...");
      if (Platform.OS === "ios") {
        try {
          const AppleTranslation = require("../../../modules/apple-translation");
          const translatedAnalysis = await AppleTranslation.analyzeDocument(translated);
          // Merge entities from translated text (might catch things missed in original)
          setAnalysis((prev) => {
            if (!prev) return docAnalysis;
            return {
              ...prev,
              // Merge, deduplicate
              persons: [...new Set([...prev.persons, ...translatedAnalysis.persons])],
              organizations: [...new Set([...prev.organizations, ...translatedAnalysis.organizations])],
              places: [...new Set([...prev.places, ...translatedAnalysis.places])],
              dates: [...new Set([...prev.dates, ...translatedAnalysis.dates])],
              moneyAmounts: [...new Set([...prev.moneyAmounts, ...translatedAnalysis.moneyAmounts])],
              phoneNumbers: [...new Set([...prev.phoneNumbers, ...translatedAnalysis.phoneNumbers])],
              urls: [...new Set([...prev.urls, ...translatedAnalysis.urls])],
              addresses: [...new Set([...prev.addresses, ...translatedAnalysis.addresses])],
            };
          });
        } catch {}
      }

      setPhase("results");
      if (hapticsEnabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setError(err?.message || "Document analysis failed");
      setPhase("camera");
    }
  }, [sourceLangCode, targetLangCode, translationProvider, apiKey, hapticsEnabled]);

  if (!visible) return null;

  if (!device) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>No camera device found</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>Camera permission required</Text>
          <TouchableOpacity style={styles.actionBtn} onPress={requestPermission}>
            <Text style={styles.actionBtnText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---- PROCESSING PHASE ----
  if (phase === "processing") {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#6c63ff" />
          <Text style={styles.processingStep}>{processingStep}</Text>
          <Text style={styles.processingHint}>All processing runs on-device</Text>
        </View>
      </View>
    );
  }

  // ---- RESULTS PHASE ----
  if (phase === "results") {
    const hasEntities = analysis && (
      analysis.persons.length > 0 ||
      analysis.organizations.length > 0 ||
      analysis.places.length > 0
    );
    const hasFlags = analysis && (
      analysis.moneyAmounts.length > 0 ||
      analysis.dates.length > 0 ||
      analysis.phoneNumbers.length > 0 ||
      analysis.addresses.length > 0 ||
      analysis.urls.length > 0
    );

    return (
      <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
        {/* Header */}
        <View style={[styles.resultsHeader, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => setPhase("camera")} accessibilityLabel="Scan another document">
            <Text style={[styles.headerAction, { color: colors.primary }]}>Rescan</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.titleText }]}>Document Intelligence</Text>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Close document scanner">
            <Text style={[styles.headerAction, { color: colors.primary }]}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.resultsScroll} contentContainerStyle={styles.resultsContent}>
          {/* Document stats bar */}
          {analysis && (
            <View style={[styles.statsBar, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
              {analysis.detectedLanguage && (
                <View style={styles.statChip}>
                  <Text style={[styles.statChipLabel, { color: colors.dimText }]}>Language</Text>
                  <Text style={[styles.statChipValue, { color: colors.primary }]}>{analysis.detectedLanguage.toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.statChip}>
                <Text style={[styles.statChipLabel, { color: colors.dimText }]}>Words</Text>
                <Text style={[styles.statChipValue, { color: colors.primary }]}>{analysis.wordCount}</Text>
              </View>
              <View style={styles.statChip}>
                <Text style={[styles.statChipLabel, { color: colors.dimText }]}>Sentences</Text>
                <Text style={[styles.statChipValue, { color: colors.primary }]}>{analysis.sentenceCount}</Text>
              </View>
            </View>
          )}

          {/* Key Information / Flags */}
          {hasFlags && (
            <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Key Information</Text>
              {analysis!.moneyAmounts.length > 0 && (
                <EntityRow icon="$" label="Money" items={analysis!.moneyAmounts} colors={colors} iconColor="#4ade80" />
              )}
              {analysis!.dates.length > 0 && (
                <EntityRow icon="D" label="Dates" items={analysis!.dates} colors={colors} iconColor="#f59e0b" />
              )}
              {analysis!.phoneNumbers.length > 0 && (
                <EntityRow icon="#" label="Phone" items={analysis!.phoneNumbers} colors={colors} iconColor="#60a5fa" />
              )}
              {analysis!.addresses.length > 0 && (
                <EntityRow icon="@" label="Addresses" items={analysis!.addresses} colors={colors} iconColor="#c084fc" />
              )}
              {analysis!.urls.length > 0 && (
                <EntityRow icon="~" label="Links" items={analysis!.urls} colors={colors} iconColor="#22d3ee" />
              )}
            </View>
          )}

          {/* Named Entities */}
          {hasEntities && (
            <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.titleText }]}>People, Places & Organizations</Text>
              {analysis!.persons.length > 0 && (
                <EntityRow icon="P" label="People" items={analysis!.persons} colors={colors} iconColor="#f472b6" />
              )}
              {analysis!.organizations.length > 0 && (
                <EntityRow icon="O" label="Orgs" items={analysis!.organizations} colors={colors} iconColor="#a78bfa" />
              )}
              {analysis!.places.length > 0 && (
                <EntityRow icon="L" label="Places" items={analysis!.places} colors={colors} iconColor="#34d399" />
              )}
            </View>
          )}

          {/* Translated text */}
          <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Translation</Text>
              <TouchableOpacity onPress={() => copyText(translatedText)} accessibilityLabel="Copy translation">
                <Text style={[styles.copyAction, { color: colors.primary }]}>
                  {copiedText === translatedText ? "Copied!" : "Copy"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.documentText, { color: colors.translatedText }]} selectable>
              {translatedText}
            </Text>
          </View>

          {/* Original text */}
          <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Original Text</Text>
              <TouchableOpacity onPress={() => copyText(originalText)} accessibilityLabel="Copy original text">
                <Text style={[styles.copyAction, { color: colors.primary }]}>
                  {copiedText === originalText ? "Copied!" : "Copy"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.documentText, { color: colors.secondaryText }]} selectable>
              {originalText}
            </Text>
          </View>

          {/* Share button */}
          <TouchableOpacity
            style={[styles.shareButton, { backgroundColor: colors.primary }]}
            onPress={shareResults}
            accessibilityLabel="Share document analysis"
          >
            <Text style={styles.shareButtonText}>Share Full Report</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    );
  }

  // ---- CAMERA PHASE ----
  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={visible && phase === "camera"}
        photo={true}
        preview={true}
      />

      {/* Document framing guide */}
      <View style={styles.frameGuide}>
        <View style={[styles.frameCorner, styles.frameTL]} />
        <View style={[styles.frameCorner, styles.frameTR]} />
        <View style={[styles.frameCorner, styles.frameBL]} />
        <View style={[styles.frameCorner, styles.frameBR]} />
      </View>

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topButton} onPress={onClose} accessibilityLabel="Close document scanner">
          <Text style={styles.topButtonText}>X</Text>
        </TouchableOpacity>
        <View style={styles.docBadge}>
          <Text style={styles.docBadgeText}>Document Intelligence</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      {/* Bottom capture area */}
      <View style={styles.bottomArea}>
        <Text style={styles.instructionText}>
          Position document within frame and capture
        </Text>
        <TouchableOpacity
          style={styles.captureButton}
          onPress={captureAndAnalyze}
          activeOpacity={0.7}
          accessibilityLabel="Capture and analyze document"
        >
          <View style={styles.captureInner} />
        </TouchableOpacity>
        <Text style={styles.hintText}>
          {sourceLangCode.toUpperCase()} {"->"} {targetLangCode.toUpperCase()} | On-device AI
        </Text>
      </View>
    </View>
  );
}

// Entity display row component
function EntityRow({
  icon,
  label,
  items,
  colors,
  iconColor,
}: {
  icon: string;
  label: string;
  items: string[];
  colors: any;
  iconColor: string;
}) {
  return (
    <View style={entityStyles.row}>
      <View style={[entityStyles.iconBadge, { backgroundColor: iconColor + "22" }]}>
        <Text style={[entityStyles.iconText, { color: iconColor }]}>{icon}</Text>
      </View>
      <View style={entityStyles.content}>
        <Text style={[entityStyles.label, { color: colors.dimText }]}>{label}</Text>
        <View style={entityStyles.chips}>
          {items.map((item, i) => (
            <View key={i} style={[entityStyles.chip, { backgroundColor: colors.bubbleBg, borderColor: colors.border }]}>
              <Text style={[entityStyles.chipText, { color: colors.primaryText }]} numberOfLines={1}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// Fallback analysis for non-iOS platforms (regex-based)
function basicAnalysis(text: string): DocumentAnalysis {
  const moneyPattern = /(?:[$\u20AC\u00A3\u00A5\u20B9\u20A9\u0E3F])\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:dollars?|euros?|pounds?|yen|yuan|won|USD|EUR|GBP|JPY|CNY|KRW)/gi;
  const phonePattern = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
  const urlPattern = /https?:\/\/[^\s]+/gi;
  const emailPattern = /[\w.-]+@[\w.-]+\.\w+/gi;

  const moneyAmounts = [...new Set((text.match(moneyPattern) || []))];
  const phoneNumbers = [...new Set((text.match(phonePattern) || []).filter((p) => p.replace(/\D/g, "").length >= 7))];
  const urls = [...new Set([...(text.match(urlPattern) || []), ...(text.match(emailPattern) || [])])];

  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim());

  return {
    detectedLanguage: null,
    persons: [],
    organizations: [],
    places: [],
    dates: [],
    phoneNumbers,
    urls,
    addresses: [],
    moneyAmounts,
    sentenceCount: sentences.length,
    wordCount: words.length,
  };
}

const entityStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 12,
    gap: 10,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
  },
  iconText: {
    fontSize: 14,
    fontWeight: "800",
  },
  content: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    maxWidth: "90%",
  },
  chipText: {
    fontSize: 14,
  },
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    zIndex: 999,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  errorText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },
  actionBtn: {
    backgroundColor: "#6c63ff",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 12,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  closeBtn: {
    paddingVertical: 12,
  },
  closeBtnText: {
    color: "#6c63ff",
    fontSize: 16,
    fontWeight: "600",
  },
  // Processing
  processingStep: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 24,
    textAlign: "center",
  },
  processingHint: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    marginTop: 8,
  },
  // Camera phase
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 54 : 40,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  topButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  topButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  docBadge: {
    backgroundColor: "rgba(108,99,255,0.8)",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  docBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  // Frame guide
  frameGuide: {
    position: "absolute",
    top: "15%",
    left: "8%",
    right: "8%",
    bottom: "25%",
  },
  frameCorner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "#6c63ff",
  },
  frameTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 8,
  },
  frameTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 8,
  },
  frameBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  frameBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
  // Error
  errorBanner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 110 : 96,
    left: 20,
    right: 20,
    backgroundColor: "rgba(255,71,87,0.9)",
    borderRadius: 12,
    padding: 12,
  },
  errorBannerText: {
    color: "#fff",
    fontSize: 14,
    textAlign: "center",
  },
  // Bottom
  bottomArea: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingBottom: Platform.OS === "ios" ? 44 : 30,
    paddingTop: 16,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  instructionText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 16,
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#6c63ff",
  },
  hintText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "600",
  },
  // Results phase
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 54 : 40,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  headerAction: {
    fontSize: 16,
    fontWeight: "600",
  },
  resultsScroll: {
    flex: 1,
  },
  resultsContent: {
    padding: 16,
  },
  statsBar: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    justifyContent: "space-around",
  },
  statChip: {
    alignItems: "center",
  },
  statChipLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statChipValue: {
    fontSize: 20,
    fontWeight: "800",
    marginTop: 2,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  copyAction: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  documentText: {
    fontSize: 15,
    lineHeight: 22,
  },
  shareButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  shareButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
