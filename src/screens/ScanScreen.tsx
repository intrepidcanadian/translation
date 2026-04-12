import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  FlatList,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import CameraTranslator from "../components/CameraTranslator";
import DocumentScanner from "../components/DocumentScanner";
import { useSettings } from "../contexts/SettingsContext";
import { useLanguage } from "../contexts/LanguageContext";
import { useTranslationData } from "../contexts/TranslationDataContext";
import { getColors } from "../theme";
import { SCANNER_MODES, type ScannerModeKey } from "../services/scannerModes";
import type { RootTabParamList } from "../navigation/types";

type Props = BottomTabScreenProps<RootTabParamList, "Scan">;

type ScanMode = "live" | ScannerModeKey;

interface ModeItem {
  key: ScanMode;
  label: string;
  icon: string;
}

const MODE_ITEMS: ModeItem[] = [
  { key: "live", label: "Live", icon: "🔍" },
  ...SCANNER_MODES.map((m) => ({ key: m.key as ScanMode, label: m.label, icon: m.icon })),
];

export default function ScanScreen({ route }: Props) {
  const isFocused = useIsFocused();
  const { settings } = useSettings();
  const { sourceLang, targetLang } = useLanguage();
  const { incrementNotesRefresh } = useTranslationData();
  const colors = getColors(settings.theme);

  const initialMode = route.params?.mode || "live";
  const [selectedMode, setSelectedMode] = useState<ScanMode>(initialMode);

  const sourceLangCode = sourceLang.code === "autodetect" ? "en" : sourceLang.code;

  const handleModeSelect = useCallback((mode: ScanMode) => {
    setSelectedMode(mode);
  }, []);

  if (selectedMode === "live") {
    return (
      <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
        <SafeAreaView style={styles.flex}>
          {/* Mode strip */}
          <View style={styles.modeStripContainer}>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={MODE_ITEMS}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.modeStripContent}
              renderItem={({ item }) => {
                const isActive = item.key === selectedMode;
                return (
                  <TouchableOpacity
                    style={[styles.modePill, { backgroundColor: isActive ? colors.primary : colors.cardBg, borderColor: isActive ? colors.primary : colors.border }]}
                    onPress={() => handleModeSelect(item.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label} scanner mode`}
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text style={styles.modePillIcon}>{item.icon}</Text>
                    <Text style={[styles.modePillLabel, { color: isActive ? colors.destructiveText : colors.mutedText }]}>{item.label}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>

          {/* Live camera */}
          {isFocused && (
            <CameraTranslator
              visible={true}
              onClose={() => setSelectedMode("document")}
              sourceLangCode={sourceLangCode}
              targetLangCode={targetLang.code}
              translationProvider={settings.translationProvider}
              colors={colors}
            />
          )}
        </SafeAreaView>
      </View>
    );
  }

  // Document scanner modes
  return (
    <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
      <SafeAreaView style={styles.flex}>
        {/* Mode strip */}
        <View style={styles.modeStripContainer}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={MODE_ITEMS}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.modeStripContent}
            renderItem={({ item }) => {
              const isActive = item.key === selectedMode;
              return (
                <TouchableOpacity
                  style={[styles.modePill, { backgroundColor: isActive ? colors.primary : colors.cardBg, borderColor: isActive ? colors.primary : colors.border }]}
                  onPress={() => handleModeSelect(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label} scanner mode`}
                  accessibilityState={{ selected: isActive }}
                >
                  <Text style={styles.modePillIcon}>{item.icon}</Text>
                  <Text style={[styles.modePillLabel, { color: isActive ? colors.destructiveText : colors.mutedText }]}>{item.label}</Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        {/* Document scanner */}
        {isFocused && (
          <DocumentScanner
            visible={true}
            onClose={() => setSelectedMode("live")}
            sourceLangCode={sourceLangCode}
            targetLangCode={targetLang.code}
            translationProvider={settings.translationProvider}
            colors={colors}
            initialMode={selectedMode as ScannerModeKey}
            onNoteSaved={incrementNotesRefresh}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  modeStripContainer: {
    paddingTop: Platform.OS === "android" ? 40 : 10,
    paddingBottom: 8,
    zIndex: 10,
  },
  modeStripContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  modePillIcon: { fontSize: 16 },
  modePillLabel: { fontSize: 13, fontWeight: "700" },
});
