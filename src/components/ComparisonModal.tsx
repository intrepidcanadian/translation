import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { ThemeColors } from "../theme";
import { modalStyles } from "../styles/modalStyles";

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

function ComparisonModal({ visible, data, onClose, onCopy, copiedText, colors }: ComparisonModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[modalStyles.overlay, { backgroundColor: colors.overlayBg }]} accessibilityViewIsModal={true}>
        <View style={[modalStyles.content, { backgroundColor: colors.modalBg }]}>
          <Text style={[modalStyles.title, { color: colors.titleText }]}>Compare Translations</Text>
          {data && (
            <>
              <View style={[modalStyles.infoBox, { backgroundColor: colors.bubbleBg, borderColor: colors.border }]}>
                <Text style={[modalStyles.label, { color: colors.dimText }]}>ORIGINAL</Text>
                <Text style={[{ color: colors.primaryText, fontSize: 15 }]}>{data.original}</Text>
              </View>
              {data.results.map((r) => (
                <View key={r.provider} style={[styles.compareResult, { backgroundColor: colors.translatedBubbleBg, borderColor: colors.border }]}>
                  <Text style={[modalStyles.label, { color: colors.primary }]}>{r.provider.toUpperCase()}</Text>
                  {r.loading ? (
                    <Text style={[{ color: colors.dimText, fontStyle: "italic", fontSize: 15 }]}>Loading...</Text>
                  ) : (
                    <TouchableOpacity
                      onPress={() => onCopy(r.text)}
                      accessibilityRole="button"
                      accessibilityLabel={`Copy ${r.provider} translation: ${r.text}`}
                      accessibilityHint="Tap to copy this translation to clipboard"
                    >
                      <Text style={[{ color: colors.translatedText, fontSize: 15 }]}>{r.text}</Text>
                      {copiedText === r.text && <Text style={styles.copiedBadge}>Copied!</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </>
          )}
          <TouchableOpacity
            style={[modalStyles.closeButton, { borderTopColor: colors.borderLight }]}
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

export default React.memo(ComparisonModal);

const styles = StyleSheet.create({
  compareResult: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
  },
  copiedBadge: {
    color: "#4ade80",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
});
