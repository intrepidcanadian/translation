/**
 * Regression tests for `parseOCRFrameData` — the pure parser that normalizes
 * the raw react-native-vision-camera-ocr-plus frame callback into flat
 * `{ text, frame }` pairs for the live OCR overlay.
 *
 * These tests exist because the parser shipped broken from the feature's
 * introduction in 7bf321d and stayed broken for months: the hook read
 * `block.text` / `line.text` / `block.frame` / `line.frame`, but the native
 * plugin actually emits `blockText` / `lineText` / `blockFrame` / `lineFrame`
 * (see node_modules/react-native-vision-camera-ocr-plus/src/types.ts and
 * ios/RNVisionCameraOCR.swift line 140+). Every live camera frame silently
 * parsed to zero lines, so the user saw no translation overlays at all.
 *
 * The fixture shapes below mirror what the iOS plugin actually emits — if a
 * future lib upgrade renames the fields again, these tests fail loudly
 * instead of the UI going mysteriously blank.
 */

import { parseOCRFrameData } from "../hooks/useLiveOCR";

describe("parseOCRFrameData", () => {
  // Fixture built to match the `Text` shape declared in the ocr-plus library's
  // types.ts: top-level `{ blocks: BlockData[], resultText }`, each block
  // `{ blockText, blockFrame, lines: LineData[] }`, each line
  // `{ lineText, lineFrame }`. Frame keys are `x/y/width/height` per the
  // plugin's processFrame helper.
  function makeFrame(x: number, y: number, width: number, height: number) {
    return { x, y, width, height, boundingCenterX: x + width / 2, boundingCenterY: y + height / 2 };
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
      { text: "Hello", frame: { top: 20, left: 10, width: 100, height: 30 } },
      { text: "World", frame: { top: 55, left: 10, width: 100, height: 30 } },
    ]);
  });

  it("maps x/y keys to left/top (not the old frame.top/frame.left fallback)", () => {
    // The previous parser had a `line.frame.y ?? line.frame.top ?? 0` fallback
    // that suggested someone already knew the keys were x/y. The lineFrame
    // object has no `top`/`left` fields at all — those were always undefined.
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
    expect(parsed[0].frame.top).toBe(99);
    expect(parsed[0].frame.left).toBe(42);
  });

  it("falls back to block-level text when a block has no lines (Android lightweight mode)", () => {
    // Android's useLightweightMode path emits blocks without line
    // decomposition — blockText is the full extracted string and lines is
    // empty or undefined.
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
      { text: "DANGER", frame: { top: 0, left: 0, width: 150, height: 50 } },
      { text: "KEEP OUT", frame: { top: 60, left: 0, width: 150, height: 50 } },
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
    // top-level keys are `blocks` and `resultText` directly. Pinning this
    // explicitly catches any future regression that tries to reintroduce the
    // wrapper without understanding why it's wrong.
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
    // emits this — we include it as a negative test so that any attempt to
    // "re-support" both naming schemes at once will have to delete this test
    // and justify the decision in review.
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
