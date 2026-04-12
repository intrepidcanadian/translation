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
} from "react-native-vision-camera";
import { Camera as OCRCamera } from "react-native-vision-camera-ocr-plus";
import { translateText, translateAppleBatch, type TranslateOptions } from "../services/translation";

interface DetectedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  frame: { top: number; left: number; width: number; height: number };
}

interface OCRFrame {
  x?: number;
  y?: number;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}

interface OCRBlock {
  text: string;
  lines?: Array<{
    text: string;
    frame?: OCRFrame;
  }>;
  frame?: OCRFrame;
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

// Map language codes to OCR plugin language options
function getOCRLanguage(langCode: string): "latin" | "chinese" | "japanese" | "korean" | "devanagari" {
  switch (langCode) {
    case "zh": return "chinese";
    case "ja": return "japanese";
    case "ko": return "korean";
    case "hi": return "devanagari";
    default: return "latin";
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
  const [detectedBlocks, setDetectedBlocks] = useState<DetectedBlock[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const translateQueueRef = useRef<Array<{ text: string; frame: any }> | null>(null);
  const isTranslatingRef = useRef(false);
  const lastOCRTextRef = useRef("");
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
      abortRef.current?.abort();
    };
  }, []);

  // Clear cache when languages change
  useEffect(() => {
    ocrTranslationCache.clear();
    setDetectedBlocks([]);
    lastOCRTextRef.current = "";
  }, [sourceLangCode, targetLangCode]);

  // Translate detected lines (debounced — only runs when OCR text actually changes)
  const translateLines = useCallback(async (
    lines: Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }>
  ) => {
    if (isTranslatingRef.current || !isMountedRef.current) {
      // Queue for next run
      translateQueueRef.current = lines;
      return;
    }

    isTranslatingRef.current = true;
    setIsTranslating(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const translateOptions: TranslateOptions = {
      provider: translationProvider as any,
      apiKey,
      signal: controller.signal,
    };

    try {
      // Separate cached vs uncached
      const cachedMap = new Map<string, string>();
      const uncachedTexts: string[] = [];
      const uncachedIndices: number[] = [];

      for (let i = 0; i < lines.length; i++) {
        const cacheKey = `${sourceLangCode}|${targetLangCode}|${lines[i].text}`;
        if (ocrTranslationCache.has(cacheKey)) {
          cachedMap.set(lines[i].text, ocrTranslationCache.get(cacheKey)!);
        } else {
          uncachedTexts.push(lines[i].text);
          uncachedIndices.push(i);
        }
      }

      // Batch translate uncached
      let translatedTexts: string[] = [];
      if (uncachedTexts.length > 0 && !controller.signal.aborted) {
        try {
          if (translationProvider === "apple" && Platform.OS === "ios") {
            translatedTexts = await translateAppleBatch(uncachedTexts, sourceLangCode, targetLangCode);
          } else {
            for (const text of uncachedTexts) {
              if (controller.signal.aborted) break;
              try {
                const res = await translateText(text, sourceLangCode, targetLangCode, translateOptions);
                translatedTexts.push(res.translatedText);
              } catch {
                translatedTexts.push(text);
              }
            }
          }

          // Cache results
          for (let i = 0; i < uncachedTexts.length && i < translatedTexts.length; i++) {
            const cacheKey = `${sourceLangCode}|${targetLangCode}|${uncachedTexts[i]}`;
            ocrTranslationCache.set(cacheKey, translatedTexts[i]);
            if (ocrTranslationCache.size > 500) {
              const firstKey = ocrTranslationCache.keys().next().value;
              if (firstKey) ocrTranslationCache.delete(firstKey);
            }
          }
        } catch {
          translatedTexts = uncachedTexts;
        }
      }

      // Build final blocks
      if (isMountedRef.current && !controller.signal.aborted) {
        const blocks: DetectedBlock[] = [];
        let uncachedIdx = 0;

        for (const line of lines) {
          const cached = cachedMap.get(line.text);
          const translated = cached ?? (uncachedIdx < translatedTexts.length ? translatedTexts[uncachedIdx++] : line.text);

          blocks.push({
            id: `${line.frame.top}-${line.frame.left}-${line.text.slice(0, 10)}`,
            originalText: line.text,
            translatedText: translated,
            frame: line.frame,
          });
        }

        setDetectedBlocks(blocks);
      }
    } catch (err: any) {
      if (isMountedRef.current && err?.name !== "AbortError") {
        setError(err?.message || "Translation failed");
      }
    } finally {
      isTranslatingRef.current = false;
      if (isMountedRef.current) setIsTranslating(false);

      // Process queued OCR results
      if (translateQueueRef.current && isMountedRef.current) {
        const queued = translateQueueRef.current;
        translateQueueRef.current = null;
        translateLines(queued);
      }
    }
  }, [sourceLangCode, targetLangCode, translationProvider, apiKey]);

  // Handle real-time OCR results from frame processor
  const handleOCRResult = useCallback((data: any) => {
    if (isPaused || !isMountedRef.current) return;

    try {
      const blocks: OCRBlock[] = data?.result?.blocks || data?.blocks || [];
      if (!blocks.length) {
        if (lastOCRTextRef.current !== "") {
          lastOCRTextRef.current = "";
          setDetectedBlocks([]);
        }
        return;
      }

      // Extract lines with frames
      const lines: Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }> = [];
      for (const block of blocks) {
        if (block.lines) {
          for (const line of block.lines) {
            if (!line.text?.trim() || !line.frame) continue;
            lines.push({
              text: line.text.trim(),
              frame: {
                top: line.frame.y ?? line.frame.top ?? 0,
                left: line.frame.x ?? line.frame.left ?? 0,
                width: line.frame.width ?? 0,
                height: line.frame.height ?? 0,
              },
            });
          }
        } else if (block.text?.trim() && block.frame) {
          // Fallback: use block-level if no lines
          lines.push({
            text: block.text.trim(),
            frame: {
              top: (block.frame as any).y ?? (block.frame as any).top ?? 0,
              left: (block.frame as any).x ?? (block.frame as any).left ?? 0,
              width: block.frame.width ?? 0,
              height: block.frame.height ?? 0,
            },
          });
        }
      }

      if (lines.length === 0) return;

      // Check if text actually changed (avoid re-translating same content)
      const currentText = lines.map((l) => l.text).join("|");
      if (currentText === lastOCRTextRef.current) return;
      lastOCRTextRef.current = currentText;

      setError(null);
      translateLines(lines);
    } catch (err: any) {
      // Silently handle OCR parse errors — frame processors fire rapidly
    }
  }, [isPaused, translateLines]);

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
      {/* Camera with real-time OCR frame processor */}
      <OCRCamera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={visible && !isPaused}
        mode="recognize"
        options={{ language: getOCRLanguage(sourceLangCode) }}
        callback={handleOCRResult}
      />

      {/* Translation Overlays */}
      {detectedBlocks.map((block) => {
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
          <Text style={styles.topButtonText}>X</Text>
        </TouchableOpacity>

        <View style={styles.langIndicator}>
          <Text style={styles.langText}>
            {sourceLangCode.toUpperCase()} {"->"} {targetLangCode.toUpperCase()}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.topButton, isPaused && styles.topButtonActive]}
          onPress={() => setIsPaused((p) => !p)}
          accessibilityLabel={isPaused ? "Resume scanning" : "Pause scanning"}
        >
          <Text style={styles.topButtonText}>{isPaused ? ">" : "||"}</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Status Bar */}
      <View style={styles.bottomBar}>
        {isTranslating && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color="#a8a4ff" />
            <Text style={styles.statusText}>Translating...</Text>
          </View>
        )}
        {isPaused && (
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>Paused — tap play to resume</Text>
          </View>
        )}
        {error && (
          <View style={styles.statusRow}>
            <Text style={styles.errorStatusText}>{error}</Text>
          </View>
        )}
        {!isTranslating && !isPaused && !error && detectedBlocks.length > 0 && (
          <Text style={styles.statusText}>
            {detectedBlocks.length} text region{detectedBlocks.length !== 1 ? "s" : ""} | Real-time OCR
          </Text>
        )}
        {!isTranslating && !isPaused && !error && detectedBlocks.length === 0 && (
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
