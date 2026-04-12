import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { Language, LANGUAGES, AUTO_DETECT_LANGUAGE } from "../services/translation";
import { type ThemeColors } from "../theme";

interface Props {
  label: string;
  selected: Language;
  onSelect: (lang: Language) => void;
  showAutoDetect?: boolean;
  recentCodes?: string[];
  colors?: ThemeColors;
}

type ListItem = Language | { type: "section"; title: string };

function isSectionHeader(item: ListItem): item is { type: "section"; title: string } {
  return "type" in item && item.type === "section";
}

export default function LanguagePicker({ label, selected, onSelect, showAutoDetect, recentCodes = [], colors }: Props) {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState("");

  const allLanguages = useMemo(() => {
    return showAutoDetect ? [AUTO_DETECT_LANGUAGE, ...LANGUAGES] : LANGUAGES;
  }, [showAutoDetect]);

  const listData = useMemo((): ListItem[] => {
    const q = search.trim().toLowerCase();

    if (q) {
      // When searching, show flat filtered list (no sections)
      return allLanguages.filter(
        (lang) =>
          lang.name.toLowerCase().includes(q) ||
          lang.code.toLowerCase().includes(q)
      );
    }

    // Build recent languages list from codes, excluding auto-detect
    const recentLangs = recentCodes
      .map((code) => allLanguages.find((l) => l.code === code))
      .filter((l): l is Language => l != null && l.code !== "autodetect");

    if (recentLangs.length === 0) return allLanguages;

    const recentCodesSet = new Set(recentLangs.map((l) => l.code));
    const rest = allLanguages.filter((l) => !recentCodesSet.has(l.code));

    return [
      { type: "section", title: "Recent" },
      ...recentLangs,
      { type: "section", title: "All Languages" },
      ...rest,
    ];
  }, [search, allLanguages, recentCodes]);

  const closeModal = () => {
    setVisible(false);
    setSearch("");
  };

  const c = colors;

  return (
    <View style={styles.container}>
      <Text style={[styles.label, c && { color: c.mutedText }]}>{label}</Text>
      <TouchableOpacity
        style={[styles.button, c && { backgroundColor: c.cardBg }]}
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label} language: ${selected.name}. Tap to change.`}
      >
        <Text style={[styles.buttonText, c && { color: c.primaryText }]}>{selected.name}</Text>
        <Text style={[styles.arrow, c && { color: c.primary }]} importantForAccessibility="no">▼</Text>
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" transparent>
        <View style={[styles.modalOverlay, c && { backgroundColor: c.overlayBg }]}>
          <View style={[styles.modalContent, c && { backgroundColor: c.modalBg }]}>
            <Text style={[styles.modalTitle, c && { color: c.titleText }]}>Select Language</Text>
            <TextInput
              style={[styles.searchInput, c && { backgroundColor: c.cardBg, color: c.primaryText }]}
              placeholder="Search languages..."
              placeholderTextColor={c ? c.placeholderText : "#555577"}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="Search languages"
            />
            <FlatList
              data={listData}
              keyExtractor={(item, index) =>
                isSectionHeader(item) ? `section-${item.title}` : item.code
              }
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={[styles.noResults, c && { color: c.dimText }]}>No languages found</Text>
              }
              renderItem={({ item }) => {
                if (isSectionHeader(item)) {
                  return (
                    <View style={[styles.sectionHeader, c && { backgroundColor: c.sectionBg }]}>
                      <Text style={[styles.sectionHeaderText, c && { color: c.primary }]}>{item.title}</Text>
                    </View>
                  );
                }
                return (
                  <TouchableOpacity
                    style={[
                      styles.langItem,
                      c && { borderBottomColor: c.borderLight },
                      item.code === selected.code && styles.langItemSelected,
                      item.code === selected.code && c && { backgroundColor: c.cardBg },
                    ]}
                    onPress={() => {
                      onSelect(item);
                      closeModal();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}`}
                    accessibilityState={{ selected: item.code === selected.code }}
                  >
                    <Text
                      style={[
                        styles.langText,
                        c && { color: c.secondaryText },
                        item.code === selected.code && styles.langTextSelected,
                        item.code === selected.code && c && { color: c.primary },
                      ]}
                    >
                      {item.name}
                    </Text>
                    <Text style={[styles.langCode, c && { color: c.dimText }]}>{item.code.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              }}
            />
            <TouchableOpacity
              style={[styles.closeButton, c && { borderTopColor: c.borderLight }]}
              onPress={closeModal}
              accessibilityRole="button"
              accessibilityLabel="Cancel language selection"
            >
              <Text style={[styles.closeText, c && { color: c.primary }]}>Cancel</Text>
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
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: "#252547",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    color: "#ffffff",
    fontSize: 16,
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
  sectionHeader: {
    paddingVertical: 8,
    paddingHorizontal: 24,
    backgroundColor: "#151530",
  },
  sectionHeaderText: {
    color: "#6c63ff",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  noResults: {
    color: "#555577",
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 24,
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
