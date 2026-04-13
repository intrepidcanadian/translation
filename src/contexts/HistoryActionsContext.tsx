import React, { createContext, useContext } from "react";

/**
 * Holds all history-related action callbacks so HistoryList and its children
 * don't need 15+ individual callback props drilled through.
 */
export interface HistoryActions {
  onDeleteHistoryItem: (index: number) => void;
  onCopyToClipboard: (text: string) => void;
  onSpeakText: (text: string, langCode: string) => void;
  onToggleFavorite: (index: number) => void;
  onRetryTranslation: (index: number) => void;
  onCompareTranslation: (original: string, translated: string) => void;
  onCorrection: (data: { index: number; original: string; translated: string }) => void;
  onWordLongPress: (word: string, srcLang: string, tgtLang: string) => void;
  onShowPassenger?: (index: number) => void;
  onShareCard?: (index: number) => void;
  onToggleSelectItem: (index: number) => void;
  onSearchChange: (query: string) => void;
  onToggleFavoritesOnly: () => void;
  onLoadMoreHistory: () => void;
}

const HistoryActionsContext = createContext<HistoryActions | null>(null);

export function HistoryActionsProvider({
  value,
  children,
}: {
  value: HistoryActions;
  children: React.ReactNode;
}) {
  return (
    <HistoryActionsContext.Provider value={value}>
      {children}
    </HistoryActionsContext.Provider>
  );
}

export function useHistoryActionsContext(): HistoryActions {
  const ctx = useContext(HistoryActionsContext);
  if (!ctx) throw new Error("useHistoryActionsContext must be used within HistoryActionsProvider");
  return ctx;
}
