import { useState, useReducer, useRef, useCallback, useEffect } from "react";
import { Alert, Share, LayoutAnimation } from "react-native";
import * as Speech from "expo-speech";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { impactLight, impactMedium, notifySuccess, notifyWarning } from "../services/haptics";
import { translateText, getWordAlternatives, type WordAlternative } from "../services/translation";
import type { TranslationProvider } from "../services/translation";
import { logger } from "../services/logger";
import { copyWithAutoClear } from "../services/clipboard";
import { escapeHtml } from "../utils/htmlEscape";
import type { HistoryItem } from "../types";

// Consolidated modal state to reduce independent re-renders
type ModalState = {
  compareData: {
    original: string;
    results: Array<{ provider: string; text: string; loading?: boolean }>;
  } | null;
  correctionPrompt: {
    index: number;
    original: string;
    translated: string;
  } | null;
  wordAltData: {
    word: string;
    sourceLang: string;
    targetLang: string;
    alternatives: WordAlternative[];
    loading: boolean;
  } | null;
};

type ModalAction =
  | { type: "SET_COMPARE"; data: ModalState["compareData"] }
  | { type: "UPDATE_COMPARE_RESULT"; provider: string; text: string; loading: boolean }
  | { type: "SET_CORRECTION"; data: ModalState["correctionPrompt"] }
  | { type: "SET_WORD_ALT"; data: ModalState["wordAltData"] }
  | { type: "UPDATE_WORD_ALT_RESULTS"; alternatives: WordAlternative[] };

const INITIAL_MODAL_STATE: ModalState = {
  compareData: null,
  correctionPrompt: null,
  wordAltData: null,
};

function modalReducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case "SET_COMPARE":
      return { ...state, compareData: action.data };
    case "UPDATE_COMPARE_RESULT":
      if (!state.compareData) return state;
      return {
        ...state,
        compareData: {
          ...state.compareData,
          results: state.compareData.results.map((r) =>
            r.provider === action.provider ? { ...r, text: action.text, loading: action.loading } : r
          ),
        },
      };
    case "SET_CORRECTION":
      return { ...state, correctionPrompt: action.data };
    case "SET_WORD_ALT":
      return { ...state, wordAltData: action.data };
    case "UPDATE_WORD_ALT_RESULTS":
      if (!state.wordAltData) return state;
      return { ...state, wordAltData: { ...state.wordAltData, alternatives: action.alternatives, loading: false } };
    default: {
      const _exhaustive: never = action;
      return state;
    }
  }
}

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

  const [modalState, dispatchModal] = useReducer(modalReducer, INITIAL_MODAL_STATE);
  const { compareData, correctionPrompt, wordAltData } = modalState;

  // Stable setters for parent compatibility
  const setCompareData = useCallback((data: ModalState["compareData"]) => dispatchModal({ type: "SET_COMPARE", data }), []);
  const setCorrectionPrompt = useCallback((data: ModalState["correctionPrompt"]) => dispatchModal({ type: "SET_CORRECTION", data }), []);
  const setWordAltData = useCallback((data: ModalState["wordAltData"]) => dispatchModal({ type: "SET_WORD_ALT", data }), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (undoTimeout.current) clearTimeout(undoTimeout.current);
      Speech.stop();
    };
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      // copyWithAutoClear schedules a 60s clipboard wipe so copied translations
      // (which can include sensitive content like medical notes or personal
      // conversations) don't linger indefinitely. The clear is skipped if the
      // user has already copied something else.
      await copyWithAutoClear(text);
      notifySuccess();
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 1500);
    } catch (err) {
      logger.warn("History", "Copy to clipboard failed", err instanceof Error ? err.message : String(err));
    }
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
    if (item?.status !== "error" || !item.sourceLangCode || !item.targetLangCode) return;

    setHistory((prev) =>
      prev.map((h, i) => i === index ? { ...h, status: "pending" as const, translated: "Retrying..." } : h)
    );

    const controller = new AbortController();
    try {
      const result = await translateText(item.original, item.sourceLangCode, item.targetLangCode, { signal: controller.signal, provider: translationProvider });
      setHistory((prev) =>
        prev.map((h, i) => i === index ? { ...h, translated: result.translatedText, status: "ok" as const, sourceLangCode: undefined, targetLangCode: undefined } : h)
      );
      notifySuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Translation failed";
      setHistory((prev) =>
        prev.map((h, i) => i === index ? { ...h, translated: msg, status: "error" as const } : h)
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

  const shareHistoryAsPdf = useCallback(async (exportable: HistoryItem[]) => {
    // Render translations as a printable PDF via expo-print. Uses the native
    // share sheet afterwards so the user can AirDrop, save to Files, or email it.
    const rows = exportable
      .map((item, i) => {
        const time = item.timestamp
          ? new Date(item.timestamp).toLocaleString()
          : "";
        return `<tr>
          <td class="idx">${i + 1}</td>
          <td>${escapeHtml(item.original)}${item.favorited ? ' <span class="star">★</span>' : ""}</td>
          <td>${escapeHtml(item.translated)}</td>
          <td class="time">${escapeHtml(time)}</td>
        </tr>`;
      })
      .join("");

    const html = `
      <html>
      <head><meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #222; }
        h2 { margin: 0 0 4px; }
        p { color: #666; margin-top: 0; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th { text-align: left; border-bottom: 2px solid #333; padding: 8px; font-size: 12px; text-transform: uppercase; }
        td { padding: 8px; border-bottom: 1px solid #ddd; vertical-align: top; font-size: 14px; }
        td.idx { color: #888; width: 36px; }
        td.time { color: #888; font-size: 11px; white-space: nowrap; }
        .star { color: #e9a800; }
      </style></head>
      <body>
        <h2>Live Translator</h2>
        <p>${exportable.length} translation${exportable.length === 1 ? "" : "s"} &bull; Exported ${escapeHtml(new Date().toLocaleString())}</p>
        <table>
          <thead><tr><th>#</th><th>Original</th><th>Translation</th><th>When</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`;

    const { uri } = await Print.printToFileAsync({ html });
    // Sharing.shareAsync supports file URIs where Share.share({ message }) doesn't.
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Share translations" });
    }
  }, []);

  const shareHistory = useCallback(async (format: "text" | "csv" | "json" | "pdf" = "text") => {
    const exportable = history.filter((item) => item.status === "ok");
    if (exportable.length === 0) return;

    if (format === "pdf") {
      try {
        await shareHistoryAsPdf(exportable);
      } catch (err) {
        logger.warn("Translation", "PDF export failed", err);
      }
      return;
    }

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
    try { await Share.share({ message }); } catch (err) { logger.warn("Translation", "Share failed", err); }
  }, [history, shareHistoryAsPdf]);

  const showExportPicker = useCallback(() => {
    const exportable = history.filter((item) => item.status === "ok");
    if (exportable.length === 0) return;
    Alert.alert("Export Format", "Choose a format for your translations", [
      { text: "Text", onPress: () => shareHistory("text") },
      { text: "CSV", onPress: () => shareHistory("csv") },
      { text: "JSON", onPress: () => shareHistory("json") },
      { text: "PDF", onPress: () => shareHistory("pdf") },
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
    Share.share({ message: text }).catch((err) => logger.warn("Translation", "Share selected failed", err));
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
    dispatchModal({ type: "SET_WORD_ALT", data: { word, sourceLang: srcLang, targetLang: tgtLang, alternatives: [], loading: true } });
    impactMedium();
    try {
      const alts = await getWordAlternatives(word, srcLang, tgtLang);
      dispatchModal({ type: "UPDATE_WORD_ALT_RESULTS", alternatives: alts });
    } catch (err) {
      logger.warn("Translation", "Word alternatives lookup failed", err);
      dispatchModal({ type: "UPDATE_WORD_ALT_RESULTS", alternatives: [] });
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
    dispatchModal({ type: "SET_COMPARE", data: { original, results: initialResults } });

    for (const p of providers) {
      try {
        const result = await translateText(original, sourceLangCode, targetLangCode, { provider: p.key });
        dispatchModal({ type: "UPDATE_COMPARE_RESULT", provider: p.label, text: result.translatedText, loading: false });
      } catch (err) {
        logger.warn("Translation", "Compare translation failed", err);
        dispatchModal({ type: "UPDATE_COMPARE_RESULT", provider: p.label, text: "Failed to load", loading: false });
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
