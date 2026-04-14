export type HistoryItemStatus = "ok" | "pending" | "error";

export interface HistoryItem {
  /**
   * Stable unique identifier. Required on all freshly created items so
   * FlatList keyExtractor and future Map<id, HistoryItem> normalization
   * (backlog #103/#85) don't rely on array index or timestamp collisions.
   * Optional on the type for backwards compatibility with legacy persisted
   * items — `migrateHistoryItem` backfills an id for any loaded item that
   * lacks one.
   */
  id?: string;
  original: string;
  translated: string;
  status: HistoryItemStatus;
  speaker?: "A" | "B";
  favorited?: boolean;
  sourceLangCode?: string;
  targetLangCode?: string;
  confidence?: number;
  detectedLang?: string;
  timestamp?: number;
}

// Monotonic counter ensures uniqueness inside the same millisecond, which
// Date.now() alone can't guarantee when multiple items are pushed in a tight
// loop (e.g. batch OCR translation, offline queue flush).
let _historyIdCounter = 0;

/**
 * Generate a stable unique id for a new HistoryItem.
 * Format: `h{timestamp}-{counter}-{random}` — sortable, collision-resistant,
 * and stable across re-renders so React reconciliation and FlatList row
 * memoization work correctly.
 */
export function newHistoryId(): string {
  _historyIdCounter = (_historyIdCounter + 1) % 1_000_000;
  const rand = Math.floor(Math.random() * 1_000_000).toString(36);
  return `h${Date.now().toString(36)}-${_historyIdCounter.toString(36)}-${rand}`;
}

/** Migrate legacy items that used boolean pending/error fields */
export function migrateHistoryItem(item: Record<string, unknown>): HistoryItem {
  let status: HistoryItemStatus;
  let base: Record<string, unknown>;
  if (item.status === "ok" || item.status === "pending" || item.status === "error") {
    status = item.status;
    base = item;
  } else {
    status = "ok";
    if (item.pending) status = "pending";
    else if (item.error) status = "error";
    const { pending: _, error: _e, ...rest } = item;
    base = rest;
  }
  // Backfill a stable id if missing (legacy persisted items never had one).
  const id = typeof base.id === "string" && base.id ? base.id : newHistoryId();
  return { ...base, id, status } as unknown as HistoryItem;
}
