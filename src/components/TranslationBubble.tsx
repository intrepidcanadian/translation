import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import AlignedRomanization from "./AlignedRomanization";
import { formatRelativeTime } from "../utils/formatRelativeTime";
import { LANGUAGES } from "../services/translation";
import type { ThemeColors } from "../theme";
import type { HistoryItem } from "../types";

interface TranslationBubbleProps {
  item: HistoryItem;
  realIndex: number;
  colors: ThemeColors;
  dynamicFontSizes: {
    original: { fontSize: number };
    translated: { fontSize: number };
  };
  showRomanization: boolean;
  fontSizeScale: number;
  copiedText: string | null;
  speakingText: string | null;
  targetSpeechCode: string;
  onCopy: (text: string) => void;
  onSpeak: (text: string, langCode: string) => void;
  onToggleFavorite: (index: number) => void;
  onRetry: (index: number) => void;
  onCompare: (original: string, translated: string) => void;
  onCorrection: (data: { index: number; original: string; translated: string }) => void;
  onWordLongPress: (word: string, targetLang: string, sourceLang: string) => void;
}

function TranslationBubble({
  item,
  realIndex,
  colors,
  dynamicFontSizes,
  showRomanization,
  fontSizeScale,
  copiedText,
  speakingText,
  targetSpeechCode,
  onCopy,
  onSpeak,
  onToggleFavorite,
  onRetry,
  onCompare,
  onCorrection,
  onWordLongPress,
}: TranslationBubbleProps) {
  const timeStr = formatRelativeTime(item.timestamp);

  return (
    <View style={styles.historyItem}>
      <TouchableOpacity
        onPress={() => onCopy(item.original)}
        style={[styles.bubble, { backgroundColor: colors.bubbleBg }]}
        accessibilityRole="button"
        accessibilityLabel={`Original: ${item.original}. Tap to copy.`}
      >
        <Text style={[styles.originalText, { color: colors.secondaryText }, dynamicFontSizes.original]}>{item.original}</Text>
        {item.detectedLang && (() => {
          const lang = LANGUAGES.find((l) => l.code === item.detectedLang);
          return lang ? (
            <Text style={[styles.detectedLangBadge, { color: colors.primary, backgroundColor: colors.primary + "18" }]}>
              Detected: {lang.name}
            </Text>
          ) : null;
        })()}
        {showRomanization && item.sourceLangCode && (
          <AlignedRomanization text={item.original} langCode={item.sourceLangCode} textColor={colors.secondaryText} romanColor={colors.mutedText} />
        )}
        {copiedText === item.original && (
          <Text style={styles.copiedBadge}>Copied!</Text>
        )}
      </TouchableOpacity>
      <View style={[styles.bubble, styles.translatedBubble, { backgroundColor: colors.translatedBubbleBg, borderLeftColor: item.error ? colors.errorBorder : item.pending ? colors.offlineText : colors.primary }]}>
        <TouchableOpacity
          onPress={() => !item.pending && !item.error && onCopy(item.translated)}
          accessibilityRole="button"
          accessibilityLabel={item.error ? `Translation failed: ${item.translated}` : item.pending ? `Queued for translation when online` : `Translation: ${item.translated}. Tap to copy. Long-press a word for alternatives.`}
          disabled={item.pending || item.error}
        >
          {item.pending && (
            <Text style={[styles.pendingBadge, { color: colors.offlineText }]}>
              Queued offline
            </Text>
          )}
          {item.error && (
            <Text style={[styles.pendingBadge, { color: colors.errorText }]}>
              Failed
            </Text>
          )}
          <Text style={[styles.translatedTextHistory, { color: item.error ? colors.errorText : item.pending ? colors.dimText : colors.translatedText }, dynamicFontSizes.translated, (item.pending || item.error) && { fontStyle: "italic" }]}>
            {!item.error && !item.pending && item.sourceLangCode && item.targetLangCode
              ? item.translated.split(/(\s+)/).map((segment: string, si: number) =>
                  /\s+/.test(segment) ? segment : (
                    <Text
                      key={si}
                      onLongPress={() => {
                        const cleaned = segment.replace(/[^\p{L}\p{N}]/gu, "");
                        if (cleaned) onWordLongPress(cleaned, item.targetLangCode!, item.sourceLangCode!);
                      }}
                      style={styles.tappableWord}
                    >
                      {segment}
                    </Text>
                  )
                )
              : item.translated
            }
          </Text>
          {showRomanization && !item.error && !item.pending && item.targetLangCode && (
            <AlignedRomanization text={item.translated} langCode={item.targetLangCode} textColor={colors.translatedText} romanColor={colors.mutedText} />
          )}
          {copiedText === item.translated && (
            <Text style={[styles.copiedBadge, { color: colors.successText }]}>Copied!</Text>
          )}
        </TouchableOpacity>
        <View style={styles.bubbleActions}>
          {!item.error && !item.pending && (
            <Text style={[styles.wordCountBubble, { color: colors.dimText }]}>
              {item.original.trim().split(/\s+/).filter(Boolean).length} → {item.translated.trim().split(/\s+/).filter(Boolean).length} words
              {item.confidence != null ? ` · ${Math.round(item.confidence * 100)}%` : ""}
            </Text>
          )}
          {timeStr ? (
            <Text style={[styles.timestampText, { color: colors.dimText }]}>{timeStr}</Text>
          ) : null}
          {item.error ? (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => onRetry(realIndex)}
              accessibilityRole="button"
              accessibilityLabel="Retry translation"
            >
              <Text style={[styles.retryIcon, { color: colors.primary }]}>↻</Text>
              <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.speakButton}
              onPress={() => onSpeak(item.translated, targetSpeechCode)}
              accessibilityRole="button"
              accessibilityLabel={speakingText === item.translated ? "Stop speaking" : `Speak translation: ${item.translated}`}
            >
              <Text style={[styles.speakIcon, speakingText === item.translated && styles.speakIconActive]}>
                {speakingText === item.translated ? "⏹" : "🔊"}
              </Text>
            </TouchableOpacity>
          )}
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
          {!item.error && !item.pending && (
            <TouchableOpacity
              style={styles.speakButton}
              onPress={() => onCompare(item.original, item.translated)}
              accessibilityRole="button"
              accessibilityLabel="Compare translations from different engines"
            >
              <Text style={[styles.compareIcon, { color: colors.dimText }]}>⇔</Text>
            </TouchableOpacity>
          )}
          {!item.error && !item.pending && (
            <TouchableOpacity
              style={styles.speakButton}
              onPress={() => onCorrection({ index: realIndex, original: item.original, translated: item.translated })}
              accessibilityRole="button"
              accessibilityLabel="Suggest a better translation"
            >
              <Text style={[{ fontSize: 14, color: colors.dimText }]}>✏️</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

export default React.memo(TranslationBubble);

const styles = StyleSheet.create({
  historyItem: {
    marginBottom: 16,
  },
  bubble: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 6,
  },
  translatedBubble: {
    borderLeftWidth: 3,
  },
  originalText: {
    fontSize: 16,
    lineHeight: 22,
  },
  detectedLangBadge: {
    fontSize: 11,
    fontWeight: "600",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: "flex-start",
    marginTop: 4,
    overflow: "hidden",
  },
  translatedTextHistory: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "500",
  },
  tappableWord: {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
  },
  copiedBadge: {
    color: "#4ade80",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  pendingBadge: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  bubbleActions: {
    flexDirection: "row",
    alignSelf: "flex-end",
    alignItems: "center",
    marginTop: 6,
    gap: 12,
  },
  wordCountBubble: {
    fontSize: 10,
    fontWeight: "500",
    marginRight: "auto",
  },
  timestampText: {
    fontSize: 10,
    fontWeight: "400",
    marginRight: 4,
  },
  speakButton: {
    padding: 4,
  },
  speakIcon: {
    fontSize: 18,
  },
  speakIconActive: {
    opacity: 0.6,
  },
  favoriteButton: {
    padding: 4,
  },
  favoriteIcon: {
    fontSize: 18,
  },
  favoriteIconActive: {
    color: "#ffd700",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 4,
  },
  retryIcon: {
    fontSize: 18,
    color: "#6c63ff",
    fontWeight: "700",
  },
  retryText: {
    fontSize: 13,
    fontWeight: "700",
  },
  compareIcon: {
    fontSize: 16,
    fontWeight: "700",
  },
});
