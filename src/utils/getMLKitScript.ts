import { TextRecognitionScript } from "@react-native-ml-kit/text-recognition";

/**
 * Map a BCP-47 language code to the ML Kit text recognition script
 * best suited for that language's writing system.
 *
 * Shared across every scanner component that runs on-device OCR
 * (CameraTranslator, DocumentScanner, DutyFreeCatalogScanner,
 * ListingGenerator, PriceTagConverter).
 */
export function getMLKitScript(langCode: string): TextRecognitionScript {
  switch (langCode) {
    case "zh": return TextRecognitionScript.CHINESE;
    case "ja": return TextRecognitionScript.JAPANESE;
    case "ko": return TextRecognitionScript.KOREAN;
    case "hi": return TextRecognitionScript.DEVANAGARI;
    default: return TextRecognitionScript.LATIN;
  }
}
