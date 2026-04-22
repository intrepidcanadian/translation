import React, { useState, useMemo, useCallback } from "react";
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
  colors: ThemeColors;
}

type ListItem = Language | { type: "section"; title: string };

function isSectionHeader(item: ListItem): item is { type: "section"; title: string } {
  return "type" in item && item.type === "section";
}

const LanguageItem = React.memo(function LanguageItem({
  item,
  isSelected,
  onSelect,
  borderBottomColor,
  selectedBg,
  textColor,
  selectedTextColor,
  codeColor,
}: {
  item: Language;
  isSelected: boolean;
  onSelect: (lang: Language) => void;
  borderBottomColor: string;
  selectedBg: string;
  textColor: string;
  selectedTextColor: string;
  codeColor: string;
}) {
  const handlePress = useCallback(() => onSelect(item), [onSelect, item]);
  return (
    <TouchableOpacity
      style={[
        styles.langItem,
        { borderBottomColor },
        isSelected && { backgroundColor: selectedBg },
      ]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}`}
      accessibilityState={{ selected: isSelected }}
    >
      <Text
        style={[
          styles.langText,
          { color: textColor },
          isSelected && { color: selectedTextColor, fontWeight: "700" },
        ]}
      >
        {item.flag} {item.name}
      </Text>
      <Text style={[styles.langCode, { color: codeColor }]}>{item.code.toUpperCase()}</Text>
    </TouchableOpacity>
  );
});

function LanguagePicker({ label, selected, onSelect, showAutoDetect, recentCodes = [], colors }: Props) {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState("");

  const allLanguages = useMemo(() => {
    return showAutoDetect ? [AUTO_DETECT_LANGUAGE, ...LANGUAGES] : LANGUAGES;
  }, [showAutoDetect]);

  const listData = useMemo((): ListItem[] => {
    const q = search.trim().toLowerCase();

    if (q) {
      return allLanguages.filter(
        (lang) =>
          lang.name.toLowerCase().includes(q) ||
          lang.code.toLowerCase().includes(q)
      );
    }

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

  const openModal = useCallback(() => setVisible(true), []);

  const closeModal = useCallback(() => {
    setVisible(false);
    setSearch("");
  }, []);

  const keyExtractor = useCallback(
    (item: ListItem) =>
      isSectionHeader(item) ? `section-${item.title}` : item.code,
    []
  );

  const handleSelectAndClose = useCallback((lang: Language) => {
    onSelect(lang);
    closeModal();
  }, [onSelect, closeModal]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (isSectionHeader(item)) {
        return (
          <View
            style={[styles.sectionHeader, { backgroundColor: colors.sectionBg }]}
            accessibilityRole="header"
          >
            <Text style={[styles.sectionHeaderText, { color: colors.primary }]}>{item.title}</Text>
          </View>
        );
      }
      return (
        <LanguageItem
          item={item}
          isSelected={item.code === selected.code}
          onSelect={handleSelectAndClose}
          borderBottomColor={colors.borderLight}
          selectedBg={colors.cardBg}
          textColor={colors.secondaryText}
          selectedTextColor={colors.primary}
          codeColor={colors.dimText}
        />
      );
    },
    [selected.code, colors.sectionBg, colors.primary, colors.borderLight, colors.cardBg, colors.secondaryText, colors.dimText, handleSelectAndClose]
  );

  const emptyComponent = useMemo(
    () => <Text style={[styles.noResults, { color: colors.dimText }]}>No languages found</Text>,
    [colors.dimText]
  );

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.mutedText }]}>{label}</Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.cardBg }]}
        onPress={openModal}
        accessibilityRole="button"
        accessibilityLabel={`${label} language: ${selected.name}. Tap to change.`}
        accessibilityHint="Opens a list to choose a different language"
      >
        <Text style={[styles.buttonText, { color: colors.primaryText }]}>{selected.flag} {selected.name}</Text>
        <Text style={[styles.arrow, { color: colors.primary }]} importantForAccessibility="no">▼</Text>
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" transparent>
        <View accessibilityViewIsModal={true} style={[styles.modalOverlay, { backgroundColor: colors.overlayBg }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.modalBg }]}>
            <Text style={[styles.modalTitle, { color: colors.titleText }]}>Select Language</Text>
            <TextInput
              style={[styles.searchInput, { backgroundColor: colors.cardBg, color: colors.primaryText }]}
              placeholder="Search languages..."
              placeholderTextColor={colors.placeholderText}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="Search languages"
            />
            <FlatList
              data={listData}
              keyExtractor={keyExtractor}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={emptyComponent}
              renderItem={renderItem}
            />
            <TouchableOpacity
              style={[styles.closeButton, { borderTopColor: colors.borderLight }]}
              onPress={closeModal}
              accessibilityRole="button"
              accessibilityLabel="Cancel language selection"
            >
              <Text style={[styles.closeText, { color: colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Custom equality — recentCodes is a new array ref each time it's tracked,
// so default React.memo would always re-render. Shallow-compare content instead.
function arePropsEqual(prev: Props, next: Props) {
  if (prev.label !== next.label) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.onSelect !== next.onSelect) return false;
  if (prev.showAutoDetect !== next.showAutoDetect) return false;
  if (prev.colors !== next.colors) return false;
  const prevRecent = prev.recentCodes || [];
  const nextRecent = next.recentCodes || [];
  if (prevRecent.length !== nextRecent.length) return false;
  for (let i = 0; i < prevRecent.length; i++) {
    if (prevRecent[i] !== nextRecent[i]) return false;
  }
  return true;
}

export default React.memo(LanguagePicker, arePropsEqual);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  arrow: {
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "70%",
    paddingTop: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
  },
  searchInput: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    fontSize: 16,
  },
  langItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
  },
  langText: {
    fontSize: 17,
  },
  langCode: {
    fontSize: 13,
    fontWeight: "600",
  },
  sectionHeader: {
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  noResults: {
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 24,
  },
  closeButton: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
  },
  closeText: {
    fontSize: 17,
    fontWeight: "600",
  },
});
