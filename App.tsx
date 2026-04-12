import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
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
  PanResponder,
  LayoutAnimation,
  UIManager,
} from "react-native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { useNetInfo } from "@react-native-community/netinfo";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import LanguagePicker from "./src/components/LanguagePicker";
import SettingsModal, { Settings, DEFAULT_SETTINGS, FONT_SIZE_SCALES } from "./src/components/SettingsModal";
import {
  translateText,
  Language,
  LANGUAGES,
  AUTO_DETECT_LANGUAGE,
} from "./src/services/translation";
import { getColors } from "./src/theme";

function SwipeableRow({ onDelete, children }: { onDelete: () => void; children: React.ReactNode }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const rowHeight = useRef(new Animated.Value(1)).current;
  const THRESHOLD = -80;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          translateX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < THRESHOLD) {
          Animated.timing(translateX, {
            toValue: -400,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onDelete());
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        }
      },
    })
  ).current;

  return (
    <View style={swipeStyles.container}>
      <View style={swipeStyles.deleteBackground}>
        <Text style={swipeStyles.deleteText}>Delete</Text>
        <Text style={swipeStyles.deleteIcon}>🗑</Text>
      </View>
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const swipeStyles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  deleteBackground: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 120,
    backgroundColor: "#ff4757",
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    alignSelf: "flex-end",
  },
  deleteText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  deleteIcon: {
    fontSize: 16,
  },
});

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

  // Conversation mode
  const [conversationMode, setConversationMode] = useState(false);
  const activeSpeakerRef = useRef<"A" | "B">("A");

  // History of completed translations
  const [history, setHistory] = useState<
    Array<{ original: string; translated: string; speaker?: "A" | "B"; favorited?: boolean }>
  >([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const listRef = useRef<FlatList>(null);
  const translationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const errorDismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranslatedRef = useRef("");
  const finalTextRef = useRef("");

  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [recentLangCodes, setRecentLangCodes] = useState<string[]>([]);
  const HISTORY_KEY = "translation_history";
  const SETTINGS_KEY = "app_settings";
  const RECENT_LANGS_KEY = "recent_languages";

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

  // Load persisted history and settings on mount
  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY).then((stored) => {
      if (stored) {
        try {
          setHistory(JSON.parse(stored));
        } catch {}
      }
    });
    AsyncStorage.getItem(SETTINGS_KEY).then((stored) => {
      if (stored) {
        try {
          setSettings((prev) => ({ ...prev, ...JSON.parse(stored) }));
        } catch {}
      }
    });
    AsyncStorage.getItem(RECENT_LANGS_KEY).then((stored) => {
      if (stored) {
        try {
          setRecentLangCodes(JSON.parse(stored));
        } catch {}
      }
    });
  }, []);

  const trackRecentLang = useCallback((code: string) => {
    if (code === "autodetect") return;
    setRecentLangCodes((prev) => {
      const updated = [code, ...prev.filter((c) => c !== code)].slice(0, 5);
      AsyncStorage.setItem(RECENT_LANGS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateSettings = useCallback((newSettings: Settings) => {
    setSettings(newSettings);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    if (settings.hapticsEnabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
        rate: settings.speechRate,
        onDone: () => setSpeakingText(null),
        onStopped: () => setSpeakingText(null),
        onError: () => setSpeakingText(null),
      });
    },
    [speakingText, settings.speechRate]
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

        // In conversation mode, speaker B translates in reverse direction
        const fromCode = (conversationMode && activeSpeakerRef.current === "B") ? targetLang.code : sourceLang.code;
        const toCode = (conversationMode && activeSpeakerRef.current === "B") ? sourceLang.code : targetLang.code;

        setIsTranslating(true);
        try {
          const result = await translateText(
            text.trim(),
            fromCode,
            toCode,
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
    [sourceLang.code, targetLang.code, conversationMode, showError]
  );

  // Speech recognition events
  useSpeechRecognitionEvent("start", () => {
    setIsListening(true);
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);

    // Save to history when speech ends
    if (finalText.trim() && translatedText.trim()) {
      const speaker = conversationMode ? activeSpeakerRef.current : undefined;
      setHistory((prev) => [
        ...prev,
        { original: finalText.trim(), translated: translatedText.trim(), speaker },
      ]);
      // Auto-play the translation if enabled
      if (settings.autoPlayTTS) {
        const ttsLang = (conversationMode && speaker === "B")
          ? sourceLang.speechCode
          : targetLang.speechCode;
        Speech.speak(translatedText.trim(), { language: ttsLang, rate: settings.speechRate });
      }
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
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    setSearchQuery("");

    const speechLang = (conversationMode && activeSpeakerRef.current === "B")
      ? targetLang.speechCode
      : (sourceLang.code === "autodetect" ? "en-US" : sourceLang.speechCode);

    ExpoSpeechRecognitionModule.start({
      lang: speechLang,
      interimResults: true, // Key for live translation!
      continuous: true, // Keep listening
      maxAlternatives: 1,
    });
  };

  const startListeningAs = (speaker: "A" | "B") => {
    activeSpeakerRef.current = speaker;
    startListening();
  };

  const stopListening = () => {
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    ExpoSpeechRecognitionModule.stop();
  };

  const swapLanguages = () => {
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const deleteHistoryItem = useCallback((index: number) => {
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setHistory((prev) => prev.filter((_, i) => i !== index));
  }, [settings.hapticsEnabled]);

  const toggleFavorite = useCallback((index: number) => {
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHistory((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, favorited: !item.favorited } : item
      )
    );
  }, [settings.hapticsEnabled]);

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
  const [searchQuery, setSearchQuery] = useState("");

  const filteredHistory = useMemo(() => {
    let filtered = history;
    if (showFavoritesOnly) {
      filtered = filtered.filter((item) => item.favorited);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.original.toLowerCase().includes(q) ||
          item.translated.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [history, searchQuery, showFavoritesOnly]);

  const hasFavorites = useMemo(() => history.some((item) => item.favorited), [history]);

  const fontScale = FONT_SIZE_SCALES[settings.fontSize];
  const dynamicFontSizes = useMemo(() => ({
    original: { fontSize: Math.round(16 * fontScale) },
    translated: { fontSize: Math.round(16 * fontScale) },
    liveOriginal: { fontSize: Math.round(18 * fontScale) },
    liveTranslated: { fontSize: Math.round(20 * fontScale) },
    chatText: { fontSize: Math.round(15 * fontScale) },
  }), [fontScale]);

  const colors = useMemo(() => getColors(settings.theme), [settings.theme]);

  // Network connectivity
  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;

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
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.safeBg }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => setShowSettings(true)}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <Text style={[styles.settingsIcon, { color: colors.mutedText }]}>⚙</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.titleText }]}>Live Translator</Text>
          <TouchableOpacity
            style={[styles.modeToggle, { backgroundColor: colors.cardBg }, conversationMode && styles.modeToggleActive]}
            onPress={() => setConversationMode((m) => !m)}
            accessibilityRole="button"
            accessibilityLabel={conversationMode ? "Switch to standard mode" : "Switch to conversation mode"}
            accessibilityState={{ selected: conversationMode }}
          >
            <Text style={[styles.modeToggleText, { color: colors.mutedText }, conversationMode && styles.modeToggleTextActive]}>
              {conversationMode ? "Chat" : "Chat"}
            </Text>
          </TouchableOpacity>
        </View>

        <SettingsModal
          visible={showSettings}
          onClose={() => setShowSettings(false)}
          settings={settings}
          onUpdate={updateSettings}
        />

        {/* Language selectors */}
        <View style={styles.langRow}>
          <LanguagePicker
            label="From"
            selected={sourceLang}
            onSelect={(lang) => { setSourceLang(lang); trackRecentLang(lang.code); }}
            showAutoDetect
            recentCodes={recentLangCodes}
            colors={colors}
          />
          <TouchableOpacity
            style={[styles.swapButton, { backgroundColor: colors.cardBg }]}
            onPress={swapLanguages}
            accessibilityRole="button"
            accessibilityLabel={`Swap languages. Currently translating from ${sourceLang.name} to ${targetLang.name}`}
          >
            <Text style={[styles.swapIcon, { color: colors.primary }]}>⇄</Text>
          </TouchableOpacity>
          <LanguagePicker
            label="To"
            selected={targetLang}
            onSelect={(lang) => { setTargetLang(lang); trackRecentLang(lang.code); }}
            recentCodes={recentLangCodes}
            colors={colors}
          />
        </View>

        {/* Offline banner */}
        {isOffline && (
          <View
            style={[styles.offlineBanner, { backgroundColor: colors.offlineBg, borderColor: colors.offlineBorder }]}
            accessibilityRole="alert"
            accessibilityLabel="No internet connection. Translations require network access."
          >
            <Text style={[styles.offlineIcon]}>⚡</Text>
            <Text style={[styles.offlineText, { color: colors.offlineText }]}>
              No connection — translations unavailable
            </Text>
          </View>
        )}

        {/* Error banner */}
        {errorMessage ? (
          <TouchableOpacity
            style={[styles.errorBanner, { backgroundColor: colors.errorBg, borderColor: colors.errorBorder }]}
            onPress={() => setErrorMessage("")}
            accessibilityRole="alert"
            accessibilityLabel={`Error: ${errorMessage}. Tap to dismiss.`}
          >
            <Text style={[styles.errorText, { color: colors.errorText }]}>{errorMessage}</Text>
            <Text style={[styles.errorDismiss, { color: colors.errorBorder }]} importantForAccessibility="no">✕</Text>
          </TouchableOpacity>
        ) : null}

        {/* Live translation area */}
        <FlatList
          ref={listRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          data={filteredHistory}
          keyExtractor={(item, index) => `${index}-${item.original.slice(0, 20)}`}
          ListHeaderComponent={
            history.length > 2 && !isListening ? (
              <View>
                <View style={styles.searchRow}>
                  <TextInput
                    style={[styles.searchInput, { backgroundColor: colors.bubbleBg, color: colors.primaryText, borderColor: colors.border }]}
                    placeholder="Search translations..."
                    placeholderTextColor={colors.placeholderText}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    accessibilityLabel="Search translation history"
                    returnKeyType="search"
                  />
                  {searchQuery ? (
                    <TouchableOpacity
                      style={styles.searchClear}
                      onPress={() => setSearchQuery("")}
                      accessibilityRole="button"
                      accessibilityLabel="Clear search"
                    >
                      <Text style={[styles.searchClearText, { color: colors.mutedText }]}>✕</Text>
                    </TouchableOpacity>
                  ) : null}
                  {hasFavorites ? (
                    <TouchableOpacity
                      style={[styles.favFilterButton, { backgroundColor: colors.bubbleBg, borderColor: colors.border }, showFavoritesOnly && styles.favFilterButtonActive]}
                      onPress={() => setShowFavoritesOnly((v) => !v)}
                      accessibilityRole="button"
                      accessibilityLabel={showFavoritesOnly ? "Show all translations" : "Show favorites only"}
                      accessibilityState={{ selected: showFavoritesOnly }}
                    >
                      <Text style={styles.favFilterIcon}>{showFavoritesOnly ? "★" : "☆"}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null
          }
          renderItem={({ item, index }) => {
            const isB = item.speaker === "B";
            const speakLang = isB ? sourceLang.speechCode : targetLang.speechCode;
            // Find the real index in the full history array for deletion
            const realIndex = searchQuery.trim()
              ? history.findIndex((h) => h === item)
              : index;
            return (
            <SwipeableRow onDelete={() => deleteHistoryItem(realIndex)}>
            {conversationMode && item.speaker ? (
              <View style={[styles.chatRow, isB && styles.chatRowRight]}>
                <View style={[styles.chatBubble, isB ? [styles.chatBubbleB, { backgroundColor: colors.translatedBubbleBg }] : [styles.chatBubbleA, { backgroundColor: colors.bubbleBg }]]}>
                  <Text style={[styles.chatSpeakerLabel, { color: colors.primary }]}>
                    {isB ? targetLang.name : sourceLang.name}
                  </Text>
                  <TouchableOpacity onPress={() => copyToClipboard(item.original)}>
                    <Text style={[styles.chatOriginal, { color: colors.secondaryText }, dynamicFontSizes.chatText]}>{item.original}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => copyToClipboard(item.translated)}>
                    <Text style={[styles.chatTranslated, { color: colors.translatedText }, dynamicFontSizes.chatText]}>{item.translated}</Text>
                  </TouchableOpacity>
                  {copiedText === item.original || copiedText === item.translated ? (
                    <Text style={styles.copiedBadge}>Copied!</Text>
                  ) : null}
                  <View style={styles.bubbleActions}>
                    <TouchableOpacity
                      style={styles.speakButton}
                      onPress={() => speakText(item.translated, speakLang)}
                      accessibilityRole="button"
                      accessibilityLabel={speakingText === item.translated ? "Stop speaking" : "Speak translation"}
                    >
                      <Text style={[styles.speakIcon, speakingText === item.translated && styles.speakIconActive]}>
                        {speakingText === item.translated ? "⏹" : "🔊"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.favoriteButton}
                      onPress={() => toggleFavorite(realIndex)}
                      accessibilityRole="button"
                      accessibilityLabel={item.favorited ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Text style={[styles.favoriteIcon, { color: colors.dimText }, item.favorited && styles.favoriteIconActive]}>
                        {item.favorited ? "★" : "☆"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.historyItem}>
                <TouchableOpacity
                  onPress={() => copyToClipboard(item.original)}
                  style={[styles.bubble, { backgroundColor: colors.bubbleBg }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Original: ${item.original}. Tap to copy.`}
                >
                  <Text style={[styles.originalText, { color: colors.secondaryText }, dynamicFontSizes.original]}>{item.original}</Text>
                  {copiedText === item.original && (
                    <Text style={styles.copiedBadge}>Copied!</Text>
                  )}
                </TouchableOpacity>
                <View style={[styles.bubble, styles.translatedBubble, { backgroundColor: colors.translatedBubbleBg, borderLeftColor: colors.primary }]}>
                  <TouchableOpacity
                    onPress={() => copyToClipboard(item.translated)}
                    accessibilityRole="button"
                    accessibilityLabel={`Translation: ${item.translated}. Tap to copy.`}
                  >
                    <Text style={[styles.translatedTextHistory, { color: colors.translatedText }, dynamicFontSizes.translated]}>
                      {item.translated}
                    </Text>
                    {copiedText === item.translated && (
                      <Text style={styles.copiedBadge}>Copied!</Text>
                    )}
                  </TouchableOpacity>
                  <View style={styles.bubbleActions}>
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
                    <TouchableOpacity
                      style={styles.favoriteButton}
                      onPress={() => toggleFavorite(realIndex)}
                      accessibilityRole="button"
                      accessibilityLabel={item.favorited ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Text style={[styles.favoriteIcon, { color: colors.dimText }, item.favorited && styles.favoriteIconActive]}>
                        {item.favorited ? "★" : "☆"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
            </SwipeableRow>
            );
          }}
          ListFooterComponent={
            liveText ? (
              <View style={styles.liveSection}>
                <View style={styles.liveDivider}>
                  <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                  <Text style={styles.liveLabel}>
                    {isListening ? "● LIVE" : "PROCESSING"}
                  </Text>
                  <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                </View>

                <View style={[styles.bubble, styles.liveBubble, { backgroundColor: colors.liveBubbleBg, borderColor: colors.border }]}>
                  <Text style={[styles.liveOriginalText, { color: colors.liveOriginalText }, dynamicFontSizes.liveOriginal]}>{liveText}</Text>
                </View>

                {translatedText ? (
                  <View style={[styles.bubble, styles.liveTranslatedBubble, { backgroundColor: colors.liveTranslatedBubbleBg, borderColor: colors.border, borderLeftColor: colors.primary }]}>
                    <TouchableOpacity
                      onPress={() => copyToClipboard(translatedText)}
                      accessibilityRole="button"
                      accessibilityLabel={`Live translation: ${translatedText}. Tap to copy.`}
                    >
                      <Text style={[styles.liveTranslatedText, { color: colors.liveTranslatedText }, dynamicFontSizes.liveTranslated]}>
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
                  <View style={[styles.bubble, styles.liveTranslatedBubble, { backgroundColor: colors.liveTranslatedBubbleBg, borderColor: colors.border, borderLeftColor: colors.primary }]}
                    accessibilityLabel="Translation loading"
                    accessibilityRole="progressbar"
                  >
                    <Animated.View style={[styles.skeletonLine, styles.skeletonLong, { opacity: skeletonAnim, backgroundColor: colors.skeleton }]} />
                    <Animated.View style={[styles.skeletonLine, styles.skeletonShort, { opacity: skeletonAnim, backgroundColor: colors.skeleton }]} />
                  </View>
                ) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={
            !isListening && !liveText ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🎙️</Text>
                <Text style={[styles.emptyTitle, { color: colors.titleText }]}>Tap to start translating</Text>
                <Text style={[styles.emptySubtitle, { color: colors.dimText }]}>
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
                <Text style={[styles.clearText, { color: colors.dimText }]}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.clearButton}
                onPress={shareHistory}
                accessibilityRole="button"
                accessibilityLabel="Share translation history"
              >
                <Text style={[styles.shareText, { color: colors.primary }]}>Share</Text>
              </TouchableOpacity>
            </View>
          )}

          {conversationMode ? (
            <View style={styles.convoControls}>
              <View style={styles.convoMicCol}>
                <View style={styles.micButtonWrapper}>
                  {isListening && activeSpeakerRef.current === "A" && (
                    <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseAnim }], opacity: pulseOpacity }]} />
                  )}
                  <TouchableOpacity
                    style={[styles.micButton, styles.micButtonSmall, isListening && activeSpeakerRef.current === "A" && styles.micButtonActive]}
                    onPress={isListening ? stopListening : () => startListeningAs("A")}
                    activeOpacity={0.7}
                    disabled={isListening && activeSpeakerRef.current !== "A"}
                    accessibilityRole="button"
                    accessibilityLabel={`Speak ${sourceLang.name}`}
                  >
                    <Text style={styles.micIcon} importantForAccessibility="no">🎙️</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.convoLabel, { color: colors.mutedText }]}>{sourceLang.name}</Text>
              </View>
              <View style={styles.convoMicCol}>
                <View style={styles.micButtonWrapper}>
                  {isListening && activeSpeakerRef.current === "B" && (
                    <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseAnim }], opacity: pulseOpacity }]} />
                  )}
                  <TouchableOpacity
                    style={[styles.micButton, styles.micButtonSmall, isListening && activeSpeakerRef.current === "B" && styles.micButtonActive]}
                    onPress={isListening ? stopListening : () => startListeningAs("B")}
                    activeOpacity={0.7}
                    disabled={isListening && activeSpeakerRef.current !== "B"}
                    accessibilityRole="button"
                    accessibilityLabel={`Speak ${targetLang.name}`}
                  >
                    <Text style={styles.micIcon} importantForAccessibility="no">🎙️</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.convoLabel, { color: colors.mutedText }]}>{targetLang.name}</Text>
              </View>
            </View>
          ) : (
            <>
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
            </>
          )}

          {!isListening && (
            <View style={styles.textInputRow}>
              <TextInput
                style={[styles.textInput, { backgroundColor: colors.bubbleBg, color: colors.primaryText, borderColor: colors.border }]}
                placeholder="Or type to translate..."
                placeholderTextColor={colors.placeholderText}
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
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? 40 : 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  settingsButton: {
    position: "absolute",
    left: 0,
    padding: 4,
  },
  settingsIcon: {
    fontSize: 22,
  },
  modeToggle: {
    position: "absolute",
    right: 0,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  modeToggleActive: {
    backgroundColor: "#6c63ff",
  },
  modeToggleText: {
    fontSize: 12,
    fontWeight: "700",
  },
  modeToggleTextActive: {
    color: "#ffffff",
  },
  langRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    marginBottom: 20,
  },
  swapButton: {
    borderRadius: 12,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 0,
  },
  swapIcon: {
    fontSize: 20,
    fontWeight: "700",
  },
  offlineBanner: {
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    gap: 8,
  },
  offlineIcon: {
    fontSize: 16,
  },
  offlineText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  errorBanner: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
  },
  errorText: {
    fontSize: 14,
    flex: 1,
  },
  errorDismiss: {
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
    fontSize: 14,
    borderWidth: 1,
  },
  searchClear: {
    marginLeft: 8,
    padding: 4,
  },
  searchClearText: {
    fontSize: 16,
    fontWeight: "700",
  },
  historyItem: {
    marginBottom: 16,
  },
  bubble: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 6,
  },
  translatedBubble: {
    borderLeftWidth: 3,
  },
  copiedBadge: {
    color: "#4ade80",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  originalText: {
    fontSize: 16,
    lineHeight: 22,
  },
  translatedTextHistory: {
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
  },
  liveLabel: {
    color: "#ff4757",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  liveBubble: {
    borderWidth: 1,
  },
  liveOriginalText: {
    fontSize: 18,
    lineHeight: 26,
  },
  liveTranslatedBubble: {
    borderLeftWidth: 3,
    borderWidth: 1,
  },
  liveTranslatedText: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
  },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
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
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptySubtitle: {
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
    fontSize: 14,
    fontWeight: "600",
  },
  shareText: {
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
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 15,
    borderWidth: 1,
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
  chatRow: {
    marginBottom: 12,
    alignItems: "flex-start",
  },
  chatRowRight: {
    alignItems: "flex-end",
  },
  chatBubble: {
    maxWidth: "80%",
    borderRadius: 16,
    padding: 12,
  },
  chatBubbleA: {
    borderBottomLeftRadius: 4,
  },
  chatBubbleB: {
    borderBottomRightRadius: 4,
  },
  chatSpeakerLabel: {
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  chatOriginal: {
    fontSize: 15,
    lineHeight: 21,
  },
  chatTranslated: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
    marginTop: 4,
  },
  convoControls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 40,
  },
  convoMicCol: {
    alignItems: "center",
    gap: 8,
  },
  convoLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  micButtonSmall: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  bubbleActions: {
    flexDirection: "row",
    alignSelf: "flex-end",
    alignItems: "center",
    marginTop: 6,
    gap: 12,
  },
  speakButton: {
    padding: 4,
  },
  speakIcon: {
    fontSize: 18,
  },
  speakIconActive: {
    opacity: 0.6,
  },
  favoriteButton: {
    padding: 4,
  },
  favoriteIcon: {
    fontSize: 18,
  },
  favoriteIconActive: {
    color: "#ffd700",
  },
  favFilterButton: {
    marginLeft: 8,
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  favFilterButtonActive: {
    backgroundColor: "#2a2a4a",
    borderColor: "#ffd700",
  },
  favFilterIcon: {
    fontSize: 18,
    color: "#ffd700",
  },
});
