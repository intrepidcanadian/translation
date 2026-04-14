/**
 * Clipboard helper with optional auto-clear.
 *
 * Copied translations can contain sensitive content (medical notes, receipts,
 * personal conversations). After an opt-in TTL we overwrite the clipboard —
 * only if it still holds the same string we wrote, so we never stomp on
 * content the user pasted from somewhere else in the interim.
 *
 * The default TTL (60s) is long enough for a realistic "copy → switch app →
 * paste" flow but short enough that a forgotten clipboard doesn't linger.
 */

import * as Clipboard from "expo-clipboard";
import { logger } from "./logger";

const DEFAULT_AUTOCLEAR_MS = 60_000;

let pendingClearHandle: ReturnType<typeof setTimeout> | null = null;
let lastWritten: string | null = null;

/**
 * Copy text to the clipboard and schedule an auto-clear.
 * If called again before the timeout fires, the previous timer is cancelled
 * so we track only the most recent copy.
 */
export async function copyWithAutoClear(text: string, ttlMs = DEFAULT_AUTOCLEAR_MS): Promise<void> {
  await Clipboard.setStringAsync(text);
  lastWritten = text;

  if (pendingClearHandle) clearTimeout(pendingClearHandle);
  pendingClearHandle = setTimeout(async () => {
    pendingClearHandle = null;
    try {
      // Only clear if the user hasn't copied something else in the meantime.
      const current = await Clipboard.getStringAsync();
      if (current === lastWritten) {
        await Clipboard.setStringAsync("");
        lastWritten = null;
      }
    } catch (err) {
      logger.warn("Storage", "Clipboard auto-clear failed", err);
    }
  }, ttlMs);
}

/** Cancel any pending auto-clear (e.g. when the user explicitly wants persistence). */
export function cancelClipboardAutoClear(): void {
  if (pendingClearHandle) {
    clearTimeout(pendingClearHandle);
    pendingClearHandle = null;
  }
  lastWritten = null;
}
