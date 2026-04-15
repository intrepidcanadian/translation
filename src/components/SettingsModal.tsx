import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Switch,
  StyleSheet,
  ScrollView,
  Platform,
  Share,
} from "react-native";
import Slider from "@react-native-community/slider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { copyWithoutAutoClear } from "../services/clipboard";
import { type ThemeMode, type ThemeColors, getColors } from "../theme";
import {
  isAppleTranslationAvailable,
  getCircuitSnapshots,
  getTranslationCacheStats,
  resetCircuits,
  clearTranslationCache,
  type CircuitSnapshot,
  type TranslationCacheStats,
  type TranslationProvider,
} from "../services/translation";
import { logger } from "../services/logger";
import {
  getAll as getTelemetrySnapshot,
  increment as incrementTelemetry,
  reset as resetTelemetry,
  prunedUnknownKeys,
  getOfflineQueueStats,
  type OfflineQueueStats,
} from "../services/telemetry";
import {
  getRatesCacheState,
  forceRefreshExchangeRates,
  type RatesCacheState,
  type RefreshResult,
} from "../services/currencyExchange";
import { notifySuccess } from "../services/haptics";
import { migrateCrashReport, type CrashReport } from "../types/crashReport";
import { isLikelyMicMuted as isLikelyMicMutedPure } from "../utils/micMuted";
import CollapsibleSection from "./CollapsibleSection";
import { useAutoClearFlag } from "../hooks/useAutoClearFlag";

export type { TranslationProvider };

// Type-ahead telemetry shape — counts of where each debounced preview landed.
// Sourced from the telemetry module (src/services/telemetry.ts), which works
// in both dev and production builds. The previous implementation queried the
// logger's debug ring buffer, but that ring is `__DEV__`-only so the
// dashboard was empty in release builds (#118).
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
  /** #152: routine no-speech recognition errors — tracked separately so the
   * dashboard can distinguish "silent user" sessions from broken-mic failures
   * without polluting the translate-fail rate. */
  noSpeech: number;
  /** #181: OS-level mic-permission denials. Counter already populated by the
   * `useSpeechRecognition` `not-allowed` error branch (#180); surfaced here as
   * a dedicated line so permission churn is visually distinct from translate
   * failures and no-speech bursts. The recovery flow is "Open Settings", not
   * "retry / switch provider", so it deserves its own bucket. */
  permissionDenied: number;
  total: number;
}

function computeTypeAheadStats(): TypeAheadStats {
  const t = getTelemetrySnapshot();
  const glossary = t["typeAhead.glossary"];
  const offlineHit = t["typeAhead.offlineHit"];
  const offlineMiss = t["typeAhead.offlineMiss"];
  const network = t["typeAhead.network"];
  return { glossary, offlineHit, offlineMiss, network, total: glossary + offlineHit + offlineMiss + network };
}

function computeSpeechStats(): SpeechStats {
  const t = getTelemetrySnapshot();
  const success = t["speech.translateSuccess"];
  const fail = t["speech.translateFail"];
  const noSpeech = t["speech.noSpeech"];
  const permissionDenied = t["speech.permissionDenied"];
  return { success, fail, noSpeech, permissionDenied, total: success + fail };
}

/**
 * #156/#160: detect the "mic may be muted / quiet environment" pattern via the
 * shared `src/utils/micMuted.ts` helper. Previously inlined here, now promoted
 * so `useSpeechRecognition` can raise the same hint inline near the mic button
 * with an identical threshold — the dashboard and inline hint stay in lockstep.
 */
function isLikelyMicMuted(stats: SpeechStats): boolean {
  return isLikelyMicMutedPure(stats.noSpeech, stats.total);
}

/**
 * #205: human-readable formatter for the exchange-rate cache state line.
 * Distinguishes the four states a reader cares about:
 *   - no cache + just attempted (fall-through to FALLBACK_RATES)
 *   - no cache + no attempts (cold start before first conversion)
 *   - fresh cache (within 4h TTL)
 *   - stale cache (past TTL but throttled / waiting for next attempt)
 *
 * Returns a compact one-liner so it slots into the existing telemetryBlock
 * without breaking layout — long-form details live in the accessibilityLabel.
 */
function formatRelativeMs(ms: number | null): string {
  if (ms === null) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

/**
 * #211: format the throttle countdown ("42s") so the rates line can show how
 * long until the next opportunistic refresh fires. Rounds up so the user
 * never sees "0s" while the throttle is still active. Returns an empty
 * string for null/0 to keep call sites terse.
 */
function formatCountdownMs(ms: number | null): string {
  if (ms === null || ms <= 0) return "";
  const sec = Math.max(1, Math.ceil(ms / 1000));
  return `${sec}s`;
}

function ratesStateLabel(s: RatesCacheState): string {
  if (!s.hasCache) {
    return s.lastAttemptAgeMs !== null
      ? `No cache · last attempt ${formatRelativeMs(s.lastAttemptAgeMs)} (using fallback)`
      : `No cache yet`;
  }
  if (s.isFresh) {
    return `Fresh · ${formatRelativeMs(s.ageMs)}`;
  }
  if (s.willThrottleNextFetch) {
    // #211: include the human-readable countdown so a user staring at a
    // disabled-feeling refresh button knows when the next opportunistic
    // refetch will fire instead of guessing.
    const countdown = formatCountdownMs(s.nextRefetchInMs);
    return countdown
      ? `Stale · ${formatRelativeMs(s.ageMs)} · refresh in ${countdown}`
      : `Stale · ${formatRelativeMs(s.ageMs)} · refresh throttled`;
  }
  return `Stale · ${formatRelativeMs(s.ageMs)} · will refetch`;
}

/**
 * #207: turns a `RefreshResult` into a short user-visible status line for the
 * transient "just tapped Refresh Rates" feedback. Pure formatter — no React
 * dependency — so it can be unit-tested independently. The success branch
 * has two flavors depending on whether the prior cache was already stale,
 * because "found something fresher" deserves a clearer signal than
 * "confirmed what you had".
 */
function refreshOutcomeLabel(r: RefreshResult): string {
  if (r.ok) {
    return r.hadStaleCache
      ? `✓ Refreshed (was stale) · ${formatRelativeMs(r.ageMs)}`
      : `✓ Refreshed · ${formatRelativeMs(r.ageMs)}`;
  }
  if (r.usedFallback) return `⚠ Refresh failed · using built-in rates`;
  return r.ageMs !== null
    ? `⚠ Refresh failed · using cache ${formatRelativeMs(r.ageMs)}`
    : `⚠ Refresh failed`;
}

function refreshOutcomeAccessibilityLabel(r: RefreshResult): string {
  if (r.ok) {
    return r.hadStaleCache
      ? `Exchange rates refreshed successfully. Cache was stale before; now ${formatRelativeMs(r.ageMs)}.`
      : `Exchange rates refreshed successfully ${formatRelativeMs(r.ageMs)}.`;
  }
  if (r.usedFallback) {
    return `Exchange rate refresh failed. Conversions will use built-in fallback rates.`;
  }
  return r.ageMs !== null
    ? `Exchange rate refresh failed. Falling back to cache from ${formatRelativeMs(r.ageMs)}.`
    : `Exchange rate refresh failed.`;
}

function ratesStateAccessibilityLabel(s: RatesCacheState): string {
  if (!s.hasCache) {
    return s.lastAttemptAgeMs !== null
      ? `Exchange rates: no cache available, last fetch attempt was ${formatRelativeMs(s.lastAttemptAgeMs)}, currently using hardcoded fallback rates`
      : `Exchange rates: no cache yet, will fetch on first conversion`;
  }
  if (s.isFresh) {
    return `Exchange rates: cache is fresh, last refreshed ${formatRelativeMs(s.ageMs)}`;
  }
  if (s.willThrottleNextFetch) {
    return `Exchange rates: cache is stale (${formatRelativeMs(s.ageMs)}), refetch is throttled until 60 seconds since last attempt. Tap Refresh Rates to override.`;
  }
  return `Exchange rates: cache is stale (${formatRelativeMs(s.ageMs)}), will refetch on next conversion`;
}

export type FontSizeOption = "small" | "medium" | "large" | "xlarge";

export const FONT_SIZE_SCALES: Record<FontSizeOption, number> = {
  small: 0.85,
  medium: 1.0,
  large: 1.2,
  xlarge: 1.4,
};

export type SilenceTimeoutOption = 0 | 3 | 5 | 10;

export type ConfidenceThreshold = 0 | 50 | 70 | 85;

export interface Settings {
  hapticsEnabled: boolean;
  autoPlayTTS: boolean;
  speechRate: number;
  fontSize: FontSizeOption;
  theme: ThemeMode;
  autoScroll: boolean;
  translationProvider: TranslationProvider;
  showRomanization: boolean;
  offlineSpeech: boolean;
  silenceTimeout: SilenceTimeoutOption;
  confidenceThreshold: ConfidenceThreshold;
  /** Include translation diagnostics (cache size, hit rate, open circuit
   * breakers, type-ahead counters) when sharing crash reports. Defaults on
   * because the data is innocuous, but users can opt out if they'd rather not
   * send metadata about their session alongside the crash itself (#120). */
  shareDiagnosticsInCrashReports: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  hapticsEnabled: true,
  autoPlayTTS: false,
  speechRate: 1.0,
  fontSize: "medium",
  theme: "dark",
  autoScroll: true,
  translationProvider: "apple",
  showRomanization: true,
  offlineSpeech: false,
  silenceTimeout: 0,
  confidenceThreshold: 0,
  shareDiagnosticsInCrashReports: true,
};

interface Props {
  visible: boolean;
  onClose: () => void;
  settings: Settings;
  onUpdate: (settings: Settings) => void;
}

function SettingsModal({ visible, onClose, settings, onUpdate }: Props) {
  const colors = useMemo(() => getColors(settings.theme), [settings.theme]);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [lastCrash, setLastCrash] = useState<CrashReport | null>(null);
  // useAutoClearFlag<true>: null→falsy "Copy", true→truthy "Copied!" — the
  // hook handles unmount cleanup so a modal dismiss mid-badge can't setState
  // on a torn-down tree.
  const [crashCopied, setCrashCopied] = useAutoClearFlag<true>(1500);
  const [circuitSnapshots, setCircuitSnapshots] = useState<CircuitSnapshot[]>([]);
  const [cacheStats, setCacheStats] = useState<TranslationCacheStats | null>(null);
  const [typeAheadStats, setTypeAheadStats] = useState<TypeAheadStats | null>(null);
  const [speechStats, setSpeechStats] = useState<SpeechStats | null>(null);
  // #174: offline-queue reliability stats sourced from the telemetry module.
  // Populated on modal open and refresh alongside the other diagnostics.
  const [offlineQueueStats, setOfflineQueueStats] = useState<OfflineQueueStats | null>(null);
  // Rolling-window speech fail count (#141). Sourced from the logger error
  // ring via `logger.countByRolling` so it only reflects recent failures —
  // a stale breaker from hours ago stops dominating the signal. 60s window
  // is the common "is anything on fire right now" time scale; tune as we
  // get real telemetry from prod.
  const SPEECH_FAIL_WINDOW_MS = 60_000;
  const [speechFailLast60s, setSpeechFailLast60s] = useState(0);
  // #187: rolling 60s offline-queue warn count. Same window as the speech
  // rolling fail line — answers "is the offline queue actively burning right
  // now?" without having to interpret the session totals. The denominator
  // math for a fail-rate would be slippery (Offline warns are per-item, not
  // per-session), so we surface this as an absolute count and let the reader
  // calibrate against the session OK/Fail line right above it.
  const OFFLINE_FAIL_WINDOW_MS = 60_000;
  const [offlineFailLast60s, setOfflineFailLast60s] = useState(0);
  // #205: exchange-rate cache health snapshot. Sourced from the pure
  // `getRatesCacheState()` accessor in `currencyExchange.ts` so the dashboard
  // can distinguish "cache is fresh" from "cache is stale but throttled" from
  // "no cache at all". Refreshes on modal open + manual Refresh.
  const [ratesCacheState, setRatesCacheState] = useState<RatesCacheState | null>(null);
  const [ratesRefreshing, setRatesRefreshing] = useState(false);
  // #207: transient outcome line that renders after a Refresh Rates tap.
  // Distinguishes (a) freshly fetched, (b) cached survived but no network,
  // (c) hardcoded fallback only. Auto-clears via useAutoClearFlag so a modal
  // dismiss mid-display can't setState on a torn-down tree.
  // #214: extended from 5s to 10s. The line carries
  // `accessibilityLiveRegion="polite"` so VoiceOver announces it on render,
  // but VoiceOver users who miss the initial announcement (e.g. mid-gesture)
  // had no way to re-trigger it — the line disappeared after 5s. 10s is a
  // compromise: long enough for a second scan, short enough that it doesn't
  // linger into the next action. The steady-state cache label makes the same
  // info reachable long-term.
  const [refreshOutcome, setRefreshOutcome] = useAutoClearFlag<RefreshResult>(10000);
  // Collapsible debug sub-sections. Each defaults to collapsed; we auto-expand
  // an urgent section (open breaker, last crash) the first time the modal
  // renders so the user notices what needs attention.
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [crashSectionExpanded, setCrashSectionExpanded] = useState(false);
  // #153: local expand/collapse state for the prunedUnknownKeys list. The
  // default-collapsed view shows the first 3 key names; tapping "Show all"
  // reveals the full set so a major rollback (10+ keys) can be audited
  // without opening the crash report.
  const [prunedKeysExpanded, setPrunedKeysExpanded] = useState(false);
  const toggleDiagnostics = useCallback(() => setDiagnosticsExpanded((v) => !v), []);
  const toggleCrashSection = useCallback(() => setCrashSectionExpanded((v) => !v), []);
  const togglePrunedKeys = useCallback(() => setPrunedKeysExpanded((v) => !v), []);

  useEffect(() => {
    if (Platform.OS === "ios") {
      isAppleTranslationAvailable().then(setAppleAvailable);
    }
  }, []);

  // Refresh live translation diagnostics every time the modal is shown.
  // Circuit breaker state and cache stats are in-memory only, so we re-read
  // them on open rather than subscribing. Also auto-expands the diagnostics
  // section on open when any breaker is open so the user sees the issue.
  // Helper — count speech-tagged warn/error entries that landed in the last
  // SPEECH_FAIL_WINDOW_MS window. Returned as a single integer so the caller
  // can drop it straight into state. Uses `logger.countByRolling` (#125).
  const computeSpeechFailWindow = useCallback((): number => {
    const byTag = logger.countByRolling(
      { tags: ["Speech"], levels: ["warn", "error"] },
      () => "speech",
      SPEECH_FAIL_WINDOW_MS
    );
    return byTag.speech ?? 0;
  }, []);

  // #187: same shape as computeSpeechFailWindow, but for the new "Offline"
  // log tag (#184) so the offline-queue rolling fail surface stays in lock-
  // step with the speech rolling fail surface — both reset on the same
  // 60s window and update on the same Refresh action.
  const computeOfflineFailWindow = useCallback((): number => {
    const byTag = logger.countByRolling(
      { tags: ["Offline"], levels: ["warn", "error"] },
      () => "offline",
      OFFLINE_FAIL_WINDOW_MS
    );
    return byTag.offline ?? 0;
  }, []);

  useEffect(() => {
    if (!visible) return;
    const snapshots = getCircuitSnapshots();
    setCircuitSnapshots(snapshots);
    setCacheStats(getTranslationCacheStats());
    setTypeAheadStats(computeTypeAheadStats());
    setSpeechStats(computeSpeechStats());
    setOfflineQueueStats(getOfflineQueueStats());
    setSpeechFailLast60s(computeSpeechFailWindow());
    setOfflineFailLast60s(computeOfflineFailWindow());
    setRatesCacheState(getRatesCacheState());
    if (snapshots.some((s) => s.open)) setDiagnosticsExpanded(true);
  }, [visible, computeSpeechFailWindow, computeOfflineFailWindow]);

  const refreshDiagnostics = useCallback(() => {
    setCircuitSnapshots(getCircuitSnapshots());
    setCacheStats(getTranslationCacheStats());
    setTypeAheadStats(computeTypeAheadStats());
    setSpeechStats(computeSpeechStats());
    setOfflineQueueStats(getOfflineQueueStats());
    setSpeechFailLast60s(computeSpeechFailWindow());
    setOfflineFailLast60s(computeOfflineFailWindow());
    setRatesCacheState(getRatesCacheState());
  }, [computeSpeechFailWindow, computeOfflineFailWindow]);

  // #205: explicit user override for the 60s refetch throttle in
  // currencyExchange.ts. Pure user-intent escape hatch — production code
  // paths still call `getExchangeRates()` which respects the throttle
  // (otherwise heavy catalog scanning during an outage would hammer the
  // upstream). Failures fall through to the same fallback chain as a
  // regular fetch so the button is safe to retry.
  const handleRefreshRates = useCallback(async () => {
    if (ratesRefreshing) return;
    setRatesRefreshing(true);
    // #213: record every manual refresh attempt — denominator for the
    // manual-refresh-fail-rate metric surfaced in Translation Diagnostics.
    // Incremented before the await so a mid-flight crash still shows up
    // in the counter at next relaunch (telemetry persists across sessions).
    incrementTelemetry("rates.manualRefresh");
    try {
      const outcome = await forceRefreshExchangeRates();
      // #207: stash the outcome so the UI can render a transient success/
      // failure line distinct from the steady-state "Fresh / Stale" label.
      setRefreshOutcome(outcome);
      // #213: a RefreshResult with `ok: false` always represents a manual-
      // refresh failure (validation failure, network error, or fallthrough
      // to hardcoded rates). Tracked separately from the attempt counter so
      // the dashboard can compute a fail-rate without having to query the
      // logger ring.
      if (!outcome.ok) {
        incrementTelemetry("rates.manualRefreshFailed");
      }
    } catch (err) {
      logger.warn("Settings", "Manual exchange rate refresh failed", err);
      // An unexpected throw (not a graceful RefreshResult) is still a user-
      // visible failure — bump the counter so it's reflected in the dashboard.
      incrementTelemetry("rates.manualRefreshFailed");
      // Synthesize a failure outcome so the UI can still surface "something
      // went wrong" — getRatesCacheState() can't tell us *whether* the user
      // initiated this refresh, only what the cache looks like now.
      const fallbackState = getRatesCacheState();
      setRefreshOutcome({
        ok: false,
        reason: "network",
        ageMs: fallbackState.ageMs,
        usedFallback: !fallbackState.hasCache,
      });
    } finally {
      setRatesCacheState(getRatesCacheState());
      setRatesRefreshing(false);
      notifySuccess();
    }
  }, [ratesRefreshing, setRefreshOutcome]);

  const handleResetCircuits = useCallback(() => {
    resetCircuits();
    refreshDiagnostics();
    notifySuccess();
  }, [refreshDiagnostics]);

  const handleClearTranslationCache = useCallback(() => {
    clearTranslationCache();
    refreshDiagnostics();
    notifySuccess();
  }, [refreshDiagnostics]);

  // Zero the type-ahead counters without touching cache/circuits. Lets a user
  // start a fresh measurement window after changing providers or settings
  // without nuking the in-memory cache or circuit breaker state.
  const handleResetTelemetry = useCallback(() => {
    resetTelemetry();
    refreshDiagnostics();
    notifySuccess();
  }, [refreshDiagnostics]);

  // Per-provider eviction — dumps just one provider's cached entries so users
  // switching providers can drop stale cloud results without nuking the whole
  // cache. Uses the new clearTranslationCache(provider) overload.
  const handleClearProviderCache = useCallback(
    (provider: string) => {
      clearTranslationCache(provider as TranslationProvider);
      refreshDiagnostics();
      notifySuccess();
    },
    [refreshDiagnostics]
  );

  // Load last crash report when settings opens. The stored blob runs through
  // migrateCrashReport so reports written by older app versions (pre-
  // schemaVersion) still render instead of being silently dropped.
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem("@live_translator_last_crash")
      .then((val) => {
        if (!val) return;
        try {
          const migrated = migrateCrashReport(JSON.parse(val));
          setLastCrash(migrated);
          // A real stored crash is more important than a general debug panel —
          // auto-expand so it can't be missed behind the disclosure triangle.
          setCrashSectionExpanded(true);
        } catch (err) {
          logger.warn("Settings", "Failed to parse crash report", err);
        }
      })
      .catch((err) => logger.warn("Settings", "Failed to load crash report", err));
  }, [visible]);

  const buildCrashReport = useCallback(() => {
    if (!lastCrash) return "";
    const recentErrors = logger.getRecentErrors();
    // Prefer the version stamped on the crash record (captured at crash time);
    // fall back to the live Platform info if the crash was saved before we
    // started recording it.
    const platformLine = lastCrash.platform ?? `${Platform.OS} ${Platform.Version}`;
    const versionLine = lastCrash.appVersion
      ? `Version: ${lastCrash.appVersion}${lastCrash.buildNumber ? ` (${lastCrash.buildNumber})` : ""}`
      : "";
    // Diagnostics block is opt-in via settings.shareDiagnosticsInCrashReports
    // (#120). Default on — innocuous metadata — but users who'd rather not
    // send telemetry alongside crash stacks can flip the toggle in Settings.
    const diagnosticsLines: string[] = [];
    if (settings.shareDiagnosticsInCrashReports) {
      // Snapshot live translation diagnostics so shared reports reveal which
      // provider was down at crash-share time. Circuit state is in-memory
      // only, so this is the only place it survives into the shared bundle.
      // Skips entirely when nothing interesting is happening to keep the
      // report clean.
      const circuits = getCircuitSnapshots();
      const cache = getTranslationCacheStats();
      const telemetry = computeTypeAheadStats();
      const queuePreview = getOfflineQueueStats();
      if (
        circuits.some((c) => c.open || c.failures > 0) ||
        cache.size > 0 ||
        telemetry.total > 0 ||
        queuePreview.total > 0 ||
        queuePreview.deadLetter > 0
      ) {
        diagnosticsLines.push("\nTranslation diagnostics:");
        if (cache.size > 0) {
          diagnosticsLines.push(`  Cache: ${cache.size}/${cache.max}`);
        }
        const cacheTotal = cache.hits + cache.misses;
        if (cacheTotal > 0) {
          diagnosticsLines.push(
            `  Cache hit rate: ${Math.round((cache.hits / cacheTotal) * 100)}% (${cache.hits}/${cacheTotal})`
          );
        }
        for (const c of circuits) {
          if (c.open || c.failures > 0) {
            diagnosticsLines.push(
              `  ${c.provider}: ${c.open ? `OPEN (${Math.ceil(c.msUntilReset / 1000)}s)` : "closed"} · failures ${c.failures}`
            );
          }
        }
        if (telemetry.total > 0) {
          diagnosticsLines.push(
            `  Type-ahead: glossary=${telemetry.glossary} offHit=${telemetry.offlineHit} offMiss=${telemetry.offlineMiss} net=${telemetry.network}`
          );
        }
        // Surface telemetry prune events (#143/#147). Signals a client
        // downgrade — the persisted blob contained keys this build doesn't
        // recognize, so the hydrator dropped them. We list the actual key
        // names (#147) so the crash reader can tell "expected cleanup" from
        // "major rollback": 2 forward-compat keys is routine, 10+ is alarming.
        const prunedKeys = prunedUnknownKeys();
        if (prunedKeys.length > 0) {
          // Cap the rendered list so a pathological blob can't bloat the
          // crash report; still include the count so the reader knows the
          // full scope.
          const MAX_RENDERED = 8;
          const shown = prunedKeys.slice(0, MAX_RENDERED).join(", ");
          const suffix = prunedKeys.length > MAX_RENDERED
            ? ` (+${prunedKeys.length - MAX_RENDERED} more)`
            : "";
          diagnosticsLines.push(
            `  Telemetry: pruned ${prunedKeys.length} unknown key(s) — ${shown}${suffix}`
          );
        }
        const speech = computeSpeechStats();
        if (speech.total > 0) {
          const failPct = Math.round((speech.fail / speech.total) * 100);
          diagnosticsLines.push(
            `  Speech translate: ok=${speech.success} fail=${speech.fail} (${failPct}% fail)`
          );
        }
        // #152: routine no-speech recognition errors are counted separately
        // from translate failures so a silent-environment user and a
        // broken-mic user don't look the same in the crash report.
        if (speech.noSpeech > 0) {
          diagnosticsLines.push(`  Speech recognition: ${speech.noSpeech} no-speech event(s)`);
        }
        // #181: dedicated permission-denied line so a crash reader can tell
        // a "user revoked the mic mid-session" incident from a translate
        // failure burst. The recovery flow is completely different (deep-
        // link to Settings vs. provider switch / retry) and the diagnostic
        // reader needs to know which one to recommend.
        if (speech.permissionDenied > 0) {
          diagnosticsLines.push(
            `  Speech permission denied: ${speech.permissionDenied} event(s)`
          );
        }
        // #156: when the session has only no-speech events and no successful
        // translations, strongly suggest a muted mic / quiet environment so
        // the crash reader can escalate past "just a flaky session".
        if (isLikelyMicMuted(speech)) {
          diagnosticsLines.push(`  ⚠ Mic may be muted or environment too quiet (no successful recognitions)`);
        }
        // Rolling 60s speech fail count (#141) via logger.countByRolling —
        // gives the person reading the report a "right now" signal that the
        // session total can't: a 500-fail session number is ambiguous without
        // knowing if it stopped an hour ago or is actively burning.
        const speechFailRolling = logger.countByRolling(
          { tags: ["Speech"], levels: ["warn", "error"] },
          () => "speech",
          60_000
        ).speech ?? 0;
        if (speechFailRolling > 0) {
          diagnosticsLines.push(
            `  Speech translate (last 60s): ${speechFailRolling} fail${speechFailRolling === 1 ? "" : "s"}`
          );
        }
        // #174: offline-queue reliability — surface session-scoped queue
        // health so a shared crash report reveals whether the crash might be
        // related to a degraded offline drain path (dead-letters, high fail
        // rate). Silent when there's no queue traffic so quiet sessions
        // don't pad the report.
        const queue = getOfflineQueueStats();
        if (queue.total > 0 || queue.deadLetter > 0) {
          const failPct = queue.total > 0 ? Math.round(queue.failRate * 100) : 0;
          diagnosticsLines.push(
            `  Offline queue: ok=${queue.success} fail=${queue.failed} (${failPct}% fail of ${queue.total})`
          );
          if (queue.deadLetter > 0) {
            diagnosticsLines.push(`  Offline queue dead-lettered: ${queue.deadLetter}`);
          }
        }
        // #187: rolling 60s Offline-tag warn count, paired with the speech
        // rolling fail line above. Crash readers see "session: 200 fail" and
        // can't tell if the burn happened five minutes ago or right now —
        // the rolling window resolves that without forcing a tag drilldown.
        const offlineWarnRolling = logger.countByRolling(
          { tags: ["Offline"], levels: ["warn", "error"] },
          () => "offline",
          60_000
        ).offline ?? 0;
        if (offlineWarnRolling > 0) {
          // Append session-OK denominator (#191) so the absolute count has a
          // calibration anchor — "3 warns / session OK 47" reads very
          // differently from "3 warns / session OK 0".
          const sessionContext =
            queue.success > 0 ? ` (session OK ${queue.success})` : "";
          diagnosticsLines.push(
            `  Offline queue (last 60s): ${offlineWarnRolling} warn${offlineWarnRolling === 1 ? "" : "s"}${sessionContext}`
          );
        }
        // #205: exchange-rate cache state — distinguishes "cache fresh"
        // from "stale + throttled" from "no cache, falling through to
        // hardcoded fallback". Especially useful for crash reports filed
        // during heavy catalog scanning (e.g. crew flipping through duty-
        // free brochures) where a stale FX cache could explain weird
        // converted-price displays in the bug report.
        const rates = getRatesCacheState();
        if (rates.hasCache || rates.lastAttemptAgeMs !== null) {
          diagnosticsLines.push(`  Exchange rates: ${ratesStateLabel(rates)}`);
        }
        // #213: manual refresh counters — how often the user hit the
        // "Refresh Rates" override and how often it failed. A spike here
        // usually correlates with an upstream outage and explains why the
        // user is staring at stale rates in the crash report. Silent when
        // there are no attempts so a quiet session doesn't pad the report.
        const telemetrySnapshot = getTelemetrySnapshot();
        const manualRefresh = telemetrySnapshot["rates.manualRefresh"];
        const manualRefreshFailed = telemetrySnapshot["rates.manualRefreshFailed"];
        if (manualRefresh > 0) {
          const pct =
            manualRefresh > 0 ? Math.round((manualRefreshFailed / manualRefresh) * 100) : 0;
          diagnosticsLines.push(
            `  Manual rate refresh: ${manualRefresh} attempt${manualRefresh === 1 ? "" : "s"}, ${manualRefreshFailed} failed (${pct}%)`
          );
        }
        // Errors-by-tag breakdown via logger.countBy (#119). Gives the person
        // reading the report a quick "which subsystem is on fire?" view
        // without having to scan every recent-errors line individually.
        const errorsByTag = logger.countBy({ levels: ["warn", "error"] }, (e) => e.tag);
        const tagEntries = Object.entries(errorsByTag).filter(([, n]) => n > 0);
        if (tagEntries.length > 0) {
          tagEntries.sort((a, b) => b[1] - a[1]);
          diagnosticsLines.push(`  Errors by tag: ${tagEntries.map(([t, n]) => `${t}=${n}`).join(", ")}`);
        }
      }
    } else {
      diagnosticsLines.push("\n(Diagnostics redacted — user opted out)");
    }
    return [
      `Live Translator crash report`,
      versionLine,
      `Platform: ${platformLine}`,
      `Crash: ${lastCrash.message}`,
      `Time: ${new Date(lastCrash.timestamp).toLocaleString()}`,
      lastCrash.stack ? `Stack: ${lastCrash.stack}` : "",
      ...diagnosticsLines,
      recentErrors.length > 0 ? `\nRecent errors (${recentErrors.length}):` : "",
      ...recentErrors.slice(-10).map((e) => `  [${e.tag}] ${e.message}`),
    ].filter(Boolean).join("\n");
  }, [lastCrash, settings.shareDiagnosticsInCrashReports]);

  const copyCrashReport = useCallback(async () => {
    if (!lastCrash) return;
    try {
      // #155: crash report is unambiguously debug/metadata — users often paste
      // it into a bug tracker or email minutes later, so the 60s auto-clear
      // from `copyWithAutoClear` would be hostile here. `copyWithoutAutoClear`
      // also cancels any pending user-content auto-clear timer so the report
      // isn't wiped mid-paste by a prior translation copy.
      await copyWithoutAutoClear(buildCrashReport());
      notifySuccess();
      setCrashCopied(true);
    } catch (err) {
      logger.warn("Settings", "Copy crash report failed", err instanceof Error ? err.message : String(err));
    }
  }, [lastCrash, buildCrashReport]);

  const shareCrashReport = useCallback(async () => {
    if (!lastCrash) return;
    try {
      await Share.share({
        message: buildCrashReport(),
        title: "Live Translator crash report",
      });
    } catch (err) {
      logger.warn("Settings", "Share crash report failed", err instanceof Error ? err.message : String(err));
    }
  }, [lastCrash, buildCrashReport]);

  const clearCrashReport = useCallback(async () => {
    try {
      await AsyncStorage.removeItem("@live_translator_last_crash");
      logger.clearRecentErrors();
      setLastCrash(null);
    } catch (err) {
      logger.warn("Settings", "Clear crash report failed", err instanceof Error ? err.message : String(err));
    }
  }, []);

  const toggle = (key: keyof Settings) => {
    onUpdate({ ...settings, [key]: !settings[key] });
  };

  const dynamicStyles = useMemo(() => ({
    overlay: { backgroundColor: colors.overlayBg },
    content: { backgroundColor: colors.modalBg },
    title: { color: colors.titleText },
    rowTitle: { color: colors.primaryText },
    rowSubtitle: { color: colors.dimText },
    rowBorder: { borderBottomColor: colors.borderLight },
    switchTrack: { false: colors.border, true: colors.primary },
    sliderMax: colors.border,
    // fontSizeOption and fontSizeLabel now handled by OptionPicker
    infoTitle: { color: colors.mutedText },
    infoText: { color: colors.dimText },
    closeButton: { borderTopColor: colors.borderLight },
    closeText: { color: colors.primary },
    // themeOption and themeLabel now handled by OptionPicker
  }), [colors]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View accessibilityViewIsModal={true} style={[styles.overlay, dynamicStyles.overlay]}>
        <View style={[styles.content, dynamicStyles.content]}>
          <Text style={[styles.title, dynamicStyles.title]}>Settings</Text>

          <ScrollView style={styles.list}>
            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Theme</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>App color scheme</Text>
              </View>
            </View>
            <OptionPicker
              options={["dark", "light"] as ThemeMode[]}
              selected={settings.theme}
              onSelect={(value) => onUpdate({ ...settings, theme: value })}
              labelFn={(v) => v === "dark" ? "Dark" : "Light"}
              accessibilityPrefix="Theme"
              colors={colors}
            />

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Haptic Feedback</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Vibration on button presses</Text>
              </View>
              <Switch
                value={settings.hapticsEnabled}
                onValueChange={() => toggle("hapticsEnabled")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle haptic feedback"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Auto-Play Translation</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Speak translations automatically</Text>
              </View>
              <Switch
                value={settings.autoPlayTTS}
                onValueChange={() => toggle("autoPlayTTS")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle auto-play translation speech"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Auto-Scroll</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Scroll to latest translation automatically</Text>
              </View>
              <Switch
                value={settings.autoScroll}
                onValueChange={() => toggle("autoScroll")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle auto-scroll"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Romanization</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Show Pinyin, Romaji, etc. for non-Latin scripts</Text>
              </View>
              <Switch
                value={settings.showRomanization}
                onValueChange={() => toggle("showRomanization")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle romanization display"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Offline Speech</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Use on-device recognition (no internet needed)</Text>
              </View>
              <Switch
                value={settings.offlineSpeech}
                onValueChange={() => toggle("offlineSpeech")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle offline speech recognition"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Diagnostics in Crash Reports</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Include cache and circuit breaker info when sharing crashes</Text>
              </View>
              <Switch
                value={settings.shareDiagnosticsInCrashReports}
                onValueChange={() => toggle("shareDiagnosticsInCrashReports")}
                trackColor={dynamicStyles.switchTrack}
                thumbColor={colors.destructiveText}
                accessibilityLabel="Toggle diagnostics in shared crash reports"
                accessibilityHint="When off, shared crash reports will not include translation diagnostics"
              />
            </View>

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Auto-Stop After Silence</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Stop listening after silence (0 = manual stop)</Text>
              </View>
            </View>
            <OptionPicker
              options={[0, 3, 5, 10] as SilenceTimeoutOption[]}
              selected={settings.silenceTimeout}
              onSelect={(value) => onUpdate({ ...settings, silenceTimeout: value })}
              labelFn={(v) => v === 0 ? "Off" : `${v}s`}
              accessibilityPrefix="Auto-stop after silence"
              colors={colors}
            />

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Confidence Warning</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Warn when translation quality is below threshold</Text>
              </View>
            </View>
            <OptionPicker
              options={[0, 50, 70, 85] as ConfidenceThreshold[]}
              selected={settings.confidenceThreshold}
              onSelect={(value) => onUpdate({ ...settings, confidenceThreshold: value })}
              labelFn={(v) => v === 0 ? "Off" : `${v}%`}
              accessibilityPrefix="Confidence warning threshold"
              colors={colors}
            />

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Speech Speed</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>
                  {settings.speechRate <= 0.6 ? "Very Slow" : settings.speechRate <= 0.8 ? "Slow" : settings.speechRate <= 1.1 ? "Normal" : settings.speechRate <= 1.5 ? "Fast" : "Very Fast"} ({settings.speechRate.toFixed(1)}x)
                </Text>
              </View>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0.5}
              maximumValue={2.0}
              step={0.1}
              value={settings.speechRate}
              onSlidingComplete={(value) => onUpdate({ ...settings, speechRate: Math.round(value * 10) / 10 })}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={dynamicStyles.sliderMax}
              thumbTintColor={colors.destructiveText}
              accessibilityLabel={`Speech speed: ${settings.speechRate.toFixed(1)}x`}
            />

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Text Size</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Adjust translation bubble font size</Text>
              </View>
            </View>
            <OptionPicker
              options={["small", "medium", "large", "xlarge"] as FontSizeOption[]}
              selected={settings.fontSize}
              onSelect={(value) => onUpdate({ ...settings, fontSize: value })}
              labelFn={(v) => v === "small" ? "S" : v === "medium" ? "M" : v === "large" ? "L" : "XL"}
              accessibilityPrefix="Text size"
              colors={colors}
            />

            <View style={[styles.row, dynamicStyles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, dynamicStyles.rowTitle]}>Translation Provider</Text>
                <Text style={[styles.rowSubtitle, dynamicStyles.rowSubtitle]}>Choose your translation engine</Text>
              </View>
            </View>

            <OptionPicker
              options={(appleAvailable ? ["apple", "mlkit", "mymemory"] : ["mlkit", "mymemory"]) as TranslationProvider[]}
              selected={settings.translationProvider}
              onSelect={(value) => onUpdate({ ...settings, translationProvider: value })}
              labelFn={(v) => v === "apple" ? "Apple" : v === "mlkit" ? "ML Kit" : "Cloud"}
              accessibilityPrefix="Translation provider"
              colors={colors}
            />
            {settings.translationProvider === "apple" && (
              <Text style={[styles.providerHint, { color: colors.dimText }]}>
                Apple Neural Engine — fast, private translation. No data leaves your device.
              </Text>
            )}
            {settings.translationProvider === "mlkit" && (
              <Text style={[styles.providerHint, { color: colors.dimText }]}>
                Google ML Kit runs on-device. Language models (~30MB each) download on first use.
              </Text>
            )}
            {settings.translationProvider === "mymemory" && (
              <Text style={[styles.providerHint, { color: colors.dimText }]}>
                MyMemory cloud API — free, requires internet. Used as fallback when on-device fails.
              </Text>
            )}

            {/* Offline feature indicator */}
            <View style={styles.infoSection}>
              <Text style={[styles.infoTitle, dynamicStyles.infoTitle]}>Offline Capabilities</Text>
              <Text style={[styles.infoText, dynamicStyles.infoText]}>
                Features that work without internet:
              </Text>
              <View style={styles.offlineList}>
                <OfflineFeatureRow label="Speech Recognition" available={settings.offlineSpeech} hint={settings.offlineSpeech ? "On-device" : "Enable Offline Speech above"} colors={colors} />
                <OfflineFeatureRow label="Translation (Apple)" available={settings.translationProvider === "apple"} hint={settings.translationProvider === "apple" ? "Neural Engine" : "Select Apple provider"} colors={colors} />
                <OfflineFeatureRow label="Translation (ML Kit)" available={settings.translationProvider === "mlkit"} hint={settings.translationProvider === "mlkit" ? "On-device models" : "Select ML Kit provider"} colors={colors} />
                <OfflineFeatureRow label="Phrasebook" available hint="120+ phrases in 10 languages" colors={colors} />
                <OfflineFeatureRow label="Glossary Lookup" available hint="Your custom translations" colors={colors} />
                <OfflineFeatureRow label="Camera OCR" available hint="ML Kit text recognition" colors={colors} />
                <OfflineFeatureRow label="Text-to-Speech" available hint="System voices" colors={colors} />
                <OfflineFeatureRow label="Translation History" available hint="Stored locally" colors={colors} />
                <OfflineFeatureRow label="Cloud Translation" available={false} hint="Requires internet" colors={colors} />
                <OfflineFeatureRow label="Translation Comparison" available={false} hint="Multi-provider, requires internet" colors={colors} />
                <OfflineFeatureRow label="Word Alternatives" available={false} hint="MyMemory API lookup" colors={colors} />
              </View>
            </View>

            <View style={styles.infoSection}>
              <Text style={[styles.infoTitle, dynamicStyles.infoTitle]}>About</Text>
              <Text style={[styles.infoText, dynamicStyles.infoText]}>Live Translator v1.0.0</Text>
              <Text style={[styles.infoText, dynamicStyles.infoText]}>
                Translation powered by {
                  settings.translationProvider === "apple" ? "Apple Neural Engine (on-device)" :
                  settings.translationProvider === "mlkit" ? "Google ML Kit (on-device)" :
                  "MyMemory API (cloud)"
                }
              </Text>
            </View>

            {/* Translation diagnostics — circuit breakers + cache stats.
                #205: also opens when there's exchange-rate cache state to
                show, so a user troubleshooting stale prices can find the
                Refresh Rates button without any other diagnostics traffic. */}
            {(circuitSnapshots.length > 0 || (cacheStats && cacheStats.size > 0) || (ratesCacheState && (ratesCacheState.hasCache || ratesCacheState.lastAttemptAgeMs !== null))) && (
              <View style={styles.infoSection}>
                <CollapsibleSection
                  title="Translation Diagnostics"
                  expanded={diagnosticsExpanded}
                  onToggle={toggleDiagnostics}
                  urgent={circuitSnapshots.some((s) => s.open)}
                  colors={colors}
                >
                  {cacheStats && (
                    <>
                      <Text style={[styles.infoText, dynamicStyles.infoText]}>
                        Cache: {cacheStats.size}/{cacheStats.max}
                      </Text>
                      {(cacheStats.hits + cacheStats.misses) > 0 && (
                        <Text style={[styles.infoText, dynamicStyles.infoText]}>
                          Hit rate: {Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100)}% ({cacheStats.hits}/{cacheStats.hits + cacheStats.misses})
                        </Text>
                      )}
                      {Object.entries(cacheStats.byProvider).map(([provider, count]) => (
                        <View key={provider} style={styles.cacheProviderRow}>
                          <Text style={[styles.infoText, dynamicStyles.infoText, styles.cacheProviderLabel]}>
                            {provider}: {count}
                          </Text>
                          <TouchableOpacity
                            style={[styles.cacheProviderClear, { backgroundColor: colors.cardBg }]}
                            onPress={() => handleClearProviderCache(provider)}
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
                  {/* Telemetry prune notice (#143/#147) — visible when the
                      last `initTelemetry()` dropped unknown keys from the
                      persisted blob. Typically indicates a client downgrade
                      from a newer build; surfacing it lets us catch rollouts
                      that accidentally removed a counter key. #147 lists the
                      actual key names so the user can tell routine cleanup
                      from a major rollback. */}
                  {(() => {
                    const pruned = prunedUnknownKeys();
                    if (pruned.length === 0) return null;
                    const MAX_RENDERED = 3;
                    const hasMore = pruned.length > MAX_RENDERED;
                    const visible = prunedKeysExpanded ? pruned : pruned.slice(0, MAX_RENDERED);
                    const shown = visible.join(", ");
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
                            onPress={togglePrunedKeys}
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
                  {/* Type-ahead telemetry — glossary/offline/network hit breakdown so
                      we can measure how often the offline short-circuit saves API
                      quota vs. hitting the network. Session-scoped (cleared when the
                      process dies). Sourced from the prod-safe telemetry module so
                      the numbers are meaningful in release builds too (#118). */}
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
                  {/* Speech translation reliability — counts DualStream speech
                      translate successes/failures so systematically-failing mic
                      paths are visible in diagnostics + crash reports even
                      though speech errors are silent to the user (#132). */}
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
                      {/* #152: `no-speech` is a recognition-level event
                          (silent mic, quiet environment), not a translate
                          failure. Surfaced as a separate line so a user who
                          speaks fluently but never gets recognized doesn't
                          hide behind an otherwise-healthy translate rate. */}
                      {speechStats.noSpeech > 0 && (
                        <Text
                          style={[styles.infoText, dynamicStyles.infoText]}
                          accessibilityLabel={`${speechStats.noSpeech} no-speech events this session`}
                        >
                          No-speech events: {speechStats.noSpeech}
                        </Text>
                      )}
                      {/* #181: OS-level mic-permission denials. Counter is
                          incremented by `useSpeechRecognition`'s `not-allowed`
                          branch (#180). Surfaced as its own line — and tinted
                          errorText — because the recovery flow is "Open
                          Settings", not "retry / switch provider", so it
                          deserves to stand out from translate failures and
                          no-speech bursts. The errorsByTag block already
                          captures the same event at the tag level via the
                          `Speech` warn, but a dedicated counter line gives
                          the dashboard a numeric signal without forcing the
                          user to mentally reverse-engineer the tag total. */}
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
                      {/* #156: mic-muted / quiet-environment hint. Only fires
                          when `noSpeech` has accumulated past the threshold
                          AND no successful recognitions have landed, so a
                          genuinely silent room doesn't nag users who just
                          haven't spoken yet. Rendered with errorText color +
                          accessibilityLiveRegion so VoiceOver users hear the
                          hint when refreshing diagnostics. */}
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
                      {/* Rolling 60s fail count (#141) — answers "is it on
                          fire right now" without having to squint at the
                          session total. Session counter keeps growing even
                          after the outage clears, so a 60s rolling window is
                          the honest "current health" signal. */}
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
                  {/* #205: exchange-rate cache health line. Renders when
                      there's been any traffic or an existing cache, with
                      distinct labels for fresh / stale / throttled / no-cache.
                      Tinted dimText for healthy state, errorText when stale
                      AND throttled (i.e. we want fresh rates but the throttle
                      is blocking the next attempt — tap Refresh Rates to
                      force a fetch). */}
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
                      {/* #207: transient outcome line for the most recent
                          Refresh Rates tap. Auto-clears after 10s (#214) via
                          the useAutoClearFlag hook so the steady-state cache
                          label stays the source of truth. accessibilityLiveRegion
                          announces the result to VoiceOver users immediately. */}
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
                      {/* #213: manual refresh counter — cumulative across the
                          session so a user who hit Refresh Rates multiple
                          times can see how often each attempt is working.
                          Red-tinted when the fail rate is >=25% (mirrors the
                          speech/offline fail-rate conventions). */}
                      {typeAheadStats /* reuse render gate — stats block is present */ && (() => {
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
                    </View>
                  )}
                  {/* #174: offline-queue reliability block. Silent when no
                      queue traffic has resolved this session, otherwise shows
                      OK / fail counts, fail-rate (red at >=25%), and a
                      dead-letter line when items have been permanently
                      dropped. Lets a user who wonders "did my typed-while-
                      offline translations actually land" get a straight
                      answer without reading logs. */}
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
                      {/* #187: rolling 60s offline-tag warn count. Counterpart
                          to the speech "Last 60s" line — the session totals
                          above keep growing after an outage clears, so the
                          rolling count is the honest "is it on fire right
                          now" signal. Absolute count rather than a fail rate
                          because Offline warns are per-item and the
                          denominator over a 60s window is meaningless. */}
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
                      onPress={refreshDiagnostics}
                      accessibilityRole="button"
                      accessibilityLabel="Refresh translation diagnostics"
                    >
                      <Text style={[styles.crashActionText, { color: colors.primary }]}>Refresh</Text>
                    </TouchableOpacity>
                    {/* #205: explicit user override for the 60s refetch
                        throttle. Only renders when the cache is stale or
                        absent — refreshing a fresh cache is wasteful and
                        the button would be misleading. Disabled while a
                        manual refresh is in flight to prevent rapid taps
                        from triggering parallel fetches. */}
                    {ratesCacheState && (!ratesCacheState.hasCache || !ratesCacheState.isFresh) && (
                      <TouchableOpacity
                        style={[
                          styles.crashActionButton,
                          { backgroundColor: colors.cardBg, opacity: ratesRefreshing ? 0.5 : 1 },
                        ]}
                        onPress={handleRefreshRates}
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
                        onPress={handleResetCircuits}
                        accessibilityRole="button"
                        accessibilityLabel="Reset translation circuit breakers"
                      >
                        <Text style={[styles.crashActionText, { color: colors.primary }]}>Reset Circuits</Text>
                      </TouchableOpacity>
                    )}
                    {cacheStats && cacheStats.size > 0 && (
                      <TouchableOpacity
                        style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                        onPress={handleClearTranslationCache}
                        accessibilityRole="button"
                        accessibilityLabel="Clear translation cache"
                      >
                        <Text style={[styles.crashActionText, { color: colors.dimText }]}>Clear Cache</Text>
                      </TouchableOpacity>
                    )}
                    {typeAheadStats && typeAheadStats.total > 0 && (
                      <TouchableOpacity
                        style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                        onPress={handleResetTelemetry}
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
            )}

            {/* Debug / crash report section — collapsible */}
            {(lastCrash || logger.getRecentErrors().length > 0) && (
              <View style={styles.infoSection}>
                <CollapsibleSection
                  title="Debug"
                  expanded={crashSectionExpanded}
                  onToggle={toggleCrashSection}
                  urgent={!!lastCrash}
                  colors={colors}
                >
                  {lastCrash && (
                    <View style={[styles.crashCard, { backgroundColor: colors.errorBg, borderColor: colors.errorBorder }]}>
                      <Text style={[styles.crashTitle, { color: colors.errorText }]}>Last Crash</Text>
                      <Text style={[styles.crashMessage, { color: colors.errorText }]} numberOfLines={3}>
                        {lastCrash.message}
                      </Text>
                      <Text style={[styles.crashTime, { color: colors.dimText }]}>
                        {new Date(lastCrash.timestamp).toLocaleString()}
                      </Text>
                    </View>
                  )}
                  {logger.getRecentErrors().length > 0 && (
                    <Text style={[styles.infoText, dynamicStyles.infoText]}>
                      {logger.getRecentErrors().length} recent error{logger.getRecentErrors().length === 1 ? "" : "s"} logged
                    </Text>
                  )}
                  <View style={styles.crashActions}>
                    <TouchableOpacity
                      style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                      onPress={copyCrashReport}
                      accessibilityRole="button"
                      accessibilityLabel="Copy crash report to clipboard"
                    >
                      <Text style={[styles.crashActionText, { color: colors.primary }]}>
                        {crashCopied ? "Copied!" : "Copy"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                      onPress={shareCrashReport}
                      accessibilityRole="button"
                      accessibilityLabel="Share crash report via system share sheet"
                      accessibilityHint="Opens the share sheet to send the crash report to another app"
                    >
                      <Text style={[styles.crashActionText, { color: colors.primary }]}>Share</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.crashActionButton, { backgroundColor: colors.cardBg }]}
                      onPress={clearCrashReport}
                      accessibilityRole="button"
                      accessibilityLabel="Clear crash report"
                    >
                      <Text style={[styles.crashActionText, { color: colors.dimText }]}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                </CollapsibleSection>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.closeButton, dynamicStyles.closeButton]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close settings"
          >
            <Text style={[styles.closeText, dynamicStyles.closeText]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Reusable option picker row — eliminates 5 repeated patterns in settings
function OptionPicker<T extends string | number>({
  options,
  selected,
  onSelect,
  labelFn,
  accessibilityPrefix,
  colors,
}: {
  options: T[];
  selected: T;
  onSelect: (value: T) => void;
  labelFn: (value: T) => string;
  accessibilityPrefix: string;
  colors: ReturnType<typeof getColors>;
}) {
  return (
    <View style={styles.fontSizeRow}>
      {options.map((option) => (
        <TouchableOpacity
          key={String(option)}
          style={[
            styles.fontSizeOption,
            { backgroundColor: colors.cardBg },
            selected === option && { backgroundColor: colors.primary },
          ]}
          onPress={() => onSelect(option)}
          accessibilityRole="button"
          accessibilityLabel={`${accessibilityPrefix}: ${labelFn(option)}`}
          accessibilityState={{ selected: selected === option }}
        >
          <Text
            style={[
              styles.fontSizeLabel,
              { color: colors.mutedText },
              selected === option && { color: colors.destructiveText },
            ]}
          >
            {labelFn(option)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function OfflineFeatureRow({ label, available, hint, colors }: { label: string; available: boolean; hint: string; colors: ReturnType<typeof getColors> }) {
  return (
    <View style={offlineStyles.row}>
      <Text style={[offlineStyles.indicator, { color: available ? "#4ade80" : colors.dimText }]}>
        {available ? "●" : "○"}
      </Text>
      <View style={offlineStyles.textCol}>
        <Text style={[offlineStyles.label, { color: colors.primaryText }]}>{label}</Text>
        <Text style={[offlineStyles.hint, { color: colors.dimText }]}>{hint}</Text>
      </View>
    </View>
  );
}

const offlineStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  indicator: { fontSize: 12, width: 16, textAlign: "center" },
  textCol: { flex: 1 },
  label: { fontSize: 14, fontWeight: "500" },
  hint: { fontSize: 11, marginTop: 1 },
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "70%",
    paddingTop: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },
  list: {
    paddingHorizontal: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  rowText: {
    flex: 1,
    marginRight: 16,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  rowSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  slider: {
    width: "100%",
    height: 40,
    marginBottom: 8,
  },
  infoSection: {
    paddingTop: 24,
    paddingBottom: 12,
  },
  infoTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  telemetryBlock: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(127,127,127,0.3)",
  },
  telemetryTitle: {
    fontWeight: "600",
  },
  cacheProviderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  cacheProviderLabel: {
    marginBottom: 0,
    flex: 1,
  },
  cacheProviderClear: {
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginLeft: 8,
  },
  cacheProviderClearText: {
    fontSize: 12,
    fontWeight: "600",
  },
  infoText: {
    fontSize: 14,
    marginBottom: 4,
  },
  fontSizeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },
  fontSizeOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  fontSizeOptionActive: {
    // backgroundColor set via inline style with colors.primary
  },
  fontSizeLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  fontSizeLabelActive: {
    // color set via inline style with colors.destructiveText
  },
  providerHint: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  crashCard: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  crashTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
  },
  crashMessage: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  crashTime: {
    fontSize: 11,
  },
  crashActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  crashActionButton: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  crashActionText: {
    fontSize: 13,
    fontWeight: "600",
  },
  offlineList: {
    marginTop: 8,
    gap: 2,
  },
  closeButton: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
  },
  closeText: {
    fontSize: 17,
    fontWeight: "600",
  },
});

export default React.memo(SettingsModal);
