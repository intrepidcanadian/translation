import React, { useState, useEffect } from "react";
import { Modal, View, Text, TouchableOpacity, TextInput, StyleSheet } from "react-native";

interface CorrectionModalProps {
  visible: boolean;
  data: {
    original: string;
    translated: string;
    index: number;
  } | null;
  onClose: () => void;
  onSubmit: (correctedText: string) => void;
  colors: any;
}

export default function CorrectionModal({ visible, data, onClose, onSubmit, colors }: CorrectionModalProps) {
  const [correctionText, setCorrectionText] = useState("");

  useEffect(() => {
    if (!visible) {
      setCorrectionText("");
    }
  }, [visible]);

  const handleClose = () => {
    setCorrectionText("");
    onClose();
  };

  const handleSubmit = () => {
    onSubmit(correctionText);
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[styles.compareContent, { backgroundColor: colors.modalBg, maxHeight: "50%" }]}>
          <Text style={[styles.compareTitle, { color: colors.titleText }]}>Suggest Correction</Text>
          <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
            <Text style={[{ color: colors.dimText, fontSize: 13, marginBottom: 12 }]}>
              Original: "{data?.original}"
            </Text>
            <Text style={[{ color: colors.dimText, fontSize: 13, marginBottom: 12 }]}>
              Current: "{data?.translated}"
            </Text>
            <TextInput
              style={[styles.glossaryInput, { backgroundColor: colors.cardBg, color: colors.primaryText, borderColor: colors.border }]}
              placeholder="Enter better translation..."
              placeholderTextColor={colors.placeholderText}
              value={correctionText}
              onChangeText={setCorrectionText}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Correction input"
            />
            <TouchableOpacity
              style={[styles.glossaryAddButton, { backgroundColor: correctionText.trim() ? colors.primary : colors.border }]}
              onPress={handleSubmit}
              disabled={!correctionText.trim()}
              accessibilityRole="button"
              accessibilityLabel="Submit correction"
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Save & Add to Glossary</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel correction"
          >
            <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" as const }]}>Cancel</Text>
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
  compareClose: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
    marginHorizontal: -20,
  },
  glossaryInput: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  glossaryAddButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
});
