import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Platform,
} from "react-native";
import SettingsModal from "../components/SettingsModal";
import PhrasebookModal from "../components/PhrasebookModal";
import GlossaryModal from "../components/GlossaryModal";
import StatsModal from "../components/StatsModal";
import OnboardingModal from "../components/OnboardingModal";
import { useSettings } from "../contexts/SettingsContext";
import { useLanguage } from "../contexts/LanguageContext";
import { useTranslationData } from "../contexts/TranslationDataContext";
import { getColors } from "../theme";
import * as Speech from "expo-speech";

export default function SettingsScreen() {
  const { settings, updateSettings, showOnboarding, setShowOnboarding, completeOnboarding } = useSettings();
  const { sourceLang, targetLang } = useLanguage();
  const { history, glossary, addGlossaryEntry, removeGlossaryEntry, importGlossaryEntries, streak } = useTranslationData();
  const colors = getColors(settings.theme);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPhrasebook, setShowPhrasebook] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const speakText = (text: string) => {
    Speech.speak(text, { language: targetLang.speechCode, rate: settings.speechRate });
  };

  const copyToClipboard = async (text: string) => {
    const Clipboard = await import("expo-clipboard");
    await Clipboard.setStringAsync(text);
  };

  const menuItems = useMemo(() => [
    { label: "App Settings", icon: "⚙", subtitle: "Theme, haptics, speech, provider", onPress: () => setShowSettingsModal(true) },
    { label: "Phrasebook", icon: "📖", subtitle: "Common phrases in 10 languages", onPress: () => setShowPhrasebook(true) },
    { label: "Glossary", icon: "📝", subtitle: `${glossary.length} custom translation${glossary.length === 1 ? "" : "s"}`, onPress: () => setShowGlossary(true) },
    { label: "Statistics", icon: "📊", subtitle: `${history.length} translations`, onPress: () => setShowStats(true) },
    { label: "Replay Tutorial", icon: "🎓", subtitle: "Show onboarding walkthrough", onPress: () => setShowOnboarding(true) },
  ], [glossary.length, history.length, setShowOnboarding]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.safeBg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.titleText }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {menuItems.map((item, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.menuRow, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <Text style={styles.menuIcon}>{item.icon}</Text>
            <View style={styles.menuText}>
              <Text style={[styles.menuLabel, { color: colors.primaryText }]}>{item.label}</Text>
              <Text style={[styles.menuSubtitle, { color: colors.dimText }]}>{item.subtitle}</Text>
            </View>
            <Text style={[styles.chevron, { color: colors.mutedText }]}>›</Text>
          </TouchableOpacity>
        ))}

        <View style={styles.infoSection}>
          <Text style={[styles.infoText, { color: colors.dimText }]}>Live Translator v1.0.0</Text>
          <Text style={[styles.infoText, { color: colors.dimText }]}>
            Powered by {
              settings.translationProvider === "apple" ? "Apple Neural Engine" :
              settings.translationProvider === "mlkit" ? "Google ML Kit" :
              "MyMemory API"
            }
          </Text>
        </View>
      </ScrollView>

      {/* Modals */}
      <SettingsModal
        visible={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        settings={settings}
        onUpdate={updateSettings}
      />

      <PhrasebookModal
        visible={showPhrasebook}
        onClose={() => setShowPhrasebook(false)}
        sourceLangCode={sourceLang.code === "autodetect" ? "en" : sourceLang.code}
        targetLangCode={targetLang.code}
        onCopy={copyToClipboard}
        onSpeak={speakText}

        colors={colors}
      />

      <GlossaryModal
        visible={showGlossary}
        onClose={() => setShowGlossary(false)}
        glossary={glossary}
        onAdd={addGlossaryEntry}
        onRemove={removeGlossaryEntry}
        onImport={importGlossaryEntries}
        sourceLangName={sourceLang.name}
        targetLangName={targetLang.name}
        sourceLangCode={sourceLang.code}
        targetLangCode={targetLang.code}

        colors={colors}
      />

      <StatsModal
        visible={showStats}
        onClose={() => setShowStats(false)}
        history={history}
        streak={streak}
        colors={colors}
      />

      <OnboardingModal
        visible={showOnboarding}
        onComplete={completeOnboarding}

        colors={colors}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? 40 : 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 28, fontWeight: "800" },
  content: { padding: 16, gap: 10 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 14,
  },
  menuIcon: { fontSize: 24 },
  menuText: { flex: 1 },
  menuLabel: { fontSize: 16, fontWeight: "600" },
  menuSubtitle: { fontSize: 13, marginTop: 2 },
  chevron: { fontSize: 24, fontWeight: "300" },
  infoSection: { alignItems: "center", paddingTop: 24, gap: 4 },
  infoText: { fontSize: 13 },
});
