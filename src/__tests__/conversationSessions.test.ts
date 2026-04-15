/**
 * @jest-environment node
 *
 * Pins the conversation grouping contract in `src/utils/conversationSessions.ts`.
 *
 * The grouper turns a flat history array into "conversation sessions" — runs
 * of conversation-mode items (`speaker` set, `timestamp` set) that share the
 * same source/target language pair and aren't separated by more than 30
 * minutes. ConversationPlayback / SplitConversation read these sessions to
 * render replayable transcripts, so a regression here silently fragments or
 * merges historical conversations the user expects to find intact.
 */

import { groupIntoSessions } from "../utils/conversationSessions";
import type { HistoryItem } from "../types";

const SESSION_GAP_MS = 1_800_000; // mirrors the constant in the source file

function item(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: `h${Math.random().toString(36).slice(2)}`,
    original: "hello",
    translated: "hola",
    status: "ok",
    speaker: "A",
    sourceLangCode: "en",
    targetLangCode: "es",
    timestamp: 1_000_000,
    ...overrides,
  };
}

describe("groupIntoSessions", () => {
  it("returns empty array for empty history", () => {
    expect(groupIntoSessions([])).toEqual([]);
  });

  it("returns empty array when no items have speaker + timestamp", () => {
    // Standard-mode items (no speaker) should be filtered out
    const history: HistoryItem[] = [
      item({ speaker: undefined, timestamp: 1000 }),
      item({ speaker: "A", timestamp: undefined }),
    ];
    expect(groupIntoSessions(history)).toEqual([]);
  });

  it("groups items within SESSION_GAP_MS into one session", () => {
    const t = 1_000_000_000;
    const history: HistoryItem[] = [
      item({ timestamp: t, speaker: "A" }),
      item({ timestamp: t + 60_000, speaker: "B" }), // +1 min
      item({ timestamp: t + 120_000, speaker: "A" }), // +2 min
    ];
    const sessions = groupIntoSessions(history);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].items).toHaveLength(3);
    expect(sessions[0].startTime).toBe(t);
    expect(sessions[0].endTime).toBe(t + 120_000);
    expect(sessions[0].sourceLang).toBe("en");
    expect(sessions[0].targetLang).toBe("es");
  });

  it("splits sessions when gap exceeds SESSION_GAP_MS", () => {
    const t = 1_000_000_000;
    const history: HistoryItem[] = [
      item({ timestamp: t, speaker: "A" }),
      item({ timestamp: t + SESSION_GAP_MS + 1, speaker: "B" }), // just over 30min
    ];
    const sessions = groupIntoSessions(history);
    expect(sessions).toHaveLength(2);
    // Returned newest-first
    expect(sessions[0].startTime).toBeGreaterThan(sessions[1].startTime);
  });

  it("treats exactly SESSION_GAP_MS as same session (boundary)", () => {
    const t = 1_000_000_000;
    const history: HistoryItem[] = [
      item({ timestamp: t, speaker: "A" }),
      item({ timestamp: t + SESSION_GAP_MS, speaker: "B" }), // exactly 30min
    ];
    const sessions = groupIntoSessions(history);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].items).toHaveLength(2);
  });

  it("splits sessions when language pair changes mid-stream", () => {
    const t = 1_000_000_000;
    const history: HistoryItem[] = [
      item({ timestamp: t, sourceLangCode: "en", targetLangCode: "es" }),
      item({ timestamp: t + 1000, sourceLangCode: "en", targetLangCode: "fr" }),
      item({ timestamp: t + 2000, sourceLangCode: "en", targetLangCode: "fr" }),
    ];
    const sessions = groupIntoSessions(history);
    expect(sessions).toHaveLength(2);
    // Sessions returned newest first
    const [newer, older] = sessions;
    expect(older.targetLang).toBe("es");
    expect(older.items).toHaveLength(1);
    expect(newer.targetLang).toBe("fr");
    expect(newer.items).toHaveLength(2);
  });

  it("filters out non-conversation items but keeps interleaved conversation items together", () => {
    const t = 1_000_000_000;
    const history: HistoryItem[] = [
      item({ timestamp: t, speaker: "A" }),
      // Standard-mode item interleaved — should be ignored, not used as a gap
      item({ timestamp: t + 500, speaker: undefined }),
      item({ timestamp: t + 1000, speaker: "B" }),
    ];
    const sessions = groupIntoSessions(history);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].items).toHaveLength(2);
  });

  it("sorts items by ascending timestamp before grouping", () => {
    // Out-of-order input should still produce ordered session items
    const t = 1_000_000_000;
    const history: HistoryItem[] = [
      item({ timestamp: t + 2000, speaker: "B", original: "third" }),
      item({ timestamp: t, speaker: "A", original: "first" }),
      item({ timestamp: t + 1000, speaker: "A", original: "second" }),
    ];
    const sessions = groupIntoSessions(history);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].items.map((i) => i.original)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(sessions[0].startTime).toBe(t);
    expect(sessions[0].endTime).toBe(t + 2000);
  });

  it("returns sessions sorted newest first across multiple gaps", () => {
    const base = 1_000_000_000;
    const history: HistoryItem[] = [
      item({ timestamp: base, speaker: "A" }),
      item({ timestamp: base + SESSION_GAP_MS + 1, speaker: "A" }),
      item({ timestamp: base + 2 * SESSION_GAP_MS + 2, speaker: "A" }),
    ];
    const sessions = groupIntoSessions(history);
    expect(sessions).toHaveLength(3);
    expect(sessions[0].startTime).toBeGreaterThan(sessions[1].startTime);
    expect(sessions[1].startTime).toBeGreaterThan(sessions[2].startTime);
  });

  it("session id is derived from startTime so a re-grouping is stable", () => {
    const t = 1_000_000_000;
    const history: HistoryItem[] = [
      item({ timestamp: t, speaker: "A" }),
      item({ timestamp: t + 1000, speaker: "B" }),
    ];
    const a = groupIntoSessions(history);
    const b = groupIntoSessions(history);
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).toBe(`session-${t}`);
  });

  it("falls back to empty strings when sourceLangCode/targetLangCode are missing", () => {
    // The grouper requires speaker + timestamp but lang codes are optional —
    // it should not crash, just record empty pair labels.
    const t = 1_000_000_000;
    const history: HistoryItem[] = [
      item({
        timestamp: t,
        speaker: "A",
        sourceLangCode: undefined,
        targetLangCode: undefined,
      }),
    ];
    const sessions = groupIntoSessions(history);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sourceLang).toBe("");
    expect(sessions[0].targetLang).toBe("");
  });
});
