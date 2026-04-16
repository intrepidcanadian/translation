import { useRef, useState, useCallback } from "react";
import { Animated } from "react-native";
import { logger } from "../services/logger";
import type { TranslationProvider } from "../services/translation";
import { translateOCRLines } from "../services/ocrTranslation";
import { mapImageRectToScreen } from "../utils/rectMapping";

// Re-export so existing imports (and the parseOCRFrameData tests) keep working
// after the function moved to `src/utils/rectMapping.ts`. The tests and this
// hook import `mapImageRectToScreen` from `../hooks/useLiveOCR` — keeping the
// re-export means no churn in the test file and no duplicate implementations.
export { mapImageRectToScreen };

interface DetectedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  /** Screen-space rectangle in px — ready to paint as `position: absolute`. */
  frame: { top: number; left: number; width: number; height: number };
}

// Shape returned by react-native-vision-camera-ocr-plus's scanText frame
// processor — see node_modules/react-native-vision-camera-ocr-plus/src/types.ts.
// The native iOS/Android plugins prefix every field with its container name
// (blockText/blockFrame/lineText/lineFrame) to keep block and line data
// distinct when flattened, so the keys we read here must match exactly or
// every OCR frame silently resolves to zero lines and nothing renders.
//
// NB: the plugin's `processFrame` helper (ios/RNVisionCameraOCR.swift:202)
// munges x/y through a nonsense formula — they do NOT match the rect's
// top-left. The only trustworthy origin is `boundingCenterX`/`boundingCenterY`
// which pass through cleanly as `frameRect.midX`/`midY`, so we reconstruct
// the real top-left as `center - size/2`.
interface OCRFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  boundingCenterX?: number;
  boundingCenterY?: number;
}

interface OCRLine {
  lineText: string;
  lineFrame: OCRFrame;
}

interface OCRBlock {
  blockText: string;
  blockFrame: OCRFrame;
  lines?: OCRLine[];
}

export interface ParsedOCRLine {
  text: string;
  /** Image-space rectangle in camera-buffer pixels, reconstructed from
   *  boundingCenterX/Y since the plugin's raw x/y values are mangled. */
  imageFrame: { top: number; left: number; width: number; height: number };
}

/** Reconstruct a real top-left origin from the plugin's boundingCenter+size.
 *  Falls back to the munged x/y if center isn't provided (Android paths
 *  without lightweight mode may omit them). */
function frameFromCenter(f: OCRFrame): { top: number; left: number; width: number; height: number } {
  const w = f.width ?? 0;
  const h = f.height ?? 0;
  const cx = f.boundingCenterX;
  const cy = f.boundingCenterY;
  if (typeof cx === "number" && typeof cy === "number") {
    return { top: cy - h / 2, left: cx - w / 2, width: w, height: h };
  }
  return { top: f.y ?? 0, left: f.x ?? 0, width: w, height: h };
}

/**
 * Normalize the raw react-native-vision-camera-ocr-plus frame callback data
 * into a flat list of `{ text, imageFrame }` pairs in the camera buffer's
 * pixel coordinate space. Screen-space mapping happens one level up in the
 * hook where `screenDims` + a running image-dim estimate are available.
 *
 * Prefers line-level text when the block carries `lines`, falls back to
 * block-level text for blocks without line decomposition (Android
 * lightweight mode emits blocks without lines). Skips blank strings and
 * entries missing a frame.
 */
export function parseOCRFrameData(data: unknown): ParsedOCRLine[] {
  const ocrData = data as { blocks?: OCRBlock[] } | null;
  const blocks: OCRBlock[] = ocrData?.blocks || [];
  const lines: ParsedOCRLine[] = [];
  for (const block of blocks) {
    if (block?.lines && block.lines.length) {
      for (const line of block.lines) {
        if (!line?.lineText?.trim() || !line.lineFrame) continue;
        lines.push({
          text: line.lineText.trim(),
          imageFrame: frameFromCenter(line.lineFrame),
        });
      }
    } else if (block?.blockText?.trim() && block.blockFrame) {
      lines.push({
        text: block.blockText.trim(),
        imageFrame: frameFromCenter(block.blockFrame),
      });
    }
  }
  return lines;
}

interface UseLiveOCRParams {
  sourceLangCode: string;
  targetLangCode: string;
  translationProvider?: TranslationProvider;
  isPaused: boolean;
  isCaptured: boolean;
  blockOpacities: Map<string, Animated.Value>;
  isMountedRef: React.MutableRefObject<boolean>;
  lastOCRTextRef: React.MutableRefObject<string>;
  /** Screen dimensions used for image-space → screen-space mapping. */
  screenDims: { width: number; height: number };
}

// Seed the image-dim estimate with iPhone's default portrait video frame
// (9:16 portrait, 1080×1920). VisionCamera's back-camera default on iOS and
// most Android devices sits in this range. The running estimator below grows
// toward observed extents on every frame, so early mis-seeds self-correct
// within one or two detections.
const SEED_IMAGE_W = 1080;
const SEED_IMAGE_H = 1920;

export function useLiveOCR({
  sourceLangCode,
  targetLangCode,
  translationProvider,
  isPaused,
  isCaptured,
  blockOpacities,
  isMountedRef,
  lastOCRTextRef,
  screenDims,
}: UseLiveOCRParams) {
  const [detectedBlocks, setDetectedBlocks] = useState<DetectedBlock[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const translateQueueRef = useRef<Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }> | null>(null);
  const isTranslatingRef = useRef(false);
  // Running estimate of the camera buffer's pixel dimensions. We never shrink
  // — only grow toward the max observed right/bottom extent across all
  // detected lines — so a frame where text is near the top-left of view
  // doesn't collapse the estimate and misplace subsequent frames.
  const imageDimsRef = useRef<{ width: number; height: number }>({ width: SEED_IMAGE_W, height: SEED_IMAGE_H });

  const translateLines = useCallback(async (
    lines: Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }>
  ) => {
    if (isTranslatingRef.current || !isMountedRef.current) {
      translateQueueRef.current = lines;
      return;
    }

    isTranslatingRef.current = true;
    setIsTranslating(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const blocks = await translateOCRLines(lines, sourceLangCode, targetLangCode, translationProvider, controller.signal);

      if (isMountedRef.current && !controller.signal.aborted) {
        setDetectedBlocks(blocks);
        const activeIds = new Set(blocks.map((b) => b.id));
        for (const key of blockOpacities.keys()) {
          if (!activeIds.has(key)) blockOpacities.delete(key);
        }
      }
    } catch (err: unknown) {
      if (isMountedRef.current && !(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Translation failed");
      }
      blockOpacities.clear();
    } finally {
      isTranslatingRef.current = false;
      if (isMountedRef.current) setIsTranslating(false);

      if (translateQueueRef.current && isMountedRef.current) {
        const queued = translateQueueRef.current;
        translateQueueRef.current = null;
        translateLines(queued);
      }
    }
  }, [sourceLangCode, targetLangCode, translationProvider, blockOpacities, isMountedRef]);

  const handleOCRResult = useCallback((data: unknown) => {
    if (isPaused || isCaptured || !isMountedRef.current) return;

    try {
      const parsed = parseOCRFrameData(data);
      if (parsed.length === 0) {
        // Empty frame — clear stale detections so overlays fade out when
        // the user moves the camera away from text.
        if (lastOCRTextRef.current !== "") {
          lastOCRTextRef.current = "";
          setDetectedBlocks([]);
        }
        return;
      }

      // Grow the running image-dim estimate toward the farthest right/bottom
      // extent we've ever seen. This self-corrects the aspect-fill mapping:
      // on the first frame where a line sits near the screen edge the
      // estimate jumps to the true frame size, and subsequent frames use
      // the corrected scale.
      let maxRight = imageDimsRef.current.width;
      let maxBottom = imageDimsRef.current.height;
      for (const line of parsed) {
        const r = line.imageFrame.left + line.imageFrame.width;
        const b = line.imageFrame.top + line.imageFrame.height;
        if (r > maxRight) maxRight = r;
        if (b > maxBottom) maxBottom = b;
      }
      imageDimsRef.current = { width: maxRight, height: maxBottom };

      const imageW = imageDimsRef.current.width;
      const imageH = imageDimsRef.current.height;
      const lines = parsed.map((line) => ({
        text: line.text,
        frame: mapImageRectToScreen(
          line.imageFrame,
          imageW,
          imageH,
          screenDims.width,
          screenDims.height
        ),
      }));

      const currentText = lines.map((l) => l.text).join("|");
      if (currentText === lastOCRTextRef.current) return;
      lastOCRTextRef.current = currentText;

      setError(null);
      translateLines(lines);
    } catch (err) {
      logger.warn("OCR", "OCR frame parse error", err);
    }
  }, [isPaused, isCaptured, translateLines, isMountedRef, lastOCRTextRef, screenDims]);

  return {
    detectedBlocks,
    setDetectedBlocks,
    isTranslating,
    error,
    setError,
    abortRef,
    handleOCRResult,
  };
}
