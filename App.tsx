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
  useWindowDimensions,
  Modal,
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
import * as StoreReview from "expo-store-review";
import LanguagePicker from "./src/components/LanguagePicker";
import SettingsModal, { Settings, DEFAULT_SETTINGS, FONT_SIZE_SCALES } from "./src/components/SettingsModal";
import {
  translateText,
  Language,
  LANGUAGES,
  AUTO_DETECT_LANGUAGE,
} from "./src/services/translation";
import { getColors } from "./src/theme";
import { PHRASE_CATEGORIES, getPhrasesForCategory, getPhraseOfTheDay, type PhraseCategory, type OfflinePhrase } from "./src/services/offlinePhrases";
import { romanize, needsRomanization, getRomanizationName } from "./src/services/romanization";

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
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

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
    Array<{ original: string; translated: string; speaker?: "A" | "B"; favorited?: boolean; pending?: boolean; error?: boolean; sourceLangCode?: string; targetLangCode?: string; confidence?: number; detectedLang?: string }>
  >([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const listRef = useRef<FlatList>(null);
  const translationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const errorDismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranslatedRef = useRef("");
  const finalTextRef = useRef("");
  const lastConfidenceRef = useRef<number | undefined>(undefined);
  const lastDetectedLangRef = useRef<string | undefined>(undefined);
  const ratingPromptedRef = useRef(false);
  const translationCountRef = useRef(0);

  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);

  // Translation comparison modal
  const [compareData, setCompareData] = useState<{
    original: string;
    results: Array<{ provider: string; text: string; loading?: boolean }>;
  } | null>(null);

  // Translation feedback
  const [correctionPrompt, setCorrectionPrompt] = useState<{ index: number; original: string; translated: string } | null>(null);
  const [correctionText, setCorrectionText] = useState("");

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  // Undo delete state
  const [deletedItem, setDeletedItem] = useState<{ item: typeof history[number]; index: number } | null>(null);
  const undoTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPhrasebook, setShowPhrasebook] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [phraseCategory, setPhraseCategory] = useState<PhraseCategory>("basic");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [recentLangCodes, setRecentLangCodes] = useState<string[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const HISTORY_KEY = "translation_history";
  const SETTINGS_KEY = "app_settings";
  const RECENT_LANGS_KEY = "recent_languages";
  const OFFLINE_QUEUE_KEY = "offline_translation_queue";
  const LANG_PAIRS_KEY = "saved_language_pairs";
  const ONBOARDING_KEY = "onboarding_completed";
  const RATING_PROMPTED_KEY = "rating_prompted";
  const TRANSLATION_COUNT_KEY = "translation_count";
  const RATING_THRESHOLD = 20;
  const GLOSSARY_KEY = "user_glossary";

  // User glossary entries
  const [glossary, setGlossary] = useState<
    Array<{ source: string; target: string; sourceLang: string; targetLang: string }>
  >([]);
  const [showGlossary, setShowGlossary] = useState(false);
  const [glossarySource, setGlossarySource] = useState("");
  const [glossaryTarget, setGlossaryTarget] = useState("");

  // Saved language pair shortcuts
  const [savedPairs, setSavedPairs] = useState<
    Array<{ sourceCode: string; targetCode: string }>
  >([]);

  // Offline translation queue
  const [offlineQueue, setOfflineQueue] = useState<
    Array<{ text: string; sourceLang: string; targetLang: string; timestamp: number }>
  >([]);
  const isProcessingQueue = useRef(false);

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
    AsyncStorage.getItem(OFFLINE_QUEUE_KEY).then((stored) => {
      if (stored) {
        try {
          setOfflineQueue(JSON.parse(stored));
        } catch {}
      }
    });
    AsyncStorage.getItem(LANG_PAIRS_KEY).then((stored) => {
      if (stored) {
        try {
          setSavedPairs(JSON.parse(stored));
        } catch {}
      }
    });
    AsyncStorage.getItem(ONBOARDING_KEY).then((stored) => {
      if (!stored) {
        setShowOnboarding(true);
        setOnboardingStep(0);
      }
    });
    AsyncStorage.getItem(RATING_PROMPTED_KEY).then((stored) => {
      if (stored) ratingPromptedRef.current = true;
    });
    AsyncStorage.getItem(TRANSLATION_COUNT_KEY).then((stored) => {
      if (stored) translationCountRef.current = parseInt(stored, 10) || 0;
    });
    AsyncStorage.getItem(GLOSSARY_KEY).then((stored) => {
      if (stored) {
        try {
          setGlossary(JSON.parse(stored));
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

  const isCurrentPairSaved = useMemo(
    () => savedPairs.some((p) => p.sourceCode === sourceLang.code && p.targetCode === targetLang.code),
    [savedPairs, sourceLang.code, targetLang.code]
  );

  const toggleSavePair = useCallback(() => {
    if (sourceLang.code === "autodetect") return;
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSavedPairs((prev) => {
      const exists = prev.some(
        (p) => p.sourceCode === sourceLang.code && p.targetCode === targetLang.code
      );
      const updated = exists
        ? prev.filter((p) => !(p.sourceCode === sourceLang.code && p.targetCode === targetLang.code))
        : [...prev, { sourceCode: sourceLang.code, targetCode: targetLang.code }].slice(0, 8);
      AsyncStorage.setItem(LANG_PAIRS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, [sourceLang.code, targetLang.code, settings.hapticsEnabled]);

  const applyPair = useCallback((sourceCode: string, targetCode: string) => {
    const src = LANGUAGES.find((l) => l.code === sourceCode);
    const tgt = LANGUAGES.find((l) => l.code === targetCode);
    if (src && tgt) {
      if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSourceLang(src);
      setTargetLang(tgt);
    }
  }, [settings.hapticsEnabled]);

  const removeSavedPair = useCallback((sourceCode: string, targetCode: string) => {
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSavedPairs((prev) => {
      const updated = prev.filter((p) => !(p.sourceCode === sourceCode && p.targetCode === targetCode));
      AsyncStorage.setItem(LANG_PAIRS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, [settings.hapticsEnabled]);

  const updateSettings = useCallback((newSettings: Settings) => {
    setSettings(newSettings);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
  }, []);

  const maybeRequestReview = useCallback(async () => {
    if (ratingPromptedRef.current) return;
    translationCountRef.current += 1;
    AsyncStorage.setItem(TRANSLATION_COUNT_KEY, String(translationCountRef.current));
    if (translationCountRef.current >= RATING_THRESHOLD) {
      ratingPromptedRef.current = true;
      AsyncStorage.setItem(RATING_PROMPTED_KEY, "1");
      const isAvailable = await StoreReview.isAvailableAsync();
      if (isAvailable) {
        // Small delay so it doesn't interrupt the translation flow
        setTimeout(() => StoreReview.requestReview(), 1500);
      }
    }
  }, []);

  const glossaryLookup = useCallback((text: string, srcLang: string, tgtLang: string): string | null => {
    const normalized = text.trim().toLowerCase();
    const entry = glossary.find(
      (g) => g.source.toLowerCase() === normalized && g.sourceLang === srcLang && g.targetLang === tgtLang
    );
    return entry ? entry.target : null;
  }, [glossary]);

  const addGlossaryEntry = useCallback(() => {
    const src = glossarySource.trim();
    const tgt = glossaryTarget.trim();
    if (!src || !tgt) return;
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setGlossary((prev) => {
      // Replace existing entry for same source+langs, or add new
      const filtered = prev.filter(
        (g) => !(g.source.toLowerCase() === src.toLowerCase() && g.sourceLang === sourceLang.code && g.targetLang === targetLang.code)
      );
      const updated = [...filtered, { source: src, target: tgt, sourceLang: sourceLang.code, targetLang: targetLang.code }];
      AsyncStorage.setItem(GLOSSARY_KEY, JSON.stringify(updated));
      return updated;
    });
    setGlossarySource("");
    setGlossaryTarget("");
  }, [glossarySource, glossaryTarget, sourceLang.code, targetLang.code, settings.hapticsEnabled]);

  const removeGlossaryEntry = useCallback((index: number) => {
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGlossary((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      AsyncStorage.setItem(GLOSSARY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, [settings.hapticsEnabled]);

  const submitCorrection = useCallback(() => {
    if (!correctionPrompt || !correctionText.trim()) return;
    const { index, original } = correctionPrompt;
    const correction = correctionText.trim();
    // Update history with corrected translation
    setHistory((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], translated: correction };
      }
      return updated;
    });
    // Save to glossary for future use
    setGlossary((prev) => {
      const srcLang = sourceLang.code;
      const tgtLang = targetLang.code;
      const filtered = prev.filter(
        (g) => !(g.source.toLowerCase() === original.toLowerCase() && g.sourceLang === srcLang && g.targetLang === tgtLang)
      );
      const updated = [...filtered, { source: original, target: correction, sourceLang: srcLang, targetLang: tgtLang }];
      AsyncStorage.setItem(GLOSSARY_KEY, JSON.stringify(updated));
      return updated;
    });
    if (settings.hapticsEnabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCorrectionPrompt(null);
    setCorrectionText("");
  }, [correctionPrompt, correctionText, sourceLang.code, targetLang.code, settings.hapticsEnabled]);

  const copyToClipboard = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    if (settings.hapticsEnabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 1500);
  }, []);

  const compareTranslation = useCallback(async (original: string, currentTranslation: string) => {
    // Show modal immediately with current translation
    const providers: Array<{ key: string; label: string }> = [
      { key: "mymemory", label: "MyMemory" },
    ];
    if (settings.translationProvider !== "mymemory") {
      providers.push({ key: settings.translationProvider, label: settings.translationProvider === "deepl" ? "DeepL" : "Google" });
    }

    // Initialize with current provider's result and loading states for others
    const initialResults = providers.map((p) => {
      if (p.key === settings.translationProvider || (settings.translationProvider === "mymemory" && p.key === "mymemory")) {
        return { provider: p.label, text: currentTranslation };
      }
      return { provider: p.label, text: "", loading: true };
    });
    setCompareData({ original, results: initialResults });

    // Fetch from other providers in parallel
    for (const p of providers) {
      if (p.key === settings.translationProvider) continue;
      if (p.key === "mymemory" && settings.translationProvider === "mymemory") continue;
      try {
        const result = await translateText(original, sourceLang.code, targetLang.code, {
          provider: p.key as any,
          apiKey: p.key === "mymemory" ? "" : settings.apiKey,
        });
        setCompareData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            results: prev.results.map((r) =>
              r.provider === p.label ? { ...r, text: result.translatedText, loading: false } : r
            ),
          };
        });
      } catch {
        setCompareData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            results: prev.results.map((r) =>
              r.provider === p.label ? { ...r, text: "Failed to load", loading: false } : r
            ),
          };
        });
      }
    }
  }, [settings, sourceLang.code, targetLang.code]);

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
      if (undoTimeout.current) clearTimeout(undoTimeout.current);
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
          // Check user glossary first
          const glossaryMatch = glossaryLookup(text.trim(), fromCode, toCode);
          const result = glossaryMatch
            ? { translatedText: glossaryMatch, confidence: 1.0 }
            : await translateText(
                text.trim(),
                fromCode,
                toCode,
                { signal: controller.signal, provider: settings.translationProvider, apiKey: settings.apiKey }
              );
          if (!controller.signal.aborted) {
            setTranslatedText(result.translatedText);
            lastTranslatedRef.current = text.trim();
            lastConfidenceRef.current = result.confidence;
            lastDetectedLangRef.current = (result as any).detectedLanguage;
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
        { original: finalText.trim(), translated: translatedText.trim(), speaker, confidence: lastConfidenceRef.current, detectedLang: lastDetectedLangRef.current, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code },
      ]);
      maybeRequestReview();
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
    lastConfidenceRef.current = undefined;
    lastDetectedLangRef.current = undefined;
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

  // Auto-scroll history (respects settings toggle)
  useEffect(() => {
    if (settings.autoScroll && (history.length > 0 || liveText)) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [history, liveText, translatedText, settings.autoScroll]);

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
    Alert.alert(
      "Clear History",
      `Delete all ${history.length} translation${history.length === 1 ? "" : "s"}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => {
            if (settings.hapticsEnabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setHistory([]);
            AsyncStorage.removeItem(HISTORY_KEY);
          },
        },
      ]
    );
  };

  const deleteHistoryItem = useCallback((index: number) => {
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setHistory((prev) => {
      const removed = prev[index];
      if (removed) {
        // Clear any existing undo timeout
        if (undoTimeout.current) clearTimeout(undoTimeout.current);
        setDeletedItem({ item: removed, index });
        undoTimeout.current = setTimeout(() => {
          setDeletedItem(null);
        }, 4000);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, [settings.hapticsEnabled]);

  const undoDelete = useCallback(() => {
    if (!deletedItem) return;
    if (undoTimeout.current) clearTimeout(undoTimeout.current);
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setHistory((prev) => {
      const updated = [...prev];
      // Re-insert at original position, clamped to current length
      const insertAt = Math.min(deletedItem.index, updated.length);
      updated.splice(insertAt, 0, deletedItem.item);
      return updated;
    });
    setDeletedItem(null);
  }, [deletedItem, settings.hapticsEnabled]);

  const toggleFavorite = useCallback((index: number) => {
    if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHistory((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, favorited: !item.favorited } : item
      )
    );
  }, [settings.hapticsEnabled]);

  const retryTranslation = useCallback(async (index: number) => {
    const item = history[index];
    if (!item?.error || !item.sourceLangCode || !item.targetLangCode) return;

    // Mark as retrying (remove error, show pending)
    setHistory((prev) =>
      prev.map((h, i) =>
        i === index ? { ...h, error: false, pending: true, translated: "Retrying..." } : h
      )
    );

    const controller = new AbortController();
    try {
      const result = await translateText(item.original, item.sourceLangCode, item.targetLangCode, { signal: controller.signal, provider: settings.translationProvider, apiKey: settings.apiKey });
      setHistory((prev) =>
        prev.map((h, i) =>
          i === index ? { ...h, translated: result.translatedText, pending: false, error: false, sourceLangCode: undefined, targetLangCode: undefined } : h
        )
      );
      if (settings.hapticsEnabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Translation failed";
      setHistory((prev) =>
        prev.map((h, i) =>
          i === index ? { ...h, translated: msg, pending: false, error: true } : h
        )
      );
      showError(msg);
    }
  }, [history, settings.hapticsEnabled, showError]);

  const shareHistory = useCallback(async (format: "text" | "csv" | "json" = "text") => {
    const exportable = history.filter((item) => !item.error && !item.pending);
    if (exportable.length === 0) return;

    let message: string;
    if (format === "csv") {
      const header = "Original,Translated,Favorited";
      const rows = exportable.map(
        (item) => `"${item.original.replace(/"/g, '""')}","${item.translated.replace(/"/g, '""')}",${item.favorited ? "yes" : "no"}`
      );
      message = [header, ...rows].join("\n");
    } else if (format === "json") {
      message = JSON.stringify(
        exportable.map((item) => ({
          original: item.original,
          translated: item.translated,
          favorited: !!item.favorited,
        })),
        null,
        2
      );
    } else {
      const lines = exportable.map(
        (item, i) => `${i + 1}. ${item.original}\n   → ${item.translated}`
      );
      message = `Live Translator - ${exportable.length} translation(s)\n\n${lines.join("\n\n")}`;
    }
    try {
      await Share.share({ message });
    } catch {}
  }, [history]);

  const showExportPicker = useCallback(() => {
    const exportable = history.filter((item) => !item.error && !item.pending);
    if (exportable.length === 0) return;
    Alert.alert("Export Format", "Choose a format for your translations", [
      { text: "Text", onPress: () => shareHistory("text") },
      { text: "CSV", onPress: () => shareHistory("csv") },
      { text: "JSON", onPress: () => shareHistory("json") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [history, shareHistory]);

  const toggleSelectItem = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIndices(new Set());
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedIndices.size === 0) return;
    Alert.alert(
      "Delete Selected",
      `Delete ${selectedIndices.size} translation${selectedIndices.size === 1 ? "" : "s"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            if (settings.hapticsEnabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setHistory((prev) => prev.filter((_, i) => !selectedIndices.has(i)));
            exitSelectMode();
          },
        },
      ]
    );
  }, [selectedIndices, settings.hapticsEnabled, exitSelectMode]);

  const exportSelected = useCallback(() => {
    if (selectedIndices.size === 0) return;
    const items = history.filter((_, i) => selectedIndices.has(i));
    const lines = items.map(
      (item, i) => `${i + 1}. ${item.original}\n   → ${item.translated}`
    );
    const text = `Live Translator - ${items.length} translation(s)\n\n${lines.join("\n\n")}`;
    Share.share({ message: text }).catch(() => {});
  }, [selectedIndices, history]);

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

  const addToOfflineQueue = useCallback((text: string, fromCode: string, toCode: string) => {
    const item = { text, sourceLang: fromCode, targetLang: toCode, timestamp: Date.now() };
    setOfflineQueue((prev) => {
      const updated = [...prev, item];
      AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updated));
      return updated;
    });
    setHistory((prev) => [...prev, { original: text, translated: "Queued — will translate when online", pending: true, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code }]);
    if (settings.hapticsEnabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [settings.hapticsEnabled]);

  const processOfflineQueue = useCallback(async () => {
    if (isProcessingQueue.current) return;

    // Read latest queue from state via ref-like pattern
    let queue: typeof offlineQueue = [];
    setOfflineQueue((prev) => { queue = prev; return prev; });

    if (queue.length === 0) return;
    isProcessingQueue.current = true;

    const remaining = [...queue];
    let processed = 0;

    for (const item of queue) {
      try {
        const result = await translateText(item.text, item.sourceLang, item.targetLang, { provider: settings.translationProvider, apiKey: settings.apiKey });
        // Replace the pending history entry with the real translation
        setHistory((prev) => {
          const pendingIdx = prev.findIndex(
            (h) => h.pending && h.original === item.text
          );
          if (pendingIdx !== -1) {
            const updated = [...prev];
            updated[pendingIdx] = { original: item.text, translated: result.translatedText };
            return updated;
          }
          return [...prev, { original: item.text, translated: result.translatedText }];
        });
        remaining.splice(remaining.indexOf(item), 1);
        processed++;
      } catch {
        // Leave remaining items in queue for next attempt
        break;
      }
    }

    setOfflineQueue(remaining);
    AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    isProcessingQueue.current = false;

    if (processed > 0 && settings.hapticsEnabled) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [offlineQueue, settings.hapticsEnabled]);

  // Process offline queue when connectivity returns
  useEffect(() => {
    if (netInfo.isConnected && offlineQueue.length > 0) {
      processOfflineQueue();
    }
  }, [netInfo.isConnected, offlineQueue.length, processOfflineQueue]);

  const submitTypedText = useCallback(async () => {
    const text = typedText.trim();
    if (!text) return;
    Keyboard.dismiss();
    setTypedText("");

    // Queue if offline
    if (isOffline) {
      addToOfflineQueue(text, sourceLang.code, targetLang.code);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsTranslating(true);
    setLiveText(text);
    try {
      const glossaryMatch = glossaryLookup(text, sourceLang.code, targetLang.code);
      const result = glossaryMatch
        ? { translatedText: glossaryMatch, confidence: 1.0 }
        : await translateText(text, sourceLang.code, targetLang.code, { signal: controller.signal, provider: settings.translationProvider, apiKey: settings.apiKey });
      if (!controller.signal.aborted) {
        setHistory((prev) => [...prev, { original: text, translated: result.translatedText, confidence: result.confidence, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code, detectedLang: (result as any).detectedLanguage }]);
        maybeRequestReview();
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : "Translation failed";
        showError(msg);
        // Save failed translation to history with retry capability
        setHistory((prev) => [...prev, {
          original: text,
          translated: msg,
          error: true,
          sourceLangCode: sourceLang.code,
          targetLangCode: targetLang.code,
        }]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsTranslating(false);
        setLiveText("");
      }
    }
  }, [typedText, sourceLang.code, targetLang.code, showError, isOffline, addToOfflineQueue]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.safeBg }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={[styles.container, isLandscape && styles.containerLandscape]}>
        {/* Header */}
        <View style={[styles.headerRow, isLandscape && styles.headerRowLandscape]}>
          <View style={styles.headerLeftButtons}>
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => setShowSettings(true)}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <Text style={[styles.settingsIcon, { color: colors.mutedText }]}>⚙</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => setShowPhrasebook(true)}
              accessibilityRole="button"
              accessibilityLabel="Open phrasebook"
            >
              <Text style={[styles.settingsIcon, { color: colors.mutedText }]}>📖</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => setShowStats(true)}
              accessibilityRole="button"
              accessibilityLabel="View translation statistics"
            >
              <Text style={[styles.settingsIcon, { color: colors.mutedText }]}>📊</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => setShowGlossary(true)}
              accessibilityRole="button"
              accessibilityLabel="Open glossary"
            >
              <Text style={[styles.settingsIcon, { color: colors.mutedText }]}>📝</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.title, isLandscape && styles.titleLandscape, { color: colors.titleText }]}>Live Translator</Text>
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

        {/* Translation comparison modal */}
        <Modal visible={!!compareData} animationType="slide" transparent>
          <View style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
            <View style={[styles.compareContent, { backgroundColor: colors.modalBg }]}>
              <Text style={[styles.compareTitle, { color: colors.titleText }]}>Compare Translations</Text>
              {compareData && (
                <>
                  <View style={[styles.compareOriginal, { backgroundColor: colors.bubbleBg, borderColor: colors.border }]}>
                    <Text style={[styles.compareLabel, { color: colors.dimText }]}>ORIGINAL</Text>
                    <Text style={[{ color: colors.primaryText, fontSize: 15 }]}>{compareData.original}</Text>
                  </View>
                  {compareData.results.map((r) => (
                    <View key={r.provider} style={[styles.compareResult, { backgroundColor: colors.translatedBubbleBg, borderColor: colors.border }]}>
                      <Text style={[styles.compareLabel, { color: colors.primary }]}>{r.provider.toUpperCase()}</Text>
                      {r.loading ? (
                        <Text style={[{ color: colors.dimText, fontStyle: "italic", fontSize: 15 }]}>Loading...</Text>
                      ) : (
                        <TouchableOpacity onPress={() => copyToClipboard(r.text)}>
                          <Text style={[{ color: colors.translatedText, fontSize: 15 }]}>{r.text}</Text>
                          {copiedText === r.text && <Text style={styles.copiedBadge}>Copied!</Text>}
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </>
              )}
              <TouchableOpacity
                style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
                onPress={() => setCompareData(null)}
                accessibilityRole="button"
                accessibilityLabel="Close comparison"
              >
                <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Phrasebook modal */}
        <Modal visible={showPhrasebook} animationType="slide" transparent>
          <View style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
            <View style={[styles.phrasebookContent, { backgroundColor: colors.modalBg }]}>
              <Text style={[styles.compareTitle, { color: colors.titleText }]}>Phrasebook</Text>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={PHRASE_CATEGORIES}
                keyExtractor={(item) => item.key}
                style={styles.phraseCategoryRow}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.phraseCategoryPill, { backgroundColor: phraseCategory === item.key ? colors.primary : colors.cardBg, borderColor: phraseCategory === item.key ? colors.primary : colors.border }]}
                    onPress={() => setPhraseCategory(item.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label} phrases`}
                    accessibilityState={{ selected: phraseCategory === item.key }}
                  >
                    <Text style={styles.phraseCategoryIcon}>{item.icon}</Text>
                    <Text style={[styles.phraseCategoryText, { color: phraseCategory === item.key ? "#ffffff" : colors.mutedText }]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              <FlatList
                data={getPhrasesForCategory(phraseCategory)}
                keyExtractor={(_, i) => `phrase-${phraseCategory}-${i}`}
                style={styles.phraseList}
                renderItem={({ item: phrase }) => {
                  const srcCode = sourceLang.code === "autodetect" ? "en" : sourceLang.code;
                  const srcText = (phrase as any)[srcCode] || phrase.en;
                  const tgtText = (phrase as any)[targetLang.code] || "";
                  return (
                    <TouchableOpacity
                      style={[styles.phraseItem, { backgroundColor: colors.bubbleBg, borderColor: colors.border }]}
                      onPress={() => {
                        if (tgtText) {
                          copyToClipboard(tgtText);
                          if (settings.hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }
                      }}
                      onLongPress={() => {
                        if (tgtText) {
                          speakText(tgtText, targetLang.speechCode);
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${srcText} translates to ${tgtText}. Tap to copy, long press to speak.`}
                    >
                      <Text style={[styles.phraseSrcText, { color: colors.secondaryText }]}>{srcText}</Text>
                      {tgtText ? (
                        <Text style={[styles.phraseTgtText, { color: colors.translatedText }]}>{tgtText}</Text>
                      ) : (
                        <Text style={[styles.phraseTgtText, { color: colors.dimText, fontStyle: "italic" }]}>Not available</Text>
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
              <TouchableOpacity
                style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
                onPress={() => setShowPhrasebook(false)}
                accessibilityRole="button"
                accessibilityLabel="Close phrasebook"
              >
                <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" as const }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Statistics modal */}
        <Modal visible={showStats} animationType="slide" transparent>
          <View style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
            <View style={[styles.statsContent, { backgroundColor: colors.modalBg }]}>
              <Text style={[styles.compareTitle, { color: colors.titleText }]}>Translation Statistics</Text>
              {(() => {
                const validHistory = history.filter((h) => !h.pending && !h.error);
                const totalTranslations = validHistory.length;
                const totalFavorites = validHistory.filter((h) => h.favorited).length;
                const totalSourceWords = validHistory.reduce(
                  (sum, h) => sum + h.original.trim().split(/\s+/).filter(Boolean).length, 0
                );
                const totalTranslatedWords = validHistory.reduce(
                  (sum, h) => sum + h.translated.trim().split(/\s+/).filter(Boolean).length, 0
                );
                const confidenceItems = validHistory.filter((h) => h.confidence != null);
                const avgConfidence = confidenceItems.length > 0
                  ? confidenceItems.reduce((sum, h) => sum + (h.confidence ?? 0), 0) / confidenceItems.length
                  : null;

                // Most used language pairs
                const pairCounts: Record<string, number> = {};
                for (const h of validHistory) {
                  if (h.sourceLangCode && h.targetLangCode) {
                    const key = `${h.sourceLangCode}→${h.targetLangCode}`;
                    pairCounts[key] = (pairCounts[key] || 0) + 1;
                  }
                }
                const topPairs = Object.entries(pairCounts)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([pair, count]) => {
                    const [src, tgt] = pair.split("→");
                    const srcName = LANGUAGES.find((l) => l.code === src)?.name || src;
                    const tgtName = LANGUAGES.find((l) => l.code === tgt)?.name || tgt;
                    return { label: `${srcName} → ${tgtName}`, count };
                  });

                // Most used target languages
                const targetCounts: Record<string, number> = {};
                for (const h of validHistory) {
                  if (h.targetLangCode) {
                    targetCounts[h.targetLangCode] = (targetCounts[h.targetLangCode] || 0) + 1;
                  }
                }
                const topTargets = Object.entries(targetCounts)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([code, count]) => ({
                    label: LANGUAGES.find((l) => l.code === code)?.name || code,
                    count,
                  }));

                return (
                  <FlatList
                    data={[{ key: "stats" }]}
                    renderItem={() => (
                      <View>
                        {/* Summary cards */}
                        <View style={styles.statsGrid}>
                          <View style={[styles.statCard, { backgroundColor: colors.cardBg }]}>
                            <Text style={[styles.statNumber, { color: colors.primary }]}>{totalTranslations}</Text>
                            <Text style={[styles.statLabel, { color: colors.mutedText }]}>Translations</Text>
                          </View>
                          <View style={[styles.statCard, { backgroundColor: colors.cardBg }]}>
                            <Text style={[styles.statNumber, { color: colors.primary }]}>{totalFavorites}</Text>
                            <Text style={[styles.statLabel, { color: colors.mutedText }]}>Favorites</Text>
                          </View>
                          <View style={[styles.statCard, { backgroundColor: colors.cardBg }]}>
                            <Text style={[styles.statNumber, { color: colors.primary }]}>{totalSourceWords}</Text>
                            <Text style={[styles.statLabel, { color: colors.mutedText }]}>Words In</Text>
                          </View>
                          <View style={[styles.statCard, { backgroundColor: colors.cardBg }]}>
                            <Text style={[styles.statNumber, { color: colors.primary }]}>{totalTranslatedWords}</Text>
                            <Text style={[styles.statLabel, { color: colors.mutedText }]}>Words Out</Text>
                          </View>
                        </View>

                        {avgConfidence != null && (
                          <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
                            <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Avg. Confidence</Text>
                            <View style={styles.confidenceBarOuter}>
                              <View style={[styles.confidenceBarInner, { width: `${Math.round(avgConfidence * 100)}%`, backgroundColor: colors.primary }]} />
                            </View>
                            <Text style={[styles.confidencePercent, { color: colors.primary }]}>{Math.round(avgConfidence * 100)}%</Text>
                          </View>
                        )}

                        {topPairs.length > 0 && (
                          <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
                            <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Top Language Pairs</Text>
                            {topPairs.map((p, i) => (
                              <View key={i} style={styles.statsRow}>
                                <Text style={[styles.statsRowLabel, { color: colors.primaryText }]}>{p.label}</Text>
                                <View style={[styles.statsCountBadge, { backgroundColor: colors.primary + "22" }]}>
                                  <Text style={[styles.statsCountText, { color: colors.primary }]}>{p.count}</Text>
                                </View>
                              </View>
                            ))}
                          </View>
                        )}

                        {topTargets.length > 0 && (
                          <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
                            <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Most Translated To</Text>
                            {topTargets.map((t, i) => (
                              <View key={i} style={styles.statsRow}>
                                <Text style={[styles.statsRowLabel, { color: colors.primaryText }]}>{t.label}</Text>
                                <View style={[styles.statsCountBadge, { backgroundColor: colors.primary + "22" }]}>
                                  <Text style={[styles.statsCountText, { color: colors.primary }]}>{t.count}</Text>
                                </View>
                              </View>
                            ))}
                          </View>
                        )}

                        {totalTranslations === 0 && (
                          <View style={styles.statsEmptyState}>
                            <Text style={[{ color: colors.mutedText, fontSize: 40, marginBottom: 12 }]}>📭</Text>
                            <Text style={[{ color: colors.mutedText, fontSize: 15, textAlign: "center" as const }]}>
                              No translations yet.{"\n"}Start translating to see your stats!
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                    keyExtractor={(item) => item.key}
                  />
                );
              })()}
              <TouchableOpacity
                style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
                onPress={() => setShowStats(false)}
                accessibilityRole="button"
                accessibilityLabel="Close statistics"
              >
                <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" as const }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Correction prompt modal */}
        <Modal visible={correctionPrompt !== null} animationType="fade" transparent>
          <View style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
            <View style={[styles.compareContent, { backgroundColor: colors.modalBg, maxHeight: "50%" }]}>
              <Text style={[styles.compareTitle, { color: colors.titleText }]}>Suggest Correction</Text>
              <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
                <Text style={[{ color: colors.dimText, fontSize: 13, marginBottom: 12 }]}>
                  Original: "{correctionPrompt?.original}"
                </Text>
                <Text style={[{ color: colors.dimText, fontSize: 13, marginBottom: 12 }]}>
                  Current: "{correctionPrompt?.translated}"
                </Text>
                <TextInput
                  style={[styles.glossaryInput, { backgroundColor: colors.cardBg, color: colors.primaryText, borderColor: colors.border }]}
                  placeholder="Enter better translation..."
                  placeholderTextColor={colors.placeholderText}
                  value={correctionText}
                  onChangeText={setCorrectionText}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Correction input"
                />
                <TouchableOpacity
                  style={[styles.glossaryAddButton, { backgroundColor: correctionText.trim() ? colors.primary : colors.border }]}
                  onPress={submitCorrection}
                  disabled={!correctionText.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Submit correction"
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Save & Add to Glossary</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
                onPress={() => { setCorrectionPrompt(null); setCorrectionText(""); }}
                accessibilityRole="button"
                accessibilityLabel="Cancel correction"
              >
                <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" as const }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Glossary modal */}
        <Modal visible={showGlossary} animationType="slide" transparent>
          <View style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
            <View style={[styles.compareContent, { backgroundColor: colors.modalBg }]}>
              <Text style={[styles.compareTitle, { color: colors.titleText }]}>My Glossary</Text>
              <Text style={[{ color: colors.dimText, fontSize: 13, textAlign: "center" as const, marginBottom: 12, paddingHorizontal: 20 }]}>
                Custom translations override API results. Entries apply to the current language pair ({sourceLang.name} → {targetLang.name}).
              </Text>

              <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                <TextInput
                  style={[styles.apiKeyInput, { backgroundColor: colors.cardBg, color: colors.primaryText, borderColor: colors.border, marginBottom: 8 }]}
                  placeholder={`Source phrase (${sourceLang.name})`}
                  placeholderTextColor={colors.placeholderText}
                  value={glossarySource}
                  onChangeText={setGlossarySource}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Glossary source phrase"
                />
                <TextInput
                  style={[styles.apiKeyInput, { backgroundColor: colors.cardBg, color: colors.primaryText, borderColor: colors.border, marginBottom: 8 }]}
                  placeholder={`Translation (${targetLang.name})`}
                  placeholderTextColor={colors.placeholderText}
                  value={glossaryTarget}
                  onChangeText={setGlossaryTarget}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Glossary target translation"
                />
                <TouchableOpacity
                  style={[styles.glossaryAddButton, { backgroundColor: glossarySource.trim() && glossaryTarget.trim() ? colors.primary : colors.border }]}
                  onPress={addGlossaryEntry}
                  disabled={!glossarySource.trim() || !glossaryTarget.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Add glossary entry"
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Add Entry</Text>
                </TouchableOpacity>
              </View>

              <FlatList
                data={glossary.filter((g) => g.sourceLang === sourceLang.code && g.targetLang === targetLang.code)}
                keyExtractor={(_, i) => String(i)}
                style={{ maxHeight: 250, paddingHorizontal: 16 }}
                ListEmptyComponent={
                  <Text style={[{ color: colors.mutedText, fontSize: 14, textAlign: "center" as const, paddingVertical: 20 }]}>
                    No entries for this language pair yet.
                  </Text>
                }
                renderItem={({ item }) => {
                  const realIndex = glossary.findIndex((g) => g === item);
                  return (
                    <View style={[styles.glossaryEntry, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[{ color: colors.secondaryText, fontSize: 14 }]}>{item.source}</Text>
                        <Text style={[{ color: colors.translatedText, fontSize: 14, fontWeight: "600" }]}>{item.target}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => removeGlossaryEntry(realIndex)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove glossary entry: ${item.source}`}
                      >
                        <Text style={{ color: colors.errorText, fontSize: 18 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />

              {glossary.length > 0 && (
                <Text style={[{ color: colors.dimText, fontSize: 12, textAlign: "center" as const, marginTop: 8 }]}>
                  {glossary.length} total {glossary.length === 1 ? "entry" : "entries"} across all language pairs
                </Text>
              )}

              <TouchableOpacity
                style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
                onPress={() => setShowGlossary(false)}
                accessibilityRole="button"
                accessibilityLabel="Close glossary"
              >
                <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" as const }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Onboarding tutorial modal */}
        <Modal visible={showOnboarding} animationType="fade" transparent>
          <View style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
            <View style={[styles.onboardingContent, { backgroundColor: colors.modalBg }]}>
              {(() => {
                const steps = [
                  { icon: "🎙️", title: "Voice Translation", desc: "Tap the mic button and speak naturally. Your words are translated in real time as you talk." },
                  { icon: "💬", title: "Conversation Mode", desc: "Toggle Chat mode for face-to-face conversations. Two mic buttons let each person speak in their language." },
                  { icon: "📖", title: "Phrasebook", desc: "Browse common phrases by category for instant offline translations. Tap to copy, long-press to hear." },
                  { icon: "⌨️", title: "Type to Translate", desc: "Prefer typing? Use the text input at the bottom to translate written text, with multi-line support." },
                  { icon: "⭐", title: "Favorites & History", desc: "Star translations to bookmark them. Swipe left to delete. Search your full history anytime." },
                  { icon: "⚙️", title: "Customize Everything", desc: "Adjust font size, speech speed, theme, haptics, and even switch translation providers in Settings." },
                ];
                const step = steps[onboardingStep];
                const isLast = onboardingStep === steps.length - 1;
                return (
                  <>
                    <View style={styles.onboardingDots}>
                      {steps.map((_, i) => (
                        <View
                          key={i}
                          style={[
                            styles.onboardingDot,
                            { backgroundColor: i === onboardingStep ? colors.primary : colors.border },
                          ]}
                        />
                      ))}
                    </View>
                    <Text style={styles.onboardingIcon}>{step.icon}</Text>
                    <Text style={[styles.onboardingTitle, { color: colors.titleText }]}>{step.title}</Text>
                    <Text style={[styles.onboardingDesc, { color: colors.secondaryText }]}>{step.desc}</Text>
                    <View style={styles.onboardingButtons}>
                      <TouchableOpacity
                        style={styles.onboardingSkip}
                        onPress={() => {
                          setShowOnboarding(false);
                          AsyncStorage.setItem(ONBOARDING_KEY, "true");
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Skip tutorial"
                      >
                        <Text style={[styles.onboardingSkipText, { color: colors.dimText }]}>Skip</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.onboardingNext, { backgroundColor: colors.primary }]}
                        onPress={() => {
                          if (isLast) {
                            setShowOnboarding(false);
                            AsyncStorage.setItem(ONBOARDING_KEY, "true");
                            if (settings.hapticsEnabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          } else {
                            setOnboardingStep((s) => s + 1);
                          }
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={isLast ? "Get started" : "Next tip"}
                      >
                        <Text style={styles.onboardingNextText}>{isLast ? "Get Started" : "Next"}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                );
              })()}
            </View>
          </View>
        </Modal>

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
          <View style={styles.langMiddleButtons}>
            <TouchableOpacity
              style={[styles.swapButton, { backgroundColor: colors.cardBg }]}
              onPress={swapLanguages}
              accessibilityRole="button"
              accessibilityLabel={`Swap languages. Currently translating from ${sourceLang.name} to ${targetLang.name}`}
            >
              <Text style={[styles.swapIcon, { color: colors.primary }]}>⇄</Text>
            </TouchableOpacity>
            {sourceLang.code !== "autodetect" && (
              <TouchableOpacity
                style={[styles.savePairButton, { backgroundColor: colors.cardBg }]}
                onPress={toggleSavePair}
                accessibilityRole="button"
                accessibilityLabel={isCurrentPairSaved ? "Remove saved language pair" : "Save this language pair"}
              >
                <Text style={[styles.savePairIcon, isCurrentPairSaved && styles.savePairIconActive]}>
                  {isCurrentPairSaved ? "★" : "☆"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <LanguagePicker
            label="To"
            selected={targetLang}
            onSelect={(lang) => { setTargetLang(lang); trackRecentLang(lang.code); }}
            recentCodes={recentLangCodes}
            colors={colors}
          />
        </View>

        {/* Saved language pair shortcuts */}
        {savedPairs.length > 0 && (
          <View style={styles.savedPairsRow}>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={savedPairs}
              keyExtractor={(item) => `${item.sourceCode}-${item.targetCode}`}
              renderItem={({ item }) => {
                const isActive = item.sourceCode === sourceLang.code && item.targetCode === targetLang.code;
                const srcName = LANGUAGES.find((l) => l.code === item.sourceCode)?.name || item.sourceCode;
                const tgtName = LANGUAGES.find((l) => l.code === item.targetCode)?.name || item.targetCode;
                return (
                  <TouchableOpacity
                    style={[styles.savedPairPill, { backgroundColor: colors.cardBg, borderColor: isActive ? colors.primary : colors.border }, isActive && styles.savedPairPillActive]}
                    onPress={() => applyPair(item.sourceCode, item.targetCode)}
                    onLongPress={() => removeSavedPair(item.sourceCode, item.targetCode)}
                    accessibilityRole="button"
                    accessibilityLabel={`Switch to ${srcName} to ${tgtName}. Long press to remove.`}
                  >
                    <Text style={[styles.savedPairText, { color: isActive ? colors.primary : colors.mutedText }]}>
                      {srcName.slice(0, 3)} → {tgtName.slice(0, 3)}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}

        {/* Offline banner */}
        {isOffline && (
          <View
            style={[styles.offlineBanner, { backgroundColor: colors.offlineBg, borderColor: colors.offlineBorder }]}
            accessibilityRole="alert"
            accessibilityLabel="No internet connection. Translations require network access."
          >
            <Text style={[styles.offlineIcon]}>⚡</Text>
            <Text style={[styles.offlineText, { color: colors.offlineText }]}>
              No connection{offlineQueue.length > 0 ? ` — ${offlineQueue.length} queued` : " — type to queue translations"}
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
            if (selectMode) {
              const isSelected = selectedIndices.has(realIndex);
              return (
                <TouchableOpacity
                  onPress={() => toggleSelectItem(realIndex)}
                  activeOpacity={0.7}
                  style={styles.selectRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={`Select translation: ${item.original}`}
                >
                  <View style={[styles.selectCheckbox, { borderColor: colors.border }, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                    {isSelected && <Text style={styles.selectCheckmark}>✓</Text>}
                  </View>
                  <View style={styles.selectContent}>
                    <Text style={[{ color: colors.secondaryText, fontSize: 14 }]} numberOfLines={1}>{item.original}</Text>
                    <Text style={[{ color: colors.translatedText, fontSize: 14 }]} numberOfLines={1}>{item.translated}</Text>
                  </View>
                </TouchableOpacity>
              );
            }
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
                  {item.detectedLang && (() => {
                    const lang = LANGUAGES.find((l) => l.code === item.detectedLang);
                    return lang ? (
                      <Text style={[styles.detectedLangBadge, { color: colors.primary, backgroundColor: colors.primary + "18" }]}>
                        Detected: {lang.name}
                      </Text>
                    ) : null;
                  })()}
                  {settings.showRomanization && item.sourceLangCode && (() => {
                    const rom = romanize(item.original, item.sourceLangCode!);
                    return rom ? (
                      <Text style={[styles.romanizationText, { color: colors.mutedText }]}>
                        {getRomanizationName(item.sourceLangCode!)} · {rom}
                      </Text>
                    ) : null;
                  })()}
                  <TouchableOpacity onPress={() => copyToClipboard(item.translated)}>
                    <Text style={[styles.chatTranslated, { color: colors.translatedText }, dynamicFontSizes.chatText]}>{item.translated}</Text>
                  </TouchableOpacity>
                  {settings.showRomanization && item.targetLangCode && (() => {
                    const rom = romanize(item.translated, item.targetLangCode!);
                    return rom ? (
                      <Text style={[styles.romanizationText, { color: colors.mutedText }]}>
                        {getRomanizationName(item.targetLangCode!)} · {rom}
                      </Text>
                    ) : null;
                  })()}
                  {copiedText === item.original || copiedText === item.translated ? (
                    <Text style={styles.copiedBadge}>Copied!</Text>
                  ) : null}
                  <View style={styles.bubbleActions}>
                    <Text style={[styles.wordCountBubble, { color: colors.dimText }]}>
                      {item.original.trim().split(/\s+/).filter(Boolean).length} → {item.translated.trim().split(/\s+/).filter(Boolean).length} words
                      {item.confidence != null ? ` · ${Math.round(item.confidence * 100)}%` : ""}
                    </Text>
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
                  {item.detectedLang && (() => {
                    const lang = LANGUAGES.find((l) => l.code === item.detectedLang);
                    return lang ? (
                      <Text style={[styles.detectedLangBadge, { color: colors.primary, backgroundColor: colors.primary + "18" }]}>
                        Detected: {lang.name}
                      </Text>
                    ) : null;
                  })()}
                  {settings.showRomanization && item.sourceLangCode && (() => {
                    const rom = romanize(item.original, item.sourceLangCode!);
                    return rom ? (
                      <Text style={[styles.romanizationText, { color: colors.mutedText }]}>
                        {getRomanizationName(item.sourceLangCode!)} · {rom}
                      </Text>
                    ) : null;
                  })()}
                  {copiedText === item.original && (
                    <Text style={styles.copiedBadge}>Copied!</Text>
                  )}
                </TouchableOpacity>
                <View style={[styles.bubble, styles.translatedBubble, { backgroundColor: colors.translatedBubbleBg, borderLeftColor: item.error ? colors.errorBorder : item.pending ? colors.offlineText : colors.primary }]}>
                  <TouchableOpacity
                    onPress={() => !item.pending && !item.error && copyToClipboard(item.translated)}
                    accessibilityRole="button"
                    accessibilityLabel={item.error ? `Translation failed: ${item.translated}` : item.pending ? `Queued for translation when online` : `Translation: ${item.translated}. Tap to copy.`}
                    disabled={item.pending || item.error}
                  >
                    {item.pending && (
                      <Text style={[styles.pendingBadge, { color: colors.offlineText }]}>
                        Queued offline
                      </Text>
                    )}
                    {item.error && (
                      <Text style={[styles.pendingBadge, { color: colors.errorText }]}>
                        Failed
                      </Text>
                    )}
                    <Text style={[styles.translatedTextHistory, { color: item.error ? colors.errorText : item.pending ? colors.dimText : colors.translatedText }, dynamicFontSizes.translated, (item.pending || item.error) && { fontStyle: "italic" }]}>
                      {item.translated}
                    </Text>
                    {settings.showRomanization && !item.error && !item.pending && item.targetLangCode && (() => {
                      const rom = romanize(item.translated, item.targetLangCode!);
                      return rom ? (
                        <Text style={[styles.romanizationText, { color: colors.mutedText }]}>
                          {getRomanizationName(item.targetLangCode!)} · {rom}
                        </Text>
                      ) : null;
                    })()}
                    {copiedText === item.translated && (
                      <Text style={styles.copiedBadge}>Copied!</Text>
                    )}
                  </TouchableOpacity>
                  <View style={styles.bubbleActions}>
                    {!item.error && !item.pending && (
                      <Text style={[styles.wordCountBubble, { color: colors.dimText }]}>
                        {item.original.trim().split(/\s+/).filter(Boolean).length} → {item.translated.trim().split(/\s+/).filter(Boolean).length} words
                        {item.confidence != null ? ` · ${Math.round(item.confidence * 100)}%` : ""}
                      </Text>
                    )}
                    {item.error ? (
                      <TouchableOpacity
                        style={styles.retryButton}
                        onPress={() => retryTranslation(realIndex)}
                        accessibilityRole="button"
                        accessibilityLabel="Retry translation"
                      >
                        <Text style={styles.retryIcon}>↻</Text>
                        <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
                      </TouchableOpacity>
                    ) : (
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
                    )}
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
                    {!item.error && !item.pending && (
                      <TouchableOpacity
                        style={styles.speakButton}
                        onPress={() => compareTranslation(item.original, item.translated)}
                        accessibilityRole="button"
                        accessibilityLabel="Compare translations from different engines"
                      >
                        <Text style={[styles.compareIcon, { color: colors.dimText }]}>⇔</Text>
                      </TouchableOpacity>
                    )}
                    {!item.error && !item.pending && (
                      <TouchableOpacity
                        style={styles.speakButton}
                        onPress={() => {
                          setCorrectionPrompt({ index: realIndex, original: item.original, translated: item.translated });
                          setCorrectionText("");
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Suggest a better translation"
                      >
                        <Text style={[{ fontSize: 14, color: colors.dimText }]}>✏️</Text>
                      </TouchableOpacity>
                    )}
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
                  {settings.showRomanization && needsRomanization(sourceLang.code) && (() => {
                    const rom = romanize(liveText, sourceLang.code);
                    return rom ? (
                      <Text style={[styles.romanizationText, { color: colors.mutedText }]}>
                        {getRomanizationName(sourceLang.code)} · {rom}
                      </Text>
                    ) : null;
                  })()}
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
                      {settings.showRomanization && needsRomanization(targetLang.code) && (() => {
                        const rom = romanize(translatedText, targetLang.code);
                        return rom ? (
                          <Text style={[styles.romanizationText, styles.romanizationTextLive, { color: colors.mutedText }]}>
                            {getRomanizationName(targetLang.code)} · {rom}
                          </Text>
                        ) : null;
                      })()}
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
                {(() => {
                  const potd = getPhraseOfTheDay(targetLang.code);
                  if (!potd) return null;
                  const categoryInfo = PHRASE_CATEGORIES.find((c) => c.key === potd.category);
                  return (
                    <View style={[styles.phraseOfDay, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
                      <Text style={[styles.phraseOfDayLabel, { color: colors.dimText }]}>
                        {categoryInfo?.icon || "💬"} Phrase of the Day
                      </Text>
                      <Text style={[styles.phraseOfDayText, { color: colors.titleText }]}>
                        {potd.phrase.en}
                      </Text>
                      <Text style={[styles.phraseOfDayTranslation, { color: colors.primaryText }]}>
                        {potd.phrase[targetLang.code as keyof OfflinePhrase] || potd.phrase.es}
                      </Text>
                    </View>
                  );
                })()}
              </View>
            ) : null
          }
        />

        {/* Undo delete toast */}
        {deletedItem && (
          <View style={[styles.undoToast, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <Text style={[styles.undoToastText, { color: colors.secondaryText }]} numberOfLines={1}>
              Translation deleted
            </Text>
            <TouchableOpacity
              style={styles.undoButton}
              onPress={undoDelete}
              accessibilityRole="button"
              accessibilityLabel="Undo delete"
            >
              <Text style={[styles.undoButtonText, { color: colors.primary }]}>Undo</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom controls */}
        <View style={[styles.controls, isLandscape && styles.controlsLandscape]}>
          {history.length > 0 && !isListening && (
            <View style={styles.historyActions}>
              {selectMode ? (
                <>
                  <TouchableOpacity
                    style={styles.clearButton}
                    onPress={exitSelectMode}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel selection"
                  >
                    <Text style={[styles.clearText, { color: colors.dimText }]}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={[styles.selectCountText, { color: colors.mutedText }]}>
                    {selectedIndices.size} selected
                  </Text>
                  <TouchableOpacity
                    style={styles.clearButton}
                    onPress={exportSelected}
                    accessibilityRole="button"
                    accessibilityLabel="Share selected translations"
                    disabled={selectedIndices.size === 0}
                  >
                    <Text style={[styles.shareText, { color: selectedIndices.size > 0 ? colors.primary : colors.dimText }]}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.clearButton}
                    onPress={deleteSelected}
                    accessibilityRole="button"
                    accessibilityLabel="Delete selected translations"
                    disabled={selectedIndices.size === 0}
                  >
                    <Text style={[styles.clearText, { color: selectedIndices.size > 0 ? colors.errorText : colors.dimText }]}>Delete</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
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
                    onPress={() => setSelectMode(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Select multiple translations"
                  >
                    <Text style={[styles.shareText, { color: colors.mutedText }]}>Select</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.clearButton}
                    onPress={showExportPicker}
                    accessibilityRole="button"
                    accessibilityLabel="Share translation history"
                  >
                    <Text style={[styles.shareText, { color: colors.primary }]}>Share</Text>
                  </TouchableOpacity>
                </>
              )}
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
              <View style={[styles.micButtonWrapper, isLandscape && styles.micButtonWrapperLandscape]}>
                {isListening && (
                  <Animated.View
                    style={[
                      styles.pulseRing,
                      isLandscape && styles.pulseRingLandscape,
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
                    isLandscape && styles.micButtonLandscape,
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
            <View>
              <View style={styles.textInputRow}>
                <TextInput
                  style={[styles.textInput, { backgroundColor: colors.bubbleBg, color: colors.primaryText, borderColor: colors.border, maxHeight: 120 }]}
                  placeholder="Or type to translate..."
                  placeholderTextColor={colors.placeholderText}
                  value={typedText}
                  onChangeText={setTypedText}
                  onSubmitEditing={submitTypedText}
                  returnKeyType="send"
                  editable={!isTranslating}
                  accessibilityLabel="Type text to translate"
                  maxLength={500}
                  multiline
                  textAlignVertical="top"
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
              {typedText.length > 0 && (
                <View style={styles.charCountRow}>
                  <Text style={[styles.charCountText, { color: typedText.length >= 450 ? colors.errorText : colors.dimText }]}>
                    {typedText.length}/500
                  </Text>
                  <Text style={[styles.wordCountText, { color: colors.dimText }]}>
                    {typedText.trim().split(/\s+/).filter(Boolean).length} {typedText.trim().split(/\s+/).filter(Boolean).length === 1 ? "word" : "words"}
                  </Text>
                </View>
              )}
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
  headerLeftButtons: {
    position: "absolute" as const,
    left: 0,
    flexDirection: "row" as const,
    gap: 4,
  },
  headerIconButton: {
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
  langMiddleButtons: {
    alignItems: "center",
    gap: 4,
    marginBottom: 0,
  },
  swapButton: {
    borderRadius: 12,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  swapIcon: {
    fontSize: 20,
    fontWeight: "700",
  },
  savePairButton: {
    borderRadius: 10,
    width: 32,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  savePairIcon: {
    fontSize: 16,
    color: "#8888aa",
  },
  savePairIconActive: {
    color: "#ffd700",
  },
  savedPairsRow: {
    marginBottom: 12,
    marginTop: -8,
  },
  savedPairPill: {
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
    borderWidth: 1,
  },
  savedPairPillActive: {
    borderWidth: 1.5,
  },
  savedPairText: {
    fontSize: 12,
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
  romanizationText: {
    fontSize: 13,
    fontStyle: "italic" as const,
    marginTop: 4,
    lineHeight: 18,
  },
  romanizationTextLive: {
    fontSize: 15,
    lineHeight: 22,
  },
  originalText: {
    fontSize: 16,
    lineHeight: 22,
  },
  detectedLangBadge: {
    fontSize: 11,
    fontWeight: "600" as const,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: "flex-start" as const,
    marginTop: 4,
    overflow: "hidden" as const,
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
  phraseOfDay: {
    marginTop: 24,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    width: "80%",
  },
  phraseOfDayLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  phraseOfDayText: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
    textAlign: "center",
  },
  phraseOfDayTranslation: {
    fontSize: 16,
    fontStyle: "italic",
    textAlign: "center",
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
    alignItems: "flex-end",
    marginTop: 12,
    gap: 8,
    width: "100%",
  },
  textInput: {
    flex: 1,
    borderRadius: 20,
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 16,
    fontSize: 15,
    borderWidth: 1,
    minHeight: 40,
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
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 4,
  },
  retryIcon: {
    fontSize: 18,
    color: "#6c63ff",
    fontWeight: "700",
  },
  retryText: {
    fontSize: 13,
    fontWeight: "700",
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
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 12,
  },
  selectCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  selectCheckmark: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  selectContent: {
    flex: 1,
    gap: 2,
  },
  selectCountText: {
    fontSize: 13,
    fontWeight: "600",
  },
  charCountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginTop: 4,
  },
  charCountText: {
    fontSize: 11,
    fontWeight: "600",
  },
  wordCountText: {
    fontSize: 11,
    fontWeight: "600",
  },
  wordCountBubble: {
    fontSize: 10,
    fontWeight: "500",
    marginRight: "auto",
  },
  pendingBadge: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  undoToast: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
  },
  undoToastText: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  undoButton: {
    marginLeft: 12,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  undoButtonText: {
    fontSize: 14,
    fontWeight: "700",
  },
  // Comparison modal
  compareOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  compareContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "70%",
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  compareTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },
  compareOriginal: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  compareResult: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
  },
  compareLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 6,
  },
  compareClose: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
    marginHorizontal: -20,
  },
  compareIcon: {
    fontSize: 16,
    fontWeight: "700",
  },
  // Phrasebook modal
  statsContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  statsGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    borderRadius: 14,
    padding: 14,
    alignItems: "center" as const,
    width: "47%" as any,
    flexGrow: 1,
  },
  statNumber: {
    fontSize: 28,
    fontWeight: "800" as const,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: "600" as const,
    marginTop: 4,
  },
  statsSection: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  statsSectionTitle: {
    fontSize: 13,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    paddingVertical: 6,
  },
  statsRowLabel: {
    fontSize: 14,
    flex: 1,
  },
  statsCountBadge: {
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  statsCountText: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  confidenceBarOuter: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(108,99,255,0.15)",
    overflow: "hidden" as const,
    marginBottom: 6,
  },
  confidenceBarInner: {
    height: 8,
    borderRadius: 4,
  },
  confidencePercent: {
    fontSize: 14,
    fontWeight: "700" as const,
    textAlign: "right" as const,
  },
  statsEmptyState: {
    alignItems: "center" as const,
    paddingVertical: 40,
  },
  phrasebookContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  phraseCategoryRow: {
    flexGrow: 0,
    marginBottom: 12,
  },
  phraseCategoryPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
    borderWidth: 1,
    gap: 6,
  },
  phraseCategoryIcon: {
    fontSize: 14,
  },
  phraseCategoryText: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  phraseList: {
    flex: 1,
  },
  phraseItem: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  phraseSrcText: {
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 4,
  },
  phraseTgtText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600" as const,
  },
  // Onboarding tutorial
  onboardingContent: {
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 28,
    marginHorizontal: 24,
    alignItems: "center" as const,
  },
  onboardingDots: {
    flexDirection: "row" as const,
    gap: 8,
    marginBottom: 24,
  },
  onboardingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  onboardingIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  onboardingTitle: {
    fontSize: 24,
    fontWeight: "700" as const,
    marginBottom: 12,
    textAlign: "center" as const,
  },
  onboardingDesc: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center" as const,
    paddingHorizontal: 8,
    marginBottom: 32,
  },
  onboardingButtons: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 16,
    width: "100%" as const,
  },
  onboardingSkip: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center" as const,
  },
  onboardingSkipText: {
    fontSize: 16,
    fontWeight: "500" as const,
  },
  onboardingNext: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center" as const,
  },
  onboardingNextText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700" as const,
  },
  // Landscape overrides
  containerLandscape: {
    paddingHorizontal: 40,
    paddingTop: 4,
  },
  headerRowLandscape: {
    marginBottom: 8,
  },
  titleLandscape: {
    fontSize: 20,
  },
  controlsLandscape: {
    paddingBottom: 4,
    paddingTop: 4,
  },
  micButtonWrapperLandscape: {
    width: 56,
    height: 56,
  },
  micButtonLandscape: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  pulseRingLandscape: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  apiKeyInput: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    borderWidth: 1,
  },
  glossaryAddButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  glossaryInput: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  glossaryEntry: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    gap: 10,
  },
});
