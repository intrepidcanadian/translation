import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Platform,
  ActivityIndicator,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  type PhotoFile,
} from "react-native-vision-camera";
import TextRecognition, {
  type TextBlock,
  type TextLine,
  TextRecognitionScript,
} from "@react-native-ml-kit/text-recognition";
import { translateText, translateAppleBatch, type TranslateOptions } from "../services/translation";

interface DetectedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  frame: { top: number; left: number; width: number; height: number };
}

interface CameraTranslatorProps {
  visible: boolean;
  onClose: () => void;
  sourceLangCode: string;
  targetLangCode: string;
  translationProvider?: string;
  apiKey?: string;
  colors: any;
}

// Map language codes to ML Kit scripts for better recognition
function getMLKitScript(langCode: string): TextRecognitionScript {
  switch (langCode) {
    case "zh":
      return TextRecognitionScript.CHINESE;
    case "ja":
      return TextRecognitionScript.JAPANESE;
    case "ko":
      return TextRecognitionScript.KOREAN;
    case "hi":
      return TextRecognitionScript.DEVANAGARI;
    default:
      return TextRecognitionScript.LATIN;
  }
}

// Translation cache to avoid re-translating the same text
const ocrTranslationCache = new Map<string, string>();

export default function CameraTranslator({
  visible,
  onClose,
  sourceLangCode,
  targetLangCode,
  translationProvider,
  apiKey,
  colors,
}: CameraTranslatorProps) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);
  const [detectedBlocks, setDetectedBlocks] = useState<DetectedBlock[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const [screenDims, setScreenDims] = useState(() => Dimensions.get("window"));

  // Track screen dimensions for overlay mapping
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setScreenDims(window);
    });
    return () => sub.remove();
  }, []);

  // Request camera permission on mount
  useEffect(() => {
    if (visible && !hasPermission) {
      requestPermission();
    }
  }, [visible, hasPermission, requestPermission]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (scanIntervalRef.current) clearTimeout(scanIntervalRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // Clear cache when languages change
  useEffect(() => {
    ocrTranslationCache.clear();
    setDetectedBlocks([]);
  }, [sourceLangCode, targetLangCode]);

  // Periodic OCR scanning
  const scanFrame = useCallback(async () => {
    if (!cameraRef.current || isPaused || !isMountedRef.current) return;

    try {
      setIsProcessing(true);
      setError(null);

      // Take a lightweight snapshot from the preview
      const snapshot: PhotoFile = await cameraRef.current.takeSnapshot({
        quality: 70,
      });

      if (!isMountedRef.current) return;

      const imageUri =
        Platform.OS === "android"
          ? `file://${snapshot.path}`
          : snapshot.path;

      // Run ML Kit text recognition
      const script = getMLKitScript(sourceLangCode);
      const result = await TextRecognition.recognize(imageUri, script);

      if (!isMountedRef.current) return;

      if (!result.blocks.length) {
        setDetectedBlocks([]);
        return;
      }

      // Translate detected text blocks (use lines for better granularity)
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const blocks: DetectedBlock[] = [];
      const translateOptions: TranslateOptions = {
        provider: translationProvider as any,
        apiKey,
        signal: controller.signal,
      };

      // Collect all lines with their metadata
      const lines: Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }> = [];
      for (const block of result.blocks) {
        for (const line of block.lines) {
          if (!line.frame || !line.text.trim()) continue;
          lines.push({ text: line.text.trim(), frame: line.frame as { top: number; left: number; width: number; height: number } });
        }
      }

      // Separate cached vs uncached lines
      const cachedResults: Array<{ text: string; translated: string; frame: any }> = [];
      const uncachedLines: Array<{ text: string; frame: any; index: number }> = [];

      for (let i = 0; i < lines.length; i++) {
        const cacheKey = `${sourceLangCode}|${targetLangCode}|${lines[i].text}`;
        if (ocrTranslationCache.has(cacheKey)) {
          cachedResults.push({ text: lines[i].text, translated: ocrTranslationCache.get(cacheKey)!, frame: lines[i].frame });
        } else {
          uncachedLines.push({ text: lines[i].text, frame: lines[i].frame, index: i });
        }
      }

      // Batch translate uncached lines
      let translatedTexts: string[] = [];
      if (uncachedLines.length > 0 && !controller.signal.aborted) {
        try {
          // Use Apple batch API for much faster on-device translation
          if (translationProvider === "apple" && Platform.OS === "ios") {
            translatedTexts = await translateAppleBatch(
              uncachedLines.map((l) => l.text),
              sourceLangCode,
              targetLangCode
            );
          } else {
            // Fall back to sequential translation for other providers
            for (const line of uncachedLines) {
              if (controller.signal.aborted) break;
              try {
                const res = await translateText(line.text, sourceLangCode, targetLangCode, translateOptions);
                translatedTexts.push(res.translatedText);
              } catch {
                translatedTexts.push(line.text);
              }
            }
          }

          // Cache all results
          for (let i = 0; i < uncachedLines.length && i < translatedTexts.length; i++) {
            const cacheKey = `${sourceLangCode}|${targetLangCode}|${uncachedLines[i].text}`;
            ocrTranslationCache.set(cacheKey, translatedTexts[i]);
            if (ocrTranslationCache.size > 500) {
              const firstKey = ocrTranslationCache.keys().next().value;
              if (firstKey) ocrTranslationCache.delete(firstKey);
            }
          }
        } catch {
          // If batch fails, use original text as fallback
          translatedTexts = uncachedLines.map((l) => l.text);
        }
      }

      // Reconstruct blocks in original order
      let uncachedIdx = 0;
      for (const line of lines) {
        const cacheKey = `${sourceLangCode}|${targetLangCode}|${line.text}`;
        const cached = cachedResults.find((c) => c.text === line.text);
        const translated = cached
          ? cached.translated
          : (uncachedIdx < translatedTexts.length ? translatedTexts[uncachedIdx++] : line.text);

        blocks.push({
          id: `${line.frame.top}-${line.frame.left}-${line.text.slice(0, 10)}`,
          originalText: line.text,
          translatedText: translated,
          frame: line.frame,
        });
      }

      if (isMountedRef.current && !controller.signal.aborted) {
        setDetectedBlocks(blocks);
      }
    } catch (err: any) {
      if (isMountedRef.current && err?.name !== "AbortError") {
        setError(err?.message || "Camera scan failed");
      }
    } finally {
      if (isMountedRef.current) {
        setIsProcessing(false);
        // Schedule next scan
        if (!isPaused) {
          scanIntervalRef.current = setTimeout(scanFrame, 1500);
        }
      }
    }
  }, [isPaused, sourceLangCode, targetLangCode, translationProvider, apiKey]);

  // Start/stop scanning based on visibility and pause state
  useEffect(() => {
    if (visible && !isPaused && hasPermission && device) {
      // Small delay to let camera initialize
      scanIntervalRef.current = setTimeout(scanFrame, 1000);
    }
    return () => {
      if (scanIntervalRef.current) clearTimeout(scanIntervalRef.current);
      abortRef.current?.abort();
    };
  }, [visible, isPaused, hasPermission, device, scanFrame]);

  if (!visible) return null;

  if (!device) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>No camera device found</Text>
          <Text style={styles.errorSubtext}>
            Camera translation requires a physical device
          </Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Camera permission required</Text>
          <Text style={styles.errorSubtext}>
            Allow camera access to translate text in real time
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={requestPermission}
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera Preview */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={visible && !isPaused}
        photo={true}
        preview={true}
      />

      {/* Translation Overlays */}
      {detectedBlocks.map((block) => {
        // ML Kit frame coordinates are in image space — we need to map to screen space.
        // The snapshot dimensions match the preview aspect ratio, so we can use
        // percentage-based positioning relative to the screen.
        // ML Kit returns absolute pixel positions from the image.
        // We approximate by treating positions as proportional to screen dims.
        const overlayStyle = {
          position: "absolute" as const,
          top: block.frame.top,
          left: block.frame.left,
          minWidth: block.frame.width,
          minHeight: block.frame.height,
        };

        return (
          <View key={block.id} style={[styles.overlay, overlayStyle]}>
            <View style={styles.overlayBubble}>
              <Text style={styles.overlayTranslated} numberOfLines={2}>
                {block.translatedText}
              </Text>
              <Text style={styles.overlayOriginal} numberOfLines={1}>
                {block.originalText}
              </Text>
            </View>
          </View>
        );
      })}

      {/* Top Controls Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topButton}
          onPress={onClose}
          accessibilityLabel="Close camera translator"
        >
          <Text style={styles.topButtonText}>✕</Text>
        </TouchableOpacity>

        <View style={styles.langIndicator}>
          <Text style={styles.langText}>
            {sourceLangCode.toUpperCase()} → {targetLangCode.toUpperCase()}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.topButton, isPaused && styles.topButtonActive]}
          onPress={() => setIsPaused((p) => !p)}
          accessibilityLabel={isPaused ? "Resume scanning" : "Pause scanning"}
        >
          <Text style={styles.topButtonText}>{isPaused ? "▶" : "⏸"}</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Status Bar */}
      <View style={styles.bottomBar}>
        {isProcessing && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color="#a8a4ff" />
            <Text style={styles.statusText}>Scanning...</Text>
          </View>
        )}
        {isPaused && (
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>⏸ Paused — tap ▶ to resume</Text>
          </View>
        )}
        {error && (
          <View style={styles.statusRow}>
            <Text style={styles.errorStatusText}>⚠ {error}</Text>
          </View>
        )}
        {!isProcessing && !isPaused && !error && detectedBlocks.length > 0 && (
          <Text style={styles.statusText}>
            {detectedBlocks.length} text region{detectedBlocks.length !== 1 ? "s" : ""} detected
          </Text>
        )}
        {!isProcessing && !isPaused && !error && detectedBlocks.length === 0 && (
          <Text style={styles.statusText}>Point camera at text to translate</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    zIndex: 999,
  },
  // Error / permission screens
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  errorText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  errorSubtext: {
    color: "#aaa",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 24,
  },
  permissionButton: {
    backgroundColor: "#6c63ff",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 12,
  },
  permissionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  closeButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  closeButtonText: {
    color: "#6c63ff",
    fontSize: 16,
    fontWeight: "600",
  },
  // Top bar
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
  topButtonActive: {
    backgroundColor: "rgba(108,99,255,0.6)",
  },
  topButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  langIndicator: {
    backgroundColor: "rgba(108,99,255,0.7)",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  langText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  // Translation overlays
  overlay: {
    justifyContent: "flex-start",
    alignItems: "flex-start",
  },
  overlayBubble: {
    backgroundColor: "rgba(26, 26, 46, 0.88)",
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "rgba(108,99,255,0.5)",
    maxWidth: 280,
  },
  overlayTranslated: {
    color: "#a8a4ff",
    fontSize: 14,
    fontWeight: "700",
  },
  overlayOriginal: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 10,
    marginTop: 1,
  },
  // Bottom bar
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
    paddingTop: 12,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
  },
  errorStatusText: {
    color: "#ff6b6b",
    fontSize: 14,
  },
});
