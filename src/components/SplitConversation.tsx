import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Animated,
  Platform,
} from "react-native";
import GlassBackdrop from "./GlassBackdrop";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import * as Speech from "expo-speech";
import { startSpeechSession } from "../utils/speechSession";
import { impactLight, impactMedium } from "../services/haptics";
import { translateText, type TranslateOptions } from "../services/translation";
import { useLanguage } from "../contexts/LanguageContext";
import { useSettings } from "../contexts/SettingsContext";
import { useGlossary } from "../contexts/GlossaryContext";
import { useTranslationData } from "../contexts/TranslationDataContext";
import { useStreak } from "../contexts/StreakContext";
import { useTheme } from "../contexts/ThemeContext";
import { logger } from "../services/logger";
import { newHistoryId } from "../types";

interface SplitConversationProps {
  visible: boolean;
  onClose: () => void;
}

interface TranslationResult {
  original: string;
  translated: string;
}

function SplitConversation({ visible, onClose }: SplitConversationProps) {
  const { sourceLang, targetLang } = useLanguage();
  const { settings, reduceMotion, maybeRequestReview } = useSettings();
  const { glossaryLookup } = useGlossary();
  const { setHistory } = useTranslationData();
  const { updateStreak } = useStreak();
  const { colors } = useTheme();

  const [activeSpeaker, setActiveSpeaker] = useState<"A" | "B" | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [translatedPreview, setTranslatedPreview] = useState("");
  const [lastA, setLastA] = useState<TranslationResult | null>(null);
  const [lastB, setLastB] = useState<TranslationResult | null>(null);
  // Auto turn-taking: after one speaker finishes, the other speaker's
  // mic is queued to take over once TTS playback completes. We surface
  // this as `nextSpeaker` so we can give the receiving half a soft
  // pulse — telling the other person "you're up next" — without
  // actually starting the mic until the synthesizer is done (otherwise
  // the playback would leak into the recognizer).
  const [nextSpeaker, setNextSpeaker] = useState<"A" | "B" | null>(null);

  const activeSpeakerRef = useRef<"A" | "B">("A");
  const finalTextRef = useRef("");
  const translatedRef = useRef("");
  const translationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confidenceRef = useRef<number | undefined>(undefined);
  // visibleRef mirrors the prop so deferred callbacks (TTS onDone,
  // setTimeout) can bail out cleanly when the user closes the modal
  // mid-utterance — accessing a stale `visible` from closure would
  // restart the mic on a hidden component.
  const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  const autoSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pulse animation
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isListening && !reduceMotion) {
      const loop = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.5, duration: 1000, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 0, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(pulseOpacity, { toValue: 0.4, duration: 0, useNativeDriver: true }),
            Animated.timing(pulseOpacity, { toValue: 0, duration: 1000, useNativeDriver: true }),
          ]),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
      pulseOpacity.setValue(0);
    }
  }, [isListening, reduceMotion, pulseAnim, pulseOpacity]);

  // Debounced translation
  const debouncedTranslate = useCallback(
    (text: string) => {
      if (translationTimeout.current) clearTimeout(translationTimeout.current);
      if (!text.trim()) return;

      translationTimeout.current = setTimeout(async () => {
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const isB = activeSpeakerRef.current === "B";
        const fromCode = isB ? targetLang.code : sourceLang.code;
        const toCode = isB ? sourceLang.code : targetLang.code;

        try {
          const glossaryMatch = glossaryLookup(text.trim(), fromCode, toCode);
          const result = glossaryMatch
            ? { translatedText: glossaryMatch, confidence: 1.0 }
            : await translateText(text.trim(), fromCode, toCode, {
                signal: controller.signal,
                provider: settings.translationProvider,
              } as TranslateOptions);
          if (!controller.signal.aborted) {
            setTranslatedPreview(result.translatedText);
            translatedRef.current = result.translatedText;
            confidenceRef.current = result.confidence;
          }
        } catch (err) {
          if (controller.signal.aborted) return;
        }
      }, 300);
    },
    [sourceLang.code, targetLang.code, settings.translationProvider, glossaryLookup]
  );

  // Speech recognition events
  useSpeechRecognitionEvent("start", () => setIsListening(true));

  // Forward-declared ref to startListeningAs so the `end` handler can
  // schedule the auto turn-taking handoff before the function itself is
  // defined below. Assigned in the effect just after startListeningAs.
  const startListeningAsRef = useRef<((s: "A" | "B") => void) | null>(null);

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    const final = finalTextRef.current.trim();
    const translated = translatedRef.current.trim();
    const speaker = activeSpeakerRef.current;

    if (final && translated) {
      // Update last translation for display
      const result = { original: final, translated };
      if (speaker === "A") {
        setLastA(result);
      } else {
        setLastB(result);
      }

      // Save to history
      setHistory((prev) => [
        ...prev,
        {
          id: newHistoryId(),
          original: final,
          translated,
          status: "ok" as const,
          speaker,
          confidence: confidenceRef.current,
          sourceLangCode: sourceLang.code,
          targetLangCode: targetLang.code,
          timestamp: Date.now(),
        },
      ]);
      maybeRequestReview();
      updateStreak();

      // Auto turn-taking: queue the OTHER speaker for the next turn.
      // This is the killer feature for face-to-face — it means neither
      // person has to physically reach for the device between
      // utterances. We surface the queued speaker via `nextSpeaker` so
      // the UI can show a "your turn" cue, then actually start the mic
      // when TTS playback ends (or after a 600ms beat if TTS is off),
      // ensuring the synthesizer audio doesn't leak into recognition.
      const handoffTo: "A" | "B" = speaker === "A" ? "B" : "A";
      setNextSpeaker(handoffTo);

      const ttsLang = speaker === "B" ? sourceLang.speechCode : targetLang.speechCode;
      const handoff = () => {
        // Bail if the modal closed or the user manually grabbed a mic
        // in the interim (which would set activeSpeaker to something
        // other than null and we'd respect their explicit choice).
        if (!visibleRef.current) return;
        startListeningAsRef.current?.(handoffTo);
      };

      if (settings.autoPlayTTS) {
        Speech.speak(translated, {
          language: ttsLang,
          rate: settings.speechRate,
          onDone: handoff,
          // onStopped fires if Speech.stop() is called (e.g. by
          // startSpeechSession in the next mic acquire). Don't double-
          // handoff in that case — the explicit start path is already
          // running.
          onError: handoff,
        });
      } else {
        autoSwitchTimerRef.current = setTimeout(handoff, 600);
      }
    }

    setLiveText("");
    setTranslatedPreview("");
    finalTextRef.current = "";
    translatedRef.current = "";
    confidenceRef.current = undefined;
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript || "";
    const isFinal = event.isFinal;

    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (settings.silenceTimeout > 0) {
      silenceTimerRef.current = setTimeout(
        () => ExpoSpeechRecognitionModule.stop(),
        settings.silenceTimeout * 1000
      );
    }

    if (isFinal) {
      const updated = finalTextRef.current ? `${finalTextRef.current} ${transcript}` : transcript;
      finalTextRef.current = updated;
      setLiveText(updated);
      debouncedTranslate(updated);
    } else {
      const combined = finalTextRef.current ? `${finalTextRef.current} ${transcript}` : transcript;
      setLiveText(combined);
      debouncedTranslate(combined);
    }
  });

  useSpeechRecognitionEvent("error", () => {
    setIsListening(false);
  });

  const startListeningAs = useCallback(async (speaker: "A" | "B") => {
    // Clear any pending auto-handoff timer — if the user manually taps
    // a mic mid-handoff, we honor their choice and drop the queued one.
    if (autoSwitchTimerRef.current) {
      clearTimeout(autoSwitchTimerRef.current);
      autoSwitchTimerRef.current = null;
    }
    setNextSpeaker(null);

    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      // Small delay to let stop complete before starting new
      await new Promise((r) => setTimeout(r, 300));
    }

    activeSpeakerRef.current = speaker;
    setActiveSpeaker(speaker);

    impactMedium();

    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) return;

    const speechLang = speaker === "B" ? targetLang.speechCode : sourceLang.speechCode;

    // See src/utils/speechSession.ts — guards against -11803 / -16409.
    startSpeechSession({
      lang: speechLang,
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: settings.offlineSpeech,
    });
  }, [isListening, sourceLang.speechCode, targetLang.speechCode, settings.offlineSpeech]);

  // Wire the forward-declared ref the `end` handler reads from.
  useEffect(() => {
    startListeningAsRef.current = startListeningAs;
  }, [startListeningAs]);

  const stopListening = useCallback(() => {
    impactLight();
    // User explicitly stopped — abandon the auto-handoff for this turn.
    if (autoSwitchTimerRef.current) {
      clearTimeout(autoSwitchTimerRef.current);
      autoSwitchTimerRef.current = null;
    }
    setNextSpeaker(null);
    ExpoSpeechRecognitionModule.stop();
  }, []);

  // Replay the last translation on a given side. Used by the small
  // ↻ button next to each displayed translation so the listener can
  // re-hear the auto-TTS without forcing the other person to repeat.
  const replayHalf = useCallback((speaker: "A" | "B") => {
    const result = speaker === "A" ? lastB : lastA; // each half shows the OTHER side's translation
    if (!result) return;
    impactLight();
    // Stop any in-flight TTS first so back-to-back replay taps don't
    // queue up overlapping playback.
    try { Speech.stop(); } catch (err) { logger.warn("Speech", "Speech.stop() failed in replayHalf", err); }
    const ttsLang = speaker === "A" ? targetLang.speechCode : sourceLang.speechCode;
    Speech.speak(result.translated, { language: ttsLang, rate: settings.speechRate });
  }, [lastA, lastB, sourceLang.speechCode, targetLang.speechCode, settings.speechRate]);

  // Cleanup on close. Also clears the pending auto-handoff timer and
  // stops any in-flight TTS so closing the modal mid-utterance doesn't
  // leave the synthesizer talking to itself or queue a mic acquisition
  // on an unmounted component.
  useEffect(() => {
    if (!visible) {
      if (isListening) ExpoSpeechRecognitionModule.stop();
      if (autoSwitchTimerRef.current) {
        clearTimeout(autoSwitchTimerRef.current);
        autoSwitchTimerRef.current = null;
      }
      try { Speech.stop(); } catch (err) { logger.warn("Speech", "Speech.stop() failed on visibility change", err); }
      setNextSpeaker(null);
      setLiveText("");
      setTranslatedPreview("");
      finalTextRef.current = "";
      translatedRef.current = "";
    }
  }, [visible]);

  // Unmount safety net — if the component is torn down while a timer
  // or TTS is still pending, the deferred handoff would otherwise fire
  // against an unmounted tree.
  useEffect(() => {
    return () => {
      if (autoSwitchTimerRef.current) clearTimeout(autoSwitchTimerRef.current);
      try { Speech.stop(); } catch (err) { logger.warn("Speech", "Speech.stop() failed on unmount", err); }
    };
  }, []);

  if (!visible) return null;

  const renderHalf = (speaker: "A" | "B") => {
    const isB = speaker === "B";
    const langName = isB ? targetLang.name : sourceLang.name;
    // Show what the OTHER speaker last said (translated for this person)
    const otherResult = isB ? lastA : lastB;
    const isSpeaking = isListening && activeSpeaker === speaker;
    const otherSpeaking = isListening && activeSpeaker !== speaker;
    // "Your turn" highlight: the auto-handoff queued THIS speaker but
    // we haven't started the mic yet (still waiting for TTS to finish).
    const isQueued = nextSpeaker === speaker && !isSpeaking;

    // Tap-anywhere-on-half: in a hands-free face-to-face context the
    // 56px mic button is a tiny target, especially when the device is
    // flat on a table. Wrapping the half in Pressable lets either
    // person slap their entire side to grab the mic. We disable the
    // press when the other speaker is mid-utterance so we don't yank
    // the session away from them.
    const handleHalfPress = () => {
      if (isSpeaking) {
        stopListening();
      } else if (!otherSpeaking) {
        startListeningAs(speaker);
      }
    };

    return (
      <Pressable
        onPress={handleHalfPress}
        disabled={otherSpeaking}
        style={({ pressed }) => [
          styles.half,
          {
            backgroundColor: colors.glassBgStrong,
            borderColor: isQueued ? colors.primary : colors.glassBorder,
            borderWidth: isQueued ? 2 : 1,
            opacity: pressed && !otherSpeaking ? 0.92 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={isSpeaking ? `Stop speaking ${langName}` : `Speak ${langName}`}
        accessibilityHint={isSpeaking ? "Stops listening and translates your speech" : `Starts the microphone for ${langName} speech recognition`}
      >
        <View style={styles.halfHeaderRow}>
          <Text style={[styles.langLabel, { color: colors.primary }]}>{langName}</Text>
          {otherResult ? (
            <TouchableOpacity
              onPress={(e) => {
                // Stop the press from bubbling up to the half's
                // Pressable, which would otherwise grab the mic.
                e.stopPropagation();
                replayHalf(speaker);
              }}
              style={[styles.replayBtn, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
              accessibilityRole="button"
              accessibilityLabel={`Replay ${langName} translation`}
              accessibilityHint="Speaks the last translation aloud again"
              hitSlop={10}
            >
              <Text style={[styles.replayIcon, { color: colors.primary }]}>↻</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Show other person's last translation (large, readable) */}
        <View style={styles.translationArea}>
          {otherResult ? (
            <>
              <Text style={[styles.mainTranslation, { color: colors.primaryText }]} numberOfLines={6} adjustsFontSizeToFit minimumFontScale={0.4}>
                {otherResult.translated}
              </Text>
              <Text style={[styles.originalSmall, { color: colors.dimText }]} numberOfLines={2}>
                {otherResult.original}
              </Text>
            </>
          ) : (
            <Text style={[styles.placeholder, { color: colors.mutedText }]}>
              {isB ? `Waiting for ${sourceLang.name} speaker...` : `Waiting for ${targetLang.name} speaker...`}
            </Text>
          )}
        </View>

        {/* Live preview when this person is speaking */}
        {isSpeaking && liveText ? (
          <View style={[styles.livePreview, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder, borderWidth: 1 }]}>
            <Text style={[styles.liveText, { color: colors.secondaryText }]} numberOfLines={2}>
              {liveText}
            </Text>
            {translatedPreview ? (
              <Text style={[styles.liveTranslated, { color: colors.primary }]} numberOfLines={2}>
                {translatedPreview}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Mic button */}
        <View style={styles.micArea}>
          {isSpeaking && (
            <Animated.View
              style={[
                styles.pulse,
                {
                  backgroundColor: colors.destructiveBg,
                  transform: [{ scale: pulseAnim }],
                  opacity: pulseOpacity,
                },
              ]}
            />
          )}
          <View
            style={[
              styles.micBtn,
              { backgroundColor: colors.primary },
              isSpeaking && { backgroundColor: colors.destructiveBg },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.micIcon}>{isSpeaking ? "⏹" : "🎙️"}</Text>
          </View>
          {isSpeaking ? (
            <Text style={[styles.listeningLabel, { color: colors.destructiveBg }]}>Listening...</Text>
          ) : isQueued ? (
            <Text style={[styles.listeningLabel, { color: colors.primary }]}>Your turn — tap to speak</Text>
          ) : (
            <Text style={[styles.listeningLabel, { color: colors.mutedText }]}>Tap anywhere to speak</Text>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.modalBg }]}>
      <GlassBackdrop />
      {/* Speaker A: top half, normal orientation */}
      {renderHalf("A")}

      {/* Divider with close button */}
      <View style={styles.divider}>
        <TouchableOpacity
          style={[styles.closeBtn, { backgroundColor: colors.glassBgStrong, borderColor: colors.glassBorder }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close split screen"
          accessibilityHint="Ends the face-to-face conversation and returns to the main screen"
          hitSlop={12}
        >
          <Text style={[styles.closeText, { color: colors.primaryText }]}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Speaker B: bottom half, rotated 180deg for face-to-face */}
      <View style={{ flex: 1, transform: [{ rotate: "180deg" }] }}>
        {renderHalf("B")}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    paddingTop: Platform.OS === "ios" ? 50 : 30,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  half: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
    justifyContent: "space-between",
    borderRadius: 16,
    marginHorizontal: 8,
    borderWidth: 1,
  },
  halfHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  langLabel: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    textAlign: "center",
  },
  replayBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  replayIcon: {
    fontSize: 16,
    fontWeight: "700",
  },
  translationArea: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  mainTranslation: {
    fontSize: 32,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 40,
  },
  originalSmall: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    fontStyle: "italic",
  },
  placeholder: {
    fontSize: 16,
    textAlign: "center",
    fontStyle: "italic",
  },
  livePreview: {
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  liveText: {
    fontSize: 14,
    textAlign: "center",
  },
  liveTranslated: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
  },
  micArea: {
    alignItems: "center",
    justifyContent: "center",
    height: 80,
  },
  pulse: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  micBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  micIcon: {
    fontSize: 24,
  },
  listeningLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  divider: {
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  closeText: {
    fontSize: 16,
    fontWeight: "700",
  },
});

export default React.memo(SplitConversation);
