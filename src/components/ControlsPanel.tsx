import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  Animated,
  Keyboard,
} from "react-native";
import type { ThemeColors } from "../theme";

interface ControlsPanelProps {
  colors: ThemeColors;
  isLandscape: boolean;
  isListening: boolean;
  isTranslating: boolean;
  conversationMode: boolean;
  activeSpeaker: "A" | "B";
  history: { length: number };
  selectMode: boolean;
  selectedCount: number;
  typedText: string;
  typedPreview: string;
  copiedText: string | null;
  sourceLangName: string;
  targetLangName: string;
  silenceTimeout: number;
  pulseAnim: Animated.Value;
  pulseOpacity: Animated.Value;
  // Callbacks
  onClearHistory: () => void;
  onEnterSelectMode: () => void;
  onExitSelectMode: () => void;
  onExportSelected: () => void;
  onDeleteSelected: () => void;
  onShowExportPicker: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
  onStartListeningAs: (speaker: "A" | "B") => void;
  onOpenSplitScreen: () => void;
  onTypedTextChange: (text: string) => void;
  onSubmitTypedText: () => void;
  onCopyToClipboard: (text: string) => void;
}

function ControlsPanel({
  colors,
  isLandscape,
  isListening,
  isTranslating,
  conversationMode,
  activeSpeaker,
  history,
  selectMode,
  selectedCount,
  typedText,
  typedPreview,
  copiedText,
  sourceLangName,
  targetLangName,
  silenceTimeout,
  pulseAnim,
  pulseOpacity,
  onClearHistory,
  onEnterSelectMode,
  onExitSelectMode,
  onExportSelected,
  onDeleteSelected,
  onShowExportPicker,
  onStartListening,
  onStopListening,
  onStartListeningAs,
  onOpenSplitScreen,
  onTypedTextChange,
  onSubmitTypedText,
  onCopyToClipboard,
}: ControlsPanelProps) {
  return (
    <View style={[styles.controls, isLandscape && styles.controlsLandscape]}>
      {history.length > 0 && !isListening && (
        <View style={styles.historyActions}>
          {selectMode ? (
            <>
              <TouchableOpacity style={styles.clearButton} onPress={onExitSelectMode} accessibilityRole="button" accessibilityLabel="Cancel selection">
                <Text style={[styles.clearText, { color: colors.dimText }]}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.selectCountText, { color: colors.mutedText }]}>{selectedCount} selected</Text>
              <TouchableOpacity style={styles.clearButton} onPress={onExportSelected} accessibilityRole="button" accessibilityLabel="Share selected" disabled={selectedCount === 0}>
                <Text style={[styles.shareText, { color: selectedCount > 0 ? colors.primary : colors.dimText }]}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearButton} onPress={onDeleteSelected} accessibilityRole="button" accessibilityLabel="Delete selected" disabled={selectedCount === 0}>
                <Text style={[styles.clearText, { color: selectedCount > 0 ? colors.errorText : colors.dimText }]}>Delete</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.clearButton} onPress={onClearHistory} accessibilityRole="button" accessibilityLabel="Clear translation history">
                <Text style={[styles.clearText, { color: colors.dimText }]}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearButton} onPress={onEnterSelectMode} accessibilityRole="button" accessibilityLabel="Select multiple translations">
                <Text style={[styles.shareText, { color: colors.mutedText }]}>Select</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearButton} onPress={onShowExportPicker} accessibilityRole="button" accessibilityLabel="Share translation history">
                <Text style={[styles.shareText, { color: colors.primary }]}>Share</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {conversationMode ? (
        <View style={styles.convoControls}>
          <TouchableOpacity
            style={[styles.splitScreenBtn, { backgroundColor: colors.cardBg, borderColor: colors.primary }]}
            onPress={onOpenSplitScreen}
            accessibilityRole="button"
            accessibilityLabel="Open split screen conversation mode"
            accessibilityHint="Opens a split view for face-to-face translation between two speakers"
          >
            <Text style={[styles.splitScreenIcon, { color: colors.primary }]}>⇅</Text>
            <Text style={[styles.splitScreenLabel, { color: colors.primary }]}>Face to Face</Text>
          </TouchableOpacity>
          <View style={styles.convoMicCol}>
            <View style={styles.micButtonWrapper}>
              {isListening && activeSpeaker === "A" && (
                <Animated.View style={[styles.pulseRing, { backgroundColor: colors.destructiveBg, transform: [{ scale: pulseAnim }], opacity: pulseOpacity }]} />
              )}
              <TouchableOpacity
                style={[styles.micButton, styles.micButtonSmall, { backgroundColor: colors.primary, shadowColor: colors.primary }, isListening && activeSpeaker === "A" && { backgroundColor: colors.destructiveBg, shadowColor: colors.destructiveBg }]}
                onPress={isListening ? onStopListening : () => onStartListeningAs("A")}
                activeOpacity={0.7}
                disabled={isListening && activeSpeaker !== "A"}
                accessibilityRole="button"
                accessibilityLabel={isListening && activeSpeaker === "A" ? `Stop listening in ${sourceLangName}` : `Speak ${sourceLangName}`}
                accessibilityHint={isListening ? "Stops speech recognition" : `Starts listening for ${sourceLangName} speech to translate`}
                accessibilityState={{ busy: isListening && activeSpeaker === "A" }}
              >
                <Text style={styles.micIcon} importantForAccessibility="no">🎙️</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.convoLabel, { color: colors.mutedText }]}>{sourceLangName}</Text>
          </View>
          <View style={styles.convoMicCol}>
            <View style={styles.micButtonWrapper}>
              {isListening && activeSpeaker === "B" && (
                <Animated.View style={[styles.pulseRing, { backgroundColor: colors.destructiveBg, transform: [{ scale: pulseAnim }], opacity: pulseOpacity }]} />
              )}
              <TouchableOpacity
                style={[styles.micButton, styles.micButtonSmall, { backgroundColor: colors.primary, shadowColor: colors.primary }, isListening && activeSpeaker === "B" && { backgroundColor: colors.destructiveBg, shadowColor: colors.destructiveBg }]}
                onPress={isListening ? onStopListening : () => onStartListeningAs("B")}
                activeOpacity={0.7}
                disabled={isListening && activeSpeaker !== "B"}
                accessibilityRole="button"
                accessibilityLabel={isListening && activeSpeaker === "B" ? `Stop listening in ${targetLangName}` : `Speak ${targetLangName}`}
                accessibilityHint={isListening ? "Stops speech recognition" : `Starts listening for ${targetLangName} speech to translate`}
                accessibilityState={{ busy: isListening && activeSpeaker === "B" }}
              >
                <Text style={styles.micIcon} importantForAccessibility="no">🎙️</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.convoLabel, { color: colors.mutedText }]}>{targetLangName}</Text>
          </View>
        </View>
      ) : (
        <>
          <View style={[styles.micButtonWrapper, isLandscape && styles.micButtonWrapperLandscape]}>
            {isListening && (
              <Animated.View
                style={[styles.pulseRing, isLandscape && styles.pulseRingLandscape, { backgroundColor: colors.destructiveBg, transform: [{ scale: pulseAnim }], opacity: pulseOpacity }]}
              />
            )}
            <TouchableOpacity
              style={[styles.micButton, isLandscape && styles.micButtonLandscape, { backgroundColor: colors.primary, shadowColor: colors.primary }, isListening && { backgroundColor: colors.destructiveBg, shadowColor: colors.destructiveBg }]}
              onPress={isListening ? onStopListening : onStartListening}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={isListening ? "Stop listening" : "Start listening"}
              accessibilityState={{ busy: isListening }}
              accessibilityHint={isListening ? "Stops speech recognition" : "Starts speech recognition for translation"}
            >
              <Text style={styles.micIcon} importantForAccessibility="no">{isListening ? "⏹" : "🎙️"}</Text>
            </TouchableOpacity>
          </View>

          {isListening && (
            <View style={styles.listeningIndicator} accessibilityLiveRegion="polite">
              <Text style={[styles.listeningDot, { color: colors.destructiveBg }]} importantForAccessibility="no">●</Text>
              <Text style={[styles.listeningLabel, { color: colors.destructiveBg }]}>
                Listening...{silenceTimeout > 0 ? ` (auto-stop ${silenceTimeout}s)` : ""}
              </Text>
            </View>
          )}
        </>
      )}

      {!isListening && (
        <View>
          <View style={styles.textInputRow}>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.bubbleBg, color: colors.primaryText, borderColor: colors.border, maxHeight: 120 }]}
              placeholder="Or type to translate..."
              placeholderTextColor={colors.placeholderText}
              value={typedText}
              onChangeText={onTypedTextChange}
              onSubmitEditing={onSubmitTypedText}
              returnKeyType="send"
              editable={!isTranslating}
              accessibilityLabel="Type text to translate"
              accessibilityHint="Type text and press send to translate it"
              maxLength={500}
              multiline
              textAlignVertical="top"
            />
            {typedText.trim() ? (
              <TouchableOpacity style={[styles.sendButton, { backgroundColor: colors.primary }]} onPress={onSubmitTypedText} accessibilityRole="button" accessibilityLabel="Translate typed text">
                <Text style={[styles.sendIcon, { color: colors.destructiveText }]}>→</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {typedText.length > 0 && (
            <View style={styles.charCountRow}>
              <Text style={[styles.charCountText, { color: typedText.length >= 450 ? colors.errorText : colors.dimText }]}>
                {typedText.length}/500
              </Text>
              <Text style={[styles.wordCountText, { color: colors.dimText }]}>
                {typedText.trim().split(/\s+/).filter(Boolean).length} {typedText.trim().split(/\s+/).filter(Boolean).length === 1 ? "word" : "words"}
              </Text>
            </View>
          )}
          {typedPreview ? (
            <TouchableOpacity
              style={[styles.typedPreview, { backgroundColor: colors.translatedBubbleBg, borderLeftColor: colors.primary }]}
              onPress={() => onCopyToClipboard(typedPreview)}
              accessibilityLiveRegion="polite"
              accessibilityLabel={`Preview: ${typedPreview}. Tap to copy.`}
            >
              <Text style={[styles.typedPreviewText, { color: colors.translatedText }]}>{typedPreview}</Text>
              {copiedText === typedPreview && <Text style={[styles.copiedBadge, { color: colors.successText }]}>Copied!</Text>}
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

export default React.memo(ControlsPanel);

const styles = StyleSheet.create({
  controls: { alignItems: "center", paddingBottom: Platform.OS === "android" ? 20 : 10, paddingTop: 10 },
  controlsLandscape: { paddingBottom: 4, paddingTop: 4 },
  historyActions: { flexDirection: "row", gap: 20, marginBottom: 12 },
  clearButton: {},
  clearText: { fontSize: 14, fontWeight: "600" },
  shareText: { fontSize: 14, fontWeight: "600" },
  selectCountText: { fontSize: 13, fontWeight: "600" },
  micButtonWrapper: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  micButtonWrapperLandscape: { width: 56, height: 56 },
  pulseRing: { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: "#ff4757" },
  pulseRingLandscape: { width: 56, height: 56, borderRadius: 28 },
  micButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#6c63ff", alignItems: "center", justifyContent: "center", shadowColor: "#6c63ff", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  micButtonLandscape: { width: 56, height: 56, borderRadius: 28 },
  micButtonSmall: { width: 60, height: 60, borderRadius: 30 },
  micIcon: { fontSize: 32 },
  listeningIndicator: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 6 },
  listeningDot: { color: "#ff4757", fontSize: 10 },
  listeningLabel: { color: "#ff4757", fontSize: 13, fontWeight: "600" },
  convoControls: { flexDirection: "row", justifyContent: "center", alignItems: "flex-end", gap: 24 },
  splitScreenBtn: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, marginBottom: 8 },
  splitScreenIcon: { fontSize: 20, fontWeight: "700" },
  splitScreenLabel: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  convoMicCol: { alignItems: "center", gap: 8 },
  convoLabel: { fontSize: 12, fontWeight: "600" },
  textInputRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 12, gap: 8, width: "100%" },
  textInput: { flex: 1, borderRadius: 20, paddingTop: 10, paddingBottom: 10, paddingHorizontal: 16, fontSize: 15, borderWidth: 1, minHeight: 40 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#6c63ff", alignItems: "center", justifyContent: "center" },
  sendIcon: { color: "#ffffff", fontSize: 18, fontWeight: "700" },
  charCountRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, marginTop: 4 },
  charCountText: { fontSize: 11, fontWeight: "600" },
  wordCountText: { fontSize: 11, fontWeight: "600" },
  typedPreview: { marginTop: 8, borderRadius: 12, padding: 10, borderLeftWidth: 3 },
  typedPreviewText: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  copiedBadge: { color: "#4ade80", fontSize: 12, fontWeight: "700", marginTop: 6 },
});
