import React, { useMemo } from "react";
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
import { type ThemeMode, type ThemeColors, getColors } from "../theme";

export type FontSizeOption = "small" | "medium" | "large" | "xlarge";

export const FONT_SIZE_SCALES: Record<FontSizeOption, number> = {
  small: 0.85,
  medium: 1.0,
  large: 1.2,
  xlarge: 1.4,
};

export interface Settings {
  hapticsEnabled: boolean;
  autoPlayTTS: boolean;
  speechRate: number;
  fontSize: FontSizeOption;
  theme: ThemeMode;
}

export const DEFAULT_SETTINGS: Settings = {
  hapticsEnabled: true,
  autoPlayTTS: false,
  speechRate: 1.0,
  fontSize: "medium",
  theme: "dark",
};

interface Props {
  visible: boolean;
  onClose: () => void;
  settings: Settings;
  onUpdate: (settings: Settings) => void;
}

export default function SettingsModal({ visible, onClose, settings, onUpdate }: Props) {
  const colors = useMemo(() => getColors(settings.theme), [settings.theme]);

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

            <View style={styles.infoSection}>
              <Text style={[styles.infoTitle, dynamicStyles.infoTitle]}>About</Text>
              <Text style={[styles.infoText, dynamicStyles.infoText]}>Live Translator v1.0.0</Text>
              <Text style={[styles.infoText, dynamicStyles.infoText]}>Translation powered by MyMemory API</Text>
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
