import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import CollapsibleSection from "./CollapsibleSection";
import { type ThemeColors } from "../theme";
import { logger } from "../services/logger";
import type { CrashReport } from "../types/crashReport";

interface Props {
  colors: ThemeColors;
  lastCrash: CrashReport | null;
  crashSectionExpanded: boolean;
  crashCopied: true | null;
  onToggleCrashSection: () => void;
  onCopyCrashReport: () => void;
  onShareCrashReport: () => void;
  onClearCrashReport: () => void;
}

function DebugPanel({
  colors,
  lastCrash,
  crashSectionExpanded,
  crashCopied,
  onToggleCrashSection,
  onCopyCrashReport,
  onShareCrashReport,
  onClearCrashReport,
}: Props) {
  const dynamicStyles = useMemo(() => ({
    infoText: { color: colors.dimText },
  }), [colors]);

  const recentErrorCount = logger.getRecentErrors().length;

  return (
    <View style={styles.infoSection}>
      <CollapsibleSection
        title="Debug"
        expanded={crashSectionExpanded}
        onToggle={onToggleCrashSection}
        urgent={!!lastCrash}
        colors={colors}
      >
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
        {recentErrorCount > 0 && (
          <Text style={[styles.infoText, dynamicStyles.infoText]}>
            {recentErrorCount} recent error{recentErrorCount === 1 ? "" : "s"} logged
          </Text>
        )}
        <View style={styles.crashActions}>
          <TouchableOpacity
            style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
            onPress={onCopyCrashReport}
            accessibilityRole="button"
            accessibilityLabel="Copy crash report to clipboard"
          >
            <Text style={[styles.crashActionText, { color: colors.primary }]}>
              {crashCopied ? "Copied!" : "Copy"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
            onPress={onShareCrashReport}
            accessibilityRole="button"
            accessibilityLabel="Share crash report via system share sheet"
            accessibilityHint="Opens the share sheet to send the crash report to another app"
          >
            <Text style={[styles.crashActionText, { color: colors.primary }]}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
            onPress={onClearCrashReport}
            accessibilityRole="button"
            accessibilityLabel="Clear crash report"
          >
            <Text style={[styles.crashActionText, { color: colors.dimText }]}>Clear</Text>
          </TouchableOpacity>
        </View>
      </CollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  infoSection: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  infoText: {
    fontSize: 12,
    marginBottom: 2,
    lineHeight: 16,
  },
  crashCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
  },
  crashTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
  },
  crashMessage: {
    fontSize: 12,
    marginBottom: 4,
  },
  crashTime: {
    fontSize: 11,
  },
  crashActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  crashActionButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  crashActionText: {
    fontSize: 13,
    fontWeight: "600",
  },
});

export default React.memo(DebugPanel);
