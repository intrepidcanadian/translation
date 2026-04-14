import React, { createContext, useContext } from "react";

/**
 * Selection-mode slice split out of HistoryDisplayContext. Multi-select is
 * only used while the user is actively tapping checkboxes, so we keep its
 * state on its own context to avoid thrashing HistoryDisplay consumers —
 * search / filter / confidence / auto-scroll consumers should not re-render
 * on every checkbox toggle, and non-select history rows shouldn't subscribe
 * to selectedIndices at all.
 */
export type SelectState = {
  selectMode: boolean;
  selectedIndices: Set<number>;
};

const SelectStateContext = createContext<SelectState | null>(null);

export const SelectStateProvider = SelectStateContext.Provider;

export function useSelectState(): SelectState {
  const ctx = useContext(SelectStateContext);
  if (!ctx) {
    throw new Error("useSelectState must be used inside a SelectStateProvider");
  }
  return ctx;
}
