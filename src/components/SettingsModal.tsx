import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Switch,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import Slider from "@react-native-community/slider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { type ThemeMode, type ThemeColors, getColors } from "../theme";
import { isAppleTranslationAvailable, type TranslationProvider } from "../services/translation";
import { logger } from "../services/logger";
import { notifySuccess } from "../services/haptics";

export type { TranslationProvider };

export type FontSizeOption = "small" | "medium" | "large" | "xlarge";

export const FONT_SIZE_SCALES: Record<FontSizeOption, number> = {
  small: 0.85,
  medium: 1.0,
  large: 1.2,
  xlarge: 1.4,
};

export type SilenceTimeoutOption = 0 | 3 | 5 | 10;

export type ConfidenceThreshold = 0 | 50 | 70 | 85;

export interface Settings {
  hapticsEnabled: boolean;
  autoPlayTTS: boolean;
  speechRate: number;
  fontSize: FontSizeOption;
  theme: ThemeMode;
  autoScroll: boolean;
  translationProvider: TranslationProvider;
  showRomanization: boolean;
  offlineSpeech: boolean;
  silenceTimeout: SilenceTimeoutOption;
  confidenceThreshold: ConfidenceThreshold;
}

export const DEFAULT_SETTINGS: Settings = {
  hapticsEnabled: true,
  autoPlayTTS: false,
  speechRate: 1.0,
  fontSize: "medium",
  theme: "dark",
  autoScroll: true,
  translationProvider: "apple",
  showRomanization: true,
  offlineSpeech: false,
  silenceTimeout: 0,
  confidenceThreshold: 0,
};

interface Props {
  visible: boolean;
  onClose: () => void;
  settings: Settings;
  onUpdate: (settings: Settings) => void;
}

export default function SettingsModal({ visible, onClose, settings, onUpdate }: Props) {
  const colors = useMemo(() => getColors(settings.theme), [settings.theme]);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [lastCrash, setLastCrash] = useState<{ message: string; timestamp: number; stack?: string } | null>(null);
  const [crashCopied, setCrashCopied] = useState(false);

  useEffect(() => {
    if (Platform.OS === "ios") {
      isAppleTranslationAvailable().then(setAppleAvailable);
    }
  }, []);

  // Load last crash report when settings opens
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem("@live_translator_last_crash")
      .then((val) => { if (val) setLastCrash(JSON.parse(val)); })
      .catch(() => {});
  }, [visible]);

  const copyCrashReport = useCallback(async () => {
    if (!lastCrash) return;
    const recentErrors = logger.getRecentErrors();
    const report = [
      `Crash: ${lastCrash.message}`,
      `Time: ${new Date(lastCrash.timestamp).toLocaleString()}`,
      lastCrash.stack ? `Stack: ${lastCrash.stack}` : "",
      recentErrors.length > 0 ? `\nRecent errors (${recentErrors.length}):` : "",
      ...recentErrors.slice(-10).map((e) => `  [${e.tag}] ${e.message}`),
    ].filter(Boolean).join("\n");
    await Clipboard.setStringAsync(report);
    notifySuccess();
    setCrashCopied(true);
    setTimeout(() => setCrashCopied(false), 1500);
  }, [lastCrash]);

  const clearCrashReport = useCallback(async () => {
    await AsyncStorage.removeItem("@live_translator_last_crash");
    logger.clearRecentErrors();
    setLastCrash(null);
  }, []);

  const toggle = (key: keyof Settings) => {
    onUpdate({ ...settings, [key]: !settings[key] });
  };

  const dynamicStyles = useMemo(() => ({
    overlay: { backgroundColor: colors.overlayBg },
    content: { backgroundColor: colors.modalBg },
    title: { color: colors.titleText },
    rowTitle: { color: colors.primaryText },
    rowSubtitle: { color: colors.dimText },
    rowBorder: { borderBottomColor: colors.borderLight },
    switchTrack: { false: colors.border, true: colors.primary },
    sliderMax: colors.border,
    fontSizeOption: { backgroundColor: colors.cardBg },
    fontSizeLabel: { color: colors.mutedText },
    infoTitle: { color: colors.mutedText },
    infoText: { color: colors.dimText },
    closeButton: { borderTopColor: colors.borderLight },
    closeText: { color: colors.primary },
    themeOption: { backgroundColor: colors.cardBg },
    themeLabel: { color: colors.mutedText },
  }), [colors]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View accessibilityViewIsModal={true} style={[styles.overlay, dynamicStyles.overlay]}>
        <View style={[styles.content, dynamicStyles.content]}>
          <Text style={[styles.title, dynamicStyles.title]}>Settings</Text>

          <ScrollView style={styles.list}>
            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Theme</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>App color scheme</Text>
              </View>
            </View>
            <View style={styles.fontSizeRow}>
              {(["dark", "light"] as ThemeMode[]).map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.fontSizeOption,
                    dynamicStyles.themeOption,
                    settings.theme === option && { backgroundColor: colors.primary },
                  ]}
                  onPress={() => onUpdate({ ...settings, theme: option })}
                  accessibilityRole="button"
                  accessibilityLabel={`Theme: ${option}`}
                  accessibilityState={{ selected: settings.theme === option }}
                >
                  <Text
                    style={[
                      styles.fontSizeLabel,
                      dynamicStyles.themeLabel,
                      settings.theme === option && { color: colors.destructiveText },
                    ]}
                  >
                    {option === "dark" ? "Dark" : "Light"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Haptic Feedback</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Vibration on button presses</Text>
              </View>
              <Switch
                value={settings.hapticsEnabled}
                onValueChange={() => toggle("hapticsEnabled")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle haptic feedback"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Auto-Play Translation</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Speak translations automatically</Text>
              </View>
              <Switch
                value={settings.autoPlayTTS}
                onValueChange={() => toggle("autoPlayTTS")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle auto-play translation speech"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Auto-Scroll</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Scroll to latest translation automatically</Text>
              </View>
              <Switch
                value={settings.autoScroll}
                onValueChange={() => toggle("autoScroll")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle auto-scroll"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Romanization</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Show Pinyin, Romaji, etc. for non-Latin scripts</Text>
              </View>
              <Switch
                value={settings.showRomanization}
                onValueChange={() => toggle("showRomanization")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle romanization display"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Offline Speech</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Use on-device recognition (no internet needed)</Text>
              </View>
              <Switch
                value={settings.offlineSpeech}
                onValueChange={() => toggle("offlineSpeech")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle offline speech recognition"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Auto-Stop After Silence</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Stop listening after silence (0 = manual stop)</Text>
              </View>
            </View>
            <View style={styles.fontSizeRow}>
              {([0, 3, 5, 10] as SilenceTimeoutOption[]).map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.fontSizeOption,
                    dynamicStyles.fontSizeOption,
                    settings.silenceTimeout === option && { backgroundColor: colors.primary },
                  ]}
                  onPress={() => onUpdate({ ...settings, silenceTimeout: option })}
                  accessibilityRole="button"
                  accessibilityLabel={`Auto-stop after silence: ${option === 0 ? "off" : `${option} seconds`}`}
                  accessibilityState={{ selected: settings.silenceTimeout === option }}
                >
                  <Text
                    style={[
                      styles.fontSizeLabel,
                      dynamicStyles.fontSizeLabel,
                      settings.silenceTimeout === option && { color: colors.destructiveText },
                    ]}
                  >
                    {option === 0 ? "Off" : `${option}s`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Confidence Warning</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Warn when translation quality is below threshold</Text>
              </View>
            </View>
            <View style={styles.fontSizeRow}>
              {([0, 50, 70, 85] as ConfidenceThreshold[]).map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.fontSizeOption,
                    dynamicStyles.fontSizeOption,
                    settings.confidenceThreshold === option && { backgroundColor: colors.primary },
                  ]}
                  onPress={() => onUpdate({ ...settings, confidenceThreshold: option })}
                  accessibilityRole="button"
                  accessibilityLabel={`Confidence warning threshold: ${option === 0 ? "off" : `${option}%`}`}
                  accessibilityState={{ selected: settings.confidenceThreshold === option }}
                >
                  <Text
                    style={[
                      styles.fontSizeLabel,
                      dynamicStyles.fontSizeLabel,
                      settings.confidenceThreshold === option && { color: colors.destructiveText },
                    ]}
                  >
                    {option === 0 ? "Off" : `${option}%`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Speech Speed</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>
                  {settings.speechRate <= 0.6 ? "Very Slow" : settings.speechRate <= 0.8 ? "Slow" : settings.speechRate <= 1.1 ? "Normal" : settings.speechRate <= 1.5 ? "Fast" : "Very Fast"} ({settings.speechRate.toFixed(1)}x)
                </Text>
              </View>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0.5}
              maximumValue={2.0}
              step={0.1}
              value={settings.speechRate}
              onSlidingComplete={(value) => onUpdate({ ...settings, speechRate: Math.round(value * 10) / 10 })}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={dynamicStyles.sliderMax}
              thumbTintColor={colors.destructiveText}
              accessibilityLabel={`Speech speed: ${settings.speechRate.toFixed(1)}x`}
            />

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Text Size</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Adjust translation bubble font size</Text>
              </View>
            </View>
            <View style={styles.fontSizeRow}>
              {(["small", "medium", "large", "xlarge"] as FontSizeOption[]).map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.fontSizeOption,
                    dynamicStyles.fontSizeOption,
                    settings.fontSize === option && { backgroundColor: colors.primary },
                  ]}
                  onPress={() => onUpdate({ ...settings, fontSize: option })}
                  accessibilityRole="button"
                  accessibilityLabel={`Text size: ${option === "xlarge" ? "extra large" : option}`}
                  accessibilityState={{ selected: settings.fontSize === option }}
                >
                  <Text
                    style={[
                      styles.fontSizeLabel,
                      dynamicStyles.fontSizeLabel,
                      settings.fontSize === option && { color: colors.destructiveText },
                    ]}
                  >
                    {option === "small" ? "S" : option === "medium" ? "M" : option === "large" ? "L" : "XL"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Translation Provider</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Choose your translation engine</Text>
              </View>
            </View>

            <View style={styles.fontSizeRow}>
              {appleAvailable && (
                <TouchableOpacity
                  style={[
                    styles.fontSizeOption,
                    dynamicStyles.fontSizeOption,
                    settings.translationProvider === "apple" && { backgroundColor: colors.primary },
                  ]}
                  onPress={() => onUpdate({ ...settings, translationProvider: "apple" })}
                  accessibilityRole="button"
                  accessibilityLabel="Translation provider: Apple on-device (uses Neural Engine)"
                  accessibilityState={{ selected: settings.translationProvider === "apple" }}
                >
                  <Text
                    style={[
                      styles.fontSizeLabel,
                      dynamicStyles.fontSizeLabel,
                      settings.translationProvider === "apple" && { color: colors.destructiveText },
                    ]}
                  >
                    Apple
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.fontSizeOption,
                  dynamicStyles.fontSizeOption,
                  settings.translationProvider === "mlkit" && { backgroundColor: colors.primary },
                ]}
                onPress={() => onUpdate({ ...settings, translationProvider: "mlkit" })}
                accessibilityRole="button"
                accessibilityLabel="Translation provider: ML Kit on-device"
                accessibilityState={{ selected: settings.translationProvider === "mlkit" }}
              >
                <Text
                  style={[
                    styles.fontSizeLabel,
                    dynamicStyles.fontSizeLabel,
                    settings.translationProvider === "mlkit" && { color: colors.destructiveText },
                  ]}
                >
                  ML Kit
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.fontSizeOption,
                  dynamicStyles.fontSizeOption,
                  settings.translationProvider === "mymemory" && { backgroundColor: colors.primary },
                ]}
                onPress={() => onUpdate({ ...settings, translationProvider: "mymemory" })}
                accessibilityRole="button"
                accessibilityLabel="Translation provider: MyMemory cloud API"
                accessibilityState={{ selected: settings.translationProvider === "mymemory" }}
              >
                <Text
                  style={[
                    styles.fontSizeLabel,
                    dynamicStyles.fontSizeLabel,
                    settings.translationProvider === "mymemory" && { color: colors.destructiveText },
                  ]}
                >
                  Cloud
                </Text>
              </TouchableOpacity>
            </View>
            {settings.translationProvider === "apple" && (
              <Text style={[styles.providerHint, { color: colors.dimText }]}>
                Apple Neural Engine — fast, private translation. No data leaves your device.
              </Text>
            )}
            {settings.translationProvider === "mlkit" && (
              <Text style={[styles.providerHint, { color: colors.dimText }]}>
                Google ML Kit runs on-device. Language models (~30MB each) download on first use.
              </Text>
            )}
            {settings.translationProvider === "mymemory" && (
              <Text style={[styles.providerHint, { color: colors.dimText }]}>
                MyMemory cloud API — free, requires internet. Used as fallback when on-device fails.
              </Text>
            )}

            {/* Offline feature indicator */}
            <View style={styles.infoSection}>
              <Text style={[styles.infoTitle, dynamicStyles.infoTitle]}>Offline Capabilities</Text>
              <Text style={[styles.infoText, dynamicStyles.infoText]}>
                Features that work without internet:
              </Text>
              <View style={styles.offlineList}>
                <OfflineFeatureRow label="Speech Recognition" available={settings.offlineSpeech} hint={settings.offlineSpeech ? "On-device" : "Enable Offline Speech above"} colors={colors} />
                <OfflineFeatureRow label="Translation (Apple)" available={settings.translationProvider === "apple"} hint={settings.translationProvider === "apple" ? "Neural Engine" : "Select Apple provider"} colors={colors} />
                <OfflineFeatureRow label="Translation (ML Kit)" available={settings.translationProvider === "mlkit"} hint={settings.translationProvider === "mlkit" ? "On-device models" : "Select ML Kit provider"} colors={colors} />
                <OfflineFeatureRow label="Phrasebook" available hint="120+ phrases in 10 languages" colors={colors} />
                <OfflineFeatureRow label="Glossary Lookup" available hint="Your custom translations" colors={colors} />
                <OfflineFeatureRow label="Camera OCR" available hint="ML Kit text recognition" colors={colors} />
                <OfflineFeatureRow label="Text-to-Speech" available hint="System voices" colors={colors} />
                <OfflineFeatureRow label="Translation History" available hint="Stored locally" colors={colors} />
                <OfflineFeatureRow label="Cloud Translation" available={false} hint="Requires internet" colors={colors} />
                <OfflineFeatureRow label="Translation Comparison" available={false} hint="Multi-provider, requires internet" colors={colors} />
                <OfflineFeatureRow label="Word Alternatives" available={false} hint="MyMemory API lookup" colors={colors} />
              </View>
            </View>

            <View style={styles.infoSection}>
              <Text style={[styles.infoTitle, dynamicStyles.infoTitle]}>About</Text>
              <Text style={[styles.infoText, dynamicStyles.infoText]}>Live Translator v1.0.0</Text>
              <Text style={[styles.infoText, dynamicStyles.infoText]}>
                Translation powered by {
                  settings.translationProvider === "apple" ? "Apple Neural Engine (on-device)" :
                  settings.translationProvider === "mlkit" ? "Google ML Kit (on-device)" :
                  "MyMemory API (cloud)"
                }
              </Text>
            </View>

            {/* Debug / crash report section */}
            {(lastCrash || logger.getRecentErrors().length > 0) && (
              <View style={styles.infoSection}>
                <Text style={[styles.infoTitle, dynamicStyles.infoTitle]}>Debug</Text>
                {lastCrash && (
                  <View style={[styles.crashCard, { backgroundColor: colors.errorBg, borderColor: colors.errorBorder }]}>
                    <Text style={[styles.crashTitle, { color: colors.errorText }]}>Last Crash</Text>
                    <Text style={[styles.crashMessage, { color: colors.errorText }]} numberOfLines={3}>
                      {lastCrash.message}
                    </Text>
                    <Text style={[styles.crashTime, { color: colors.dimText }]}>
                      {new Date(lastCrash.timestamp).toLocaleString()}
                    </Text>
                  </View>
                )}
                {logger.getRecentErrors().length > 0 && (
                  <Text style={[styles.infoText, dynamicStyles.infoText]}>
                    {logger.getRecentErrors().length} recent error{logger.getRecentErrors().length === 1 ? "" : "s"} logged
                  </Text>
                )}
                <View style={styles.crashActions}>
                  <TouchableOpacity
                    style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                    onPress={copyCrashReport}
                    accessibilityLabel="Copy crash report to clipboard"
                  >
                    <Text style={[styles.crashActionText, { color: colors.primary }]}>
                      {crashCopied ? "Copied!" : "Copy Report"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                    onPress={clearCrashReport}
                    accessibilityLabel="Clear crash report"
                  >
                    <Text style={[styles.crashActionText, { color: colors.dimText }]}>Clear</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.closeButton, dynamicStyles.closeButton]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close settings"
          >
            <Text style={[styles.closeText, dynamicStyles.closeText]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function OfflineFeatureRow({ label, available, hint, colors }: { label: string; available: boolean; hint: string; colors: ReturnType<typeof getColors> }) {
  return (
    <View style={offlineStyles.row}>
      <Text style={[offlineStyles.indicator, { color: available ? "#4ade80" : colors.dimText }]}>
        {available ? "●" : "○"}
      </Text>
      <View style={offlineStyles.textCol}>
        <Text style={[offlineStyles.label, { color: colors.primaryText }]}>{label}</Text>
        <Text style={[offlineStyles.hint, { color: colors.dimText }]}>{hint}</Text>
      </View>
    </View>
  );
}

const offlineStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  indicator: { fontSize: 12, width: 16, textAlign: "center" },
  textCol: { flex: 1 },
  label: { fontSize: 14, fontWeight: "500" },
  hint: { fontSize: 11, marginTop: 1 },
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "70%",
    paddingTop: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },
  list: {
    paddingHorizontal: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  rowText: {
    flex: 1,
    marginRight: 16,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  rowSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  slider: {
    width: "100%",
    height: 40,
    marginBottom: 8,
  },
  infoSection: {
    paddingTop: 24,
    paddingBottom: 12,
  },
  infoTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    marginBottom: 4,
  },
  fontSizeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },
  fontSizeOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  fontSizeOptionActive: {
    // backgroundColor set via inline style with colors.primary
  },
  fontSizeLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  fontSizeLabelActive: {
    // color set via inline style with colors.destructiveText
  },
  providerHint: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  crashCard: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  crashTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
  },
  crashMessage: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  crashTime: {
    fontSize: 11,
  },
  crashActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  crashActionButton: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  crashActionText: {
    fontSize: 13,
    fontWeight: "600",
  },
  offlineList: {
    marginTop: 8,
    gap: 2,
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
