import { useState, useRef, useCallback, useEffect } from "react";
import { Alert, Linking, Animated, AppState, type AppStateStatus } from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import * as Speech from "expo-speech";
import { startSpeechSession } from "../utils/speechSession";
import { impactLight, impactMedium } from "../services/haptics";
import { translateText } from "../services/translation";
import type { TranslationProvider } from "../services/translation";
import { increment as telemetryIncrement } from "../services/telemetry";
import { logger } from "../services/logger";
import { isLikelyMicMuted } from "../utils/micMuted";

interface UseSpeechRecognitionOptions {
  sourceLangCode: string;
  sourceSpeechCode: string;
  targetLangCode: string;
  targetSpeechCode: string;
  conversationMode: boolean;
  activeSpeakerRef: React.MutableRefObject<"A" | "B">;
  offlineSpeech: boolean;
  silenceTimeout: number;
  speechRate: number;
  autoPlayTTS: boolean;
  reduceMotion: boolean;
  translationProvider: TranslationProvider;
  glossaryLookup: (text: string, srcLang: string, tgtLang: string) => string | null;
  updateWidgetData: (original: string, translated: string, from: string, to: string) => Promise<void>;
  onTranslationComplete: (original: string, translated: string, speaker: "A" | "B" | undefined, confidence?: number, detectedLang?: string) => void;
  onShowError: (msg: string) => void;
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions) {
  const {
    sourceLangCode,
    sourceSpeechCode,
    targetLangCode,
    targetSpeechCode,
    conversationMode,
    activeSpeakerRef,
    offlineSpeech,
    silenceTimeout,
    speechRate,
    autoPlayTTS,
    reduceMotion,
    translationProvider,
    glossaryLookup,
    updateWidgetData,
    onTranslationComplete,
    onShowError,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  // #160: session-scoped mic-muted pattern detector. We track successes and
  // no-speech events locally (not just via telemetry) so the inline hint can
  // clear immediately when the user lands a successful translation — the
  // module-level telemetry counters are persisted and would stay elevated
  // across a legitimate silent warm-up. `likelyMicMuted` is derived via the
  // shared `isLikelyMicMuted` predicate in src/utils/micMuted.ts so Settings
  // diagnostics and this inline path use the same threshold.
  const [sessionNoSpeechCount, setSessionNoSpeechCount] = useState(0);
  const [sessionSuccessCount, setSessionSuccessCount] = useState(0);

  const finalTextRef = useRef("");
  const lastTranslatedRef = useRef("");
  const lastConfidenceRef = useRef<number | undefined>(undefined);
  const lastDetectedLangRef = useRef<string | undefined>(undefined);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isStartingRef = useRef(false); // Guard against rapid double-taps
  const isListeningRef = useRef(false);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);

  // Snapshot ref of the mutable options. Callbacks below read from this ref
  // instead of closing over the destructured values, so startListening and
  // startListeningAs can be memoized with empty deps and remain stable
  // identities across every render. That unlocks React.memo downstream in
  // ControlsPanel and SplitConversation which receive these as props.
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  // Pulse animation for mic button
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0)).current;
  const skeletonAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (isListening && !reduceMotion) {
      const pulse = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.6, duration: 1000, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 0, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(pulseOpacity, { toValue: 0.5, duration: 0, useNativeDriver: true }),
            Animated.timing(pulseOpacity, { toValue: 0, duration: 1000, useNativeDriver: true }),
          ]),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
      pulseOpacity.setValue(0);
    }
  }, [isListening, reduceMotion, pulseAnim, pulseOpacity]);

  useEffect(() => {
    if (isTranslating && !reduceMotion) {
      const shimmer = Animated.loop(
        Animated.sequence([
          Animated.timing(skeletonAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
          Animated.timing(skeletonAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        ])
      );
      shimmer.start();
      return () => shimmer.stop();
    } else {
      skeletonAnim.setValue(reduceMotion ? 0.5 : 0.3);
    }
  }, [isTranslating, reduceMotion, skeletonAnim]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (translationTimeout.current) clearTimeout(translationTimeout.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  // #167: reset the mic-muted session detector when the app returns from
  // background. The hook previously accumulated sessionNoSpeechCount /
  // sessionSuccessCount for the full lifetime of the mount, so a user who
  // hit a muted mic in the morning and then fixed it would have `success > 0`
  // and never see the hint for a *second* muted session hours later. Scoping
  // the counters to a foreground "session" means each time the user returns
  // to the app the detector starts from scratch — fresh 3-strike window,
  // accurate self-heal contract intact.
  useEffect(() => {
    const handleChange = (next: AppStateStatus) => {
      if (next === "active") {
        setSessionNoSpeechCount(0);
        setSessionSuccessCount(0);
      }
    };
    const sub = AppState.addEventListener("change", handleChange);
    return () => sub.remove();
  }, []);

  // Debounced translation (used by speech results)
  const debouncedTranslate = useCallback(
    (text: string) => {
      if (translationTimeout.current) clearTimeout(translationTimeout.current);
      if (!text.trim() || text.trim() === lastTranslatedRef.current) return;

      translationTimeout.current = setTimeout(async () => {
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const fromCode = (conversationMode && activeSpeakerRef.current === "B") ? targetLangCode : sourceLangCode;
        const toCode = (conversationMode && activeSpeakerRef.current === "B") ? sourceLangCode : targetLangCode;

        setIsTranslating(true);
        try {
          const glossaryMatch = glossaryLookup(text.trim(), fromCode, toCode);
          const result = glossaryMatch
            ? { translatedText: glossaryMatch, confidence: 1.0 }
            : await translateText(text.trim(), fromCode, toCode, { signal: controller.signal, provider: translationProvider });
          if (!controller.signal.aborted) {
            setTranslatedText(result.translatedText);
            lastTranslatedRef.current = text.trim();
            lastConfidenceRef.current = result.confidence;
            lastDetectedLangRef.current = result.detectedLanguage;
            updateWidgetData(text.trim(), result.translatedText, fromCode, toCode);
            // #135: count the primary speech-translation pipeline too, not
            // just DualStreamView's secondary path. Without this the session
            // dashboard undercounts real speech usage and the fail-rate UI
            // in Settings > Translation Diagnostics can't distinguish "no
            // speech traffic" from "everything is succeeding".
            telemetryIncrement("speech.translateSuccess");
            setSessionSuccessCount((c) => c + 1);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          telemetryIncrement("speech.translateFail");
          // #141: emit a tagged Speech error into the logger ring in addition
          // to the session counter, so `logger.countBy`/`countByRolling` can
          // surface a rolling fail rate in Settings diagnostics and the
          // crash-report "Errors by tag" line includes speech failures. The
          // user-facing error banner is still fired via onShowError below.
          logger.warn("Speech", "Translation failed", err);
          const msg = err instanceof Error ? err.message : "Translation failed";
          onShowError(msg);
        } finally {
          if (!controller.signal.aborted) setIsTranslating(false);
        }
      }, 300);
    },
    [sourceLangCode, targetLangCode, conversationMode, activeSpeakerRef, onShowError, translationProvider, glossaryLookup, updateWidgetData]
  );

  // Speech recognition events
  useSpeechRecognitionEvent("start", () => setIsListening(true));

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }

    if (finalText.trim() && translatedText.trim()) {
      const speaker = conversationMode ? activeSpeakerRef.current : undefined;
      onTranslationComplete(finalText.trim(), translatedText.trim(), speaker, lastConfidenceRef.current, lastDetectedLangRef.current);

      if (autoPlayTTS) {
        const ttsLang = (conversationMode && speaker === "B") ? sourceSpeechCode : targetSpeechCode;
        Speech.speak(translatedText.trim(), { language: ttsLang, rate: speechRate });
      }
    }
    setLiveText("");
    setFinalText("");
    setTranslatedText("");
    lastTranslatedRef.current = "";
    finalTextRef.current = "";
    lastConfidenceRef.current = undefined;
    lastDetectedLangRef.current = undefined;
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript || "";
    const isFinal = event.isFinal;

    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (silenceTimeout > 0) {
      silenceTimerRef.current = setTimeout(() => ExpoSpeechRecognitionModule.stop(), silenceTimeout * 1000);
    }

    if (isFinal) {
      const updated = finalTextRef.current ? `${finalTextRef.current} ${transcript}` : transcript;
      finalTextRef.current = updated;
      setFinalText(updated);
      setLiveText(updated);
      debouncedTranslate(updated);
    } else {
      const combined = finalTextRef.current ? `${finalTextRef.current} ${transcript}` : transcript;
      setLiveText(combined);
      debouncedTranslate(combined);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    const errorMap: Record<string, string> = {
      "no-speech": "No speech detected. Try speaking louder.",
      "audio-capture": "Microphone unavailable. Check your device settings.",
      "not-allowed": "Microphone permission denied.",
      "network": "Network error during speech recognition.",
    };
    // #146: emit a tagged Speech warning into the logger ring so
    // `logger.countByRolling({ tags: ["Speech"], levels: ["warn", "error"] })`
    // picks up recognition failures (permission denied, network errors, no
    // microphone, ...) in addition to the translate-failure path. Without
    // this, a user stuck in a broken mic state would show 0 speech activity
    // in the diagnostics dashboard even though every session was failing.
    // Routine "no-speech" events are logged at debug level so they don't
    // flood the error ring for silent users.
    const code = event.error;
    if (code === "no-speech") {
      // #152: debug-level log keeps the error ring quiet, but increment a
      // production-visible counter so the diagnostics dashboard can tell a
      // silent-user session apart from a broken-mic session.
      logger.debug("Speech", `recognition no-speech (${code})`);
      telemetryIncrement("speech.noSpeech");
      setSessionNoSpeechCount((c) => c + 1);
    } else {
      logger.warn("Speech", `recognition error (${code})`);
    }
    // #180: when the error code indicates a revoked/denied mic permission
    // (the OS can strip it mid-session, or the user changed it in Settings
    // between sessions), the plain error-banner text was a dead end — the
    // user had to know iOS's deep Settings path to recover. Mirror the
    // startListening permission-denied path and surface an Alert with a
    // one-tap "Open Settings" recovery action so the user can re-enable
    // the mic without leaving the recovery flow. Also bumps a telemetry
    // counter so Settings diagnostics can expose permission churn.
    if (code === "not-allowed") {
      telemetryIncrement("speech.permissionDenied");
      Alert.alert(
        "Microphone Permission Required",
        "Live Translator needs microphone access to translate speech. Please enable it in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
    }
    onShowError(errorMap[code] || `Speech error: ${code}`);
    setIsListening(false);
  });

  // Stable — reads all dynamic inputs from optionsRef and isListeningRef.
  // No deps means this identity survives across renders, which is what the
  // React.memo paths downstream rely on.
  const startListening = useCallback(async () => {
    // Prevent double-tap: ignore if already starting or listening
    if (isStartingRef.current || isListeningRef.current) return;
    isStartingRef.current = true;

    impactMedium();
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        // #146: a permission denial is a speech-pipeline failure too.
        // Tagging it as Speech warn ensures rolling diagnostics reflect
        // users who can't start speech at all, not just translate failures.
        logger.warn("Speech", "microphone permission denied");
        Alert.alert(
          "Microphone Permission Required",
          "Live Translator needs microphone access to translate speech. Please enable it in Settings.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }

      const opts = optionsRef.current;
      const speechLang = (opts.conversationMode && opts.activeSpeakerRef.current === "B")
        ? opts.targetSpeechCode
        : (opts.sourceLangCode === "autodetect" ? "en-US" : opts.sourceSpeechCode);

      // Routed through startSpeechSession (src/utils/speechSession.ts) which
      // stops in-flight TTS and pins the iOS audio category — the only
      // reliable way to avoid AVFoundation -11803 / OSStatus -16409 here.
      startSpeechSession({
        lang: speechLang,
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: opts.offlineSpeech,
        ...(opts.sourceLangCode === "autodetect" ? { addsPunctuation: true } : {}),
      });
    } finally {
      // Reset guard after a short delay to allow the "start" event to fire
      setTimeout(() => { isStartingRef.current = false; }, 500);
    }
  }, []);

  const startListeningAs = useCallback((speaker: "A" | "B") => {
    optionsRef.current.activeSpeakerRef.current = speaker;
    startListening();
  }, [startListening]);

  const stopListening = useCallback(() => {
    impactLight();
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const likelyMicMuted = isLikelyMicMuted(sessionNoSpeechCount, sessionSuccessCount);

  return {
    isListening,
    liveText,
    setLiveText,
    translatedText,
    isTranslating,
    setIsTranslating,
    lastDetectedLang: lastDetectedLangRef.current,
    pulseAnim,
    pulseOpacity,
    skeletonAnim,
    abortControllerRef,
    startListening,
    startListeningAs,
    stopListening,
    /** #160: session-scoped "mic may be muted" hint — true when the user has
     * logged ≥ MIC_MUTED_HINT_THRESHOLD no-speech events without a single
     * successful speech translation in the same mount. Cleared automatically
     * on the first successful translate. */
    likelyMicMuted,
  };
}
