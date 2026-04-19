import React, { useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  StyleSheet,
  Animated,
} from "react-native";
import type { ThemeColors } from "../theme";
import type { HistoryItem } from "../types";
import { LANGUAGE_MAP } from "../services/translation";
import { needsRomanization } from "../services/romanization";
import type { OfflinePhrase, PhraseCategory } from "../services/offlinePhrases";
import AlignedRomanization from "./AlignedRomanization";
import SwipeableRow from "./SwipeableRow";
import TranslationBubble from "./TranslationBubble";
import ChatBubble from "./ChatBubble";
import { Platform } from "react-native";
import { useHistoryActionsContext } from "../contexts/HistoryActionsContext";
import { useHistoryDisplay } from "../contexts/HistoryDisplayContext";
import { useSelectState } from "../contexts/SelectStateContext";

type DynamicFontSizes = {
  original: { fontSize: number };
  translated: { fontSize: number };
  liveOriginal: { fontSize: number };
  liveTranslated: { fontSize: number };
  chatText: { fontSize: number };
};

interface HistoryListProps {
  history: HistoryItem[];
  filteredHistory: HistoryItem[];
  colors: ThemeColors;
  dynamicFontSizes: DynamicFontSizes;
  fontScale: number;
  conversationMode: boolean;
  copiedText: string | null;
  speakingText: string | null;
  sourceLang: { code: string; name: string; speechCode: string };
  targetLang: { code: string; name: string; speechCode: string };
  isListening: boolean;
  isTranslating: boolean;
  liveText: string;
  translatedText: string;
  lastDetectedLang: string | null | undefined;
  skeletonAnim: Animated.Value;
  phraseOfTheDay: {
    potd: { phrase: OfflinePhrase; category: PhraseCategory };
    categoryInfo?: { key: PhraseCategory; label: string; icon: string };
  } | null;
}

// Memoized standard bubble row — subscribes to HistoryActionsContext so the row can
// skip re-renders even when parent HistoryList re-computes closures. SwipeableRow's
// onDelete is memoized per realIndex inside the row instead of being an inline
// closure inside renderHistoryItem.
const HistoryItemRow = React.memo(function HistoryItemRow({
  item,
  realIndex,
  colors,
  dynamicFontSizes,
  showRomanization,
  fontScale,
  confidenceThreshold,
  copiedText,
  speakingText,
  targetSpeechCode,
  searchQuery,
}: {
  item: HistoryItem;
  realIndex: number;
  colors: ThemeColors;
  dynamicFontSizes: DynamicFontSizes;
  showRomanization: boolean;
  fontScale: number;
  confidenceThreshold: number;
  copiedText: string | null;
  speakingText: string | null;
  targetSpeechCode: string;
  searchQuery: string;
}) {
  const {
    onDeleteHistoryItem,
    onCopyToClipboard,
    onSpeakText,
    onToggleFavorite,
    onRetryTranslation,
    onCompareTranslation,
    onCorrection,
    onWordLongPress,
    onShowPassenger,
    onShareCard,
  } = useHistoryActionsContext();
  const handleDelete = useCallback(() => onDeleteHistoryItem(realIndex), [onDeleteHistoryItem, realIndex]);
  return (
    <SwipeableRow onDelete={handleDelete} colors={colors}>
      <TranslationBubble
        item={item}
        realIndex={realIndex}
        colors={colors}
        dynamicFontSizes={dynamicFontSizes}
        showRomanization={showRomanization}
        fontSizeScale={fontScale}
        confidenceThreshold={confidenceThreshold}
        copiedText={copiedText}
        speakingText={speakingText}
        targetSpeechCode={targetSpeechCode}
        onCopy={onCopyToClipboard}
        onSpeak={onSpeakText}
        onToggleFavorite={onToggleFavorite}
        onRetry={onRetryTranslation}
        onCompare={onCompareTranslation}
        onCorrection={onCorrection}
        onWordLongPress={onWordLongPress}
        onShowPassenger={onShowPassenger}
        onDismiss={onDeleteHistoryItem}
        onShareCard={onShareCard}
        searchQuery={searchQuery}
      />
    </SwipeableRow>
  );
});

// Memoized chat mode row — mirrors HistoryItemRow but wraps ChatBubble.
const ChatBubbleRow = React.memo(function ChatBubbleRow({
  item,
  realIndex,
  colors,
  dynamicFontSizes,
  showRomanization,
  fontScale,
  confidenceThreshold,
  copiedText,
  speakingText,
  speakLang,
  sourceLangName,
  targetLangName,
  searchQuery,
}: {
  item: HistoryItem;
  realIndex: number;
  colors: ThemeColors;
  dynamicFontSizes: DynamicFontSizes;
  showRomanization: boolean;
  fontScale: number;
  confidenceThreshold: number;
  copiedText: string | null;
  speakingText: string | null;
  speakLang: string;
  sourceLangName: string;
  targetLangName: string;
  searchQuery: string;
}) {
  const {
    onDeleteHistoryItem,
    onCopyToClipboard,
    onSpeakText,
    onToggleFavorite,
  } = useHistoryActionsContext();
  const handleDelete = useCallback(() => onDeleteHistoryItem(realIndex), [onDeleteHistoryItem, realIndex]);
  return (
    <SwipeableRow onDelete={handleDelete} colors={colors}>
      <ChatBubble
        item={item}
        realIndex={realIndex}
        colors={colors}
        dynamicFontSizes={dynamicFontSizes}
        showRomanization={showRomanization}
        fontSizeScale={fontScale}
        confidenceThreshold={confidenceThreshold}
        copiedText={copiedText}
        speakingText={speakingText}
        speakLang={speakLang}
        sourceLangName={sourceLangName}
        targetLangName={targetLangName}
        onCopy={onCopyToClipboard}
        onSpeak={onSpeakText}
        onToggleFavorite={onToggleFavorite}
        searchQuery={searchQuery}
      />
    </SwipeableRow>
  );
});

// Memoized select mode row to avoid re-renders when selectMode is active
const SelectRow = React.memo(function SelectRow({
  item,
  realIndex,
  isSelected,
  colors,
  onToggleSelectItem,
}: {
  item: HistoryItem;
  realIndex: number;
  isSelected: boolean;
  colors: ThemeColors;
  onToggleSelectItem: (index: number) => void;
}) {
  const handlePress = useCallback(() => onToggleSelectItem(realIndex), [onToggleSelectItem, realIndex]);
  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={styles.selectRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={`Select translation: ${item.original}`}
    >
      <View
        style={[
          styles.selectCheckbox,
          { borderColor: colors.border },
          isSelected && {
            backgroundColor: colors.primary,
            borderColor: colors.primary,
          },
        ]}
      >
        {isSelected && (
          <Text
            style={[
              styles.selectCheckmark,
              { color: colors.destructiveText },
            ]}
          >
            ✓
          </Text>
        )}
      </View>
      <View style={styles.selectContent}>
        <Text
          style={[{ color: colors.secondaryText, fontSize: 14 }]}
          numberOfLines={1}
        >
          {item.original}
        </Text>
        <Text
          style={[{ color: colors.translatedText, fontSize: 14 }]}
          numberOfLines={1}
        >
          {item.translated}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const LiveTranslationFooter = React.memo(function LiveTranslationFooter({
  liveText,
  translatedText,
  isListening,
  isTranslating,
  colors,
  dynamicFontSizes,
  showRomanization,
  sourceLang,
  targetLang,
  lastDetectedLang,
  copiedText,
  speakingText,
  skeletonAnim,
}: {
  liveText: string;
  translatedText: string;
  isListening: boolean;
  isTranslating: boolean;
  colors: ThemeColors;
  dynamicFontSizes: DynamicFontSizes;
  showRomanization: boolean;
  sourceLang: { code: string; name: string; speechCode: string };
  targetLang: { code: string; name: string; speechCode: string };
  lastDetectedLang: string | null | undefined;
  copiedText: string | null;
  speakingText: string | null;
  skeletonAnim: Animated.Value;
}) {
  const { onCopyToClipboard, onSpeakText } = useHistoryActionsContext();
  const handleCopy = useCallback(() => onCopyToClipboard(translatedText), [onCopyToClipboard, translatedText]);
  const handleSpeak = useCallback(() => onSpeakText(translatedText, targetLang.speechCode), [onSpeakText, translatedText, targetLang.speechCode]);

  return (
    <View style={styles.liveSection} accessibilityLiveRegion="polite">
      <View style={styles.liveDivider}>
        <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        <Text style={[styles.liveLabel, { color: colors.destructiveBg }]}>
          {isListening ? "● LIVE" : "PROCESSING"}
          {sourceLang.code === "autodetect" && lastDetectedLang
            ? ` · ${LANGUAGE_MAP.get(lastDetectedLang!)?.name || lastDetectedLang}`
            : ""}
        </Text>
        <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
      </View>

      <View
        style={[
          styles.bubble,
          styles.liveBubble,
          { backgroundColor: colors.liveBubbleBg, borderColor: colors.border },
        ]}
      >
        <Text
          style={[
            styles.liveOriginalText,
            { color: colors.liveOriginalText },
            dynamicFontSizes.liveOriginal,
          ]}
        >
          {liveText}
        </Text>
        {showRomanization && needsRomanization(sourceLang.code) && (
          <AlignedRomanization
            text={liveText}
            langCode={sourceLang.code}
            textColor={colors.liveOriginalText}
            romanColor={colors.mutedText}
            fontSize={18}
          />
        )}
      </View>

      {translatedText ? (
        <View
          style={[
            styles.bubble,
            styles.liveTranslatedBubble,
            {
              backgroundColor: colors.liveTranslatedBubbleBg,
              borderColor: colors.border,
              borderLeftColor: colors.primary,
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleCopy}
            accessibilityRole="button"
            accessibilityLabel={`Live translation: ${translatedText}. Tap to copy.`}
            accessibilityHint="Copies the live translation to clipboard"
          >
            <Text
              style={[
                styles.liveTranslatedText,
                { color: colors.liveTranslatedText },
                dynamicFontSizes.liveTranslated,
              ]}
            >
              {translatedText}
            </Text>
            {showRomanization && needsRomanization(targetLang.code) && (
              <AlignedRomanization
                text={translatedText}
                langCode={targetLang.code}
                textColor={colors.liveTranslatedText}
                romanColor={colors.mutedText}
                fontSize={20}
              />
            )}
            {copiedText === translatedText && (
              <Text style={[styles.copiedBadge, { color: colors.successText }]}>
                Copied!
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.speakButton}
            onPress={handleSpeak}
            accessibilityRole="button"
            accessibilityLabel={
              speakingText === translatedText
                ? "Stop speaking"
                : `Speak translation: ${translatedText}`
            }
            accessibilityHint={speakingText === translatedText ? "Stops text-to-speech playback" : "Reads the translation aloud"}
          >
            <Text
              style={[
                styles.speakIcon,
                speakingText === translatedText && styles.speakIconActive,
              ]}
            >
              {speakingText === translatedText ? "⏹" : "🔊"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : isTranslating ? (
        <View
          style={[
            styles.bubble,
            styles.liveTranslatedBubble,
            {
              backgroundColor: colors.liveTranslatedBubbleBg,
              borderColor: colors.border,
              borderLeftColor: colors.primary,
            },
          ]}
          accessibilityLabel="Translation loading"
          accessibilityRole="progressbar"
        >
          <Animated.View
            style={[
              styles.skeletonLine,
              styles.skeletonLong,
              { opacity: skeletonAnim, backgroundColor: colors.skeleton },
            ]}
          />
          <Animated.View
            style={[
              styles.skeletonLine,
              styles.skeletonShort,
              { opacity: skeletonAnim, backgroundColor: colors.skeleton },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
});

function HistoryList({
  history,
  filteredHistory,
  colors,
  dynamicFontSizes,
  fontScale,
  conversationMode,
  copiedText,
  speakingText,
  sourceLang,
  targetLang,
  isListening,
  isTranslating,
  liveText,
  translatedText,
  lastDetectedLang,
  skeletonAnim,
  phraseOfTheDay,
}: HistoryListProps) {
  const {
    onCopyToClipboard,
    onSpeakText,
    onToggleSelectItem,
    onSearchChange,
    onToggleFavoritesOnly,
    onLoadMoreHistory,
  } = useHistoryActionsContext();
  const {
    searchQuery,
    showFavoritesOnly,
    hasFavorites,
    hasMoreHistory,
    confidenceThreshold,
    autoScroll,
    showRomanization,
  } = useHistoryDisplay();
  const { selectMode, selectedIndices } = useSelectState();
  const listRef = useRef<FlatList>(null);

  const keyExtractor = useCallback(
    (item: HistoryItem, index: number) => {
      // Prefer the stable id backfilled by migrateHistoryItem / newHistoryId
      // so React reconciliation survives deletions and reorders. Fall back to
      // the legacy composite key only for items that somehow slipped through
      // without an id (shouldn't happen post-migration, defensive).
      if (item.id) return item.id;
      return item.timestamp
        ? `${item.timestamp}-${index}-${item.original.slice(0, 16)}`
        : `${index}-${item.original.slice(0, 20)}`;
    },
    []
  );

  // Pre-build a map from filtered items to their real history index
  // so renderHistoryItem avoids O(n) findIndex per row during search
  const filteredToRealIndex = useMemo(() => {
    if (!searchQuery.trim()) return null; // not needed — filtered index === real index
    const map = new Map<HistoryItem, number>();
    for (let i = 0; i < history.length; i++) {
      map.set(history[i], i);
    }
    return map;
  }, [searchQuery, history]);

  // Auto-scroll when new items arrive
  React.useEffect(() => {
    if (autoScroll && (history.length > 0 || liveText)) {
      const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
      return () => clearTimeout(timer);
    }
  }, [history, liveText, translatedText, autoScroll]);

  const sourceSpeechCode = sourceLang.speechCode;
  const targetSpeechCode = targetLang.speechCode;
  const sourceLangName = sourceLang.name;
  const targetLangName = targetLang.name;

  const renderHistoryItem = useCallback(
    ({ item, index }: { item: HistoryItem; index: number }) => {
      const isB = item.speaker === "B";
      const speakLang = isB ? sourceSpeechCode : targetSpeechCode;
      const realIndex = filteredToRealIndex
        ? (filteredToRealIndex.get(item) ?? index)
        : index;

      if (selectMode) {
        return (
          <SelectRow
            item={item}
            realIndex={realIndex}
            isSelected={selectedIndices.has(realIndex)}
            colors={colors}
            onToggleSelectItem={onToggleSelectItem}
          />
        );
      }

      if (conversationMode && item.speaker) {
        return (
          <ChatBubbleRow
            item={item}
            realIndex={realIndex}
            colors={colors}
            dynamicFontSizes={dynamicFontSizes}
            showRomanization={showRomanization}
            fontScale={fontScale}
            confidenceThreshold={confidenceThreshold}
            copiedText={copiedText}
            speakingText={speakingText}
            speakLang={speakLang}
            sourceLangName={sourceLangName}
            targetLangName={targetLangName}
            searchQuery={searchQuery}
          />
        );
      }

      return (
        <HistoryItemRow
          item={item}
          realIndex={realIndex}
          colors={colors}
          dynamicFontSizes={dynamicFontSizes}
          showRomanization={showRomanization}
          fontScale={fontScale}
          confidenceThreshold={confidenceThreshold}
          copiedText={copiedText}
          speakingText={speakingText}
          targetSpeechCode={targetSpeechCode}
          searchQuery={searchQuery}
        />
      );
    },
    [
      conversationMode,
      selectMode,
      selectedIndices,
      colors,
      dynamicFontSizes,
      showRomanization,
      fontScale,
      confidenceThreshold,
      copiedText,
      speakingText,
      sourceSpeechCode,
      targetSpeechCode,
      sourceLangName,
      targetLangName,
      searchQuery,
      filteredToRealIndex,
      onToggleSelectItem,
    ]
  );

  const listHeader = useMemo(() => {
    if (history.length <= 2 || isListening) return null;
    return (
      <View>
        {hasMoreHistory && (
          <TouchableOpacity
            style={[
              styles.loadMoreButton,
              { backgroundColor: colors.cardBg, borderColor: colors.border },
            ]}
            onPress={onLoadMoreHistory}
            accessibilityRole="button"
            accessibilityLabel="Load older translations"
          >
            <Text style={[styles.loadMoreText, { color: colors.primary }]}>
              Load older translations
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.searchRow}>
          <TextInput
            style={[
              styles.searchInput,
              {
                backgroundColor: colors.bubbleBg,
                color: colors.primaryText,
                borderColor: colors.border,
              },
            ]}
            placeholder="Search translations..."
            placeholderTextColor={colors.placeholderText}
            value={searchQuery}
            onChangeText={onSearchChange}
            accessibilityLabel="Search translation history"
            accessibilityHint="Filter translations by original or translated text"
            returnKeyType="search"
          />
          {searchQuery.trim() ? (
            <Text
              style={[styles.searchCount, { color: colors.dimText }]}
              accessibilityLiveRegion="polite"
            >
              {filteredHistory.length}
            </Text>
          ) : null}
          {searchQuery ? (
            <TouchableOpacity
              style={styles.searchClear}
              onPress={() => onSearchChange("")}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Text
                style={[styles.searchClearText, { color: colors.mutedText }]}
              >
                ✕
              </Text>
            </TouchableOpacity>
          ) : null}
          {hasFavorites ? (
            <TouchableOpacity
              style={[
                styles.favFilterButton,
                {
                  backgroundColor: colors.bubbleBg,
                  borderColor: colors.border,
                },
                showFavoritesOnly && {
                  backgroundColor: colors.cardBg,
                  borderColor: colors.favoriteColor,
                },
              ]}
              onPress={onToggleFavoritesOnly}
              accessibilityRole="button"
              accessibilityLabel={
                showFavoritesOnly
                  ? "Show all translations"
                  : "Show favorites only"
              }
              accessibilityState={{ selected: showFavoritesOnly }}
            >
              <Text
                style={[styles.favFilterIcon, { color: colors.favoriteColor }]}
              >
                {showFavoritesOnly ? "★" : "☆"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }, [
    history.length,
    filteredHistory.length,
    isListening,
    hasMoreHistory,
    colors,
    searchQuery,
    hasFavorites,
    showFavoritesOnly,
    onSearchChange,
    onLoadMoreHistory,
    onToggleFavoritesOnly,
  ]);

  const listFooter = liveText ? (
    <LiveTranslationFooter
      liveText={liveText}
      translatedText={translatedText}
      isListening={isListening}
      isTranslating={isTranslating}
      colors={colors}
      dynamicFontSizes={dynamicFontSizes}
      showRomanization={showRomanization}
      sourceLang={sourceLang}
      targetLang={targetLang}
      lastDetectedLang={lastDetectedLang}
      copiedText={copiedText}
      speakingText={speakingText}
      skeletonAnim={skeletonAnim}
    />
  ) : null;

  const listEmpty = useMemo(() => {
    if (isListening || liveText) return null;
    return (
      <View style={styles.emptyState} accessible={true} accessibilityRole="summary" accessibilityLabel="No translations yet. Tap the microphone to start translating. Speak naturally and see translations appear in real time.">
        <Text style={styles.emptyIcon} importantForAccessibility="no">🎙️</Text>
        <Text style={[styles.emptyTitle, { color: colors.titleText }]} importantForAccessibility="no">
          Tap to start translating
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.dimText }]} importantForAccessibility="no">
          Speak naturally and see translations appear in real time
        </Text>
        {phraseOfTheDay && (
          <View
            style={[
              styles.phraseOfDay,
              { backgroundColor: colors.cardBg, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.phraseOfDayLabel, { color: colors.dimText }]}>
              {phraseOfTheDay.categoryInfo?.icon || "💬"} Phrase of the Day
            </Text>
            <Text
              style={[styles.phraseOfDayText, { color: colors.titleText }]}
            >
              {phraseOfTheDay.potd.phrase.en}
            </Text>
            <Text
              style={[
                styles.phraseOfDayTranslation,
                { color: colors.primaryText },
              ]}
            >
              {phraseOfTheDay.potd.phrase[targetLang.code as keyof OfflinePhrase] ||
                phraseOfTheDay.potd.phrase.es}
            </Text>
          </View>
        )}
        <View style={styles.gestureHints} accessible={true} accessibilityLabel="Swipe up for phrasebook, swipe down to speak">
          <Text style={[styles.gestureHintText, { color: colors.dimText }]} importantForAccessibility="no">
            Swipe up for phrasebook  ·  Swipe down to speak
          </Text>
        </View>
      </View>
    );
  }, [isListening, liveText, colors, phraseOfTheDay, targetLang.code]);

  return (
    <FlatList
      ref={listRef}
      style={styles.scrollArea}
      contentContainerStyle={styles.scrollContent}
      data={filteredHistory}
      keyExtractor={keyExtractor}
      keyboardDismissMode="on-drag"
      removeClippedSubviews={Platform.OS !== "web"}
      maxToRenderPerBatch={15}
      windowSize={7}
      initialNumToRender={10}
      ListHeaderComponent={listHeader}
      renderItem={renderHistoryItem}
      ListFooterComponent={listFooter}
      ListEmptyComponent={listEmpty}
    />
  );
}

export default React.memo(HistoryList);

const styles = StyleSheet.create({
  scrollArea: { flex: 1, marginBottom: 10 },
  scrollContent: { paddingBottom: 20, flexGrow: 1 },
  searchRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  searchInput: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
    fontSize: 14,
    borderWidth: 1,
  },
  searchCount: { fontSize: 12, fontWeight: "700", marginLeft: 6, minWidth: 20, textAlign: "center" },
  searchClear: { marginLeft: 4, padding: 4 },
  searchClearText: { fontSize: 16, fontWeight: "700" },
  loadMoreButton: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  loadMoreText: { fontSize: 13, fontWeight: "600" },
  favFilterButton: {
    marginLeft: 8,
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  favFilterIcon: { fontSize: 18, color: "#ffd700" },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 12,
  },
  selectCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  selectCheckmark: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  selectContent: { flex: 1, gap: 2 },
  bubble: { borderRadius: 16, padding: 14, marginBottom: 6 },
  copiedBadge: {
    color: "#4ade80",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  liveSection: { marginTop: 8 },
  liveDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 10,
  },
  dividerLine: { flex: 1, height: 1 },
  liveLabel: {
    color: "#ff4757",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  liveBubble: { borderWidth: 1 },
  liveOriginalText: { fontSize: 18, lineHeight: 26 },
  liveTranslatedBubble: { borderLeftWidth: 3, borderWidth: 1 },
  liveTranslatedText: { fontSize: 20, lineHeight: 28, fontWeight: "600" },
  skeletonLine: { height: 14, borderRadius: 7, marginBottom: 8 },
  skeletonLong: { width: "80%" },
  skeletonShort: { width: "50%", marginBottom: 0 },
  speakButton: { padding: 4 },
  speakIcon: { fontSize: 18 },
  speakIconActive: { opacity: 0.6 },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 60,
  },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  emptySubtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 40,
  },
  phraseOfDay: {
    marginTop: 24,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    width: "80%",
  },
  phraseOfDayLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  phraseOfDayText: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
    textAlign: "center",
  },
  phraseOfDayTranslation: {
    fontSize: 16,
    fontStyle: "italic",
    textAlign: "center",
  },
  gestureHints: {
    marginTop: 20,
    alignItems: "center",
  },
  gestureHintText: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
});
