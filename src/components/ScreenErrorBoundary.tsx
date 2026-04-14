import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Appearance } from "react-native";
import { getColors, type ThemeMode } from "../theme";
import { logger } from "../services/logger";

/**
 * Lightweight per-screen error boundary for tab screens.
 *
 * This is deliberately *separate* from the root `ErrorBoundary` component:
 *
 * - The root boundary owns crash-loop detection, version stamping, AsyncStorage
 *   crash reports, and tiered recovery. It's the last line of defense and its
 *   render path intentionally avoids anything that could itself throw.
 * - This boundary just catches a single screen's render errors so a bug in
 *   Scan doesn't take down Translate/Notes/Settings. It logs with a scope
 *   label, shows an inline failure card, and offers a local retry.
 *
 * If this boundary itself throws while rendering the fallback, the root
 * ErrorBoundary catches it — nested boundaries are the whole point.
 */

interface Props {
  /** Human-readable screen name used in logs and the fallback UI. */
  label: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("Render", `${this.props.label} screen crashed`, {
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const systemTheme: ThemeMode =
        Appearance.getColorScheme() === "light" ? "light" : "dark";
      const colors = getColors(systemTheme);
      return (
        <View style={[styles.container, { backgroundColor: colors.bubbleBg }]}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={[styles.title, { color: colors.primaryText }]}>
            {this.props.label} failed to load
          </Text>
          <Text style={[styles.message, { color: colors.mutedText }]}>
            {this.state.error?.message || "An unexpected error occurred"}
          </Text>
          <Text style={[styles.hint, { color: colors.dimText }]}>
            Other tabs are still working.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={this.handleRetry}
            accessibilityRole="button"
            accessibilityLabel={`Retry loading the ${this.props.label} screen`}
          >
            <Text style={[styles.buttonText, { color: colors.destructiveText }]}>
              Try Again
            </Text>
          </TouchableOpacity>
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
    fontSize: 40,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
    textAlign: "center",
  },
  message: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 6,
    lineHeight: 18,
  },
  hint: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 20,
    fontStyle: "italic",
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
