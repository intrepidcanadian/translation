import React, { useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import { Camera, type CameraDevice } from "react-native-vision-camera";
import { SCANNER_MODES, type ScannerModeKey } from "../../services/scannerModes";
import { selection } from "../../services/haptics";
import { primaryAlpha } from "../../theme";

const ScannerModePill = React.memo(function ScannerModePill({
  modeKey,
  label,
  icon,
  isSelected,
  onSelect,
}: {
  modeKey: ScannerModeKey;
  label: string;
  icon: string;
  isSelected: boolean;
  onSelect: (key: ScannerModeKey) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(modeKey);
    selection();
  }, [onSelect, modeKey]);

  return (
    <TouchableOpacity
      style={[styles.modePill, isSelected && styles.modePillActive]}
      onPress={handlePress}
      accessibilityLabel={`${label} scanner mode${isSelected ? ", selected" : ""}`}
      accessibilityHint={`Switch to ${label.toLowerCase()} scanning mode`}
      accessibilityRole="tab"
      accessibilityState={{ selected: isSelected }}
    >
      <Text style={styles.modePillIcon}>{icon}</Text>
      <Text style={[styles.modePillText, isSelected && styles.modePillTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
});

interface CameraPhaseProps {
  cameraRef: React.RefObject<Camera | null>;
  device: CameraDevice;
  visible: boolean;
  selectedMode: ScannerModeKey;
  modeLabel: string;
  modeIcon: string;
  modeInstruction: string;
  sourceLangCode: string;
  targetLangCode: string;
  error: string | null;
  onSelectMode: (mode: ScannerModeKey) => void;
  onCapture: () => void;
  onClose: () => void;
}

export default function CameraPhase({
  cameraRef,
  device,
  visible,
  selectedMode,
  modeLabel,
  modeIcon,
  modeInstruction,
  sourceLangCode,
  targetLangCode,
  error,
  onSelectMode,
  onCapture,
  onClose,
}: CameraPhaseProps) {
  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={visible}
        photo={true}
        preview={true}
      />

      {/* Document framing guide */}
      <View style={styles.frameGuide}>
        <View style={[styles.frameCorner, styles.frameTL]} />
        <View style={[styles.frameCorner, styles.frameTR]} />
        <View style={[styles.frameCorner, styles.frameBL]} />
        <View style={[styles.frameCorner, styles.frameBR]} />
      </View>

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topButton} onPress={onClose} accessibilityLabel="Close scanner" accessibilityHint="Returns to the translation screen" accessibilityRole="button">
          <Text style={styles.topButtonText}>X</Text>
        </TouchableOpacity>
        <View style={styles.docBadge}>
          <Text style={styles.docBadgeText}>{modeIcon} {modeLabel}</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Mode selector pills */}
      <View style={styles.modeBar} accessibilityRole="tablist" accessibilityLabel="Scanner mode selector">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeBarContent}>
          {SCANNER_MODES.map((m) => (
            <ScannerModePill
              key={m.key}
              modeKey={m.key}
              label={m.label}
              icon={m.icon}
              isSelected={selectedMode === m.key}
              onSelect={onSelectMode}
            />
          ))}
        </ScrollView>
      </View>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      {/* Bottom capture area */}
      <View style={styles.bottomArea}>
        <Text style={styles.instructionText}>{modeInstruction}</Text>
        <TouchableOpacity
          style={styles.captureButton}
          onPress={onCapture}
          activeOpacity={0.7}
          accessibilityLabel={`Capture and analyze ${modeLabel.toLowerCase()}`}
          accessibilityHint="Takes a photo and runs on-device OCR and translation"
        >
          <View style={styles.captureInner} />
        </TouchableOpacity>
        <Text style={styles.hintText}>
          {sourceLangCode.toUpperCase()} {"->"} {targetLangCode.toUpperCase()} | On-device AI
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    zIndex: 999,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 54 : 40,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  topButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  topButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  docBadge: {
    backgroundColor: primaryAlpha.strong,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  docBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  modeBar: {
    position: "absolute",
    top: Platform.OS === "ios" ? 108 : 94,
    left: 0,
    right: 0,
  },
  modeBarContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 6,
  },
  modePillActive: {
    backgroundColor: primaryAlpha.selected,
  },
  modePillIcon: {
    fontSize: 16,
  },
  modePillText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "600",
  },
  modePillTextActive: {
    color: "#fff",
  },
  frameGuide: {
    position: "absolute",
    top: "18%",
    left: "8%",
    right: "8%",
    bottom: "25%",
  },
  frameCorner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "#6c63ff",
  },
  frameTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 8,
  },
  frameTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 8,
  },
  frameBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  frameBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
  errorBanner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 150 : 136,
    left: 20,
    right: 20,
    backgroundColor: "rgba(255,71,87,0.9)",
    borderRadius: 12,
    padding: 12,
  },
  errorBannerText: {
    color: "#fff",
    fontSize: 14,
    textAlign: "center",
  },
  bottomArea: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingBottom: Platform.OS === "ios" ? 44 : 30,
    paddingTop: 16,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  instructionText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 16,
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#6c63ff",
  },
  hintText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "600",
  },
});
