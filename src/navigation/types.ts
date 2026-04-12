import type { ScannerModeKey } from "../services/scannerModes";

export type RootTabParamList = {
  Translate: undefined;
  Scan: { mode?: "live" | ScannerModeKey } | undefined;
  Notes: undefined;
  Settings: undefined;
};
