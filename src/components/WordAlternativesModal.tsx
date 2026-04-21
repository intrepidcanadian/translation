import React, { useCallback } from "react";
import { Modal, View, Text, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import type { ThemeColors } from "../theme";
import { modalStyles } from "../styles/modalStyles";

interface Alternative {
  translation: string;
  source: string;
  quality: number;
}

interface WordAlternativesModalProps {
  visible: boolean;
  data: {
    word: string;
    loading: boolean;
    alternatives: Alternative[];
  } | null;
  onClose: () => void;
  onCopy: (text: string) => void;
  copiedText: string | null;
  colors: ThemeColors;
}

const AlternativeRow = React.memo(function AlternativeRow({
  alt,
  onCopy,
  colors,
}: {
  alt: Alternative;
  onCopy: (text: string) => void;
  colors: ThemeColors;
}) {
  const handleCopy = useCallback(() => onCopy(alt.translation), [onCopy, alt.translation]);
  return (
    <TouchableOpacity
      style={[styles.altRow, { borderBottomColor: colors.borderLight }]}
      onPress={handleCopy}
      accessibilityRole="button"
      accessibilityLabel={`Alternative: ${alt.translation}${alt.quality > 0 ? `, ${alt.quality}% quality` : ""}`}
      accessibilityHint="Tap to copy this alternative translation"
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.altTranslation, { color: colors.translatedText }]}>{alt.translation}</Text>
        <Text style={[styles.altSource, { color: colors.dimText }]}>{alt.source}</Text>
      </View>
      {alt.quality > 0 && (
        <View
          style={[styles.altQualityBadge, { backgroundColor: colors.primary + "22" }]}
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[styles.altQualityText, { color: colors.primary }]}>{alt.quality}%</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

function WordAlternativesModal({ visible, data, onClose, onCopy, copiedText, colors }: WordAlternativesModalProps) {
  const renderAltItem = useCallback(
    ({ item }: { item: Alternative }) => (
      <AlternativeRow alt={item} onCopy={onCopy} colors={colors} />
    ),
    [onCopy, colors],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View accessibilityViewIsModal={true} style={[modalStyles.overlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[modalStyles.content, { backgroundColor: colors.modalBg }]}>
          {data && (
            <>
              <Text style={[modalStyles.title, { color: colors.titleText }]}>Word Lookup</Text>
              <View style={[modalStyles.infoBox, { backgroundColor: colors.bubbleBg, borderColor: colors.border }]}>
                <Text style={[modalStyles.label, { color: colors.dimText }]}>WORD</Text>
                <Text style={[{ color: colors.primaryText, fontSize: 20, fontWeight: "700" as const }]}>{data.word}</Text>
              </View>
              {data.loading ? (
                <View style={{ paddingVertical: 30, alignItems: "center" as const }}>
                  <Text style={[{ color: colors.dimText, fontStyle: "italic" as const, fontSize: 15 }]}>Looking up alternatives...</Text>
                </View>
              ) : data.alternatives.length === 0 ? (
                <View style={{ paddingVertical: 30, alignItems: "center" as const }}>
                  <Text style={[{ color: colors.dimText, fontSize: 15 }]}>No alternatives found</Text>
                </View>
              ) : (
                <FlatList
                  data={data.alternatives}
                  keyExtractor={(item, i) => `${i}-${item.translation}-${item.source}`}
                  style={{ maxHeight: 300 }}
                  renderItem={renderAltItem}
                />
              )}
              {copiedText && <Text style={[styles.copiedBadge, { textAlign: "center" as const }]} accessibilityLiveRegion="polite">Copied!</Text>}
            </>
          )}
          <TouchableOpacity
            style={[modalStyles.closeButton, { borderTopColor: colors.borderLight }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close word lookup"
          >
            <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" as const }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default React.memo(WordAlternativesModal);

const styles = StyleSheet.create({
  copiedBadge: {
    color: "#4ade80",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  altRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  altTranslation: {
    fontSize: 16,
    fontWeight: "500" as const,
  },
  altSource: {
    fontSize: 12,
    marginTop: 2,
  },
  altQualityBadge: {
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginLeft: 10,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  altQualityText: {
    fontSize: 12,
    fontWeight: "700" as const,
  },
});
