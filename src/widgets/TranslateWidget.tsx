import React from "react";
import { FlexWidget, TextWidget } from "react-native-android-widget";

interface TranslateWidgetProps {
  lastOriginal?: string;
  lastTranslated?: string;
  sourceLang?: string;
  targetLang?: string;
}

export function TranslateWidget({
  lastOriginal = "Tap to translate",
  lastTranslated = "",
  sourceLang = "EN",
  targetLang = "ES",
}: TranslateWidgetProps) {
  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: "#1a1a2e",
        borderRadius: 16,
        padding: 16,
        flexDirection: "column",
        justifyContent: "space-between",
      }}
      clickAction="OPEN_APP"
    >
      <FlexWidget
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          width: "match_parent",
        }}
      >
        <TextWidget
          text="Live Translator"
          style={{
            fontSize: 14,
            fontWeight: "700",
            color: "#ffffff",
          }}
        />
        <TextWidget
          text={`${sourceLang.toUpperCase()} → ${targetLang.toUpperCase()}`}
          style={{
            fontSize: 12,
            color: "#6c63ff",
            fontWeight: "600",
          }}
        />
      </FlexWidget>

      <FlexWidget
        style={{
          flexDirection: "column",
          width: "match_parent",
          flex: 1,
          justifyContent: "center",
        }}
      >
        <TextWidget
          text={lastOriginal}
          style={{
            fontSize: 14,
            color: "#ccccdd",
          }}
          maxLines={2}
          truncate="END"
        />
        {lastTranslated ? (
          <TextWidget
            text={lastTranslated}
            style={{
              fontSize: 16,
              color: "#a8a4ff",
              fontWeight: "600",
              marginTop: 4,
            }}
            maxLines={2}
            truncate="END"
          />
        ) : null}
      </FlexWidget>

      <FlexWidget
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          width: "match_parent",
        }}
      >
        <FlexWidget
          clickAction="VOICE_TRANSLATE"
          style={{
            backgroundColor: "#6c63ff",
            borderRadius: 12,
            paddingVertical: 8,
            paddingHorizontal: 16,
            flex: 1,
            alignItems: "center",
            marginRight: 4,
          }}
        >
          <TextWidget
            text="🎙️ Voice"
            style={{ fontSize: 13, color: "#ffffff", fontWeight: "700" }}
          />
        </FlexWidget>

        <FlexWidget
          clickAction="PASTE_TRANSLATE"
          style={{
            backgroundColor: "#252547",
            borderRadius: 12,
            paddingVertical: 8,
            paddingHorizontal: 16,
            flex: 1,
            alignItems: "center",
            marginLeft: 4,
          }}
        >
          <TextWidget
            text="📋 Paste"
            style={{ fontSize: 13, color: "#ccccdd", fontWeight: "700" }}
          />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
