/**
 * Regression tests for `parseOCRFrameData` and `mapImageRectToScreen` — the
 * pure helpers that normalize the raw react-native-vision-camera-ocr-plus
 * frame callback into `{ text, imageFrame }` pairs and project them into
 * screen space for overlay placement.
 *
 * History: the parser shipped broken from the feature's introduction in
 * 7bf321d and stayed broken for months: the hook read `block.text` /
 * `line.text` / `block.frame` / `line.frame`, but the native plugin actually
 * emits `blockText` / `lineText` / `blockFrame` / `lineFrame` (see
 * node_modules/react-native-vision-camera-ocr-plus/src/types.ts and
 * ios/RNVisionCameraOCR.swift line 140+). Every frame silently parsed to
 * zero lines, so the user saw no translation overlays at all.
 *
 * On top of the field-name bug, the plugin's `processFrame` helper
 * (ios/RNVisionCameraOCR.swift:202) munges x/y through a nonsense formula
 * — the returned x/y do NOT correspond to the rect's top-left. Only
 * `boundingCenterX`/`boundingCenterY` (= frameRect.midX/midY) are trustworthy,
 * so the parser now reconstructs top-left as `center - size/2`.
 *
 * These tests pin:
 *  1. Field names must match the plugin's actual output (blockText etc.)
 *  2. Top-left is computed from boundingCenter, not the mangled x/y
 *  3. mapImageRectToScreen uses aspect-fill ("cover") scaling to match the
 *     camera preview's default resize mode, so labels land on top of their
 *     source text.
 */

import { parseOCRFrameData, mapImageRectToScreen } from "../hooks/useLiveOCR";

describe("parseOCRFrameData", () => {
  // Fixture built to match the `Text` shape declared in the ocr-plus library's
  // types.ts and emitted by RNVisionCameraOCR.swift. boundingCenterX/Y are
  // set to the rect's true center since that's what the native plugin's
  // processFrame helper writes there. The bare x/y fields are populated with
  // a nonsense sentinel value (-9999) to verify the parser ignores them and
  // reconstructs the origin from the reliable center values.
  function makeFrame(left: number, top: number, width: number, height: number) {
    return {
      x: -9999,
      y: -9999,
      width,
      height,
      boundingCenterX: left + width / 2,
      boundingCenterY: top + height / 2,
    };
  }

  it("extracts lines from a typical multi-line block", () => {
    const data = {
      resultText: "Hello\nWorld",
      blocks: [
        {
          blockText: "Hello\nWorld",
          blockFrame: makeFrame(10, 20, 200, 80),
          lines: [
            { lineText: "Hello", lineFrame: makeFrame(10, 20, 100, 30) },
            { lineText: "World", lineFrame: makeFrame(10, 55, 100, 30) },
          ],
        },
      ],
    };

    expect(parseOCRFrameData(data)).toEqual([
      { text: "Hello", imageFrame: { top: 20, left: 10, width: 100, height: 30 } },
      { text: "World", imageFrame: { top: 55, left: 10, width: 100, height: 30 } },
    ]);
  });

  it("reconstructs top/left from boundingCenter minus half the size", () => {
    // The plugin's bare x/y are munged; only boundingCenterX/Y (= midX/midY)
    // are reliable. The parser must ignore the sentinel x/y in makeFrame
    // and compute the origin from the center values. If a future change
    // tries to read raw x/y again, this test fails loudly.
    const data = {
      blocks: [
        {
          blockText: "Sign",
          blockFrame: makeFrame(42, 99, 60, 20),
          lines: [{ lineText: "Sign", lineFrame: makeFrame(42, 99, 60, 20) }],
        },
      ],
    };
    const parsed = parseOCRFrameData(data);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].imageFrame.top).toBe(99);
    expect(parsed[0].imageFrame.left).toBe(42);
    expect(parsed[0].imageFrame.width).toBe(60);
    expect(parsed[0].imageFrame.height).toBe(20);
  });

  it("falls back to raw x/y when boundingCenter is missing (defensive Android path)", () => {
    // If the plugin ever omits boundingCenterX/Y (older Android builds or
    // lightweight mode tweaks), the parser should still return something
    // usable rather than throwing or silently dropping the line.
    const data = {
      blocks: [
        {
          blockText: "Legacy",
          blockFrame: { x: 5, y: 7, width: 50, height: 20 },
          lines: [{ lineText: "Legacy", lineFrame: { x: 5, y: 7, width: 50, height: 20 } }],
        },
      ],
    };
    const parsed = parseOCRFrameData(data);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].imageFrame).toEqual({ top: 7, left: 5, width: 50, height: 20 });
  });

  it("falls back to block-level text when a block has no lines (Android lightweight mode)", () => {
    const data = {
      blocks: [
        {
          blockText: "DANGER",
          blockFrame: makeFrame(0, 0, 150, 50),
          lines: [],
        },
        {
          blockText: "KEEP OUT",
          blockFrame: makeFrame(0, 60, 150, 50),
          // lines key omitted entirely — valid JSON the plugin can emit
        },
      ],
    };

    expect(parseOCRFrameData(data)).toEqual([
      { text: "DANGER", imageFrame: { top: 0, left: 0, width: 150, height: 50 } },
      { text: "KEEP OUT", imageFrame: { top: 60, left: 0, width: 150, height: 50 } },
    ]);
  });

  it("skips blank-text lines without dropping the rest of the block", () => {
    const data = {
      blocks: [
        {
          blockText: "Real\n   ",
          blockFrame: makeFrame(0, 0, 100, 60),
          lines: [
            { lineText: "Real", lineFrame: makeFrame(0, 0, 100, 30) },
            { lineText: "   ", lineFrame: makeFrame(0, 30, 100, 30) },
            { lineText: "", lineFrame: makeFrame(0, 60, 100, 30) },
          ],
        },
      ],
    };
    const parsed = parseOCRFrameData(data);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe("Real");
  });

  it("skips lines with a missing frame", () => {
    const data = {
      blocks: [
        {
          blockText: "Text",
          blockFrame: makeFrame(0, 0, 100, 30),
          lines: [
            { lineText: "Text", lineFrame: makeFrame(0, 0, 100, 30) },
            // Line with no frame — should not throw, just get skipped.
            { lineText: "Orphan" } as unknown as { lineText: string; lineFrame: { x: number; y: number; width: number; height: number } },
          ],
        },
      ],
    };
    expect(parseOCRFrameData(data)).toHaveLength(1);
  });

  it("returns an empty array for null/undefined/missing blocks", () => {
    expect(parseOCRFrameData(null)).toEqual([]);
    expect(parseOCRFrameData(undefined)).toEqual([]);
    expect(parseOCRFrameData({})).toEqual([]);
    expect(parseOCRFrameData({ blocks: [] })).toEqual([]);
  });

  it("returns an empty array for the old `result.blocks` wrapper shape (not emitted by the plugin)", () => {
    // The previous parser speculatively read `ocrData?.result?.blocks` as a
    // fallback. The native plugin NEVER wraps its output in `result` — the
    // top-level keys are `blocks` and `resultText` directly.
    const data = {
      result: {
        blocks: [
          {
            blockText: "Ignored",
            blockFrame: makeFrame(0, 0, 10, 10),
            lines: [{ lineText: "Ignored", lineFrame: makeFrame(0, 0, 10, 10) }],
          },
        ],
      },
    };
    expect(parseOCRFrameData(data)).toEqual([]);
  });

  it("ignores the old pre-fix shape (bare text/frame keys without the container prefix)", () => {
    // This is the shape the old broken parser expected. The plugin never
    // emits this.
    const data = {
      blocks: [
        {
          text: "OldShape",
          frame: { top: 0, left: 0, width: 100, height: 30 },
          lines: [{ text: "OldShape", frame: { top: 0, left: 0, width: 100, height: 30 } }],
        },
      ],
    };
    expect(parseOCRFrameData(data)).toEqual([]);
  });

  it("trims surrounding whitespace from each line's text", () => {
    const data = {
      blocks: [
        {
          blockText: "  spaced  ",
          blockFrame: makeFrame(0, 0, 100, 30),
          lines: [{ lineText: "  spaced  ", lineFrame: makeFrame(0, 0, 100, 30) }],
        },
      ],
    };
    expect(parseOCRFrameData(data)[0].text).toBe("spaced");
  });
});

describe("mapImageRectToScreen", () => {
  // Aspect-fill ("cover") mapping: scale by max(sw/iw, sh/ih), center,
  // overflow crops on the longer axis. Same math VisionCamera / Image
  // resizeMode="cover" use, so if the camera preview fills the screen and
  // we project OCR rectangles through this function, they land on top of
  // their source text.

  it("maps the image center to the screen center", () => {
    // 1080×1920 image onto a 390×844 screen (iPhone 13 portrait).
    // Scale = max(390/1080, 844/1920) = 0.4396 (vertical axis dominates).
    // A zero-size rect whose origin is the image center (540, 960) should
    // project to the screen's center (195, 422).
    const mapped = mapImageRectToScreen(
      { left: 540, top: 960, width: 0, height: 0 },
      1080,
      1920,
      390,
      844
    );
    expect(mapped.left).toBeCloseTo(195, 0);
    expect(mapped.top).toBeCloseTo(422, 0);
  });

  it("scales width/height by the cover scale factor", () => {
    // 1000×1000 image onto a 500×500 screen → scale 0.5.
    const mapped = mapImageRectToScreen(
      { left: 100, top: 200, width: 300, height: 400 },
      1000,
      1000,
      500,
      500
    );
    expect(mapped.width).toBe(150);
    expect(mapped.height).toBe(200);
  });

  it("projects the image's left edge to the screen's left edge when aspects match", () => {
    const mapped = mapImageRectToScreen(
      { left: 0, top: 0, width: 100, height: 100 },
      1000,
      1000,
      500,
      500
    );
    expect(mapped.left).toBe(0);
    expect(mapped.top).toBe(0);
    expect(mapped.width).toBe(50);
    expect(mapped.height).toBe(50);
  });

  it("handles a portrait image on a landscape screen (image overflows vertically)", () => {
    // 1080×1920 onto a 844×390 landscape screen.
    // Scale = max(844/1080, 390/1920) = 0.7815 (horizontal axis dominates).
    // Display height 1920*0.7815 = 1500 overflows vertically, offsetY = -555.
    // Image center (540, 960) should land at screen center (422, 195).
    const mapped = mapImageRectToScreen(
      { left: 540, top: 960, width: 0, height: 0 },
      1080,
      1920,
      844,
      390
    );
    expect(mapped.left).toBeCloseTo(422, 0);
    expect(mapped.top).toBeCloseTo(195, 0);
  });

  it("returns zeros for an empty image (division-by-zero guard)", () => {
    expect(
      mapImageRectToScreen({ left: 10, top: 10, width: 10, height: 10 }, 0, 0, 500, 500)
    ).toEqual({ top: 0, left: 0, width: 0, height: 0 });
  });
});
