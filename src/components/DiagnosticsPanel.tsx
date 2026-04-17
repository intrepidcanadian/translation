import React, { useCallback, useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import CollapsibleSection from "./CollapsibleSection";
import { type ThemeColors } from "../theme";
import {
  type CircuitSnapshot,
  type TranslationCacheStats,
  type TranslationProvider,
} from "../services/translation";
import {
  prunedUnknownKeys,
  getAll as getTelemetrySnapshot,
  getRatesServedStats,
} from "../services/telemetry";
import {
  getRatesFreshnessGrade,
  type RatesCacheState,
  type RefreshResult,
} from "../services/currencyExchange";
import { freshnessGradeTag } from "../utils/ratesFreshnessDisplay";
import type { OfflineQueueStats } from "../services/telemetry";

interface TypeAheadStats {
  glossary: number;
  offlineHit: number;
  offlineMiss: number;
  network: number;
  total: number;
}

interface SpeechStats {
  success: number;
  fail: number;
  noSpeech: number;
  permissionDenied: number;
  total: number;
}

interface WordAltCacheStats {
  size: number;
  max: number;
}

interface Props {
  colors: ThemeColors;
  circuitSnapshots: CircuitSnapshot[];
  cacheStats: TranslationCacheStats | null;
  wordAltCacheStats: WordAltCacheStats | null;
  typeAheadStats: TypeAheadStats | null;
  speechStats: SpeechStats | null;
  offlineQueueStats: OfflineQueueStats | null;
  speechFailLast60s: number;
  offlineFailLast60s: number;
  ratesCacheState: RatesCacheState | null;
  ratesRefreshing: boolean;
  refreshOutcome: RefreshResult | null;
  diagnosticsExpanded: boolean;
  prunedKeysExpanded: boolean;
  isLikelyMicMuted: (stats: SpeechStats) => boolean;
  ratesStateLabel: (s: RatesCacheState) => string;
  ratesStateAccessibilityLabel: (s: RatesCacheState) => string;
  refreshOutcomeLabel: (r: RefreshResult) => string;
  refreshOutcomeAccessibilityLabel: (r: RefreshResult) => string;
  onToggleDiagnostics: () => void;
  onTogglePrunedKeys: () => void;
  onRefresh: () => void;
  onRefreshRates: () => void;
  onResetCircuits: () => void;
  onClearCache: () => void;
  onResetTelemetry: () => void;
  onClearProviderCache: (provider: string) => void;
  onClearWordAltCache?: () => void;
}

function DiagnosticsPanel({
  colors,
  circuitSnapshots,
  cacheStats,
  wordAltCacheStats,
  typeAheadStats,
  speechStats,
  offlineQueueStats,
  speechFailLast60s,
  offlineFailLast60s,
  ratesCacheState,
  ratesRefreshing,
  refreshOutcome,
  diagnosticsExpanded,
  prunedKeysExpanded,
  isLikelyMicMuted,
  ratesStateLabel,
  ratesStateAccessibilityLabel,
  refreshOutcomeLabel,
  refreshOutcomeAccessibilityLabel,
  onToggleDiagnostics,
  onTogglePrunedKeys,
  onRefresh,
  onRefreshRates,
  onResetCircuits,
  onClearCache,
  onResetTelemetry,
  onClearProviderCache,
  onClearWordAltCache,
}: Props) {
  const dynamicStyles = useMemo(() => ({
    infoText: { color: colors.dimText },
  }), [colors]);

  return (
    <View style={styles.infoSection}>
      <CollapsibleSection
        title="Translation Diagnostics"
        expanded={diagnosticsExpanded}
        onToggle={onToggleDiagnostics}
        urgent={circuitSnapshots.some((s) => s.open)}
        colors={colors}
      >
        {cacheStats && (
          <>
            <Text
              style={[
                styles.infoText,
                dynamicStyles.infoText,
                cacheStats.maxBytes > 0 && cacheStats.bytes / cacheStats.maxBytes >= 0.95
                  ? { color: colors.errorText }
                  : cacheStats.maxBytes > 0 && cacheStats.bytes / cacheStats.maxBytes >= 0.8
                    ? { color: colors.primary }
                    : null,
              ]}
            >
              Cache: {cacheStats.size}/{cacheStats.max}{cacheStats.bytes > 0 ? ` · ${Math.round(cacheStats.bytes / 1024)}KB / ${Math.round(cacheStats.maxBytes / 1024)}KB` : ""}
            </Text>
            {(cacheStats.hits + cacheStats.misses) > 0 && (
              <Text style={[styles.infoText, dynamicStyles.infoText]}>
                Hit rate: {Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100)}% ({cacheStats.hits}/{cacheStats.hits + cacheStats.misses})
              </Text>
            )}
            {wordAltCacheStats && wordAltCacheStats.size > 0 && (
              <View style={styles.cacheProviderRow}>
                <Text style={[styles.infoText, dynamicStyles.infoText, styles.cacheProviderLabel]}>
                  Word alt cache: {wordAltCacheStats.size}/{wordAltCacheStats.max}
                </Text>
                {onClearWordAltCache && (
                  <TouchableOpacity
                    style={[styles.cacheProviderClear, { backgroundColor: colors.cardBg }]}
                    onPress={onClearWordAltCache}
                    accessibilityRole="button"
                    accessibilityLabel="Clear word alternatives cache"
                    accessibilityHint={`Removes ${wordAltCacheStats.size} cached word alternative lookups`}
                  >
                    <Text style={[styles.cacheProviderClearText, { color: colors.dimText }]}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {Object.entries(cacheStats.byProvider).map(([provider, count]) => (
              <View key={provider} style={styles.cacheProviderRow}>
                <Text style={[styles.infoText, dynamicStyles.infoText, styles.cacheProviderLabel]}>
                  {provider}: {count}
                </Text>
                <TouchableOpacity
                  style={[styles.cacheProviderClear, { backgroundColor: colors.cardBg }]}
                  onPress={() => onClearProviderCache(provider)}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear ${provider} cache entries`}
                  accessibilityHint={`Removes ${count} cached ${provider} translations`}
                >
                  <Text style={[styles.cacheProviderClearText, { color: colors.dimText }]}>Clear</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
        {circuitSnapshots.map((s) => (
          <Text
            key={s.provider}
            style={[
              styles.infoText,
              dynamicStyles.infoText,
              s.open ? { color: colors.errorText } : null,
            ]}
          >
            {s.provider}: {s.open ? `open (${Math.ceil(s.msUntilReset / 1000)}s)` : "closed"} · failures {s.failures}
          </Text>
        ))}
        {(() => {
          const pruned = prunedUnknownKeys();
          if (pruned.length === 0) return null;
          const MAX_RENDERED = 3;
          const hasMore = pruned.length > MAX_RENDERED;
          const visibleKeys = prunedKeysExpanded ? pruned : pruned.slice(0, MAX_RENDERED);
          const shown = visibleKeys.join(", ");
          const suffix = hasMore && !prunedKeysExpanded
            ? ` +${pruned.length - MAX_RENDERED} more`
            : "";
          const label = `Telemetry pruned ${pruned.length} unknown key${pruned.length === 1 ? "" : "s"} — client may have been downgraded`;
          return (
            <View style={{ marginTop: 4 }}>
              <Text
                style={[
                  styles.infoText,
                  dynamicStyles.infoText,
                  { color: colors.dimText },
                ]}
                accessibilityLabel={label}
              >
                {`⚠ Telemetry pruned ${pruned.length}: ${shown}${suffix}`}
              </Text>
              {hasMore && (
                <TouchableOpacity
                  onPress={onTogglePrunedKeys}
                  accessibilityRole="button"
                  accessibilityLabel={
                    prunedKeysExpanded
                      ? "Collapse pruned telemetry keys list"
                      : `Show all ${pruned.length} pruned telemetry keys`
                  }
                  accessibilityState={{ expanded: prunedKeysExpanded }}
                >
                  <Text
                    style={[
                      styles.infoText,
                      dynamicStyles.infoText,
                      { color: colors.primary, marginTop: 2 },
                    ]}
                  >
                    {prunedKeysExpanded ? "Collapse" : `Show all ${pruned.length}`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })()}
        {typeAheadStats && (
          <View style={styles.telemetryBlock}>
            <Text style={[styles.infoText, dynamicStyles.infoText, styles.telemetryTitle]}>
              Type-ahead (session):
            </Text>
            <Text style={[styles.infoText, dynamicStyles.infoText]}>
              Glossary: {typeAheadStats.glossary} · Offline hit: {typeAheadStats.offlineHit} · Offline miss: {typeAheadStats.offlineMiss} · Network: {typeAheadStats.network}
            </Text>
            {typeAheadStats.total > 0 && (
              <Text style={[styles.infoText, dynamicStyles.infoText]}>
                Local short-circuit: {Math.round(((typeAheadStats.glossary + typeAheadStats.offlineHit) / typeAheadStats.total) * 100)}% of {typeAheadStats.total}
              </Text>
            )}
          </View>
        )}
        {speechStats && (speechStats.total > 0 || speechStats.noSpeech > 0 || speechStats.permissionDenied > 0) && (
          <View style={styles.telemetryBlock}>
            <Text style={[styles.infoText, dynamicStyles.infoText, styles.telemetryTitle]}>
              Speech translate (session):
            </Text>
            {speechStats.total > 0 && (
              <Text
                style={[
                  styles.infoText,
                  dynamicStyles.infoText,
                  speechStats.fail > 0 && speechStats.fail / speechStats.total >= 0.25
                    ? { color: colors.errorText }
                    : null,
                ]}
              >
                OK: {speechStats.success} · Fail: {speechStats.fail} ({Math.round((speechStats.fail / speechStats.total) * 100)}% fail of {speechStats.total})
              </Text>
            )}
            {speechStats.noSpeech > 0 && (
              <Text
                style={[styles.infoText, dynamicStyles.infoText]}
                accessibilityLabel={`${speechStats.noSpeech} no-speech events this session`}
              >
                No-speech events: {speechStats.noSpeech}
              </Text>
            )}
            {speechStats.permissionDenied > 0 && (
              <Text
                style={[
                  styles.infoText,
                  dynamicStyles.infoText,
                  { color: colors.errorText },
                ]}
                accessibilityLabel={`${speechStats.permissionDenied} microphone permission denial event${speechStats.permissionDenied === 1 ? "" : "s"} this session`}
              >
                Permission denied: {speechStats.permissionDenied}
              </Text>
            )}
            {speechStats && isLikelyMicMuted(speechStats) && (
              <Text
                style={[
                  styles.infoText,
                  dynamicStyles.infoText,
                  { color: colors.errorText },
                ]}
                accessibilityLiveRegion="polite"
                accessibilityLabel="Microphone may be muted or environment too quiet. No successful recognitions this session."
              >
                ⚠ Mic may be muted or environment too quiet
              </Text>
            )}
            {speechFailLast60s > 0 && (
              <Text
                style={[
                  styles.infoText,
                  dynamicStyles.infoText,
                  { color: colors.errorText },
                ]}
                accessibilityLabel={`${speechFailLast60s} speech translation failures in the last 60 seconds`}
              >
                Last 60s: {speechFailLast60s} fail{speechFailLast60s === 1 ? "" : "s"}
              </Text>
            )}
          </View>
        )}
        {ratesCacheState && (ratesCacheState.hasCache || ratesCacheState.lastAttemptAgeMs !== null) && (
          <View style={styles.telemetryBlock}>
            <Text style={[styles.infoText, dynamicStyles.infoText, styles.telemetryTitle]}>
              Exchange rates:
            </Text>
            <Text
              style={[
                styles.infoText,
                dynamicStyles.infoText,
                ratesCacheState.hasCache && !ratesCacheState.isFresh && ratesCacheState.willThrottleNextFetch
                  ? { color: colors.errorText }
                  : null,
              ]}
              accessibilityLabel={ratesStateAccessibilityLabel(ratesCacheState)}
            >
              {ratesStateLabel(ratesCacheState)}
            </Text>
            {refreshOutcome && (
              <Text
                style={[
                  styles.infoText,
                  dynamicStyles.infoText,
                  { color: refreshOutcome.ok ? colors.primary : colors.errorText },
                ]}
                accessibilityLiveRegion="polite"
                accessibilityLabel={refreshOutcomeAccessibilityLabel(refreshOutcome)}
              >
                {refreshOutcomeLabel(refreshOutcome)}
              </Text>
            )}
            {typeAheadStats && (() => {
              const manual = getTelemetrySnapshot()["rates.manualRefresh"];
              const manualFailed = getTelemetrySnapshot()["rates.manualRefreshFailed"];
              if (manual === 0) return null;
              const failPct = Math.round((manualFailed / manual) * 100);
              const overThreshold = manual > 0 && manualFailed / manual >= 0.25;
              return (
                <Text
                  style={[
                    styles.infoText,
                    dynamicStyles.infoText,
                    overThreshold ? { color: colors.errorText } : null,
                  ]}
                  accessibilityLabel={
                    manualFailed === 0
                      ? `Manual refresh: ${manual} attempt${manual === 1 ? "" : "s"}, all succeeded`
                      : `Manual refresh: ${manual} attempt${manual === 1 ? "" : "s"}, ${manualFailed} failed (${failPct}%)`
                  }
                >
                  Manual refresh: {manual} · fail {manualFailed} ({failPct}%)
                </Text>
              );
            })()}
            {typeAheadStats && (() => {
              const validationFailed = getTelemetrySnapshot()["rates.validationFailed"];
              if (validationFailed === 0) return null;
              return (
                <Text
                  style={[
                    styles.infoText,
                    dynamicStyles.infoText,
                    { color: colors.errorText },
                  ]}
                  accessibilityLabel={`Rate payload rejected: ${validationFailed} time${validationFailed === 1 ? "" : "s"}`}
                >
                  Payload rejected: {validationFailed} (API returned invalid data)
                </Text>
              );
            })()}
            {(() => {
              const grade = getRatesFreshnessGrade(ratesCacheState);
              const tag = freshnessGradeTag(grade);
              if (!tag) return null;
              const isCritical = grade === "stale-critical" || grade === "none";
              return (
                <Text
                  style={[
                    styles.infoText,
                    dynamicStyles.infoText,
                    { color: isCritical ? colors.errorText : colors.primary },
                  ]}
                  accessibilityLabel={`Rate freshness grade: ${tag}`}
                >
                  Freshness: [{tag}]
                </Text>
              );
            })()}
            {(() => {
              const served = getRatesServedStats();
              if (served.total === 0) return null;
              const hasFallback = served.fallbackServed > 0;
              return (
                <Text
                  style={[
                    styles.infoText,
                    dynamicStyles.infoText,
                    hasFallback ? { color: colors.errorText } : null,
                  ]}
                  accessibilityLabel={
                    `Rates served this session: ${served.staleServed} from stale cache, ${served.fallbackServed} from built-in fallback`
                  }
                >
                  Served: stale {served.staleServed} · fallback {served.fallbackServed}
                </Text>
              );
            })()}
          </View>
        )}
        {offlineQueueStats && (offlineQueueStats.total > 0 || offlineQueueStats.deadLetter > 0 || offlineFailLast60s > 0) && (
          <View style={styles.telemetryBlock}>
            <Text style={[styles.infoText, dynamicStyles.infoText, styles.telemetryTitle]}>
              Offline queue (session):
            </Text>
            {offlineQueueStats.total > 0 && (
              <Text
                style={[
                  styles.infoText,
                  dynamicStyles.infoText,
                  offlineQueueStats.failRate >= 0.25
                    ? { color: colors.errorText }
                    : null,
                ]}
                accessibilityLabel={`${offlineQueueStats.success} succeeded, ${offlineQueueStats.failed} failed out of ${offlineQueueStats.total} offline queue attempts`}
              >
                OK: {offlineQueueStats.success} · Fail: {offlineQueueStats.failed} ({Math.round(offlineQueueStats.failRate * 100)}% of {offlineQueueStats.total})
              </Text>
            )}
            {offlineQueueStats.deadLetter > 0 && (
              <Text
                style={[
                  styles.infoText,
                  dynamicStyles.infoText,
                  { color: colors.errorText },
                ]}
                accessibilityLabel={`${offlineQueueStats.deadLetter} queue items permanently dropped after exhausting retries`}
              >
                ⚠ Dead-lettered: {offlineQueueStats.deadLetter}
              </Text>
            )}
            {offlineFailLast60s > 0 && (
              <Text
                style={[
                  styles.infoText,
                  dynamicStyles.infoText,
                  { color: colors.errorText },
                ]}
                accessibilityLabel={
                  offlineQueueStats.success > 0
                    ? `${offlineFailLast60s} offline queue warnings in the last 60 seconds, against ${offlineQueueStats.success} successful items this session`
                    : `${offlineFailLast60s} offline queue warnings in the last 60 seconds`
                }
              >
                Last 60s: {offlineFailLast60s} warn{offlineFailLast60s === 1 ? "" : "s"}
                {offlineQueueStats.success > 0
                  ? ` · session OK ${offlineQueueStats.success}`
                  : ""}
              </Text>
            )}
          </View>
        )}
        <View style={styles.crashActions}>
          <TouchableOpacity
            style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
            onPress={onRefresh}
            accessibilityRole="button"
            accessibilityLabel="Refresh translation diagnostics"
          >
            <Text style={[styles.crashActionText, { color: colors.primary }]}>Refresh</Text>
          </TouchableOpacity>
          {ratesCacheState && (!ratesCacheState.hasCache || !ratesCacheState.isFresh) && (
            <TouchableOpacity
              style={[
                styles.crashActionButton,
                { backgroundColor: colors.cardBg, opacity: ratesRefreshing ? 0.5 : 1 },
              ]}
              onPress={onRefreshRates}
              disabled={ratesRefreshing}
              accessibilityRole="button"
              accessibilityLabel={
                ratesRefreshing
                  ? "Refreshing exchange rates"
                  : "Force refresh exchange rates, bypassing the 60 second throttle"
              }
              accessibilityState={{ disabled: ratesRefreshing }}
            >
              <Text style={[styles.crashActionText, { color: colors.primary }]}>
                {ratesRefreshing ? "Refreshing…" : "Refresh Rates"}
              </Text>
            </TouchableOpacity>
          )}
          {circuitSnapshots.some((s) => s.open || s.failures > 0) && (
            <TouchableOpacity
              style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
              onPress={onResetCircuits}
              accessibilityRole="button"
              accessibilityLabel="Reset translation circuit breakers"
            >
              <Text style={[styles.crashActionText, { color: colors.primary }]}>Reset Circuits</Text>
            </TouchableOpacity>
          )}
          {cacheStats && cacheStats.size > 0 && (
            <TouchableOpacity
              style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
              onPress={onClearCache}
              accessibilityRole="button"
              accessibilityLabel="Clear translation cache"
            >
              <Text style={[styles.crashActionText, { color: colors.dimText }]}>Clear Cache</Text>
            </TouchableOpacity>
          )}
          {typeAheadStats && typeAheadStats.total > 0 && (
            <TouchableOpacity
              style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
              onPress={onResetTelemetry}
              accessibilityRole="button"
              accessibilityLabel="Reset type-ahead telemetry counters"
              accessibilityHint="Zeroes session counters without clearing cache or circuits"
            >
              <Text style={[styles.crashActionText, { color: colors.dimText }]}>Reset Telemetry</Text>
            </TouchableOpacity>
          )}
        </View>
      </CollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  infoSection: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  infoText: {
    fontSize: 12,
    marginBottom: 2,
    lineHeight: 16,
  },
  cacheProviderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  cacheProviderLabel: {
    flex: 1,
  },
  cacheProviderClear: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  cacheProviderClearText: {
    fontSize: 11,
    fontWeight: "600",
  },
  telemetryBlock: {
    marginTop: 8,
  },
  telemetryTitle: {
    fontWeight: "600",
    marginBottom: 2,
  },
  crashActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  crashActionButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  crashActionText: {
    fontSize: 13,
    fontWeight: "600",
  },
});

export default React.memo(DiagnosticsPanel);
