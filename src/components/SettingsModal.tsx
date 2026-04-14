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
  Share,
} from "react-native";
import Slider from "@react-native-community/slider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { type ThemeMode, type ThemeColors, getColors } from "../theme";
import {
  isAppleTranslationAvailable,
  getCircuitSnapshots,
  getTranslationCacheStats,
  resetCircuits,
  clearTranslationCache,
  type CircuitSnapshot,
  type TranslationCacheStats,
  type TranslationProvider,
} from "../services/translation";
import { logger } from "../services/logger";
import { notifySuccess } from "../services/haptics";
import { migrateCrashReport, type CrashReport } from "../types/crashReport";

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

function SettingsModal({ visible, onClose, settings, onUpdate }: Props) {
  const colors = useMemo(() => getColors(settings.theme), [settings.theme]);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [lastCrash, setLastCrash] = useState<CrashReport | null>(null);
  const [crashCopied, setCrashCopied] = useState(false);
  const [circuitSnapshots, setCircuitSnapshots] = useState<CircuitSnapshot[]>([]);
  const [cacheStats, setCacheStats] = useState<TranslationCacheStats | null>(null);
  // Collapsible debug sub-sections. Each defaults to collapsed; we auto-expand
  // an urgent section (open breaker, last crash) the first time the modal
  // renders so the user notices what needs attention.
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [crashSectionExpanded, setCrashSectionExpanded] = useState(false);

  useEffect(() => {
    if (Platform.OS === "ios") {
      isAppleTranslationAvailable().then(setAppleAvailable);
    }
  }, []);

  // Refresh live translation diagnostics every time the modal is shown.
  // Circuit breaker state and cache stats are in-memory only, so we re-read
  // them on open rather than subscribing. Also auto-expands the diagnostics
  // section on open when any breaker is open so the user sees the issue.
  useEffect(() => {
    if (!visible) return;
    const snapshots = getCircuitSnapshots();
    setCircuitSnapshots(snapshots);
    setCacheStats(getTranslationCacheStats());
    if (snapshots.some((s) => s.open)) setDiagnosticsExpanded(true);
  }, [visible]);

  const refreshDiagnostics = useCallback(() => {
    setCircuitSnapshots(getCircuitSnapshots());
    setCacheStats(getTranslationCacheStats());
  }, []);

  const handleResetCircuits = useCallback(() => {
    resetCircuits();
    refreshDiagnostics();
    notifySuccess();
  }, [refreshDiagnostics]);

  const handleClearTranslationCache = useCallback(() => {
    clearTranslationCache();
    refreshDiagnostics();
    notifySuccess();
  }, [refreshDiagnostics]);

  // Per-provider eviction — dumps just one provider's cached entries so users
  // switching providers can drop stale cloud results without nuking the whole
  // cache. Uses the new clearTranslationCache(provider) overload.
  const handleClearProviderCache = useCallback(
    (provider: string) => {
      clearTranslationCache(provider as TranslationProvider);
      refreshDiagnostics();
      notifySuccess();
    },
    [refreshDiagnostics]
  );

  // Load last crash report when settings opens. The stored blob runs through
  // migrateCrashReport so reports written by older app versions (pre-
  // schemaVersion) still render instead of being silently dropped.
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem("@live_translator_last_crash")
      .then((val) => {
        if (!val) return;
        try {
          const migrated = migrateCrashReport(JSON.parse(val));
          setLastCrash(migrated);
          // A real stored crash is more important than a general debug panel —
          // auto-expand so it can't be missed behind the disclosure triangle.
          setCrashSectionExpanded(true);
        } catch (err) {
          logger.warn("Settings", "Failed to parse crash report", err);
        }
      })
      .catch((err) => logger.warn("Settings", "Failed to load crash report", err));
  }, [visible]);

  const buildCrashReport = useCallback(() => {
    if (!lastCrash) return "";
    const recentErrors = logger.getRecentErrors();
    // Prefer the version stamped on the crash record (captured at crash time);
    // fall back to the live Platform info if the crash was saved before we
    // started recording it.
    const platformLine = lastCrash.platform ?? `${Platform.OS} ${Platform.Version}`;
    const versionLine = lastCrash.appVersion
      ? `Version: ${lastCrash.appVersion}${lastCrash.buildNumber ? ` (${lastCrash.buildNumber})` : ""}`
      : "";
    return [
      `Live Translator crash report`,
      versionLine,
      `Platform: ${platformLine}`,
      `Crash: ${lastCrash.message}`,
      `Time: ${new Date(lastCrash.timestamp).toLocaleString()}`,
      lastCrash.stack ? `Stack: ${lastCrash.stack}` : "",
      recentErrors.length > 0 ? `\nRecent errors (${recentErrors.length}):` : "",
      ...recentErrors.slice(-10).map((e) => `  [${e.tag}] ${e.message}`),
    ].filter(Boolean).join("\n");
  }, [lastCrash]);

  const copyCrashReport = useCallback(async () => {
    if (!lastCrash) return;
    try {
      await Clipboard.setStringAsync(buildCrashReport());
      notifySuccess();
      setCrashCopied(true);
      setTimeout(() => setCrashCopied(false), 1500);
    } catch (err) {
      logger.warn("Settings", "Copy crash report failed", err instanceof Error ? err.message : String(err));
    }
  }, [lastCrash, buildCrashReport]);

  const shareCrashReport = useCallback(async () => {
    if (!lastCrash) return;
    try {
      await Share.share({
        message: buildCrashReport(),
        title: "Live Translator crash report",
      });
    } catch (err) {
      logger.warn("Settings", "Share crash report failed", err instanceof Error ? err.message : String(err));
    }
  }, [lastCrash, buildCrashReport]);

  const clearCrashReport = useCallback(async () => {
    try {
      await AsyncStorage.removeItem("@live_translator_last_crash");
      logger.clearRecentErrors();
      setLastCrash(null);
    } catch (err) {
      logger.warn("Settings", "Clear crash report failed", err instanceof Error ? err.message : String(err));
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
    // fontSizeOption and fontSizeLabel now handled by OptionPicker
    infoTitle: { color: colors.mutedText },
    infoText: { color: colors.dimText },
    closeButton: { borderTopColor: colors.borderLight },
    closeText: { color: colors.primary },
    // themeOption and themeLabel now handled by OptionPicker
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
            <OptionPicker
              options={["dark", "light"] as ThemeMode[]}
              selected={settings.theme}
              onSelect={(value) => onUpdate({ ...settings, theme: value })}
              labelFn={(v) => v === "dark" ? "Dark" : "Light"}
              accessibilityPrefix="Theme"
              colors={colors}
            />

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
            <OptionPicker
              options={[0, 3, 5, 10] as SilenceTimeoutOption[]}
              selected={settings.silenceTimeout}
              onSelect={(value) => onUpdate({ ...settings, silenceTimeout: value })}
              labelFn={(v) => v === 0 ? "Off" : `${v}s`}
              accessibilityPrefix="Auto-stop after silence"
              colors={colors}
            />

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Confidence Warning</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Warn when translation quality is below threshold</Text>
              </View>
            </View>
            <OptionPicker
              options={[0, 50, 70, 85] as ConfidenceThreshold[]}
              selected={settings.confidenceThreshold}
              onSelect={(value) => onUpdate({ ...settings, confidenceThreshold: value })}
              labelFn={(v) => v === 0 ? "Off" : `${v}%`}
              accessibilityPrefix="Confidence warning threshold"
              colors={colors}
            />

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
            <OptionPicker
              options={["small", "medium", "large", "xlarge"] as FontSizeOption[]}
              selected={settings.fontSize}
              onSelect={(value) => onUpdate({ ...settings, fontSize: value })}
              labelFn={(v) => v === "small" ? "S" : v === "medium" ? "M" : v === "large" ? "L" : "XL"}
              accessibilityPrefix="Text size"
              colors={colors}
            />

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Translation Provider</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Choose your translation engine</Text>
              </View>
            </View>

            <OptionPicker
              options={(appleAvailable ? ["apple", "mlkit", "mymemory"] : ["mlkit", "mymemory"]) as TranslationProvider[]}
              selected={settings.translationProvider}
              onSelect={(value) => onUpdate({ ...settings, translationProvider: value })}
              labelFn={(v) => v === "apple" ? "Apple" : v === "mlkit" ? "ML Kit" : "Cloud"}
              accessibilityPrefix="Translation provider"
              colors={colors}
            />
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

            {/* Translation diagnostics — circuit breakers + cache stats */}
            {(circuitSnapshots.length > 0 || (cacheStats && cacheStats.size > 0)) && (
              <View style={styles.infoSection}>
                <TouchableOpacity
                  style={styles.collapsibleHeader}
                  onPress={() => setDiagnosticsExpanded((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: diagnosticsExpanded }}
                  accessibilityLabel="Translation Diagnostics section"
                  accessibilityHint={diagnosticsExpanded ? "Double tap to collapse" : "Double tap to expand"}
                >
                  <Text style={[styles.infoTitle, dynamicStyles.infoTitle, styles.collapsibleTitle]}>
                    {diagnosticsExpanded ? "▾" : "▸"}  Translation Diagnostics
                    {!diagnosticsExpanded && circuitSnapshots.some((s) => s.open) ? "  ⚠" : ""}
                  </Text>
                </TouchableOpacity>
                {diagnosticsExpanded && cacheStats && (
                  <>
                    <Text style={[styles.infoText, dynamicStyles.infoText]}>
                      Cache: {cacheStats.size}/{cacheStats.max}
                    </Text>
                    {Object.entries(cacheStats.byProvider).map(([provider, count]) => (
                      <View key={provider} style={styles.cacheProviderRow}>
                        <Text style={[styles.infoText, dynamicStyles.infoText, styles.cacheProviderLabel]}>
                          {provider}: {count}
                        </Text>
                        <TouchableOpacity
                          style={[styles.cacheProviderClear, { backgroundColor: colors.cardBg }]}
                          onPress={() => handleClearProviderCache(provider)}
                          accessibilityRole="button"
                          accessibilityLabel={`Clear ${provider} cache entries`}
                          accessibilityHint={`Removes ${count} cached ${provider} translations`}
                        >
                          <Text style={[styles.cacheProviderClearText, { color: colors.dimText }]}>Clear</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </>
                )}
                {diagnosticsExpanded && circuitSnapshots.map((s) => (
                  <Text
                    key={s.provider}
                    style={[
                      styles.infoText,
                      dynamicStyles.infoText,
                      s.open ? { color: colors.errorText } : null,
                    ]}
                  >
                    {s.provider}: {s.open ? `open (${Math.ceil(s.msUntilReset / 1000)}s)` : "closed"} · failures {s.failures}
                  </Text>
                ))}
                {diagnosticsExpanded && (
                <View style={styles.crashActions}>
                  <TouchableOpacity
                    style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                    onPress={refreshDiagnostics}
                    accessibilityRole="button"
                    accessibilityLabel="Refresh translation diagnostics"
                  >
                    <Text style={[styles.crashActionText, { color: colors.primary }]}>Refresh</Text>
                  </TouchableOpacity>
                  {circuitSnapshots.some((s) => s.open || s.failures > 0) && (
                    <TouchableOpacity
                      style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                      onPress={handleResetCircuits}
                      accessibilityRole="button"
                      accessibilityLabel="Reset translation circuit breakers"
                    >
                      <Text style={[styles.crashActionText, { color: colors.primary }]}>Reset Circuits</Text>
                    </TouchableOpacity>
                  )}
                  {cacheStats && cacheStats.size > 0 && (
                    <TouchableOpacity
                      style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                      onPress={handleClearTranslationCache}
                      accessibilityRole="button"
                      accessibilityLabel="Clear translation cache"
                    >
                      <Text style={[styles.crashActionText, { color: colors.dimText }]}>Clear Cache</Text>
                    </TouchableOpacity>
                  )}
                </View>
                )}
              </View>
            )}

            {/* Debug / crash report section — collapsible */}
            {(lastCrash || logger.getRecentErrors().length > 0) && (
              <View style={styles.infoSection}>
                <TouchableOpacity
                  style={styles.collapsibleHeader}
                  onPress={() => setCrashSectionExpanded((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: crashSectionExpanded }}
                  accessibilityLabel="Debug section"
                  accessibilityHint={crashSectionExpanded ? "Double tap to collapse" : "Double tap to expand"}
                >
                  <Text style={[styles.infoTitle, dynamicStyles.infoTitle, styles.collapsibleTitle]}>
                    {crashSectionExpanded ? "▾" : "▸"}  Debug
                    {!crashSectionExpanded && lastCrash ? "  ⚠" : ""}
                  </Text>
                </TouchableOpacity>
                {crashSectionExpanded && lastCrash && (
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
                {crashSectionExpanded && logger.getRecentErrors().length > 0 && (
                  <Text style={[styles.infoText, dynamicStyles.infoText]}>
                    {logger.getRecentErrors().length} recent error{logger.getRecentErrors().length === 1 ? "" : "s"} logged
                  </Text>
                )}
                {crashSectionExpanded && (
                <View style={styles.crashActions}>
                  <TouchableOpacity
                    style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                    onPress={copyCrashReport}
                    accessibilityRole="button"
                    accessibilityLabel="Copy crash report to clipboard"
                  >
                    <Text style={[styles.crashActionText, { color: colors.primary }]}>
                      {crashCopied ? "Copied!" : "Copy"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                    onPress={shareCrashReport}
                    accessibilityRole="button"
                    accessibilityLabel="Share crash report via system share sheet"
                    accessibilityHint="Opens the share sheet to send the crash report to another app"
                  >
                    <Text style={[styles.crashActionText, { color: colors.primary }]}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                    onPress={clearCrashReport}
                    accessibilityRole="button"
                    accessibilityLabel="Clear crash report"
                  >
                    <Text style={[styles.crashActionText, { color: colors.dimText }]}>Clear</Text>
                  </TouchableOpacity>
                </View>
                )}
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

// Reusable option picker row — eliminates 5 repeated patterns in settings
function OptionPicker<T extends string | number>({
  options,
  selected,
  onSelect,
  labelFn,
  accessibilityPrefix,
  colors,
}: {
  options: T[];
  selected: T;
  onSelect: (value: T) => void;
  labelFn: (value: T) => string;
  accessibilityPrefix: string;
  colors: ReturnType<typeof getColors>;
}) {
  return (
    <View style={styles.fontSizeRow}>
      {options.map((option) => (
        <TouchableOpacity
          key={String(option)}
          style={[
            styles.fontSizeOption,
            { backgroundColor: colors.cardBg },
            selected === option && { backgroundColor: colors.primary },
          ]}
          onPress={() => onSelect(option)}
          accessibilityRole="button"
          accessibilityLabel={`${accessibilityPrefix}: ${labelFn(option)}`}
          accessibilityState={{ selected: selected === option }}
        >
          <Text
            style={[
              styles.fontSizeLabel,
              { color: colors.mutedText },
              selected === option && { color: colors.destructiveText },
            ]}
          >
            {labelFn(option)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
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
  collapsibleHeader: {
    paddingVertical: 4,
  },
  collapsibleTitle: {
    marginBottom: 4,
  },
  cacheProviderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  cacheProviderLabel: {
    marginBottom: 0,
    flex: 1,
  },
  cacheProviderClear: {
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginLeft: 8,
  },
  cacheProviderClearText: {
    fontSize: 12,
    fontWeight: "600",
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

export default React.memo(SettingsModal);
