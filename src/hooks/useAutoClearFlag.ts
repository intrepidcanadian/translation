/**
 * useAutoClearFlag — a single-value state that auto-resets to `null` after a
 * configurable delay. Extracts the "show a 'Copied!' badge for 1.5s" pattern
 * that was duplicated across ProductScanner, ListingGenerator,
 * PriceTagConverter, DutyFreeCatalogScanner, DocumentScanner, NotesViewer,
 * NotesScreen, and SettingsModal. Every copy of that pattern was a bare
 * `setTimeout(() => setCopied(null), 1500)` with no cleanup, so a component
 * that unmounted before the timer fired would trigger a "setState on
 * unmounted component" warning and leak the timer.
 *
 * This hook owns the timer ref, clears any pending timer before starting a
 * new one (so a rapid double-tap doesn't leave stale timers racing), and
 * clears the timer on unmount so the setter never fires after teardown.
 *
 *   const [copied, setCopiedBriefly] = useAutoClearFlag<string>(1500);
 *   // …
 *   await Clipboard.setStringAsync(text);
 *   setCopiedBriefly(text);
 *   // 1.5s later `copied` becomes null with no unmount risk.
 *
 * Passing `null` (or omitting the argument) immediately clears the value
 * and cancels any pending auto-clear.
 */

import { useEffect, useMemo, useState } from "react";
import {
  createAutoClearController,
  type AutoClearController,
} from "../utils/autoClearController";

type Setter<T> = (value: T | null) => void;

export function useAutoClearFlag<T = string>(durationMs: number = 1500): [T | null, Setter<T>] {
  const [value, setValue] = useState<T | null>(null);

  // Build a single pure controller per (durationMs) and route its
  // notifications into React state. The controller owns all timer lifecycle
  // — the hook is now just a React adapter on top of `autoClearController`,
  // which is unit-tested in isolation (#185). useMemo keeps the controller
  // identity stable across renders so the consumer's setFlag stays stable
  // too.
  const controller: AutoClearController<T> = useMemo(
    () => createAutoClearController<T>(durationMs, setValue),
    [durationMs]
  );

  // Clear any pending timer on unmount so a late setter never lands on a
  // torn-down tree. This is the whole reason the hook exists — the inline
  // setTimeout pattern it replaces couldn't do this.
  useEffect(() => {
    return () => controller.dispose();
  }, [controller]);

  // Consumer setter delegates to the controller; the controller notifies
  // React via the onChange callback above.
  const setFlag: Setter<T> = controller.set;

  return [value, setFlag];
}
