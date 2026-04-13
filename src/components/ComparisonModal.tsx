import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { ThemeColors } from "../theme";

interface ComparisonModalProps {
  visible: boolean;
  data: {
    original: string;
    results: Array<{ provider: string; text: string; loading?: boolean }>;
  } | null;
  onClose: () => void;
  onCopy: (text: string) => void;
  copiedText: string | null;
  colors: ThemeColors;
}

export default function ComparisonModal({ visible, data, onClose, onCopy, copiedText, colors }: ComparisonModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]} accessibilityViewIsModal={true}>
        <View style={[styles.compareContent, { backgroundColor: colors.modalBg }]}>
          <Text style={[styles.compareTitle, { color: colors.titleText }]}>Compare Translations</Text>
          {data && (
            <>
              <View style={[styles.compareOriginal, { backgroundColor: colors.bubbleBg, borderColor: colors.border }]}>
                <Text style={[styles.compareLabel, { color: colors.dimText }]}>ORIGINAL</Text>
                <Text style={[{ color: colors.primaryText, fontSize: 15 }]}>{data.original}</Text>
              </View>
              {data.results.map((r) => (
                <View key={r.provider} style={[styles.compareResult, { backgroundColor: colors.translatedBubbleBg, borderColor: colors.border }]}>
                  <Text style={[styles.compareLabel, { color: colors.primary }]}>{r.provider.toUpperCase()}</Text>
                  {r.loading ? (
                    <Text style={[{ color: colors.dimText, fontStyle: "italic", fontSize: 15 }]}>Loading...</Text>
                  ) : (
                    <TouchableOpacity onPress={() => onCopy(r.text)}>
                      <Text style={[{ color: colors.translatedText, fontSize: 15 }]}>{r.text}</Text>
                      {copiedText === r.text && <Text style={styles.copiedBadge}>Copied!</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </>
          )}
          <TouchableOpacity
            style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close comparison"
          >
            <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" }]}>Done</Text>
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
  compareResult: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
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
});
