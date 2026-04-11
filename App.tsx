import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Platform,
} from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import LanguagePicker from "./src/components/LanguagePicker";
import {
  translateText,
  Language,
  LANGUAGES,
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

  // History of completed translations
  const [history, setHistory] = useState<
    Array<{ original: string; translated: string }>
  >([]);

  const scrollRef = useRef<ScrollView>(null);
  const translationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranslatedRef = useRef("");

  // Debounced translation - translates as text comes in
  const debouncedTranslate = useCallback(
    (text: string) => {
      if (translationTimeout.current) {
        clearTimeout(translationTimeout.current);
      }

      if (!text.trim() || text.trim() === lastTranslatedRef.current) return;

      translationTimeout.current = setTimeout(async () => {
        setIsTranslating(true);
        try {
          const result = await translateText(
            text.trim(),
            sourceLang.code,
            targetLang.code
          );
          setTranslatedText(result.translatedText);
          lastTranslatedRef.current = text.trim();
        } catch (err) {
          console.warn("Translation error:", err);
        } finally {
          setIsTranslating(false);
        }
      }, 300); // 300ms debounce - fast enough to feel live
    },
    [sourceLang.code, targetLang.code]
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
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript || "";
    const isFinal = event.isFinal;

    if (isFinal) {
      setFinalText((prev) => {
        const updated = prev ? `${prev} ${transcript}` : transcript;
        setLiveText(updated);
        debouncedTranslate(updated);
        return updated;
      });
    } else {
      // Show partial results for live feel
      const combined = finalText ? `${finalText} ${transcript}` : transcript;
      setLiveText(combined);
      debouncedTranslate(combined);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    console.warn("Speech recognition error:", event.error);
    setIsListening(false);
  });

  // Auto-scroll history
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [history, liveText, translatedText]);

  const startListening = async () => {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      console.warn("Permissions not granted", result);
      return;
    }

    ExpoSpeechRecognitionModule.start({
      lang: sourceLang.speechCode,
      interimResults: true, // Key for live translation!
      continuous: true, // Keep listening
      maxAlternatives: 1,
    });
  };

  const stopListening = () => {
    ExpoSpeechRecognitionModule.stop();
  };

  const swapLanguages = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
  };

  const clearHistory = () => {
    setHistory([]);
  };

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
          />
          <TouchableOpacity style={styles.swapButton} onPress={swapLanguages}>
            <Text style={styles.swapIcon}>⇄</Text>
          </TouchableOpacity>
          <LanguagePicker
            label="To"
            selected={targetLang}
            onSelect={setTargetLang}
          />
        </View>

        {/* Live translation area */}
        <ScrollView
          ref={scrollRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
        >
          {/* History */}
          {history.map((item, index) => (
            <View key={index} style={styles.historyItem}>
              <View style={styles.bubble}>
                <Text style={styles.originalText}>{item.original}</Text>
              </View>
              <View style={[styles.bubble, styles.translatedBubble]}>
                <Text style={styles.translatedTextHistory}>
                  {item.translated}
                </Text>
              </View>
            </View>
          ))}

          {/* Current live text */}
          {liveText ? (
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
                  <Text style={styles.liveTranslatedText}>
                    {translatedText}
                  </Text>
                </View>
              ) : isTranslating ? (
                <View style={styles.translatingRow}>
                  <ActivityIndicator size="small" color="#6c63ff" />
                  <Text style={styles.translatingText}>Translating...</Text>
                </View>
              ) : null}
            </View>
          ) : !isListening && history.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🎙️</Text>
              <Text style={styles.emptyTitle}>Tap to start translating</Text>
              <Text style={styles.emptySubtitle}>
                Speak naturally and see translations appear in real time
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Bottom controls */}
        <View style={styles.controls}>
          {history.length > 0 && !isListening && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={clearHistory}
            >
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.micButton,
              isListening && styles.micButtonActive,
            ]}
            onPress={isListening ? stopListening : startListening}
            activeOpacity={0.7}
          >
            <Text style={styles.micIcon}>{isListening ? "⏹" : "🎙️"}</Text>
          </TouchableOpacity>

          {isListening && (
            <View style={styles.listeningIndicator}>
              <Text style={styles.listeningDot}>●</Text>
              <Text style={styles.listeningLabel}>Listening...</Text>
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
  translatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
  },
  translatingText: {
    color: "#6c63ff",
    fontSize: 14,
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
  clearButton: {
    marginBottom: 12,
  },
  clearText: {
    color: "#555577",
    fontSize: 14,
    fontWeight: "600",
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
});
