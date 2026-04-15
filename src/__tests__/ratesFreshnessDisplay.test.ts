/**
 * @jest-environment node
 *
 * Unit tests for `src/utils/ratesFreshnessDisplay.ts` — the shared display
 * formatters for `RatesFreshnessGrade` used by both SettingsModal
 * (dashboard square-bracket tag + crash report) and PriceTagConverter
 * (user-facing warning chip on the results header).
 *
 * Three functions, three coverage goals:
 *
 *  1. `freshnessGradeTag` — every grade returns the exact spelling the
 *     SettingsModal dashboard + buildCrashReport rely on, and `fresh` returns
 *     `null` so the healthy path stays uncluttered.
 *
 *  2. `gradeWarningText` — every grade maps to the right user-facing chip
 *     text, `null` and `fresh` both return `null` (no chip), and the warning
 *     severity cues (⚠️) are present on the hard-warning grades and absent
 *     on the soft one.
 *
 *  3. `isSoftWarning` — only `stale-ok` qualifies; everything else (including
 *     `null` and `fresh`) is either "no chip at all" or "hard alert".
 *
 * All three functions are pure (no clock reads, no React state), so the
 * tests are trivial input→output assertions. No mocks required, but we still
 * pin @jest-environment node so the suite is cheap to run.
 */

import {
  freshnessGradeTag,
  gradeWarningText,
  isSoftWarning,
} from "../utils/ratesFreshnessDisplay";
import type { RatesFreshnessGrade } from "../services/currencyExchange";

// All five grades the bucketizer produces. Kept as a const array so the
// exhaustive-mapping tests below can assert the whole set in one place —
// a future grade addition would force the test to update explicitly,
// catching silent display-formatter drift.
const ALL_GRADES: readonly RatesFreshnessGrade[] = [
  "fresh",
  "stale-ok",
  "stale-warn",
  "stale-critical",
  "none",
] as const;

describe("freshnessGradeTag", () => {
  it("returns null for fresh (healthy path stays uncluttered)", () => {
    // The dashboard row already renders "Exchange rates: Updated 5m ago" on
    // the healthy path — adding a `[fresh]` tag there would be visual noise.
    expect(freshnessGradeTag("fresh")).toBeNull();
  });

  it("returns 'stale' for stale-ok (short informational tag)", () => {
    expect(freshnessGradeTag("stale-ok")).toBe("stale");
  });

  it("returns 'stale · consider refresh' for stale-warn", () => {
    // Exact string is pinned — SettingsModal + buildCrashReport both render
    // it verbatim, so a typo correction would be a coordinated change.
    expect(freshnessGradeTag("stale-warn")).toBe("stale · consider refresh");
  });

  it("returns 'critical · refresh now' for stale-critical", () => {
    expect(freshnessGradeTag("stale-critical")).toBe("critical · refresh now");
  });

  it("returns 'no cache · using built-in' for none (fallback rates)", () => {
    // `none` means the app is running off the compile-time FALLBACK_RATES
    // table. The tag has to communicate "this is wrong" without being as
    // alarming as "critical" — "built-in" is the specific signal.
    expect(freshnessGradeTag("none")).toBe("no cache · using built-in");
  });

  it("returns a string or null for every grade in the union (exhaustive check)", () => {
    // Regression fence — if a new grade is added to `RatesFreshnessGrade`
    // and `freshnessGradeTag` forgets to handle it, the compiler catches
    // the missing switch branch, but this test also fails loudly so the
    // test suite breaks in a PR review as well. Belt + suspenders.
    for (const g of ALL_GRADES) {
      const tag = freshnessGradeTag(g);
      expect(tag === null || typeof tag === "string").toBe(true);
    }
  });

  it("non-null tags are all short enough to fit inline (< 30 chars)", () => {
    // The dashboard row has limited horizontal space next to the age label —
    // keeping tags short enough to not wrap is part of the contract. 30
    // chars is the empirical budget after the "Exchange rates:" label on a
    // narrow iPhone SE width.
    for (const g of ALL_GRADES) {
      const tag = freshnessGradeTag(g);
      if (tag !== null) {
        expect(tag.length).toBeLessThan(30);
      }
    }
  });
});

describe("gradeWarningText", () => {
  it("returns null for null grade (not yet computed)", () => {
    // PriceTagConverter initializes `ratesGrade` to null before the first
    // conversion. The chip must not render on null — there's nothing to say.
    expect(gradeWarningText(null)).toBeNull();
  });

  it("returns null for fresh (healthy path, no chip)", () => {
    expect(gradeWarningText("fresh")).toBeNull();
  });

  it("returns soft informational text for stale-ok (no warning emoji)", () => {
    // stale-ok is the only "soft" warning — it pairs with an amber tint and
    // doesn't use the ⚠️ glyph so the user reads it as information, not
    // alarm. The absence of the emoji is part of the contract.
    const text = gradeWarningText("stale-ok");
    expect(text).toBe("Rates are a few hours old");
    expect(text).not.toContain("⚠️");
  });

  it("returns hard warning text for stale-warn (with warning emoji)", () => {
    const text = gradeWarningText("stale-warn");
    expect(text).toBe("⚠️ Rates are stale — refresh in Settings");
    expect(text).toContain("⚠️");
  });

  it("returns strongest warning text for stale-critical (with warning emoji)", () => {
    const text = gradeWarningText("stale-critical");
    expect(text).toBe("⚠️ Rates over 24h old — refresh now");
    expect(text).toContain("⚠️");
  });

  it("returns fallback-rates warning text for none (with warning emoji)", () => {
    // `none` means the app couldn't get any cached rates and is using the
    // compile-time fallback table. That's strictly worse than "stale" for
    // user accuracy, so the chip flags it with a warning emoji.
    const text = gradeWarningText("none");
    expect(text).toBe("⚠️ Using offline fallback rates");
    expect(text).toContain("⚠️");
  });

  it("all non-null warning texts fit the narrow-phone chip budget (≤ 44 chars)", () => {
    // The results-header chip has limited horizontal space. The empirical
    // budget that fits without wrapping at standard system font size on an
    // iPhone SE width is around 40 visible characters, but a leading "⚠️"
    // emoji counts as 2 UTF-16 code units (length === 2), so the JS string
    // length can run to ~44 while the rendered visual is ~40. 44 is the
    // hard ceiling — exceed it and the chip starts wrapping in production.
    for (const g of ALL_GRADES) {
      const text = gradeWarningText(g);
      if (text !== null) {
        expect(text.length).toBeLessThanOrEqual(44);
      }
    }
  });
});

describe("isSoftWarning", () => {
  it("returns true only for stale-ok", () => {
    expect(isSoftWarning("stale-ok")).toBe(true);
  });

  it("returns false for fresh (no chip, not a soft warning)", () => {
    expect(isSoftWarning("fresh")).toBe(false);
  });

  it("returns false for null (no chip)", () => {
    // `null` is not a warning at all — neither soft nor hard.
    expect(isSoftWarning(null)).toBe(false);
  });

  it("returns false for stale-warn (hard alert)", () => {
    expect(isSoftWarning("stale-warn")).toBe(false);
  });

  it("returns false for stale-critical (hard alert)", () => {
    expect(isSoftWarning("stale-critical")).toBe(false);
  });

  it("returns false for none (hard alert — fallback rates)", () => {
    // `none` is a hard alert, not soft — the app is actually running on the
    // compile-time fallback rates so the chip tints red, not amber.
    expect(isSoftWarning("none")).toBe(false);
  });

  it("matches the chip color contract: soft = stale-ok only", () => {
    // Exhaustive check — exactly one grade is "soft". Any future tuning that
    // widens or narrows the soft bucket has to update both the implementation
    // and this test, which is the whole point of the predicate living in one
    // place. Prevents a drift where the chip goes amber but the screen
    // reader announces it as a warning (or vice versa).
    const softGrades = ALL_GRADES.filter((g) => isSoftWarning(g));
    expect(softGrades).toEqual(["stale-ok"]);
  });
});

describe("SettingsModal + PriceTagConverter distinction", () => {
  it("freshnessGradeTag and gradeWarningText return different strings for the same grade", () => {
    // The two consumers use the same grade type but render different
    // surfaces: the dashboard tag is terse because the surrounding row
    // already carries context, while the user chip has to stand alone and
    // explain the situation. The exact strings are pinned above; this test
    // just captures the *distinctness* contract so a future refactor that
    // accidentally unifies them (e.g. "let's reuse the tag as the chip
    // text") fails loudly.
    for (const g of ["stale-ok", "stale-warn", "stale-critical", "none"] as const) {
      const tag = freshnessGradeTag(g);
      const warning = gradeWarningText(g);
      expect(tag).not.toBe(warning);
      // Both must be non-null for the non-fresh grades.
      expect(tag).not.toBeNull();
      expect(warning).not.toBeNull();
    }
  });

  it("both functions return null on fresh (healthy path silent on both surfaces)", () => {
    // The single grade where both surfaces agree to render nothing.
    expect(freshnessGradeTag("fresh")).toBeNull();
    expect(gradeWarningText("fresh")).toBeNull();
  });
});
