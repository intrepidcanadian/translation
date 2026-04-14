import { Platform } from "react-native";
import { translateText, translateAppleBatch, type TranslateOptions, type TranslationProvider } from "./translation";
import { logger } from "./logger";

interface OCRLine {
  text: string;
  frame: { top: number; left: number; width: number; height: number };
}

interface TranslatedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  frame: { top: number; left: number; width: number; height: number };
}

const MAX_CACHE_SIZE = 2000;

// Module-level LRU translation cache shared across OCR sessions. Map iteration
// order is insertion order, so "oldest = first key" gives us FIFO eviction for
// free; promote-on-hit (delete + reinsert) upgrades that to true LRU so hot
// camera-overlay phrases aren't evicted by a burst of one-off scans.
const ocrTranslationCache = new Map<string, string>();

export function clearOCRCache(): void {
  ocrTranslationCache.clear();
}

function getCacheKey(src: string, tgt: string, text: string): string {
  return `${src}|${tgt}|${text}`;
}

/** LRU get: returns the cached value and promotes it to "most recently used". */
function cacheGet(key: string): string | undefined {
  const value = ocrTranslationCache.get(key);
  if (value === undefined) return undefined;
  // Reinsert to move this entry to the end of the iteration order.
  ocrTranslationCache.delete(key);
  ocrTranslationCache.set(key, value);
  return value;
}

/** LRU set with oldest-first eviction when the cache exceeds MAX_CACHE_SIZE. */
function cacheSet(key: string, value: string): void {
  // If key exists, delete first so the reinsert moves it to the end.
  if (ocrTranslationCache.has(key)) ocrTranslationCache.delete(key);
  ocrTranslationCache.set(key, value);
  if (ocrTranslationCache.size > MAX_CACHE_SIZE) {
    const oldestKey = ocrTranslationCache.keys().next().value;
    if (oldestKey !== undefined) ocrTranslationCache.delete(oldestKey);
  }
}

/**
 * Translates an array of OCR lines, using cache for repeated text.
 * Returns translated blocks with position data for overlay rendering.
 */
export async function translateOCRLines(
  lines: OCRLine[],
  sourceLangCode: string,
  targetLangCode: string,
  provider?: TranslationProvider,
  signal?: AbortSignal
): Promise<TranslatedBlock[]> {
  const cachedMap = new Map<string, string>();
  const uncachedTexts: string[] = [];

  for (const line of lines) {
    const key = getCacheKey(sourceLangCode, targetLangCode, line.text);
    const hit = cacheGet(key);
    if (hit !== undefined) {
      cachedMap.set(line.text, hit);
    } else {
      uncachedTexts.push(line.text);
    }
  }

  let translatedTexts: string[] = [];
  if (uncachedTexts.length > 0 && !signal?.aborted) {
    try {
      if (provider === "apple" && Platform.OS === "ios") {
        translatedTexts = await translateAppleBatch(uncachedTexts, sourceLangCode, targetLangCode);
      } else {
        const translateOptions: TranslateOptions = { provider, signal };
        for (const text of uncachedTexts) {
          if (signal?.aborted) break;
          try {
            const res = await translateText(text, sourceLangCode, targetLangCode, translateOptions);
            translatedTexts.push(res.translatedText);
          } catch (err) {
            logger.warn("OCR", "OCR line translation failed", err);
            translatedTexts.push(text);
          }
        }
      }

      // Cache the results
      for (let i = 0; i < uncachedTexts.length && i < translatedTexts.length; i++) {
        const key = getCacheKey(sourceLangCode, targetLangCode, uncachedTexts[i]);
        cacheSet(key, translatedTexts[i]);
      }
    } catch (err) {
      logger.warn("OCR", "Batch OCR translation failed, using originals", err);
      translatedTexts = uncachedTexts;
    }
  }

  // Build result blocks
  const blocks: TranslatedBlock[] = [];
  let uncachedIdx = 0;

  for (const line of lines) {
    const cached = cachedMap.get(line.text);
    const translated = cached ?? (uncachedIdx < translatedTexts.length ? translatedTexts[uncachedIdx++] : line.text);

    blocks.push({
      id: `${line.frame.top}-${line.frame.left}-${line.text.slice(0, 10)}`,
      originalText: line.text,
      translatedText: translated,
      frame: line.frame,
    });
  }

  return blocks;
}

/**
 * Translates lines from a captured photo (no caching needed, one-shot).
 */
export async function translateCapturedLines(
  texts: string[],
  sourceLangCode: string,
  targetLangCode: string,
  provider?: TranslationProvider
): Promise<string[]> {
  try {
    if (provider === "apple" && Platform.OS === "ios") {
      return await translateAppleBatch(texts, sourceLangCode, targetLangCode);
    }

    const translations: string[] = [];
    for (const text of texts) {
      try {
        const res = await translateText(text, sourceLangCode, targetLangCode, { provider });
        translations.push(res.translatedText);
      } catch (err) {
        logger.warn("OCR", "Capture line translation failed", err);
        translations.push(text);
      }
    }
    return translations;
  } catch (err) {
    logger.warn("OCR", "Batch capture translation failed, using originals", err);
    return texts;
  }
}

/**
 * Maps image-space coordinates to screen-space coordinates for overlay rendering.
 */
export function mapToScreenCoords(
  imageFrame: { top: number; left: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
  screenWidth: number,
  screenHeight: number
): { top: number; left: number; width: number; height: number } {
  const isRotated = imageWidth > imageHeight && screenHeight > screenWidth;
  const effectiveW = isRotated ? imageHeight : imageWidth;
  const effectiveH = isRotated ? imageWidth : imageHeight;
  const scaleX = screenWidth / effectiveW;
  const scaleY = screenHeight / effectiveH;

  return {
    top: imageFrame.top * scaleY,
    left: imageFrame.left * scaleX,
    width: imageFrame.width * scaleX,
    height: imageFrame.height * scaleY,
  };
}
