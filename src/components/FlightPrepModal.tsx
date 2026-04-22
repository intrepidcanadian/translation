import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  Animated,
  AccessibilityInfo,
} from "react-native";
import { type ThemeColors, getColors } from "../theme";
import { type LanguageStatus } from "../../modules/apple-translation";
import { notifySuccess } from "../services/haptics";
import { logger } from "../services/logger";
import { modalStyles } from "../styles/modalStyles";

// Route presets for common airline routes
const ROUTE_PRESETS = [
  {
    id: "hk_china",
    label: "HK / China",
    icon: "🇭🇰",
    description: "Hong Kong, Mainland China routes",
    languages: ["zh-Hans", "zh-Hant", "en"],
  },
  {
    id: "taiwan",
    label: "Taiwan",
    icon: "🇹🇼",
    description: "Taiwan routes",
    languages: ["zh-Hant", "zh-Hans", "en"],
  },
  {
    id: "japan_korea",
    label: "Japan / Korea",
    icon: "🇯🇵",
    description: "Northeast Asia routes",
    languages: ["ja", "ko", "zh-Hans", "en"],
  },
  {
    id: "southeast_asia",
    label: "SE Asia",
    icon: "🌏",
    description: "Thailand, Vietnam routes",
    languages: ["th", "vi", "zh-Hans", "en"],
  },
  {
    id: "europe",
    label: "Europe",
    icon: "🇪🇺",
    description: "European routes",
    languages: ["fr", "de", "es", "it", "en"],
  },
  {
    id: "south_asia",
    label: "South Asia",
    icon: "🇮🇳",
    description: "India, Middle East routes",
    languages: ["hi", "ar", "en"],
  },
  {
    id: "all_key",
    label: "All Key Languages",
    icon: "🌍",
    description: "All priority markets",
    languages: ["zh-Hans", "zh-Hant", "ja", "ko", "en", "th", "vi", "hi", "ar", "fr", "de", "es"],
  },
] as const;

// All downloadable language packs with approximate sizes (MB)
// Sizes are approximate — Apple doesn't expose exact values via API.
// These are based on observed download sizes for iOS Translation language pairs.
// Android ML Kit models are ~30MB each.
const APPLE_PACK_SIZE_MB: Record<string, number> = {
  "en": 0,       // Base language, typically already installed
  "zh-Hans": 52,
  "zh-Hant": 48,
  "ja": 55,
  "ko": 45,
  "th": 38,
  "vi": 35,
  "hi": 40,
  "ar": 42,
  "fr": 43,
  "de": 44,
  "es": 42,
  "it": 41,
  "pt": 40,
  "ru": 46,
  "nl": 38,
  "sv": 36,
  "pl": 39,
  "tr": 37,
  "uk": 41,
  "cs": 38,
};

const MLKIT_PACK_SIZE_MB = 30; // ML Kit models are ~30MB each

function getPackSizeMB(code: string): number {
  if (Platform.OS === "ios") {
    return APPLE_PACK_SIZE_MB[code] ?? 40;
  }
  return MLKIT_PACK_SIZE_MB;
}

const ALL_LANGUAGES: { code: string; name: string; flag: string }[] = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "zh-Hans", name: "Chinese (Simplified)", flag: "🇨🇳" },
  { code: "zh-Hant", name: "Chinese (Traditional)", flag: "🇭🇰" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "th", name: "Thai", flag: "🇹🇭" },
  { code: "vi", name: "Vietnamese", flag: "🇻🇳" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", flag: "🇧🇷" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "nl", name: "Dutch", flag: "🇳🇱" },
  { code: "sv", name: "Swedish", flag: "🇸🇪" },
  { code: "pl", name: "Polish", flag: "🇵🇱" },
  { code: "tr", name: "Turkish", flag: "🇹🇷" },
  { code: "uk", name: "Ukrainian", flag: "🇺🇦" },
  { code: "cs", name: "Czech", flag: "🇨🇿" },
];

type DownloadStatus = "checking" | "installed" | "downloading" | "supported" | "unsupported" | "error";

interface LanguagePackState {
  code: string;
  name: string;
  flag: string;
  status: DownloadStatus;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
  crewBaseLang?: string; // The crew member's primary language, defaults to "en"
}

type ModuleAvailability = "ok" | "unsupported" | "batch_failed";

function FlightPrepModal({ visible, onClose, colors, crewBaseLang = "en" }: Props) {
  const [languagePacks, setLanguagePacks] = useState<LanguagePackState[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [showAllLanguages, setShowAllLanguages] = useState(false);
  const [moduleAvailability, setModuleAvailability] = useState<ModuleAvailability>("ok");
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // Tracks the last VoiceOver announcement payload so opening the modal
  // repeatedly with the same moduleAvailability state doesn't fire duplicate
  // announcements (#142). Reset to null when the modal closes so the next
  // open is free to re-announce. Keyed on a `${visible}|${moduleAvailability}`
  // composite string so an availability flip while the modal is still open
  // still triggers a fresh announcement.
  const lastAnnouncedRef = useRef<string | null>(null);

  // Filter languages: don't show the crew's own language as a download target
  const displayLanguages = useMemo(() => {
    if (selectedRoute && !showAllLanguages) {
      const preset = ROUTE_PRESETS.find((r) => r.id === selectedRoute);
      if (preset) {
        return languagePacks.filter((lp) => (preset.languages as readonly string[]).includes(lp.code) && lp.code !== crewBaseLang);
      }
    }
    return languagePacks.filter((lp) => lp.code !== crewBaseLang);
  }, [languagePacks, selectedRoute, showAllLanguages, crewBaseLang]);

  const installedCount = displayLanguages.filter((lp) => lp.status === "installed").length;
  const totalCount = displayLanguages.length;
  const allInstalled = installedCount === totalCount && totalCount > 0;
  const downloadable = displayLanguages.filter((lp) => lp.status === "supported");
  const downloadableCount = downloadable.length;
  const totalDownloadMB = downloadable.reduce((sum, lp) => sum + getPackSizeMB(lp.code), 0);

  const formatSize = (mb: number): string => {
    if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
    return `${mb} MB`;
  };

  // Announce the Apple Translation unavailable banner when VoiceOver users
  // open the modal to a non-ok module state. `accessibilityLiveRegion` alone
  // is unreliable on iOS for content that is already rendered on mount, so we
  // fire an explicit announcement once the banner transitions into view. (#136)
  //
  // Dedup via `lastAnnouncedRef` (#142): a user flicking the modal open/close
  // while network-checking language packs would otherwise repeatedly fire the
  // same announcement at VoiceOver, drowning out other UI feedback. Keyed on
  // `${visible}|${moduleAvailability}` so a state transition while the modal
  // stays open (e.g. retry recovers) still yields a fresh announcement.
  useEffect(() => {
    if (!visible) {
      // Reset so the next open is free to announce again.
      lastAnnouncedRef.current = null;
      return;
    }
    if (Platform.OS !== "ios") return;
    if (moduleAvailability === "ok") return;
    const key = `${visible}|${moduleAvailability}`;
    if (lastAnnouncedRef.current === key) return;
    lastAnnouncedRef.current = key;
    const message =
      moduleAvailability === "unsupported"
        ? "Apple Translation unavailable. Your iOS version does not support on-device Translation. Cloud translation will be used instead."
        : "Apple Translation unavailable. The on-device Translation framework is not responding. Cloud translation will be used as a fallback.";
    AccessibilityInfo.announceForAccessibility(message);
  }, [visible, moduleAvailability]);

  // Pulse animation for downloading indicator
  useEffect(() => {
    if (isDownloadingAll) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isDownloadingAll, pulseAnim]);

  // Check status of all language packs when modal opens
  useEffect(() => {
    if (!visible) return;

    const checkAllStatus = async () => {
      // Initialize all as "checking"
      const initial: LanguagePackState[] = ALL_LANGUAGES.map((l) => ({
        ...l,
        status: "checking" as DownloadStatus,
      }));
      setLanguagePacks(initial);
      setModuleAvailability("ok");

      if (Platform.OS !== "ios") {
        // Android: ML Kit models — mark all as "supported" (downloadable)
        setLanguagePacks(
          ALL_LANGUAGES.map((l) => ({ ...l, status: "supported" as DownloadStatus }))
        );
        return;
      }

      try {
        const AppleTranslation = await import("../../modules/apple-translation");
        const available = await AppleTranslation.isAvailable();
        if (!available) {
          setModuleAvailability("unsupported");
          setLanguagePacks(
            ALL_LANGUAGES.map((l) => ({ ...l, status: "unsupported" as DownloadStatus }))
          );
          return;
        }

        const codes = ALL_LANGUAGES.filter((l) => l.code !== crewBaseLang).map((l) => l.code);
        const statuses = await AppleTranslation.checkLanguageStatusBatch(crewBaseLang, codes);

        setLanguagePacks(
          ALL_LANGUAGES.map((l) => ({
            ...l,
            status: l.code === crewBaseLang
              ? ("installed" as DownloadStatus)
              : ((statuses[l.code] ?? "unsupported") as DownloadStatus),
          }))
        );
      } catch (err) {
        logger.warn("Translation", "Apple language status batch check failed", err);
        setModuleAvailability("batch_failed");
        setLanguagePacks(
          ALL_LANGUAGES.map((l) => ({ ...l, status: "error" as DownloadStatus }))
        );
      }
    };

    checkAllStatus();
  }, [visible, crewBaseLang]);

  const downloadSingleLanguage = useCallback(
    async (code: string) => {
      setLanguagePacks((prev) =>
        prev.map((lp) => (lp.code === code ? { ...lp, status: "downloading" } : lp))
      );

      try {
        if (Platform.OS === "ios") {
          const AppleTranslation = await import("../../modules/apple-translation");
          await AppleTranslation.downloadLanguage(code);

          // Re-check status after download attempt
          const status = await AppleTranslation.checkLanguageStatus(crewBaseLang, code);
          setLanguagePacks((prev) =>
            prev.map((lp) => (lp.code === code ? { ...lp, status: status as DownloadStatus } : lp))
          );

          if (status === "installed") {
            notifySuccess();
          }
        }
      } catch (err) {
        logger.warn("Translation", `Apple language pack download failed: ${code}`, err);
        setLanguagePacks((prev) =>
          prev.map((lp) => (lp.code === code ? { ...lp, status: "error" } : lp))
        );
      }
    },
    [crewBaseLang]
  );

  const downloadAllMissing = useCallback(async () => {
    setIsDownloadingAll(true);
    const toDownload = displayLanguages.filter((lp) => lp.status === "supported");

    for (const lp of toDownload) {
      await downloadSingleLanguage(lp.code);
      // Small delay between downloads to avoid overwhelming the system
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    setIsDownloadingAll(false);
    notifySuccess();
  }, [displayLanguages, downloadSingleLanguage]);

  const getStatusIcon = (status: DownloadStatus): string => {
    switch (status) {
      case "installed":
        return "checkmark";
      case "downloading":
      case "checking":
        return "loading";
      case "supported":
        return "download";
      case "error":
        return "error";
      case "unsupported":
        return "unavailable";
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[modalStyles.overlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[styles.content, { backgroundColor: colors.modalBg }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.titleText }]}>Flight Prep</Text>
            <Text style={[styles.subtitle, { color: colors.dimText }]}>
              Download language packs for offline translation at altitude
            </Text>
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {/* Apple Translation unavailable banner */}
            {Platform.OS === "ios" && moduleAvailability !== "ok" && (
              <View
                style={[
                  styles.unavailableBanner,
                  { backgroundColor: colors.cardBg, borderColor: colors.errorText },
                ]}
                accessibilityRole="alert"
                accessibilityLabel="Apple Translation unavailable"
                accessibilityLiveRegion="polite"
              >
                <Text style={styles.unavailableIcon}>⚠️</Text>
                <View style={styles.unavailableTextCol}>
                  <Text style={[styles.unavailableTitle, { color: colors.primaryText }]}>
                    Apple Translation unavailable
                  </Text>
                  <Text style={[styles.unavailableHint, { color: colors.dimText }]}>
                    {moduleAvailability === "unsupported"
                      ? "Your iOS version doesn't support on-device Translation (iOS 17.4+ required). Cloud translation will be used instead."
                      : "The on-device Translation framework isn't responding. Retrying individual languages is unlikely to help — cloud translation will be used as a fallback."}
                  </Text>
                </View>
              </View>
            )}

            {/* Status Summary */}
            <View style={[styles.statusCard, { backgroundColor: allInstalled ? colors.successBg : colors.cardBg, borderColor: allInstalled ? colors.successText : colors.border }]}>
              <Text style={styles.statusIcon}>{allInstalled ? "✅" : "✈️"}</Text>
              <View style={styles.statusTextCol}>
                <Text style={[styles.statusTitle, { color: allInstalled ? colors.successText : colors.primaryText }]}>
                  {allInstalled
                    ? "Ready for offline!"
                    : `${installedCount} of ${totalCount} languages ready`}
                </Text>
                <Text style={[styles.statusHint, { color: colors.dimText }]}>
                  {allInstalled
                    ? "All selected language packs are installed on this device"
                    : `${downloadableCount} language${downloadableCount === 1 ? "" : "s"} to download (${formatSize(totalDownloadMB)})`}
                </Text>
              </View>
            </View>

            {/* Route Presets */}
            <Text style={[styles.sectionLabel, { color: colors.mutedText }]}>SELECT ROUTE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.routeScroll} contentContainerStyle={styles.routeScrollContent} accessibilityRole="tablist">
              {ROUTE_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={preset.id}
                  style={[
                    styles.routeChip,
                    { backgroundColor: colors.cardBg, borderColor: colors.border },
                    selectedRoute === preset.id && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                  onPress={() => {
                    setSelectedRoute(selectedRoute === preset.id ? null : preset.id);
                    setShowAllLanguages(false);
                  }}
                  accessibilityRole="tab"
                  accessibilityLabel={preset.label}
                  accessibilityHint={selectedRoute === preset.id ? "Tap to deselect this route" : "Selects this route and filters languages"}
                  accessibilityState={{ selected: selectedRoute === preset.id }}
                >
                  <Text style={styles.routeIcon}>{preset.icon}</Text>
                  <Text
                    style={[
                      styles.routeLabel,
                      { color: colors.primaryText },
                      selectedRoute === preset.id && { color: colors.destructiveText },
                    ]}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {selectedRoute && (
              <Text style={[styles.routeDescription, { color: colors.dimText }]}>
                {ROUTE_PRESETS.find((r) => r.id === selectedRoute)?.description}
              </Text>
            )}

            {/* Download All Button */}
            {downloadableCount > 0 && (
              <TouchableOpacity
                style={[styles.downloadAllButton, { backgroundColor: colors.primary }]}
                onPress={downloadAllMissing}
                disabled={isDownloadingAll}
                accessibilityRole="button"
                accessibilityLabel={isDownloadingAll ? "Downloading language packs" : `Download ${downloadableCount} language packs`}
                accessibilityHint={isDownloadingAll ? "Download in progress, please wait" : `Downloads all ${downloadableCount} available language packs for offline use`}
                accessibilityState={{ disabled: isDownloadingAll }}
              >
                {isDownloadingAll ? (
                  <Animated.View style={[styles.downloadAllAnimRow, { opacity: pulseAnim }]}>
                    <ActivityIndicator size="small" color={colors.destructiveText} />
                    <Text style={[styles.downloadAllText, { color: colors.destructiveText }]}>
                      Downloading...
                    </Text>
                  </Animated.View>
                ) : (
                  <View style={styles.downloadCenter}>
                    <Text style={[styles.downloadAllText, { color: colors.destructiveText }]}>
                      Download {downloadableCount} Language{downloadableCount === 1 ? "" : "s"}
                    </Text>
                    <Text style={[styles.downloadAllSize, { color: colors.destructiveText }]}>
                      {formatSize(totalDownloadMB)} total
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            {/* Language Pack List */}
            <View style={styles.languageListHeader}>
              <Text style={[styles.sectionLabel, { color: colors.mutedText }]}>
                LANGUAGE PACKS
              </Text>
              {selectedRoute && (
                <TouchableOpacity
                  onPress={() => setShowAllLanguages(!showAllLanguages)}
                  accessibilityRole="button"
                  accessibilityLabel={showAllLanguages ? "Show route languages only" : "Show all languages"}
                  accessibilityHint={showAllLanguages ? "Filters to only languages on your route" : "Shows all available language packs"}
                >
                  <Text style={[styles.showAllText, { color: colors.primary }]}>
                    {showAllLanguages ? "Show route only" : "Show all"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {displayLanguages.map((lp) => (
              <View
                key={lp.code}
                style={[styles.langRow, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
                accessibilityRole="summary"
                accessibilityLabel={`${lp.name}, ${lp.status === "installed" ? "ready for offline use" : lp.status === "supported" ? "available for download" : lp.status === "downloading" ? "downloading" : lp.status === "checking" ? "checking status" : lp.status === "error" ? "download failed" : "not available on this device"}`}
              >
                <Text style={styles.langFlag} importantForAccessibility="no">{lp.flag}</Text>
                <View style={styles.langTextCol}>
                  <Text style={[styles.langName, { color: colors.primaryText }]}>{lp.name}</Text>
                  <Text style={[styles.langCode, { color: colors.dimText }]}>
                    {lp.code} {lp.status === "supported" ? `· ~${getPackSizeMB(lp.code)} MB` : lp.status === "installed" ? "· installed" : ""}
                  </Text>
                </View>

                {/* Status / Action */}
                {lp.status === "installed" && (
                  <View
                    style={[styles.statusBadge, { backgroundColor: colors.successBg }]}
                    accessibilityRole="text"
                    accessibilityLabel={`${lp.name} is installed and ready`}
                  >
                    <Text style={[styles.statusBadgeText, { color: colors.successText }]}>Ready</Text>
                  </View>
                )}

                {lp.status === "checking" && (
                  <ActivityIndicator
                    size="small"
                    color={colors.dimText}
                    accessibilityLabel={`Checking ${lp.name} status`}
                  />
                )}

                {lp.status === "downloading" && (
                  <View
                    style={styles.downloadingRow}
                    accessibilityRole="progressbar"
                    accessibilityLabel={`Downloading ${lp.name}`}
                  >
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.downloadingText, { color: colors.primary }]}>...</Text>
                  </View>
                )}

                {lp.status === "supported" && (
                  <TouchableOpacity
                    style={[styles.downloadButton, { backgroundColor: colors.primary }]}
                    onPress={() => downloadSingleLanguage(lp.code)}
                    accessibilityRole="button"
                    accessibilityLabel={`Download ${lp.name}`}
                    accessibilityHint={`Downloads the ${lp.name} language pack for offline translation`}
                  >
                    <Text style={[styles.downloadButtonText, { color: colors.destructiveText }]}>
                      Download
                    </Text>
                  </TouchableOpacity>
                )}

                {lp.status === "error" && (
                  <TouchableOpacity
                    onPress={() => downloadSingleLanguage(lp.code)}
                    accessibilityRole="button"
                    accessibilityLabel={`Retry downloading ${lp.name}`}
                    accessibilityHint="Previous download failed, tap to try again"
                  >
                    <Text style={[styles.errorText, { color: colors.errorText }]}>Retry</Text>
                  </TouchableOpacity>
                )}

                {lp.status === "unsupported" && (
                  <Text
                    style={[styles.unsupportedText, { color: colors.dimText }]}
                    accessibilityRole="text"
                    accessibilityLabel={`${lp.name} is not available on this device`}
                  >
                    N/A
                  </Text>
                )}
              </View>
            ))}

            {/* Info Footer */}
            <View style={styles.infoFooter}>
              <Text style={[styles.infoText, { color: colors.dimText }]}>
                {Platform.OS === "ios"
                  ? "Language packs are managed by iOS and shared across apps. Each pack is ~40-50MB. Download on WiFi before your flight."
                  : "ML Kit language models (~30MB each) will be downloaded. Ensure you're connected to WiFi."}
              </Text>
              <Text style={[styles.infoText, { color: colors.dimText, marginTop: 8 }]}>
                Tip: Run Flight Prep before the cabin door closes to ensure all translations work at cruise altitude.
              </Text>
            </View>
          </ScrollView>

          {/* Close Button */}
          <TouchableOpacity
            style={[styles.closeButton, { borderTopColor: colors.borderLight }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close flight prep"
            accessibilityHint="Returns to the settings screen"
          >
            <Text style={[styles.closeText, { color: colors.primary }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    paddingTop: 20,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 20,
  },
  list: {
    paddingHorizontal: 20,
  },

  // Unavailable banner
  unavailableBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    marginBottom: 16,
  },
  unavailableIcon: {
    fontSize: 22,
    marginTop: 2,
  },
  unavailableTextCol: {
    flex: 1,
  },
  unavailableTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  unavailableHint: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },

  // Status card
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    marginBottom: 20,
  },
  statusIcon: {
    fontSize: 28,
  },
  statusTextCol: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  statusHint: {
    fontSize: 13,
    marginTop: 2,
  },

  // Route presets
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  routeScroll: {
    marginBottom: 12,
  },
  routeScrollContent: {
    gap: 8,
    paddingRight: 20,
  },
  routeChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  routeIcon: {
    fontSize: 18,
  },
  routeLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  routeDescription: {
    fontSize: 13,
    marginBottom: 12,
  },

  // Download all button
  downloadAllButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  downloadAllText: {
    fontSize: 16,
    fontWeight: "700",
  },
  downloadAllSize: {
    fontSize: 12,
    fontWeight: "500",
    opacity: 0.8,
    marginTop: 2,
  },

  // Language list
  languageListHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  showAllText: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 10,
  },
  langRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    gap: 12,
  },
  langFlag: {
    fontSize: 24,
  },
  langTextCol: {
    flex: 1,
  },
  langName: {
    fontSize: 15,
    fontWeight: "600",
  },
  langCode: {
    fontSize: 12,
    marginTop: 1,
  },

  // Status badges
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: "600",
  },
  downloadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  downloadingText: {
    fontSize: 13,
    fontWeight: "500",
  },
  downloadButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  downloadButtonText: {
    fontSize: 13,
    fontWeight: "700",
  },
  errorText: {
    fontSize: 13,
    fontWeight: "600",
  },
  unsupportedText: {
    fontSize: 13,
  },

  // Info footer
  infoFooter: {
    paddingTop: 16,
    paddingBottom: 24,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 18,
  },

  // Close button
  closeButton: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
  },
  closeText: {
    fontSize: 17,
    fontWeight: "600",
  },

  // Download all animated row
  downloadAllAnimRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  downloadCenter: {
    alignItems: "center" as const,
  },
});

export default React.memo(FlightPrepModal);
