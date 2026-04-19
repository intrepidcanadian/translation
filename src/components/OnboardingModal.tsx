import React, { useState, useCallback } from "react";
import { modalStyles } from "../styles/modalStyles";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { notifySuccess } from "../services/haptics";
import type { ThemeColors } from "../theme";

interface OnboardingModalProps {
  visible: boolean;
  onComplete: () => void;
  hapticsEnabled?: boolean;
  colors: ThemeColors;
}

const steps = [
  { icon: "🎙️", title: "Voice Translation", desc: "Tap the mic button and speak naturally. Your words are translated in real time as you talk." },
  { icon: "💬", title: "Conversation Mode", desc: "Toggle Chat mode for face-to-face conversations. Two mic buttons let each person speak in their language." },
  { icon: "📖", title: "Phrasebook", desc: "Browse common phrases by category for instant offline translations. Tap to copy, long-press to hear." },
  { icon: "⌨️", title: "Type to Translate", desc: "Prefer typing? Use the text input at the bottom to translate written text, with multi-line support." },
  { icon: "⭐", title: "Favorites & History", desc: "Star translations to bookmark them. Swipe left to delete. Search your full history anytime." },
  { icon: "📷", title: "Camera Translate", desc: "Point your camera at any text — signs, menus, documents — and see translations overlaid in real time." },
  { icon: "📄", title: "Smart Scanner", desc: "6 modes: Document, Receipt, Business Card, Medicine, Menu, and Textbook. Each extracts mode-specific info. Save scans as Markdown notes." },
  { icon: "⚙️", title: "Customize Everything", desc: "Adjust font size, speech speed, theme, haptics, and even switch translation providers in Settings." },
];

function OnboardingModalBase({ visible, onComplete, colors }: OnboardingModalProps) {
  const [step, setStep] = useState(0);

  const current = steps[step];
  const isLast = step === steps.length - 1;

  const handleSkip = useCallback(() => {
    setStep(0);
    onComplete();
  }, [onComplete]);

  const handleNext = useCallback(() => {
    if (isLast) {
      setStep(0);
      onComplete();
      notifySuccess();
    } else {
      setStep((s) => s + 1);
    }
  }, [isLast, onComplete]);

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View accessibilityViewIsModal={true} style={[modalStyles.overlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[styles.onboardingContent, { backgroundColor: colors.modalBg }]}>
          {/* Step counter — announces current position to screen readers */}
          <Text
            style={[styles.stepCounter, { color: colors.dimText }]}
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
          >
            Step {step + 1} of {steps.length}
          </Text>
          <View style={styles.onboardingDots}>
            {steps.map((_, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => setStep(i)}
                style={styles.onboardingDotTouchable}
                accessibilityRole="button"
                accessibilityLabel={`Go to step ${i + 1} of ${steps.length}: ${steps[i].title}`}
                accessibilityState={{ selected: i === step }}
              >
                <View
                  style={[
                    styles.onboardingDot,
                    { backgroundColor: i === step ? colors.primary : colors.border },
                  ]}
                />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.onboardingIcon} importantForAccessibility="no">{current.icon}</Text>
          <Text style={[styles.onboardingTitle, { color: colors.titleText }]}>{current.title}</Text>
          <Text style={[styles.onboardingDesc, { color: colors.secondaryText }]}>{current.desc}</Text>
          <View style={styles.onboardingButtons}>
            <TouchableOpacity
              style={styles.onboardingSkip}
              onPress={handleSkip}
              accessibilityRole="button"
              accessibilityLabel="Skip tutorial"
              accessibilityHint="Closes the tutorial and starts using the app"
            >
              <Text style={[styles.onboardingSkipText, { color: colors.dimText }]}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.onboardingNext, { backgroundColor: colors.primary }]}
              onPress={handleNext}
              accessibilityRole="button"
              accessibilityLabel={isLast ? "Get started" : `Next tip, step ${step + 2} of ${steps.length}`}
              accessibilityHint={isLast ? "Closes the tutorial and starts using the app" : `Shows the next feature: ${steps[step + 1]?.title ?? ""}`}
            >
              <Text style={styles.onboardingNextText}>{isLast ? "Get Started" : "Next"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  onboardingContent: {
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 28,
    marginHorizontal: 24,
    alignItems: "center" as const,
  },
  stepCounter: {
    fontSize: 12,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 8,
  },
  onboardingDots: {
    flexDirection: "row" as const,
    gap: 4,
    marginBottom: 24,
  },
  onboardingDotTouchable: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  onboardingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  onboardingIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  onboardingTitle: {
    fontSize: 24,
    fontWeight: "700" as const,
    marginBottom: 12,
    textAlign: "center" as const,
  },
  onboardingDesc: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center" as const,
    paddingHorizontal: 8,
    marginBottom: 32,
  },
  onboardingButtons: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 16,
    width: "100%" as const,
  },
  onboardingSkip: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center" as const,
  },
  onboardingSkipText: {
    fontSize: 16,
    fontWeight: "500" as const,
  },
  onboardingNext: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center" as const,
  },
  onboardingNextText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700" as const,
  },
});

// Memoized so parent theme/state bumps don't re-render the modal when it's
// hidden (visible=false path is cheap but still walks props).
const OnboardingModal = React.memo(OnboardingModalBase);
export default OnboardingModal;
