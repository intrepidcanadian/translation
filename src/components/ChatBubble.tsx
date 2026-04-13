import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Share } from "react-native";
import AlignedRomanization from "./AlignedRomanization";
import { formatRelativeTime } from "../utils/formatRelativeTime";
import { highlightMatches } from "../utils/highlightText";
import { LANGUAGE_MAP } from "../services/translation";
import { logger } from "../services/logger";
import type { ThemeColors } from "../theme";
import type { HistoryItem } from "../types";

interface ChatBubbleProps {
  item: HistoryItem;
  realIndex: number;
  colors: ThemeColors;
  dynamicFontSizes: { chatText: { fontSize: number } };
  showRomanization: boolean;
  fontSizeScale: number;
  confidenceThreshold: number;
  copiedText: string | null;
  speakingText: string | null;
  speakLang: string;
  sourceLangName: string;
  targetLangName: string;
  onCopy: (text: string) => void;
  onSpeak: (text: string, langCode: string) => void;
  onToggleFavorite: (index: number) => void;
  searchQuery?: string;
}

function ChatBubble({
  item,
  realIndex,
  colors,
  dynamicFontSizes,
  showRomanization,
  fontSizeScale,
  confidenceThreshold,
  copiedText,
  speakingText,
  speakLang,
  sourceLangName,
  targetLangName,
  onCopy,
  onSpeak,
  onToggleFavorite,
  searchQuery,
}: ChatBubbleProps) {
  const isB = item.speaker === "B";
  const originalWordCount = React.useMemo(() => item.original.trim().split(/\s+/).filter(Boolean).length, [item.original]);
  const translatedWordCount = React.useMemo(() => item.translated.trim().split(/\s+/).filter(Boolean).length, [item.translated]);

  const handleShare = () => {
    const speakerLabel = isB ? targetLangName : sourceLangName;
    const card = [
      `[${speakerLabel}]`,
      `"${item.original}"`,
      "",
      `→ "${item.translated}"`,
      "",
      "— Live Translator",
    ].join("\n");
    Share.share({ message: card }).catch((err) => logger.warn("Translation", "Share failed", err));
  };

  return (
    <View style={[styles.chatRow, isB && styles.chatRowRight]}>
      <View style={[styles.chatBubble, isB ? [styles.chatBubbleB, { backgroundColor: colors.translatedBubbleBg }] : [styles.chatBubbleA, { backgroundColor: colors.bubbleBg }]]}>
        <Text style={[styles.chatSpeakerLabel, { color: colors.primary }]}>
          {isB ? targetLangName : sourceLangName}
        </Text>
        <TouchableOpacity onPress={() => onCopy(item.original)}>
          <Text selectable style={[styles.chatOriginal, { color: colors.secondaryText }, dynamicFontSizes.chatText]}>
            {searchQuery?.trim()
              ? highlightMatches(item.original, searchQuery, { color: colors.secondaryText }, { backgroundColor: colors.primary + "30", color: colors.primaryText, borderRadius: 2 })
              : item.original}
          </Text>
        </TouchableOpacity>
        {item.detectedLang && (() => {
          const lang = LANGUAGE_MAP.get(item.detectedLang!);
          return lang ? (
            <Text style={[styles.detectedLangBadge, { color: colors.primary, backgroundColor: colors.primary + "18" }]}>
              Detected: {lang.name}
            </Text>
          ) : null;
        })()}
        {showRomanization && item.sourceLangCode && (
          <AlignedRomanization text={item.original} langCode={item.sourceLangCode} textColor={colors.secondaryText} romanColor={colors.mutedText} fontSize={14 * fontSizeScale} />
        )}
        <TouchableOpacity onPress={() => onCopy(item.translated)}>
          <Text selectable style={[styles.chatTranslated, { color: colors.translatedText }, dynamicFontSizes.chatText]}>
            {searchQuery?.trim()
              ? highlightMatches(item.translated, searchQuery, { color: colors.translatedText }, { backgroundColor: colors.primary + "30", color: colors.primaryText, borderRadius: 2 })
              : item.translated}
          </Text>
        </TouchableOpacity>
        {showRomanization && item.targetLangCode && (
          <AlignedRomanization text={item.translated} langCode={item.targetLangCode} textColor={colors.translatedText} romanColor={colors.mutedText} fontSize={14 * fontSizeScale} />
        )}
        {confidenceThreshold > 0 && item.confidence != null && Math.round(item.confidence * 100) < confidenceThreshold && (
          <Text style={[styles.lowConfidenceBadge, { color: colors.warningText, backgroundColor: colors.warningBg }]}>
            ⚠ Low confidence ({Math.round(item.confidence * 100)}%)
          </Text>
        )}
        {copiedText === item.original || copiedText === item.translated ? (
          <Text style={[styles.copiedBadge, { color: colors.successText }]}>Copied!</Text>
        ) : null}
        <View style={styles.bubbleActions}>
          <Text style={[styles.wordCountBubble, { color: colors.dimText }]}>
            {originalWordCount} → {translatedWordCount} words
            {item.confidence != null ? ` · ${Math.round(item.confidence * 100)}%` : ""}
          </Text>
          {(() => {
            const timeStr = formatRelativeTime(item.timestamp);
            return timeStr ? (
              <Text style={[styles.timestampText, { color: colors.dimText }]}>{timeStr}</Text>
            ) : null;
          })()}
          <TouchableOpacity
            style={styles.speakButton}
            onPress={() => onSpeak(item.translated, speakLang)}
            accessibilityRole="button"
            accessibilityLabel={speakingText === item.translated ? "Stop speaking" : "Speak translation"}
          >
            <Text style={[styles.speakIcon, speakingText === item.translated && styles.speakIconActive]}>
              {speakingText === item.translated ? "⏹" : "🔊"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={() => onToggleFavorite(realIndex)}
            accessibilityRole="button"
            accessibilityLabel={item.favorited ? "Remove from favorites" : "Add to favorites"}
          >
            <Text style={[styles.favoriteIcon, { color: colors.dimText }, item.favorited && { color: colors.favoriteColor }]}>
              {item.favorited ? "★" : "☆"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.speakButton}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Share this translation"
          >
            <Text style={[{ fontSize: 14, color: colors.dimText }]}>↗</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default React.memo(ChatBubble);

const styles = StyleSheet.create({
  chatRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  chatRowRight: {
    justifyContent: "flex-end",
  },
  chatBubble: {
    maxWidth: "80%",
    borderRadius: 16,
    padding: 12,
  },
  chatBubbleA: {
    borderTopLeftRadius: 4,
  },
  chatBubbleB: {
    borderTopRightRadius: 4,
  },
  chatSpeakerLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  chatOriginal: {
    fontSize: 15,
    lineHeight: 20,
  },
  chatTranslated: {
    fontSize: 15,
    lineHeight: 20,
    marginTop: 6,
    fontStyle: "italic",
  },
  detectedLangBadge: {
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
    marginTop: 4,
    overflow: "hidden",
  },
  lowConfidenceBadge: {
    fontSize: 11,
    fontWeight: "600",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
    marginTop: 4,
    overflow: "hidden",
  },
  copiedBadge: {
    color: "#34C759",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  bubbleActions: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    flexWrap: "wrap",
    gap: 4,
  },
  wordCountBubble: {
    fontSize: 11,
    marginRight: 4,
  },
  timestampText: {
    fontSize: 11,
    marginRight: 4,
  },
  speakButton: {
    padding: 2,
  },
  speakIcon: {
    fontSize: 16,
  },
  speakIconActive: {
    opacity: 0.5,
  },
  favoriteButton: {
    padding: 2,
    marginLeft: 2,
  },
  favoriteIcon: {
    fontSize: 16,
  },
  favoriteIconActive: {
    color: "#FFD700",
  },
});
