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
  PanResponder,
  Animated,
  Easing,
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
import PassengerView from "../components/PassengerView";
import VisualCardsModal from "../components/VisualCardsModal";
import TranslationShareCard from "../components/TranslationShareCard";
import PhrasebookModal from "../components/PhrasebookModal";
import GlassBackdrop from "../components/GlassBackdrop";
import { HistoryActionsProvider, type HistoryActions } from "../contexts/HistoryActionsContext";
import { HistoryDisplayProvider, type HistoryDisplayState } from "../contexts/HistoryDisplayContext";
import { SelectStateProvider, type SelectState } from "../contexts/SelectStateContext";
import {
  translateText,
  LANGUAGES,
  LANGUAGE_MAP,
  type Language,
} from "../services/translation";
import { logger } from "../services/logger";
import { increment as incrementTelemetry } from "../services/telemetry";
import { PHRASE_CATEGORIES, getPhraseOfTheDay, offlineTranslate } from "../services/offlinePhrases";
import { FONT_SIZE_SCALES } from "../components/SettingsModal";
import { useRoute } from "@react-navigation/native";
import { useSettings } from "../contexts/SettingsContext";
import { useLanguage, useLanguagePairs } from "../contexts/LanguageContext";
import { useGlossary } from "../contexts/GlossaryContext";
import { useTranslationData } from "../contexts/TranslationDataContext";
import { useStreak } from "../contexts/StreakContext";
import { useOfflineQueue } from "../contexts/OfflineQueueContext";
import { useTheme } from "../contexts/ThemeContext";
import { newHistoryId, type HistoryItem } from "../types";
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
    default: {
      const _exhaustive: never = action;
      return state;
    }
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
  const { sourceLang, targetLang, setSourceLang, setTargetLang, swapLanguages, applyPair } = useLanguage();
  const { recentLangCodes, trackRecentLang, savedPairs, addSavedPair, removeSavedPair } = useLanguagePairs();
  const isCurrentPairSaved = useMemo(
    () => savedPairs.some((p) => p.sourceCode === sourceLang.code && p.targetCode === targetLang.code),
    [savedPairs, sourceLang.code, targetLang.code]
  );
  // Snapshot-ref pattern so toggleSavePair has an empty deps array and stays
  // identity-stable — otherwise every savedPairs / sourceLang / targetLang change
  // re-creates the callback and breaks React.memo on downstream components that
  // receive it as a prop.
  const toggleSavePairRef = useRef({ sourceCode: sourceLang.code, targetCode: targetLang.code, isCurrentPairSaved, addSavedPair, removeSavedPair });
  toggleSavePairRef.current = { sourceCode: sourceLang.code, targetCode: targetLang.code, isCurrentPairSaved, addSavedPair, removeSavedPair };
  const toggleSavePair = useCallback(() => {
    const snap = toggleSavePairRef.current;
    if (snap.sourceCode === "autodetect") return;
    if (snap.isCurrentPairSaved) {
      snap.removeSavedPair(snap.sourceCode, snap.targetCode);
    } else {
      snap.addSavedPair(snap.sourceCode, snap.targetCode);
    }
  }, []);
  const { glossaryLookup } = useGlossary();
  const { history, setHistory, hasMoreHistory, loadMoreHistory, updateWidgetData } = useTranslationData();
  const { updateStreak } = useStreak();
  const { isOffline, queueLength, isProcessingQueue: isOfflineQueueProcessing, addToOfflineQueue, registerOnTranslated } = useOfflineQueue();
  const { colors } = useTheme();
  const route = useRoute<{ key: string; name: "Translate"; params?: RootTabParamList["Translate"] }>();

  // Register callback for when offline queue items complete translation
  useEffect(() => {
    const unsubscribe = registerOnTranslated((original, translatedText) => {
      setHistory((prev) => {
        const pendingIdx = prev.findIndex((h) => h.status === "pending" && h.original === original);
        if (pendingIdx !== -1) {
          const updated = [...prev];
          updated[pendingIdx] = { ...updated[pendingIdx], original, translated: translatedText, status: "ok" as const };
          return updated;
        }
        return [...prev, { id: newHistoryId(), original, translated: translatedText, status: "ok" as const, timestamp: Date.now() }];
      });
    });
    return unsubscribe;
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

  // #166: rotate the ⟳ glyph while the offline queue is actively draining so
  // "processing" is visually distinct from the static "back online ✓" state.
  // Respects system Reduce Motion — when disabled, the icon stays static and
  // users still get the textual "Processing N queued translation…" line.
  const processingRotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isOfflineQueueProcessing || reduceMotion) {
      processingRotation.stopAnimation();
      processingRotation.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(processingRotation, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [isOfflineQueueProcessing, reduceMotion, processingRotation]);
  const processingSpin = processingRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

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
      { id: newHistoryId(), original, translated, status: "ok" as const, speaker, confidence, detectedLang, sourceLangCode: sourceLang.code, targetLangCode: targetLang.code, timestamp: Date.now() },
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

  const { isListening, liveText, setLiveText, translatedText, isTranslating, setIsTranslating, lastDetectedLang, pulseAnim, pulseOpacity, skeletonAnim, startListening: startListeningBase, startListeningAs, stopListening, abortControllerRef, likelyMicMuted } = speech;

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
  const [passengerViewIndex, setPassengerViewIndex] = useState<number | null>(null);
  const [showVisualCards, setShowVisualCards] = useState(false);
  const [showPhrasebook, setShowPhrasebook] = useState(false);
  const [shareCardIndex, setShareCardIndex] = useState<number | null>(null);
  // Memoize the share-card item lookup so TranslationShareCard receives stable
  // field references and skips re-renders when unrelated history updates happen.
  // Previously the JSX did history[shareCardIndex].original/.translated/… lookups
  // six times inline on every render while the modal was open.
  const shareCardItem = useMemo(
    () => (shareCardIndex !== null ? history[shareCardIndex] ?? null : null),
    [shareCardIndex, history]
  );
  const typedTranslateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gesture shortcuts: swipe up → phrasebook, swipe down → mic toggle, two-finger tap → swap languages
  const gestureResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (evt) => {
      // Two-finger tap to swap languages
      if (evt.nativeEvent.touches.length >= 2) return true;
      return false;
    },
    onMoveShouldSetPanResponder: (_evt, gestureState) => {
      // Only capture vertical swipes (not horizontal — those are for SwipeableRow)
      return !isListening && Math.abs(gestureState.dy) > 30 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5;
    },
    onPanResponderRelease: (evt, gestureState) => {
      // Two-finger tap
      if (evt.nativeEvent.touches.length >= 1 && Math.abs(gestureState.dy) < 10 && Math.abs(gestureState.dx) < 10) {
        swapLanguages();
        return;
      }
      // Swipe up → open phrasebook
      if (gestureState.dy < -80) {
        setShowPhrasebook(true);
        return;
      }
      // Swipe down → toggle mic
      if (gestureState.dy > 80) {
        if (isListening) {
          stopListening();
        } else {
          startListening();
        }
      }
    },
  }), [isListening, swapLanguages, stopListening, startListening]);

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

  // Translate-as-you-type with AbortController to cancel in-flight requests.
  // Error dedup: the debounce fires ~every 500ms as the user types, so a
  // steadily-failing network would surface the same error banner repeatedly
  // and drown out other feedback. We keep the last error signature + timestamp
  // and skip showError() if we've already warned about the same issue within
  // the cooldown window.
  const typedAbortRef = useRef<AbortController | null>(null);
  const typeAheadLastErrorRef = useRef<{ message: string; at: number } | null>(null);
  const TYPE_AHEAD_ERROR_COOLDOWN_MS = 10_000;
  useEffect(() => {
    if (typedTranslateTimer.current) clearTimeout(typedTranslateTimer.current);
    typedAbortRef.current?.abort();
    const text = typedText.trim();
    // Guard: skip type-ahead for empty / whitespace / single-character input to
    // save API quota and avoid noisy single-letter "translations".
    if (!text || text.length < 2 || isListening) {
      setTypedPreview("");
      return;
    }
    typedTranslateTimer.current = setTimeout(async () => {
      // Glossary short-circuit — works offline, no network needed.
      const glossaryMatch = glossaryLookup(text, sourceLang.code, targetLang.code);
      if (glossaryMatch) {
        setTypedPreview(glossaryMatch);
        logger.debug("Translation", "type-ahead: glossary hit", { length: text.length });
        incrementTelemetry("typeAhead.glossary");
        return;
      }
      // Offline short-circuit — when disconnected, try the offline phrase
      // dictionary directly. If nothing matches, show nothing instead of
      // firing a network request that will fail and spam the error banner.
      if (isOffline) {
        const offlineHit = offlineTranslate(text, sourceLang.code, targetLang.code);
        setTypedPreview(offlineHit ?? "");
        logger.debug(
          "Translation",
          offlineHit ? "type-ahead: offline dict hit" : "type-ahead: offline dict miss",
          { length: text.length }
        );
        incrementTelemetry(offlineHit ? "typeAhead.offlineHit" : "typeAhead.offlineMiss");
        return;
      }
      const controller = new AbortController();
      typedAbortRef.current = controller;
      logger.debug("Translation", "type-ahead: network request", {
        length: text.length,
        provider: settings.translationProvider,
      });
      incrementTelemetry("typeAhead.network");
      try {
        const result = await translateText(text, sourceLang.code, targetLang.code, { signal: controller.signal, provider: settings.translationProvider });
        if (!controller.signal.aborted) {
          setTypedPreview(result.translatedText);
          // Successful request clears any lingering error so the next genuine
          // failure can surface immediately instead of being suppressed by
          // the cooldown window.
          typeAheadLastErrorRef.current = null;
        }
      } catch (err: unknown) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          logger.warn("Translation", "Type-ahead translation failed", err);
          incrementTelemetry("typeAhead.error");
          if (!controller.signal.aborted) {
            setTypedPreview("");
            const msg = err instanceof Error ? err.message : "Translation preview failed";
            // Dedup: don't bombard the banner with the same message every
            // 500ms. Surface the first occurrence, then wait out the cooldown
            // before showing it again. A different error message breaks
            // through immediately (different root cause).
            const prev = typeAheadLastErrorRef.current;
            const now = Date.now();
            const isDuplicate = prev && prev.message === msg && now - prev.at < TYPE_AHEAD_ERROR_COOLDOWN_MS;
            if (!isDuplicate) {
              typeAheadLastErrorRef.current = { message: msg, at: now };
              showError(msg);
            }
          }
        }
      }
    }, 500);
    return () => {
      if (typedTranslateTimer.current) clearTimeout(typedTranslateTimer.current);
      typedAbortRef.current?.abort();
    };
  }, [typedText, sourceLang.code, targetLang.code, settings.translationProvider, glossaryLookup, isListening, isOffline, showError]);

  // Stable ref snapshot so submitTypedText can have an empty useCallback deps array.
  // Previously submitTypedText depended on 12 values, breaking React.memo downstream
  // because its identity changed on almost every render.
  const submitTypedTextRef = useRef({
    typedText,
    sourceLangCode: sourceLang.code,
    targetLangCode: targetLang.code,
    isOffline,
    addToOfflineQueue,
    glossaryLookup,
    translationProvider: settings.translationProvider,
    maybeRequestReview,
    updateStreak,
    updateWidgetData,
    setHistory,
    showError,
  });
  submitTypedTextRef.current = {
    typedText,
    sourceLangCode: sourceLang.code,
    targetLangCode: targetLang.code,
    isOffline,
    addToOfflineQueue,
    glossaryLookup,
    translationProvider: settings.translationProvider,
    maybeRequestReview,
    updateStreak,
    updateWidgetData,
    setHistory,
    showError,
  };

  const submitTypedText = useCallback(async () => {
    const snap = submitTypedTextRef.current;
    const text = snap.typedText.trim();
    if (!text) return;
    Keyboard.dismiss();
    setTypedText("");
    setTypedPreview("");

    if (snap.isOffline) {
      snap.addToOfflineQueue({ text, sourceLang: snap.sourceLangCode, targetLang: snap.targetLangCode, timestamp: Date.now() });
      snap.setHistory((prev) => [...prev, { id: newHistoryId(), original: text, translated: "Queued — will translate when online", status: "pending" as const, sourceLangCode: snap.sourceLangCode, targetLangCode: snap.targetLangCode, timestamp: Date.now() }]);
      notifyWarning();
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsTranslating(true);
    setLiveText(text);
    try {
      const glossaryMatch = snap.glossaryLookup(text, snap.sourceLangCode, snap.targetLangCode);
      const result = glossaryMatch
        ? { translatedText: glossaryMatch, confidence: 1.0 }
        : await translateText(text, snap.sourceLangCode, snap.targetLangCode, { signal: controller.signal, provider: snap.translationProvider });
      if (!controller.signal.aborted) {
        snap.setHistory((prev) => [...prev, { id: newHistoryId(), original: text, translated: result.translatedText, status: "ok" as const, confidence: result.confidence, sourceLangCode: snap.sourceLangCode, targetLangCode: snap.targetLangCode, detectedLang: result.detectedLanguage, timestamp: Date.now() }]);
        snap.maybeRequestReview();
        snap.updateStreak();
        snap.updateWidgetData(text, result.translatedText, snap.sourceLangCode, snap.targetLangCode);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : "Translation failed";
        snap.showError(msg);
        snap.setHistory((prev) => [...prev, { id: newHistoryId(), original: text, translated: msg, status: "error" as const, sourceLangCode: snap.sourceLangCode, targetLangCode: snap.targetLangCode, timestamp: Date.now() }]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsTranslating(false);
        setLiveText("");
      }
    }
  }, [abortControllerRef, setIsTranslating, setLiveText]);

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
  // Snapshot ref so onOpenSplitScreen can be memoized with empty deps — stopListening
  // is already stable, but isListening flipped this callback's identity on every
  // mic toggle, breaking React.memo on ControlsPanel.
  const isListeningRef = useRef(isListening);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  const onOpenSplitScreen = useCallback(() => {
    if (isListeningRef.current) stopListening();
    dispatchPanel({ type: "SET_SPLIT_SCREEN", value: true });
  }, [stopListening]);
  const onCloseSplitScreen = useCallback(() => dispatchPanel({ type: "SET_SPLIT_SCREEN", value: false }), []);
  const onOpenPlayback = useCallback(() => dispatchPanel({ type: "SET_PLAYBACK", value: true }), []);
  const onClosePlayback = useCallback(() => dispatchPanel({ type: "SET_PLAYBACK", value: false }), []);

  // Stable close handlers for modals — inline closures would break React.memo
  const onCloseCompare = useCallback(() => setCompareData(null), [setCompareData]);
  const onCloseWordAlt = useCallback(() => setWordAltData(null), [setWordAltData]);
  const onCloseCorrection = useCallback(() => setCorrectionPrompt(null), [setCorrectionPrompt]);
  const onClosePassengerView = useCallback(() => setPassengerViewIndex(null), []);
  const onCloseVisualCards = useCallback(() => setShowVisualCards(false), []);
  const onClosePhrasebook = useCallback(() => setShowPhrasebook(false), []);
  const onCloseShareCard = useCallback(() => setShareCardIndex(null), []);

  // Display state for HistoryList — published via context so HistoryList doesn't
  // have to accept separate props for each filter/display flag. Selection state
  // is split into its own SelectStateContext so checkbox toggles don't bump
  // this context and force non-selection consumers to re-render.
  const historyDisplayValue = useMemo<HistoryDisplayState>(() => ({
    searchQuery,
    showFavoritesOnly,
    hasFavorites,
    hasMoreHistory,
    confidenceThreshold: settings.confidenceThreshold,
    autoScroll: settings.autoScroll,
    showRomanization: settings.showRomanization,
  }), [
    searchQuery,
    showFavoritesOnly,
    hasFavorites,
    hasMoreHistory,
    settings.confidenceThreshold,
    settings.autoScroll,
    settings.showRomanization,
  ]);

  const selectStateValue = useMemo<SelectState>(() => ({
    selectMode,
    selectedIndices,
  }), [selectMode, selectedIndices]);

  // Memoized history actions for context — avoids re-creating object each render
  const historyActionsValue = useMemo<HistoryActions>(() => ({
    onDeleteHistoryItem: deleteHistoryItem,
    onCopyToClipboard: copyToClipboard,
    onSpeakText: speakText,
    onToggleFavorite: toggleFavorite,
    onRetryTranslation: retryTranslation,
    onCompareTranslation: compareTranslation,
    onCorrection: setCorrectionPrompt,
    onWordLongPress: lookupWordAlternatives,
    onShowPassenger: setPassengerViewIndex,
    onShareCard: setShareCardIndex,
    onToggleSelectItem: toggleSelectItem,
    onSearchChange: setSearchQuery,
    onToggleFavoritesOnly: toggleFavoritesOnly,
    onLoadMoreHistory: loadMoreHistory,
  }), [deleteHistoryItem, copyToClipboard, speakText, toggleFavorite, retryTranslation, compareTranslation, setCorrectionPrompt, lookupWordAlternatives, toggleSelectItem, toggleFavoritesOnly, loadMoreHistory]);

  // Stable callbacks for LanguagePicker (React.memo) — prevents re-renders from inline closures
  const onSelectSourceLang = useCallback((lang: Language) => {
    setSourceLang(lang);
    trackRecentLang(lang.code);
  }, [setSourceLang, trackRecentLang]);

  const onSelectTargetLang = useCallback((lang: Language) => {
    setTargetLang(lang);
    trackRecentLang(lang.code);
  }, [setTargetLang, trackRecentLang]);

  // Same snapshot-ref pattern as toggleSavePair so FlatList doesn't invalidate
  // every row when savedPairs / language / theme color changes.
  const savedPairRenderRef = useRef({
    sourceCode: sourceLang.code,
    targetCode: targetLang.code,
    colors,
    applyPair,
    removeSavedPair,
  });
  savedPairRenderRef.current = {
    sourceCode: sourceLang.code,
    targetCode: targetLang.code,
    colors,
    applyPair,
    removeSavedPair,
  };
  const renderSavedPairItem = useCallback(({ item }: { item: { sourceCode: string; targetCode: string } }) => {
    const snap = savedPairRenderRef.current;
    const isActive = item.sourceCode === snap.sourceCode && item.targetCode === snap.targetCode;
    const srcLang = LANGUAGE_MAP.get(item.sourceCode);
    const tgtLang_ = LANGUAGE_MAP.get(item.targetCode);
    const srcName = srcLang?.name || item.sourceCode;
    const tgtName = tgtLang_?.name || item.targetCode;
    const srcFlag = srcLang?.flag || "";
    const tgtFlag = tgtLang_?.flag || "";
    return (
      <TouchableOpacity
        style={[styles.savedPairPill, { backgroundColor: snap.colors.cardBg, borderColor: isActive ? snap.colors.primary : snap.colors.border }, isActive && styles.savedPairPillActive]}
        onPress={() => snap.applyPair(item.sourceCode, item.targetCode)}
        onLongPress={() => snap.removeSavedPair(item.sourceCode, item.targetCode)}
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${srcName} to ${tgtName}. Long press to remove.`}
      >
        <Text style={[styles.savedPairText, { color: isActive ? snap.colors.primary : snap.colors.mutedText }]}>
          {srcFlag} {srcName.slice(0, 3)} → {tgtFlag} {tgtName.slice(0, 3)}
        </Text>
      </TouchableOpacity>
    );
  }, []);

  return (
    <>
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.safeBg }]}>
        <StatusBar barStyle={colors.statusBar} />
        {/* Glass aurora backdrop sits behind everything in the safe area
            so all the translucent `glassBg` surfaces below have something
            colorful to soak up. Pure-JS, no native deps. */}
        <GlassBackdrop />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.container, isLandscape && styles.containerLandscape]} {...gestureResponder.panHandlers}>
            {/* Header — title removed (took too much vertical real estate);
                Chat toggle and Play button now align right in a compact row. */}
            <View style={[styles.headerRow, isLandscape && styles.headerRowLandscape]}>
              <TouchableOpacity
                style={[styles.modeToggle, styles.glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }, conversationMode && { backgroundColor: colors.primary, borderColor: colors.primary }]}
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
                  style={[styles.modeToggle, styles.glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
                  onPress={onOpenPlayback}
                  accessibilityRole="button"
                  accessibilityLabel="View conversation playback"
                >
                  <Text style={[styles.modeToggleText, { color: colors.primary }]}>▶ Play</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Modals */}
            <ComparisonModal visible={!!compareData} data={compareData} onClose={onCloseCompare} onCopy={copyToClipboard} copiedText={copiedText} colors={colors} />
            <WordAlternativesModal visible={wordAltData !== null} data={wordAltData} onClose={onCloseWordAlt} onCopy={copyToClipboard} copiedText={copiedText} colors={colors} />
            <CorrectionModal visible={correctionPrompt !== null} data={correctionPrompt} onClose={onCloseCorrection} onSubmit={submitCorrection} colors={colors} />

            {/* Language selectors */}
            <View style={styles.langRow}>
              <LanguagePicker
                label="From"
                selected={sourceLang}
                onSelect={onSelectSourceLang}
                showAutoDetect
                recentCodes={recentLangCodes}
                colors={colors}
              />
              <View style={styles.langMiddleButtons}>
                <TouchableOpacity
                  style={[styles.swapButton, styles.glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
                  onPress={swapLanguages}
                  accessibilityRole="button"
                  accessibilityLabel={`Swap languages. Currently translating from ${sourceLang.name} to ${targetLang.name}`}
                  accessibilityHint={`Swaps to translate from ${targetLang.name} to ${sourceLang.name}`}
                >
                  <Text style={[styles.swapIcon, { color: colors.primary }]}>⇄</Text>
                </TouchableOpacity>
                {sourceLang.code !== "autodetect" && (
                  <TouchableOpacity
                    style={[styles.savePairButton, styles.glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
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
                onSelect={onSelectTargetLang}
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

            {/* Connection restored / queue processing banner.
                #126: `isOfflineQueueProcessing` is now reactive, so the banner
                stays visible with a live "Processing…" state as long as the
                queue is actively draining — not just during the 4s show
                window. Once the queue is empty and processing stops, the
                banner reverts to the plain "Back online" confirmation and
                auto-dismisses on its normal timer. */}
            {(showOnlineBanner || isOfflineQueueProcessing) && !isOffline && (
              <View
                style={[styles.offlineBanner, { backgroundColor: colors.successBg, borderColor: colors.successText }]}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                accessibilityLabel={isOfflineQueueProcessing ? `Processing ${queueLength} queued translations` : "Connection restored"}
              >
                {isOfflineQueueProcessing ? (
                  <Animated.Text
                    style={[styles.offlineIcon, { transform: [{ rotate: processingSpin }] }]}
                    importantForAccessibility="no"
                  >
                    ⟳
                  </Animated.Text>
                ) : (
                  <Text style={styles.offlineIcon} importantForAccessibility="no">✓</Text>
                )}
                <Text style={[styles.offlineText, { color: colors.successText }]}>
                  {isOfflineQueueProcessing
                    ? `Processing ${queueLength} queued translation${queueLength === 1 ? "" : "s"}…`
                    : "Back online"}
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
            <HistoryActionsProvider value={historyActionsValue}>
              <HistoryDisplayProvider value={historyDisplayValue}>
                <SelectStateProvider value={selectStateValue}>
                <HistoryList
                  history={history}
                  filteredHistory={filteredHistory}
                  colors={colors}
                  dynamicFontSizes={dynamicFontSizes}
                  fontScale={fontScale}
                  conversationMode={conversationMode}
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
                  phraseOfTheDay={phraseOfTheDay}
                />
                </SelectStateProvider>
              </HistoryDisplayProvider>
            </HistoryActionsProvider>

            {/* Undo delete toast */}
            {deletedItem && (
              <View style={[styles.undoToast, styles.glassSurface, { backgroundColor: colors.glassBgStrong, borderColor: colors.glassBorder }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
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
              likelyMicMuted={likelyMicMuted}
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
              onOpenVisualCards={() => setShowVisualCards(true)}
              onTypedTextChange={setTypedText}
              onSubmitTypedText={submitTypedText}
              onCopyToClipboard={copyToClipboard}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <SplitConversation visible={showSplitScreen} onClose={onCloseSplitScreen} />
      <ConversationPlayback visible={showPlayback} onClose={onClosePlayback} />
      <PassengerView
        visible={passengerViewIndex !== null}
        onClose={onClosePassengerView}
        history={history}
        initialIndex={passengerViewIndex ?? 0}
        colors={colors}
        speechRate={settings.speechRate}
      />
      <VisualCardsModal
        visible={showVisualCards}
        onClose={onCloseVisualCards}
        colors={colors}
        passengerLang={targetLang.code === "autodetect" ? undefined : targetLang.code}
        speechRate={settings.speechRate}
      />
      <PhrasebookModal
        visible={showPhrasebook}
        onClose={onClosePhrasebook}
        sourceLangCode={sourceLang.code}
        targetLangCode={targetLang.code}
        colors={colors}
        onCopy={copyToClipboard}
        onSpeak={speakText}
      />
      {shareCardItem && (
        <TranslationShareCard
          visible
          onClose={onCloseShareCard}
          original={shareCardItem.original}
          translated={shareCardItem.translated}
          sourceLangCode={shareCardItem.sourceLangCode}
          targetLangCode={shareCardItem.targetLangCode}
          confidence={shareCardItem.confidence}
          colors={colors}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: Platform.OS === "android" ? 40 : 10 },
  // Title removed: row now just hosts the mode toggle (and optional Play
  // button), right-aligned, so we drop absolute positioning and shrink the
  // marginBottom from 20 to 8 to claim back the vertical space the title
  // used to take.
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: "800", textAlign: "center" },
  modeToggle: { borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 },
  // Shared frosted-pane look: 1px hairline border (color comes from
  // theme.glassBorder via inline style) + soft shadow that sells the
  // floating-above-aurora effect. Combined with `glassBg`/`glassBgStrong`
  // backgrounds and the GlassBackdrop layer behind the screen, this is
  // the closest we can get to real backdrop-blur without pulling in
  // expo-blur (which would force a native rebuild).
  glassSurface: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 3,
  },
  modeToggleText: { fontSize: 12, fontWeight: "700" },
  langRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, marginBottom: 20 },
  langMiddleButtons: { alignItems: "center", gap: 4, marginBottom: 0 },
  swapButton: { borderRadius: 12, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  swapIcon: { fontSize: 20, fontWeight: "700" },
  savePairButton: { borderRadius: 10, width: 32, height: 28, alignItems: "center", justifyContent: "center" },
  savePairIcon: { fontSize: 16, color: "#8888aa" },
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
