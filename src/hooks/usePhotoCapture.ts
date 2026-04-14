import { useState, useCallback, useEffect, useRef } from "react";
import { Platform, Share, Alert } from "react-native";
import { Animated } from "react-native";
import type { Camera, PhotoFile } from "react-native-vision-camera";
import TextRecognition, { TextRecognitionScript } from "@react-native-ml-kit/text-recognition";
import { copyWithAutoClear } from "../services/clipboard";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system";
import { logger } from "../services/logger";

// Best-effort delete of a captured photo temp file. Silent on failure — the OS
// will reap the temp dir eventually, and we don't want cleanup errors to
// surface to the user.
async function deleteCapturedUri(uri: string | null): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (err) {
    logger.warn("Camera", "Failed to delete captured photo temp file", err);
  }
}
import type { TranslationProvider } from "../services/translation";
import { translateCapturedLines, mapToScreenCoords } from "../services/ocrTranslation";

interface CapturedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  imageFrame: { top: number; left: number; width: number; height: number };
  screenFrame: { top: number; left: number; width: number; height: number };
}

function getMLKitScript(langCode: string): TextRecognitionScript {
  switch (langCode) {
    case "zh": return TextRecognitionScript.CHINESE;
    case "ja": return TextRecognitionScript.JAPANESE;
    case "ko": return TextRecognitionScript.KOREAN;
    case "hi": return TextRecognitionScript.DEVANAGARI;
    default: return TextRecognitionScript.LATIN;
  }
}

interface UsePhotoCaptureParams {
  captureRef: React.RefObject<Camera | null>;
  sourceLangCode: string;
  targetLangCode: string;
  translationProvider?: TranslationProvider;
  screenDims: { width: number; height: number };
  blockOpacities: Map<string, Animated.Value>;
  lastOCRTextRef: React.MutableRefObject<string>;
  isMountedRef: React.MutableRefObject<boolean>;
}

export function usePhotoCapture({
  captureRef,
  sourceLangCode,
  targetLangCode,
  translationProvider,
  screenDims,
  blockOpacities,
  lastOCRTextRef,
  isMountedRef,
}: UsePhotoCaptureParams) {
  const [isCaptured, setIsCaptured] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedBlocks, setCapturedBlocks] = useState<CapturedBlock[]>([]);
  const [isProcessingCapture, setIsProcessingCapture] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Mirror of capturedUri for the unmount cleanup effect — a ref stays current
  // without retriggering the effect, so unmount always sees the latest URI.
  const capturedUriRef = useRef<string | null>(null);
  useEffect(() => {
    capturedUriRef.current = capturedUri;
  }, [capturedUri]);

  // Delete the captured photo temp file when the hook unmounts. Camera captures
  // land in the app's temp dir and otherwise accumulate until the OS reaps them.
  useEffect(() => {
    return () => {
      void deleteCapturedUri(capturedUriRef.current);
    };
  }, []);

  const handleCapture = useCallback(async () => {
    if (!captureRef.current || isProcessingCapture) return;

    setIsProcessingCapture(true);
    setCaptureError(null);

    try {
      const photo: PhotoFile = await captureRef.current.takePhoto({
        enableShutterSound: true,
      });
      const uri = Platform.OS === "android" ? `file://${photo.path}` : photo.path;

      setCapturedUri(uri);
      setIsCaptured(true);
      blockOpacities.clear();

      const script = getMLKitScript(sourceLangCode);
      const result = await TextRecognition.recognize(uri, script);

      if (!result.blocks.length) {
        setCaptureError("No text detected in photo. Try again.");
        setIsProcessingCapture(false);
        return;
      }

      const lines: Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }> = [];
      for (const block of result.blocks) {
        for (const line of block.lines) {
          if (!line.text?.trim() || !line.frame) continue;
          lines.push({
            text: line.text.trim(),
            frame: {
              top: line.frame.top ?? 0,
              left: line.frame.left ?? 0,
              width: line.frame.width ?? 0,
              height: line.frame.height ?? 0,
            },
          });
        }
      }

      if (lines.length === 0) {
        setCaptureError("No text lines detected.");
        setIsProcessingCapture(false);
        return;
      }

      const texts = lines.map((l) => l.text);
      const translations = await translateCapturedLines(texts, sourceLangCode, targetLangCode, translationProvider);

      const blocks: CapturedBlock[] = lines.map((line, i) => ({
        id: `cap-${i}-${line.text.slice(0, 8)}`,
        originalText: line.text,
        translatedText: translations[i] || line.text,
        imageFrame: line.frame,
        screenFrame: mapToScreenCoords(line.frame, photo.width, photo.height, screenDims.width, screenDims.height),
      }));

      setCapturedBlocks(blocks);
    } catch (err: unknown) {
      setCaptureError(err instanceof Error ? err.message : "Capture failed");
      setIsCaptured(false);
      // Delete the stale capture if takePhoto succeeded but a later step failed.
      void deleteCapturedUri(capturedUriRef.current);
      setCapturedUri(null);
    } finally {
      setIsProcessingCapture(false);
    }
  }, [captureRef, sourceLangCode, targetLangCode, translationProvider, screenDims, isProcessingCapture, blockOpacities]);

  const handleRetake = useCallback(() => {
    // Delete the previous photo before clearing state so we don't leak the
    // temp file between capture → retake → capture cycles.
    void deleteCapturedUri(capturedUriRef.current);
    setIsCaptured(false);
    setCapturedUri(null);
    setCapturedBlocks([]);
    setCaptureError(null);
    lastOCRTextRef.current = "";
  }, [lastOCRTextRef]);

  const handleShareCapture = useCallback(async () => {
    if (!capturedUri) return;
    const textSummary = capturedBlocks
      .map((b) => `${b.originalText} → ${b.translatedText}`)
      .join("\n");

    try {
      await Share.share({
        message: `Photo Translation (${sourceLangCode.toUpperCase()} → ${targetLangCode.toUpperCase()}):\n\n${textSummary}`,
        url: capturedUri,
      });
    } catch (err) {
      logger.warn("Camera", "Share capture failed", err);
    }
  }, [capturedUri, capturedBlocks, sourceLangCode, targetLangCode]);

  const handleBlockTap = useCallback((block: CapturedBlock) => {
    Alert.alert(
      block.translatedText,
      block.originalText,
      [
        {
          // copyWithAutoClear: OCR blocks captured from the camera can contain
          // signs, labels, or document snippets; reuse the 60s auto-wipe. (#128)
          text: "Copy Translation",
          onPress: () => { copyWithAutoClear(block.translatedText); },
        },
        {
          text: "Copy Original",
          onPress: () => { copyWithAutoClear(block.originalText); },
        },
        {
          text: "Speak",
          onPress: () => Speech.speak(block.translatedText, { language: targetLangCode }),
        },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }, [targetLangCode]);

  return {
    isCaptured,
    capturedUri,
    capturedBlocks,
    isProcessingCapture,
    captureError,
    handleCapture,
    handleRetake,
    handleShareCapture,
    handleBlockTap,
  };
}
