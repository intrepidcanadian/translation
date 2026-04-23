import { Alert } from "react-native";
import * as Speech from "expo-speech";
import { copyWithAutoClear } from "../services/clipboard";
import { logger } from "../services/logger";

/**
 * Action sheet for a tapped OCR block — shows Copy Translation / Copy
 * Original / Speak / Cancel. Shared between:
 *
 *  - CameraTranslator live overlays (tap-to-copy/speak — #10)
 *  - CameraTranslator captured-photo overlays
 *  - DualStreamView live overlays
 *
 * Previously `usePhotoCapture.handleBlockTap` inlined this Alert, and
 * live labels had `pointerEvents="none"` so they weren't interactive at
 * all — learners trying to hear a sign pronounced had to capture the
 * photo first. Pulling the action sheet out into a util lets the live
 * overlays wire up the same behavior without duplicating the Alert
 * config across three files.
 *
 * `copyWithAutoClear` wipes the clipboard after 60s so signs / labels /
 * document snippets that might contain personal info don't linger
 * indefinitely (same auto-wipe used elsewhere for OCR output — see #128).
 */
export function showBlockActionSheet(
  originalText: string,
  translatedText: string,
  targetLangCode: string
): void {
  Alert.alert(
    translatedText,
    originalText,
    [
      {
        text: "Copy Translation",
        onPress: () => {
          copyWithAutoClear(translatedText);
        },
      },
      {
        text: "Copy Original",
        onPress: () => {
          copyWithAutoClear(originalText);
        },
      },
      {
        text: "Speak",
        onPress: () => {
          try {
            Speech.speak(translatedText, { language: targetLangCode });
          } catch (err) {
            logger.warn("Speech", "OCR block speak failed", err);
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]
  );
}
