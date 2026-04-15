import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  AVAudioSessionCategory,
  AVAudioSessionCategoryOptions,
  AVAudioSessionMode,
  type ExpoSpeechRecognitionOptions,
} from "expo-speech-recognition";
import { logger } from "../services/logger";

/**
 * Shared speech-recognition start path that hardens against the iOS
 * "Cannot Record" failure modes we hit in the wild:
 *
 *   - AVFoundationErrorDomain Code=-11803 ("Cannot Record")
 *   - NSOSStatusErrorDomain Code=-16409
 *
 * Both of these mean the AVAudioSession was in the wrong category at the
 * moment ExpoSpeechRecognitionModule.start() tried to acquire the mic. The
 * two known triggers in this app:
 *
 *   1. expo-speech (Speech.speak) is still mid-utterance from the previous
 *      translation's auto-TTS, and has the session pinned in a playback
 *      category. We Speech.stop() defensively so the synthesizer releases
 *      the session before we try to flip it.
 *
 *   2. The session was left in an unexpected category by a prior session,
 *      a parallel AVCaptureSession, or another process. expo-speech-
 *      recognition defaults to playAndRecord, but defaults aren't enough
 *      under load — pinning iosCategory on EVERY start() makes the
 *      transition deterministic.
 *
 * All call sites that invoke ExpoSpeechRecognitionModule.start() in this
 * repo MUST go through this helper. Direct calls re-introduce the bug.
 */
export function startSpeechSession(options: ExpoSpeechRecognitionOptions): void {
  // Defensive TTS teardown. Speech.stop() returns a Promise<void> on RN, so a
  // synchronous try/catch only catches the rare synchronous throw paths
  // (e.g. native module not linked); a *rejected* promise would otherwise
  // surface as an unhandled rejection. Chain a .catch() to swallow both
  // shapes, and run a sync try/catch around the call site so the .catch()
  // chain itself can't throw on platforms where Speech.stop() returns
  // undefined instead of a thenable.
  try {
    const maybe = Speech.stop() as unknown;
    if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
      (maybe as Promise<unknown>).catch((err) =>
        logger.warn("Speech", "Speech.stop() rejected before mic acquire", err)
      );
    }
  } catch (err) {
    logger.warn("Speech", "Speech.stop() threw before mic acquire", err);
  }

  ExpoSpeechRecognitionModule.start({
    ...options,
    iosCategory: options.iosCategory ?? {
      category: AVAudioSessionCategory.playAndRecord,
      categoryOptions: [
        AVAudioSessionCategoryOptions.defaultToSpeaker,
        AVAudioSessionCategoryOptions.allowBluetooth,
        AVAudioSessionCategoryOptions.duckOthers,
      ],
      mode: AVAudioSessionMode.measurement,
    },
  });
}
