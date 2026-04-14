import React, { useEffect } from "react";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";

import ErrorBoundary from "./src/components/ErrorBoundary";
import { initTelemetry } from "./src/services/telemetry";
import { SettingsProvider } from "./src/contexts/SettingsContext";
import { LanguageProvider } from "./src/contexts/LanguageContext";
import { GlossaryProvider } from "./src/contexts/GlossaryContext";
import { TranslationDataProvider } from "./src/contexts/TranslationDataContext";
import { StreakProvider } from "./src/contexts/StreakContext";
import { OfflineQueueProvider } from "./src/contexts/OfflineQueueContext";
import { ThemeBridge } from "./src/contexts/ThemeContext";
import { ComposeProviders } from "./src/utils/ComposeProviders";
import RootNavigator from "./src/navigation/RootNavigator";
import { linking } from "./src/navigation/linking";
import { useQuickActions } from "./src/hooks/useQuickActions";
import type { RootTabParamList } from "./src/navigation/types";

const navigationRef = createNavigationContainerRef<RootTabParamList>();

const APP_PROVIDERS = [
  SettingsProvider,
  ThemeBridge,
  LanguageProvider,
  GlossaryProvider,
  StreakProvider,
  OfflineQueueProvider,
  TranslationDataProvider,
];

const QuickActionHandler = React.memo(function QuickActionHandler() {
  useQuickActions(navigationRef);
  return null;
});

export default function App() {
  // Hydrate persisted telemetry counters from AsyncStorage so diagnostics and
  // crash reports retain their pre-crash baseline across restarts (#122).
  // Fire-and-forget — telemetry.increment no-ops until hydration finishes and
  // the debounced writer takes over, so we don't block the first render.
  useEffect(() => {
    void initTelemetry();
  }, []);

  return (
    <ErrorBoundary>
      <ComposeProviders providers={APP_PROVIDERS}>
        <NavigationContainer ref={navigationRef} linking={linking}>
          <QuickActionHandler />
          <RootNavigator />
        </NavigationContainer>
      </ComposeProviders>
    </ErrorBoundary>
  );
}
