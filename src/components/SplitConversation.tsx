import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
} from "react-native";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import * as Speech from "expo-speech";
import { impactLight, impactMedium } from "../services/haptics";
import { translateText, type TranslateOptions } from "../services/translation";
import { useLanguage } from "../contexts/LanguageContext";
import { useSettings } from "../contexts/SettingsContext";
import { useGlossary } from "../contexts/GlossaryContext";
import { useTranslationData } from "../contexts/TranslationDataContext";
import { useTheme } from "../contexts/ThemeContext";

interface SplitConversationProps {
  visible: boolean;
  onClose: () => void;
}

interface TranslationResult {
  original: string;
  translated: string;
}

export default function SplitConversation({ visible, onClose }: SplitConversationProps) {
  const { sourceLang, targetLang } = useLanguage();
  const { settings, reduceMotion, maybeRequestReview } = useSettings();
  const { glossaryLookup } = useGlossary();
  const { setHistory, updateStreak } = useTranslationData();
  const { colors } = useTheme();

  const [activeSpeaker, setActiveSpeaker] = useState<"A" | "B" | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [translatedPreview, setTranslatedPreview] = useState("");
  const [lastA, setLastA] = useState<TranslationResult | null>(null);
  const [lastB, setLastB] = useState<TranslationResult | null>(null);

  const activeSpeakerRef = useRef<"A" | "B">("A");
  const finalTextRef = useRef("");
  const translatedRef = useRef("");
  const translationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confidenceRef = useRef<number | undefined>(undefined);

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
          original: final,
          translated,
          speaker,
          confidence: confidenceRef.current,
          sourceLangCode: sourceLang.code,
          targetLangCode: targetLang.code,
          timestamp: Date.now(),
        },
      ]);
      maybeRequestReview();
      updateStreak();

      // Auto-TTS: speak the translation so the other person hears it
      if (settings.autoPlayTTS) {
        const ttsLang = speaker === "B" ? sourceLang.speechCode : targetLang.speechCode;
        Speech.speak(translated, { language: ttsLang, rate: settings.speechRate });
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

  const startListeningAs = async (speaker: "A" | "B") => {
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

    ExpoSpeechRecognitionModule.start({
      lang: speechLang,
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: settings.offlineSpeech,
    });
  };

  const stopListening = () => {
    impactLight();
    ExpoSpeechRecognitionModule.stop();
  };

  // Cleanup on close
  useEffect(() => {
    if (!visible) {
      if (isListening) ExpoSpeechRecognitionModule.stop();
      setLiveText("");
      setTranslatedPreview("");
      finalTextRef.current = "";
      translatedRef.current = "";
    }
  }, [visible]);

  if (!visible) return null;

  const renderHalf = (speaker: "A" | "B") => {
    const isB = speaker === "B";
    const langName = isB ? targetLang.name : sourceLang.name;
    // Show what the OTHER speaker last said (translated for this person)
    const otherResult = isB ? lastA : lastB;
    const isSpeaking = isListening && activeSpeaker === speaker;
    const otherSpeaking = isListening && activeSpeaker !== speaker;

    return (
      <View style={[styles.half, { backgroundColor: isB ? colors.translatedBubbleBg : colors.bubbleBg }]}>
        <Text style={[styles.langLabel, { color: colors.primary }]}>{langName}</Text>

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
          <View style={[styles.livePreview, { backgroundColor: colors.cardBg }]}>
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
          <TouchableOpacity
            style={[
              styles.micBtn,
              { backgroundColor: colors.primary },
              isSpeaking && { backgroundColor: colors.destructiveBg },
            ]}
            onPress={isSpeaking ? stopListening : () => startListeningAs(speaker)}
            disabled={otherSpeaking}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={isSpeaking ? `Stop speaking ${langName}` : `Speak ${langName}`}
          >
            <Text style={styles.micIcon}>{isSpeaking ? "⏹" : "🎙️"}</Text>
          </TouchableOpacity>
          {isSpeaking && (
            <Text style={[styles.listeningLabel, { color: colors.destructiveBg }]}>Listening...</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.modalBg }]}>
      {/* Speaker A: top half, normal orientation */}
      {renderHalf("A")}

      {/* Divider with close button */}
      <View style={[styles.divider, { backgroundColor: colors.borderLight }]}>
        <TouchableOpacity
          style={[styles.closeBtn, { backgroundColor: colors.cardBg }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close split screen"
        >
          <Text style={[styles.closeText, { color: colors.primaryText }]}>X</Text>
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
  },
  langLabel: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    textAlign: "center",
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
