import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";

interface ProcessingPhaseProps {
  modeIcon: string;
  processingStep: string;
}

export default React.memo(function ProcessingPhase({ modeIcon, processingStep }: ProcessingPhaseProps) {
  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel={`Processing document: ${processingStep}`}
    >
      <View style={styles.centerContent}>
        <Text style={styles.modeIcon} importantForAccessibility="no">{modeIcon}</Text>
        <ActivityIndicator size="large" color="#6c63ff" accessibilityElementsHidden={true} />
        <Text style={styles.processingStep} accessibilityLiveRegion="polite">{processingStep}</Text>
        <Text style={styles.processingHint} importantForAccessibility="no">All processing runs on-device</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    zIndex: 999,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  modeIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  processingStep: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 24,
    textAlign: "center",
  },
  processingHint: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    marginTop: 8,
  },
});
