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
  /**
   * Honors iOS "Reduce Transparency" accessibility setting (Settings →
   * Accessibility → Display & Text Size → Reduce Transparency). When true,
   * GlassBackdrop and other translucent surfaces should fall back to solid
   * backgrounds for users with light-sensitivity or contrast needs.
   * Android always reports false (RN doesn't expose an equivalent).
   */
  reduceTransparency: boolean;
  showOnboarding: boolean;
  setShowOnboarding: (v: boolean) => void;
  completeOnboarding: () => void;
  maybeRequestReview: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const ratingPromptedRef = useRef(false);
  const translationCountRef = useRef(0);
  // Tracked so we can clear a pending review-prompt timer on unmount.
  const reviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  // iOS "Reduce Transparency" accessibility setting. When on, glass surfaces
  // should render with their solid fallback so the aurora doesn't reduce
  // contrast for users with light-sensitivity or low vision. The RN API is
  // iOS-only (Android resolves the promise to false and the listener never
  // fires), so this code path is a no-op on Android — which is fine since
  // there's no equivalent system setting to honor there.
  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled?.().then(setReduceTransparency).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(
      "reduceTransparencyChanged",
      setReduceTransparency,
    );
    return () => sub?.remove();
  }, []);

  // Clean up the pending review-prompt timer when the provider unmounts so
  // StoreReview.requestReview() isn't invoked after the root tree is gone.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (reviewTimerRef.current) {
        clearTimeout(reviewTimerRef.current);
        reviewTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    AsyncStorage.multiGet([SETTINGS_KEY, ONBOARDING_KEY, RATING_PROMPTED_KEY, TRANSLATION_COUNT_KEY])
      .then((results) => {
        const [settingsResult, onboardingResult, ratingResult, countResult] = results;

        if (settingsResult[1]) {
          const data = JSON.parse(settingsResult[1]) as Settings;
          const provider: string = data.translationProvider;
          if (provider === "deepl" || provider === "google") {
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
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings)).catch((err) =>
      logger.warn("Settings", "Failed to persist settings", err)
    );
  }, []);

  const completeOnboarding = useCallback(() => {
    setShowOnboarding(false);
    AsyncStorage.setItem(ONBOARDING_KEY, "true").catch((err) =>
      logger.warn("Settings", "Failed to persist onboarding flag", err)
    );
  }, []);

  const maybeRequestReview = useCallback(async () => {
    if (ratingPromptedRef.current) return;
    translationCountRef.current += 1;
    AsyncStorage.setItem(TRANSLATION_COUNT_KEY, String(translationCountRef.current)).catch((err) =>
      logger.warn("Settings", "Failed to persist translation count", err)
    );
    if (translationCountRef.current >= RATING_THRESHOLD) {
      ratingPromptedRef.current = true;
      AsyncStorage.setItem(RATING_PROMPTED_KEY, "1").catch((err) =>
        logger.warn("Settings", "Failed to persist rating flag", err)
      );
      try {
        const isAvailable = await StoreReview.isAvailableAsync();
        if (!isAvailable || !isMountedRef.current) return;
        // Clear any prior pending timer (defensive — shouldn't happen because
        // we gate on ratingPromptedRef, but cheap insurance).
        if (reviewTimerRef.current) clearTimeout(reviewTimerRef.current);
        reviewTimerRef.current = setTimeout(() => {
          reviewTimerRef.current = null;
          if (!isMountedRef.current) return;
          StoreReview.requestReview().catch((err) =>
            logger.warn("Settings", "StoreReview.requestReview failed", err)
          );
        }, 1500);
      } catch (err) {
        logger.warn("Settings", "StoreReview.isAvailableAsync failed", err);
      }
    }
  }, []);

  const value = useMemo(() => ({
    settings,
    updateSettings,
    reduceMotion,
    reduceTransparency,
    showOnboarding,
    setShowOnboarding,
    completeOnboarding,
    maybeRequestReview,
  }), [settings, updateSettings, reduceMotion, reduceTransparency, showOnboarding, completeOnboarding, maybeRequestReview]);

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}
