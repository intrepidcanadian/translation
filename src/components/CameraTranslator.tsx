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
        {/* X button removed. This component is rendered inside the Scan
            tab, which already exposes ALL scanner modes (Live, Document,
            Receipt, Medicine, Menu, Business Card, Textbook, Dual,
            Duty-Free, Price, Product, Sell) via the always-visible mode
            pill strip at the top of ScanScreen. The previous X was an
            overloaded navigation hack — `onClose` jumped to Document
            mode, which read as "close" but actually opened a different
            scanner. With the container no longer covering the strip, the
            user navigates with pills directly and X is redundant. */}

        <View style={styles.langIndicator}>
          <Text style={styles.langText}>
            {sourceLangCode.toUpperCase()} {"→"} {targetLangCode.toUpperCase()}
          </Text>
        </View>

        {!isCaptured && (
          <>
            {/* Segmented overlay-mode toggle. The previous single button
                cycled between "AR" and "💬" with no indication of what
                each meant or which was active — users couldn't tell if the
                visible label was the current mode or the next mode. This
                pill shows BOTH options at once, with the active one
                highlighted, so the action ("tap to switch to the other")
                is unambiguous. */}
            <View style={styles.overlayToggle}>
              <TouchableOpacity
                style={[styles.overlayToggleSegment, overlayMode === "replace" && styles.overlayToggleSegmentActive]}
                onPress={() => {
                  if (overlayMode !== "replace") {
                    setOverlayMode("replace");
                    blockOpacities.clear();
                  }
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: overlayMode === "replace" }}
                accessibilityLabel="AR overlay: replace original text in place"
              >
                <Text style={[styles.overlayToggleText, overlayMode === "replace" && styles.overlayToggleTextActive]}>AR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.overlayToggleSegment, overlayMode === "bubble" && styles.overlayToggleSegmentActive]}
                onPress={() => {
                  if (overlayMode !== "bubble") {
                    setOverlayMode("bubble");
                    blockOpacities.clear();
                  }
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: overlayMode === "bubble" }}
                accessibilityLabel="Bubble overlay: show translations in floating bubbles"
              >
                <Text style={[styles.overlayToggleText, overlayMode === "bubble" && styles.overlayToggleTextActive]}>Bubble</Text>
              </TouchableOpacity>
            </View>

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
          <>
            {/* Explicit Retake button — replaces the old overloaded X
                behavior. Labeled with both an icon and text so its purpose
                is unmistakable, since "go back to live camera" is the
                common follow-up after reviewing a captured translation. */}
            <TouchableOpacity
              style={styles.retakeButton}
              onPress={handleRetake}
              accessibilityRole="button"
              accessibilityLabel="Retake photo and return to live camera"
            >
              <Text style={styles.retakeButtonText}>↻ Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.topButton}
              onPress={handleShareCapture}
              accessibilityLabel="Share translated photo"
            >
              <Text style={styles.topButtonText}>↑</Text>
            </TouchableOpacity>
          </>
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
  // Was previously `...StyleSheet.absoluteFillObject` with zIndex 999, which
  // covered the entire ScanScreen and HID the mode-pill strip above it —
  // forcing the X button to double as a navigation control. Now we use
  // flex: 1 so the camera fills only the space below the mode strip,
  // leaving the pills permanently visible as the canonical way to switch
  // scanner modes (Live ↔ Document ↔ Receipt ↔ Medicine ↔ Menu, etc.).
  // Children inside still use `position: "absolute"` for overlays (top
  // bar, bottom bar, OCR block annotations); those resolve relative to
  // this View regardless of flex vs. absolute on the parent.
  container: {
    flex: 1,
    backgroundColor: "#000",
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
    // No more notch padding — the parent ScanScreen's mode strip already
    // sits above this view inside the SafeAreaView, so the camera's top
    // edge is already below the status bar / dynamic island.
    paddingTop: 12,
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
  // Segmented overlay-mode toggle (replaces the old single AR/💬 button)
  overlayToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.25)",
  },
  overlayToggleSegment: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 11,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayToggleSegmentActive: {
    backgroundColor: "rgba(108,99,255,0.85)",
  },
  overlayToggleText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  overlayToggleTextActive: {
    color: "#fff",
  },
  // Explicit Retake button (replaces the old X-doubling-as-back behavior)
  retakeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.3)",
  },
  retakeButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
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
