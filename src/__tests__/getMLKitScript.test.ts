import { TextRecognitionScript } from "@react-native-ml-kit/text-recognition";
import { getMLKitScript } from "../utils/getMLKitScript";

describe("getMLKitScript", () => {
  it("maps zh to CHINESE", () => {
    expect(getMLKitScript("zh")).toBe(TextRecognitionScript.CHINESE);
  });

  it("maps ja to JAPANESE", () => {
    expect(getMLKitScript("ja")).toBe(TextRecognitionScript.JAPANESE);
  });

  it("maps ko to KOREAN", () => {
    expect(getMLKitScript("ko")).toBe(TextRecognitionScript.KOREAN);
  });

  it("maps hi to DEVANAGARI", () => {
    expect(getMLKitScript("hi")).toBe(TextRecognitionScript.DEVANAGARI);
  });

  it("defaults to LATIN for en", () => {
    expect(getMLKitScript("en")).toBe(TextRecognitionScript.LATIN);
  });

  it("defaults to LATIN for es", () => {
    expect(getMLKitScript("es")).toBe(TextRecognitionScript.LATIN);
  });

  it("defaults to LATIN for ar", () => {
    expect(getMLKitScript("ar")).toBe(TextRecognitionScript.LATIN);
  });

  it("defaults to LATIN for unknown codes", () => {
    expect(getMLKitScript("xyz")).toBe(TextRecognitionScript.LATIN);
  });

  it("defaults to LATIN for empty string", () => {
    expect(getMLKitScript("")).toBe(TextRecognitionScript.LATIN);
  });
});
