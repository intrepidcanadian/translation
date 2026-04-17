import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { impactLight } from "../services/haptics";
import {
  PHRASE_CATEGORIES,
  getPhrasesForCategory,
  type PhraseCategory,
  type OfflinePhrase,
  type PhraseLangCode,
} from "../services/offlinePhrases";
import { getLocationContext, getNearbyPhrases, type LocationContext } from "../services/locationPhrases";
import { logger } from "../services/logger";
import { glassSurface, type ThemeColors } from "../theme";
import GlassBackdrop from "./GlassBackdrop";

interface PhrasebookModalProps {
  visible: boolean;
  onClose: () => void;
  sourceLangCode: string;
  targetLangCode: string;
  onCopy: (text: string) => void;
  onSpeak: (text: string, langCode: string) => void;
  hapticsEnabled?: boolean;
  colors: ThemeColors;
}

const NEARBY_CATEGORY = { key: "nearby" as const, label: "Nearby", icon: "📍" };

function PhrasebookModal({
  visible,
  onClose,
  sourceLangCode,
  targetLangCode,
  onCopy,
  onSpeak,
  colors,
}: PhrasebookModalProps) {
  const [phraseCategory, setPhraseCategory] = useState<PhraseCategory | "nearby">("greetings");
  const [locationCtx, setLocationCtx] = useState<LocationContext | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);

  // Fetch location context when modal opens
  useEffect(() => {
    if (visible && !locationCtx) {
      setLocationLoading(true);
      getLocationContext()
        .then(setLocationCtx)
        .catch((err) => logger.warn("Location", "Failed to get location context", err))
        .finally(() => setLocationLoading(false));
    }
  }, [visible]);

  // Build category list with optional "Nearby" and reordering
  const categories = useMemo(() => {
    const base = [...PHRASE_CATEGORIES];
    if (locationCtx?.isAbroad && locationCtx.categoryOrder) {
      // Reorder based on location priority
      base.sort((a, b) => {
        const ai = locationCtx.categoryOrder.indexOf(a.key);
        const bi = locationCtx.categoryOrder.indexOf(b.key);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      return [NEARBY_CATEGORY, ...base];
    }
    return base;
  }, [locationCtx]);

  // Get phrases for current category
  const phrases: OfflinePhrase[] = useMemo(() => {
    if (phraseCategory === "nearby" && locationCtx?.countryCode) {
      const nearbyMap = getNearbyPhrases(locationCtx.countryCode);
      return Object.values(nearbyMap).flat();
    }
    return getPhrasesForCategory(phraseCategory as PhraseCategory);
  }, [phraseCategory, locationCtx]);

  const categoryKeyExtractor = useCallback((item: { key: string }) => item.key, []);

  const renderCategoryPill = useCallback(
    ({ item }: { item: { key: string; label: string; icon: string } }) => (
      <TouchableOpacity
        style={[styles.phraseCategoryPill, { backgroundColor: phraseCategory === item.key ? colors.primary : colors.glassBg, borderColor: phraseCategory === item.key ? colors.primary : colors.glassBorder }]}
        onPress={() => setPhraseCategory(item.key as PhraseCategory | "nearby")}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`${item.label} phrases`}
        accessibilityState={{ selected: phraseCategory === item.key }}
      >
        <Text style={styles.phraseCategoryIcon}>{item.icon}</Text>
        <Text style={[styles.phraseCategoryText, { color: phraseCategory === item.key ? "#ffffff" : colors.mutedText }]}>
          {item.label}
        </Text>
      </TouchableOpacity>
    ),
    [phraseCategory, colors],
  );

  const phraseKeyExtractor = useCallback(
    (_: OfflinePhrase, i: number) => `phrase-${phraseCategory}-${i}`,
    [phraseCategory],
  );

  const renderPhrase = useCallback(
    ({ item: phrase }: { item: OfflinePhrase }) => {
      const srcText = (sourceLangCode in phrase ? phrase[sourceLangCode as PhraseLangCode] : phrase.en);
      const tgtText = (targetLangCode in phrase ? phrase[targetLangCode as PhraseLangCode] : "");
      return (
        <TouchableOpacity
          style={[styles.phraseItem, glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
          activeOpacity={0.85}
          onPress={() => {
            if (tgtText) {
              onCopy(tgtText);
              impactLight();
            }
          }}
          onLongPress={() => {
            if (tgtText) {
              onSpeak(tgtText, targetLangCode);
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={`${srcText} translates to ${tgtText}. Tap to copy, long press to speak.`}
        >
          <Text style={[styles.phraseSrcText, { color: colors.secondaryText }]}>{srcText}</Text>
          {tgtText ? (
            <Text style={[styles.phraseTgtText, { color: colors.translatedText }]}>{tgtText}</Text>
          ) : (
            <Text style={[styles.phraseTgtText, { color: colors.dimText, fontStyle: "italic" }]}>Not available</Text>
          )}
        </TouchableOpacity>
      );
    },
    [sourceLangCode, targetLangCode, onCopy, onSpeak, colors],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View accessibilityViewIsModal={true} style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[styles.phrasebookContent, glassSurface, { backgroundColor: colors.glassBgStrong, borderColor: colors.glassBorder }]}>
          {/* Aurora bleed-through inside the sheet so the glass surface has
              something colored to refract. Honors Reduce Transparency. */}
          <GlassBackdrop />
          <Text style={[styles.compareTitle, { color: colors.titleText }]}>Phrasebook</Text>

          {/* Location banner */}
          {locationLoading && (
            <View
              style={[styles.locationBanner, { backgroundColor: colors.cardBg }]}
              accessibilityRole="progressbar"
              accessibilityLabel="Detecting your location to show relevant phrases"
              accessibilityLiveRegion="polite"
            >
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.locationText, { color: colors.dimText }]}>Detecting location...</Text>
            </View>
          )}
          {locationCtx?.isAbroad && !locationLoading && (
            <View
              style={[styles.locationBanner, { backgroundColor: colors.primary + "15" }]}
              accessibilityRole="summary"
              accessibilityLabel={`You're in ${locationCtx.countryName}, showing relevant phrases`}
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.locationIcon} importantForAccessibility="no">📍</Text>
              <Text style={[styles.locationText, { color: colors.primary }]}>
                You're in {locationCtx.countryName} — showing relevant phrases
              </Text>
            </View>
          )}

          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={categories}
            keyExtractor={categoryKeyExtractor}
            style={styles.phraseCategoryRow}
            renderItem={renderCategoryPill}
          />
          <FlatList
            data={phrases}
            keyExtractor={phraseKeyExtractor}
            style={styles.phraseList}
            renderItem={renderPhrase}
          />
          <TouchableOpacity
            style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close phrasebook"
          >
            <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" as const }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default React.memo(PhrasebookModal);

const styles = StyleSheet.create({
  compareOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  compareTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },
  compareClose: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
    marginHorizontal: -20,
  },
  phrasebookContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
    paddingTop: 20,
    paddingHorizontal: 20,
    // Clip aurora blobs to the rounded sheet outline.
    overflow: "hidden",
  },
  locationBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  locationIcon: {
    fontSize: 14,
  },
  locationText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  phraseCategoryRow: {
    flexGrow: 0,
    marginBottom: 12,
  },
  phraseCategoryPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 8,
    borderWidth: 1,
    gap: 6,
    minHeight: 44,
  },
  phraseCategoryIcon: {
    fontSize: 14,
  },
  phraseCategoryText: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  phraseList: {
    flex: 1,
  },
  phraseItem: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    minHeight: 44,
  },
  phraseSrcText: {
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 4,
  },
  phraseTgtText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600" as const,
  },
});
