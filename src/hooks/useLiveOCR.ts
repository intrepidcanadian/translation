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

interface OCRFrame {
  x?: number;
  y?: number;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}

interface OCRBlock {
  text: string;
  lines?: Array<{ text: string; frame?: OCRFrame }>;
  frame?: OCRFrame;
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
      const ocrData = data as { result?: { blocks?: OCRBlock[] }; blocks?: OCRBlock[] } | null;
      const blocks: OCRBlock[] = ocrData?.result?.blocks || ocrData?.blocks || [];
      if (!blocks.length) {
        if (lastOCRTextRef.current !== "") {
          lastOCRTextRef.current = "";
          setDetectedBlocks([]);
        }
        return;
      }

      const lines: Array<{ text: string; frame: { top: number; left: number; width: number; height: number } }> = [];
      for (const block of blocks) {
        if (block.lines) {
          for (const line of block.lines) {
            if (!line.text?.trim() || !line.frame) continue;
            lines.push({
              text: line.text.trim(),
              frame: {
                top: line.frame.y ?? line.frame.top ?? 0,
                left: line.frame.x ?? line.frame.left ?? 0,
                width: line.frame.width ?? 0,
                height: line.frame.height ?? 0,
              },
            });
          }
        } else if (block.text?.trim() && block.frame) {
          lines.push({
            text: block.text.trim(),
            frame: {
              top: block.frame.y ?? block.frame.top ?? 0,
              left: block.frame.x ?? block.frame.left ?? 0,
              width: block.frame.width ?? 0,
              height: block.frame.height ?? 0,
            },
          });
        }
      }

      if (lines.length === 0) return;

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
