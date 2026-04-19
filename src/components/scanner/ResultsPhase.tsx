import React, { useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import type { ThemeColors } from "../../theme";
import type { ExtractedField } from "../../services/scannerModes";

interface DocumentAnalysis {
  detectedLanguage: string | null;
  persons: string[];
  organizations: string[];
  places: string[];
  dates: string[];
  phoneNumbers: string[];
  urls: string[];
  addresses: string[];
  moneyAmounts: string[];
  sentenceCount: number;
  wordCount: number;
}

interface ResultsPhaseProps {
  colors: ThemeColors;
  modeIcon: string;
  modeLabel: string;
  selectedMode: string;
  originalText: string;
  translatedText: string;
  analysis: DocumentAnalysis | null;
  modeFields: ExtractedField[];
  copiedText: string | null;
  noteSaved: boolean;
  onRescan: () => void;
  onClose: () => void;
  onCopy: (text: string) => void;
  onSaveNote: () => void;
  onShare: () => void;
}

function ResultsPhase({
  colors,
  modeIcon,
  modeLabel,
  selectedMode,
  originalText,
  translatedText,
  analysis,
  modeFields,
  copiedText,
  noteSaved,
  onRescan,
  onClose,
  onCopy,
  onSaveNote,
  onShare,
}: ResultsPhaseProps) {
  const hasEntities = analysis && (
    analysis.persons.length > 0 ||
    analysis.organizations.length > 0 ||
    analysis.places.length > 0
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
      {/* Header */}
      <View style={[styles.resultsHeader, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onRescan} accessibilityRole="button" accessibilityLabel="Scan again" accessibilityHint="Returns to camera to scan another document">
          <Text style={[styles.headerAction, { color: colors.primary }]}>Rescan</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.titleText }]}>
          {modeIcon} {modeLabel}
        </Text>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close scanner" accessibilityHint="Returns to the translation screen">
          <Text style={[styles.headerAction, { color: colors.primary }]}>Done</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.resultsScroll} contentContainerStyle={styles.resultsContent}>
        {/* Stats bar */}
        {analysis && (
          <View style={[styles.statsBar, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            {analysis.detectedLanguage && (
              <View style={styles.statChip}>
                <Text style={[styles.statChipLabel, { color: colors.dimText }]}>Language</Text>
                <Text style={[styles.statChipValue, { color: colors.primary }]}>{analysis.detectedLanguage.toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.statChip}>
              <Text style={[styles.statChipLabel, { color: colors.dimText }]}>Words</Text>
              <Text style={[styles.statChipValue, { color: colors.primary }]}>{analysis.wordCount}</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={[styles.statChipLabel, { color: colors.dimText }]}>Sentences</Text>
              <Text style={[styles.statChipValue, { color: colors.primary }]}>{analysis.sentenceCount}</Text>
            </View>
          </View>
        )}

        {/* Mode-specific extracted fields */}
        {modeFields.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.titleText }]}>
              {selectedMode === "receipt" ? "Receipt Details" :
               selectedMode === "businessCard" ? "Contact Info" :
               selectedMode === "medicine" ? "Medication Details" :
               selectedMode === "menu" ? "Menu Analysis" :
               selectedMode === "textbook" ? "Content Summary" :
               "Key Information"}
            </Text>
            {modeFields.map((field, i) => (
              <FieldRow key={i} field={field} colors={colors} onCopy={onCopy} copiedText={copiedText} />
            ))}
          </View>
        )}

        {/* NER entities */}
        {hasEntities && (
          <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.titleText }]}>People, Places & Organizations</Text>
            {analysis!.persons.length > 0 && (
              <EntityRow icon="P" label="People" items={analysis!.persons} colors={colors} iconColor="#f472b6" />
            )}
            {analysis!.organizations.length > 0 && (
              <EntityRow icon="O" label="Orgs" items={analysis!.organizations} colors={colors} iconColor="#a78bfa" />
            )}
            {analysis!.places.length > 0 && (
              <EntityRow icon="L" label="Places" items={analysis!.places} colors={colors} iconColor="#34d399" />
            )}
          </View>
        )}

        {/* Translated text */}
        <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Translation</Text>
            <TouchableOpacity onPress={() => onCopy(translatedText)} accessibilityRole="button" accessibilityLabel="Copy translation" accessibilityHint="Copies translated text to clipboard">
              <Text style={[styles.copyAction, { color: colors.primary }]}>
                {copiedText === translatedText ? "Copied!" : "Copy"}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.documentText, { color: colors.translatedText }]} selectable>
            {translatedText}
          </Text>
        </View>

        {/* Original text */}
        <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Original Text</Text>
            <TouchableOpacity onPress={() => onCopy(originalText)} accessibilityRole="button" accessibilityLabel="Copy original text" accessibilityHint="Copies original scanned text to clipboard">
              <Text style={[styles.copyAction, { color: colors.primary }]}>
                {copiedText === originalText ? "Copied!" : "Copy"}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.documentText, { color: colors.secondaryText }]} selectable>
            {originalText}
          </Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: noteSaved ? "#4ade80" : colors.primary }]}
            onPress={onSaveNote}
            accessibilityRole="button"
            accessibilityLabel={noteSaved ? "Note saved" : "Save as note"}
            accessibilityHint={noteSaved ? undefined : "Saves the scanned document as a Markdown note"}
            accessibilityState={{ disabled: noteSaved }}
          >
            <Text style={styles.actionButtonText}>
              {noteSaved ? "Saved!" : "Save as Note"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel="Share report"
            accessibilityHint="Opens share sheet with the full scan report"
          >
            <Text style={styles.actionButtonText}>Share Report</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const FieldRow = React.memo(function FieldRow({
  field,
  colors,
  onCopy,
  copiedText,
}: {
  field: ExtractedField;
  colors: ThemeColors;
  onCopy: (text: string) => void;
  copiedText: string | null;
}) {
  const handleCopy = useCallback(() => onCopy(field.value), [onCopy, field.value]);
  return (
    <TouchableOpacity
      style={entityStyles.row}
      onPress={handleCopy}
      accessibilityRole="button"
      accessibilityLabel={`${field.label}: ${field.value}`}
      accessibilityHint="Tap to copy this value to clipboard"
    >
      <View style={[entityStyles.iconBadge, { backgroundColor: field.color + "22" }]}>
        <Text style={[entityStyles.iconText, { color: field.color }]}>{field.icon}</Text>
      </View>
      <View style={entityStyles.content}>
        <Text style={[entityStyles.label, { color: colors.dimText }]}>{field.label}</Text>
        <Text style={[entityStyles.valueText, { color: colors.primaryText }]} numberOfLines={2}>
          {copiedText === field.value ? "Copied!" : field.value}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const EntityRow = React.memo(function EntityRow({
  icon,
  label,
  items,
  colors,
  iconColor,
}: {
  icon: string;
  label: string;
  items: string[];
  colors: ThemeColors;
  iconColor: string;
}) {
  return (
    <View style={entityStyles.row}>
      <View style={[entityStyles.iconBadge, { backgroundColor: iconColor + "22" }]}>
        <Text style={[entityStyles.iconText, { color: iconColor }]}>{icon}</Text>
      </View>
      <View style={entityStyles.content}>
        <Text style={[entityStyles.label, { color: colors.dimText }]}>{label}</Text>
        <View style={entityStyles.chips}>
          {items.map((item, i) => (
            <View key={i} style={[entityStyles.chip, { backgroundColor: colors.bubbleBg, borderColor: colors.border }]}>
              <Text style={[entityStyles.chipText, { color: colors.primaryText }]} numberOfLines={1}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
});

const entityStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 12,
    gap: 10,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
  },
  iconText: {
    fontSize: 14,
    fontWeight: "800",
  },
  content: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  valueText: {
    fontSize: 15,
    lineHeight: 20,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    maxWidth: "90%",
  },
  chipText: {
    fontSize: 14,
  },
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    zIndex: 999,
  },
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 54 : 40,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  headerAction: {
    fontSize: 16,
    fontWeight: "600",
  },
  resultsScroll: {
    flex: 1,
  },
  resultsContent: {
    padding: 16,
  },
  statsBar: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    justifyContent: "space-around",
  },
  statChip: {
    alignItems: "center",
  },
  statChipLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statChipValue: {
    fontSize: 20,
    fontWeight: "800",
    marginTop: 2,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  copyAction: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  documentText: {
    fontSize: 15,
    lineHeight: 22,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});

export default React.memo(ResultsPhase);
