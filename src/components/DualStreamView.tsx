import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
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
import { showBlockActionSheet } from "../utils/liveBlockActions";
import { pruneBlockOpacities } from "../utils/pruneBlockOpacities";

const DS_COLORS = {
  accent: "#a8a4ff",
  highlight: "#ffd93d",
  highlightFaded: "rgba(255,215,61,0.6)",
  highlightGlow: "rgba(255,215,61,0.3)",
  highlightBorder: "rgba(255,215,61,0.25)",
  error: "#ff6b6b",
  errorSecondary: "#ffa07a",
  bg: "#000",
  text: "#fff",
  textMuted: "#aaa",
  button: "#6c63ff",
} as const;
import { DetectedBlockOverlay, getOCRLanguage, OCR_OPTIONS_BASE, type DetectedBlock } from "./OCROverlay";
import { impactLight, impactMedium } from "../services/haptics";
import { logger } from "../services/logger";
import * as telemetry from "../services/telemetry";
import { primaryAlpha, type ThemeColors } from "../theme";

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

function DualStreamView({
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
  const [speechError, setSpeechError] = useState<string | null>(null);
  const speechFinalRef = useRef("");
  const lastSpeechTranslatedRef = useRef("");
  const speechTranslationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const isStartingRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the auto-restart timers fired from the "end" and "error" speech
  // events so we can cancel them on unmount. Without this, a 300ms/1000ms
  // pending restart could fire `startSpeechRecognition()` after the component
  // has torn down, causing a state-update-after-unmount warning. (#219)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref tracking isMicActive so setTimeout closures inside the "end"
  // and "error" speech event handlers read the current value, not a stale
  // capture from when the handler was registered. Without this, toggling the
  // mic off during the 300ms/1000ms restart delay would be ignored because
  // the closure still saw the old `true` value.
  const isMicActiveRef = useRef(false);
  useEffect(() => { isMicActiveRef.current = isMicActive; }, [isMicActive]);
  const isListeningRef = useRef(false);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);

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

  // Memoized so the frame processor doesn't rebuild on every DualStream
  // state change (isMicActive, speechOriginal, etc.). Without the memo the
  // options identity changed every render and every unrelated piece of
  // speech state tore down the OCR pipeline. (#4)
  const ocrOptions = useMemo(
    () => ({ ...OCR_OPTIONS_BASE, language: getOCRLanguage(sourceLangCode) }),
    [sourceLangCode]
  );

  // Tap handler for live OCR labels — opens the shared copy/speak action
  // sheet, same behavior as CameraTranslator so users don't have to
  // relearn the interaction between modes. (#10)
  const handleLiveBlockTap = useCallback(
    (block: DetectedBlock) => {
      showBlockActionSheet(block.originalText, block.translatedText, targetLangCode);
    },
    [targetLangCode]
  );

  // --- Lifecycle ---
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      ocrAbortRef.current?.abort();
      speechAbortRef.current?.abort();
      if (speechTranslationTimer.current) clearTimeout(speechTranslationTimer.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
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

  // Clear pending speech translation when languages change so stale closures
  // from the old language pair never fire.
  useEffect(() => {
    if (speechTranslationTimer.current) {
      clearTimeout(speechTranslationTimer.current);
      speechTranslationTimer.current = null;
    }
    speechAbortRef.current?.abort();
    setSpeechOriginal("");
    setSpeechTranslated("");
    setSpeechError(null);
    speechFinalRef.current = "";
    lastSpeechTranslatedRef.current = "";
  }, [sourceLangCode, targetLangCode]);

  // Clear OCR cache and overlay state when the component becomes hidden (mode
  // switch). Prevents stale translations from leaking between scanner modes
  // and stops Animated.Value entries from accumulating across switches. (#219)
  useEffect(() => {
    if (!visible) {
      clearOCRCache();
      blockOpacities.clear();
    }
  }, [visible, blockOpacities]);

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
    (text: string, isFinal?: boolean) => {
      if (speechTranslationTimer.current)
        clearTimeout(speechTranslationTimer.current);
      if (!text.trim() || text.trim() === lastSpeechTranslatedRef.current) return;

      const delay = isFinal ? 0 : 150;
      speechTranslationTimer.current = setTimeout(async () => {
        speechAbortRef.current?.abort();
        const controller = new AbortController();
        speechAbortRef.current = controller;

        setIsSpeechTranslating(true);
        setSpeechError(null);
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
            setSpeechError(null);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          telemetry.increment("speech.translateFail");
          // Tag as "Speech" (not "Translation") so the errors-by-tag crash
          // report line and Settings diagnostics rolling fail count lump all
          // speech-translate failures together regardless of which pipeline
          // (primary vs. DualStream secondary) produced them. (#141)
          logger.warn("Speech", "DualStream speech translate failed", err);
          // Surface a brief error hint in the subtitle bar so the user knows
          // their speech wasn't translated — previously this failed silently
          // and the user saw nothing after speaking. (#219)
          if (isMountedRef.current) {
            setSpeechError("Speech translation failed");
          }
        } finally {
          if (!controller.signal.aborted && isMountedRef.current) {
            setIsSpeechTranslating(false);
          }
        }
      }, delay);
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
      try {
        Speech.speak(speechTranslated.trim(), {
          language: targetSpeechCode,
          rate: speechRate,
        });
      } catch (err) {
        logger.warn("Speech", "DualStream auto-TTS failed", err);
      }
    }

    // Reset for next utterance
    setSpeechOriginal("");
    setSpeechTranslated("");
    setSpeechError(null);
    speechFinalRef.current = "";
    lastSpeechTranslatedRef.current = "";

    if (isMicActiveRef.current && isMountedRef.current) {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (isMicActiveRef.current && isMountedRef.current && !isStartingRef.current) {
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
      debouncedSpeechTranslate(updated, true);
    } else {
      const combined = speechFinalRef.current
        ? `${speechFinalRef.current} ${transcript}`
        : transcript;
      setSpeechOriginal(combined);
      debouncedSpeechTranslate(combined, false);
    }
  });

  useSpeechRecognitionEvent("error", () => {
    setIsListening(false);
    if (isMicActiveRef.current && isMountedRef.current) {
      setSpeechError(null);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (isMicActiveRef.current && isMountedRef.current && !isStartingRef.current && !isListeningRef.current) {
          startSpeechRecognition();
        }
      }, 1000);
    }
  });

  // --- Speech Controls ---
  const startSpeechRecognition = useCallback(async () => {
    if (isStartingRef.current || isListeningRef.current) return;
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

      startSpeechSession({
        lang: speechLang,
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: offlineSpeech,
        addsPunctuation: true,
      });
      setTimeout(() => {
        isStartingRef.current = false;
      }, 500);
    } catch (err) {
      isStartingRef.current = false;
      logger.warn("Speech", "DualStreamView startSpeechRecognition failed", err);
    }
  }, [sourceLangCode, sourceSpeechCode, offlineSpeech]);

  const toggleMic = useCallback(() => {
    if (isMicActive) {
      // Turn off
      setIsMicActive(false);
      impactLight();
      if (speechTranslationTimer.current) {
        clearTimeout(speechTranslationTimer.current);
        speechTranslationTimer.current = null;
      }
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      speechAbortRef.current?.abort();
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
        <View style={styles.errorContainer} accessible={true} accessibilityRole="alert">
          <Text style={styles.errorText}>No camera device found</Text>
          <Text style={styles.errorSubtext}>
            Dual-Stream requires a physical device with a camera
          </Text>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close dual-stream view"
            accessibilityHint="Returns to the scanner mode selection"
          >
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
            accessibilityRole="button"
            accessibilityLabel="Grant camera permission"
            accessibilityHint="Opens system permission dialog for camera access"
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close dual-stream view"
            accessibilityHint="Returns to the scanner mode selection"
          >
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
        options={ocrOptions}
        callback={isPaused ? () => {} : handleOCRResult}
      />

      {/* OCR text overlays */}
      {detectedBlocks.map((block) => {
        if (!blockOpacities.has(block.id)) {
          // Same pruning strategy as CameraTranslator (#219): cap at 50,
          // prefer evicting entries not in the active set to avoid GC churn
          // from Animated.Values on long scanning sessions.
          pruneBlockOpacities(blockOpacities, new Set(detectedBlocks.map((b) => b.id)), 50);
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
            onPress={handleLiveBlockTap}
          />
        );
      })}

      {/* ===== Top Control Bar ===== */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close dual-stream view"
          accessibilityHint="Returns to the scanner mode selection"
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
          accessibilityRole="button"
          accessibilityLabel={isPaused ? "Resume OCR" : "Pause OCR"}
          accessibilityHint={isPaused ? "Resumes live text detection from camera" : "Pauses live text detection"}
          accessibilityState={{ selected: isPaused }}
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
            <ActivityIndicator size="small" color={DS_COLORS.accent} style={styles.pipelineSpinner} />
          )}
        </View>

        {/* Speech indicator */}
        <View style={[styles.pipelineChip, isListening && styles.pipelineChipActive]}>
          <Text style={styles.pipelineChipIcon}>🎙️</Text>
          <Text style={styles.pipelineChipLabel}>
            {!isMicActive ? "off" : isListening ? "listening" : "starting..."}
          </Text>
          {isSpeechTranslating && (
            <ActivityIndicator size="small" color={DS_COLORS.highlight} style={styles.pipelineSpinner} />
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
                    <ActivityIndicator size="small" color={DS_COLORS.highlight} />
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
            accessibilityRole="button"
            accessibilityLabel={isMicActive ? "Turn off speech recognition" : "Turn on speech recognition"}
            accessibilityHint={isMicActive ? "Stops listening for speech and hides subtitles" : "Starts listening for speech and shows live subtitles"}
            accessibilityState={{ selected: isMicActive }}
          >
            <Text style={styles.micButtonIcon}>
              {isMicActive ? "🎙️" : "🔇"}
            </Text>
          </TouchableOpacity>

          <View style={styles.micStatusTextContainer}>
            {!isMicActive ? (
              <Text style={styles.micStatusText}>Tap mic for speech subtitles</Text>
            ) : isListening ? (
              <Text style={[styles.micStatusText, { color: DS_COLORS.highlight }]}>
                Speech → Subtitles active
              </Text>
            ) : (
              <Text style={styles.micStatusText}>Starting mic...</Text>
            )}
          </View>

          {ocrError && (
            <Text
              style={styles.ocrErrorText}
              numberOfLines={1}
              accessibilityLiveRegion="polite"
            >
              OCR: {ocrError}
            </Text>
          )}
          {speechError && (
            <Text
              style={styles.speechErrorText}
              numberOfLines={1}
              accessibilityLiveRegion="polite"
            >
              🎙️ {speechError}
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
    backgroundColor: DS_COLORS.bg,
    zIndex: 999,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  errorText: {
    color: DS_COLORS.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  errorSubtext: {
    color: DS_COLORS.textMuted,
    fontSize: 15,
    textAlign: "center",
    marginBottom: 24,
  },
  permissionButton: {
    backgroundColor: DS_COLORS.button,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 12,
  },
  permissionButtonText: {
    color: DS_COLORS.text,
    fontSize: 16,
    fontWeight: "700",
  },
  closeButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  closeButtonText: {
    color: DS_COLORS.button,
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
    color: DS_COLORS.text,
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
    color: DS_COLORS.highlight,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  dualBadgeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: DS_COLORS.highlight,
  },
  langText: {
    color: DS_COLORS.text,
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
    color: DS_COLORS.highlight,
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
    color: DS_COLORS.highlightFaded,
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
    backgroundColor: DS_COLORS.highlightGlow,
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
    backgroundColor: DS_COLORS.highlightBorder,
    borderColor: DS_COLORS.highlight,
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
    color: DS_COLORS.error,
    fontSize: 11,
    maxWidth: 120,
  },
  speechErrorText: {
    color: DS_COLORS.errorSecondary,
    fontSize: 11,
    maxWidth: 140,
  },
  pipelineSpinner: {
    marginLeft: 4,
  },
});

export default React.memo(DualStreamView);
