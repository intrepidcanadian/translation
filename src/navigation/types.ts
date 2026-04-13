import type { ScannerModeKey } from "../services/scannerModes";

export type RootTabParamList = {
  Translate: { sourceLang?: string; targetLang?: string; text?: string } | undefined;
  Scan: { mode?: "live" | "product" | "sell" | ScannerModeKey } | undefined;
  Notes: undefined;
  Settings: undefined;
};
