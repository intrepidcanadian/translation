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
import {
  getAll as getTelemetrySnapshot,
  reset as resetTelemetry,
  prunedUnknownKeys,
} from "../services/telemetry";
import { notifySuccess } from "../services/haptics";
import { migrateCrashReport, type CrashReport } from "../types/crashReport";
import CollapsibleSection from "./CollapsibleSection";

export type { TranslationProvider };

// Type-ahead telemetry shape — counts of where each debounced preview landed.
// Sourced from the telemetry module (src/services/telemetry.ts), which works
// in both dev and production builds. The previous implementation queried the
// logger's debug ring buffer, but that ring is `__DEV__`-only so the
// dashboard was empty in release builds (#118).
interface TypeAheadStats {
  glossary: number;
  offlineHit: number;
  offlineMiss: number;
  network: number;
  total: number;
}

interface SpeechStats {
  success: number;
  fail: number;
  /** #152: routine no-speech recognition errors — tracked separately so the
   * dashboard can distinguish "silent user" sessions from broken-mic failures
   * without polluting the translate-fail rate. */
  noSpeech: number;
  total: number;
}

function computeTypeAheadStats(): TypeAheadStats {
  const t = getTelemetrySnapshot();
  const glossary = t["typeAhead.glossary"];
  const offlineHit = t["typeAhead.offlineHit"];
  const offlineMiss = t["typeAhead.offlineMiss"];
  const network = t["typeAhead.network"];
  return { glossary, offlineHit, offlineMiss, network, total: glossary + offlineHit + offlineMiss + network };
}

function computeSpeechStats(): SpeechStats {
  const t = getTelemetrySnapshot();
  const success = t["speech.translateSuccess"];
  const fail = t["speech.translateFail"];
  const noSpeech = t["speech.noSpeech"];
  return { success, fail, noSpeech, total: success + fail };
}

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
  /** Include translation diagnostics (cache size, hit rate, open circuit
   * breakers, type-ahead counters) when sharing crash reports. Defaults on
   * because the data is innocuous, but users can opt out if they'd rather not
   * send metadata about their session alongside the crash itself (#120). */
  shareDiagnosticsInCrashReports: boolean;
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
  shareDiagnosticsInCrashReports: true,
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
  const [typeAheadStats, setTypeAheadStats] = useState<TypeAheadStats | null>(null);
  const [speechStats, setSpeechStats] = useState<SpeechStats | null>(null);
  // Rolling-window speech fail count (#141). Sourced from the logger error
  // ring via `logger.countByRolling` so it only reflects recent failures —
  // a stale breaker from hours ago stops dominating the signal. 60s window
  // is the common "is anything on fire right now" time scale; tune as we
  // get real telemetry from prod.
  const SPEECH_FAIL_WINDOW_MS = 60_000;
  const [speechFailLast60s, setSpeechFailLast60s] = useState(0);
  // Collapsible debug sub-sections. Each defaults to collapsed; we auto-expand
  // an urgent section (open breaker, last crash) the first time the modal
  // renders so the user notices what needs attention.
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [crashSectionExpanded, setCrashSectionExpanded] = useState(false);
  const toggleDiagnostics = useCallback(() => setDiagnosticsExpanded((v) => !v), []);
  const toggleCrashSection = useCallback(() => setCrashSectionExpanded((v) => !v), []);

  useEffect(() => {
    if (Platform.OS === "ios") {
      isAppleTranslationAvailable().then(setAppleAvailable);
    }
  }, []);

  // Refresh live translation diagnostics every time the modal is shown.
  // Circuit breaker state and cache stats are in-memory only, so we re-read
  // them on open rather than subscribing. Also auto-expands the diagnostics
  // section on open when any breaker is open so the user sees the issue.
  // Helper — count speech-tagged warn/error entries that landed in the last
  // SPEECH_FAIL_WINDOW_MS window. Returned as a single integer so the caller
  // can drop it straight into state. Uses `logger.countByRolling` (#125).
  const computeSpeechFailWindow = useCallback((): number => {
    const byTag = logger.countByRolling(
      { tags: ["Speech"], levels: ["warn", "error"] },
      () => "speech",
      SPEECH_FAIL_WINDOW_MS
    );
    return byTag.speech ?? 0;
  }, []);

  useEffect(() => {
    if (!visible) return;
    const snapshots = getCircuitSnapshots();
    setCircuitSnapshots(snapshots);
    setCacheStats(getTranslationCacheStats());
    setTypeAheadStats(computeTypeAheadStats());
    setSpeechStats(computeSpeechStats());
    setSpeechFailLast60s(computeSpeechFailWindow());
    if (snapshots.some((s) => s.open)) setDiagnosticsExpanded(true);
  }, [visible, computeSpeechFailWindow]);

  const refreshDiagnostics = useCallback(() => {
    setCircuitSnapshots(getCircuitSnapshots());
    setCacheStats(getTranslationCacheStats());
    setTypeAheadStats(computeTypeAheadStats());
    setSpeechStats(computeSpeechStats());
    setSpeechFailLast60s(computeSpeechFailWindow());
  }, [computeSpeechFailWindow]);

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

  // Zero the type-ahead counters without touching cache/circuits. Lets a user
  // start a fresh measurement window after changing providers or settings
  // without nuking the in-memory cache or circuit breaker state.
  const handleResetTelemetry = useCallback(() => {
    resetTelemetry();
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
    // Diagnostics block is opt-in via settings.shareDiagnosticsInCrashReports
    // (#120). Default on — innocuous metadata — but users who'd rather not
    // send telemetry alongside crash stacks can flip the toggle in Settings.
    const diagnosticsLines: string[] = [];
    if (settings.shareDiagnosticsInCrashReports) {
      // Snapshot live translation diagnostics so shared reports reveal which
      // provider was down at crash-share time. Circuit state is in-memory
      // only, so this is the only place it survives into the shared bundle.
      // Skips entirely when nothing interesting is happening to keep the
      // report clean.
      const circuits = getCircuitSnapshots();
      const cache = getTranslationCacheStats();
      const telemetry = computeTypeAheadStats();
      if (circuits.some((c) => c.open || c.failures > 0) || cache.size > 0 || telemetry.total > 0) {
        diagnosticsLines.push("\nTranslation diagnostics:");
        if (cache.size > 0) {
          diagnosticsLines.push(`  Cache: ${cache.size}/${cache.max}`);
        }
        const cacheTotal = cache.hits + cache.misses;
        if (cacheTotal > 0) {
          diagnosticsLines.push(
            `  Cache hit rate: ${Math.round((cache.hits / cacheTotal) * 100)}% (${cache.hits}/${cacheTotal})`
          );
        }
        for (const c of circuits) {
          if (c.open || c.failures > 0) {
            diagnosticsLines.push(
              `  ${c.provider}: ${c.open ? `OPEN (${Math.ceil(c.msUntilReset / 1000)}s)` : "closed"} · failures ${c.failures}`
            );
          }
        }
        if (telemetry.total > 0) {
          diagnosticsLines.push(
            `  Type-ahead: glossary=${telemetry.glossary} offHit=${telemetry.offlineHit} offMiss=${telemetry.offlineMiss} net=${telemetry.network}`
          );
        }
        // Surface telemetry prune events (#143/#147). Signals a client
        // downgrade — the persisted blob contained keys this build doesn't
        // recognize, so the hydrator dropped them. We list the actual key
        // names (#147) so the crash reader can tell "expected cleanup" from
        // "major rollback": 2 forward-compat keys is routine, 10+ is alarming.
        const prunedKeys = prunedUnknownKeys();
        if (prunedKeys.length > 0) {
          // Cap the rendered list so a pathological blob can't bloat the
          // crash report; still include the count so the reader knows the
          // full scope.
          const MAX_RENDERED = 8;
          const shown = prunedKeys.slice(0, MAX_RENDERED).join(", ");
          const suffix = prunedKeys.length > MAX_RENDERED
            ? ` (+${prunedKeys.length - MAX_RENDERED} more)`
            : "";
          diagnosticsLines.push(
            `  Telemetry: pruned ${prunedKeys.length} unknown key(s) — ${shown}${suffix}`
          );
        }
        const speech = computeSpeechStats();
        if (speech.total > 0) {
          const failPct = Math.round((speech.fail / speech.total) * 100);
          diagnosticsLines.push(
            `  Speech translate: ok=${speech.success} fail=${speech.fail} (${failPct}% fail)`
          );
        }
        // #152: routine no-speech recognition errors are counted separately
        // from translate failures so a silent-environment user and a
        // broken-mic user don't look the same in the crash report.
        if (speech.noSpeech > 0) {
          diagnosticsLines.push(`  Speech recognition: ${speech.noSpeech} no-speech event(s)`);
        }
        // Rolling 60s speech fail count (#141) via logger.countByRolling —
        // gives the person reading the report a "right now" signal that the
        // session total can't: a 500-fail session number is ambiguous without
        // knowing if it stopped an hour ago or is actively burning.
        const speechFailRolling = logger.countByRolling(
          { tags: ["Speech"], levels: ["warn", "error"] },
          () => "speech",
          60_000
        ).speech ?? 0;
        if (speechFailRolling > 0) {
          diagnosticsLines.push(
            `  Speech translate (last 60s): ${speechFailRolling} fail${speechFailRolling === 1 ? "" : "s"}`
          );
        }
        // Errors-by-tag breakdown via logger.countBy (#119). Gives the person
        // reading the report a quick "which subsystem is on fire?" view
        // without having to scan every recent-errors line individually.
        const errorsByTag = logger.countBy({ levels: ["warn", "error"] }, (e) => e.tag);
        const tagEntries = Object.entries(errorsByTag).filter(([, n]) => n > 0);
        if (tagEntries.length > 0) {
          tagEntries.sort((a, b) => b[1] - a[1]);
          diagnosticsLines.push(`  Errors by tag: ${tagEntries.map(([t, n]) => `${t}=${n}`).join(", ")}`);
        }
      }
    } else {
      diagnosticsLines.push("\n(Diagnostics redacted — user opted out)");
    }
    return [
      `Live Translator crash report`,
      versionLine,
      `Platform: ${platformLine}`,
      `Crash: ${lastCrash.message}`,
      `Time: ${new Date(lastCrash.timestamp).toLocaleString()}`,
      lastCrash.stack ? `Stack: ${lastCrash.stack}` : "",
      ...diagnosticsLines,
      recentErrors.length > 0 ? `\nRecent errors (${recentErrors.length}):` : "",
      ...recentErrors.slice(-10).map((e) => `  [${e.tag}] ${e.message}`),
    ].filter(Boolean).join("\n");
  }, [lastCrash, settings.shareDiagnosticsInCrashReports]);

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
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Diagnostics in Crash Reports</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Include cache and circuit breaker info when sharing crashes</Text>
              </View>
              <Switch
                value={settings.shareDiagnosticsInCrashReports}
                onValueChange={() => toggle("shareDiagnosticsInCrashReports")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle diagnostics in shared crash reports"
                accessibilityHint="When off, shared crash reports will not include translation diagnostics"
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
                <CollapsibleSection
                  title="Translation Diagnostics"
                  expanded={diagnosticsExpanded}
                  onToggle={toggleDiagnostics}
                  urgent={circuitSnapshots.some((s) => s.open)}
                  colors={colors}
                >
                  {cacheStats && (
                    <>
                      <Text style={[styles.infoText, dynamicStyles.infoText]}>
                        Cache: {cacheStats.size}/{cacheStats.max}
                      </Text>
                      {(cacheStats.hits + cacheStats.misses) > 0 && (
                        <Text style={[styles.infoText, dynamicStyles.infoText]}>
                          Hit rate: {Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100)}% ({cacheStats.hits}/{cacheStats.hits + cacheStats.misses})
                        </Text>
                      )}
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
                  {circuitSnapshots.map((s) => (
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
                  {/* Telemetry prune notice (#143/#147) — visible when the
                      last `initTelemetry()` dropped unknown keys from the
                      persisted blob. Typically indicates a client downgrade
                      from a newer build; surfacing it lets us catch rollouts
                      that accidentally removed a counter key. #147 lists the
                      actual key names so the user can tell routine cleanup
                      from a major rollback. */}
                  {(() => {
                    const pruned = prunedUnknownKeys();
                    if (pruned.length === 0) return null;
                    const MAX_RENDERED = 3;
                    const shown = pruned.slice(0, MAX_RENDERED).join(", ");
                    const suffix = pruned.length > MAX_RENDERED
                      ? ` +${pruned.length - MAX_RENDERED} more`
                      : "";
                    const label = `Telemetry pruned ${pruned.length} unknown key${pruned.length === 1 ? "" : "s"} — client may have been downgraded`;
                    return (
                      <Text
                        style={[
                          styles.infoText,
                          dynamicStyles.infoText,
                          { color: colors.dimText, marginTop: 4 },
                        ]}
                        accessibilityLabel={label}
                      >
                        {`⚠ Telemetry pruned ${pruned.length}: ${shown}${suffix}`}
                      </Text>
                    );
                  })()}
                  {/* Type-ahead telemetry — glossary/offline/network hit breakdown so
                      we can measure how often the offline short-circuit saves API
                      quota vs. hitting the network. Session-scoped (cleared when the
                      process dies). Sourced from the prod-safe telemetry module so
                      the numbers are meaningful in release builds too (#118). */}
                  {typeAheadStats && (
                    <View style={styles.telemetryBlock}>
                      <Text style={[styles.infoText, dynamicStyles.infoText, styles.telemetryTitle]}>
                        Type-ahead (session):
                      </Text>
                      <Text style={[styles.infoText, dynamicStyles.infoText]}>
                        Glossary: {typeAheadStats.glossary} · Offline hit: {typeAheadStats.offlineHit} · Offline miss: {typeAheadStats.offlineMiss} · Network: {typeAheadStats.network}
                      </Text>
                      {typeAheadStats.total > 0 && (
                        <Text style={[styles.infoText, dynamicStyles.infoText]}>
                          Local short-circuit: {Math.round(((typeAheadStats.glossary + typeAheadStats.offlineHit) / typeAheadStats.total) * 100)}% of {typeAheadStats.total}
                        </Text>
                      )}
                    </View>
                  )}
                  {/* Speech translation reliability — counts DualStream speech
                      translate successes/failures so systematically-failing mic
                      paths are visible in diagnostics + crash reports even
                      though speech errors are silent to the user (#132). */}
                  {speechStats && (speechStats.total > 0 || speechStats.noSpeech > 0) && (
                    <View style={styles.telemetryBlock}>
                      <Text style={[styles.infoText, dynamicStyles.infoText, styles.telemetryTitle]}>
                        Speech translate (session):
                      </Text>
                      {speechStats.total > 0 && (
                        <Text
                          style={[
                            styles.infoText,
                            dynamicStyles.infoText,
                            speechStats.fail > 0 && speechStats.fail / speechStats.total >= 0.25
                              ? { color: colors.errorText }
                              : null,
                          ]}
                        >
                          OK: {speechStats.success} · Fail: {speechStats.fail} ({Math.round((speechStats.fail / speechStats.total) * 100)}% fail of {speechStats.total})
                        </Text>
                      )}
                      {/* #152: `no-speech` is a recognition-level event
                          (silent mic, quiet environment), not a translate
                          failure. Surfaced as a separate line so a user who
                          speaks fluently but never gets recognized doesn't
                          hide behind an otherwise-healthy translate rate. */}
                      {speechStats.noSpeech > 0 && (
                        <Text
                          style={[styles.infoText, dynamicStyles.infoText]}
                          accessibilityLabel={`${speechStats.noSpeech} no-speech events this session`}
                        >
                          No-speech events: {speechStats.noSpeech}
                        </Text>
                      )}
                      {/* Rolling 60s fail count (#141) — answers "is it on
                          fire right now" without having to squint at the
                          session total. Session counter keeps growing even
                          after the outage clears, so a 60s rolling window is
                          the honest "current health" signal. */}
                      {speechFailLast60s > 0 && (
                        <Text
                          style={[
                            styles.infoText,
                            dynamicStyles.infoText,
                            { color: colors.errorText },
                          ]}
                          accessibilityLabel={`${speechFailLast60s} speech translation failures in the last 60 seconds`}
                        >
                          Last 60s: {speechFailLast60s} fail{speechFailLast60s === 1 ? "" : "s"}
                        </Text>
                      )}
                    </View>
                  )}
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
                    {typeAheadStats && typeAheadStats.total > 0 && (
                      <TouchableOpacity
                        style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                        onPress={handleResetTelemetry}
                        accessibilityRole="button"
                        accessibilityLabel="Reset type-ahead telemetry counters"
                        accessibilityHint="Zeroes session counters without clearing cache or circuits"
                      >
                        <Text style={[styles.crashActionText, { color: colors.dimText }]}>Reset Telemetry</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </CollapsibleSection>
              </View>
            )}

            {/* Debug / crash report section — collapsible */}
            {(lastCrash || logger.getRecentErrors().length > 0) && (
              <View style={styles.infoSection}>
                <CollapsibleSection
                  title="Debug"
                  expanded={crashSectionExpanded}
                  onToggle={toggleCrashSection}
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
                  {logger.getRecentErrors().length > 0 && (
                    <Text style={[styles.infoText, dynamicStyles.infoText]}>
                      {logger.getRecentErrors().length} recent error{logger.getRecentErrors().length === 1 ? "" : "s"} logged
                    </Text>
                  )}
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
                </CollapsibleSection>
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
  telemetryBlock: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(127,127,127,0.3)",
  },
  telemetryTitle: {
    fontWeight: "600",
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
