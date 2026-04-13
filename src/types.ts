export type HistoryItemStatus = "ok" | "pending" | "error";

export interface HistoryItem {
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

/** Migrate legacy items that used boolean pending/error fields */
export function migrateHistoryItem(item: Record<string, unknown>): HistoryItem {
  if (item.status === "ok" || item.status === "pending" || item.status === "error") {
    return item as unknown as HistoryItem;
  }
  let status: HistoryItemStatus = "ok";
  if (item.pending) status = "pending";
  else if (item.error) status = "error";
  const { pending: _, error: _e, ...rest } = item;
  return { ...rest, status } as unknown as HistoryItem;
}
