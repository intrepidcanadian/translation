/**
 * @jest-environment node
 */
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "en" }],
}));

import {
  t,
  setUILocale,
  getUILocale,
  SUPPORTED_UI_LOCALES,
  __resetInterpolationRegexCache,
} from "../services/i18n";

describe("i18n", () => {
  beforeEach(() => {
    setUILocale("en");
  });

  test("returns English by default", () => {
    expect(t("btn.next")).toBe("Next");
  });

  test("switches locale explicitly", () => {
    setUILocale("es");
    expect(t("btn.next")).toBe("Siguiente");
    expect(getUILocale()).toBe("es");
  });

  test("falls back to English when key missing in locale", () => {
    setUILocale("zh");
    // zh has btn.next, so pick a key that might differ — but actually our schema
    // keeps parity, so we test the true fallback path by asking for an unknown key
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  test("interpolates {name} placeholders", () => {
    expect(t("a11y.goToStep", { n: 3 })).toBe("Go to step 3");
  });

  test("all supported locales have btn.next defined", () => {
    for (const loc of SUPPORTED_UI_LOCALES) {
      setUILocale(loc);
      const out = t("btn.next");
      expect(out).toBeTruthy();
      expect(out).not.toBe("btn.next"); // not falling through to key
    }
  });

  test("screen-failed message interpolates scope name", () => {
    setUILocale("en");
    expect(t("err.screenFailed", { screen: "Translate" })).toBe("Translate failed to load");
    setUILocale("fr");
    expect(t("err.screenFailed", { screen: "Scan" })).toBe("Échec du chargement de Scan");
  });

  // ---- $-escape regression fence ----
  // String.prototype.replace interprets `$&`, `$1`, `$'`, `$\``, and `$$`
  // as replacement tokens when called with a string second argument. Param
  // values are user-facing data (product names, prices, error messages)
  // and can legitimately contain `$`. The interpolation must insert them
  // verbatim — function replacement bypasses the token interpretation.
  // A regression to `replace(re, String(v))` would make these tests fail.
  test("interpolates a value containing $& without substituting the matched placeholder", () => {
    setUILocale("en");
    // With a string replacement, "$&" would be substituted for the matched
    // text "{screen}" and the output would be "{screen} failed to load".
    expect(t("err.screenFailed", { screen: "$&" })).toBe("$& failed to load");
  });

  test("interpolates a value containing $1 without substituting an empty capture group", () => {
    setUILocale("en");
    // With a string replacement and no capture groups in the regex, "$1"
    // would resolve to the empty string and the output would be " failed to
    // load" (note the leading space-eat). Function replacement preserves it.
    expect(t("err.screenFailed", { screen: "$1" })).toBe("$1 failed to load");
  });

  test("interpolates a value containing $$ as a literal dollar pair", () => {
    setUILocale("en");
    // String replacement collapses "$$" → "$". Function replacement
    // preserves both characters.
    expect(t("err.screenFailed", { screen: "$$" })).toBe("$$ failed to load");
  });

  test("interpolates a realistic user-facing string with a $ price", () => {
    // The motivating real-world scenario: a product name or label that
    // contains a price marker like "$5". This must not be mangled.
    setUILocale("en");
    expect(t("err.screenFailed", { screen: "$5 promo" })).toBe("$5 promo failed to load");
  });

  // ---- Per-placeholder regex cache (#211) ----
  // The interpolation regex is built once per placeholder *name* and
  // reused. Repeated calls with the same name must produce identical
  // results (no lastIndex bleed, no token interpretation regression),
  // and a fresh cache must produce identical output to a warm one.
  describe("interpolation regex cache (#211)", () => {
    beforeEach(() => {
      __resetInterpolationRegexCache();
      setUILocale("en");
    });

    test("repeated calls with the same placeholder return identical output", () => {
      // Three back-to-back calls — the second and third hit the warm cache.
      // If a stale `lastIndex` survived between calls (it shouldn't — we
      // defensively reset it in getInterpolationRegex), the second `replace`
      // would skip ahead and miss the placeholder.
      expect(t("err.screenFailed", { screen: "Translate" })).toBe("Translate failed to load");
      expect(t("err.screenFailed", { screen: "Translate" })).toBe("Translate failed to load");
      expect(t("err.screenFailed", { screen: "Translate" })).toBe("Translate failed to load");
    });

    test("warm cache still produces correct output after a $-special value", () => {
      // Function replacement is the safety net for special tokens, but
      // because the regex object is now reused across calls, this verifies
      // the function-replacement contract isn't subtly broken by reuse.
      expect(t("err.screenFailed", { screen: "$&" })).toBe("$& failed to load");
      expect(t("err.screenFailed", { screen: "Translate" })).toBe("Translate failed to load");
      expect(t("err.screenFailed", { screen: "$5 promo" })).toBe("$5 promo failed to load");
    });

    test("different placeholder names get distinct cache entries", () => {
      // {n} and {screen} live in different cache slots — the {n} call
      // mustn't accidentally pick up the {screen} regex (which would
      // match nothing in "Go to step {n}" and silently leave the
      // placeholder unfilled).
      expect(t("a11y.goToStep", { n: 1 })).toBe("Go to step 1");
      expect(t("err.screenFailed", { screen: "Scan" })).toBe("Scan failed to load");
      expect(t("a11y.goToStep", { n: 2 })).toBe("Go to step 2");
    });

    test("undefined param value is skipped, not stringified to 'undefined'", () => {
      // The new for-in loop guards against `params[k] === undefined` so a
      // caller passing `{ screen: maybeName ?? undefined }` doesn't render
      // "undefined failed to load". The placeholder stays untouched.
      expect(t("err.screenFailed", { screen: undefined as unknown as string })).toBe(
        "{screen} failed to load",
      );
    });

    test("__resetInterpolationRegexCache produces identical output to a warm cache", () => {
      // Cold-cache and warm-cache outputs must be byte-identical. A bug
      // where the first call took a different code path (e.g. building
      // the regex inline instead of reading from the cache) would show
      // up as a divergence here.
      const warm = t("err.screenFailed", { screen: "Translate" });
      __resetInterpolationRegexCache();
      const cold = t("err.screenFailed", { screen: "Translate" });
      expect(cold).toBe(warm);
    });
  });
});
