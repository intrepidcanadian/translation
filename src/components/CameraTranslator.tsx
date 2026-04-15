import React, { useRef, useState, useEffect } from "react";
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
} from "react-native";
import type { Camera } from "react-native-vision-camera";
import {
  useCameraDevice,
  useCameraPermission,
} from "react-native-vision-camera";
import { Camera as OCRCamera } from "react-native-vision-camera-ocr-plus";
import type { TranslationProvider } from "../services/translation";
import { clearOCRCache } from "../services/ocrTranslation";
import { useLiveOCR } from "../hooks/useLiveOCR";
import { usePhotoCapture } from "../hooks/usePhotoCapture";
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

  const [isPaused, setIsPaused] = useState(false);
  const [overlayMode, setOverlayMode] = useState<"bubble" | "replace">("replace");
  const blockOpacities = useRef(new Map<string, Animated.Value>()).current;
  const isMountedRef = useRef(true);
  const lastOCRTextRef = useRef("");
  const [screenDims, setScreenDims] = useState(() => Dimensions.get("window"));

  // Photo capture hook — manages capture state, OCR, translation, share, block tap
  const { isCaptured, capturedUri, capturedBlocks, isProcessingCapture, captureError, handleCapture, handleRetake, handleShareCapture, handleBlockTap } = usePhotoCapture({
    captureRef,
    sourceLangCode,
    targetLangCode,
    translationProvider,
    screenDims,
    blockOpacities,
    lastOCRTextRef,
    isMountedRef,
  });

  // Live OCR hook — handles frame processing, translation, and detected block state
  const { detectedBlocks, setDetectedBlocks, isTranslating, error, setError, abortRef, handleOCRResult } = useLiveOCR({
    sourceLangCode,
    targetLangCode,
    translationProvider,
    isPaused,
    isCaptured,
    blockOpacities,
    isMountedRef,
    lastOCRTextRef,
  });

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
  }, [abortRef]);

  // Clear cache when languages change
  useEffect(() => {
    clearOCRCache();
    setDetectedBlocks([]);
    blockOpacities.clear();
    lastOCRTextRef.current = "";
  }, [sourceLangCode, targetLangCode, setDetectedBlocks]);

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
      {/* Single camera session handles both live OCR frame processing and
          photo capture. iOS AVCaptureSession can only bind one session per
          device, so we must NOT render a second <Camera> on the same device —
          doing so silently breaks live recognition and leaves the capture
          session in a state that can cascade into mic-record failures when
          the user later taps the record button. OCRCamera is a wrapper that
          forwards ref + spreads props onto the underlying VisionCamera, so
          passing `photo` and `captureRef` here gives us capture for free. */}
      {!isCaptured && (
        <OCRCamera
          ref={captureRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={visible && !isCaptured}
          mode="recognize"
          photo={true}
          options={{ language: getOCRLanguage(sourceLangCode) }}
          callback={isPaused ? () => {} : handleOCRResult}
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
            {(error || captureError) && (
              <View style={styles.statusRow}>
                <Text style={styles.errorStatusText}>{captureError || error}</Text>
              </View>
            )}
            {!isTranslating && !isPaused && !error && !captureError && detectedBlocks.length > 0 && (
              <Text style={styles.statusText}>
                {detectedBlocks.length} text region{detectedBlocks.length !== 1 ? "s" : ""} | Real-time OCR
              </Text>
            )}
            {!isTranslating && !isPaused && !error && !captureError && detectedBlocks.length === 0 && (
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
