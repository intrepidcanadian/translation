/**
 * Pure crash report builder — assembles a plain-text report from the current
 * crash record, diagnostics snapshots, and recent logger entries. Extracted
 * from SettingsModal (#224) so the 236-line formatting logic is independently
 * testable and doesn't bloat the component.
 *
 * All data is fetched from in-memory service accessors at call time, so the
 * report always reflects the live state at the moment it's built.
 */
import { Platform } from "react-native";
import {
  getCircuitSnapshots,
  getTranslationCacheStats,
} from "../services/translation";
import { logger } from "../services/logger";
import {
  getAll as getTelemetrySnapshot,
  prunedUnknownKeys,
  getOfflineQueueStats,
  getRatesServedStats,
} from "../services/telemetry";
import {
  getRatesCacheState,
  getRatesFreshnessGrade,
} from "../services/currencyExchange";
import { ratesLineForCrashReport } from "./ratesFreshnessDisplay";
import { isLikelyMicMuted as isLikelyMicMutedPure } from "./micMuted";
import type { CrashReport } from "../types/crashReport";

function formatRelativeMs(ms: number | null): string {
  if (ms === null) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

function formatCountdownMs(ms: number | null): string {
  if (ms === null || ms <= 0) return "";
  const sec = Math.max(1, Math.ceil(ms / 1000));
  return `${sec}s`;
}

function ratesStateLabel(s: { hasCache: boolean; isFresh: boolean; ageMs: number | null; willThrottleNextFetch: boolean; lastAttemptAgeMs: number | null; nextRefetchInMs: number | null }): string {
  if (!s.hasCache) {
    return s.lastAttemptAgeMs !== null
      ? `No cache · last attempt ${formatRelativeMs(s.lastAttemptAgeMs)} (using fallback)`
      : `No cache yet`;
  }
  if (s.isFresh) {
    return `Fresh · ${formatRelativeMs(s.ageMs)}`;
  }
  if (s.willThrottleNextFetch) {
    const countdown = formatCountdownMs(s.nextRefetchInMs);
    return countdown
      ? `Stale · ${formatRelativeMs(s.ageMs)} · refresh in ${countdown}`
      : `Stale · ${formatRelativeMs(s.ageMs)} · refresh throttled`;
  }
  return `Stale · ${formatRelativeMs(s.ageMs)} · will refetch`;
}

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

function isLikelyMicMuted(stats: SpeechStats): boolean {
  return isLikelyMicMutedPure(stats.noSpeech, stats.total);
}

export function buildCrashReport(
  crash: CrashReport,
  shareDiagnostics: boolean,
): string {
  const recentErrors = logger.getRecentErrors();
  const platformLine = crash.platform ?? `${Platform.OS} ${Platform.Version}`;
  const versionLine = crash.appVersion
    ? `Version: ${crash.appVersion}${crash.buildNumber ? ` (${crash.buildNumber})` : ""}`
    : "";

  const diagnosticsLines: string[] = [];
  if (shareDiagnostics) {
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
      const prunedKeys = prunedUnknownKeys();
      if (prunedKeys.length > 0) {
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
      if (speech.noSpeech > 0) {
        diagnosticsLines.push(`  Speech recognition: ${speech.noSpeech} no-speech event(s)`);
      }
      if (speech.permissionDenied > 0) {
        diagnosticsLines.push(
          `  Speech permission denied: ${speech.permissionDenied} event(s)`
        );
      }
      if (isLikelyMicMuted(speech)) {
        diagnosticsLines.push(`  ⚠ Mic may be muted or environment too quiet (no successful recognitions)`);
      }
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
      const offlineWarnRolling = logger.countByRolling(
        { tags: ["Offline"], levels: ["warn", "error"] },
        () => "offline",
        60_000
      ).offline ?? 0;
      if (offlineWarnRolling > 0) {
        const sessionContext =
          queue.success > 0 ? ` (session OK ${queue.success})` : "";
        diagnosticsLines.push(
          `  Offline queue (last 60s): ${offlineWarnRolling} warn${offlineWarnRolling === 1 ? "" : "s"}${sessionContext}`
        );
      }
      const rates = getRatesCacheState();
      if (rates.hasCache || rates.lastAttemptAgeMs !== null) {
        const grade = getRatesFreshnessGrade(rates);
        diagnosticsLines.push(`  ${ratesLineForCrashReport(ratesStateLabel(rates), grade)}`);
      }
      const ratesServed = getRatesServedStats();
      if (ratesServed.staleServed > 0) {
        diagnosticsLines.push(
          `  Rates served stale: ${ratesServed.staleServed} time${ratesServed.staleServed === 1 ? "" : "s"} (cache past TTL)`
        );
      }
      if (ratesServed.fallbackServed > 0) {
        diagnosticsLines.push(
          `  Rates served from built-in fallback: ${ratesServed.fallbackServed} time${ratesServed.fallbackServed === 1 ? "" : "s"} (no cache available)`
        );
      }
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
      const validationFailed = telemetrySnapshot["rates.validationFailed"];
      if (validationFailed > 0) {
        diagnosticsLines.push(
          `  Rate payload rejected: ${validationFailed} time${validationFailed === 1 ? "" : "s"} (API returned invalid data)`
        );
      }
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
    `Crash: ${crash.message}`,
    `Time: ${new Date(crash.timestamp).toLocaleString()}`,
    crash.stack ? `Stack: ${crash.stack}` : "",
    ...diagnosticsLines,
    recentErrors.length > 0 ? `\nRecent errors (${recentErrors.length}):` : "",
    ...recentErrors.slice(-10).map((e) => `  [${e.tag}] ${e.message}`),
  ].filter(Boolean).join("\n");
}
