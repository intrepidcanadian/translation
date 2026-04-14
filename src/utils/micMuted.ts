/**
 * Mic-muted / quiet-environment pattern detection.
 *
 * Shared between `SettingsModal` (Translation Diagnostics dashboard) and
 * `useSpeechRecognition` (inline hint near the mic button). Having one
 * threshold and one predicate means Settings and the inline hint stay in
 * lockstep — a user who sees the hint surface inline will see the same line
 * in the dashboard, and a threshold tuning only needs to happen in one place.
 *
 * Pattern: a user stuck in a silent-mic loop racks up repeated `no-speech`
 * recognition errors but never lands a successful speech translation. Cloud
 * connectivity has nothing to do with it — the mic itself is muted (hardware
 * switch, iOS control-center mute, user in a genuinely quiet room).
 *
 * Threshold of 3 is a first guess: enough to filter single silent taps but
 * low enough to catch the pattern before frustration builds. Tune once real
 * telemetry lands (#90 Sentry) — see backlog #160.
 */

export const MIC_MUTED_HINT_THRESHOLD = 3;

/**
 * Returns true when the observed speech stats look like the mic is muted or
 * the environment is too quiet: no successful translations at all, plus at
 * least `MIC_MUTED_HINT_THRESHOLD` no-speech events in the same session.
 *
 * `successCount` is the running count of successful speech translations
 * (anything that produced a translated string). `noSpeechCount` is the count
 * of `no-speech` recognition errors.
 */
export function isLikelyMicMuted(noSpeechCount: number, successCount: number): boolean {
  return successCount === 0 && noSpeechCount >= MIC_MUTED_HINT_THRESHOLD;
}
