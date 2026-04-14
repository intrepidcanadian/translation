import type { LinkingOptions } from "@react-navigation/native";
import * as Linking from "expo-linking";
import { LANGUAGE_MAP } from "../services/translation";
import { SCANNER_MODES } from "../services/scannerModes";
import type { RootTabParamList } from "./types";

// Deep link params are attacker-controlled (anyone can craft a
// `livetranslator://` URL), so we whitelist against the app's known modes
// and languages rather than passing raw strings into navigation state.
const BUILTIN_SCAN_MODES = new Set<string>(["live", "product", "sell"]);
const SCANNER_MODE_KEYS = new Set<string>(SCANNER_MODES.map((m) => m.key));

/** Validate a language code against the app's known LANGUAGES list. */
function validateLang(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim();
  // Allow "autodetect" as a sentinel source language
  if (normalized === "autodetect") return normalized;
  return LANGUAGE_MAP.has(normalized) ? normalized : undefined;
}

/** Validate a scan mode against known built-in and scanner modes. */
function validateMode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim();
  if (BUILTIN_SCAN_MODES.has(normalized) || SCANNER_MODE_KEYS.has(normalized)) {
    return normalized;
  }
  return undefined;
}

export const linking: LinkingOptions<RootTabParamList> = {
  prefixes: [Linking.createURL("/"), "livetranslator://"],
  config: {
    screens: {
      Translate: {
        path: "translate/:sourceLang?/:targetLang?",
        parse: {
          sourceLang: validateLang,
          targetLang: validateLang,
        },
      },
      Scan: {
        path: "scan/:mode?",
        parse: {
          mode: validateMode,
        },
      },
      Notes: "notes",
      Settings: "settings",
    },
  },
};
