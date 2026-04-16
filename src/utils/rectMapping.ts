/**
 * Shared image-space → screen-space mapping used by BOTH the live OCR
 * overlay (useLiveOCR) and the captured-photo overlay (usePhotoCapture).
 *
 * Why this lives in a util instead of inline in each hook: the live and
 * captured paths used to have two different mappers — the live path's
 * aspect-fill math (correct, matches VisionCamera / Image resizeMode="cover")
 * and the capture path's naive X/Y stretch (wrong — would drift the overlays
 * away from their source text). Consolidating them here means new scanner
 * surfaces can't accidentally pick the broken one.
 */

export type Rect = { top: number; left: number; width: number; height: number };

/**
 * Map an image-space rectangle to screen-space using aspect-fill ("cover")
 * math — matching how VisionCamera / `Image resizeMode="cover"` lay out the
 * preview over the phone screen.
 *
 * The image is scaled so that its SHORTER axis fills the screen's
 * corresponding axis, then centered; the longer axis overflows symmetrically
 * and is cropped. A point at `(imgX, imgY)` in the source image lands at
 * `(imgX * scale + offsetX, imgY * scale + offsetY)` on the screen, where
 * `scale = max(sw/iw, sh/ih)`.
 */
export function mapImageRectToScreen(
  rect: Rect,
  imageW: number,
  imageH: number,
  screenW: number,
  screenH: number
): Rect {
  if (imageW <= 0 || imageH <= 0) return { top: 0, left: 0, width: 0, height: 0 };
  const scale = Math.max(screenW / imageW, screenH / imageH);
  const displayW = imageW * scale;
  const displayH = imageH * scale;
  const offsetX = (screenW - displayW) / 2;
  const offsetY = (screenH - displayH) / 2;
  return {
    left: rect.left * scale + offsetX,
    top: rect.top * scale + offsetY,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/**
 * Build a stable block ID that survives the 5-20 px frame-to-frame jitter
 * OCR produces on the same physical line. Previously the ID was
 * `${top}-${left}-${text.slice(0,10)}` using raw screen pixels, so every
 * frame generated fresh IDs — every label allocated a new Animated.Value
 * and re-ran its 200 ms fade-in, causing the visible strobe on overlays.
 *
 * Bucketing to a 32 px grid absorbs the normal jitter (< 20 px) while
 * still distinguishing two lines with the same text at clearly different
 * positions (e.g. a duplicated "Open" sign at opposite ends of a store
 * front). text.slice(0, 20) — up from 10 — reduces collisions when several
 * lines share a long common prefix (e.g. repeated brand names on a menu).
 *
 * The bucket boundary is at `floor(x / 32) * 32`, so a line drifting
 * within its bucket keeps the same ID; a line moving a full bucket (32 px)
 * gets a fresh fade-in, which is the intended behavior for a real
 * repositioning rather than OCR noise.
 */
const ID_BUCKET_PX = 32;
export function makeStableBlockId(rect: Rect, text: string): string {
  const topBucket = Math.floor(rect.top / ID_BUCKET_PX);
  const leftBucket = Math.floor(rect.left / ID_BUCKET_PX);
  return `${topBucket}-${leftBucket}-${text.slice(0, 20)}`;
}
