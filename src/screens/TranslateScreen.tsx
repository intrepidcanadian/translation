import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
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

import * as Clipboard from "expo-clipboard";
import * as Speech from "expo-speech";
import { impactLight, impactMedium, notifySuccess, notifyWarning } from "../services/haptics";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import LanguagePicker from "../components/LanguagePicker";
import ComparisonModal from "../components/ComparisonModal";
import WordAlternativesModal from "../components/WordAlternativesModal";
import CorrectionModal from "../components/CorrectionModal";
import ControlsPanel from "../components/ControlsPanel";
import HistoryList from "../components/HistoryList";
import SplitConversation from "../components/SplitConversation";
import ConversationPlayback from "../components/ConversationPlayback";
import {
  translateText,
  getWordAlternatives,
  LANGUAGES,
  type WordAlternative,
} from "../services/translation";
import { getColors } from "../theme";
import { PHRASE_CATEGORIES, getPhraseOfTheDay } from "../services/offlinePhrases";
import { FONT_SIZE_SCALES } from "../components/SettingsModal";
import type { TranslationProvider } from "../services/translation";
import { useRoute } from "@react-navigation/native";
import { useSettings } from "../contexts/SettingsContext";
import { useLanguage } from "../contexts/LanguageContext";
import { useGlossary } from "../contexts/GlossaryContext";
import { useTranslationData } from "../contexts/TranslationDataContext";
import type { HistoryItem } from "../types";
import type { RootTabParamList } from "../navigation/types";

export default function TranslateScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const { settings, reduceMotion, maybeRequestReview } = useSettings();
  const { sourceLang, targetLang, setSourceLang, setTargetLang, swapLanguages, recentLangCodes, trackRecentLang, savedPairs, isCurrentPairSaved, toggleSavePair, applyPair, removeSavedPair } = useLanguage();
  const { glossaryLookup } = useGlossary();
  const { history, setHistory, hasMoreHistory, loadMoreHistory, isOffline, offlineQueue, addToOfflineQueue, updateStreak, updateWidgetData } = useTranslationData();
  const route = useRoute<any>();

  // Handle deep link params (e.g. livetranslator://translate/en/es)
  useEffect(() => {
    const params = route.params as RootTabParamList["Translate"];
    if (!params) return;
    if (params.sourceLang) {
      const src = LANGUAGES.find((l) => l.code === params.sourceLang);
      if (src) setSourceLang(src);
    }
    if (params.targetLang) {
      const tgt = LANGUAGES.find((l) => l.code === params.targetLang);
      if (tgt) setTargetLang(tgt);
    }
  }, [route.params, setSourceLang, setTargetLang]);

  const colors = useMemo(() => getColors(settings.theme), [settings.theme]);
  const fontScale = FONT_SIZE_SCALES[settings.fontSize];
  const dynamicFontSizes = useMemo(() => ({
    original: { fontSize: Math.round(16 * fontScale) },
    translated: { fontSize: Math.round(16 * fontScale) },
    liveOriginal: { fontSize: Math.round(18 * fontScale) },
    liveTranslated: { fontSize: Math.round(20 * fontScale) },
    chatText: { fontSize: Math.round(15 * fontScale) },
  }), [fontScale]);

  const [errorMessage, setErrorMessage] = useState("");
  const [conversationMode, setConversationMode] = useState(false);
  const activeSpeakerRef = useRef<"A" | "B">("A");
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlineBanner, setShowOnlineBanner] = useState(false);
  const wasOfflineRef = useRef(false);

  const errorDismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((msg: string) => {
    if (errorDismissTimeout.current) clearTimeout(errorDismissTimeout.current);
    setErrorMessage(msg);
    errorDismissTimeout.current = setTimeout(() => setErrorMessage(""), 4000);
  }, []);

  const onTranslationComplete = useCallback((original: string, translated: string, speaker: "A" | "B" | undefined, confidence?: number, detectedLang?: string) => {
    setHistory((prev) => [
      ...prev,
      { original, translated, speaker, confidence, detectedLang, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code, timestamp: Date.now() },
    ]);
    maybeRequestReview();
    updateStreak();
  }, [setHistory, sourceLang.code, targetLang.code, maybeRequestReview, updateStreak]);

  const speech = useSpeechRecognition({
    sourceLangCode: sourceLang.code,
    sourceSpeechCode: sourceLang.speechCode,
    targetLangCode: targetLang.code,
    targetSpeechCode: targetLang.speechCode,
    conversationMode,
    activeSpeakerRef,
    offlineSpeech: settings.offlineSpeech,
    silenceTimeout: settings.silenceTimeout,
    speechRate: settings.speechRate,
    autoPlayTTS: settings.autoPlayTTS,
    reduceMotion,
    translationProvider: settings.translationProvider,
    glossaryLookup,
    updateWidgetData,
    onTranslationComplete,
    onShowError: showError,
  });

  const { isListening, liveText, setLiveText, translatedText, isTranslating, setIsTranslating, lastDetectedLang, pulseAnim, pulseOpacity, skeletonAnim, startListening: startListeningBase, startListeningAs, stopListening, abortControllerRef } = speech;

  const startListening = useCallback(async () => {
    setErrorMessage("");
    setSearchQuery("");
    startListeningBase();
  }, [startListeningBase]);

  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showSplitScreen, setShowSplitScreen] = useState(false);
  const [showPlayback, setShowPlayback] = useState(false);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (errorDismissTimeout.current) clearTimeout(errorDismissTimeout.current);
      if (undoTimeout.current) clearTimeout(undoTimeout.current);
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
    } catch (err) {
      console.warn("Word alternatives lookup failed:", err);
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
      } catch (err) {
        console.warn("Compare translation failed:", err);
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

  // Detect connectivity restored
  useEffect(() => {
    if (isOffline) {
      wasOfflineRef.current = true;
    } else if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setShowOnlineBanner(true);
      const timer = setTimeout(() => setShowOnlineBanner(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOffline]);

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
    try { await Share.share({ message }); } catch (err) { console.warn("Share failed:", err); }
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
    Share.share({ message: text }).catch((err) => console.warn("Share selected failed:", err));
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
      } catch (err) {
        console.warn("Type-ahead translation failed:", err);
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
        setHistory((prev) => [...prev, { original: text, translated: result.translatedText, confidence: result.confidence, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code, detectedLang: result.detectedLanguage, timestamp: Date.now() }]);
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

  // Memoize phrase of the day (only changes when target language changes)
  const phraseOfTheDay = useMemo(() => {
    const potd = getPhraseOfTheDay(targetLang.code);
    if (!potd) return null;
    const categoryInfo = PHRASE_CATEGORIES.find((c) => c.key === potd.category);
    return { potd, categoryInfo };
  }, [targetLang.code]);

  const toggleFavoritesOnly = useCallback(() => setShowFavoritesOnly((v) => !v), []);

  const renderSavedPairItem = useCallback(({ item }: { item: { sourceCode: string; targetCode: string } }) => {
    const isActive = item.sourceCode === sourceLang.code && item.targetCode === targetLang.code;
    const srcName = LANGUAGES.find((l) => l.code === item.sourceCode)?.name || item.sourceCode;
    const tgtName = LANGUAGES.find((l) => l.code === item.targetCode)?.name || item.targetCode;
    const srcFlag = LANGUAGES.find((l) => l.code === item.sourceCode)?.flag || "";
    const tgtFlag = LANGUAGES.find((l) => l.code === item.targetCode)?.flag || "";
    return (
      <TouchableOpacity
        style={[styles.savedPairPill, { backgroundColor: colors.cardBg, borderColor: isActive ? colors.primary : colors.border }, isActive && styles.savedPairPillActive]}
        onPress={() => applyPair(item.sourceCode, item.targetCode)}
        onLongPress={() => removeSavedPair(item.sourceCode, item.targetCode)}
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${srcName} to ${tgtName}. Long press to remove.`}
      >
        <Text style={[styles.savedPairText, { color: isActive ? colors.primary : colors.mutedText }]}>
          {srcFlag} {srcName.slice(0, 3)} → {tgtFlag} {tgtName.slice(0, 3)}
        </Text>
      </TouchableOpacity>
    );
  }, [sourceLang.code, targetLang.code, colors.cardBg, colors.primary, colors.border, colors.mutedText, applyPair, removeSavedPair]);

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
                accessibilityHint={conversationMode ? "Returns to single-speaker translation" : "Enables two-speaker face-to-face translation"}
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
                  accessibilityHint={`Swaps to translate from ${targetLang.name} to ${sourceLang.name}`}
                >
                  <Text style={[styles.swapIcon, { color: colors.primary }]}>⇄</Text>
                </TouchableOpacity>
                {sourceLang.code !== "autodetect" && (
                  <TouchableOpacity
                    style={[styles.savePairButton, { backgroundColor: colors.cardBg }]}
                    onPress={toggleSavePair}
                    accessibilityRole="button"
                    accessibilityLabel={isCurrentPairSaved ? "Remove saved language pair" : "Save this language pair"}
                    accessibilityHint={isCurrentPairSaved ? "Removes this pair from saved shortcuts" : "Saves this language pair for quick switching"}
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
                  renderItem={renderSavedPairItem}
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

            {/* Connection restored banner */}
            {showOnlineBanner && !isOffline && (
              <View
                style={[styles.offlineBanner, { backgroundColor: colors.successBg, borderColor: colors.successText }]}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                accessibilityLabel="Connection restored"
              >
                <Text style={styles.offlineIcon}>✓</Text>
                <Text style={[styles.offlineText, { color: colors.successText }]}>
                  Back online{offlineQueue.length > 0 ? ` — processing ${offlineQueue.length} queued translation${offlineQueue.length === 1 ? "" : "s"}` : ""}
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
            <HistoryList
              history={history}
              filteredHistory={filteredHistory}
              colors={colors}
              dynamicFontSizes={dynamicFontSizes}
              fontScale={fontScale}
              showRomanization={settings.showRomanization}
              fontSize={settings.fontSize}
              confidenceThreshold={settings.confidenceThreshold}
              conversationMode={conversationMode}
              selectMode={selectMode}
              selectedIndices={selectedIndices}
              searchQuery={searchQuery}
              showFavoritesOnly={showFavoritesOnly}
              hasFavorites={hasFavorites}
              hasMoreHistory={hasMoreHistory}
              copiedText={copiedText}
              speakingText={speakingText}
              sourceLang={sourceLang}
              targetLang={targetLang}
              isListening={isListening}
              isTranslating={isTranslating}
              liveText={liveText}
              translatedText={translatedText}
              lastDetectedLang={lastDetectedLang}
              skeletonAnim={skeletonAnim}
              autoScroll={settings.autoScroll}
              phraseOfTheDay={phraseOfTheDay}
              onSearchChange={setSearchQuery}
              onToggleFavoritesOnly={toggleFavoritesOnly}
              onLoadMoreHistory={loadMoreHistory}
              onToggleSelectItem={toggleSelectItem}
              onDeleteHistoryItem={deleteHistoryItem}
              onCopyToClipboard={copyToClipboard}
              onSpeakText={speakText}
              onToggleFavorite={toggleFavorite}
              onRetryTranslation={retryTranslation}
              onCompareTranslation={compareTranslation}
              onCorrection={setCorrectionPrompt}
              onWordLongPress={lookupWordAlternatives}
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
            <ControlsPanel
              colors={colors}
              isLandscape={isLandscape}
              isListening={isListening}
              isTranslating={isTranslating}
              conversationMode={conversationMode}
              activeSpeaker={activeSpeakerRef.current}
              history={history}
              selectMode={selectMode}
              selectedCount={selectedIndices.size}
              typedText={typedText}
              typedPreview={typedPreview}
              copiedText={copiedText}
              sourceLangName={sourceLang.name}
              targetLangName={targetLang.name}
              silenceTimeout={settings.silenceTimeout}
              pulseAnim={pulseAnim}
              pulseOpacity={pulseOpacity}
              onClearHistory={clearHistory}
              onEnterSelectMode={() => setSelectMode(true)}
              onExitSelectMode={exitSelectMode}
              onExportSelected={exportSelected}
              onDeleteSelected={deleteSelected}
              onShowExportPicker={showExportPicker}
              onStartListening={startListening}
              onStopListening={stopListening}
              onStartListeningAs={startListeningAs}
              onOpenSplitScreen={() => {
                if (isListening) stopListening();
                setShowSplitScreen(true);
              }}
              onTypedTextChange={setTypedText}
              onSubmitTypedText={submitTypedText}
              onCopyToClipboard={copyToClipboard}
            />
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
  undoToast: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, marginBottom: 8, borderWidth: 1 },
  undoToastText: { fontSize: 14, fontWeight: "500", flex: 1 },
  undoButton: { marginLeft: 12, paddingVertical: 4, paddingHorizontal: 12 },
  undoButtonText: { fontSize: 14, fontWeight: "700" },
  // Landscape overrides
  containerLandscape: { paddingHorizontal: 40, paddingTop: 4 },
  headerRowLandscape: { marginBottom: 8 },
  titleLandscape: { fontSize: 20 },
});
