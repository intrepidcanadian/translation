import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Platform,
  ActivityIndicator,
  Animated,
  Alert,
  Linking,
} from "react-native";
import {
  useCameraDevice,
  useCameraPermission,
} from "react-native-vision-camera";
import { Camera as OCRCamera } from "react-native-vision-camera-ocr-plus";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import * as Speech from "expo-speech";
import { startSpeechSession } from "../utils/speechSession";
import type { TranslationProvider } from "../services/translation";
import { translateText } from "../services/translation";
import { clearOCRCache } from "../services/ocrTranslation";
import { useLiveOCR } from "../hooks/useLiveOCR";
import { impactLight, impactMedium } from "../services/haptics";
import { logger } from "../services/logger";
import * as telemetry from "../services/telemetry";
import { primaryAlpha, textOnGlass, type ThemeColors } from "../theme";

interface DetectedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  frame: { top: number; left: number; width: number; height: number };
}

interface DualStreamViewProps {
  visible: boolean;
  onClose: () => void;
  sourceLangCode: string;
  sourceSpeechCode: string;
  targetLangCode: string;
  targetSpeechCode: string;
  translationProvider?: TranslationProvider;
  speechRate: number;
  offlineSpeech: boolean;
  colors: ThemeColors;
}

// OCR overlay for live text blocks. Renders a horizontal glass label
// anchored next to each detected line — same side-label pattern as
// CameraTranslator so the two scanner modes present translations
// consistently and don't paint over the text the user is trying to read.
// Prefers the right side of the text (matching LTR reading flow), flips
// to the left when the text is near the right edge, and falls back to a
// position just below the line when neither side has enough room.
const LABEL_GAP = 6;
const LABEL_MIN_SIDE = 80;
const LABEL_SIDE_MAX_WIDTH = 240;
const LABEL_SIDE_PADDING = 12;
const LABEL_MIN_HEIGHT = 22;

const DetectedBlockOverlay = React.memo(function DetectedBlockOverlay({
  block,
  animatedOpacity,
  screenWidth,
  screenHeight,
}: {
  block: DetectedBlock;
  animatedOpacity: Animated.Value;
  screenWidth: number;
  screenHeight: number;
}) {
  const textTop = block.frame.top;
  const textLeft = block.frame.left;
  const textRight = textLeft + block.frame.width;
  const textBottom = textTop + block.frame.height;

  const roomRight = Math.max(0, screenWidth - LABEL_SIDE_PADDING - (textRight + LABEL_GAP));
  const roomLeft = Math.max(0, textLeft - LABEL_GAP - LABEL_SIDE_PADDING);

  const labelHeight = Math.max(LABEL_MIN_HEIGHT, block.frame.height);
  const fontSize = Math.max(12, Math.min(24, labelHeight * 0.54));

  let pos: { top: number; left: number; maxWidth: number };
  if (roomRight >= LABEL_MIN_SIDE) {
    pos = { top: textTop, left: textRight + LABEL_GAP, maxWidth: Math.min(LABEL_SIDE_MAX_WIDTH, roomRight) };
  } else if (roomLeft >= LABEL_MIN_SIDE) {
    const maxW = Math.min(LABEL_SIDE_MAX_WIDTH, roomLeft);
    pos = { top: textTop, left: textLeft - LABEL_GAP - maxW, maxWidth: maxW };
  } else {
    pos = {
      top: Math.min(textBottom + LABEL_GAP, screenHeight - labelHeight - LABEL_SIDE_PADDING),
      left: Math.max(LABEL_SIDE_PADDING, Math.min(textLeft, screenWidth - LABEL_SIDE_MAX_WIDTH - LABEL_SIDE_PADDING)),
      maxWidth: LABEL_SIDE_MAX_WIDTH,
    };
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: pos.top,
        left: pos.left,
        maxWidth: pos.maxWidth,
        minHeight: labelHeight,
        justifyContent: "center",
        paddingHorizontal: 10,
        paddingVertical: 3,
        backgroundColor: "rgba(26, 26, 46, 0.92)",
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: primaryAlpha.border,
        borderLeftWidth: 3,
        borderLeftColor: "#a8a4ff",
        opacity: animatedOpacity,
      }}
    >
      <Text
        style={[{ color: "#fff", fontSize, fontWeight: "700", lineHeight: fontSize * 1.2 }, textOnGlass]}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {block.translatedText}
      </Text>
    </Animated.View>
  );
});

// Map language codes to OCR plugin language options
function getOCRLanguage(
  langCode: string
): "latin" | "chinese" | "japanese" | "korean" | "devanagari" {
  switch (langCode) {
    case "zh":
      return "chinese";
    case "ja":
      return "japanese";
    case "ko":
      return "korean";
    case "hi":
      return "devanagari";
    default:
      return "latin";
  }
}

export default function DualStreamView({
  visible,
  onClose,
  sourceLangCode,
  sourceSpeechCode,
  targetLangCode,
  targetSpeechCode,
  translationProvider,
  speechRate,
  offlineSpeech,
  colors,
}: DualStreamViewProps) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();

  // --- OCR Pipeline State ---
  const [isPaused, setIsPaused] = useState(false);
  const blockOpacities = useRef(new Map<string, Animated.Value>()).current;
  const isMountedRef = useRef(true);
  const lastOCRTextRef = useRef("");
  // Window dimensions are used for image-space → screen-space mapping in
  // useLiveOCR. Kept in state so a rotation / window resize is picked up.
  const [screenDims, setScreenDims] = useState(() => Dimensions.get("window"));
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => setScreenDims(window));
    return () => sub.remove();
  }, []);

  // --- Speech Pipeline State ---
  const [isMicActive, setIsMicActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechOriginal, setSpeechOriginal] = useState("");
  const [speechTranslated, setSpeechTranslated] = useState("");
  const [isSpeechTranslating, setIsSpeechTranslating] = useState(false);
  const speechFinalRef = useRef("");
  const lastSpeechTranslatedRef = useRef("");
  const speechTranslationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const isStartingRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subtitle history — keep last 3 lines for context
  const [subtitleHistory, setSubtitleHistory] = useState<
    Array<{ original: string; translated: string; timestamp: number }>
  >([]);

  // Subtitle fade animation
  const subtitleOpacity = useRef(new Animated.Value(0)).current;

  // Mic pulse animation
  const micPulseAnim = useRef(new Animated.Value(1)).current;
  const micPulseOpacity = useRef(new Animated.Value(0)).current;

  // Live OCR hook (runs camera text detection + translation)
  const {
    detectedBlocks,
    setDetectedBlocks,
    isTranslating: isOCRTranslating,
    error: ocrError,
    setError: setOCRError,
    abortRef: ocrAbortRef,
    handleOCRResult,
  } = useLiveOCR({
    sourceLangCode,
    targetLangCode,
    translationProvider,
    isPaused,
    isCaptured: false, // dual-stream never captures
    blockOpacities,
    isMountedRef,
    lastOCRTextRef,
    screenDims,
  });

  // --- Lifecycle ---
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      ocrAbortRef.current?.abort();
      speechAbortRef.current?.abort();
      if (speechTranslationTimer.current) clearTimeout(speechTranslationTimer.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      // Stop speech if running. A throw here usually means the module was
      // already stopped or the native bridge is gone mid-unmount — worth
      // logging but not fatal.
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (err) {
        logger.debug("Speech", "Failed to stop speech on DualStreamView unmount", err);
      }
    };
  }, [ocrAbortRef]);

  // Request camera permission
  useEffect(() => {
    if (visible && !hasPermission) {
      requestPermission();
    }
  }, [visible, hasPermission, requestPermission]);

  // Clear OCR cache on language change
  useEffect(() => {
    clearOCRCache();
    setDetectedBlocks([]);
    blockOpacities.clear();
    lastOCRTextRef.current = "";
  }, [sourceLangCode, targetLangCode, setDetectedBlocks, blockOpacities]);

  // Mic pulse animation
  useEffect(() => {
    if (isListening) {
      const pulse = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(micPulseAnim, {
              toValue: 1.6,
              duration: 1000,
              useNativeDriver: true,
            }),
            Animated.timing(micPulseAnim, {
              toValue: 1,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(micPulseOpacity, {
              toValue: 0.5,
              duration: 0,
              useNativeDriver: true,
            }),
            Animated.timing(micPulseOpacity, {
              toValue: 0,
              duration: 1000,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      micPulseAnim.setValue(1);
      micPulseOpacity.setValue(0);
    }
  }, [isListening, micPulseAnim, micPulseOpacity]);

  // Subtitle fade in/out
  useEffect(() => {
    if (speechTranslated || speechOriginal) {
      Animated.timing(subtitleOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else if (!isListening) {
      Animated.timing(subtitleOpacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  }, [speechTranslated, speechOriginal, isListening, subtitleOpacity]);

  // --- Speech Translation (debounced, independent from OCR pipeline) ---
  const debouncedSpeechTranslate = useCallback(
    (text: string) => {
      if (speechTranslationTimer.current)
        clearTimeout(speechTranslationTimer.current);
      if (!text.trim() || text.trim() === lastSpeechTranslatedRef.current) return;

      speechTranslationTimer.current = setTimeout(async () => {
        speechAbortRef.current?.abort();
        const controller = new AbortController();
        speechAbortRef.current = controller;

        setIsSpeechTranslating(true);
        try {
          const result = await translateText(
            text.trim(),
            sourceLangCode,
            targetLangCode,
            { signal: controller.signal, provider: translationProvider }
          );
          if (!controller.signal.aborted && isMountedRef.current) {
            setSpeechTranslated(result.translatedText);
            lastSpeechTranslatedRef.current = text.trim();
            telemetry.increment("speech.translateSuccess");
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          // Speech translation is secondary to OCR, so we don't surface an
          // error banner — but still log + increment a counter so a
          // systematically-failing mic path is visible in diagnostics even
          // in release builds where debug ring buffers are empty.
          telemetry.increment("speech.translateFail");
          // Tag as "Speech" (not "Translation") so the errors-by-tag crash
          // report line and Settings diagnostics rolling fail count lump all
          // speech-translate failures together regardless of which pipeline
          // (primary vs. DualStream secondary) produced them. (#141)
          logger.warn("Speech", "DualStream speech translate failed", err);
        } finally {
          if (!controller.signal.aborted && isMountedRef.current) {
            setIsSpeechTranslating(false);
          }
        }
      }, 300);
    },
    [sourceLangCode, targetLangCode, translationProvider]
  );

  // --- Speech Recognition Events ---
  useSpeechRecognitionEvent("start", () => setIsListening(true));

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Archive final subtitle to history
    if (speechOriginal.trim() && speechTranslated.trim()) {
      setSubtitleHistory((prev) => {
        const updated = [
          ...prev,
          {
            original: speechOriginal.trim(),
            translated: speechTranslated.trim(),
            timestamp: Date.now(),
          },
        ];
        return updated.slice(-3); // Keep last 3
      });

      // Auto-TTS the translation
      Speech.speak(speechTranslated.trim(), {
        language: targetSpeechCode,
        rate: speechRate,
      });
    }

    // Reset for next utterance
    setSpeechOriginal("");
    setSpeechTranslated("");
    speechFinalRef.current = "";
    lastSpeechTranslatedRef.current = "";

    // If mic is still "active" (user toggled it on), auto-restart
    if (isMicActive && isMountedRef.current) {
      setTimeout(() => {
        if (isMicActive && isMountedRef.current) {
          startSpeechRecognition();
        }
      }, 300);
    }
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript || "";
    const isFinal = event.isFinal;

    // Reset silence timer
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(
      () => ExpoSpeechRecognitionModule.stop(),
      8000 // 8s silence timeout for dual-stream (longer than normal)
    );

    if (isFinal) {
      const updated = speechFinalRef.current
        ? `${speechFinalRef.current} ${transcript}`
        : transcript;
      speechFinalRef.current = updated;
      setSpeechOriginal(updated);
      debouncedSpeechTranslate(updated);
    } else {
      const combined = speechFinalRef.current
        ? `${speechFinalRef.current} ${transcript}`
        : transcript;
      setSpeechOriginal(combined);
      debouncedSpeechTranslate(combined);
    }
  });

  useSpeechRecognitionEvent("error", () => {
    setIsListening(false);
    // Auto-restart on transient errors if mic is active
    if (isMicActive && isMountedRef.current) {
      setTimeout(() => {
        if (isMicActive && isMountedRef.current) {
          startSpeechRecognition();
        }
      }, 1000);
    }
  });

  // --- Speech Controls ---
  const startSpeechRecognition = useCallback(async () => {
    if (isStartingRef.current || isListening) return;
    isStartingRef.current = true;

    try {
      const result =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        Alert.alert(
          "Microphone Permission Required",
          "Dual-Stream needs microphone access for speech subtitles.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
        setIsMicActive(false);
        return;
      }

      const speechLang =
        sourceLangCode === "autodetect" ? "en-US" : sourceSpeechCode;

      // See src/utils/speechSession.ts — guards against -11803 / -16409.
      startSpeechSession({
        lang: speechLang,
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: offlineSpeech,
        addsPunctuation: true,
      });
    } finally {
      setTimeout(() => {
        isStartingRef.current = false;
      }, 500);
    }
  }, [sourceLangCode, sourceSpeechCode, offlineSpeech, isListening]);

  const toggleMic = useCallback(() => {
    if (isMicActive) {
      // Turn off
      setIsMicActive(false);
      impactLight();
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (err) {
        logger.debug("Speech", "Failed to stop speech in toggleMic", err);
      }
    } else {
      // Turn on
      setIsMicActive(true);
      impactMedium();
      startSpeechRecognition();
    }
  }, [isMicActive, startSpeechRecognition]);

  // --- Render ---
  if (!visible) return null;

  if (!device) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>No camera device found</Text>
          <Text style={styles.errorSubtext}>
            Dual-Stream requires a physical device with a camera
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
            Allow camera access for live text + speech translation
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
      {/* Single AVCaptureSession only. The previous version mounted a bare
          <Camera> alongside <OCRCamera> on the same back-camera device — iOS
          can't share a device between two sessions, which silently broke
          live OCR and could leave the audio/video stack in a bad state that
          cascaded into mic-record failures (-11803 / -16409) when the user
          tapped the mic. OCRCamera's wrapper spreads props onto the
          underlying VisionCamera, so this single instance handles preview
          + live OCR. Pause is implemented by no-op'ing the callback so we
          don't repeatedly tear down/rebuild the capture session. */}
      <OCRCamera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={visible}
        mode="recognize"
        options={{ language: getOCRLanguage(sourceLangCode) }}
        callback={isPaused ? () => {} : handleOCRResult}
      />

      {/* OCR text overlays */}
      {detectedBlocks.map((block) => {
        if (!blockOpacities.has(block.id)) {
          if (blockOpacities.size > 100) {
            const firstKey = blockOpacities.keys().next().value;
            if (firstKey !== undefined) blockOpacities.delete(firstKey);
          }
          const val = new Animated.Value(0);
          blockOpacities.set(block.id, val);
          Animated.timing(val, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }).start();
        }
        return (
          <DetectedBlockOverlay
            key={block.id}
            block={block}
            animatedOpacity={blockOpacities.get(block.id)!}
            screenWidth={screenDims.width}
            screenHeight={screenDims.height}
          />
        );
      })}

      {/* ===== Top Control Bar ===== */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topButton}
          onPress={onClose}
          accessibilityLabel="Close dual-stream view"
        >
          <Text style={styles.topButtonText}>✕</Text>
        </TouchableOpacity>

        <View style={styles.dualBadge}>
          <Text style={styles.dualBadgeText}>DUAL</Text>
          <View style={styles.dualBadgeDot} />
          <Text style={styles.langText}>
            {sourceLangCode.toUpperCase()} → {targetLangCode.toUpperCase()}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.topButton, isPaused && styles.topButtonActive]}
          onPress={() => setIsPaused((p) => !p)}
          accessibilityLabel={isPaused ? "Resume OCR" : "Pause OCR"}
        >
          <Text style={styles.topButtonText}>{isPaused ? "▶" : "⏸"}</Text>
        </TouchableOpacity>
      </View>

      {/* ===== Pipeline Status Indicators ===== */}
      <View style={styles.pipelineIndicators}>
        {/* OCR indicator */}
        <View style={[styles.pipelineChip, isOCRTranslating && styles.pipelineChipActive]}>
          <Text style={styles.pipelineChipIcon}>📷</Text>
          <Text style={styles.pipelineChipLabel}>
            OCR {isPaused ? "paused" : detectedBlocks.length > 0 ? `${detectedBlocks.length}` : "scanning"}
          </Text>
          {isOCRTranslating && (
            <ActivityIndicator size="small" color="#a8a4ff" style={{ marginLeft: 4 }} />
          )}
        </View>

        {/* Speech indicator */}
        <View style={[styles.pipelineChip, isListening && styles.pipelineChipActive]}>
          <Text style={styles.pipelineChipIcon}>🎙️</Text>
          <Text style={styles.pipelineChipLabel}>
            {!isMicActive ? "off" : isListening ? "listening" : "starting..."}
          </Text>
          {isSpeechTranslating && (
            <ActivityIndicator size="small" color="#ffd93d" style={{ marginLeft: 4 }} />
          )}
        </View>
      </View>

      {/* ===== Speech Subtitle Bar (bottom) ===== */}
      <View style={styles.subtitleContainer}>
        {/* Previous subtitles (faded) */}
        {subtitleHistory.map((item, idx) => (
          <View
            key={item.timestamp}
            style={[styles.subtitleRow, { opacity: 0.3 + idx * 0.15 }]}
          >
            <Text style={styles.subtitleTranslated} numberOfLines={1}>
              {item.translated}
            </Text>
          </View>
        ))}

        {/* Current live subtitle */}
        {(speechOriginal || isListening) && (
          <Animated.View style={[styles.subtitleLive, { opacity: subtitleOpacity }]}>
            {speechOriginal ? (
              <>
                <Text style={styles.subtitleOriginal} numberOfLines={2}>
                  {speechOriginal}
                </Text>
                {speechTranslated ? (
                  <Text style={styles.subtitleTranslatedLive} numberOfLines={2}>
                    {speechTranslated}
                  </Text>
                ) : isSpeechTranslating ? (
                  <View style={styles.subtitleTranslatingRow}>
                    <ActivityIndicator size="small" color="#ffd93d" />
                    <Text style={styles.subtitleTranslatingText}>Translating...</Text>
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={styles.subtitleHint}>Listening for speech...</Text>
            )}
          </Animated.View>
        )}

        {/* Mic toggle + status bar */}
        <View style={styles.micBar}>
          {/* Mic pulse ring */}
          {isListening && (
            <Animated.View
              style={[
                styles.micPulseRing,
                {
                  transform: [{ scale: micPulseAnim }],
                  opacity: micPulseOpacity,
                },
              ]}
            />
          )}

          <TouchableOpacity
            style={[
              styles.micButton,
              isMicActive && styles.micButtonActive,
            ]}
            onPress={toggleMic}
            accessibilityLabel={isMicActive ? "Turn off speech recognition" : "Turn on speech recognition"}
            accessibilityRole="button"
          >
            <Text style={styles.micButtonIcon}>
              {isMicActive ? "🎙️" : "🔇"}
            </Text>
          </TouchableOpacity>

          <View style={styles.micStatusTextContainer}>
            {!isMicActive ? (
              <Text style={styles.micStatusText}>Tap mic for speech subtitles</Text>
            ) : isListening ? (
              <Text style={[styles.micStatusText, { color: "#ffd93d" }]}>
                Speech → Subtitles active
              </Text>
            ) : (
              <Text style={styles.micStatusText}>Starting mic...</Text>
            )}
          </View>

          {ocrError && (
            <Text style={styles.ocrErrorText} numberOfLines={1}>
              OCR: {ocrError}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");

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
    backgroundColor: primaryAlpha.active,
  },
  topButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  dualBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: primaryAlpha.accent,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    gap: 6,
  },
  dualBadgeText: {
    color: "#ffd93d",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  dualBadgeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ffd93d",
  },
  langText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },

  // Pipeline indicators
  pipelineIndicators: {
    position: "absolute",
    top: Platform.OS === "ios" ? 110 : 96,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  pipelineChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  pipelineChipActive: {
    borderColor: primaryAlpha.border,
    backgroundColor: "rgba(26,26,46,0.7)",
  },
  pipelineChipIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  pipelineChipLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: "600",
  },

  // Subtitle area
  subtitleContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  subtitleRow: {
    paddingVertical: 2,
  },
  subtitleTranslated: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    textAlign: "center",
  },
  subtitleLive: {
    paddingVertical: 6,
    minHeight: 44,
  },
  subtitleOriginal: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 4,
  },
  subtitleTranslatedLive: {
    color: "#ffd93d",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subtitleTranslatingRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  subtitleTranslatingText: {
    color: "rgba(255,215,61,0.6)",
    fontSize: 14,
  },
  subtitleHint: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 14,
    textAlign: "center",
    fontStyle: "italic",
  },

  // Mic bar
  micBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 10,
    paddingBottom: 4,
    gap: 12,
  },
  micPulseRing: {
    position: "absolute",
    left: SCREEN_WIDTH / 2 - 56, // centered relative to mic button
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,215,61,0.3)",
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
  },
  micButtonActive: {
    backgroundColor: "rgba(255,215,61,0.25)",
    borderColor: "#ffd93d",
  },
  micButtonIcon: {
    fontSize: 22,
  },
  micStatusTextContainer: {
    flex: 1,
  },
  micStatusText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    fontWeight: "600",
  },
  ocrErrorText: {
    color: "#ff6b6b",
    fontSize: 11,
    maxWidth: 120,
  },
});
