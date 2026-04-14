/**
 * @jest-environment node
 *
 * Pins the `isLikelyMicMuted` predicate + threshold that drive both the
 * Settings → Translation Diagnostics dashboard (#156) and the inline hint
 * near the mic button (#160). A regression in this util would either nag
 * users in a legitimately quiet room or miss a genuinely stuck-mic
 * session — so the boundary cases matter.
 */
import { isLikelyMicMuted, MIC_MUTED_HINT_THRESHOLD } from "../utils/micMuted";

describe("isLikelyMicMuted", () => {
  test("threshold constant is the documented 3 — breaking this is a user-visible tuning change", () => {
    // Not sacred, but any future tweak should land deliberately alongside a
    // new test value so reviewers know the threshold moved.
    expect(MIC_MUTED_HINT_THRESHOLD).toBe(3);
  });

  test("returns false when there has been at least one successful translate, regardless of noSpeech count", () => {
    // The instant a translation lands the user is clearly not stuck.
    expect(isLikelyMicMuted(0, 1)).toBe(false);
    expect(isLikelyMicMuted(5, 1)).toBe(false);
    expect(isLikelyMicMuted(100, 10)).toBe(false);
  });

  test("returns false under the threshold — single silent taps shouldn't nag", () => {
    expect(isLikelyMicMuted(0, 0)).toBe(false);
    expect(isLikelyMicMuted(1, 0)).toBe(false);
    expect(isLikelyMicMuted(2, 0)).toBe(false);
  });

  test("returns true at exactly the threshold", () => {
    expect(isLikelyMicMuted(3, 0)).toBe(true);
  });

  test("returns true above the threshold", () => {
    expect(isLikelyMicMuted(4, 0)).toBe(true);
    expect(isLikelyMicMuted(25, 0)).toBe(true);
  });

  test("a single successful translate clears the hint even if noSpeech count is high — this is the 'session heals itself' property", () => {
    // User struggles through a couple of silent attempts (noSpeech=5),
    // then finally lands a translation (success=1). The hint should
    // immediately disappear; otherwise it would stick around as a
    // false positive for the rest of the session.
    expect(isLikelyMicMuted(5, 1)).toBe(false);
  });

  test("negative inputs are treated as 'no signal' (defensive — the hook never passes these, but callers could)", () => {
    // Both branches require successCount === 0 and noSpeechCount >= 3,
    // so negatives on either side fall through to false.
    expect(isLikelyMicMuted(-1, 0)).toBe(false);
    expect(isLikelyMicMuted(3, -1)).toBe(false);
  });
});
