/**
 * Regression tests for `makeStableBlockId` — the helper that generates
 * overlay keys for live OCR labels.
 *
 * History: the ID used to be `${frame.top}-${frame.left}-${text.slice(0,10)}`
 * using raw screen pixel coordinates. OCR jitter on the same physical line
 * produces a 5-20 px frame-to-frame drift, so every frame generated a
 * fresh ID, every label allocated a new Animated.Value, and every label
 * re-ran its 200 ms fade-in. Result: visible flicker/strobe on live
 * overlays.
 *
 * These tests pin:
 *  1. Small jitter inside a 32-px bucket produces the SAME id (so the
 *     fade-in runs once per physical line, not once per frame)
 *  2. Different physical lines still produce different ids
 *  3. Distinct text at the same bucketed position still produces different
 *     ids (two neighbouring words on a sign don't collide)
 *  4. Bucket boundaries are reached at integer multiples of 32 — crossing
 *     into a new bucket gets a new id (intentional, matches real repositioning)
 */

import { makeStableBlockId, mapImageRectToScreen } from "../utils/rectMapping";

describe("makeStableBlockId", () => {
  const BASE = { top: 100, left: 50, width: 120, height: 28 };

  it("absorbs sub-bucket jitter: same text drifting by 5-20 px keeps the same id", () => {
    const id0 = makeStableBlockId(BASE, "Welcome");
    // Typical OCR noise: a few pixels in either direction on consecutive frames.
    const id1 = makeStableBlockId({ ...BASE, top: 103, left: 52 }, "Welcome");
    const id2 = makeStableBlockId({ ...BASE, top: 108, left: 48 }, "Welcome");
    const id3 = makeStableBlockId({ ...BASE, top: 115, left: 55 }, "Welcome");
    expect(id1).toBe(id0);
    expect(id2).toBe(id0);
    expect(id3).toBe(id0);
  });

  it("produces different ids for the same text at clearly different positions", () => {
    // Two "Open" signs at opposite ends of a storefront should animate
    // independently — same text, very different positions.
    const idA = makeStableBlockId({ top: 100, left: 40, width: 60, height: 28 }, "Open");
    const idB = makeStableBlockId({ top: 100, left: 300, width: 60, height: 28 }, "Open");
    expect(idA).not.toBe(idB);
  });

  it("produces different ids for different text at the same position", () => {
    // A menu line that swaps from "Coffee" to "Tea" while the OCR rect
    // barely moves should NOT reuse the same animated value — the content
    // is different so a fresh fade-in is the right behavior.
    const idA = makeStableBlockId(BASE, "Coffee");
    const idB = makeStableBlockId(BASE, "Tea");
    expect(idA).not.toBe(idB);
  });

  it("crosses to a new id when the rect moves a full bucket (32 px)", () => {
    // Intentional: a real repositioning (phone pan) should invalidate the
    // cached opacity so the label re-announces itself. The sub-bucket
    // jitter test above guarantees the threshold is high enough not to
    // fire spuriously on OCR noise.
    const idHere = makeStableBlockId(BASE, "Welcome");
    const idThere = makeStableBlockId({ ...BASE, top: BASE.top + 64 }, "Welcome");
    expect(idHere).not.toBe(idThere);
  });

  it("truncates text keys at 20 chars to bound the key size", () => {
    // Two lines that share a 20-char prefix but differ after that WILL
    // collide by design. The trade-off: a few edge-case false collisions
    // vs. unbounded key growth on long OCR output. Pin the behavior so a
    // future change doesn't silently widen the prefix and blow up the
    // Map key cardinality in long sessions.
    const long1 = "This is a long menu item that goes on and on #1";
    const long2 = "This is a long menu item that goes on and on #2";
    // First 20 chars match → bucketed IDs match.
    expect(makeStableBlockId(BASE, long1)).toBe(makeStableBlockId(BASE, long2));
  });
});

// Quick sanity check that mapImageRectToScreen is still exported from
// utils/rectMapping.ts (not just the re-export from useLiveOCR). If this
// fails, someone probably collapsed the util back into the hook.
describe("mapImageRectToScreen (util export)", () => {
  it("is exported from utils/rectMapping.ts with identical semantics", () => {
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
});
