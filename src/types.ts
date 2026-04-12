export interface HistoryItem {
  original: string;
  translated: string;
  speaker?: "A" | "B";
  favorited?: boolean;
  pending?: boolean;
  error?: boolean;
  sourceLangCode?: string;
  targetLangCode?: string;
  confidence?: number;
  detectedLang?: string;
  timestamp?: number;
}
