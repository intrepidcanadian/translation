import React, { useState, useEffect } from "react";
import { Modal, View, Text, TouchableOpacity, TextInput, StyleSheet } from "react-native";
import type { ThemeColors } from "../theme";
import { modalStyles } from "../styles/modalStyles";

interface CorrectionModalProps {
  visible: boolean;
  data: {
    original: string;
    translated: string;
    index: number;
  } | null;
  onClose: () => void;
  onSubmit: (correctedText: string) => void;
  colors: ThemeColors;
}

function CorrectionModal({ visible, data, onClose, onSubmit, colors }: CorrectionModalProps) {
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
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[modalStyles.overlay, { backgroundColor: colors.overlayBg }]} accessibilityViewIsModal={true}>
        <View style={[modalStyles.content, { backgroundColor: colors.modalBg }]}>
          <Text style={[modalStyles.title, { color: colors.titleText }]}>Suggest Correction</Text>
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
              accessibilityHint="Type the correct translation to replace the current one"
            />
            <TouchableOpacity
              style={[styles.glossaryAddButton, { backgroundColor: correctionText.trim() ? colors.primary : colors.border }]}
              onPress={handleSubmit}
              disabled={!correctionText.trim()}
              accessibilityRole="button"
              accessibilityLabel="Submit correction"
              accessibilityHint="Saves the corrected translation and adds it to your glossary"
              accessibilityState={{ disabled: !correctionText.trim() }}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Save & Add to Glossary</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[modalStyles.closeButton, { borderTopColor: colors.borderLight }]}
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

export default React.memo(CorrectionModal);

const styles = StyleSheet.create({
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
