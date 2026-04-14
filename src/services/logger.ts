/**
 * Structured logging service for categorized error tracking.
 * Replaces scattered console.warn/error calls with tagged, leveled logs.
 * Ready for future integration with Sentry, Crashlytics, or similar.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogTag =
  | "Translation"
  | "OCR"
  | "Speech"
  | "Storage"
  | "Network"
  | "Camera"
  | "Product"
  | "Notes"
  | "Widget"
  | "Glossary"
  | "Listing"
  | "Location"
  | "Settings"
  | "Render"
  | "Scanner"
  | "History";

export interface LogEntry {
  level: LogLevel;
  tag: LogTag;
  message: string;
  error?: unknown;
  timestamp: number;
}

export interface LogQuery {
  tags?: readonly LogTag[];
  levels?: readonly LogLevel[];
  /** Only entries at or after this epoch ms */
  since?: number;
}

const DEFAULT_BUFFER_SIZE = 50;
// Debug entries live in their own bounded ring so they don't crowd out actual
// error reports, and so that production builds can skip the allocation
// entirely. Sized generously because telemetry dashboards (#113) want a
// meaningful sample of recent events, not just the last handful.
const DEFAULT_DEBUG_BUFFER_SIZE = 200;

let bufferSize = DEFAULT_BUFFER_SIZE;
let debugBufferSize = DEFAULT_DEBUG_BUFFER_SIZE;
const recentErrors: LogEntry[] = [];
const recentDebug: LogEntry[] = [];

function log(level: LogLevel, tag: LogTag, message: string, error?: unknown) {
  const entry: LogEntry = { level, tag, message, error, timestamp: Date.now() };

  if (level === "warn" || level === "error") {
    recentErrors.push(entry);
    // Use while rather than a single shift so that if bufferSize is lowered at
    // runtime (tuning via configureBufferSize) excess entries drain in one go.
    while (recentErrors.length > bufferSize) recentErrors.shift();
  } else if (level === "debug" && __DEV__) {
    // Debug ring is dev-only — production builds skip this allocation
    // entirely and logger.query({ levels: ["debug"] }) returns empty. That's
    // the intended behavior: the dashboard is a dev aid, not a prod feature,
    // and we avoid burning memory on events end users won't see.
    recentDebug.push(entry);
    while (recentDebug.length > debugBufferSize) recentDebug.shift();
  }

  const prefix = `[${tag}]`;
  switch (level) {
    case "debug":
      if (__DEV__) console.debug(prefix, message, error ?? "");
      break;
    case "info":
      console.info(prefix, message);
      break;
    case "warn":
      console.warn(prefix, message, error ?? "");
      break;
    case "error":
      console.error(prefix, message, error ?? "");
      break;
  }
}

function matches(entry: LogEntry, query: LogQuery): boolean {
  if (query.tags && !query.tags.includes(entry.tag)) return false;
  if (query.levels && !query.levels.includes(entry.level)) return false;
  if (query.since !== undefined && entry.timestamp < query.since) return false;
  return true;
}

function queryAll(q: LogQuery): LogEntry[] {
  // Decide which rings to scan based on the requested levels. Omitting
  // `levels` falls back to errors-only for backwards compatibility — callers
  // who specifically want debug events must opt in via `levels: ["debug"]`.
  const wantsDebug = q.levels?.includes("debug") ?? false;
  const wantsErrors = q.levels ? q.levels.some((l) => l !== "debug") : true;
  const out: LogEntry[] = [];
  if (wantsErrors) {
    for (const e of recentErrors) if (matches(e, q)) out.push(e);
  }
  if (wantsDebug) {
    for (const e of recentDebug) if (matches(e, q)) out.push(e);
  }
  return out;
}

export const logger = {
  debug: (tag: LogTag, message: string, error?: unknown) => log("debug", tag, message, error),
  info: (tag: LogTag, message: string) => log("info", tag, message),
  warn: (tag: LogTag, message: string, error?: unknown) => log("warn", tag, message, error),
  error: (tag: LogTag, message: string, error?: unknown) => log("error", tag, message, error),

  /** Get recent warn/error entries for crash reports or debug UI */
  getRecentErrors: (): readonly LogEntry[] => recentErrors,

  /** Filter recent entries by tag/level/since — useful for debug panels, test
   * assertions, and targeted crash-report sections (e.g. only Network errors
   * in the last 30 seconds). Scans the error ring by default; include `debug`
   * in `levels` to also scan the dev-only debug ring used by telemetry
   * dashboards. */
  query: (q: LogQuery): readonly LogEntry[] => queryAll(q),

  /**
   * Count recent log entries grouped by a derived key. Useful for dashboards
   * that want to render "errors by tag" or "entries by message prefix" without
   * iterating the rings themselves. `keyFn` returns the group key per entry —
   * return `null` or `undefined` to drop an entry from the count entirely.
   *
   * Example:
   *   logger.countBy({ levels: ["warn", "error"] }, (e) => e.tag)
   *   // => { Translation: 3, Network: 1 }
   */
  countBy: <K extends string>(
    q: LogQuery,
    keyFn: (entry: LogEntry) => K | null | undefined
  ): Record<K, number> => {
    const out = {} as Record<K, number>;
    for (const entry of queryAll(q)) {
      const key = keyFn(entry);
      if (key == null) continue;
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  },

  /** Clear recent error buffer */
  clearRecentErrors: () => { recentErrors.length = 0; recentDebug.length = 0; },

  /**
   * Tune the ring buffer size at runtime. Useful so we can calibrate against
   * real crash rates after shipping (#97) without a code change. Values are
   * clamped to [10, 500] to stop accidental OOM or uselessly small buffers.
   */
  configureBufferSize: (size: number) => {
    const clamped = Math.max(10, Math.min(500, Math.floor(size)));
    bufferSize = clamped;
    while (recentErrors.length > bufferSize) recentErrors.shift();
    return clamped;
  },

  /** Tune the debug ring capacity. Clamped to [10, 1000] — debug rings can be
   * bigger because they are dev-only and used by telemetry dashboards that
   * benefit from longer windows. */
  configureDebugBufferSize: (size: number) => {
    const clamped = Math.max(10, Math.min(1000, Math.floor(size)));
    debugBufferSize = clamped;
    while (recentDebug.length > debugBufferSize) recentDebug.shift();
    return clamped;
  },

  /** Current ring buffer capacity (for debug UI and tests). */
  getBufferSize: (): number => bufferSize,

  /** Current debug ring capacity. */
  getDebugBufferSize: (): number => debugBufferSize,
};
