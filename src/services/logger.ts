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

interface LogEntry {
  level: LogLevel;
  tag: LogTag;
  message: string;
  error?: unknown;
  timestamp: number;
}

const recentErrors: LogEntry[] = [];
const MAX_RECENT = 50;

function log(level: LogLevel, tag: LogTag, message: string, error?: unknown) {
  const entry: LogEntry = { level, tag, message, error, timestamp: Date.now() };

  if (level === "warn" || level === "error") {
    recentErrors.push(entry);
    if (recentErrors.length > MAX_RECENT) recentErrors.shift();
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

export const logger = {
  debug: (tag: LogTag, message: string, error?: unknown) => log("debug", tag, message, error),
  info: (tag: LogTag, message: string) => log("info", tag, message),
  warn: (tag: LogTag, message: string, error?: unknown) => log("warn", tag, message, error),
  error: (tag: LogTag, message: string, error?: unknown) => log("error", tag, message, error),

  /** Get recent warn/error entries for crash reports or debug UI */
  getRecentErrors: (): readonly LogEntry[] => recentErrors,

  /** Clear recent error buffer */
  clearRecentErrors: () => { recentErrors.length = 0; },
};
