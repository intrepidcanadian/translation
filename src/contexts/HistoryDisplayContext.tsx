import React, { createContext, useContext } from "react";

/**
 * Display-state slice for HistoryList. Pulled out of the direct prop API so
 * HistoryList doesn't have to accept (and propagate) every search/select/filter
 * flag as a separate prop. TranslateScreen still owns the underlying state; it
 * just publishes the snapshot through this context once per render.
 *
 * Action callbacks (copy, delete, favorite, …) live in HistoryActionsContext;
 * this context is for read-only display state only.
 */
export type HistoryDisplayState = {
  searchQuery: string;
  showFavoritesOnly: boolean;
  hasFavorites: boolean;
  hasMoreHistory: boolean;
  selectMode: boolean;
  selectedIndices: Set<number>;
  confidenceThreshold: number;
  autoScroll: boolean;
  showRomanization: boolean;
};

const HistoryDisplayContext = createContext<HistoryDisplayState | null>(null);

export const HistoryDisplayProvider = HistoryDisplayContext.Provider;

export function useHistoryDisplay(): HistoryDisplayState {
  const ctx = useContext(HistoryDisplayContext);
  if (!ctx) {
    throw new Error("useHistoryDisplay must be used inside a HistoryDisplayProvider");
  }
  return ctx;
}
