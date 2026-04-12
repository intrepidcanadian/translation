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
  KeyboardAvoidingView,
  Share,
  LayoutAnimation,
  UIManager,
  useWindowDimensions,
} from "react-native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import * as Clipboard from "expo-clipboard";
import * as Speech from "expo-speech";
import { impactLight, impactMedium, notifySuccess, notifyWarning } from "../services/haptics";
import LanguagePicker from "../components/LanguagePicker";
import ComparisonModal from "../components/ComparisonModal";
import WordAlternativesModal from "../components/WordAlternativesModal";
import CorrectionModal from "../components/CorrectionModal";
import AlignedRomanization from "../components/AlignedRomanization";
import SwipeableRow from "../components/SwipeableRow";
import TranslationBubble from "../components/TranslationBubble";
import ChatBubble from "../components/ChatBubble";
import SplitConversation from "../components/SplitConversation";
import ConversationPlayback from "../components/ConversationPlayback";
import {
  translateText,
  getWordAlternatives,
  LANGUAGES,
  type WordAlternative,
} from "../services/translation";
import { getColors } from "../theme";
import { PHRASE_CATEGORIES, getPhraseOfTheDay, type OfflinePhrase } from "../services/offlinePhrases";
import { needsRomanization } from "../services/romanization";
import { FONT_SIZE_SCALES, type TranslationProvider } from "../components/SettingsModal";
import { useSettings } from "../contexts/SettingsContext";
import { useLanguage } from "../contexts/LanguageContext";
import { useTranslationData } from "../contexts/TranslationDataContext";
import type { HistoryItem } from "../types";

export default function TranslateScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const { settings, reduceMotion, maybeRequestReview } = useSettings();
  const { sourceLang, targetLang, setSourceLang, setTargetLang, swapLanguages, recentLangCodes, trackRecentLang, savedPairs, isCurrentPairSaved, toggleSavePair, applyPair, removeSavedPair } = useLanguage();
  const { history, setHistory, hasMoreHistory, loadMoreHistory, glossaryLookup, isOffline, offlineQueue, addToOfflineQueue, updateStreak, updateWidgetData } = useTranslationData();

  const colors = useMemo(() => getColors(settings.theme), [settings.theme]);
  const fontScale = FONT_SIZE_SCALES[settings.fontSize];
  const dynamicFontSizes = useMemo(() => ({
    original: { fontSize: Math.round(16 * fontScale) },
    translated: { fontSize: Math.round(16 * fontScale) },
    liveOriginal: { fontSize: Math.round(18 * fontScale) },
    liveTranslated: { fontSize: Math.round(20 * fontScale) },
    chatText: { fontSize: Math.round(15 * fontScale) },
  }), [fontScale]);

  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [conversationMode, setConversationMode] = useState(false);
  const activeSpeakerRef = useRef<"A" | "B">("A");

  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showSplitScreen, setShowSplitScreen] = useState(false);
  const [showPlayback, setShowPlayback] = useState(false);
  const listRef = useRef<FlatList>(null);
  const translationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const errorDismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranslatedRef = useRef("");
  const finalTextRef = useRef("");
  const lastConfidenceRef = useRef<number | undefined>(undefined);
  const lastDetectedLangRef = useRef<string | undefined>(undefined);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);

  const [compareData, setCompareData] = useState<{
    original: string;
    results: Array<{ provider: string; text: string; loading?: boolean }>;
  } | null>(null);

  const [correctionPrompt, setCorrectionPrompt] = useState<{ index: number; original: string; translated: string } | null>(null);

  const [wordAltData, setWordAltData] = useState<{
    word: string;
    sourceLang: string;
    targetLang: string;
    alternatives: WordAlternative[];
    loading: boolean;
  } | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const [deletedItem, setDeletedItem] = useState<{ item: HistoryItem; index: number } | null>(null);
  const undoTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [typedText, setTypedText] = useState("");
  const [typedPreview, setTypedPreview] = useState("");
  const typedTranslateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Pulse animation for mic button
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0)).current;
  const skeletonAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (isListening && !reduceMotion) {
      const pulse = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.6, duration: 1000, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 0, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(pulseOpacity, { toValue: 0.5, duration: 0, useNativeDriver: true }),
            Animated.timing(pulseOpacity, { toValue: 0, duration: 1000, useNativeDriver: true }),
          ]),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
      pulseOpacity.setValue(0);
    }
  }, [isListening, reduceMotion, pulseAnim, pulseOpacity]);

  useEffect(() => {
    if (isTranslating && !reduceMotion) {
      const shimmer = Animated.loop(
        Animated.sequence([
          Animated.timing(skeletonAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
          Animated.timing(skeletonAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        ])
      );
      shimmer.start();
      return () => shimmer.stop();
    } else {
      skeletonAnim.setValue(reduceMotion ? 0.5 : 0.3);
    }
  }, [isTranslating, reduceMotion, skeletonAnim]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (translationTimeout.current) clearTimeout(translationTimeout.current);
      if (errorDismissTimeout.current) clearTimeout(errorDismissTimeout.current);
      if (undoTimeout.current) clearTimeout(undoTimeout.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      abortControllerRef.current?.abort();
      Speech.stop();
    };
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

  const submitCorrection = useCallback((correctedText: string) => {
    if (!correctionPrompt || !correctedText.trim()) return;
    const { index, original } = correctionPrompt;
    const correction = correctedText.trim();
    setHistory((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], translated: correction };
      }
      return updated;
    });
    notifySuccess();
    setCorrectionPrompt(null);
  }, [correctionPrompt, setHistory]);

  const copyToClipboard = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    notifySuccess();
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 1500);
  }, []);

  const lookupWordAlternatives = useCallback(async (word: string, srcLang: string, tgtLang: string) => {
    setWordAltData({ word, sourceLang: srcLang, targetLang: tgtLang, alternatives: [], loading: true });
    impactMedium();
    try {
      const alts = await getWordAlternatives(word, srcLang, tgtLang);
      setWordAltData((prev) => prev ? { ...prev, alternatives: alts, loading: false } : null);
    } catch {
      setWordAltData((prev) => prev ? { ...prev, loading: false } : null);
    }
  }, []);

  const compareTranslation = useCallback(async (original: string, currentTranslation: string) => {
    const allProviders: Array<{ key: TranslationProvider; label: string }> = [
      { key: "apple", label: "Apple (On-Device)" },
      { key: "mlkit", label: "ML Kit (On-Device)" },
      { key: "mymemory", label: "MyMemory (Cloud)" },
    ];
    const providers = allProviders.filter((p) => p.key !== settings.translationProvider);
    const currentLabel = allProviders.find((p) => p.key === settings.translationProvider)?.label || settings.translationProvider;
    const initialResults = [
      { provider: currentLabel, text: currentTranslation },
      ...providers.map((p) => ({ provider: p.label, text: "", loading: true })),
    ];
    setCompareData({ original, results: initialResults });

    for (const p of providers) {
      try {
        const result = await translateText(original, sourceLang.code, targetLang.code, { provider: p.key });
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
  }, [settings.translationProvider, sourceLang.code, targetLang.code]);

  // Debounced translation
  const debouncedTranslate = useCallback(
    (text: string) => {
      if (translationTimeout.current) clearTimeout(translationTimeout.current);
      if (!text.trim() || text.trim() === lastTranslatedRef.current) return;

      translationTimeout.current = setTimeout(async () => {
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const fromCode = (conversationMode && activeSpeakerRef.current === "B") ? targetLang.code : sourceLang.code;
        const toCode = (conversationMode && activeSpeakerRef.current === "B") ? sourceLang.code : targetLang.code;

        setIsTranslating(true);
        try {
          const glossaryMatch = glossaryLookup(text.trim(), fromCode, toCode);
          const result = glossaryMatch
            ? { translatedText: glossaryMatch, confidence: 1.0 }
            : await translateText(text.trim(), fromCode, toCode, { signal: controller.signal, provider: settings.translationProvider });
          if (!controller.signal.aborted) {
            setTranslatedText(result.translatedText);
            lastTranslatedRef.current = text.trim();
            lastConfidenceRef.current = result.confidence;
            lastDetectedLangRef.current = (result as any).detectedLanguage;
            updateWidgetData(text.trim(), result.translatedText, fromCode, toCode);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          const msg = err instanceof Error ? err.message : "Translation failed";
          showError(msg);
        } finally {
          if (!controller.signal.aborted) setIsTranslating(false);
        }
      }, 300);
    },
    [sourceLang.code, targetLang.code, conversationMode, showError, settings.translationProvider, glossaryLookup, updateWidgetData]
  );

  // Speech recognition events
  useSpeechRecognitionEvent("start", () => setIsListening(true));

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }

    if (finalText.trim() && translatedText.trim()) {
      const speaker = conversationMode ? activeSpeakerRef.current : undefined;
      setHistory((prev) => [
        ...prev,
        { original: finalText.trim(), translated: translatedText.trim(), speaker, confidence: lastConfidenceRef.current, detectedLang: lastDetectedLangRef.current, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code, timestamp: Date.now() },
      ]);
      maybeRequestReview();
      updateStreak();
      if (settings.autoPlayTTS) {
        const ttsLang = (conversationMode && speaker === "B") ? sourceLang.speechCode : targetLang.speechCode;
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

    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (settings.silenceTimeout > 0) {
      silenceTimerRef.current = setTimeout(() => ExpoSpeechRecognitionModule.stop(), settings.silenceTimeout * 1000);
    }

    if (isFinal) {
      const updated = finalTextRef.current ? `${finalTextRef.current} ${transcript}` : transcript;
      finalTextRef.current = updated;
      setFinalText(updated);
      setLiveText(updated);
      debouncedTranslate(updated);
    } else {
      const combined = finalTextRef.current ? `${finalTextRef.current} ${transcript}` : transcript;
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
    showError(errorMap[event.error] || `Speech error: ${event.error}`);
    setIsListening(false);
  });

  // Auto-scroll
  useEffect(() => {
    if (settings.autoScroll && (history.length > 0 || liveText)) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [history, liveText, translatedText, settings.autoScroll]);

  const startListening = async () => {
    impactMedium();
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
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: settings.offlineSpeech,
      ...(sourceLang.code === "autodetect" ? { addsPunctuation: true } : {}),
    });
  };

  const startListeningAs = (speaker: "A" | "B") => {
    activeSpeakerRef.current = speaker;
    startListening();
  };

  const stopListening = () => {
    impactLight();
    ExpoSpeechRecognitionModule.stop();
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
            notifyWarning();
            setHistory([]);
          },
        },
      ]
    );
  };

  const deleteHistoryItem = useCallback((index: number) => {
    impactMedium();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setHistory((prev) => {
      const removed = prev[index];
      if (removed) {
        if (undoTimeout.current) clearTimeout(undoTimeout.current);
        setDeletedItem({ item: removed, index });
        undoTimeout.current = setTimeout(() => setDeletedItem(null), 4000);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, [setHistory]);

  const undoDelete = useCallback(() => {
    if (!deletedItem) return;
    if (undoTimeout.current) clearTimeout(undoTimeout.current);
    impactLight();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setHistory((prev) => {
      const updated = [...prev];
      const insertAt = Math.min(deletedItem.index, updated.length);
      updated.splice(insertAt, 0, deletedItem.item);
      return updated;
    });
    setDeletedItem(null);
  }, [deletedItem, setHistory]);

  const toggleFavorite = useCallback((index: number) => {
    impactLight();
    setHistory((prev) =>
      prev.map((item, i) => i === index ? { ...item, favorited: !item.favorited } : item)
    );
  }, [setHistory]);

  const retryTranslation = useCallback(async (index: number) => {
    const item = history[index];
    if (!item?.error || !item.sourceLangCode || !item.targetLangCode) return;

    setHistory((prev) =>
      prev.map((h, i) => i === index ? { ...h, error: false, pending: true, translated: "Retrying..." } : h)
    );

    const controller = new AbortController();
    try {
      const result = await translateText(item.original, item.sourceLangCode, item.targetLangCode, { signal: controller.signal, provider: settings.translationProvider });
      setHistory((prev) =>
        prev.map((h, i) => i === index ? { ...h, translated: result.translatedText, pending: false, error: false, sourceLangCode: undefined, targetLangCode: undefined } : h)
      );
      notifySuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Translation failed";
      setHistory((prev) =>
        prev.map((h, i) => i === index ? { ...h, translated: msg, pending: false, error: true } : h)
      );
      showError(msg);
    }
  }, [history, settings.translationProvider, showError, setHistory]);

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
        exportable.map((item) => ({ original: item.original, translated: item.translated, favorited: !!item.favorited })),
        null,
        2
      );
    } else {
      const lines = exportable.map((item, i) => `${i + 1}. ${item.original}\n   → ${item.translated}`);
      message = `Live Translator - ${exportable.length} translation(s)\n\n${lines.join("\n\n")}`;
    }
    try { await Share.share({ message }); } catch {}
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
            notifyWarning();
            setHistory((prev) => prev.filter((_, i) => !selectedIndices.has(i)));
            exitSelectMode();
          },
        },
      ]
    );
  }, [selectedIndices, exitSelectMode, setHistory]);

  const exportSelected = useCallback(() => {
    if (selectedIndices.size === 0) return;
    const items = history.filter((_, i) => selectedIndices.has(i));
    const lines = items.map((item, i) => `${i + 1}. ${item.original}\n   → ${item.translated}`);
    const text = `Live Translator - ${items.length} translation(s)\n\n${lines.join("\n\n")}`;
    Share.share({ message: text }).catch(() => {});
  }, [selectedIndices, history]);

  // Translate-as-you-type
  useEffect(() => {
    if (typedTranslateTimer.current) clearTimeout(typedTranslateTimer.current);
    const text = typedText.trim();
    if (!text || isListening) {
      setTypedPreview("");
      return;
    }
    typedTranslateTimer.current = setTimeout(async () => {
      try {
        const glossaryMatch = glossaryLookup(text, sourceLang.code, targetLang.code);
        if (glossaryMatch) {
          setTypedPreview(glossaryMatch);
          return;
        }
        const result = await translateText(text, sourceLang.code, targetLang.code, { provider: settings.translationProvider });
        setTypedPreview(result.translatedText);
      } catch {
        setTypedPreview("");
      }
    }, 500);
    return () => { if (typedTranslateTimer.current) clearTimeout(typedTranslateTimer.current); };
  }, [typedText, sourceLang.code, targetLang.code, settings.translationProvider, glossaryLookup, isListening]);

  const submitTypedText = useCallback(async () => {
    const text = typedText.trim();
    if (!text) return;
    Keyboard.dismiss();
    setTypedText("");
    setTypedPreview("");

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
        : await translateText(text, sourceLang.code, targetLang.code, { signal: controller.signal, provider: settings.translationProvider });
      if (!controller.signal.aborted) {
        setHistory((prev) => [...prev, { original: text, translated: result.translatedText, confidence: result.confidence, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code, detectedLang: (result as any).detectedLanguage, timestamp: Date.now() }]);
        maybeRequestReview();
        updateStreak();
        updateWidgetData(text, result.translatedText, sourceLang.code, targetLang.code);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : "Translation failed";
        showError(msg);
        setHistory((prev) => [...prev, { original: text, translated: msg, error: true, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code, timestamp: Date.now() }]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsTranslating(false);
        setLiveText("");
      }
    }
  }, [typedText, sourceLang.code, targetLang.code, showError, isOffline, addToOfflineQueue, glossaryLookup, settings.translationProvider, maybeRequestReview, updateStreak, updateWidgetData, setHistory]);

  const filteredHistory = useMemo(() => {
    let filtered = history;
    if (showFavoritesOnly) filtered = filtered.filter((item) => item.favorited);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => item.original.toLowerCase().includes(q) || item.translated.toLowerCase().includes(q));
    }
    return filtered;
  }, [history, searchQuery, showFavoritesOnly]);

  const hasFavorites = useMemo(() => history.some((item) => item.favorited), [history]);

  const renderHistoryItem = useCallback(({ item, index }: { item: HistoryItem; index: number }) => {
    const isB = item.speaker === "B";
    const speakLang = isB ? sourceLang.speechCode : targetLang.speechCode;
    const realIndex = searchQuery.trim() ? history.findIndex((h) => h === item) : index;
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
            {isSelected && <Text style={[styles.selectCheckmark, { color: colors.destructiveText }]}>✓</Text>}
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
          <ChatBubble
            item={item}
            realIndex={realIndex}
            colors={colors}
            dynamicFontSizes={dynamicFontSizes}
            showRomanization={settings.showRomanization}
            fontSizeScale={FONT_SIZE_SCALES[settings.fontSize] || 1}
            copiedText={copiedText}
            speakingText={speakingText}
            speakLang={speakLang}
            sourceLangName={sourceLang.name}
            targetLangName={targetLang.name}
            onCopy={copyToClipboard}
            onSpeak={speakText}
            onToggleFavorite={toggleFavorite}
          />
        ) : (
          <TranslationBubble
            item={item}
            realIndex={realIndex}
            colors={colors}
            dynamicFontSizes={dynamicFontSizes}
            showRomanization={settings.showRomanization}
            fontSizeScale={fontScale}
            copiedText={copiedText}
            speakingText={speakingText}
            targetSpeechCode={targetLang.speechCode}
            onCopy={copyToClipboard}
            onSpeak={speakText}
            onToggleFavorite={toggleFavorite}
            onRetry={retryTranslation}
            onCompare={compareTranslation}
            onCorrection={setCorrectionPrompt}
            onWordLongPress={lookupWordAlternatives}
          />
        )}
      </SwipeableRow>
    );
  }, [conversationMode, selectMode, selectedIndices, colors, dynamicFontSizes, settings.showRomanization, settings.fontSize, fontScale, copiedText, speakingText, sourceLang, targetLang, searchQuery, history, toggleSelectItem, deleteHistoryItem, copyToClipboard, speakText, toggleFavorite, retryTranslation, compareTranslation, lookupWordAlternatives]);

  return (
    <>
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.safeBg }]}>
        <StatusBar barStyle={colors.statusBar} />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.container, isLandscape && styles.containerLandscape]}>
            {/* Header */}
            <View style={[styles.headerRow, isLandscape && styles.headerRowLandscape]}>
              <Text style={[styles.title, isLandscape && styles.titleLandscape, { color: colors.titleText }]}>Live Translator</Text>
              <TouchableOpacity
                style={[styles.modeToggle, { backgroundColor: colors.cardBg }, conversationMode && { backgroundColor: colors.primary }]}
                onPress={() => setConversationMode((m) => !m)}
                accessibilityRole="button"
                accessibilityLabel={conversationMode ? "Switch to standard mode" : "Switch to conversation mode"}
                accessibilityState={{ selected: conversationMode }}
              >
                <Text style={[styles.modeToggleText, { color: colors.mutedText }, conversationMode && { color: colors.destructiveText }]}>Chat</Text>
              </TouchableOpacity>
              {conversationMode && history.some((h) => h.speaker) && (
                <TouchableOpacity
                  style={[styles.modeToggle, { backgroundColor: colors.cardBg, right: 60 }]}
                  onPress={() => setShowPlayback(true)}
                  accessibilityRole="button"
                  accessibilityLabel="View conversation playback"
                >
                  <Text style={[styles.modeToggleText, { color: colors.primary }]}>▶ Play</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Modals */}
            <ComparisonModal visible={!!compareData} data={compareData} onClose={() => setCompareData(null)} onCopy={copyToClipboard} copiedText={copiedText} colors={colors} />
            <WordAlternativesModal visible={wordAltData !== null} data={wordAltData} onClose={() => setWordAltData(null)} onCopy={copyToClipboard} copiedText={copiedText} colors={colors} />
            <CorrectionModal visible={correctionPrompt !== null} data={correctionPrompt} onClose={() => setCorrectionPrompt(null)} onSubmit={submitCorrection} colors={colors} />

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
                    <Text style={[styles.savePairIcon, { color: colors.mutedText }, isCurrentPairSaved && { color: colors.favoriteColor }]}>
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
                accessibilityLiveRegion="assertive"
                accessibilityLabel="No internet connection. Translations require network access."
              >
                <Text style={styles.offlineIcon}>⚡</Text>
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
                accessibilityLiveRegion="assertive"
                accessibilityLabel={`Error: ${errorMessage}. Tap to dismiss.`}
              >
                <Text style={[styles.errorText, { color: colors.errorText }]}>{errorMessage}</Text>
                <Text style={[styles.errorDismiss, { color: colors.errorBorder }]} importantForAccessibility="no">✕</Text>
              </TouchableOpacity>
            ) : null}

            {/* History + live translation */}
            <FlatList
              ref={listRef}
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              data={filteredHistory}
              keyExtractor={(item, index) => item.timestamp ? `${item.timestamp}-${item.original.slice(0, 10)}` : `${index}-${item.original.slice(0, 20)}`}
              keyboardDismissMode="on-drag"
              removeClippedSubviews={Platform.OS !== "web"}
              maxToRenderPerBatch={15}
              windowSize={7}
              initialNumToRender={10}
              ListHeaderComponent={
                history.length > 2 && !isListening ? (
                  <View>
                    {hasMoreHistory && (
                      <TouchableOpacity
                        style={[styles.loadMoreButton, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
                        onPress={loadMoreHistory}
                        accessibilityRole="button"
                        accessibilityLabel="Load older translations"
                      >
                        <Text style={[styles.loadMoreText, { color: colors.primary }]}>Load older translations</Text>
                      </TouchableOpacity>
                    )}
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
                        <TouchableOpacity style={styles.searchClear} onPress={() => setSearchQuery("")} accessibilityRole="button" accessibilityLabel="Clear search">
                          <Text style={[styles.searchClearText, { color: colors.mutedText }]}>✕</Text>
                        </TouchableOpacity>
                      ) : null}
                      {hasFavorites ? (
                        <TouchableOpacity
                          style={[styles.favFilterButton, { backgroundColor: colors.bubbleBg, borderColor: colors.border }, showFavoritesOnly && { backgroundColor: colors.cardBg, borderColor: colors.favoriteColor }]}
                          onPress={() => setShowFavoritesOnly((v) => !v)}
                          accessibilityRole="button"
                          accessibilityLabel={showFavoritesOnly ? "Show all translations" : "Show favorites only"}
                          accessibilityState={{ selected: showFavoritesOnly }}
                        >
                          <Text style={[styles.favFilterIcon, { color: colors.favoriteColor }]}>{showFavoritesOnly ? "★" : "☆"}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                ) : null
              }
              renderItem={renderHistoryItem}
              ListFooterComponent={
                liveText ? (
                  <View style={styles.liveSection} accessibilityLiveRegion="polite">
                    <View style={styles.liveDivider}>
                      <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                      <Text style={[styles.liveLabel, { color: colors.destructiveBg }]}>
                        {isListening ? "● LIVE" : "PROCESSING"}
                        {sourceLang.code === "autodetect" && lastDetectedLangRef.current ? ` · ${LANGUAGES.find((l) => l.code === lastDetectedLangRef.current)?.name || lastDetectedLangRef.current}` : ""}
                      </Text>
                      <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                    </View>

                    <View style={[styles.bubble, styles.liveBubble, { backgroundColor: colors.liveBubbleBg, borderColor: colors.border }]}>
                      <Text style={[styles.liveOriginalText, { color: colors.liveOriginalText }, dynamicFontSizes.liveOriginal]}>{liveText}</Text>
                      {settings.showRomanization && needsRomanization(sourceLang.code) && (
                        <AlignedRomanization text={liveText} langCode={sourceLang.code} textColor={colors.liveOriginalText} romanColor={colors.mutedText} fontSize={18} />
                      )}
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
                          {settings.showRomanization && needsRomanization(targetLang.code) && (
                            <AlignedRomanization text={translatedText} langCode={targetLang.code} textColor={colors.liveTranslatedText} romanColor={colors.mutedText} fontSize={20} />
                          )}
                          {copiedText === translatedText && <Text style={[styles.copiedBadge, { color: colors.successText }]}>Copied!</Text>}
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
              <View style={[styles.undoToast, { backgroundColor: colors.cardBg, borderColor: colors.border }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
                <Text style={[styles.undoToastText, { color: colors.secondaryText }]} numberOfLines={1}>Translation deleted</Text>
                <TouchableOpacity style={styles.undoButton} onPress={undoDelete} accessibilityRole="button" accessibilityLabel="Undo delete">
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
                      <TouchableOpacity style={styles.clearButton} onPress={exitSelectMode} accessibilityRole="button" accessibilityLabel="Cancel selection">
                        <Text style={[styles.clearText, { color: colors.dimText }]}>Cancel</Text>
                      </TouchableOpacity>
                      <Text style={[styles.selectCountText, { color: colors.mutedText }]}>{selectedIndices.size} selected</Text>
                      <TouchableOpacity style={styles.clearButton} onPress={exportSelected} accessibilityRole="button" accessibilityLabel="Share selected" disabled={selectedIndices.size === 0}>
                        <Text style={[styles.shareText, { color: selectedIndices.size > 0 ? colors.primary : colors.dimText }]}>Share</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.clearButton} onPress={deleteSelected} accessibilityRole="button" accessibilityLabel="Delete selected" disabled={selectedIndices.size === 0}>
                        <Text style={[styles.clearText, { color: selectedIndices.size > 0 ? colors.errorText : colors.dimText }]}>Delete</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity style={styles.clearButton} onPress={clearHistory} accessibilityRole="button" accessibilityLabel="Clear translation history">
                        <Text style={[styles.clearText, { color: colors.dimText }]}>Clear</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.clearButton} onPress={() => setSelectMode(true)} accessibilityRole="button" accessibilityLabel="Select multiple translations">
                        <Text style={[styles.shareText, { color: colors.mutedText }]}>Select</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.clearButton} onPress={showExportPicker} accessibilityRole="button" accessibilityLabel="Share translation history">
                        <Text style={[styles.shareText, { color: colors.primary }]}>Share</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}

              {conversationMode ? (
                <View style={styles.convoControls}>
                  <TouchableOpacity
                    style={[styles.splitScreenBtn, { backgroundColor: colors.cardBg, borderColor: colors.primary }]}
                    onPress={() => {
                      if (isListening) stopListening();
                      setShowSplitScreen(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Open split screen conversation mode"
                  >
                    <Text style={[styles.splitScreenIcon, { color: colors.primary }]}>⇅</Text>
                    <Text style={[styles.splitScreenLabel, { color: colors.primary }]}>Face to Face</Text>
                  </TouchableOpacity>
                  <View style={styles.convoMicCol}>
                    <View style={styles.micButtonWrapper}>
                      {isListening && activeSpeakerRef.current === "A" && (
                        <Animated.View style={[styles.pulseRing, { backgroundColor: colors.destructiveBg, transform: [{ scale: pulseAnim }], opacity: pulseOpacity }]} />
                      )}
                      <TouchableOpacity
                        style={[styles.micButton, styles.micButtonSmall, { backgroundColor: colors.primary, shadowColor: colors.primary }, isListening && activeSpeakerRef.current === "A" && { backgroundColor: colors.destructiveBg, shadowColor: colors.destructiveBg }]}
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
                        <Animated.View style={[styles.pulseRing, { backgroundColor: colors.destructiveBg, transform: [{ scale: pulseAnim }], opacity: pulseOpacity }]} />
                      )}
                      <TouchableOpacity
                        style={[styles.micButton, styles.micButtonSmall, { backgroundColor: colors.primary, shadowColor: colors.primary }, isListening && activeSpeakerRef.current === "B" && { backgroundColor: colors.destructiveBg, shadowColor: colors.destructiveBg }]}
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
                        style={[styles.pulseRing, isLandscape && styles.pulseRingLandscape, { backgroundColor: colors.destructiveBg, transform: [{ scale: pulseAnim }], opacity: pulseOpacity }]}
                      />
                    )}
                    <TouchableOpacity
                      style={[styles.micButton, isLandscape && styles.micButtonLandscape, { backgroundColor: colors.primary, shadowColor: colors.primary }, isListening && { backgroundColor: colors.destructiveBg, shadowColor: colors.destructiveBg }]}
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
                      <Text style={[styles.listeningDot, { color: colors.destructiveBg }]} importantForAccessibility="no">●</Text>
                      <Text style={[styles.listeningLabel, { color: colors.destructiveBg }]}>
                        Listening...{settings.silenceTimeout > 0 ? ` (auto-stop ${settings.silenceTimeout}s)` : ""}
                      </Text>
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
                      <TouchableOpacity style={[styles.sendButton, { backgroundColor: colors.primary }]} onPress={submitTypedText} accessibilityRole="button" accessibilityLabel="Translate typed text">
                        <Text style={[styles.sendIcon, { color: colors.destructiveText }]}>→</Text>
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
                  {typedPreview ? (
                    <TouchableOpacity
                      style={[styles.typedPreview, { backgroundColor: colors.translatedBubbleBg, borderLeftColor: colors.primary }]}
                      onPress={() => copyToClipboard(typedPreview)}
                      accessibilityLiveRegion="polite"
                      accessibilityLabel={`Preview: ${typedPreview}. Tap to copy.`}
                    >
                      <Text style={[styles.typedPreviewText, { color: colors.translatedText }]}>{typedPreview}</Text>
                      {copiedText === typedPreview && <Text style={[styles.copiedBadge, { color: colors.successText }]}>Copied!</Text>}
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <SplitConversation visible={showSplitScreen} onClose={() => setShowSplitScreen(false)} />
      <ConversationPlayback visible={showPlayback} onClose={() => setShowPlayback(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: Platform.OS === "android" ? 40 : 10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  title: { fontSize: 28, fontWeight: "800", textAlign: "center" },
  modeToggle: { position: "absolute", right: 0, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 },
  modeToggleActive: { backgroundColor: "#6c63ff" },
  modeToggleText: { fontSize: 12, fontWeight: "700" },
  modeToggleTextActive: { color: "#ffffff" },
  langRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, marginBottom: 20 },
  langMiddleButtons: { alignItems: "center", gap: 4, marginBottom: 0 },
  swapButton: { borderRadius: 12, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  swapIcon: { fontSize: 20, fontWeight: "700" },
  savePairButton: { borderRadius: 10, width: 32, height: 28, alignItems: "center", justifyContent: "center" },
  savePairIcon: { fontSize: 16, color: "#8888aa" },
  savePairIconActive: { color: "#ffd700" },
  savedPairsRow: { marginBottom: 12, marginTop: -8 },
  savedPairPill: { borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8, borderWidth: 1 },
  savedPairPillActive: { borderWidth: 1.5 },
  savedPairText: { fontSize: 12, fontWeight: "700" },
  offlineBanner: { borderRadius: 12, padding: 10, marginBottom: 12, flexDirection: "row", alignItems: "center", borderWidth: 1, gap: 8 },
  offlineIcon: { fontSize: 16 },
  offlineText: { fontSize: 13, fontWeight: "600", flex: 1 },
  errorBanner: { borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1 },
  errorText: { fontSize: 14, flex: 1 },
  errorDismiss: { fontSize: 16, marginLeft: 12, fontWeight: "700" },
  scrollArea: { flex: 1, marginBottom: 10 },
  scrollContent: { paddingBottom: 20, flexGrow: 1 },
  searchRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  searchInput: { flex: 1, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 14, fontSize: 14, borderWidth: 1 },
  searchClear: { marginLeft: 8, padding: 4 },
  searchClearText: { fontSize: 16, fontWeight: "700" },
  bubble: { borderRadius: 16, padding: 14, marginBottom: 6 },
  copiedBadge: { color: "#4ade80", fontSize: 12, fontWeight: "700", marginTop: 6 },
  liveSection: { marginTop: 8 },
  liveDivider: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 10 },
  dividerLine: { flex: 1, height: 1 },
  liveLabel: { color: "#ff4757", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  liveBubble: { borderWidth: 1 },
  liveOriginalText: { fontSize: 18, lineHeight: 26 },
  liveTranslatedBubble: { borderLeftWidth: 3, borderWidth: 1 },
  liveTranslatedText: { fontSize: 20, lineHeight: 28, fontWeight: "600" },
  skeletonLine: { height: 14, borderRadius: 7, marginBottom: 8 },
  skeletonLong: { width: "80%" },
  skeletonShort: { width: "50%", marginBottom: 0 },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 60 },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  emptySubtitle: { fontSize: 15, textAlign: "center", lineHeight: 22, paddingHorizontal: 40 },
  phraseOfDay: { marginTop: 24, paddingVertical: 16, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, alignItems: "center", width: "80%" },
  phraseOfDayLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  phraseOfDayText: { fontSize: 18, fontWeight: "600", marginBottom: 4, textAlign: "center" },
  phraseOfDayTranslation: { fontSize: 16, fontStyle: "italic", textAlign: "center" },
  controls: { alignItems: "center", paddingBottom: Platform.OS === "android" ? 20 : 10, paddingTop: 10 },
  historyActions: { flexDirection: "row", gap: 20, marginBottom: 12 },
  clearButton: {},
  clearText: { fontSize: 14, fontWeight: "600" },
  shareText: { fontSize: 14, fontWeight: "600" },
  micButtonWrapper: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  pulseRing: { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: "#ff4757" },
  micButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#6c63ff", alignItems: "center", justifyContent: "center", shadowColor: "#6c63ff", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  micButtonActive: { backgroundColor: "#ff4757", shadowColor: "#ff4757" },
  micIcon: { fontSize: 32 },
  listeningIndicator: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 6 },
  listeningDot: { color: "#ff4757", fontSize: 10 },
  listeningLabel: { color: "#ff4757", fontSize: 13, fontWeight: "600" },
  textInputRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 12, gap: 8, width: "100%" },
  textInput: { flex: 1, borderRadius: 20, paddingTop: 10, paddingBottom: 10, paddingHorizontal: 16, fontSize: 15, borderWidth: 1, minHeight: 40 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#6c63ff", alignItems: "center", justifyContent: "center" },
  sendIcon: { color: "#ffffff", fontSize: 18, fontWeight: "700" },
  convoControls: { flexDirection: "row", justifyContent: "center", alignItems: "flex-end", gap: 24 },
  splitScreenBtn: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, marginBottom: 8 },
  splitScreenIcon: { fontSize: 20, fontWeight: "700" },
  splitScreenLabel: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  convoMicCol: { alignItems: "center", gap: 8 },
  convoLabel: { fontSize: 12, fontWeight: "600" },
  micButtonSmall: { width: 60, height: 60, borderRadius: 30 },
  speakButton: { padding: 4 },
  speakIcon: { fontSize: 18 },
  speakIconActive: { opacity: 0.6 },
  selectRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 4, gap: 12 },
  selectCheckbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  selectCheckmark: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  selectContent: { flex: 1, gap: 2 },
  selectCountText: { fontSize: 13, fontWeight: "600" },
  charCountRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, marginTop: 4 },
  charCountText: { fontSize: 11, fontWeight: "600" },
  wordCountText: { fontSize: 11, fontWeight: "600" },
  undoToast: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, marginBottom: 8, borderWidth: 1 },
  undoToastText: { fontSize: 14, fontWeight: "500", flex: 1 },
  undoButton: { marginLeft: 12, paddingVertical: 4, paddingHorizontal: 12 },
  undoButtonText: { fontSize: 14, fontWeight: "700" },
  loadMoreButton: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, marginBottom: 12 },
  loadMoreText: { fontSize: 13, fontWeight: "600" },
  typedPreview: { marginTop: 8, borderRadius: 12, padding: 10, borderLeftWidth: 3 },
  typedPreviewText: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  favFilterButton: { marginLeft: 8, padding: 6, borderRadius: 12, borderWidth: 1 },
  favFilterButtonActive: { backgroundColor: "#2a2a4a", borderColor: "#ffd700" },
  favFilterIcon: { fontSize: 18, color: "#ffd700" },
  // Landscape overrides
  containerLandscape: { paddingHorizontal: 40, paddingTop: 4 },
  headerRowLandscape: { marginBottom: 8 },
  titleLandscape: { fontSize: 20 },
  controlsLandscape: { paddingBottom: 4, paddingTop: 4 },
  micButtonWrapperLandscape: { width: 56, height: 56 },
  micButtonLandscape: { width: 56, height: 56, borderRadius: 28 },
  pulseRingLandscape: { width: 56, height: 56, borderRadius: 28 },
});
