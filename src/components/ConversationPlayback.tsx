import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import * as Speech from "expo-speech";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useTranslationData } from "../contexts/TranslationDataContext";
import { useTheme } from "../contexts/ThemeContext";
import { useSettings } from "../contexts/SettingsContext";
import { useLanguage } from "../contexts/LanguageContext";
import { logger } from "../services/logger";
import {
  groupIntoSessions,
  ConversationSession,
} from "../utils/conversationSessions";

interface ConversationPlaybackProps {
  visible: boolean;
  onClose: () => void;
}

function ConversationPlayback({
  visible,
  onClose,
}: ConversationPlaybackProps) {
  const { history } = useTranslationData();
  const { colors } = useTheme();
  const { settings } = useSettings();
  const { sourceLang, targetLang } = useLanguage();

  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    null
  );
  const [playingSessionId, setPlayingSessionId] = useState<string | null>(null);
  const [currentItemIdx, setCurrentItemIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);

  const playingRef = useRef(false);
  const currentIdxRef = useRef(0);

  const sessions = useMemo(() => groupIntoSessions(history), [history]);

  const formatDate = useCallback((ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  const formatDuration = useCallback((startMs: number, endMs: number) => {
    const diffSec = Math.round((endMs - startMs) / 1000);
    if (diffSec < 60) return `${diffSec}s`;
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }, []);

  const toggleExpand = useCallback(
    (sessionId: string) => {
      setExpandedSessionId((prev) => (prev === sessionId ? null : sessionId));
    },
    []
  );

  const speakItem = useCallback(
    (session: ConversationSession, idx: number) => {
      if (idx >= session.items.length) {
        setIsPlaying(false);
        setPlayingSessionId(null);
        setCurrentItemIdx(0);
        playingRef.current = false;
        currentIdxRef.current = 0;
        return;
      }

      const item = session.items[idx];
      const langCode =
        item.speaker === "A"
          ? targetLang.speechCode
          : sourceLang.speechCode;

      setCurrentItemIdx(idx);
      currentIdxRef.current = idx;

      Speech.speak(item.translated, {
        language: langCode,
        rate: settings.speechRate,
        onDone: () => {
          if (!playingRef.current) return;
          speakItem(session, currentIdxRef.current + 1);
        },
      });
    },
    [targetLang.speechCode, sourceLang.speechCode, settings.speechRate]
  );

  const handlePlay = useCallback(
    (session: ConversationSession) => {
      if (playingSessionId === session.id && isPlaying) {
        // Pause
        Speech.stop();
        setIsPlaying(false);
        playingRef.current = false;
        return;
      }

      if (playingSessionId === session.id && !isPlaying) {
        // Resume from current index
        setIsPlaying(true);
        playingRef.current = true;
        speakItem(session, currentIdxRef.current);
        return;
      }

      // Start new playback
      Speech.stop();
      setPlayingSessionId(session.id);
      setExpandedSessionId(session.id);
      setCurrentItemIdx(0);
      currentIdxRef.current = 0;
      setIsPlaying(true);
      playingRef.current = true;
      speakItem(session, 0);
    },
    [playingSessionId, isPlaying, speakItem]
  );

  const handleStop = useCallback(() => {
    Speech.stop();
    setIsPlaying(false);
    setPlayingSessionId(null);
    setCurrentItemIdx(0);
    playingRef.current = false;
    currentIdxRef.current = 0;
  }, []);

  const handleExportPdf = useCallback(
    async (session: ConversationSession) => {
      setExporting(true);
      try {
        const rows = session.items
          .map((item) => {
            const time = item.timestamp
              ? new Date(item.timestamp).toLocaleTimeString()
              : "";
            const escapedOriginal = escapeHtml(item.original);
            const escapedTranslated = escapeHtml(item.translated);
            return `<tr>
              <td style="font-weight:bold;color:${item.speaker === "A" ? "#4A90D9" : "#D94A4A"}">${item.speaker ?? ""}</td>
              <td>${escapedOriginal}</td>
              <td>${escapedTranslated}</td>
              <td style="color:#888;font-size:12px">${time}</td>
            </tr>`;
          })
          .join("");

        const html = `
          <html>
          <head><meta charset="utf-8" />
          <style>
            body { font-family: -apple-system, sans-serif; padding: 20px; }
            h2 { margin-bottom: 4px; }
            p { color: #666; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th { text-align: left; border-bottom: 2px solid #333; padding: 8px; }
            td { padding: 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
          </style></head>
          <body>
            <h2>Conversation - ${new Date(session.startTime).toLocaleDateString()}</h2>
            <p>${session.sourceLang} / ${session.targetLang} &bull; ${session.items.length} items</p>
            <table>
              <thead><tr><th>Speaker</th><th>Original</th><th>Translation</th><th>Time</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </body></html>`;

        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri);
      } catch (err) {
        logger.warn("Translation", "Conversation export failed", err);
      } finally {
        setExporting(false);
      }
    },
    []
  );

  const handleClose = useCallback(() => {
    handleStop();
    onClose();
  }, [handleStop, onClose]);

  const renderSessionItem = useCallback(
    ({ item: session }: { item: ConversationSession }) => {
      const isExpanded = expandedSessionId === session.id;
      const isSessionPlaying = playingSessionId === session.id;

      return (
        <View
          style={[styles.sessionCard, { backgroundColor: colors.cardBg }]}
        >
          <TouchableOpacity
            style={styles.sessionHeader}
            onPress={() => toggleExpand(session.id)}
            activeOpacity={0.7}
          >
            <View style={styles.sessionInfo}>
              <Text style={[styles.sessionDate, { color: colors.primaryText }]}>
                {formatDate(session.startTime)}
              </Text>
              <Text style={[styles.sessionMeta, { color: colors.dimText }]}>
                {session.items.length} items &bull;{" "}
                {formatDuration(session.startTime, session.endTime)}
              </Text>
              <View
                style={[
                  styles.langBadge,
                  { backgroundColor: colors.primary + "22" },
                ]}
              >
                <Text style={[styles.langBadgeText, { color: colors.primary }]}>
                  {session.sourceLang} &rarr; {session.targetLang}
                </Text>
              </View>
            </View>
            <View style={styles.sessionActions}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                onPress={() => handlePlay(session)}
              >
                <Text style={{ fontSize: 16, color: "#fff" }}>{isSessionPlaying && isPlaying ? "⏸" : "▶"}</Text>
              </TouchableOpacity>
              {isSessionPlaying && isPlaying && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: "#D94A4A" }]}
                  onPress={handleStop}
                >
                  <Text style={{ fontSize: 16, color: "#fff" }}>⏹</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  { backgroundColor: colors.primary + "33" },
                ]}
                onPress={() => handleExportPdf(session)}
                disabled={exporting}
              >
                {exporting ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={{ fontSize: 16, color: colors.primary }}>PDF</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>

          {isExpanded && (
            <View style={styles.itemList}>
              {session.items.map((item, idx) => {
                const isActive =
                  isSessionPlaying && isPlaying && idx === currentItemIdx;
                const speakerColor =
                  item.speaker === "A" ? "#4A90D9" : "#D94A4A";

                return (
                  <View
                    key={`${session.id}-${idx}`}
                    style={[
                      styles.itemRow,
                      isActive && {
                        backgroundColor: colors.primary + "18",
                        borderLeftColor: colors.primary,
                        borderLeftWidth: 3,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.speakerBadge,
                        { backgroundColor: speakerColor + "22" },
                      ]}
                    >
                      <Text
                        style={[styles.speakerLabel, { color: speakerColor }]}
                      >
                        {item.speaker}
                      </Text>
                    </View>
                    <View style={styles.itemTexts}>
                      <Text
                        style={[
                          styles.originalText,
                          { color: colors.primaryText },
                        ]}
                      >
                        {item.original}
                      </Text>
                      <Text
                        style={[
                          styles.translatedText,
                          { color: colors.dimText },
                        ]}
                      >
                        {item.translated}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      );
    },
    [
      expandedSessionId,
      playingSessionId,
      isPlaying,
      currentItemIdx,
      colors,
      formatDate,
      formatDuration,
      toggleExpand,
      handlePlay,
      handleStop,
      handleExportPdf,
      exporting,
    ]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: colors.modalBg }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.primaryText }]}>
            Conversation History
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.primaryText }}>X</Text>
          </TouchableOpacity>
        </View>

        {sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 40 }}>💬</Text>
            <Text style={[styles.emptyText, { color: colors.dimText }]}>
              No conversation sessions yet.{"\n"}Use conversation mode to start
              recording.
            </Text>
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(s) => s.id}
            renderItem={renderSessionItem}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </Modal>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
  },
  closeBtn: {
    padding: 4,
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  sessionCard: {
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
  },
  sessionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
  },
  sessionInfo: {
    flex: 1,
    marginRight: 12,
  },
  sessionDate: {
    fontSize: 15,
    fontWeight: "600",
  },
  sessionMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  langBadge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
  },
  langBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  sessionActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  itemList: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 6,
    marginBottom: 4,
  },
  speakerBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    marginTop: 2,
  },
  speakerLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  itemTexts: {
    flex: 1,
  },
  originalText: {
    fontSize: 14,
    fontWeight: "500",
  },
  translatedText: {
    fontSize: 13,
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 15,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 22,
  },
});

export default React.memo(ConversationPlayback);
