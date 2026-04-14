import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Appearance, Alert, Platform, AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { getColors, type ThemeMode } from "../theme";
import { logger } from "../services/logger";
import { CRASH_REPORT_SCHEMA_VERSION, type CrashReport } from "../types/crashReport";

// Read once at module load. expo-constants surfaces the app.json version + the
// native build number (iOS CFBundleVersion / Android versionCode) which is what
// we actually need when triaging a crash report.
//
// The Constants module access is wrapped in try-catch because in certain build
// contexts (E2E stubs, SSR, first-run before native initialization) the native
// module may be missing or expoConfig may throw instead of returning undefined.
// A crash report saying "unknown" is strictly better than the crash reporter
// itself crashing during module load.
const { APP_VERSION, BUILD_NUMBER } = (() => {
  try {
    const version = Constants.expoConfig?.version ?? "unknown";
    const build =
      (Platform.OS === "ios"
        ? Constants.expoConfig?.ios?.buildNumber
        : Constants.expoConfig?.android?.versionCode?.toString()) ?? "unknown";
    return { APP_VERSION: version, BUILD_NUMBER: build };
  } catch (err) {
    logger.warn("Render", "Failed to read app version from expo-constants", err);
    return { APP_VERSION: "unknown", BUILD_NUMBER: "unknown" };
  }
})();

const LAST_CRASH_KEY = "@live_translator_last_crash";
// Rolling timestamps of recent crashes — when the app repeatedly crashes in a short
// window we assume stored state is corrupted and offer the user a way out instead
// of trapping them in an infinite crash loop.
const RECENT_CRASHES_KEY = "@live_translator_recent_crashes";
const CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CRASH_LOOP_THRESHOLD = 3;
// If the app stays in the foreground this long after mount without crashing,
// we treat the session as "healthy" and clear the recent-crashes counter. This
// prevents a stale day-old crash from counting toward today's loop detection
// and tuning the 3-in-5-minutes heuristic toward real crash clusters only.
const HEALTHY_SESSION_MS = 60 * 1000; // 1 minute
// Crash report keys must always survive any reset so the user can still share the
// diagnostic report after recovering.
const CRASH_REPORT_KEYS = new Set<string>([LAST_CRASH_KEY, RECENT_CRASHES_KEY]);
// "Safe" keys that hold the user's own content and preferences. A soft reset keeps
// these — only transient / cache keys get cleared. A full reset wipes everything
// except the crash report keys.
const USER_DATA_KEYS = new Set<string>([
  "translation_history",
  "user_glossary",
  "saved_language_pairs",
  "recent_languages",
  "usage_streak",
  "app_settings",
  "onboarding_completed",
  "rating_prompted",
  "translation_count",
]);

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  crashCount: number;
  crashLoopDetected: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, crashCount: 0, crashLoopDetected: false };

  private healthyTimer: ReturnType<typeof setTimeout> | null = null;
  private appStateSub: { remove: () => void } | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidMount() {
    // Arm the healthy-session timer on mount. If the user reaches this point
    // without an immediate crash, wait HEALTHY_SESSION_MS then flush the
    // rolling crash counter so yesterday's incident doesn't trip today's
    // loop detector.
    this.armHealthyTimer();

    // Pause/resume the timer on background transitions so real foreground
    // time is what counts — a phone that sat locked overnight shouldn't
    // auto-clear the counter.
    this.appStateSub = AppState.addEventListener("change", this.handleAppStateChange);
  }

  componentWillUnmount() {
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
    this.appStateSub?.remove();
  }

  private armHealthyTimer = () => {
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
    this.healthyTimer = setTimeout(async () => {
      try {
        await AsyncStorage.removeItem(RECENT_CRASHES_KEY);
      } catch (err) {
        logger.warn("Storage", "Failed to clear crash loop counter", err);
      }
    }, HEALTHY_SESSION_MS);
  };

  private handleAppStateChange = (next: AppStateStatus) => {
    if (next === "active") {
      this.armHealthyTimer();
    } else if (this.healthyTimer) {
      clearTimeout(this.healthyTimer);
      this.healthyTimer = null;
    }
  };

  async componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("Render", "App crashed", { message: error.message, componentStack: info.componentStack });

    // Stop the healthy-session countdown — a crash disqualifies this session.
    if (this.healthyTimer) {
      clearTimeout(this.healthyTimer);
      this.healthyTimer = null;
    }

    const now = Date.now();

    // Persist crash info for debugging across sessions. Stamping app version +
    // build number here means shared reports always reveal which build crashed,
    // without the user having to remember or look it up. schemaVersion lets
    // future format changes migrate old reports instead of dropping them.
    const crashReport: CrashReport = {
      schemaVersion: CRASH_REPORT_SCHEMA_VERSION,
      message: error.message,
      stack: error.stack?.slice(0, 500),
      componentStack: info.componentStack?.slice(0, 500),
      timestamp: now,
      appVersion: APP_VERSION,
      buildNumber: BUILD_NUMBER,
      platform: `${Platform.OS} ${Platform.Version}`,
    };
    try {
      await AsyncStorage.setItem(LAST_CRASH_KEY, JSON.stringify(crashReport));
    } catch (err) {
      logger.warn("Storage", "Failed to persist crash report", err);
    }

    // Detect crash loops: if this is the Nth crash within the window, surface
    // a reset-data option so the user isn't stuck.
    try {
      const raw = await AsyncStorage.getItem(RECENT_CRASHES_KEY);
      const prev: number[] = raw ? JSON.parse(raw) : [];
      const recent = [...prev, now].filter((t) => now - t < CRASH_LOOP_WINDOW_MS).slice(-10);
      await AsyncStorage.setItem(RECENT_CRASHES_KEY, JSON.stringify(recent));
      const crashLoopDetected = recent.length >= CRASH_LOOP_THRESHOLD;
      this.setState((s) => ({ crashCount: s.crashCount + 1, crashLoopDetected }));
    } catch (err) {
      logger.warn("Storage", "Failed to track crash loop", err);
      this.setState((s) => ({ crashCount: s.crashCount + 1 }));
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    // Give the recovered session the same healthy-runway window so if it
    // survives HEALTHY_SESSION_MS the crash counter gets flushed.
    this.armHealthyTimer();
  };

  // Tiered reset: start with a soft clear (transient/cache only) and escalate to a
  // full wipe only if the user opts in. Most crash loops come from a single
  // corrupted cache blob (e.g. a malformed offline queue), so the soft path
  // usually recovers without losing the user's history, glossary, or pairs.
  handleResetData = () => {
    Alert.alert(
      "Recover from crashes?",
      "Clear caches keeps your history, glossary, saved pairs, and settings and only drops transient data (offline queue, widget cache). If that doesn't help, choose Reset Everything.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear Caches",
          onPress: () => this.performReset("soft"),
        },
        {
          text: "Reset Everything",
          style: "destructive",
          onPress: () => this.confirmFullReset(),
        },
      ],
    );
  };

  confirmFullReset = () => {
    Alert.alert(
      "Reset everything?",
      "This wipes your history, glossary, saved pairs, streak, and settings. The crash report is preserved so you can still share it. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset Everything",
          style: "destructive",
          onPress: () => this.performReset("full"),
        },
      ],
    );
  };

  performReset = async (mode: "soft" | "full") => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const toRemove = keys.filter((k) => {
        if (CRASH_REPORT_KEYS.has(k)) return false; // always preserve crash report
        if (mode === "full") return true;
        // Soft reset: keep user data and preferences, drop everything else
        return !USER_DATA_KEYS.has(k);
      });
      if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
      // Always reset the crash loop counter so the user gets a clean runway
      await AsyncStorage.removeItem(RECENT_CRASHES_KEY);
      logger.clearRecentErrors();
      logger.warn("Storage", `App data reset (${mode})`, { cleared: toRemove.length });
      this.setState({ hasError: false, error: null, crashLoopDetected: false });
    } catch (err) {
      logger.error("Storage", "Failed to reset app data", err);
    }
  };

  render() {
    if (this.state.hasError) {
      const systemTheme: ThemeMode = Appearance.getColorScheme() === "light" ? "light" : "dark";
      const colors = getColors(systemTheme);
      const { crashLoopDetected, error } = this.state;
      return (
        <View style={[styles.container, { backgroundColor: colors.bubbleBg }]}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={[styles.title, { color: colors.primaryText }]}>Something went wrong</Text>
          <Text style={[styles.message, { color: colors.mutedText }]}>
            {error?.message || "An unexpected error occurred"}
          </Text>
          <Text style={[styles.versionTag, { color: colors.dimText }]}>
            v{APP_VERSION} ({BUILD_NUMBER}) · {Platform.OS}
          </Text>
          {crashLoopDetected && (
            <Text style={[styles.warningBanner, { color: colors.errorText }]}>
              The app has crashed several times in a row. Resetting local data may help.
            </Text>
          )}
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={this.handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry and reload the app"
          >
            <Text style={[styles.buttonText, { color: colors.destructiveText }]}>Try Again</Text>
          </TouchableOpacity>
          {crashLoopDetected && (
            <TouchableOpacity
              style={[styles.buttonSecondary, { borderColor: colors.errorBorder }]}
              onPress={this.handleResetData}
              accessibilityRole="button"
              accessibilityLabel="Recover from repeated crashes"
              accessibilityHint="Offers a soft clear of caches first, then a full reset if needed"
            >
              <Text style={[styles.buttonText, { color: colors.errorText }]}>Recover from Crashes</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
  },
  message: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 8,
    lineHeight: 20,
  },
  versionTag: {
    fontSize: 11,
    textAlign: "center",
    marginBottom: 24,
    fontVariant: ["tabular-nums"],
  },
  warningBanner: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 18,
    fontWeight: "600",
    paddingHorizontal: 12,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  buttonSecondary: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
