import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Appearance, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getColors, type ThemeMode } from "../theme";
import { logger } from "../services/logger";

const LAST_CRASH_KEY = "@live_translator_last_crash";
// Rolling timestamps of recent crashes — when the app repeatedly crashes in a short
// window we assume stored state is corrupted and offer the user a way out instead
// of trapping them in an infinite crash loop.
const RECENT_CRASHES_KEY = "@live_translator_recent_crashes";
const CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CRASH_LOOP_THRESHOLD = 3;
// Keys we must preserve when wiping state, so a user's reset doesn't re-trigger
// onboarding or wipe their crash report before they can share it.
const PRESERVED_KEYS = new Set<string>([LAST_CRASH_KEY, RECENT_CRASHES_KEY]);

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

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  async componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("Render", "App crashed", { message: error.message, componentStack: info.componentStack });

    const now = Date.now();

    // Persist crash info for debugging across sessions
    const crashReport = {
      message: error.message,
      stack: error.stack?.slice(0, 500),
      componentStack: info.componentStack?.slice(0, 500),
      timestamp: now,
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
  };

  handleResetData = () => {
    Alert.alert(
      "Reset app data?",
      "This clears cached settings and history but preserves the crash report so you can still share it. The app will reload.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            try {
              const keys = await AsyncStorage.getAllKeys();
              const toRemove = keys.filter((k) => !PRESERVED_KEYS.has(k));
              if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
              await AsyncStorage.removeItem(RECENT_CRASHES_KEY);
              logger.clearRecentErrors();
              this.setState({ hasError: false, error: null, crashLoopDetected: false });
            } catch (err) {
              logger.error("Storage", "Failed to reset app data", err);
            }
          },
        },
      ],
    );
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
              accessibilityLabel="Reset app data to recover from repeated crashes"
              accessibilityHint="Clears cached settings and history but preserves the crash report"
            >
              <Text style={[styles.buttonText, { color: colors.errorText }]}>Reset App Data</Text>
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
    marginBottom: 24,
    lineHeight: 20,
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
