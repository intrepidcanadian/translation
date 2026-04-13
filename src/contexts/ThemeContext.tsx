import React, { createContext, useContext, useMemo } from "react";
import { ThemeColors, ThemeMode, getColors } from "../theme";
import { useSettings } from "./SettingsContext";

interface ThemeContextValue {
  colors: ThemeColors;
  theme: ThemeMode;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  theme,
  children,
}: {
  theme: ThemeMode;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ colors: getColors(theme), theme }), [theme]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Bridge component that reads the theme from SettingsContext
 * and provides it via ThemeProvider. Compatible with ComposeProviders.
 */
export function ThemeBridge({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  return <ThemeProvider theme={settings.theme}>{children}</ThemeProvider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
