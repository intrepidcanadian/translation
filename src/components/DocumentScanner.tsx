import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Share,
  Alert,
  Animated,
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
import { translateText, translateAppleBatch, type TranslationProvider } from "../services/translation";
import { logger } from "../services/logger";
import {
  getScannerMode,
  type ScannerModeKey,
  type ExtractedField,
} from "../services/scannerModes";
import { saveNote } from "../services/notes";
import { copyWithAutoClear } from "../services/clipboard";
import { notifySuccess, impactMedium } from "../services/haptics";
import type { ThemeColors } from "../theme";
import CameraPhase from "./scanner/CameraPhase";
import ProcessingPhase from "./scanner/ProcessingPhase";
import ResultsPhase from "./scanner/ResultsPhase";

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
  translationProvider?: TranslationProvider;
  hapticsEnabled?: boolean;
  colors: ThemeColors;
  initialMode?: ScannerModeKey;
  onNoteSaved?: () => void;
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

type Phase = "camera" | "processing" | "results";

function DocumentScanner({
  visible,
  onClose,
  sourceLangCode,
  targetLangCode,
  translationProvider,
  colors,
  initialMode = "document",
  onNoteSaved,
}: DocumentScannerProps) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);
  const [phase, setPhase] = useState<Phase>("camera");
  const [processingStep, setProcessingStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<ScannerModeKey>(initialMode);

  // Results
  const [originalText, setOriginalText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [modeFields, setModeFields] = useState<ExtractedField[]>([]);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);

  const mode = getScannerMode(selectedMode);

  // Phase transition animations
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  const animatePhaseChange = useCallback((newPhase: Phase) => {
    // Fade out current phase
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setPhase(newPhase);
      // Set slide start position based on destination
      slideAnim.setValue(newPhase === "results" ? 30 : newPhase === "camera" ? -30 : 0);
      // Fade + slide in new phase
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    if (visible && !hasPermission) {
      requestPermission();
    }
  }, [visible, hasPermission, requestPermission]);

  useEffect(() => {
    if (visible) {
      setPhase("camera");
      setOriginalText("");
      setTranslatedText("");
      setAnalysis(null);
      setModeFields([]);
      setError(null);
      setNoteSaved(false);
      setSelectedMode(initialMode);
    }
  }, [visible, initialMode]);

  const copyText = useCallback(async (text: string) => {
    try {
      // copyWithAutoClear: scanned documents frequently contain sensitive
      // data (receipts, medical forms, IDs). 60s auto-wipe. (#128)
      await copyWithAutoClear(text);
      notifySuccess();
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 1500);
    } catch (err) {
      logger.warn("Scanner", "Copy to clipboard failed", err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (noteSaved) return;
    const formatted = mode.formatNotes(originalText, translatedText, modeFields);
    const firstLine = translatedText.split("\n")[0]?.slice(0, 60) || "Untitled";

    try {
      await saveNote({
        title: `${mode.icon} ${firstLine}`,
        originalText,
        translatedText,
        formattedNote: formatted,
        scanMode: selectedMode,
        sourceLang: sourceLangCode,
        targetLang: targetLangCode,
        fields: modeFields.map((f) => ({ label: f.label, value: f.value })),
      });
      setNoteSaved(true);
      notifySuccess();
      onNoteSaved?.();
    } catch (err) {
      logger.warn("Notes", "Failed to save scanned note", err);
      const reason = err instanceof Error && err.message ? err.message : "Unknown error";
      Alert.alert("Error", `Failed to save note: ${reason}`);
    }
  }, [noteSaved, modeFields, mode, originalText, translatedText, selectedMode, sourceLangCode, targetLangCode, onNoteSaved]);

  const shareResults = useCallback(async () => {
    const sections: string[] = [];
    sections.push(`=== ${mode.label.toUpperCase()} SCAN REPORT ===\n`);

    if (analysis?.detectedLanguage) {
      sections.push(`Detected Language: ${analysis.detectedLanguage}`);
    }
    if (analysis) {
      sections.push(`Words: ${analysis.wordCount} | Sentences: ${analysis.sentenceCount}\n`);
    }

    if (modeFields.length > 0) {
      sections.push("--- KEY INFORMATION ---");
      for (const f of modeFields) {
        sections.push(`${f.label}: ${f.value}`);
      }
      sections.push("");
    }

    sections.push("--- TRANSLATED TEXT ---");
    sections.push(translatedText);
    sections.push("\n--- ORIGINAL TEXT ---");
    sections.push(originalText);

    if (selectedMode === "document" && analysis) {
      const entities: string[] = [];
      if (analysis.persons.length > 0) entities.push(`People: ${analysis.persons.join(", ")}`);
      if (analysis.organizations.length > 0) entities.push(`Organizations: ${analysis.organizations.join(", ")}`);
      if (analysis.places.length > 0) entities.push(`Places: ${analysis.places.join(", ")}`);
      if (entities.length > 0) {
        sections.push("\n--- ENTITIES ---");
        sections.push(entities.join("\n"));
      }
    }

    try {
      await Share.share({ message: sections.join("\n") });
    } catch (err) { logger.warn("OCR", "Document share failed", err); }
  }, [mode, originalText, translatedText, analysis, modeFields, selectedMode]);

  const captureAndAnalyze = useCallback(async () => {
    if (!cameraRef.current) return;
    impactMedium();

    animatePhaseChange("processing");
    setError(null);
    setNoteSaved(false);

    try {
      // Step 1: Capture
      setProcessingStep("Capturing image...");
      const photo: PhotoFile = await cameraRef.current.takePhoto({
        enableShutterSound: true,
      });
      const imageUri = Platform.OS === "android" ? `file://${photo.path}` : photo.path;

      // Step 2: OCR
      setProcessingStep("Reading text (on-device OCR)...");
      const script = getMLKitScript(sourceLangCode);
      const result = await TextRecognition.recognize(imageUri, script);

      if (!result.blocks.length) {
        setError("No text detected. Try again with a clearer photo.");
        animatePhaseChange("camera");
        return;
      }

      const fullText = result.blocks.map((b) => b.text).join("\n");
      setOriginalText(fullText);

      // Step 3: On-device NER analysis (iOS only via Apple NaturalLanguage)
      setProcessingStep("Analyzing with on-device AI...");
      let docAnalysis: DocumentAnalysis;

      if (Platform.OS === "ios") {
        try {
          const AppleTranslation = require("../../../modules/apple-translation");
          docAnalysis = await AppleTranslation.analyzeDocument(fullText);
        } catch (err) {
          logger.warn("OCR", "Apple NER analysis failed, using basic", err);
          docAnalysis = basicAnalysis(fullText);
        }
      } else {
        docAnalysis = basicAnalysis(fullText);
      }

      setAnalysis(docAnalysis);

      // Step 4: Translate
      setProcessingStep("Translating...");
      const srcLang = sourceLangCode === "autodetect"
        ? (docAnalysis.detectedLanguage || "en")
        : sourceLangCode;

      const paragraphs = fullText.split("\n").filter((p) => p.trim());
      let translated: string;

      if (translationProvider === "apple" && Platform.OS === "ios" && paragraphs.length > 1) {
        try {
          const results = await translateAppleBatch(paragraphs, srcLang, targetLangCode);
          translated = results.join("\n");
        } catch (err) {
          logger.warn("Translation", "Batch translation failed, falling back to sequential", err);
          const results: string[] = [];
          for (const para of paragraphs) {
            const res = await translateText(para, srcLang, targetLangCode, {
              provider: translationProvider,
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
            provider: translationProvider,
          });
          results.push(res.translatedText);
        }
        translated = results.join("\n");
      }

      setTranslatedText(translated);

      // Step 5: Mode-specific field extraction
      setProcessingStep("Extracting key information...");
      const currentMode = getScannerMode(selectedMode);
      const fields = currentMode.extractFields(fullText, translated);
      setModeFields(fields);

      // Step 6: Also analyze translated text for additional NER entities
      if (Platform.OS === "ios") {
        try {
          const AppleTranslation = require("../../../modules/apple-translation");
          const translatedAnalysis = await AppleTranslation.analyzeDocument(translated);
          setAnalysis((prev) => {
            if (!prev) return docAnalysis;
            return {
              ...prev,
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
        } catch (err) { logger.warn("OCR", "Translated text analysis failed", err); }
      }

      animatePhaseChange("results");
      notifySuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      animatePhaseChange("camera");
    }
  }, [sourceLangCode, targetLangCode, translationProvider, selectedMode, animatePhaseChange]);

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

  const phaseStyle = { opacity: fadeAnim, transform: [{ translateY: slideAnim }] };

  if (phase === "processing") {
    return (
      <Animated.View style={[styles.container, phaseStyle]}>
        <ProcessingPhase modeIcon={mode.icon} processingStep={processingStep} />
      </Animated.View>
    );
  }

  if (phase === "results") {
    return (
      <Animated.View style={[styles.container, phaseStyle]}>
        <ResultsPhase
          colors={colors}
          modeIcon={mode.icon}
          modeLabel={mode.label}
          selectedMode={selectedMode}
          originalText={originalText}
          translatedText={translatedText}
          analysis={analysis}
          modeFields={modeFields}
          copiedText={copiedText}
          noteSaved={noteSaved}
          onRescan={() => animatePhaseChange("camera")}
          onClose={onClose}
          onCopy={copyText}
          onSaveNote={handleSaveNote}
          onShare={shareResults}
        />
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.container, phaseStyle]}>
      <CameraPhase
        cameraRef={cameraRef}
        device={device}
        visible={visible && phase === "camera"}
        selectedMode={selectedMode}
        modeLabel={mode.label}
        modeIcon={mode.icon}
        modeInstruction={mode.instruction}
        sourceLangCode={sourceLangCode}
        targetLangCode={targetLangCode}
        error={error}
        onSelectMode={setSelectedMode}
        onCapture={captureAndAnalyze}
        onClose={onClose}
      />
    </Animated.View>
  );
}

export default React.memo(DocumentScanner);

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
});
