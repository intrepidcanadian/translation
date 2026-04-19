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
import DualStreamView from "../components/DualStreamView";
import DocumentScanner from "../components/DocumentScanner";
import ProductScanner from "../components/ProductScanner";
import ListingGenerator from "../components/ListingGenerator";
import PriceTagConverter from "../components/PriceTagConverter";
import DutyFreeCatalogScanner from "../components/DutyFreeCatalogScanner";
import GlassBackdrop from "../components/GlassBackdrop";
import { useSettings } from "../contexts/SettingsContext";
import { useLanguage } from "../contexts/LanguageContext";
import { getColors } from "../theme";
import { SCANNER_MODES, type ScannerModeKey } from "../services/scannerModes";
import type { RootTabParamList } from "../navigation/types";

type Props = BottomTabScreenProps<RootTabParamList, "Scan">;

const NOOP = () => {};

type ScanMode = "live" | "dual" | "dutyFree" | "priceTag" | "product" | "sell" | ScannerModeKey;

interface ModeItem {
  key: ScanMode;
  label: string;
  icon: string;
}

const MODE_ITEMS: ModeItem[] = [
  { key: "live", label: "Live", icon: "🔍" },
  { key: "dual", label: "Dual", icon: "📡" },
  { key: "dutyFree", label: "Duty-Free", icon: "🛍️" },
  { key: "priceTag", label: "Price", icon: "💱" },
  { key: "product", label: "Product", icon: "🏷️" },
  { key: "sell", label: "Sell", icon: "💰" },
  ...SCANNER_MODES.map((m) => ({ key: m.key as ScanMode, label: m.label, icon: m.icon })),
];

const ModePill = React.memo(function ModePill({
  item,
  isActive,
  onSelect,
  activeColor,
  glassBg,
  glassBorder,
  activeTextColor,
  inactiveTextColor,
}: {
  item: ModeItem;
  isActive: boolean;
  onSelect: (key: ScanMode) => void;
  activeColor: string;
  glassBg: string;
  glassBorder: string;
  activeTextColor: string;
  inactiveTextColor: string;
}) {
  const handlePress = useCallback(() => onSelect(item.key), [onSelect, item.key]);
  return (
    <TouchableOpacity
      style={[
        styles.modePill,
        {
          backgroundColor: isActive ? activeColor : glassBg,
          borderColor: isActive ? activeColor : glassBorder,
        },
      ]}
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityLabel={`${item.label} scanner mode`}
      accessibilityHint={`Switches to ${item.label} scanning mode`}
      accessibilityState={{ selected: isActive }}
    >
      <Text style={styles.modePillIcon}>{item.icon}</Text>
      <Text style={[styles.modePillLabel, { color: isActive ? activeTextColor : inactiveTextColor }]}>{item.label}</Text>
    </TouchableOpacity>
  );
});

function ScanScreen({ route }: Props) {
  const isFocused = useIsFocused();
  const { settings } = useSettings();
  const { sourceLang, targetLang } = useLanguage();
  const colors = getColors(settings.theme);

  const initialMode = route.params?.mode || "live";
  const [selectedMode, setSelectedMode] = useState<ScanMode>(initialMode);

  const sourceLangCode = sourceLang.code === "autodetect" ? "en" : sourceLang.code;

  const handleModeSelect = useCallback((mode: ScanMode) => {
    setSelectedMode(mode);
  }, []);

  const handleCloseScanMode = useCallback(() => {
    setSelectedMode("live");
  }, []);

  const modeKeyExtractor = useCallback((item: ModeItem) => item.key, []);

  const renderModeItem = useCallback(({ item }: { item: ModeItem }) => (
    <ModePill
      item={item}
      isActive={item.key === selectedMode}
      onSelect={handleModeSelect}
      activeColor={colors.primary}
      glassBg={colors.glassBg}
      glassBorder={colors.glassBorder}
      activeTextColor={colors.destructiveText}
      inactiveTextColor={colors.primaryText}
    />
  ), [selectedMode, colors, handleModeSelect]);

  const renderModeStrip = () => (
    <View style={styles.modeStripContainer} accessibilityRole="tablist">
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={MODE_ITEMS}
        keyExtractor={modeKeyExtractor}
        contentContainerStyle={styles.modeStripContent}
        renderItem={renderModeItem}
      />
    </View>
  );

  const content = useMemo(() => {
    if (!isFocused) return null;

    switch (selectedMode) {
      case "live":
        return (
          <CameraTranslator
            visible={true}
            onClose={NOOP}
            sourceLangCode={sourceLangCode}
            targetLangCode={targetLang.code}
            translationProvider={settings.translationProvider}
            colors={colors}
          />
        );
      case "dual":
        return (
          <DualStreamView
            visible={true}
            onClose={handleCloseScanMode}
            sourceLangCode={sourceLangCode}
            sourceSpeechCode={sourceLang.speechCode}
            targetLangCode={targetLang.code}
            targetSpeechCode={targetLang.speechCode}
            translationProvider={settings.translationProvider}
            speechRate={settings.speechRate}
            offlineSpeech={settings.offlineSpeech}
            colors={colors}
          />
        );
      case "dutyFree":
        return (
          <DutyFreeCatalogScanner
            visible={true}
            onClose={handleCloseScanMode}
            sourceLangCode={sourceLangCode}
            targetLangCode={targetLang.code}
            translationProvider={settings.translationProvider}
            colors={colors}
          />
        );
      case "priceTag":
        return (
          <PriceTagConverter
            visible={true}
            onClose={handleCloseScanMode}
            colors={colors}
            sourceLangCode={sourceLangCode}
          />
        );
      case "product":
        return (
          <ProductScanner
            visible={true}
            onClose={handleCloseScanMode}
            colors={colors}
          />
        );
      case "sell":
        return (
          <ListingGenerator
            visible={true}
            onClose={handleCloseScanMode}
            targetLangCode={targetLang.code}
            translationProvider={settings.translationProvider}
            colors={colors}
          />
        );
      default:
        return (
          <DocumentScanner
            visible={true}
            onClose={handleCloseScanMode}
            sourceLangCode={sourceLangCode}
            targetLangCode={targetLang.code}
            translationProvider={settings.translationProvider}
            colors={colors}
            initialMode={selectedMode as ScannerModeKey}
          />
        );
    }
  }, [isFocused, selectedMode, sourceLangCode, sourceLang.speechCode, targetLang.code, targetLang.speechCode, settings.translationProvider, settings.speechRate, settings.offlineSpeech, colors, handleCloseScanMode]);

  return (
    <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
      {/* Aurora behind everything — shows through the glass mode pills
          and harmonizes with the floating glass tab bar so this screen
          shares the same visual language as Translate. */}
      <GlassBackdrop />
      <SafeAreaView style={styles.flex}>
        {renderModeStrip()}
        {content}
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

export default React.memo(ScanScreen);
