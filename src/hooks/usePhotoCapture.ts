import { useState, useCallback, useEffect, useRef } from "react";
import { Platform, Share } from "react-native";
import { Animated } from "react-native";
import type { Camera, PhotoFile } from "react-native-vision-camera";
import TextRecognition from "@react-native-ml-kit/text-recognition";
import { getMLKitScript } from "../utils/getMLKitScript";
import * as FileSystem from "expo-file-system";
import { logger } from "../services/logger";
import { showBlockActionSheet } from "../utils/liveBlockActions";

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
import { translateCapturedLines } from "../services/ocrTranslation";
// Aspect-fill ("cover") mapper — the same one the live OCR overlay uses.
// The captured-photo path used to import a naive X/Y stretch from
// ocrTranslation.ts; that mapper ignored how the Image displays the capture
// with resizeMode="cover" and drifted every overlay away from its source
// text. Consolidated into a shared util so both paths pick the correct
// math. (#2)
import { mapImageRectToScreen } from "../utils/rectMapping";

interface CapturedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  imageFrame: { top: number; left: number; width: number; height: number };
  screenFrame: { top: number; left: number; width: number; height: number };
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
        screenFrame: mapImageRectToScreen(line.frame, photo.width, photo.height, screenDims.width, screenDims.height),
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
    // Shared with the live-OCR overlays (CameraTranslator, DualStreamView)
    // so users see the same copy/speak interaction regardless of whether
    // they tapped a live label or a captured-photo block. See
    // utils/liveBlockActions.ts for the action sheet config.
    showBlockActionSheet(block.originalText, block.translatedText, targetLangCode);
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
