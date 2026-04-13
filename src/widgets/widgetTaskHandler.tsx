import React from "react";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logger } from "../services/logger";
import { TranslateWidget } from "./TranslateWidget";

const WIDGET_DATA_KEY = "widget_last_translation";

const nameToWidget: Record<string, React.FC<Record<string, string>>> = {
  TranslateWidget: TranslateWidget,
};

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const widgetInfo = props.widgetInfo;
  const Widget = nameToWidget[widgetInfo.widgetName];

  if (!Widget) return;

  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED": {
      // Load last translation from storage
      let widgetProps: Record<string, string> = {};
      try {
        const stored = await AsyncStorage.getItem(WIDGET_DATA_KEY);
        if (stored) {
          widgetProps = JSON.parse(stored);
        }
      } catch (err) { logger.warn("Widget", "Widget data load failed", err); }

      props.renderWidget(<Widget {...widgetProps} />);
      break;
    }

    case "WIDGET_CLICK": {
      const action = props.clickAction;
      if (action === "OPEN_APP" || action === "VOICE_TRANSLATE" || action === "PASTE_TRANSLATE") {
        // These will open the app — the quick action handler in App.tsx will take it from there
        props.renderWidget(<Widget />);
      }
      break;
    }

    case "WIDGET_DELETED":
      break;

    default:
      break;
  }
}
