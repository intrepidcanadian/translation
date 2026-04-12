import React from "react";
import { Modal, View, Text, TouchableOpacity, FlatList, StyleSheet } from "react-native";

interface WordAlternativesModalProps {
  visible: boolean;
  data: {
    word: string;
    loading: boolean;
    alternatives: Array<{ translation: string; source: string; quality: number }>;
  } | null;
  onClose: () => void;
  onCopy: (text: string) => void;
  copiedText: string | null;
  colors: any;
}

export default function WordAlternativesModal({ visible, data, onClose, onCopy, copiedText, colors }: WordAlternativesModalProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[styles.compareContent, { backgroundColor: colors.modalBg }]}>
          {data && (
            <>
              <Text style={[styles.compareTitle, { color: colors.titleText }]}>Word Lookup</Text>
              <View style={[styles.compareOriginal, { backgroundColor: colors.bubbleBg, borderColor: colors.border }]}>
                <Text style={[styles.compareLabel, { color: colors.dimText }]}>WORD</Text>
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
                  keyExtractor={(_, i) => String(i)}
                  style={{ maxHeight: 300 }}
                  renderItem={({ item: alt }) => (
                    <TouchableOpacity
                      style={[styles.altRow, { borderBottomColor: colors.borderLight }]}
                      onPress={() => onCopy(alt.translation)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.altTranslation, { color: colors.translatedText }]}>{alt.translation}</Text>
                        <Text style={[styles.altSource, { color: colors.dimText }]}>{alt.source}</Text>
                      </View>
                      {alt.quality > 0 && (
                        <View style={[styles.altQualityBadge, { backgroundColor: colors.primary + "22" }]}>
                          <Text style={[styles.altQualityText, { color: colors.primary }]}>{alt.quality}%</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  )}
                />
              )}
              {copiedText && <Text style={[styles.copiedBadge, { textAlign: "center" as const }]}>Copied!</Text>}
            </>
          )}
          <TouchableOpacity
            style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
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

const styles = StyleSheet.create({
  compareOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  compareContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "70%",
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  compareTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },
  compareOriginal: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  compareLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 6,
  },
  compareClose: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
    marginHorizontal: -20,
  },
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
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginLeft: 10,
  },
  altQualityText: {
    fontSize: 12,
    fontWeight: "700" as const,
  },
});
