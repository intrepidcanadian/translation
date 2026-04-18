import React, { useMemo } from "react";
import { modalStyles } from "../styles/modalStyles";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { LANGUAGE_MAP } from "../services/translation";
import { primaryAlpha, type ThemeColors } from "../theme";
import type { HistoryItem } from "../types";

interface StatsModalProps {
  visible: boolean;
  onClose: () => void;
  history: HistoryItem[];
  streak: { current: number; lastDate: string };
  colors: ThemeColors;
}

function StatsModal({ visible, onClose, history, streak, colors }: StatsModalProps) {
  const validHistory = useMemo(() => history.filter((h) => h.status === "ok"), [history]);

  const stats = useMemo(() => {
    const totalTranslations = validHistory.length;
    const totalFavorites = validHistory.filter((h) => h.favorited).length;
    let totalSourceWords = 0;
    let totalTranslatedWords = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const h of validHistory) {
      totalSourceWords += h.original.trim().split(/\s+/).filter(Boolean).length;
      totalTranslatedWords += h.translated.trim().split(/\s+/).filter(Boolean).length;
      if (h.confidence != null) {
        confidenceSum += h.confidence;
        confidenceCount++;
      }
    }

    const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : null;
    return { totalTranslations, totalFavorites, totalSourceWords, totalTranslatedWords, avgConfidence };
  }, [validHistory]);

  const topPairs = useMemo(() => {
    const pairCounts: Record<string, number> = {};
    for (const h of validHistory) {
      if (h.sourceLangCode && h.targetLangCode) {
        const key = `${h.sourceLangCode}\u2192${h.targetLangCode}`;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }
    return Object.entries(pairCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pair, count]) => {
        const [src, tgt] = pair.split("\u2192");
        const srcName = LANGUAGE_MAP.get(src)?.name || src;
        const tgtName = LANGUAGE_MAP.get(tgt)?.name || tgt;
        return { label: `${srcName} \u2192 ${tgtName}`, count };
      });
  }, [validHistory]);

  const topTargets = useMemo(() => {
    const targetCounts: Record<string, number> = {};
    for (const h of validHistory) {
      if (h.targetLangCode) {
        targetCounts[h.targetLangCode] = (targetCounts[h.targetLangCode] || 0) + 1;
      }
    }
    return Object.entries(targetCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([code, count]) => ({
        label: LANGUAGE_MAP.get(code)?.name || code,
        count,
      }));
  }, [validHistory]);

  const calendarData = useMemo(() => {
    if (validHistory.length === 0) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - 27);
    const windowStartMs = windowStart.getTime();
    const todayMs = today.getTime();

    // Single-pass bucket: count items per day offset instead of filtering 28x
    const buckets = new Int32Array(28);
    for (const h of validHistory) {
      if (!h.timestamp || h.timestamp < windowStartMs) continue;
      const offset = Math.floor((h.timestamp - windowStartMs) / 86400000);
      if (offset >= 0 && offset < 28) buckets[offset]++;
    }

    let maxCount = 1;
    const days: { date: Date; count: number; label: string }[] = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(windowStartMs + i * 86400000);
      const count = buckets[i];
      if (count > maxCount) maxCount = count;
      days.push({ date: d, count, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
    }
    return { days, maxCount };
  }, [validHistory]);

  const calendarElement = useMemo(() => {
    if (!calendarData) return null;
    const { days, maxCount } = calendarData;
    const weekDays = ["S", "M", "T", "W", "T", "F", "S"];

    return (
      <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
        <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Activity (Last 4 Weeks)</Text>
        <View style={styles.calendarGrid}>
          {weekDays.map((wd, wi) => (
            <Text key={`wd-${wi}`} style={[styles.calendarDayLabel, { color: colors.dimText }]}>{wd}</Text>
          ))}
          {/* Pad first week to align with day of week */}
          {Array.from({ length: days[0].date.getDay() }).map((_, pi) => (
            <View key={`pad-${pi}`} style={styles.calendarCell} />
          ))}
          {days.map((day, di) => {
            const intensity = day.count === 0 ? 0 : Math.max(0.2, day.count / maxCount);
            return (
              <View
                key={di}
                style={[
                  styles.calendarCell,
                  {
                    backgroundColor: day.count === 0
                      ? colors.borderLight
                      : colors.primary,
                    opacity: day.count === 0 ? 0.4 : 0.3 + intensity * 0.7,
                  },
                ]}
                accessibilityLabel={`${day.label}: ${day.count} translation${day.count !== 1 ? "s" : ""}`}
              />
            );
          })}
        </View>
        <View style={styles.calendarLegend}>
          <Text style={[{ color: colors.dimText, fontSize: 11 }]}>Less</Text>
          {[0, 0.25, 0.5, 0.75, 1].map((level, li) => (
            <View
              key={li}
              style={[
                styles.calendarLegendCell,
                {
                  backgroundColor: level === 0 ? colors.borderLight : colors.primary,
                  opacity: level === 0 ? 0.4 : 0.3 + level * 0.7,
                },
              ]}
            />
          ))}
          <Text style={[{ color: colors.dimText, fontSize: 11 }]}>More</Text>
        </View>
      </View>
    );
  }, [calendarData, colors.cardBg, colors.secondaryText, colors.dimText, colors.borderLight, colors.primary]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View accessibilityViewIsModal={true} style={[modalStyles.overlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[modalStyles.contentWide, { backgroundColor: colors.modalBg }]}>
          <Text style={[modalStyles.title, { color: colors.titleText }]}>Translation Statistics</Text>
          <ScrollView>
              <View>
                {/* Summary cards */}
                <View style={styles.statsGrid} accessibilityRole="summary">
                  <View style={[styles.statCard, { backgroundColor: colors.cardBg }]} accessible={true} accessibilityLabel={`${stats.totalTranslations} translations`}>
                    <Text style={[styles.statNumber, { color: colors.primary }]} importantForAccessibility="no">{stats.totalTranslations}</Text>
                    <Text style={[styles.statLabel, { color: colors.mutedText }]} importantForAccessibility="no">Translations</Text>
                  </View>
                  <View style={[styles.statCard, { backgroundColor: colors.cardBg }]} accessible={true} accessibilityLabel={`${stats.totalFavorites} favorites`}>
                    <Text style={[styles.statNumber, { color: colors.primary }]} importantForAccessibility="no">{stats.totalFavorites}</Text>
                    <Text style={[styles.statLabel, { color: colors.mutedText }]} importantForAccessibility="no">Favorites</Text>
                  </View>
                  <View style={[styles.statCard, { backgroundColor: colors.cardBg }]} accessible={true} accessibilityLabel={`${stats.totalSourceWords} words in`}>
                    <Text style={[styles.statNumber, { color: colors.primary }]} importantForAccessibility="no">{stats.totalSourceWords}</Text>
                    <Text style={[styles.statLabel, { color: colors.mutedText }]} importantForAccessibility="no">Words In</Text>
                  </View>
                  <View style={[styles.statCard, { backgroundColor: colors.cardBg }]} accessible={true} accessibilityLabel={`${stats.totalTranslatedWords} words out`}>
                    <Text style={[styles.statNumber, { color: colors.primary }]} importantForAccessibility="no">{stats.totalTranslatedWords}</Text>
                    <Text style={[styles.statLabel, { color: colors.mutedText }]} importantForAccessibility="no">Words Out</Text>
                  </View>
                </View>

                {streak.current > 0 && (
                  <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]} accessible={true} accessibilityLabel={`Daily streak: ${streak.current} ${streak.current === 1 ? "day" : "days"} in a row`}>
                    <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]} importantForAccessibility="no">Daily Streak</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 32 }} importantForAccessibility="no">🔥</Text>
                      <Text style={[styles.statNumber, { color: colors.primary, fontSize: 28 }]} importantForAccessibility="no">{streak.current}</Text>
                      <Text style={[{ color: colors.mutedText, fontSize: 14 }]} importantForAccessibility="no">{streak.current === 1 ? "day" : "days"} in a row</Text>
                    </View>
                  </View>
                )}

                {calendarElement}

                {stats.avgConfidence != null && (
                  <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Avg. Confidence</Text>
                    <View
                      style={styles.confidenceBarOuter}
                      accessibilityRole="progressbar"
                      accessibilityLabel="Average translation confidence"
                      accessibilityValue={{ min: 0, max: 100, now: Math.round(stats.avgConfidence! * 100) }}
                    >
                      <View style={[styles.confidenceBarInner, { width: `${Math.round(stats.avgConfidence! * 100)}%`, backgroundColor: colors.primary }]} />
                    </View>
                    <Text style={[styles.confidencePercent, { color: colors.primary }]} importantForAccessibility="no">{Math.round(stats.avgConfidence! * 100)}%</Text>
                  </View>
                )}

                {topPairs.length > 0 && (
                  <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Top Language Pairs</Text>
                    {topPairs.map((p, i) => (
                      <View key={i} style={styles.statsRow} accessible={true} accessibilityLabel={`${p.label}, ${p.count} translations`}>
                        <Text style={[styles.statsRowLabel, { color: colors.primaryText }]} importantForAccessibility="no">{p.label}</Text>
                        <View style={[styles.statsCountBadge, { backgroundColor: colors.primary + "22" }]}>
                          <Text style={[styles.statsCountText, { color: colors.primary }]} importantForAccessibility="no">{p.count}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {topTargets.length > 0 && (
                  <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Most Translated To</Text>
                    {topTargets.map((t, i) => (
                      <View key={i} style={styles.statsRow} accessible={true} accessibilityLabel={`${t.label}, ${t.count} translations`}>
                        <Text style={[styles.statsRowLabel, { color: colors.primaryText }]} importantForAccessibility="no">{t.label}</Text>
                        <View style={[styles.statsCountBadge, { backgroundColor: colors.primary + "22" }]}>
                          <Text style={[styles.statsCountText, { color: colors.primary }]} importantForAccessibility="no">{t.count}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {stats.totalTranslations === 0 && (
                  <View style={styles.statsEmptyState} accessible={true} accessibilityLabel="No translations yet. Start translating to see your stats!">
                    <Text importantForAccessibility="no" style={[{ color: colors.mutedText, fontSize: 40, marginBottom: 12 }]}>📭</Text>
                    <Text style={[{ color: colors.mutedText, fontSize: 15, textAlign: "center" as const }]}>
                      No translations yet.{"\n"}Start translating to see your stats!
                    </Text>
                  </View>
                )}
              </View>
          </ScrollView>
          <TouchableOpacity
            style={[modalStyles.closeButton, { borderTopColor: colors.borderLight }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close statistics"
          >
            <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" as const }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    borderRadius: 14,
    padding: 14,
    alignItems: "center" as const,
    width: "47%" as const,
    flexGrow: 1,
  },
  statNumber: {
    fontSize: 28,
    fontWeight: "800" as const,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: "600" as const,
    marginTop: 4,
  },
  statsSection: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  statsSectionTitle: {
    fontSize: 13,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    paddingVertical: 6,
  },
  statsRowLabel: {
    fontSize: 14,
    flex: 1,
  },
  statsCountBadge: {
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  statsCountText: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  confidenceBarOuter: {
    height: 8,
    borderRadius: 4,
    backgroundColor: primaryAlpha.faint,
    overflow: "hidden" as const,
    marginBottom: 6,
  },
  confidenceBarInner: {
    height: 8,
    borderRadius: 4,
  },
  confidencePercent: {
    fontSize: 14,
    fontWeight: "700" as const,
    textAlign: "right" as const,
  },
  calendarGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 3,
  },
  calendarDayLabel: {
    width: 28,
    height: 14,
    fontSize: 10,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
  calendarCell: {
    width: 28,
    height: 28,
    borderRadius: 5,
  },
  calendarLegend: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "flex-end" as const,
    gap: 4,
    marginTop: 8,
  },
  calendarLegendCell: {
    width: 14,
    height: 14,
    borderRadius: 3,
  },
  statsEmptyState: {
    alignItems: "center" as const,
    paddingVertical: 40,
  },
});

export default React.memo(StatsModal);
