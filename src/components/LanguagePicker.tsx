import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { Language, LANGUAGES } from "../services/translation";

interface Props {
  label: string;
  selected: Language;
  onSelect: (lang: Language) => void;
}

export default function LanguagePicker({ label, selected, onSelect }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setVisible(true)}
      >
        <Text style={styles.buttonText}>{selected.name}</Text>
        <Text style={styles.arrow}>▼</Text>
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Language</Text>
            <FlatList
              data={LANGUAGES}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.langItem,
                    item.code === selected.code && styles.langItemSelected,
                  ]}
                  onPress={() => {
                    onSelect(item);
                    setVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.langText,
                      item.code === selected.code && styles.langTextSelected,
                    ]}
                  >
                    {item.name}
                  </Text>
                  <Text style={styles.langCode}>{item.code.toUpperCase()}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setVisible(false)}
            >
              <Text style={styles.closeText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  label: {
    color: "#8888aa",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  button: {
    backgroundColor: "#252547",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  arrow: {
    color: "#6c63ff",
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "70%",
    paddingTop: 20,
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },
  langItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#252547",
  },
  langItemSelected: {
    backgroundColor: "#252547",
  },
  langText: {
    color: "#ccccdd",
    fontSize: 17,
  },
  langTextSelected: {
    color: "#6c63ff",
    fontWeight: "700",
  },
  langCode: {
    color: "#555577",
    fontSize: 13,
    fontWeight: "600",
  },
  closeButton: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#252547",
  },
  closeText: {
    color: "#6c63ff",
    fontSize: 17,
    fontWeight: "600",
  },
});
