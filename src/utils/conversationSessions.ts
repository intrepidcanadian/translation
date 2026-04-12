import type { HistoryItem } from "../types";

export interface ConversationSession {
  id: string;
  items: HistoryItem[];
  startTime: number;
  endTime: number;
  sourceLang: string;
  targetLang: string;
}

const SESSION_GAP_MS = 1800000; // 30 minutes

export function groupIntoSessions(
  history: HistoryItem[]
): ConversationSession[] {
  const conversationItems = history.filter(
    (item): item is HistoryItem & { speaker: "A" | "B"; timestamp: number } =>
      item.speaker != null && item.timestamp != null
  );

  if (conversationItems.length === 0) return [];

  const sorted = [...conversationItems].sort(
    (a, b) => a.timestamp - b.timestamp
  );

  const sessions: ConversationSession[] = [];
  let currentItems: typeof sorted = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const timeDelta = curr.timestamp - prev.timestamp;
    const sameLangPair =
      curr.sourceLangCode === prev.sourceLangCode &&
      curr.targetLangCode === prev.targetLangCode;

    if (timeDelta <= SESSION_GAP_MS && sameLangPair) {
      currentItems.push(curr);
    } else {
      sessions.push(buildSession(currentItems));
      currentItems = [curr];
    }
  }

  // Push the final session
  sessions.push(buildSession(currentItems));

  // Return newest first
  return sessions.sort((a, b) => b.startTime - a.startTime);
}

function buildSession(
  items: (HistoryItem & { timestamp: number })[]
): ConversationSession {
  const startTime = items[0].timestamp;
  const endTime = items[items.length - 1].timestamp;

  return {
    id: `session-${startTime}`,
    items,
    startTime,
    endTime,
    sourceLang: items[0].sourceLangCode ?? "",
    targetLang: items[0].targetLangCode ?? "",
  };
}
