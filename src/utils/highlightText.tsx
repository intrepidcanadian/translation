import React from "react";
import { Text, type TextStyle } from "react-native";

/**
 * Splits text into segments, wrapping matched portions in highlighted <Text> nodes.
 * Returns an array of React elements suitable for rendering inside a parent <Text>.
 */
export function highlightMatches(
  text: string,
  query: string,
  baseStyle: TextStyle,
  highlightStyle: TextStyle
): React.ReactNode[] {
  if (!query.trim()) return [<Text key="full" style={baseStyle}>{text}</Text>];

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <Text key={i} style={[baseStyle, highlightStyle]}>{part}</Text>
    ) : (
      <Text key={i} style={baseStyle}>{part}</Text>
    )
  );
}
