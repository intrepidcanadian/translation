import type { ScannerModeKey } from "../services/scannerModes";

export type RootTabParamList = {
  Translate: undefined;
  Scan: { mode?: "live" | "product" | "sell" | ScannerModeKey } | undefined;
  Notes: undefined;
  Settings: undefined;
};
