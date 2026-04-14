/**
 * @jest-environment node
 */
jest.mock("expo-linking", () => ({
  createURL: (p: string) => `livetranslator://${p}`,
}));

jest.mock("../services/translation", () => ({
  LANGUAGE_MAP: new Map([
    ["en", {}],
    ["es", {}],
    ["fr", {}],
    ["de", {}],
    ["zh", {}],
  ]),
}));

jest.mock("../services/scannerModes", () => ({
  SCANNER_MODES: [
    { key: "document" },
    { key: "receipt" },
    { key: "menu" },
  ],
}));

import { linking } from "../navigation/linking";

describe("deep link validation", () => {
  const translate = linking.config!.screens!.Translate as any;
  const scan = linking.config!.screens!.Scan as any;

  describe("language params", () => {
    test("accepts known language codes", () => {
      expect(translate.parse.sourceLang("en")).toBe("en");
      expect(translate.parse.targetLang("ES")).toBe("es");
    });

    test("rejects unknown language codes", () => {
      expect(translate.parse.sourceLang("xx")).toBeUndefined();
      expect(translate.parse.targetLang("<script>")).toBeUndefined();
    });

    test("accepts autodetect sentinel", () => {
      expect(translate.parse.sourceLang("autodetect")).toBe("autodetect");
    });

    test("handles empty/undefined", () => {
      expect(translate.parse.sourceLang("")).toBeUndefined();
      expect(translate.parse.sourceLang(undefined as any)).toBeUndefined();
    });
  });

  describe("scan mode param", () => {
    test("accepts built-in modes", () => {
      expect(scan.parse.mode("live")).toBe("live");
      expect(scan.parse.mode("product")).toBe("product");
      expect(scan.parse.mode("sell")).toBe("sell");
    });

    test("accepts scanner modes", () => {
      expect(scan.parse.mode("document")).toBe("document");
      expect(scan.parse.mode("MENU")).toBe("menu");
    });

    test("rejects unknown modes", () => {
      expect(scan.parse.mode("hacker")).toBeUndefined();
      expect(scan.parse.mode("../etc/passwd")).toBeUndefined();
    });
  });
});
