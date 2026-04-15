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

  // `String.split` with a capture group puts matches at odd indices and
  // non-match text at even indices. Use index parity rather than calling
  // `regex.test(part)` — the global regex is stateful and `.test()` in a
  // map() loop mutates `lastIndex` between calls, producing the wrong
  // answer for some inputs (see highlightText.test.ts). Parity is also
  // ~2x faster: no per-segment regex execution.
  return parts.map((part, i) => {
    const isMatch = i % 2 === 1;
    return isMatch ? (
      <Text key={i} style={[baseStyle, highlightStyle]}>{part}</Text>
    ) : (
      <Text key={i} style={baseStyle}>{part}</Text>
    );
  });
}
