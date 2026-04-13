import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Platform,
  ActivityIndicator,
  Animated,
  Alert,
  Share,
} from "react-native";
import { logger } from "../services/logger";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  type PhotoFile,
} from "react-native-vision-camera";
import { Camera as OCRCamera } from "react-native-vision-camera-ocr-plus";
import TextRecognition, { TextRecognitionScript } from "@react-native-ml-kit/text-recognition";
import * as Clipboard from "expo-clipboard";
import * as Speech from "expo-speech";
import type { TranslationProvider } from "../services/translation";
import { translateOCRLines, translateCapturedLines, mapToScreenCoords, clearOCRCache } from "../services/ocrTranslation";
import type { ThemeColors } from "../theme";

interface DetectedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  frame: { top: number; left: number; width: number; height: number };
}

interface CapturedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  imageFrame: { top: number; left: number; width: number; height: number };
  screenFrame: { top: number; left: number; width: number; height: number };
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
  translationProvider?: TranslationProvider;
  colors: ThemeColors;
}

// Memoized overlay for captured text blocks (tappable)
const CapturedBlockOverlay = React.memo(function CapturedBlockOverlay({
  block,
  onPress,
}: {
  block: CapturedBlock;
  onPress: (block: CapturedBlock) => void;
}) {
  const fontSize = Math.max(10, block.screenFrame.height * 0.65);
  return (
    <TouchableOpacity
      style={{
        position: "absolute",
        top: block.screenFrame.top,
        left: block.screenFrame.left,
        width: block.screenFrame.width,
        minHeight: block.screenFrame.height,
        backgroundColor: "rgba(255,255,255,0.92)",
        justifyContent: "center",
        paddingHorizontal: 2,
      }}
      onPress={() => onPress(block)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${block.translatedText}. Tap for options.`}
    >
      <Text
        style={{ fontSize, color: "#1a1a2e", fontWeight: "600", lineHeight: fontSize * 1.15 }}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
      >
        {block.translatedText}
      </Text>
    </TouchableOpacity>
  );
});

// Memoized overlay for live OCR detected text blocks
const DetectedBlockOverlay = React.memo(function DetectedBlockOverlay({
  block,
  overlayMode,
  animatedOpacity,
}: {
  block: DetectedBlock;
  overlayMode: "bubble" | "replace";
  animatedOpacity: Animated.Value;
}) {
  if (overlayMode === "replace") {
    const fontSize = Math.max(10, block.frame.height * 0.65);
    return (
      <Animated.View
        style={{
          position: "absolute",
          top: block.frame.top,
          left: block.frame.left,
          width: block.frame.width,
          minHeight: block.frame.height,
          backgroundColor: "rgba(255,255,255,0.92)",
          justifyContent: "center",
          paddingHorizontal: 2,
          opacity: animatedOpacity,
        }}
      >
        <Text
          style={{ fontSize, color: "#1a1a2e", fontWeight: "600", lineHeight: fontSize * 1.15 }}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {block.translatedText}
        </Text>
      </Animated.View>
    );
  }

  return (
    <View style={[{ position: "absolute", top: block.frame.top, left: block.frame.left, minWidth: block.frame.width, minHeight: block.frame.height, justifyContent: "flex-start", alignItems: "flex-start" }]}>
      <View style={{ backgroundColor: "rgba(26, 26, 46, 0.88)", borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: "rgba(108,99,255,0.5)", maxWidth: 280 }}>
        <Text style={{ color: "#a8a4ff", fontSize: 14, fontWeight: "700" }} numberOfLines={2}>{block.translatedText}</Text>
        <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 10, marginTop: 1 }} numberOfLines={1}>{block.originalText}</Text>
      </View>
    </View>
  );
});

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

// Map language codes to ML Kit text recognition scripts
function getMLKitScript(langCode: string): TextRecognitionScript {
  switch (langCode) {
    case "zh": return TextRecognitionScript.CHINESE;
    case "ja": return TextRecognitionScript.JAPANESE;
    case "ko": return TextRecognitionScript.KOREAN;
    case "hi": return TextRecognitionScript.DEVANAGARI;
    default: return TextRecognitionScript.LATIN;
  }
}


export default function CameraTranslator({
  visible,
  onClose,
  sourceLangCode,
  targetLangCode,
  translationProvider,
  colors,
}: CameraTranslatorProps) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const captureRef = useRef<Camera>(null);

  // Live OCR state
  const [detectedBlocks, setDetectedBlocks] = useState<DetectedBlock[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [overlayMode, setOverlayMode] = useState<"bubble" | "replace">("replace");
  const blockOpacities = useRef(new Map<string, Animated.Value>()).current;

  // Photo capture state
  const [isCaptured, setIsCaptured] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedBlocks, setCapturedBlocks] = useState<CapturedBlock[]>([]);
  const [isProcessingCapture, setIsProcessingCapture] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const translateQueueRef = useRef<Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }> | null>(null);
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
    clearOCRCache();
    setDetectedBlocks([]);
    blockOpacities.clear();
    lastOCRTextRef.current = "";
  }, [sourceLangCode, targetLangCode]);

  // Translate detected lines (debounced — only runs when OCR text actually changes)
  const translateLines = useCallback(async (
    lines: Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }>
  ) => {
    if (isTranslatingRef.current || !isMountedRef.current) {
      translateQueueRef.current = lines;
      return;
    }

    isTranslatingRef.current = true;
    setIsTranslating(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const blocks = await translateOCRLines(lines, sourceLangCode, targetLangCode, translationProvider, controller.signal);

      if (isMountedRef.current && !controller.signal.aborted) {
        setDetectedBlocks(blocks);
        const activeIds = new Set(blocks.map((b) => b.id));
        for (const key of blockOpacities.keys()) {
          if (!activeIds.has(key)) blockOpacities.delete(key);
        }
      }
    } catch (err: unknown) {
      if (isMountedRef.current && !(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Translation failed");
      }
      // Clean up stale opacity entries on failure too
      blockOpacities.clear();
    } finally {
      isTranslatingRef.current = false;
      if (isMountedRef.current) setIsTranslating(false);

      if (translateQueueRef.current && isMountedRef.current) {
        const queued = translateQueueRef.current;
        translateQueueRef.current = null;
        translateLines(queued);
      }
    }
  }, [sourceLangCode, targetLangCode, translationProvider]);

  // Handle real-time OCR results from frame processor
  // OCR plugin callback receives data with varying shape depending on version
  const handleOCRResult = useCallback((data: unknown) => {
    if (isPaused || isCaptured || !isMountedRef.current) return;

    try {
      const ocrData = data as { result?: { blocks?: OCRBlock[] }; blocks?: OCRBlock[] } | null;
      const blocks: OCRBlock[] = ocrData?.result?.blocks || ocrData?.blocks || [];
      if (!blocks.length) {
        if (lastOCRTextRef.current !== "") {
          lastOCRTextRef.current = "";
          setDetectedBlocks([]);
        }
        return;
      }

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
          lines.push({
            text: block.text.trim(),
            frame: {
              top: block.frame.y ?? block.frame.top ?? 0,
              left: block.frame.x ?? block.frame.left ?? 0,
              width: block.frame.width ?? 0,
              height: block.frame.height ?? 0,
            },
          });
        }
      }

      if (lines.length === 0) return;

      const currentText = lines.map((l) => l.text).join("|");
      if (currentText === lastOCRTextRef.current) return;
      lastOCRTextRef.current = currentText;

      setError(null);
      translateLines(lines);
    } catch (err) {
      logger.warn("OCR", "OCR frame parse error", err);
    }
  }, [isPaused, isCaptured, translateLines]);

  // Photo capture handler
  const handleCapture = useCallback(async () => {
    if (!captureRef.current || isProcessingCapture) return;

    setIsProcessingCapture(true);
    setError(null);

    try {
      const photo: PhotoFile = await captureRef.current.takePhoto({
        enableShutterSound: true,
      });
      const uri = Platform.OS === "android" ? `file://${photo.path}` : photo.path;

      setCapturedUri(uri);
      setIsCaptured(true);
      setDetectedBlocks([]);
      blockOpacities.clear();

      // Run ML Kit OCR on the captured photo
      const script = getMLKitScript(sourceLangCode);
      const result = await TextRecognition.recognize(uri, script);

      if (!result.blocks.length) {
        setError("No text detected in photo. Try again.");
        setIsProcessingCapture(false);
        return;
      }

      // Extract lines with bounding boxes
      const lines: Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }> = [];
      for (const block of result.blocks) {
        for (const line of block.lines) {
          if (!line.text?.trim() || !line.frame) continue;
          lines.push({
            text: line.text.trim(),
            frame: {
              top: line.frame.top ?? 0,
              left: line.frame.left ?? 0,
              width: line.frame.width ?? 0,
              height: line.frame.height ?? 0,
            },
          });
        }
      }

      if (lines.length === 0) {
        setError("No text lines detected.");
        setIsProcessingCapture(false);
        return;
      }

      // Batch translate
      const texts = lines.map((l) => l.text);
      const translations = await translateCapturedLines(texts, sourceLangCode, targetLangCode, translationProvider);

      // Scale coordinates from image space to screen space
      const blocks: CapturedBlock[] = lines.map((line, i) => ({
        id: `cap-${i}-${line.text.slice(0, 8)}`,
        originalText: line.text,
        translatedText: translations[i] || line.text,
        imageFrame: line.frame,
        screenFrame: mapToScreenCoords(line.frame, photo.width, photo.height, screenDims.width, screenDims.height),
      }));

      setCapturedBlocks(blocks);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Capture failed");
      setIsCaptured(false);
      setCapturedUri(null);
    } finally {
      setIsProcessingCapture(false);
    }
  }, [sourceLangCode, targetLangCode, translationProvider, screenDims, isProcessingCapture]);

  const handleRetake = useCallback(() => {
    setIsCaptured(false);
    setCapturedUri(null);
    setCapturedBlocks([]);
    setError(null);
    lastOCRTextRef.current = "";
  }, []);

  const handleShareCapture = useCallback(async () => {
    if (!capturedUri) return;
    const textSummary = capturedBlocks
      .map((b) => `${b.originalText} → ${b.translatedText}`)
      .join("\n");

    try {
      await Share.share({
        message: `Photo Translation (${sourceLangCode.toUpperCase()} → ${targetLangCode.toUpperCase()}):\n\n${textSummary}`,
        url: capturedUri,
      });
    } catch (err) {
      // User cancelled share or share failed
      logger.warn("Camera", "Share capture failed", err);
    }
  }, [capturedUri, capturedBlocks, sourceLangCode, targetLangCode]);

  const handleBlockTap = useCallback((block: CapturedBlock) => {
    Alert.alert(
      block.translatedText,
      block.originalText,
      [
        {
          text: "Copy Translation",
          onPress: () => Clipboard.setStringAsync(block.translatedText),
        },
        {
          text: "Copy Original",
          onPress: () => Clipboard.setStringAsync(block.originalText),
        },
        {
          text: "Speak",
          onPress: () => Speech.speak(block.translatedText, { language: targetLangCode }),
        },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }, [targetLangCode]);

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
      {/* Standard Camera for photo capture (behind OCR camera) */}
      {!isCaptured && (
        <Camera
          ref={captureRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={visible && !isCaptured}
          photo={true}
        />
      )}

      {/* Live OCR camera (on top, handles real-time frame processing) */}
      {!isCaptured && (
        <OCRCamera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={visible && !isPaused && !isCaptured}
          mode="recognize"
          options={{ language: getOCRLanguage(sourceLangCode) }}
          callback={handleOCRResult}
        />
      )}

      {/* Frozen photo view */}
      {isCaptured && capturedUri && (
        <Image
          source={{ uri: capturedUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}

      {/* Live OCR overlays */}
      {!isCaptured && detectedBlocks.map((block) => {
        if (!blockOpacities.has(block.id)) {
          // Cap map size to prevent unbounded memory growth during long sessions
          if (blockOpacities.size > 100) {
            const firstKey = blockOpacities.keys().next().value;
            if (firstKey !== undefined) blockOpacities.delete(firstKey);
          }
          const val = new Animated.Value(0);
          blockOpacities.set(block.id, val);
          Animated.timing(val, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        }
        return (
          <DetectedBlockOverlay
            key={block.id}
            block={block}
            overlayMode={overlayMode}
            animatedOpacity={blockOpacities.get(block.id)!}
          />
        );
      })}

      {/* Captured photo overlays (tappable) */}
      {isCaptured && capturedBlocks.map((block) => (
        <CapturedBlockOverlay key={block.id} block={block} onPress={handleBlockTap} />
      ))}

      {/* Processing overlay */}
      {isProcessingCapture && (
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="large" color="#a8a4ff" />
          <Text style={styles.processingText}>Translating photo...</Text>
        </View>
      )}

      {/* Top Controls Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topButton}
          onPress={isCaptured ? handleRetake : onClose}
          accessibilityLabel={isCaptured ? "Retake photo" : "Close camera translator"}
        >
          <Text style={styles.topButtonText}>{isCaptured ? "←" : "X"}</Text>
        </TouchableOpacity>

        <View style={styles.langIndicator}>
          <Text style={styles.langText}>
            {sourceLangCode.toUpperCase()} {"→"} {targetLangCode.toUpperCase()}
          </Text>
        </View>

        {!isCaptured && (
          <>
            <TouchableOpacity
              style={[styles.topButton, overlayMode === "replace" && styles.topButtonActive]}
              onPress={() => {
                setOverlayMode((m) => m === "bubble" ? "replace" : "bubble");
                blockOpacities.clear();
              }}
              accessibilityLabel={`Switch to ${overlayMode === "bubble" ? "AR replace" : "bubble"} overlay`}
            >
              <Text style={styles.topButtonText}>{overlayMode === "replace" ? "AR" : "💬"}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.captureButton}
              onPress={handleCapture}
              disabled={isProcessingCapture}
              accessibilityLabel="Capture photo for translation"
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.topButton, isPaused && styles.topButtonActive]}
              onPress={() => setIsPaused((p) => !p)}
              accessibilityLabel={isPaused ? "Resume scanning" : "Pause scanning"}
            >
              <Text style={styles.topButtonText}>{isPaused ? "▶" : "||"}</Text>
            </TouchableOpacity>
          </>
        )}

        {isCaptured && (
          <TouchableOpacity
            style={styles.topButton}
            onPress={handleShareCapture}
            accessibilityLabel="Share translated photo"
          >
            <Text style={styles.topButtonText}>↑</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom Status Bar */}
      <View style={styles.bottomBar}>
        {isCaptured ? (
          <View style={styles.capturedActions}>
            <Text style={styles.statusText}>
              {capturedBlocks.length} text region{capturedBlocks.length !== 1 ? "s" : ""} translated — tap any to copy or speak
            </Text>
          </View>
        ) : (
          <>
            {isTranslating && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color="#a8a4ff" />
                <Text style={styles.statusText}>Translating...</Text>
              </View>
            )}
            {isPaused && !isTranslating && (
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
          </>
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
  captureButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  captureButtonInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
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
    textAlign: "center",
  },
  errorStatusText: {
    color: "#ff6b6b",
    fontSize: 14,
  },
  capturedActions: {
    alignItems: "center",
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  processingText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 12,
  },
});
