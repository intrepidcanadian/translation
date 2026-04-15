import { useRef, useState, useCallback } from "react";
import { Animated } from "react-native";
import { logger } from "../services/logger";
import type { TranslationProvider } from "../services/translation";
import { translateOCRLines } from "../services/ocrTranslation";

interface DetectedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  frame: { top: number; left: number; width: number; height: number };
}

// Shape returned by react-native-vision-camera-ocr-plus's scanText frame
// processor — see node_modules/react-native-vision-camera-ocr-plus/src/types.ts.
// The native iOS/Android plugins prefix every field with its container name
// (blockText/blockFrame/lineText/lineFrame) to keep block and line data
// distinct when flattened, so the keys we read here must match exactly or
// every OCR frame silently resolves to zero lines and nothing renders.
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
  frame: { top: number; left: number; width: number; height: number };
}

/**
 * Normalize the raw react-native-vision-camera-ocr-plus frame callback data
 * into a flat list of `{ text, frame }` pairs. Extracted so the field-name
 * mapping (blockText/blockFrame/lineText/lineFrame → text/frame/top/left)
 * can be unit-tested without mounting the hook.
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
          frame: {
            top: line.lineFrame.y ?? 0,
            left: line.lineFrame.x ?? 0,
            width: line.lineFrame.width ?? 0,
            height: line.lineFrame.height ?? 0,
          },
        });
      }
    } else if (block?.blockText?.trim() && block.blockFrame) {
      lines.push({
        text: block.blockText.trim(),
        frame: {
          top: block.blockFrame.y ?? 0,
          left: block.blockFrame.x ?? 0,
          width: block.blockFrame.width ?? 0,
          height: block.blockFrame.height ?? 0,
        },
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
}

export function useLiveOCR({
  sourceLangCode,
  targetLangCode,
  translationProvider,
  isPaused,
  isCaptured,
  blockOpacities,
  isMountedRef,
  lastOCRTextRef,
}: UseLiveOCRParams) {
  const [detectedBlocks, setDetectedBlocks] = useState<DetectedBlock[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const translateQueueRef = useRef<Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }> | null>(null);
  const isTranslatingRef = useRef(false);

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
      const lines = parseOCRFrameData(data);
      if (lines.length === 0) {
        // Empty frame — clear stale detections so overlays fade out when
        // the user moves the camera away from text.
        if (lastOCRTextRef.current !== "") {
          lastOCRTextRef.current = "";
          setDetectedBlocks([]);
        }
        return;
      }

      const currentText = lines.map((l) => l.text).join("|");
      if (currentText === lastOCRTextRef.current) return;
      lastOCRTextRef.current = currentText;

      setError(null);
      translateLines(lines);
    } catch (err) {
      logger.warn("OCR", "OCR frame parse error", err);
    }
  }, [isPaused, isCaptured, translateLines, isMountedRef, lastOCRTextRef]);

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
