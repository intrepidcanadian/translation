import React, { ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { ThemeColors } from "../theme";

// Reusable disclosure-triangle section header used in SettingsModal (and any
// future debug/advanced panels). Centralizes the triangle glyph, `⚠` urgency
// badge, and accessibilityState so every collapsible follows the same pattern.
// Extracted per backlog #115.
interface Props {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  colors: ThemeColors;
  /** Append a `⚠` glyph next to the title when collapsed and this is true.
   * Use to flag urgent state (open circuit breaker, stored crash) without
   * expanding the whole section. */
  urgent?: boolean;
  /** Accessibility label for the header button. Falls back to `{title} section`. */
  accessibilityLabel?: string;
  children: ReactNode;
}

function CollapsibleSection({ title, expanded, onToggle, colors, urgent, accessibilityLabel, children }: Props) {
  return (
    <>
      <TouchableOpacity
        style={styles.header}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={accessibilityLabel ?? `${title} section`}
        accessibilityHint={expanded ? "Double tap to collapse" : "Double tap to expand"}
      >
        <Text style={[styles.title, { color: colors.mutedText }]}>
          {expanded ? "▾" : "▸"}  {title}
          {!expanded && urgent ? "  ⚠" : ""}
        </Text>
      </TouchableOpacity>
      {expanded ? <View>{children}</View> : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingVertical: 4,
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
});

export default React.memo(CollapsibleSection);
