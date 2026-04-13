import type { LinkingOptions } from "@react-navigation/native";
import * as Linking from "expo-linking";
import type { RootTabParamList } from "./types";

export const linking: LinkingOptions<RootTabParamList> = {
  prefixes: [Linking.createURL("/"), "livetranslator://"],
  config: {
    screens: {
      Translate: {
        path: "translate/:sourceLang?/:targetLang?",
        parse: {
          sourceLang: (value: string) => value || undefined,
          targetLang: (value: string) => value || undefined,
        },
      },
      Scan: {
        path: "scan/:mode?",
        parse: {
          mode: (value: string) => value || undefined,
        },
      },
      Notes: "notes",
      Settings: "settings",
    },
  },
};
