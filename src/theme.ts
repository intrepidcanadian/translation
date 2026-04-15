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

  // Glassmorphic surfaces. These are translucent rgba values designed to
  // sit on top of GlassBackdrop's aurora layers — `glassBg` is the standard
  // soft-frosted card, `glassBgStrong` is for surfaces that need more
  // legibility (mic button row, modals), and `glassBorder`/`glassHighlight`
  // give the 1px hairline + inner highlight that sells the depth illusion.
  glassBg: string;
  glassBgStrong: string;
  glassBorder: string;
  glassHighlight: string;

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

  // Offline
  offlineBg: string;
  offlineText: string;
  offlineBorder: string;

  // Semantic
  successText: string;
  successBg: string;
  warningText: string;
  warningBg: string;
  destructiveBg: string;
  destructiveText: string;
  favoriteColor: string;

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

  // Dark-mode glass: cool indigo frosted look. Alpha intentionally low so
  // GlassBackdrop's aurora bleeds through; the 1px highlight + border sell
  // the "frosted pane" effect without needing real backdrop blur.
  glassBg: "rgba(38, 38, 80, 0.45)",
  glassBgStrong: "rgba(48, 48, 96, 0.72)",
  glassBorder: "rgba(168, 164, 255, 0.22)",
  glassHighlight: "rgba(255, 255, 255, 0.08)",

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

  offlineBg: "#2a2a1a",
  offlineText: "#ffbb33",
  offlineBorder: "#665500",

  successText: "#4ade80",
  successBg: "#1a3d2a",
  warningText: "#ffbb33",
  warningBg: "#2a2a1a",
  destructiveBg: "#ff4757",
  destructiveText: "#ffffff",
  favoriteColor: "#ffd700",

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

  // Light-mode glass: bright translucent white with a faint lavender tint
  // so the aurora colors still come through. Alpha is higher than dark
  // because light backgrounds need more opacity to keep text legible.
  glassBg: "rgba(255, 255, 255, 0.55)",
  glassBgStrong: "rgba(255, 255, 255, 0.78)",
  glassBorder: "rgba(108, 99, 255, 0.18)",
  glassHighlight: "rgba(255, 255, 255, 0.6)",

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

  offlineBg: "#fff8e0",
  offlineText: "#996600",
  offlineBorder: "#eebb44",

  successText: "#16a34a",
  successBg: "#e8f5e9",
  warningText: "#996600",
  warningBg: "#fff8e0",
  destructiveBg: "#ef4444",
  destructiveText: "#ffffff",
  favoriteColor: "#e6a800",

  statusBar: "dark-content",
};

export function getColors(theme: ThemeMode): ThemeColors {
  return theme === "light" ? lightColors : darkColors;
}
