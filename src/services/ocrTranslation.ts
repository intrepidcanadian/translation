import { Platform } from "react-native";
import { translateText, translateAppleBatch, type TranslateOptions, type TranslationProvider } from "./translation";
import { logger } from "./logger";
import { makeStableBlockId } from "../utils/rectMapping";

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

// Cap parallel translation requests so a cluttered scene (20+ OCR lines in a
// single frame) doesn't fire 20 simultaneous fetches and trip a cloud
// provider's rate limiter (MyMemory especially — its free tier throttles
// aggressively). 5 gives us a ~5× latency win over the old sequential loop
// while staying under typical per-second caps.
const TRANSLATION_CONCURRENCY = 5;

/** Run `fn` over every item in `items` with at most `limit` concurrent
 * in-flight calls, preserving input order in the result array. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
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
        // Parallelize non-Apple providers so a frame with N uncached lines
        // takes ~1 round-trip instead of N. Concurrency is capped so we
        // don't hammer rate-limited cloud providers, and per-line errors
        // are absorbed into the original text (same fallback behaviour as
        // the old sequential loop, just without blocking the whole batch
        // on the slowest request). Abort-short-circuit per worker keeps
        // the cancellation semantics identical: a superseding frame still
        // abandons pending work. (#5)
        const translateOptions: TranslateOptions = { provider, signal };
        translatedTexts = await mapWithConcurrency(uncachedTexts, TRANSLATION_CONCURRENCY, async (text) => {
          if (signal?.aborted) return text;
          try {
            const res = await translateText(text, sourceLangCode, targetLangCode, translateOptions);
            return res.translatedText;
          } catch (err) {
            logger.warn("OCR", "OCR line translation failed", err);
            return text;
          }
        });
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
      // Stable bucketed ID — see makeStableBlockId for the rationale. The
      // previous `${top}-${left}-${text.slice(0,10)}` hashed raw pixel
      // coords, so the 5-20 px of OCR jitter on a still line produced a
      // fresh ID every frame — every label re-ran its 200 ms fade-in and
      // the overlays strobed. Bucketing to 32 px absorbs that noise. (#1)
      id: makeStableBlockId(line.frame, line.text),
      originalText: line.text,
      translatedText: translated,
      frame: line.frame,
    });
  }

  return blocks;
}

/**
 * Translates lines from a captured photo (no caching needed, one-shot).
 * Uses the same bounded-concurrency pool as the live path (#5) so a
 * photo with lots of text lines doesn't serialize the translation
 * calls end-to-end.
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

    return await mapWithConcurrency(texts, TRANSLATION_CONCURRENCY, async (text) => {
      try {
        const res = await translateText(text, sourceLangCode, targetLangCode, { provider });
        return res.translatedText;
      } catch (err) {
        logger.warn("OCR", "Capture line translation failed", err);
        return text;
      }
    });
  } catch (err) {
    logger.warn("OCR", "Batch capture translation failed, using originals", err);
    return texts;
  }
}

// NOTE: the naive `mapToScreenCoords` that used to live here was a simple
// X/Y stretch that ignored the camera preview's aspect-fill layout — it
// drifted captured-photo overlays away from their source text the same way
// the live path used to drift before the coordinate fix. It's been removed;
// both paths now import `mapImageRectToScreen` from `utils/rectMapping.ts`
// so there's only one correct mapper in the codebase. (#2)
