export type ThemeMode = "dark" | "light";

export interface ThemeColors {
  // Backgrounds
  safeBg: string;
  containerBg: string;
  bubbleBg: string;
  translatedBubbleBg: string;
  liveBubbleBg: string;
  liveTranslatedBubbleBg: string;
  inputBg: string;
  modalBg: string;
  overlayBg: string;
  sectionBg: string;
  cardBg: string;

  // Text
  titleText: string;
  primaryText: string;
  secondaryText: string;
  mutedText: string;
  dimText: string;
  translatedText: string;
  liveOriginalText: string;
  liveTranslatedText: string;
  placeholderText: string;

  // Primary / accent
  primary: string;
  primaryShadow: string;

  // Borders
  border: string;
  borderLight: string;

  // Error
  errorBg: string;
  errorText: string;
  errorBorder: string;

  // Skeleton
  skeleton: string;

  // Status bar
  statusBar: "light-content" | "dark-content";
}

export const darkColors: ThemeColors = {
  safeBg: "#0f0f23",
  containerBg: "#0f0f23",
  bubbleBg: "#1a1a2e",
  translatedBubbleBg: "#1e1e40",
  liveBubbleBg: "#1a1a35",
  liveTranslatedBubbleBg: "#1a1a40",
  inputBg: "#1a1a2e",
  modalBg: "#1a1a2e",
  overlayBg: "rgba(0,0,0,0.7)",
  sectionBg: "#151530",
  cardBg: "#252547",

  titleText: "#ffffff",
  primaryText: "#ffffff",
  secondaryText: "#ccccdd",
  mutedText: "#8888aa",
  dimText: "#555577",
  translatedText: "#a8a4ff",
  liveOriginalText: "#eeeeff",
  liveTranslatedText: "#b8b4ff",
  placeholderText: "#555577",

  primary: "#6c63ff",
  primaryShadow: "#6c63ff",

  border: "#333355",
  borderLight: "#252547",

  errorBg: "#3d1a1a",
  errorText: "#ff6b7a",
  errorBorder: "#ff4757",

  skeleton: "#333366",

  statusBar: "light-content",
};

export const lightColors: ThemeColors = {
  safeBg: "#f2f2fa",
  containerBg: "#f2f2fa",
  bubbleBg: "#ffffff",
  translatedBubbleBg: "#f0eeff",
  liveBubbleBg: "#ffffff",
  liveTranslatedBubbleBg: "#f0eeff",
  inputBg: "#ffffff",
  modalBg: "#f5f5fc",
  overlayBg: "rgba(0,0,0,0.3)",
  sectionBg: "#e8e8f2",
  cardBg: "#e4e2f0",

  titleText: "#1a1a2e",
  primaryText: "#1a1a2e",
  secondaryText: "#444455",
  mutedText: "#777799",
  dimText: "#999aab",
  translatedText: "#5550cc",
  liveOriginalText: "#222233",
  liveTranslatedText: "#4440bb",
  placeholderText: "#999aab",

  primary: "#6c63ff",
  primaryShadow: "#6c63ff",

  border: "#d8d8e8",
  borderLight: "#e4e2f0",

  errorBg: "#fff0f0",
  errorText: "#cc3344",
  errorBorder: "#ff6b7a",

  skeleton: "#d8d8e8",

  statusBar: "dark-content",
};

export function getColors(theme: ThemeMode): ThemeColors {
  return theme === "light" ? lightColors : darkColors;
}
