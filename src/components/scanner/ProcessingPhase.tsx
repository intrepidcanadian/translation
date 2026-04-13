import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";

interface ProcessingPhaseProps {
  modeIcon: string;
  processingStep: string;
}

export default function ProcessingPhase({ modeIcon, processingStep }: ProcessingPhaseProps) {
  return (
    <View style={styles.container}>
      <View style={styles.centerContent}>
        <Text style={styles.modeIcon}>{modeIcon}</Text>
        <ActivityIndicator size="large" color="#6c63ff" />
        <Text style={styles.processingStep}>{processingStep}</Text>
        <Text style={styles.processingHint}>All processing runs on-device</Text>
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
