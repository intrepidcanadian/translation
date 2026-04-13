import React from "react";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";

import ErrorBoundary from "./src/components/ErrorBoundary";
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

export default function App() {
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

function QuickActionHandler() {
  useQuickActions(navigationRef);
  return null;
}
