import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  AVAudioSessionCategory,
  AVAudioSessionCategoryOptions,
  AVAudioSessionMode,
  type ExpoSpeechRecognitionOptions,
} from "expo-speech-recognition";

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
  // Defensive TTS teardown. Speech.stop() can throw on platforms where no
  // utterance is queued, hence the try/catch. We don't await it because
  // expo-speech's stop is synchronous on the JS side and the native
  // AVSpeechSynthesizer release happens before start() reaches native.
  try {
    Speech.stop();
  } catch {
    /* no-op */
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
