import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  Switch,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import Slider from "@react-native-community/slider";
import { type ThemeMode, type ThemeColors, getColors } from "../theme";
import { isAppleTranslationAvailable } from "../services/translation";

export type TranslationProvider = "mymemory" | "deepl" | "google" | "apple" | "mlkit";

export type FontSizeOption = "small" | "medium" | "large" | "xlarge";

export const FONT_SIZE_SCALES: Record<FontSizeOption, number> = {
  small: 0.85,
  medium: 1.0,
  large: 1.2,
  xlarge: 1.4,
};

export type SilenceTimeoutOption = 0 | 3 | 5 | 10;

export interface Settings {
  hapticsEnabled: boolean;
  autoPlayTTS: boolean;
  speechRate: number;
  fontSize: FontSizeOption;
  theme: ThemeMode;
  autoScroll: boolean;
  translationProvider: TranslationProvider;
  apiKey: string;
  showRomanization: boolean;
  offlineSpeech: boolean;
  silenceTimeout: SilenceTimeoutOption;
}

export const DEFAULT_SETTINGS: Settings = {
  hapticsEnabled: true,
  autoPlayTTS: false,
  speechRate: 1.0,
  fontSize: "medium",
  theme: "dark",
  autoScroll: true,
  translationProvider: "mymemory",
  apiKey: "",
  showRomanization: true,
  offlineSpeech: false,
  silenceTimeout: 0,
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

  useEffect(() => {
    if (Platform.OS === "ios") {
      isAppleTranslationAvailable().then(setAppleAvailable);
    }
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
      <View style={[styles.overlay, dynamicStyles.overlay]}>
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
                    settings.theme === option && styles.fontSizeOptionActive,
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
                      settings.theme === option && styles.fontSizeLabelActive,
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
                thumbColor="#ffffff"
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
                thumbColor="#ffffff"
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
                thumbColor="#ffffff"
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
                thumbColor="#ffffff"
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
                thumbColor="#ffffff"
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
                    settings.silenceTimeout === option && styles.fontSizeOptionActive,
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
                      settings.silenceTimeout === option && styles.fontSizeLabelActive,
                    ]}
                  >
                    {option === 0 ? "Off" : `${option}s`}
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
              thumbTintColor="#ffffff"
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
                    settings.fontSize === option && styles.fontSizeOptionActive,
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
                      settings.fontSize === option && styles.fontSizeLabelActive,
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

            {/* On-Device providers (no API key, no data leaves device) */}
            {(appleAvailable || Platform.OS === "android") && (
              <>
                <Text style={[styles.providerSectionLabel, { color: colors.primary }]}>On-Device (Private, No Internet)</Text>
                <View style={styles.fontSizeRow}>
                  {appleAvailable && (
                    <TouchableOpacity
                      style={[
                        styles.fontSizeOption,
                        dynamicStyles.fontSizeOption,
                        settings.translationProvider === "apple" && styles.fontSizeOptionActive,
                      ]}
                      onPress={() => onUpdate({ ...settings, translationProvider: "apple", apiKey: "" })}
                      accessibilityRole="button"
                      accessibilityLabel="Translation provider: Apple on-device (uses Neural Engine)"
                      accessibilityState={{ selected: settings.translationProvider === "apple" }}
                    >
                      <Text
                        style={[
                          styles.fontSizeLabel,
                          dynamicStyles.fontSizeLabel,
                          settings.translationProvider === "apple" && styles.fontSizeLabelActive,
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
                      settings.translationProvider === "mlkit" && styles.fontSizeOptionActive,
                    ]}
                    onPress={() => onUpdate({ ...settings, translationProvider: "mlkit", apiKey: "" })}
                    accessibilityRole="button"
                    accessibilityLabel="Translation provider: ML Kit on-device"
                    accessibilityState={{ selected: settings.translationProvider === "mlkit" }}
                  >
                    <Text
                      style={[
                        styles.fontSizeLabel,
                        dynamicStyles.fontSizeLabel,
                        settings.translationProvider === "mlkit" && styles.fontSizeLabelActive,
                      ]}
                    >
                      ML Kit
                    </Text>
                  </TouchableOpacity>
                </View>
                {settings.translationProvider === "apple" && (
                  <Text style={[styles.providerHint, { color: colors.dimText }]}>
                    Uses Apple's Neural Engine for fast, private translation. No data leaves your device.
                  </Text>
                )}
                {settings.translationProvider === "mlkit" && (
                  <Text style={[styles.providerHint, { color: colors.dimText }]}>
                    Google ML Kit runs on-device. Language models (~30MB each) download on first use.
                  </Text>
                )}
              </>
            )}

            {/* Cloud providers */}
            <Text style={[styles.providerSectionLabel, { color: colors.mutedText }]}>Cloud (Requires Internet)</Text>
            <View style={styles.fontSizeRow}>
              {([
                { key: "mymemory" as const, label: "MyMemory" },
                { key: "deepl" as const, label: "DeepL" },
                { key: "google" as const, label: "Google" },
              ]).map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.fontSizeOption,
                    dynamicStyles.fontSizeOption,
                    settings.translationProvider === key && styles.fontSizeOptionActive,
                  ]}
                  onPress={() => onUpdate({ ...settings, translationProvider: key, apiKey: key === "mymemory" ? "" : settings.apiKey })}
                  accessibilityRole="button"
                  accessibilityLabel={`Translation provider: ${label}`}
                  accessibilityState={{ selected: settings.translationProvider === key }}
                >
                  <Text
                    style={[
                      styles.fontSizeLabel,
                      dynamicStyles.fontSizeLabel,
                      settings.translationProvider === key && styles.fontSizeLabelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {(settings.translationProvider === "deepl" || settings.translationProvider === "google") && (
              <View style={styles.apiKeyRow}>
                <TextInput
                  style={[styles.apiKeyInput, { backgroundColor: colors.cardBg, color: colors.primaryText, borderColor: colors.border }]}
                  placeholder={`${settings.translationProvider === "deepl" ? "DeepL" : "Google Cloud"} API key`}
                  placeholderTextColor={colors.placeholderText}
                  value={settings.apiKey}
                  onChangeText={(text) => onUpdate({ ...settings, apiKey: text })}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="API key input"
                />
              </View>
            )}

            <View style={styles.infoSection}>
              <Text style={[styles.infoTitle, dynamicStyles.infoTitle]}>About</Text>
              <Text style={[styles.infoText, dynamicStyles.infoText]}>Live Translator v1.0.0</Text>
              <Text style={[styles.infoText, dynamicStyles.infoText]}>
                Translation powered by {
                  settings.translationProvider === "apple" ? "Apple Neural Engine (on-device)" :
                  settings.translationProvider === "mlkit" ? "Google ML Kit (on-device)" :
                  settings.translationProvider === "deepl" ? "DeepL API" :
                  settings.translationProvider === "google" ? "Google Cloud API" :
                  "MyMemory API"
                }
              </Text>
            </View>
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
    backgroundColor: "#6c63ff",
  },
  fontSizeLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  fontSizeLabelActive: {
    color: "#ffffff",
  },
  providerSectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 8,
  },
  providerHint: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  apiKeyRow: {
    marginBottom: 8,
  },
  apiKeyInput: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    borderWidth: 1,
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
