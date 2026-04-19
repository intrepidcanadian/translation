import React, { useState, useMemo, useCallback } from "react";
import { modalStyles } from "../styles/modalStyles";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  StyleSheet,
  Share,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { notifySuccess } from "../services/haptics";
import { logger } from "../services/logger";
import { parseGlossaryCSV } from "../utils/glossaryParser";
import type { GlossaryEntry } from "../utils/glossaryValidation";
import type { ThemeColors } from "../theme";

interface GlossaryEntryRowProps {
  item: GlossaryEntry;
  realIndex: number;
  onRemove: (index: number) => void;
  colors: ThemeColors;
}

const GlossaryEntryRow = React.memo(function GlossaryEntryRow({
  item,
  realIndex,
  onRemove,
  colors,
}: GlossaryEntryRowProps) {
  const handleRemove = useCallback(() => onRemove(realIndex), [onRemove, realIndex]);
  return (
    <View
      style={[
        styles.glossaryEntry,
        { backgroundColor: colors.cardBg, borderColor: colors.border },
      ]}
      accessible={true}
      accessibilityLabel={`Glossary entry: ${item.source} translates to ${item.target}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.secondaryText, fontSize: 14 }}>
          {item.source}
        </Text>
        <Text
          style={{ color: colors.translatedText, fontSize: 14, fontWeight: "600" }}
        >
          {item.target}
        </Text>
      </View>
      <TouchableOpacity
        onPress={handleRemove}
        style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
        accessibilityRole="button"
        accessibilityLabel={`Remove glossary entry: ${item.source}`}
        accessibilityHint="Deletes this custom translation from your glossary"
      >
        <Text style={{ color: colors.errorText, fontSize: 18 }}>✕</Text>
      </TouchableOpacity>
    </View>
  );
});

interface GlossaryModalProps {
  visible: boolean;
  onClose: () => void;
  glossary: GlossaryEntry[];
  onAdd: (source: string, target: string) => void;
  onRemove: (index: number) => void;
  onImport: (entries: GlossaryEntry[]) => void;
  sourceLangName: string;
  targetLangName: string;
  sourceLangCode: string;
  targetLangCode: string;
  hapticsEnabled?: boolean;
  colors: ThemeColors;
}

function GlossaryModal({
  visible,
  onClose,
  glossary,
  onAdd,
  onRemove,
  onImport,
  sourceLangName,
  targetLangName,
  sourceLangCode,
  targetLangCode,
  colors,
}: GlossaryModalProps) {
  const [glossarySource, setGlossarySource] = useState("");
  const [glossaryTarget, setGlossaryTarget] = useState("");

  const handleAdd = useCallback(() => {
    if (glossarySource.trim() && glossaryTarget.trim()) {
      onAdd(glossarySource.trim(), glossaryTarget.trim());
      setGlossarySource("");
      setGlossaryTarget("");
    }
  }, [glossarySource, glossaryTarget, onAdd]);

  const filteredGlossary = useMemo(
    () => glossary.filter(
      (g) => g.sourceLang === sourceLangCode && g.targetLang === targetLangCode
    ),
    [glossary, sourceLangCode, targetLangCode],
  );

  const keyExtractor = useCallback(
    (item: GlossaryEntry) => `${item.sourceLang}|${item.targetLang}|${item.source}`,
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: GlossaryEntry }) => {
      const realIndex = glossary.indexOf(item);
      return (
        <GlossaryEntryRow
          item={item}
          realIndex={realIndex}
          onRemove={onRemove}
          colors={colors}
        />
      );
    },
    [glossary, onRemove, colors],
  );

  const handleExportCSV = useCallback(async () => {
    const csv =
      "source,target,sourceLang,targetLang\n" +
      glossary
        .map(
          (g) =>
            `"${g.source.replace(/"/g, '""')}","${g.target.replace(/"/g, '""')}","${g.sourceLang}","${g.targetLang}"`
        )
        .join("\n");
    try {
      await Share.share({ message: csv });
    } catch (err) { logger.warn("Glossary", "Glossary export failed", err); }
  }, [glossary]);

  const handleImportCSV = useCallback(async () => {
    try {
      const clip = await Clipboard.getStringAsync();
      if (!clip || !clip.includes(",")) {
        Alert.alert(
          "Import",
          "Copy a CSV to clipboard first.\nFormat: source,target,sourceLang,targetLang"
        );
        return;
      }
      const { entries, imported } = parseGlossaryCSV(clip, glossary);
      if (imported > 0) {
        onImport(entries);
        notifySuccess();
      }
      Alert.alert(
        "Import",
        imported > 0
          ? `Imported ${imported} new ${imported === 1 ? "entry" : "entries"}.`
          : "No new entries found in clipboard."
      );
    } catch (err) {
      logger.warn("Glossary", "Glossary import failed", err);
      Alert.alert("Import", "Failed to read clipboard.");
    }
  }, [glossary, onImport]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View accessibilityViewIsModal={true} style={[modalStyles.overlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[modalStyles.content, { backgroundColor: colors.modalBg }]}>
          <Text style={[modalStyles.title, { color: colors.titleText }]}>My Glossary</Text>
          <Text
            style={{
              color: colors.dimText,
              fontSize: 13,
              textAlign: "center" as const,
              marginBottom: 12,
              paddingHorizontal: 20,
            }}
          >
            Custom translations override API results. Entries apply to the current language pair (
            {sourceLangName} → {targetLangName}).
          </Text>

          <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
            <TextInput
              style={[
                styles.apiKeyInput,
                {
                  backgroundColor: colors.cardBg,
                  color: colors.primaryText,
                  borderColor: colors.border,
                  marginBottom: 8,
                },
              ]}
              placeholder={`Source phrase (${sourceLangName})`}
              placeholderTextColor={colors.placeholderText}
              value={glossarySource}
              onChangeText={setGlossarySource}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Glossary source phrase"
              accessibilityHint={`Enter a word or phrase in ${sourceLangName}`}
            />
            <TextInput
              style={[
                styles.apiKeyInput,
                {
                  backgroundColor: colors.cardBg,
                  color: colors.primaryText,
                  borderColor: colors.border,
                  marginBottom: 8,
                },
              ]}
              placeholder={`Translation (${targetLangName})`}
              placeholderTextColor={colors.placeholderText}
              value={glossaryTarget}
              onChangeText={setGlossaryTarget}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Glossary target translation"
              accessibilityHint={`Enter the custom translation in ${targetLangName}`}
            />
            <TouchableOpacity
              style={[
                styles.glossaryAddButton,
                {
                  backgroundColor:
                    glossarySource.trim() && glossaryTarget.trim()
                      ? colors.primary
                      : colors.border,
                },
              ]}
              onPress={handleAdd}
              disabled={!glossarySource.trim() || !glossaryTarget.trim()}
              accessibilityRole="button"
              accessibilityLabel="Add glossary entry"
              accessibilityHint="Saves the source phrase and translation as a custom glossary entry"
              accessibilityState={{ disabled: !glossarySource.trim() || !glossaryTarget.trim() }}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Add Entry</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={filteredGlossary}
            keyExtractor={keyExtractor}
            style={{ maxHeight: 250, paddingHorizontal: 16 }}
            ListEmptyComponent={
              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: 14,
                  textAlign: "center" as const,
                  paddingVertical: 20,
                }}
              >
                No entries for this language pair yet.
              </Text>
            }
            renderItem={renderItem}
          />

          {glossary.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginTop: 8, gap: 8 }}>
              <Text
                style={{
                  color: colors.dimText,
                  fontSize: 12,
                  textAlign: "center" as const,
                }}
              >
                {glossary.length} total {glossary.length === 1 ? "entry" : "entries"} across all
                language pairs
              </Text>
              <View
                style={{
                  flexDirection: "row" as const,
                  justifyContent: "center" as const,
                  gap: 12,
                }}
              >
                <TouchableOpacity
                  style={[styles.glossaryIOButton, { backgroundColor: colors.cardBg }]}
                  onPress={handleExportCSV}
                  accessibilityRole="button"
                  accessibilityLabel="Export glossary as CSV"
                  accessibilityHint="Opens the share sheet with all glossary entries formatted as CSV"
                >
                  <Text
                    style={{ color: colors.primary, fontSize: 13, fontWeight: "600" as const }}
                  >
                    Export CSV
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.glossaryIOButton, { backgroundColor: colors.cardBg }]}
                  onPress={handleImportCSV}
                  accessibilityRole="button"
                  accessibilityLabel="Import glossary from clipboard CSV"
                  accessibilityHint="Reads CSV data from your clipboard and adds new glossary entries"
                >
                  <Text
                    style={{ color: colors.primary, fontSize: 13, fontWeight: "600" as const }}
                  >
                    Import from Clipboard
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[modalStyles.closeButton, { borderTopColor: colors.borderLight }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close glossary"
          >
            <Text style={{ color: colors.primary, fontSize: 17, fontWeight: "600" as const }}>
              Done
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default React.memo(GlossaryModal);

const styles = StyleSheet.create({
  apiKeyInput: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    borderWidth: 1,
  },
  glossaryAddButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  glossaryIOButton: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  glossaryEntry: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    gap: 10,
  },
});
