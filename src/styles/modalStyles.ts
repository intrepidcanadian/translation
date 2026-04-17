import { StyleSheet } from "react-native";

/**
 * Shared bottom-sheet modal styles used across ComparisonModal, CorrectionModal,
 * WordAlternativesModal, GlossaryModal, StatsModal, PhrasebookModal, and OnboardingModal.
 *
 * Each modal can spread these into its own StyleSheet and override as needed.
 */
export const modalStyles = StyleSheet.create({
  /** Full-screen overlay that pushes content to the bottom */
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },

  /** Standard bottom-sheet container (70% max height) */
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "70%",
    paddingTop: 20,
    paddingHorizontal: 20,
  },

  /** Wider variant for modals needing more space (80% max height) */
  contentWide: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
    paddingTop: 20,
    paddingHorizontal: 20,
  },

  /** Centered bold title */
  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },

  /** Bottom close/done button with top border */
  closeButton: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
    marginHorizontal: -20,
  },

  /** Uppercase section label */
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 6,
  },

  /** Rounded info/original-text box */
  infoBox: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
});
