import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
} from "react-native";
import { primaryAlpha, textOnGlass } from "../theme";

export interface DetectedBlock {
  id: string;
  originalText: string;
  translatedText: string;
  frame: { top: number; left: number; width: number; height: number };
}

export type OCRLanguage = "latin" | "chinese" | "japanese" | "korean" | "devanagari";

export function getOCRLanguage(langCode: string): OCRLanguage {
  switch (langCode) {
    case "zh": return "chinese";
    case "ja": return "japanese";
    case "ko": return "korean";
    case "hi": return "devanagari";
    default: return "latin";
  }
}

export const OCR_OPTIONS_BASE = {
  frameSkipThreshold: 15,
  scanRegion: { left: "5%", top: "15%", width: "90%", height: "70%" } as const,
  useLightweightMode: true,
} as const;

const LABEL_GAP = 6;
const LABEL_MIN_SIDE = 80;
const LABEL_SIDE_MAX_WIDTH = 240;
const LABEL_SIDE_PADDING = 12;
const LABEL_MIN_HEIGHT = 22;
const LABEL_HIT_SLOP = { top: 10, bottom: 10, left: 6, right: 6 };

function computeLabelPosition(
  block: DetectedBlock,
  screenWidth: number,
  screenHeight: number
): { top: number; left: number; maxWidth: number } {
  const textTop = block.frame.top;
  const textLeft = block.frame.left;
  const textRight = textLeft + block.frame.width;
  const textBottom = textTop + block.frame.height;

  const roomRight = Math.max(0, screenWidth - LABEL_SIDE_PADDING - (textRight + LABEL_GAP));
  const roomLeft = Math.max(0, textLeft - LABEL_GAP - LABEL_SIDE_PADDING);

  if (roomRight >= LABEL_MIN_SIDE) {
    return { top: textTop, left: textRight + LABEL_GAP, maxWidth: Math.min(LABEL_SIDE_MAX_WIDTH, roomRight) };
  }
  if (roomLeft >= LABEL_MIN_SIDE) {
    const maxW = Math.min(LABEL_SIDE_MAX_WIDTH, roomLeft);
    return { top: textTop, left: textLeft - LABEL_GAP - maxW, maxWidth: maxW };
  }
  return {
    top: Math.min(textBottom + LABEL_GAP, screenHeight - LABEL_MIN_HEIGHT - LABEL_SIDE_PADDING),
    left: Math.max(LABEL_SIDE_PADDING, Math.min(textLeft, screenWidth - LABEL_SIDE_MAX_WIDTH - LABEL_SIDE_PADDING)),
    maxWidth: LABEL_SIDE_MAX_WIDTH,
  };
}

interface DetectedBlockOverlayProps {
  block: DetectedBlock;
  overlayMode?: "bubble" | "label";
  animatedOpacity: Animated.Value;
  screenWidth: number;
  screenHeight: number;
  onPress?: (block: DetectedBlock) => void;
}

export const DetectedBlockOverlay = React.memo(function DetectedBlockOverlay({
  block,
  overlayMode = "label",
  animatedOpacity,
  screenWidth,
  screenHeight,
  onPress,
}: DetectedBlockOverlayProps) {
  if (overlayMode === "label") {
    const labelHeight = Math.max(LABEL_MIN_HEIGHT, block.frame.height);
    const fontSize = Math.max(12, Math.min(24, labelHeight * 0.54));
    const pos = computeLabelPosition(block, screenWidth, screenHeight);

    const labelBody = (
      <Pressable
        onPress={onPress ? () => onPress(block) : undefined}
        disabled={!onPress}
        hitSlop={LABEL_HIT_SLOP}
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={
          onPress
            ? `${block.translatedText}. Tap for copy or speak options.`
            : block.translatedText
        }
        style={ocrStyles.labelPressable}
      >
        <Text
          style={[{ color: "#fff", fontSize, fontWeight: "700", lineHeight: fontSize * 1.2 }, textOnGlass]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {block.translatedText}
        </Text>
      </Pressable>
    );

    return (
      <Animated.View
        style={[
          ocrStyles.labelContainer,
          {
            top: pos.top,
            left: pos.left,
            maxWidth: pos.maxWidth,
            minHeight: labelHeight,
            opacity: animatedOpacity,
          },
        ]}
      >
        {labelBody}
      </Animated.View>
    );
  }

  // Bubble mode: stacked translation + original in a glass card
  return (
    <View style={[ocrStyles.bubbleWrapper, { top: block.frame.top, left: block.frame.left, minWidth: block.frame.width, minHeight: block.frame.height }]}>
      <Pressable
        onPress={onPress ? () => onPress(block) : undefined}
        disabled={!onPress}
        hitSlop={LABEL_HIT_SLOP}
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={
          onPress
            ? `${block.translatedText}. Tap for copy or speak options.`
            : block.translatedText
        }
        style={ocrStyles.bubblePressable}
      >
        <Text style={[ocrStyles.bubbleTranslated, textOnGlass]} numberOfLines={2}>{block.translatedText}</Text>
        <Text style={[ocrStyles.bubbleOriginal, textOnGlass]} numberOfLines={1}>{block.originalText}</Text>
      </Pressable>
    </View>
  );
});

const ocrStyles = StyleSheet.create({
  labelPressable: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    justifyContent: "center",
  },
  labelContainer: {
    position: "absolute",
    backgroundColor: "rgba(26, 26, 46, 0.92)",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: primaryAlpha.border,
    borderLeftWidth: 3,
    borderLeftColor: "#a8a4ff",
  },
  bubbleWrapper: {
    position: "absolute",
    justifyContent: "flex-start",
    alignItems: "flex-start",
  },
  bubblePressable: {
    backgroundColor: "rgba(26, 26, 46, 0.88)",
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: primaryAlpha.border,
    maxWidth: 280,
  },
  bubbleTranslated: {
    color: "#a8a4ff",
    fontSize: 14,
    fontWeight: "700",
  },
  bubbleOriginal: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    marginTop: 1,
  },
});
