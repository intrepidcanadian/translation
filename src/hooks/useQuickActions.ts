import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as QuickActions from "expo-quick-actions";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import { useSettings } from "../contexts/SettingsContext";
import { logger } from "../services/logger";
import type { RootTabParamList } from "../navigation/types";

const QUICK_ACTION_ITEMS: QuickActions.Action[] = [
  { id: "translate_voice", title: "Voice Translate", subtitle: "Start speech translation", icon: Platform.OS === "ios" ? "symbol:mic.fill" : undefined },
  { id: "translate_paste", title: "Paste & Translate", subtitle: "Translate from clipboard", icon: Platform.OS === "ios" ? "symbol:doc.on.clipboard" : undefined },
  { id: "camera_translate", title: "Camera Translate", subtitle: "Translate text with camera", icon: Platform.OS === "ios" ? "symbol:camera.viewfinder" : undefined },
  { id: "document_scan", title: "Document Intelligence", subtitle: "Scan and analyze documents", icon: Platform.OS === "ios" ? "symbol:doc.text.magnifyingglass" : undefined },
  { id: "saved_notes", title: "Saved Notes", subtitle: "View saved scanned notes", icon: Platform.OS === "ios" ? "symbol:note.text" : undefined },
];

export function useQuickActions(navigationRef: NavigationContainerRefWithCurrent<RootTabParamList>) {
  const { settings } = useSettings();
  const quickActionRef = useRef<string | null>(null);

  useEffect(() => {
    QuickActions.setItems(QUICK_ACTION_ITEMS);

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
            logger.warn("Speech", "Quick action voice translate failed", err);
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
  }, [settings.offlineSpeech, navigationRef]);
}
