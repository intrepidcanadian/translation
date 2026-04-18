import React, { useState, useMemo, useCallback } from "react";
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
import FlightPrepModal from "../components/FlightPrepModal";
import VisualCardsModal from "../components/VisualCardsModal";
import CultureBriefingModal from "../components/CultureBriefingModal";
import PassengerPreferenceCard from "../components/PassengerPreferenceCard";
import GlassBackdrop from "../components/GlassBackdrop";
import { useSettings } from "../contexts/SettingsContext";
import { useLanguage } from "../contexts/LanguageContext";
import { useGlossary } from "../contexts/GlossaryContext";
import { useTranslationData } from "../contexts/TranslationDataContext";
import { useStreak } from "../contexts/StreakContext";
import { getColors } from "../theme";
import * as Speech from "expo-speech";
import { copyWithAutoClear } from "../services/clipboard";
import { logger } from "../services/logger";

function SettingsScreen() {
  const { settings, updateSettings, showOnboarding, setShowOnboarding, completeOnboarding } = useSettings();
  const { sourceLang, targetLang } = useLanguage();
  const { glossary, addGlossaryEntry, removeGlossaryEntry, importGlossaryEntries } = useGlossary();
  const { history } = useTranslationData();
  const { streak } = useStreak();
  const colors = getColors(settings.theme);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPhrasebook, setShowPhrasebook] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showFlightPrep, setShowFlightPrep] = useState(false);
  const [showVisualCards, setShowVisualCards] = useState(false);
  const [showCultureGuide, setShowCultureGuide] = useState(false);
  const [showPassengerCard, setShowPassengerCard] = useState(false);

  // Stable onClose callbacks so React.memo'd modals skip re-renders (#245)
  const closeSettingsModal = useCallback(() => setShowSettingsModal(false), []);
  const closePhrasebook = useCallback(() => setShowPhrasebook(false), []);
  const closeGlossary = useCallback(() => setShowGlossary(false), []);
  const closeStats = useCallback(() => setShowStats(false), []);
  const closeFlightPrep = useCallback(() => setShowFlightPrep(false), []);
  const closeVisualCards = useCallback(() => setShowVisualCards(false), []);
  const closeCultureGuide = useCallback(() => setShowCultureGuide(false), []);
  const closePassengerCard = useCallback(() => setShowPassengerCard(false), []);

  const speakText = useCallback((text: string) => {
    Speech.speak(text, { language: targetLang.speechCode, rate: settings.speechRate });
  }, [targetLang.speechCode, settings.speechRate]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      // #164: go through copyWithAutoClear so phrasebook copies inherit the
      // 60s privacy ladder that history/chat copies already use. Phrasebook
      // translations are user content (possibly medical/legal phrases),
      // so they should auto-clear for parity with the rest of the app.
      await copyWithAutoClear(text);
    } catch (err) {
      logger.warn("Storage", "Phrasebook copy failed", err);
    }
  }, []);

  const menuItems = useMemo(() => [
    { label: "Flight Prep", icon: "✈️", subtitle: "Download language packs for offline use", onPress: () => setShowFlightPrep(true) },
    { label: "Culture Guide", icon: "🌍", subtitle: "Passenger dietary, service & cultural tips", onPress: () => setShowCultureGuide(true) },
    { label: "Passenger Card", icon: "🙋", subtitle: "Hand to passenger for preference input", onPress: () => setShowPassengerCard(true) },
    { label: "Visual Cards", icon: "🃏", subtitle: "Pictogram cards for any language", onPress: () => setShowVisualCards(true) },
    { label: "App Settings", icon: "⚙", subtitle: "Theme, haptics, speech, provider", onPress: () => setShowSettingsModal(true) },
    { label: "Phrasebook", icon: "📖", subtitle: "Common phrases in 10 languages", onPress: () => setShowPhrasebook(true) },
    { label: "Glossary", icon: "📝", subtitle: `${glossary.length} custom translation${glossary.length === 1 ? "" : "s"}`, onPress: () => setShowGlossary(true) },
    { label: "Statistics", icon: "📊", subtitle: `${history.length} translations`, onPress: () => setShowStats(true) },
    { label: "Replay Tutorial", icon: "🎓", subtitle: "Show onboarding walkthrough", onPress: () => setShowOnboarding(true) },
  ], [glossary.length, history.length, setShowOnboarding]);

  return (
    <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
      <GlassBackdrop />
      <SafeAreaView style={styles.container}>
      <View style={[styles.header, { borderBottomColor: colors.glassBorder }]}>
        <Text style={[styles.title, { color: colors.titleText }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {menuItems.map((item) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.menuRow, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityHint={item.subtitle}
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
        onClose={closeSettingsModal}
        settings={settings}
        onUpdate={updateSettings}
      />

      <PhrasebookModal
        visible={showPhrasebook}
        onClose={closePhrasebook}
        sourceLangCode={sourceLang.code === "autodetect" ? "en" : sourceLang.code}
        targetLangCode={targetLang.code}
        onCopy={copyToClipboard}
        onSpeak={speakText}

        colors={colors}
      />

      <GlossaryModal
        visible={showGlossary}
        onClose={closeGlossary}
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
        onClose={closeStats}
        history={history}
        streak={streak}
        colors={colors}
      />

      <OnboardingModal
        visible={showOnboarding}
        onComplete={completeOnboarding}

        colors={colors}
      />

      <FlightPrepModal
        visible={showFlightPrep}
        onClose={closeFlightPrep}
        colors={colors}
        crewBaseLang={sourceLang.code === "autodetect" ? "en" : sourceLang.code}
      />

      <VisualCardsModal
        visible={showVisualCards}
        onClose={closeVisualCards}
        colors={colors}
        passengerLang={targetLang.code === "autodetect" ? undefined : targetLang.code}
        speechRate={settings.speechRate}
      />

      <CultureBriefingModal
        visible={showCultureGuide}
        onClose={closeCultureGuide}
        colors={colors}
      />

      <PassengerPreferenceCard
        visible={showPassengerCard}
        onClose={closePassengerCard}
        colors={colors}
        initialLang={targetLang.code === "autodetect" ? undefined : targetLang.code}
      />
      </SafeAreaView>
    </View>
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

export default React.memo(SettingsScreen);
