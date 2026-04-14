/**
 * Versioned crash report schema. ErrorBoundary writes reports with a
 * schemaVersion so future format changes (adding fields, renaming, etc.) can be
 * migrated forward without silently dropping data or crashing on parse.
 *
 * Bump CRASH_REPORT_SCHEMA_VERSION whenever the shape of CrashReport changes
 * in a way that isn't purely additive of optional fields. Additive optional
 * fields can be read by old code fine — only breaking changes need a bump.
 */

export const CRASH_REPORT_SCHEMA_VERSION = 1 as const;

export interface CrashReportV1 {
  schemaVersion: 1;
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: number;
  appVersion?: string;
  buildNumber?: string;
  platform?: string;
}

/** Current CrashReport is the latest version. Alias for callers. */
export type CrashReport = CrashReportV1;

/**
 * Migrate an unknown parsed crash report blob up to the current version.
 *
 * Unversioned legacy reports (pre-v1) had the same field shape as v1 minus the
 * schemaVersion discriminator, so we promote them by stamping schemaVersion.
 *
 * Returns null if the blob is not a recognizable crash report (missing
 * required message/timestamp fields) so the caller can ignore it rather than
 * render garbage.
 */
export function migrateCrashReport(raw: unknown): CrashReport | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // A legitimate crash report always has at least a message + timestamp.
  if (typeof obj.message !== "string") return null;
  if (typeof obj.timestamp !== "number") return null;

  const versioned = typeof obj.schemaVersion === "number" ? obj.schemaVersion : 0;

  // v0 (unversioned) → v1: fields already line up, just stamp the version.
  // Future migrations would chain here: if (versioned < 2) { ...migrate v1→v2 }
  if (versioned <= 1) {
    return {
      schemaVersion: CRASH_REPORT_SCHEMA_VERSION,
      message: obj.message,
      stack: typeof obj.stack === "string" ? obj.stack : undefined,
      componentStack: typeof obj.componentStack === "string" ? obj.componentStack : undefined,
      timestamp: obj.timestamp,
      appVersion: typeof obj.appVersion === "string" ? obj.appVersion : undefined,
      buildNumber: typeof obj.buildNumber === "string" ? obj.buildNumber : undefined,
      platform: typeof obj.platform === "string" ? obj.platform : undefined,
    };
  }

  // Future version newer than we know how to read — refuse rather than guess.
  return null;
}
