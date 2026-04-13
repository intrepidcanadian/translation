import { useState, useRef, useCallback, useEffect } from "react";
import { Alert, Share, LayoutAnimation } from "react-native";
import * as Speech from "expo-speech";
import * as Clipboard from "expo-clipboard";
import { impactLight, impactMedium, notifySuccess, notifyWarning } from "../services/haptics";
import { translateText, getWordAlternatives, type WordAlternative } from "../services/translation";
import type { TranslationProvider } from "../services/translation";
import type { HistoryItem } from "../types";

interface UseHistoryActionsOptions {
  history: HistoryItem[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  translationProvider: TranslationProvider;
  sourceLangCode: string;
  targetLangCode: string;
  speechRate: number;
  showError: (msg: string) => void;
}

export function useHistoryActions({
  history,
  setHistory,
  translationProvider,
  sourceLangCode,
  targetLangCode,
  speechRate,
  showError,
}: UseHistoryActionsOptions) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [deletedItem, setDeletedItem] = useState<{ item: HistoryItem; index: number } | null>(null);
  const undoTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [compareData, setCompareData] = useState<{
    original: string;
    results: Array<{ provider: string; text: string; loading?: boolean }>;
  } | null>(null);

  const [correctionPrompt, setCorrectionPrompt] = useState<{
    index: number;
    original: string;
    translated: string;
  } | null>(null);

  const [wordAltData, setWordAltData] = useState<{
    word: string;
    sourceLang: string;
    targetLang: string;
    alternatives: WordAlternative[];
    loading: boolean;
  } | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (undoTimeout.current) clearTimeout(undoTimeout.current);
      Speech.stop();
    };
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    notifySuccess();
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
        rate: speechRate,
        onDone: () => setSpeakingText(null),
        onStopped: () => setSpeakingText(null),
        onError: () => setSpeakingText(null),
      });
    },
    [speakingText, speechRate]
  );

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
      const result = await translateText(item.original, item.sourceLangCode, item.targetLangCode, { signal: controller.signal, provider: translationProvider });
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
  }, [history, translationProvider, showError, setHistory]);

  const clearHistory = useCallback(() => {
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
  }, [history.length, setHistory]);

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

  const submitCorrection = useCallback((correctedText: string) => {
    if (!correctionPrompt || !correctedText.trim()) return;
    const { index } = correctionPrompt;
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
    const providers = allProviders.filter((p) => p.key !== translationProvider);
    const currentLabel = allProviders.find((p) => p.key === translationProvider)?.label || translationProvider;
    const initialResults = [
      { provider: currentLabel, text: currentTranslation },
      ...providers.map((p) => ({ provider: p.label, text: "", loading: true })),
    ];
    setCompareData({ original, results: initialResults });

    for (const p of providers) {
      try {
        const result = await translateText(original, sourceLangCode, targetLangCode, { provider: p.key });
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
  }, [translationProvider, sourceLangCode, targetLangCode]);

  return {
    // State
    copiedText,
    speakingText,
    selectMode,
    setSelectMode,
    selectedIndices,
    deletedItem,
    compareData,
    setCompareData,
    correctionPrompt,
    setCorrectionPrompt,
    wordAltData,
    setWordAltData,
    // Actions
    copyToClipboard,
    speakText,
    deleteHistoryItem,
    undoDelete,
    toggleFavorite,
    retryTranslation,
    clearHistory,
    shareHistory,
    showExportPicker,
    toggleSelectItem,
    exitSelectMode,
    deleteSelected,
    exportSelected,
    submitCorrection,
    lookupWordAlternatives,
    compareTranslation,
  };
}
