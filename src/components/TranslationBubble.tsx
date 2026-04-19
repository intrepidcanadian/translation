import React, { useCallback, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Share, LayoutAnimation, Platform, UIManager } from "react-native";
import AlignedRomanization from "./AlignedRomanization";
import { formatRelativeTime } from "../utils/formatRelativeTime";
import { highlightMatches } from "../utils/highlightText";
import { countWords } from "../utils/wordCount";
import { LANGUAGE_MAP } from "../services/translation";
import { logger } from "../services/logger";
import type { ThemeColors } from "../theme";
import type { HistoryItem } from "../types";

interface WordSegmentProps {
  segment: { key: number; text: string; isWord: true; cleaned?: string };
  targetLangCode: string;
  sourceLangCode: string;
  onWordLongPress: (word: string, targetLang: string, sourceLang: string) => void;
}

const WordSegment = React.memo(function WordSegment({
  segment,
  targetLangCode,
  sourceLangCode,
  onWordLongPress,
}: WordSegmentProps) {
  const handleLongPress = useCallback(() => {
    if (segment.cleaned) onWordLongPress(segment.cleaned, targetLangCode, sourceLangCode);
  }, [segment.cleaned, targetLangCode, sourceLangCode, onWordLongPress]);

  return (
    <Text
      key={segment.key}
      onLongPress={handleLongPress}
      style={styles.tappableWord}
    >
      {segment.text}
    </Text>
  );
});

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
  confidenceThreshold: number;
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
  onShowPassenger?: (index: number) => void;
  onDismiss?: (index: number) => void;
  onShareCard?: (index: number) => void;
  searchQuery?: string;
}

function TranslationBubble({
  item,
  realIndex,
  colors,
  dynamicFontSizes,
  showRomanization,
  fontSizeScale,
  confidenceThreshold,
  copiedText,
  speakingText,
  targetSpeechCode,
  onCopy,
  onSpeak,
  onToggleFavorite,
  onRetry,
  onCompare,
  onCorrection,
  onShowPassenger,
  onDismiss,
  onShareCard,
  onWordLongPress,
  searchQuery,
}: TranslationBubbleProps) {
  const [showMoreActions, setShowMoreActions] = useState(false);
  const timeStr = formatRelativeTime(item.timestamp);
  const originalWordCount = useMemo(() => countWords(item.original), [item.original]);
  const translatedWordCount = useMemo(() => countWords(item.translated), [item.translated]);

  // Memoize word-split segments to avoid re-creating arrays on every render
  const translatedWordSegments = React.useMemo(() => {
    if (item.status === "error" || item.status === "pending" || !item.sourceLangCode || !item.targetLangCode) return null;
    return item.translated.split(/(\s+)/).map((segment: string, si: number) => {
      if (/\s+/.test(segment)) return { key: si, text: segment, isWord: false as const };
      const cleaned = segment.replace(/[^\p{L}\p{N}]/gu, "");
      return { key: si, text: segment, isWord: true as const, cleaned };
    });
  }, [item.translated, item.status, item.sourceLangCode, item.targetLangCode]);

  const handleShare = useCallback(() => {
    const srcName = item.sourceLangCode ? LANGUAGE_MAP.get(item.sourceLangCode)?.name : null;
    const tgtName = item.targetLangCode ? LANGUAGE_MAP.get(item.targetLangCode)?.name : null;
    const langLine = srcName && tgtName ? `${srcName} → ${tgtName}` : "";
    const card = [
      `"${item.original}"`,
      "",
      `→ "${item.translated}"`,
      "",
      langLine,
      "— Live Translator",
    ].filter(Boolean).join("\n");
    Share.share({ message: card }).catch((err) => logger.warn("Translation", "Share failed", err));
  }, [item.original, item.translated, item.sourceLangCode, item.targetLangCode]);

  const toggleMoreActions = useCallback(() => {
    if (Platform.OS === "android") {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowMoreActions((prev) => !prev);
  }, []);

  // Memoize inline closures so TouchableOpacity children receive stable onPress
  // identity — avoids re-rendering every button when the parent re-renders for
  // copiedText/speakingText changes.
  const handleDismiss = useCallback(() => onDismiss?.(realIndex), [onDismiss, realIndex]);
  const handleCopyOriginal = useCallback(() => onCopy(item.original), [onCopy, item.original]);
  const handleCopyTranslated = useCallback(() => onCopy(item.translated), [onCopy, item.translated]);
  const handleSpeak = useCallback(() => onSpeak(item.translated, targetSpeechCode), [onSpeak, item.translated, targetSpeechCode]);
  const handleToggleFavorite = useCallback(() => onToggleFavorite(realIndex), [onToggleFavorite, realIndex]);
  const handleRetry = useCallback(() => onRetry(realIndex), [onRetry, realIndex]);
  const handleCompare = useCallback(() => onCompare(item.original, item.translated), [onCompare, item.original, item.translated]);
  const handleCorrection = useCallback(() => onCorrection({ index: realIndex, original: item.original, translated: item.translated }), [onCorrection, realIndex, item.original, item.translated]);
  const handleShowPassenger = useCallback(() => onShowPassenger?.(realIndex), [onShowPassenger, realIndex]);
  const handleShareCard = useCallback(() => onShareCard ? onShareCard(realIndex) : handleShare(), [onShareCard, realIndex, handleShare]);

  return (
    <View style={styles.historyItem}>
      {/* Dismiss button in top-right corner */}
      {onDismiss && (
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={handleDismiss}
          accessibilityRole="button"
          accessibilityLabel="Remove this translation"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.dismissIcon, { color: colors.mutedText }]}>✕</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={handleCopyOriginal}
        style={[styles.bubble, { backgroundColor: colors.bubbleBg }]}
        accessibilityRole="button"
        accessibilityLabel={`Original: ${item.original}. Tap to copy.`}
      >
        <Text selectable style={[styles.originalText, { color: colors.secondaryText }, dynamicFontSizes.original]}>
          {searchQuery?.trim()
            ? highlightMatches(item.original, searchQuery, { color: colors.secondaryText }, { backgroundColor: colors.primary + "30", color: colors.primaryText, borderRadius: 2 })
            : item.original}
        </Text>
        {item.detectedLang && (() => {
          const lang = LANGUAGE_MAP.get(item.detectedLang!);
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
      <View style={[styles.bubble, styles.translatedBubble, { backgroundColor: colors.translatedBubbleBg, borderLeftColor: item.status === "error" ? colors.errorBorder : item.status === "pending" ? colors.offlineText : colors.primary }]}>
        <TouchableOpacity
          onPress={handleCopyTranslated}
          accessibilityRole="button"
          accessibilityLabel={item.status === "error" ? `Translation failed: ${item.translated}` : item.status === "pending" ? `Queued for translation when online` : `Translation: ${item.translated}. Tap to copy. Long-press a word for alternatives.`}
          disabled={item.status === "pending" || item.status === "error"}
        >
          {item.status === "pending" && (
            <Text style={[styles.pendingBadge, { color: colors.offlineText }]}>
              Queued offline
            </Text>
          )}
          {item.status === "error" && (
            <Text style={[styles.pendingBadge, { color: colors.errorText }]}>
              Failed
            </Text>
          )}
          <Text selectable={item.status !== "pending" && item.status !== "error"} style={[styles.translatedTextHistory, { color: item.status === "error" ? colors.errorText : item.status === "pending" ? colors.dimText : colors.translatedText }, dynamicFontSizes.translated, (item.status === "pending" || item.status === "error") && { fontStyle: "italic" }]}>
            {translatedWordSegments
              ? translatedWordSegments.map((seg) =>
                  !seg.isWord ? seg.text : (
                    <WordSegment
                      key={seg.key}
                      segment={seg}
                      targetLangCode={item.targetLangCode!}
                      sourceLangCode={item.sourceLangCode!}
                      onWordLongPress={onWordLongPress}
                    />
                  )
                )
              : item.translated
            }
          </Text>
          {showRomanization && item.status !== "error" && item.status !== "pending" && item.targetLangCode && (
            <AlignedRomanization text={item.translated} langCode={item.targetLangCode} textColor={colors.translatedText} romanColor={colors.mutedText} />
          )}
          {confidenceThreshold > 0 && item.confidence != null && Math.round(item.confidence * 100) < confidenceThreshold && item.status !== "error" && item.status !== "pending" && (
            <Text style={[styles.lowConfidenceBadge, { color: colors.warningText, backgroundColor: colors.warningBg }]}>
              ⚠ Low confidence ({Math.round(item.confidence * 100)}%) — consider verifying
            </Text>
          )}
          {copiedText === item.translated && (
            <Text style={[styles.copiedBadge, { color: colors.successText }]}>Copied!</Text>
          )}
        </TouchableOpacity>
        {/* Primary actions row — always visible */}
        <View style={styles.bubbleActions}>
          {item.status !== "error" && item.status !== "pending" && (
            <Text style={[styles.wordCountBubble, { color: colors.dimText }]}>
              {originalWordCount} → {translatedWordCount}
              {item.confidence != null ? ` · ${Math.round(item.confidence * 100)}%` : ""}
              {timeStr ? ` · ${timeStr}` : ""}
            </Text>
          )}
          {item.status === "error" && timeStr ? (
            <Text style={[styles.timestampText, { color: colors.dimText }]}>{timeStr}</Text>
          ) : null}
          {item.status === "error" ? (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={handleRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry translation"
            >
              <Text style={[styles.retryIcon, { color: colors.primary }]}>↻</Text>
              <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleSpeak}
              accessibilityRole="button"
              accessibilityLabel={speakingText === item.translated ? "Stop speaking" : `Speak translation`}
            >
              <Text style={[styles.speakIcon, speakingText === item.translated && styles.speakIconActive]}>
                {speakingText === item.translated ? "⏹" : "🔊"}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleToggleFavorite}
            accessibilityRole="button"
            accessibilityLabel={item.favorited ? "Remove from favorites" : "Add to favorites"}
          >
            <Text style={[styles.favoriteIcon, { color: colors.dimText }, item.favorited && { color: colors.favoriteColor }]}>
              {item.favorited ? "★" : "☆"}
            </Text>
          </TouchableOpacity>
          {/* Overflow toggle for secondary actions */}
          {item.status !== "error" && item.status !== "pending" && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={toggleMoreActions}
              accessibilityRole="button"
              accessibilityLabel={showMoreActions ? "Hide more actions" : "Show more actions"}
            >
              <Text style={[styles.moreIcon, { color: colors.dimText }]}>•••</Text>
            </TouchableOpacity>
          )}
        </View>
        {/* Secondary actions — shown on overflow tap */}
        {showMoreActions && item.status !== "error" && item.status !== "pending" && (
          <View style={[styles.secondaryActions, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleCompare}
              accessibilityRole="button"
              accessibilityLabel="Compare translations"
            >
              <Text style={[styles.secondaryButtonIcon, { color: colors.dimText }]}>⇔</Text>
              <Text style={[styles.secondaryButtonLabel, { color: colors.dimText }]}>Compare</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleCorrection}
              accessibilityRole="button"
              accessibilityLabel="Suggest correction"
            >
              <Text style={[styles.secondaryButtonIcon, { color: colors.dimText }]}>✏️</Text>
              <Text style={[styles.secondaryButtonLabel, { color: colors.dimText }]}>Correct</Text>
            </TouchableOpacity>
            {onShowPassenger && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleShowPassenger}
                accessibilityRole="button"
                accessibilityLabel="Show to passenger"
              >
                <Text style={[styles.secondaryButtonIcon, { color: colors.dimText }]}>👁️</Text>
                <Text style={[styles.secondaryButtonLabel, { color: colors.dimText }]}>Show</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleShareCard}
              accessibilityRole="button"
              accessibilityLabel="Share translation"
            >
              <Text style={[styles.secondaryButtonIcon, { color: colors.dimText }]}>↗</Text>
              <Text style={[styles.secondaryButtonLabel, { color: colors.dimText }]}>Share</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

export default React.memo(TranslationBubble);

const styles = StyleSheet.create({
  historyItem: {
    marginBottom: 16,
    position: "relative",
  },
  dismissButton: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dismissIcon: {
    fontSize: 14,
    fontWeight: "600",
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
  lowConfidenceBadge: {
    fontSize: 11,
    fontWeight: "600",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
    marginTop: 6,
    overflow: "hidden",
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
    alignItems: "center",
    marginTop: 8,
    gap: 14,
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
  actionButton: {
    padding: 4,
  },
  speakIcon: {
    fontSize: 18,
  },
  speakIconActive: {
    opacity: 0.6,
  },
  favoriteIcon: {
    fontSize: 18,
  },
  moreIcon: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1,
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
  secondaryActions: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 2,
  },
  secondaryButtonIcon: {
    fontSize: 16,
  },
  secondaryButtonLabel: {
    fontSize: 10,
    fontWeight: "500",
  },
});
