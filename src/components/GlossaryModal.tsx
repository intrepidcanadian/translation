import React, { useState } from "react";
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
import type { ThemeColors } from "../theme";

interface GlossaryEntry {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
}

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

export default function GlossaryModal({
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

  const handleAdd = () => {
    if (glossarySource.trim() && glossaryTarget.trim()) {
      onAdd(glossarySource.trim(), glossaryTarget.trim());
      setGlossarySource("");
      setGlossaryTarget("");
    }
  };

  const filteredGlossary = glossary.filter(
    (g) => g.sourceLang === sourceLangCode && g.targetLang === targetLangCode
  );

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
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Add Entry</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={filteredGlossary}
            keyExtractor={(_, i) => String(i)}
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
            renderItem={({ item }) => {
              const realIndex = glossary.findIndex((g) => g === item);
              return (
                <View
                  style={[
                    styles.glossaryEntry,
                    { backgroundColor: colors.cardBg, borderColor: colors.border },
                  ]}
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
                    onPress={() => onRemove(realIndex)}
                    style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove glossary entry: ${item.source}`}
                  >
                    <Text style={{ color: colors.errorText, fontSize: 18 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            }}
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
                  onPress={async () => {
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
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Export glossary as CSV"
                >
                  <Text
                    style={{ color: colors.primary, fontSize: 13, fontWeight: "600" as const }}
                  >
                    Export CSV
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.glossaryIOButton, { backgroundColor: colors.cardBg }]}
                  onPress={async () => {
                    try {
                      const clip = await Clipboard.getStringAsync();
                      if (!clip || !clip.includes(",")) {
                        Alert.alert(
                          "Import",
                          "Copy a CSV to clipboard first.\nFormat: source,target,sourceLang,targetLang"
                        );
                        return;
                      }
                      const lines = clip.split("\n").filter((l) => l.trim());
                      const start = lines[0]?.toLowerCase().startsWith("source") ? 1 : 0;
                      let imported = 0;
                      const newEntries: GlossaryEntry[] = [...glossary];
                      for (let i = start; i < lines.length; i++) {
                        const match = lines[i].match(
                          /^"?([^"]*)"?\s*,\s*"?([^"]*)"?\s*,\s*"?([^"]*)"?\s*,\s*"?([^"]*)"?$/
                        );
                        if (match) {
                          const [, src, tgt, sLang, tLang] = match;
                          if (src && tgt && sLang && tLang) {
                            const exists = newEntries.some(
                              (g) =>
                                g.source.toLowerCase() === src.toLowerCase() &&
                                g.sourceLang === sLang &&
                                g.targetLang === tLang
                            );
                            if (!exists) {
                              newEntries.push({
                                source: src,
                                target: tgt,
                                sourceLang: sLang,
                                targetLang: tLang,
                              });
                              imported++;
                            }
                          }
                        }
                      }
                      if (imported > 0) {
                        onImport(newEntries);
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
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Import glossary from clipboard CSV"
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
  glossaryInput: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    borderWidth: 1,
    marginBottom: 8,
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
