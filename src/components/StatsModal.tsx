import React, { useMemo } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from "react-native";
import { LANGUAGE_MAP } from "../services/translation";
import type { ThemeColors } from "../theme";

interface HistoryItem {
  original: string;
  translated: string;
  favorited?: boolean;
  pending?: boolean;
  error?: boolean;
  confidence?: number | null;
  sourceLangCode?: string;
  targetLangCode?: string;
  timestamp?: number;
}

interface StatsModalProps {
  visible: boolean;
  onClose: () => void;
  history: HistoryItem[];
  streak: { current: number; lastDate: string };
  colors: ThemeColors;
}

export default function StatsModal({ visible, onClose, history, streak, colors }: StatsModalProps) {
  const validHistory = useMemo(() => history.filter((h) => !h.pending && !h.error), [history]);

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
    const days: { date: Date; count: number; label: string }[] = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dayStart = d.getTime();
      const dayEnd = dayStart + 86400000;
      const count = validHistory.filter((h) => h.timestamp && h.timestamp >= dayStart && h.timestamp < dayEnd).length;
      days.push({ date: d, count, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
    }
    const maxCount = Math.max(...days.map((d) => d.count), 1);
    return { days, maxCount };
  }, [validHistory]);

  const renderCalendar = () => {
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
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View accessibilityViewIsModal={true} style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[styles.statsContent, { backgroundColor: colors.modalBg }]}>
          <Text style={[styles.compareTitle, { color: colors.titleText }]}>Translation Statistics</Text>
          <FlatList
            data={[{ key: "stats" }]}
            renderItem={() => (
              <View>
                {/* Summary cards */}
                <View style={styles.statsGrid}>
                  <View style={[styles.statCard, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statNumber, { color: colors.primary }]}>{stats.totalTranslations}</Text>
                    <Text style={[styles.statLabel, { color: colors.mutedText }]}>Translations</Text>
                  </View>
                  <View style={[styles.statCard, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statNumber, { color: colors.primary }]}>{stats.totalFavorites}</Text>
                    <Text style={[styles.statLabel, { color: colors.mutedText }]}>Favorites</Text>
                  </View>
                  <View style={[styles.statCard, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statNumber, { color: colors.primary }]}>{stats.totalSourceWords}</Text>
                    <Text style={[styles.statLabel, { color: colors.mutedText }]}>Words In</Text>
                  </View>
                  <View style={[styles.statCard, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statNumber, { color: colors.primary }]}>{stats.totalTranslatedWords}</Text>
                    <Text style={[styles.statLabel, { color: colors.mutedText }]}>Words Out</Text>
                  </View>
                </View>

                {streak.current > 0 && (
                  <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Daily Streak</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 32 }}>🔥</Text>
                      <Text style={[styles.statNumber, { color: colors.primary, fontSize: 28 }]}>{streak.current}</Text>
                      <Text style={[{ color: colors.mutedText, fontSize: 14 }]}>{streak.current === 1 ? "day" : "days"} in a row</Text>
                    </View>
                  </View>
                )}

                {renderCalendar()}

                {stats.avgConfidence != null && (
                  <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Avg. Confidence</Text>
                    <View style={styles.confidenceBarOuter}>
                      <View style={[styles.confidenceBarInner, { width: `${Math.round(stats.avgConfidence! * 100)}%`, backgroundColor: colors.primary }]} />
                    </View>
                    <Text style={[styles.confidencePercent, { color: colors.primary }]}>{Math.round(stats.avgConfidence! * 100)}%</Text>
                  </View>
                )}

                {topPairs.length > 0 && (
                  <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Top Language Pairs</Text>
                    {topPairs.map((p, i) => (
                      <View key={i} style={styles.statsRow}>
                        <Text style={[styles.statsRowLabel, { color: colors.primaryText }]}>{p.label}</Text>
                        <View style={[styles.statsCountBadge, { backgroundColor: colors.primary + "22" }]}>
                          <Text style={[styles.statsCountText, { color: colors.primary }]}>{p.count}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {topTargets.length > 0 && (
                  <View style={[styles.statsSection, { backgroundColor: colors.cardBg }]}>
                    <Text style={[styles.statsSectionTitle, { color: colors.secondaryText }]}>Most Translated To</Text>
                    {topTargets.map((t, i) => (
                      <View key={i} style={styles.statsRow}>
                        <Text style={[styles.statsRowLabel, { color: colors.primaryText }]}>{t.label}</Text>
                        <View style={[styles.statsCountBadge, { backgroundColor: colors.primary + "22" }]}>
                          <Text style={[styles.statsCountText, { color: colors.primary }]}>{t.count}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {stats.totalTranslations === 0 && (
                  <View style={styles.statsEmptyState}>
                    <Text style={[{ color: colors.mutedText, fontSize: 40, marginBottom: 12 }]}>📭</Text>
                    <Text style={[{ color: colors.mutedText, fontSize: 15, textAlign: "center" as const }]}>
                      No translations yet.{"\n"}Start translating to see your stats!
                    </Text>
                  </View>
                )}
              </View>
            )}
            keyExtractor={(item) => item.key}
          />
          <TouchableOpacity
            style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
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
  statsContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
    paddingTop: 20,
    paddingHorizontal: 20,
  },
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
    width: "47%" as any,
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
    backgroundColor: "rgba(108,99,255,0.15)",
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
