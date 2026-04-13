import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import * as QuickActions from "expo-quick-actions";
import {
  ExpoSpeechRecognitionModule,
} from "expo-speech-recognition";
import * as Clipboard from "expo-clipboard";

import ErrorBoundary from "./src/components/ErrorBoundary";
import { SettingsProvider, useSettings } from "./src/contexts/SettingsContext";
import { LanguageProvider } from "./src/contexts/LanguageContext";
import { GlossaryProvider } from "./src/contexts/GlossaryContext";
import { TranslationDataProvider } from "./src/contexts/TranslationDataContext";
import { StreakProvider } from "./src/contexts/StreakContext";
import { OfflineQueueProvider } from "./src/contexts/OfflineQueueContext";
import RootNavigator from "./src/navigation/RootNavigator";
import { linking } from "./src/navigation/linking";
import type { RootTabParamList } from "./src/navigation/types";

const navigationRef = createNavigationContainerRef<RootTabParamList>();

export default function App() {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <LanguageProvider>
          <GlossaryProvider>
            <StreakProvider>
              <OfflineQueueProvider>
                <TranslationDataProvider>
                  <NavigationContainer ref={navigationRef} linking={linking}>
                    <QuickActionHandler />
                    <RootNavigator />
                  </NavigationContainer>
                </TranslationDataProvider>
              </OfflineQueueProvider>
            </StreakProvider>
          </GlossaryProvider>
        </LanguageProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}

function QuickActionHandler() {
  const { settings } = useSettings();
  const quickActionRef = useRef<string | null>(null);

  useEffect(() => {
    QuickActions.setItems([
      { id: "translate_voice", title: "Voice Translate", subtitle: "Start speech translation", icon: Platform.OS === "ios" ? "symbol:mic.fill" : undefined },
      { id: "translate_paste", title: "Paste & Translate", subtitle: "Translate from clipboard", icon: Platform.OS === "ios" ? "symbol:doc.on.clipboard" : undefined },
      { id: "camera_translate", title: "Camera Translate", subtitle: "Translate text with camera", icon: Platform.OS === "ios" ? "symbol:camera.viewfinder" : undefined },
      { id: "document_scan", title: "Document Intelligence", subtitle: "Scan and analyze documents", icon: Platform.OS === "ios" ? "symbol:doc.text.magnifyingglass" : undefined },
      { id: "saved_notes", title: "Saved Notes", subtitle: "View saved scanned notes", icon: Platform.OS === "ios" ? "symbol:note.text" : undefined },
    ]);

    const sub = QuickActions.addListener((action) => {
      quickActionRef.current = action.id;
    });
    if (QuickActions.initial) {
      quickActionRef.current = QuickActions.initial.id;
    }
    return () => { sub?.remove?.(); };
  }, []);

  useEffect(() => {
    if (!quickActionRef.current) return;
    const actionId = quickActionRef.current;
    quickActionRef.current = null;

    const timer = setTimeout(async () => {
      if (!navigationRef.isReady()) return;
      switch (actionId) {
        case "translate_voice":
          navigationRef.navigate("Translate");
          try {
            const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
            if (result.granted) {
              ExpoSpeechRecognitionModule.start({ lang: "en-US", interimResults: true, continuous: true, requiresOnDeviceRecognition: settings.offlineSpeech });
            }
          } catch (err) {
            console.warn("Quick action voice translate failed:", err);
          }
          break;
        case "translate_paste":
          navigationRef.navigate("Translate");
          break;
        case "camera_translate":
          navigationRef.navigate("Scan", { mode: "live" });
          break;
        case "document_scan":
          navigationRef.navigate("Scan", { mode: "document" });
          break;
        case "saved_notes":
          navigationRef.navigate("Notes");
          break;
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [settings.offlineSpeech]);

  return null;
}
