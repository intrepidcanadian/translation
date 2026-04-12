import React from "react";
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
}

export const DEFAULT_SETTINGS: Settings = {
  hapticsEnabled: true,
  autoPlayTTS: false,
  speechRate: 1.0,
  fontSize: "medium",
};

interface Props {
  visible: boolean;
  onClose: () => void;
  settings: Settings;
  onUpdate: (settings: Settings) => void;
}

export default function SettingsModal({ visible, onClose, settings, onUpdate }: Props) {
  const toggle = (key: keyof Settings) => {
    onUpdate({ ...settings, [key]: !settings[key] });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>Settings</Text>

          <ScrollView style={styles.list}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Haptic Feedback</Text>
                <Text style={styles.rowSubtitle}>Vibration on button presses</Text>
              </View>
              <Switch
                value={settings.hapticsEnabled}
                onValueChange={() => toggle("hapticsEnabled")}
                trackColor={{ false: "#333355", true: "#6c63ff" }}
                thumbColor="#ffffff"
                accessibilityLabel="Toggle haptic feedback"
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Auto-Play Translation</Text>
                <Text style={styles.rowSubtitle}>Speak translations automatically</Text>
              </View>
              <Switch
                value={settings.autoPlayTTS}
                onValueChange={() => toggle("autoPlayTTS")}
                trackColor={{ false: "#333355", true: "#6c63ff" }}
                thumbColor="#ffffff"
                accessibilityLabel="Toggle auto-play translation speech"
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Speech Speed</Text>
                <Text style={styles.rowSubtitle}>
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
              minimumTrackTintColor="#6c63ff"
              maximumTrackTintColor="#333355"
              thumbTintColor="#ffffff"
              accessibilityLabel={`Speech speed: ${settings.speechRate.toFixed(1)}x`}
            />

            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Text Size</Text>
                <Text style={styles.rowSubtitle}>Adjust translation bubble font size</Text>
              </View>
            </View>
            <View style={styles.fontSizeRow}>
              {(["small", "medium", "large", "xlarge"] as FontSizeOption[]).map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.fontSizeOption,
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
                      settings.fontSize === option && styles.fontSizeLabelActive,
                    ]}
                  >
                    {option === "small" ? "S" : option === "medium" ? "M" : option === "large" ? "L" : "XL"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.infoSection}>
              <Text style={styles.infoTitle}>About</Text>
              <Text style={styles.infoText}>Live Translator v1.0.0</Text>
              <Text style={styles.infoText}>Translation powered by MyMemory API</Text>
            </View>
          </ScrollView>

          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close settings"
          >
            <Text style={styles.closeText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  content: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "70%",
    paddingTop: 20,
  },
  title: {
    color: "#ffffff",
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
    borderBottomColor: "#252547",
  },
  rowText: {
    flex: 1,
    marginRight: 16,
  },
  rowTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  rowSubtitle: {
    color: "#666688",
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
    color: "#8888aa",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  infoText: {
    color: "#555577",
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
    backgroundColor: "#252547",
    alignItems: "center",
    justifyContent: "center",
  },
  fontSizeOptionActive: {
    backgroundColor: "#6c63ff",
  },
  fontSizeLabel: {
    color: "#8888aa",
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
    borderTopColor: "#252547",
  },
  closeText: {
    color: "#6c63ff",
    fontSize: 17,
    fontWeight: "600",
  },
});
