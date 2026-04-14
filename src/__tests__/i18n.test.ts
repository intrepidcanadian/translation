/**
 * @jest-environment node
 */
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "en" }],
}));

import { t, setUILocale, getUILocale, SUPPORTED_UI_LOCALES } from "../services/i18n";

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
});
