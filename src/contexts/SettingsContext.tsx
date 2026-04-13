import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AccessibilityInfo } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";
import { Settings, DEFAULT_SETTINGS } from "../components/SettingsModal";
import { setHapticsEnabled } from "../services/haptics";
import { logger } from "../services/logger";

const SETTINGS_KEY = "app_settings";
const ONBOARDING_KEY = "onboarding_completed";
const RATING_PROMPTED_KEY = "rating_prompted";
const TRANSLATION_COUNT_KEY = "translation_count";
const RATING_THRESHOLD = 20;

interface SettingsContextValue {
  settings: Settings;
  updateSettings: (s: Settings) => void;
  reduceMotion: boolean;
  showOnboarding: boolean;
  setShowOnboarding: (v: boolean) => void;
  completeOnboarding: () => void;
  maybeRequestReview: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const ratingPromptedRef = useRef(false);
  const translationCountRef = useRef(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    AsyncStorage.multiGet([SETTINGS_KEY, ONBOARDING_KEY, RATING_PROMPTED_KEY, TRANSLATION_COUNT_KEY])
      .then((results) => {
        const [settingsResult, onboardingResult, ratingResult, countResult] = results;

        if (settingsResult[1]) {
          const data = JSON.parse(settingsResult[1]) as Settings;
          const provider = data.translationProvider;
          if (provider === ("deepl" as any) || provider === ("google" as any)) {
            data.translationProvider = "apple";
          }
          setSettings((prev) => ({ ...prev, ...data }));
        }
        if (!onboardingResult[1]) setShowOnboarding(true);
        if (ratingResult[1]) ratingPromptedRef.current = true;
        if (countResult[1]) translationCountRef.current = parseInt(countResult[1], 10) || 0;
      })
      .catch((err) => logger.warn("Settings", "Failed to load settings data", err));
  }, []);

  // Keep haptic service in sync with settings
  useEffect(() => {
    setHapticsEnabled(settings.hapticsEnabled);
  }, [settings.hapticsEnabled]);

  const updateSettings = useCallback((newSettings: Settings) => {
    setSettings(newSettings);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
  }, []);

  const completeOnboarding = useCallback(() => {
    setShowOnboarding(false);
    AsyncStorage.setItem(ONBOARDING_KEY, "true");
  }, []);

  const maybeRequestReview = useCallback(async () => {
    if (ratingPromptedRef.current) return;
    translationCountRef.current += 1;
    AsyncStorage.setItem(TRANSLATION_COUNT_KEY, String(translationCountRef.current));
    if (translationCountRef.current >= RATING_THRESHOLD) {
      ratingPromptedRef.current = true;
      AsyncStorage.setItem(RATING_PROMPTED_KEY, "1");
      const isAvailable = await StoreReview.isAvailableAsync();
      if (isAvailable) {
        setTimeout(() => StoreReview.requestReview(), 1500);
      }
    }
  }, []);

  const value = useMemo(() => ({
    settings,
    updateSettings,
    reduceMotion,
    showOnboarding,
    setShowOnboarding,
    completeOnboarding,
    maybeRequestReview,
  }), [settings, updateSettings, reduceMotion, showOnboarding, completeOnboarding, maybeRequestReview]);

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}
