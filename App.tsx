import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
  Linking,
  Animated,
  Keyboard,
  Share,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import LanguagePicker from "./src/components/LanguagePicker";
import {
  translateText,
  Language,
  LANGUAGES,
  AUTO_DETECT_LANGUAGE,
} from "./src/services/translation";

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [sourceLang, setSourceLang] = useState<Language>(LANGUAGES[0]); // English
  const [targetLang, setTargetLang] = useState<Language>(LANGUAGES[1]); // Spanish

  // Live speech text (partial + final results)
  const [liveText, setLiveText] = useState("");
  const [finalText, setFinalText] = useState("");

  // Translation state
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // History of completed translations
  const [history, setHistory] = useState<
    Array<{ original: string; translated: string }>
  >([]);

  const listRef = useRef<FlatList>(null);
  const translationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const errorDismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranslatedRef = useRef("");
  const finalTextRef = useRef("");

  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const HISTORY_KEY = "translation_history";

  // Pulse animation for mic button
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0)).current;

  // Skeleton shimmer animation
  const skeletonAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (isListening) {
      const pulse = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.6,
              duration: 1000,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(pulseOpacity, {
              toValue: 0.5,
              duration: 0,
              useNativeDriver: true,
            }),
            Animated.timing(pulseOpacity, {
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
      pulseAnim.setValue(1);
      pulseOpacity.setValue(0);
    }
  }, [isListening, pulseAnim, pulseOpacity]);

  useEffect(() => {
    if (isTranslating) {
      const shimmer = Animated.loop(
        Animated.sequence([
          Animated.timing(skeletonAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
          Animated.timing(skeletonAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        ])
      );
      shimmer.start();
      return () => shimmer.stop();
    } else {
      skeletonAnim.setValue(0.3);
    }
  }, [isTranslating, skeletonAnim]);

  // Load persisted history on mount
  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY).then((stored) => {
      if (stored) {
        try {
          setHistory(JSON.parse(stored));
        } catch {}
      }
    });
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 1500);
  }, []);

  const speakText = useCallback(
    async (text: string, langCode: string) => {
      if (speakingText === text) {
        Speech.stop();
        setSpeakingText(null);
        return;
      }
      Speech.stop();
      setSpeakingText(text);
      Speech.speak(text, {
        language: langCode,
        onDone: () => setSpeakingText(null),
        onStopped: () => setSpeakingText(null),
        onError: () => setSpeakingText(null),
      });
    },
    [speakingText]
  );

  const showError = useCallback((msg: string) => {
    if (errorDismissTimeout.current) clearTimeout(errorDismissTimeout.current);
    setErrorMessage(msg);
    errorDismissTimeout.current = setTimeout(() => setErrorMessage(""), 4000);
  }, []);

  // Persist history to AsyncStorage whenever it changes
  const historyLoaded = useRef(false);
  useEffect(() => {
    if (!historyLoaded.current) {
      // Skip saving on initial render; mark loaded after first history state update
      historyLoaded.current = true;
      return;
    }
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-100)));
  }, [history]);

  // Cleanup timeouts and speech on unmount
  useEffect(() => {
    return () => {
      if (translationTimeout.current) clearTimeout(translationTimeout.current);
      if (errorDismissTimeout.current) clearTimeout(errorDismissTimeout.current);
      abortControllerRef.current?.abort();
      Speech.stop();
    };
  }, []);

  // Debounced translation - translates as text comes in
  const debouncedTranslate = useCallback(
    (text: string) => {
      if (translationTimeout.current) {
        clearTimeout(translationTimeout.current);
      }

      if (!text.trim() || text.trim() === lastTranslatedRef.current) return;

      translationTimeout.current = setTimeout(async () => {
        // Cancel any in-flight translation request
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsTranslating(true);
        try {
          const result = await translateText(
            text.trim(),
            sourceLang.code,
            targetLang.code,
            controller.signal
          );
          if (!controller.signal.aborted) {
            setTranslatedText(result.translatedText);
            lastTranslatedRef.current = text.trim();
          }
        } catch (err) {
          if (controller.signal.aborted) return; // Ignore cancelled requests
          const msg = err instanceof Error ? err.message : "Translation failed";
          showError(msg);
        } finally {
          if (!controller.signal.aborted) {
            setIsTranslating(false);
          }
        }
      }, 300); // 300ms debounce - fast enough to feel live
    },
    [sourceLang.code, targetLang.code, showError]
  );

  // Speech recognition events
  useSpeechRecognitionEvent("start", () => {
    setIsListening(true);
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);

    // Save to history when speech ends
    if (finalText.trim() && translatedText.trim()) {
      setHistory((prev) => [
        ...prev,
        { original: finalText.trim(), translated: translatedText.trim() },
      ]);
    }
    setLiveText("");
    setFinalText("");
    setTranslatedText("");
    lastTranslatedRef.current = "";
    finalTextRef.current = "";
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript || "";
    const isFinal = event.isFinal;

    if (isFinal) {
      const updated = finalTextRef.current
        ? `${finalTextRef.current} ${transcript}`
        : transcript;
      finalTextRef.current = updated;
      setFinalText(updated);
      setLiveText(updated);
      debouncedTranslate(updated);
    } else {
      // Show partial results for live feel
      const combined = finalTextRef.current
        ? `${finalTextRef.current} ${transcript}`
        : transcript;
      setLiveText(combined);
      debouncedTranslate(combined);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    const errorMap: Record<string, string> = {
      "no-speech": "No speech detected. Try speaking louder.",
      "audio-capture": "Microphone unavailable. Check your device settings.",
      "not-allowed": "Microphone permission denied.",
      "network": "Network error during speech recognition.",
    };
    const msg = errorMap[event.error] || `Speech error: ${event.error}`;
    showError(msg);
    setIsListening(false);
  });

  // Auto-scroll history
  useEffect(() => {
    if (history.length > 0 || liveText) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [history, liveText, translatedText]);

  const startListening = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      Alert.alert(
        "Microphone Permission Required",
        "Live Translator needs microphone access to translate speech. Please enable it in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    setErrorMessage("");

    ExpoSpeechRecognitionModule.start({
      lang: sourceLang.code === "autodetect" ? "en-US" : sourceLang.speechCode,
      interimResults: true, // Key for live translation!
      continuous: true, // Keep listening
      maxAlternatives: 1,
    });
  };

  const stopListening = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    ExpoSpeechRecognitionModule.stop();
  };

  const swapLanguages = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (sourceLang.code === "autodetect") {
      // Can't swap auto-detect into target; use English as source instead
      setSourceLang(targetLang);
      setTargetLang(LANGUAGES[0]); // English
    } else {
      setSourceLang(targetLang);
      setTargetLang(sourceLang);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    AsyncStorage.removeItem(HISTORY_KEY);
  };

  const shareHistory = useCallback(async () => {
    if (history.length === 0) return;
    const lines = history.map(
      (item, i) => `${i + 1}. ${item.original}\n   → ${item.translated}`
    );
    const text = `Live Translator - ${history.length} translation(s)\n\n${lines.join("\n\n")}`;
    try {
      await Share.share({ message: text });
    } catch {}
  }, [history]);

  const [typedText, setTypedText] = useState("");

  const submitTypedText = useCallback(async () => {
    const text = typedText.trim();
    if (!text) return;
    Keyboard.dismiss();
    setTypedText("");

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsTranslating(true);
    setLiveText(text);
    try {
      const result = await translateText(text, sourceLang.code, targetLang.code, controller.signal);
      if (!controller.signal.aborted) {
        setHistory((prev) => [...prev, { original: text, translated: result.translatedText }]);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : "Translation failed";
        showError(msg);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsTranslating(false);
        setLiveText("");
      }
    }
  }, [typedText, sourceLang.code, targetLang.code, showError]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        {/* Header */}
        <Text style={styles.title}>Live Translator</Text>

        {/* Language selectors */}
        <View style={styles.langRow}>
          <LanguagePicker
            label="From"
            selected={sourceLang}
            onSelect={setSourceLang}
            showAutoDetect
          />
          <TouchableOpacity
            style={styles.swapButton}
            onPress={swapLanguages}
            accessibilityRole="button"
            accessibilityLabel={`Swap languages. Currently translating from ${sourceLang.name} to ${targetLang.name}`}
          >
            <Text style={styles.swapIcon}>⇄</Text>
          </TouchableOpacity>
          <LanguagePicker
            label="To"
            selected={targetLang}
            onSelect={setTargetLang}
          />
        </View>

        {/* Error banner */}
        {errorMessage ? (
          <TouchableOpacity
            style={styles.errorBanner}
            onPress={() => setErrorMessage("")}
            accessibilityRole="alert"
            accessibilityLabel={`Error: ${errorMessage}. Tap to dismiss.`}
          >
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Text style={styles.errorDismiss} importantForAccessibility="no">✕</Text>
          </TouchableOpacity>
        ) : null}

        {/* Live translation area */}
        <FlatList
          ref={listRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          data={history}
          keyExtractor={(_, index) => String(index)}
          renderItem={({ item }) => (
            <View style={styles.historyItem}>
              <TouchableOpacity
                onPress={() => copyToClipboard(item.original)}
                style={styles.bubble}
                accessibilityRole="button"
                accessibilityLabel={`Original: ${item.original}. Tap to copy.`}
              >
                <Text style={styles.originalText}>{item.original}</Text>
                {copiedText === item.original && (
                  <Text style={styles.copiedBadge}>Copied!</Text>
                )}
              </TouchableOpacity>
              <View style={[styles.bubble, styles.translatedBubble]}>
                <TouchableOpacity
                  onPress={() => copyToClipboard(item.translated)}
                  accessibilityRole="button"
                  accessibilityLabel={`Translation: ${item.translated}. Tap to copy.`}
                >
                  <Text style={styles.translatedTextHistory}>
                    {item.translated}
                  </Text>
                  {copiedText === item.translated && (
                    <Text style={styles.copiedBadge}>Copied!</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.speakButton}
                  onPress={() => speakText(item.translated, targetLang.speechCode)}
                  accessibilityRole="button"
                  accessibilityLabel={speakingText === item.translated ? "Stop speaking" : `Speak translation: ${item.translated}`}
                >
                  <Text style={[styles.speakIcon, speakingText === item.translated && styles.speakIconActive]}>
                    {speakingText === item.translated ? "⏹" : "🔊"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListFooterComponent={
            liveText ? (
              <View style={styles.liveSection}>
                <View style={styles.liveDivider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.liveLabel}>
                    {isListening ? "● LIVE" : "PROCESSING"}
                  </Text>
                  <View style={styles.dividerLine} />
                </View>

                <View style={[styles.bubble, styles.liveBubble]}>
                  <Text style={styles.liveOriginalText}>{liveText}</Text>
                </View>

                {translatedText ? (
                  <View style={[styles.bubble, styles.liveTranslatedBubble]}>
                    <TouchableOpacity
                      onPress={() => copyToClipboard(translatedText)}
                      accessibilityRole="button"
                      accessibilityLabel={`Live translation: ${translatedText}. Tap to copy.`}
                    >
                      <Text style={styles.liveTranslatedText}>
                        {translatedText}
                      </Text>
                      {copiedText === translatedText && (
                        <Text style={styles.copiedBadge}>Copied!</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.speakButton}
                      onPress={() => speakText(translatedText, targetLang.speechCode)}
                      accessibilityRole="button"
                      accessibilityLabel={speakingText === translatedText ? "Stop speaking" : `Speak translation: ${translatedText}`}
                    >
                      <Text style={[styles.speakIcon, speakingText === translatedText && styles.speakIconActive]}>
                        {speakingText === translatedText ? "⏹" : "🔊"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : isTranslating ? (
                  <View style={[styles.bubble, styles.liveTranslatedBubble]}
                    accessibilityLabel="Translation loading"
                    accessibilityRole="progressbar"
                  >
                    <Animated.View style={[styles.skeletonLine, styles.skeletonLong, { opacity: skeletonAnim }]} />
                    <Animated.View style={[styles.skeletonLine, styles.skeletonShort, { opacity: skeletonAnim }]} />
                  </View>
                ) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={
            !isListening && !liveText ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🎙️</Text>
                <Text style={styles.emptyTitle}>Tap to start translating</Text>
                <Text style={styles.emptySubtitle}>
                  Speak naturally and see translations appear in real time
                </Text>
              </View>
            ) : null
          }
        />

        {/* Bottom controls */}
        <View style={styles.controls}>
          {history.length > 0 && !isListening && (
            <View style={styles.historyActions}>
              <TouchableOpacity
                style={styles.clearButton}
                onPress={clearHistory}
                accessibilityRole="button"
                accessibilityLabel="Clear translation history"
              >
                <Text style={styles.clearText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.clearButton}
                onPress={shareHistory}
                accessibilityRole="button"
                accessibilityLabel="Share translation history"
              >
                <Text style={styles.shareText}>Share</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.micButtonWrapper}>
            {isListening && (
              <Animated.View
                style={[
                  styles.pulseRing,
                  {
                    transform: [{ scale: pulseAnim }],
                    opacity: pulseOpacity,
                  },
                ]}
              />
            )}
            <TouchableOpacity
              style={[
                styles.micButton,
                isListening && styles.micButtonActive,
              ]}
              onPress={isListening ? stopListening : startListening}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={isListening ? "Stop listening" : "Start listening"}
              accessibilityState={{ busy: isListening }}
              accessibilityHint={isListening ? "Stops speech recognition" : "Starts speech recognition for translation"}
            >
              <Text style={styles.micIcon} importantForAccessibility="no">{isListening ? "⏹" : "🎙️"}</Text>
            </TouchableOpacity>
          </View>

          {isListening && (
            <View style={styles.listeningIndicator} accessibilityLiveRegion="polite">
              <Text style={styles.listeningDot} importantForAccessibility="no">●</Text>
              <Text style={styles.listeningLabel}>Listening...</Text>
            </View>
          )}

          {!isListening && (
            <View style={styles.textInputRow}>
              <TextInput
                style={styles.textInput}
                placeholder="Or type to translate..."
                placeholderTextColor="#555577"
                value={typedText}
                onChangeText={setTypedText}
                onSubmitEditing={submitTypedText}
                returnKeyType="send"
                editable={!isTranslating}
                accessibilityLabel="Type text to translate"
              />
              {typedText.trim() ? (
                <TouchableOpacity
                  style={styles.sendButton}
                  onPress={submitTypedText}
                  accessibilityRole="button"
                  accessibilityLabel="Translate typed text"
                >
                  <Text style={styles.sendIcon}>→</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0f0f23",
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? 40 : 10,
  },
  title: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 20,
  },
  langRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    marginBottom: 20,
  },
  swapButton: {
    backgroundColor: "#252547",
    borderRadius: 12,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 0,
  },
  swapIcon: {
    color: "#6c63ff",
    fontSize: 20,
    fontWeight: "700",
  },
  errorBanner: {
    backgroundColor: "#3d1a1a",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#ff4757",
  },
  errorText: {
    color: "#ff6b7a",
    fontSize: 14,
    flex: 1,
  },
  errorDismiss: {
    color: "#ff4757",
    fontSize: 16,
    marginLeft: 12,
    fontWeight: "700",
  },
  scrollArea: {
    flex: 1,
    marginBottom: 10,
  },
  scrollContent: {
    paddingBottom: 20,
    flexGrow: 1,
  },
  historyItem: {
    marginBottom: 16,
  },
  bubble: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 14,
    marginBottom: 6,
  },
  translatedBubble: {
    backgroundColor: "#1e1e40",
    borderLeftWidth: 3,
    borderLeftColor: "#6c63ff",
  },
  copiedBadge: {
    color: "#4ade80",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  originalText: {
    color: "#ccccdd",
    fontSize: 16,
    lineHeight: 22,
  },
  translatedTextHistory: {
    color: "#a8a4ff",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "500",
  },
  liveSection: {
    marginTop: 8,
  },
  liveDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#333355",
  },
  liveLabel: {
    color: "#ff4757",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  liveBubble: {
    backgroundColor: "#1a1a35",
    borderWidth: 1,
    borderColor: "#333355",
  },
  liveOriginalText: {
    color: "#eeeeff",
    fontSize: 18,
    lineHeight: 26,
  },
  liveTranslatedBubble: {
    backgroundColor: "#1a1a40",
    borderLeftWidth: 3,
    borderLeftColor: "#6c63ff",
    borderWidth: 1,
    borderColor: "#333366",
  },
  liveTranslatedText: {
    color: "#b8b4ff",
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
  },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: "#333366",
    marginBottom: 8,
  },
  skeletonLong: {
    width: "80%",
  },
  skeletonShort: {
    width: "50%",
    marginBottom: 0,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 60,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptySubtitle: {
    color: "#666688",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 40,
  },
  controls: {
    alignItems: "center",
    paddingBottom: Platform.OS === "android" ? 20 : 10,
    paddingTop: 10,
  },
  historyActions: {
    flexDirection: "row",
    gap: 20,
    marginBottom: 12,
  },
  clearButton: {
  },
  clearText: {
    color: "#555577",
    fontSize: 14,
    fontWeight: "600",
  },
  shareText: {
    color: "#6c63ff",
    fontSize: 14,
    fontWeight: "600",
  },
  micButtonWrapper: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#ff4757",
  },
  micButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#6c63ff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6c63ff",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  micButtonActive: {
    backgroundColor: "#ff4757",
    shadowColor: "#ff4757",
  },
  micIcon: {
    fontSize: 32,
  },
  listeningIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    gap: 6,
  },
  listeningDot: {
    color: "#ff4757",
    fontSize: 10,
  },
  listeningLabel: {
    color: "#ff4757",
    fontSize: 13,
    fontWeight: "600",
  },
  textInputRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    gap: 8,
    width: "100%",
  },
  textInput: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    color: "#ffffff",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#333355",
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#6c63ff",
    alignItems: "center",
    justifyContent: "center",
  },
  sendIcon: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  speakButton: {
    alignSelf: "flex-end",
    marginTop: 6,
    padding: 4,
  },
  speakIcon: {
    fontSize: 18,
  },
  speakIconActive: {
    opacity: 0.6,
  },
});
