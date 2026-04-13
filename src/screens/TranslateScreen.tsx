import React, { useState, useReducer, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Keyboard,
  KeyboardAvoidingView,
  UIManager,
  useWindowDimensions,
} from "react-native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

import { notifyWarning } from "../services/haptics";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useHistoryActions } from "../hooks/useHistoryActions";
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
  LANGUAGES,
  LANGUAGE_MAP,
} from "../services/translation";
import { logger } from "../services/logger";
import { PHRASE_CATEGORIES, getPhraseOfTheDay } from "../services/offlinePhrases";
import { FONT_SIZE_SCALES } from "../components/SettingsModal";
import { useRoute } from "@react-navigation/native";
import { useSettings } from "../contexts/SettingsContext";
import { useLanguage } from "../contexts/LanguageContext";
import { useGlossary } from "../contexts/GlossaryContext";
import { useTranslationData } from "../contexts/TranslationDataContext";
import { useStreak } from "../contexts/StreakContext";
import { useOfflineQueue } from "../contexts/OfflineQueueContext";
import { useTheme } from "../contexts/ThemeContext";
import type { HistoryItem } from "../types";
import type { RootTabParamList } from "../navigation/types";

// Consolidated UI panel state to reduce useState count
type PanelState = {
  conversationMode: boolean;
  showFavoritesOnly: boolean;
  showSplitScreen: boolean;
  showPlayback: boolean;
};

type PanelAction =
  | { type: "TOGGLE_CONVERSATION_MODE" }
  | { type: "TOGGLE_FAVORITES_ONLY" }
  | { type: "SET_SPLIT_SCREEN"; value: boolean }
  | { type: "SET_PLAYBACK"; value: boolean };

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "TOGGLE_CONVERSATION_MODE":
      return { ...state, conversationMode: !state.conversationMode };
    case "TOGGLE_FAVORITES_ONLY":
      return { ...state, showFavoritesOnly: !state.showFavoritesOnly };
    case "SET_SPLIT_SCREEN":
      return { ...state, showSplitScreen: action.value };
    case "SET_PLAYBACK":
      return { ...state, showPlayback: action.value };
  }
}

const INITIAL_PANEL_STATE: PanelState = {
  conversationMode: false,
  showFavoritesOnly: false,
  showSplitScreen: false,
  showPlayback: false,
};

export default function TranslateScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const { settings, reduceMotion, maybeRequestReview } = useSettings();
  const { sourceLang, targetLang, setSourceLang, setTargetLang, swapLanguages, recentLangCodes, trackRecentLang, savedPairs, isCurrentPairSaved, toggleSavePair, applyPair, removeSavedPair } = useLanguage();
  const { glossaryLookup } = useGlossary();
  const { history, setHistory, hasMoreHistory, loadMoreHistory, updateWidgetData } = useTranslationData();
  const { updateStreak } = useStreak();
  const { isOffline, queueLength, addToOfflineQueue, registerOnTranslated } = useOfflineQueue();
  const { colors } = useTheme();
  const route = useRoute<{ key: string; name: "Translate"; params?: RootTabParamList["Translate"] }>();

  // Register callback for when offline queue items complete translation
  useEffect(() => {
    registerOnTranslated((original, translatedText) => {
      setHistory((prev) => {
        const pendingIdx = prev.findIndex((h) => h.pending && h.original === original);
        if (pendingIdx !== -1) {
          const updated = [...prev];
          updated[pendingIdx] = { original, translated: translatedText };
          return updated;
        }
        return [...prev, { original, translated: translatedText, timestamp: Date.now() }];
      });
    });
  }, [registerOnTranslated, setHistory]);

  // Handle deep link params (e.g. livetranslator://translate/en/es)
  useEffect(() => {
    const params = route.params;
    if (!params) return;
    if (params.sourceLang) {
      const src = LANGUAGE_MAP.get(params.sourceLang);
      if (src) setSourceLang(src);
    }
    if (params.targetLang) {
      const tgt = LANGUAGE_MAP.get(params.targetLang);
      if (tgt) setTargetLang(tgt);
    }
  }, [route.params, setSourceLang, setTargetLang]);

  const fontScale = FONT_SIZE_SCALES[settings.fontSize];
  const dynamicFontSizes = useMemo(() => ({
    original: { fontSize: Math.round(16 * fontScale) },
    translated: { fontSize: Math.round(16 * fontScale) },
    liveOriginal: { fontSize: Math.round(18 * fontScale) },
    liveTranslated: { fontSize: Math.round(20 * fontScale) },
    chatText: { fontSize: Math.round(15 * fontScale) },
  }), [fontScale]);

  const [errorMessage, setErrorMessage] = useState("");
  const [panel, dispatchPanel] = useReducer(panelReducer, INITIAL_PANEL_STATE);
  const { conversationMode, showFavoritesOnly, showSplitScreen, showPlayback } = panel;
  const activeSpeakerRef = useRef<"A" | "B">("A");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showOnlineBanner, setShowOnlineBanner] = useState(false);
  const wasOfflineRef = useRef(false);

  const errorDismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search query to avoid filtering on every keystroke
  useEffect(() => {
    if (!searchQuery.trim()) {
      setDebouncedSearch("");
      return;
    }
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  // showFavoritesOnly, showSplitScreen, showPlayback, conversationMode now in panelReducer

  const historyActions = useHistoryActions({
    history,
    setHistory,
    translationProvider: settings.translationProvider,
    sourceLangCode: sourceLang.code,
    targetLangCode: targetLang.code,
    speechRate: settings.speechRate,
    showError,
  });

  const { copiedText, speakingText, selectMode, setSelectMode, selectedIndices, deletedItem, compareData, setCompareData, correctionPrompt, setCorrectionPrompt, wordAltData, setWordAltData, copyToClipboard, speakText, deleteHistoryItem, undoDelete, toggleFavorite, retryTranslation, clearHistory, showExportPicker, toggleSelectItem, exitSelectMode, deleteSelected, exportSelected, submitCorrection, lookupWordAlternatives, compareTranslation } = historyActions;

  const [typedText, setTypedText] = useState("");
  const [typedPreview, setTypedPreview] = useState("");
  const typedTranslateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (errorDismissTimeout.current) clearTimeout(errorDismissTimeout.current);
    };
  }, []);

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

  // Translate-as-you-type with AbortController to cancel in-flight requests
  const typedAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (typedTranslateTimer.current) clearTimeout(typedTranslateTimer.current);
    typedAbortRef.current?.abort();
    const text = typedText.trim();
    if (!text || isListening) {
      setTypedPreview("");
      return;
    }
    typedTranslateTimer.current = setTimeout(async () => {
      const glossaryMatch = glossaryLookup(text, sourceLang.code, targetLang.code);
      if (glossaryMatch) {
        setTypedPreview(glossaryMatch);
        return;
      }
      const controller = new AbortController();
      typedAbortRef.current = controller;
      try {
        const result = await translateText(text, sourceLang.code, targetLang.code, { signal: controller.signal, provider: settings.translationProvider });
        if (!controller.signal.aborted) {
          setTypedPreview(result.translatedText);
        }
      } catch (err: unknown) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          logger.warn("Translation", "Type-ahead translation failed", err);
          if (!controller.signal.aborted) {
            setTypedPreview("");
            const msg = err instanceof Error ? err.message : "Translation preview failed";
            showError(msg);
          }
        }
      }
    }, 500);
    return () => {
      if (typedTranslateTimer.current) clearTimeout(typedTranslateTimer.current);
      typedAbortRef.current?.abort();
    };
  }, [typedText, sourceLang.code, targetLang.code, settings.translationProvider, glossaryLookup, isListening, showError]);

  const submitTypedText = useCallback(async () => {
    const text = typedText.trim();
    if (!text) return;
    Keyboard.dismiss();
    setTypedText("");
    setTypedPreview("");

    if (isOffline) {
      addToOfflineQueue({ text, sourceLang: sourceLang.code, targetLang: targetLang.code, timestamp: Date.now() });
      setHistory((prev) => [...prev, { original: text, translated: "Queued — will translate when online", pending: true, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code, timestamp: Date.now() }]);
      notifyWarning();
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
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      filtered = filtered.filter((item) => item.original.toLowerCase().includes(q) || item.translated.toLowerCase().includes(q));
    }
    return filtered;
  }, [history, debouncedSearch, showFavoritesOnly]);

  const hasFavorites = useMemo(() => history.some((item) => item.favorited), [history]);

  // Memoize phrase of the day (only changes when target language changes)
  const phraseOfTheDay = useMemo(() => {
    const potd = getPhraseOfTheDay(targetLang.code);
    if (!potd) return null;
    const categoryInfo = PHRASE_CATEGORIES.find((c) => c.key === potd.category);
    return { potd, categoryInfo };
  }, [targetLang.code]);

  const toggleFavoritesOnly = useCallback(() => dispatchPanel({ type: "TOGGLE_FAVORITES_ONLY" }), []);

  // Stable callbacks for ControlsPanel (React.memo) — prevents re-renders from unstable inline closures
  const onEnterSelectMode = useCallback(() => setSelectMode(true), [setSelectMode]);
  const onOpenSplitScreen = useCallback(() => {
    if (isListening) stopListening();
    dispatchPanel({ type: "SET_SPLIT_SCREEN", value: true });
  }, [isListening, stopListening]);
  const onCloseSplitScreen = useCallback(() => dispatchPanel({ type: "SET_SPLIT_SCREEN", value: false }), []);
  const onOpenPlayback = useCallback(() => dispatchPanel({ type: "SET_PLAYBACK", value: true }), []);
  const onClosePlayback = useCallback(() => dispatchPanel({ type: "SET_PLAYBACK", value: false }), []);

  const renderSavedPairItem = useCallback(({ item }: { item: { sourceCode: string; targetCode: string } }) => {
    const isActive = item.sourceCode === sourceLang.code && item.targetCode === targetLang.code;
    const srcLang = LANGUAGE_MAP.get(item.sourceCode);
    const tgtLang_ = LANGUAGE_MAP.get(item.targetCode);
    const srcName = srcLang?.name || item.sourceCode;
    const tgtName = tgtLang_?.name || item.targetCode;
    const srcFlag = srcLang?.flag || "";
    const tgtFlag = tgtLang_?.flag || "";
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
                onPress={() => dispatchPanel({ type: "TOGGLE_CONVERSATION_MODE" })}
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
                  onPress={onOpenPlayback}
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
                  No connection{queueLength > 0 ? ` — ${queueLength} queued` : " — type to queue translations"}
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
                  Back online{queueLength > 0 ? ` — processing ${queueLength} queued translation${queueLength === 1 ? "" : "s"}` : ""}
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
              onEnterSelectMode={onEnterSelectMode}
              onExitSelectMode={exitSelectMode}
              onExportSelected={exportSelected}
              onDeleteSelected={deleteSelected}
              onShowExportPicker={showExportPicker}
              onStartListening={startListening}
              onStopListening={stopListening}
              onStartListeningAs={startListeningAs}
              onOpenSplitScreen={onOpenSplitScreen}
              onTypedTextChange={setTypedText}
              onSubmitTypedText={submitTypedText}
              onCopyToClipboard={copyToClipboard}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <SplitConversation visible={showSplitScreen} onClose={onCloseSplitScreen} />
      <ConversationPlayback visible={showPlayback} onClose={onClosePlayback} />
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
