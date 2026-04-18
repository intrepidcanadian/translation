// PassengerView — fullscreen display of translated text for showing to passengers
// Crew translates → taps "Show" → holds phone facing passenger → passenger reads large text
// Swipe left/right to cycle through recent translations, tap to hear spoken aloud

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Dimensions,
  PanResponder,
  Animated,
  StatusBar,
  Platform,
} from "react-native";
import * as Speech from "expo-speech";
import { impactLight } from "../services/haptics";
import { LANGUAGE_MAP } from "../services/translation";
import type { ThemeColors } from "../theme";
import type { HistoryItem } from "../types";

interface Props {
  visible: boolean;
  onClose: () => void;
  history: HistoryItem[];
  initialIndex?: number;
  colors: ThemeColors;
  speechRate: number;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;

function PassengerView({
  visible,
  onClose,
  history,
  initialIndex = 0,
  colors,
  speechRate,
}: Props) {
  // Filter to only successful translations
  const validHistory = useMemo(
    () => history.filter((h) => h.status === "ok" && h.translated),
    [history]
  );

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Reset index when opening
  useEffect(() => {
    if (visible) {
      // Clamp to valid range
      const clamped = Math.max(0, Math.min(initialIndex, validHistory.length - 1));
      setCurrentIndex(clamped);
      slideAnim.setValue(0);
      fadeAnim.setValue(1);
    } else {
      Speech.stop();
      setIsSpeaking(false);
    }
  }, [visible, initialIndex, validHistory.length]);

  const currentItem = validHistory[currentIndex];
  const targetLang = currentItem?.targetLangCode
    ? LANGUAGE_MAP.get(currentItem.targetLangCode)
    : null;

  const speakTranslation = useCallback(() => {
    if (!currentItem) return;
    if (isSpeaking) {
      Speech.stop();
      setIsSpeaking(false);
      return;
    }
    impactLight();
    setIsSpeaking(true);
    Speech.speak(currentItem.translated, {
      language: targetLang?.speechCode ?? currentItem.targetLangCode ?? "en-US",
      rate: speechRate,
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  }, [currentItem, isSpeaking, targetLang, speechRate]);

  const navigateTo = useCallback(
    (direction: "prev" | "next") => {
      const newIndex = direction === "next"
        ? Math.min(currentIndex + 1, validHistory.length - 1)
        : Math.max(currentIndex - 1, 0);

      if (newIndex === currentIndex) return;

      Speech.stop();
      setIsSpeaking(false);
      impactLight();

      // Slide out
      const slideOut = direction === "next" ? -SCREEN_WIDTH : SCREEN_WIDTH;
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: slideOut, duration: 150, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start(() => {
        setCurrentIndex(newIndex);
        // Reset to opposite side and slide in
        slideAnim.setValue(direction === "next" ? SCREEN_WIDTH : -SCREEN_WIDTH);
        Animated.parallel([
          Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]).start();
      });
    },
    [currentIndex, validHistory.length, slideAnim, fadeAnim]
  );

  // Swipe gesture
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
      onPanResponderMove: (_, gestureState) => {
        slideAnim.setValue(gestureState.dx);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -SWIPE_THRESHOLD) {
          navigateTo("next");
        } else if (gestureState.dx > SWIPE_THRESHOLD) {
          navigateTo("prev");
        } else {
          // Snap back
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 10,
          }).start();
        }
      },
    })
  ).current;

  if (!visible || !currentItem) return null;

  const langName = targetLang?.name ?? "Translation";
  const langFlag = targetLang?.flag ?? "";

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.container}>
        {/* Close button — top left, subtle */}
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => {
            Speech.stop();
            onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel="Close passenger view"
          accessibilityHint="Returns to the translation screen"
        >
          <Text style={styles.closeIcon}>X</Text>
        </TouchableOpacity>

        {/* Pagination indicator — top right */}
        {validHistory.length > 1 && (
          <View style={styles.paginationBadge}>
            <Text style={styles.paginationText}>
              {currentIndex + 1} / {validHistory.length}
            </Text>
          </View>
        )}

        {/* Main content — swipeable */}
        <Animated.View
          style={[
            styles.contentArea,
            { transform: [{ translateX: slideAnim }], opacity: fadeAnim },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Language label */}
          <Text style={styles.langLabel}>
            {langFlag} {langName}
          </Text>

          {/* Translated text — the main event, huge and readable */}
          <Text
            style={styles.translatedText}
            adjustsFontSizeToFit
            numberOfLines={12}
            minimumFontScale={0.3}
            accessibilityRole="text"
            accessibilityLabel={`Translation: ${currentItem.translated}`}
          >
            {currentItem.translated}
          </Text>

          {/* Original text — small, for crew reference */}
          <Text style={styles.originalText} numberOfLines={3}>
            {currentItem.original}
          </Text>
        </Animated.View>

        {/* Bottom controls */}
        <View style={styles.controls}>
          {/* Prev arrow */}
          <TouchableOpacity
            style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
            onPress={() => navigateTo("prev")}
            disabled={currentIndex === 0}
            accessibilityRole="button"
            accessibilityLabel="Previous translation"
            accessibilityHint={currentIndex === 0 ? "No previous translations" : "Swipe or tap to show the previous translation"}
            accessibilityState={{ disabled: currentIndex === 0 }}
          >
            <Text style={[styles.navIcon, currentIndex === 0 && styles.navIconDisabled]}>
              ‹
            </Text>
          </TouchableOpacity>

          {/* Speak button — center, large */}
          <TouchableOpacity
            style={[styles.speakButton, isSpeaking && styles.speakButtonActive]}
            onPress={speakTranslation}
            accessibilityRole="button"
            accessibilityLabel={isSpeaking ? "Stop speaking" : "Speak translation aloud"}
            accessibilityHint={isSpeaking ? "Stops the current speech playback" : "Reads the translated text aloud"}
          >
            <Text style={styles.speakIcon}>{isSpeaking ? "⏹" : "🔊"}</Text>
            <Text style={styles.speakLabel}>{isSpeaking ? "Stop" : "Speak"}</Text>
          </TouchableOpacity>

          {/* Next arrow */}
          <TouchableOpacity
            style={[styles.navButton, currentIndex >= validHistory.length - 1 && styles.navButtonDisabled]}
            onPress={() => navigateTo("next")}
            disabled={currentIndex >= validHistory.length - 1}
            accessibilityRole="button"
            accessibilityLabel="Next translation"
            accessibilityHint={currentIndex >= validHistory.length - 1 ? "No more translations" : "Shows the next translation"}
            accessibilityState={{ disabled: currentIndex >= validHistory.length - 1 }}
          >
            <Text style={[styles.navIcon, currentIndex >= validHistory.length - 1 && styles.navIconDisabled]}>
              ›
            </Text>
          </TouchableOpacity>
        </View>

        {/* Swipe hint — only on first view */}
        {validHistory.length > 1 && (
          <Text
            style={styles.swipeHint}
            accessibilityRole="text"
            accessibilityLabel={`Swipe to browse ${validHistory.length} translations`}
          >
            Swipe to browse translations
          </Text>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingHorizontal: 24,
  },

  // Close button
  closeButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  closeIcon: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 16,
    fontWeight: "700",
  },

  // Pagination
  paginationBadge: {
    position: "absolute",
    top: Platform.OS === "ios" ? 68 : 48,
    right: 24,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    zIndex: 10,
  },
  paginationText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    fontWeight: "600",
  },

  // Main content
  contentArea: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingTop: 40,
  },
  langLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 16,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginBottom: 24,
    textAlign: "center",
  },
  translatedText: {
    color: "#FFFFFF",
    fontSize: 56,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 68,
    letterSpacing: -0.5,
  },
  originalText: {
    color: "rgba(255,255,255,0.25)",
    fontSize: 16,
    textAlign: "center",
    marginTop: 24,
    fontStyle: "italic",
    lineHeight: 22,
  },

  // Bottom controls
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
    paddingTop: 24,
    paddingBottom: 8,
  },
  navButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  navIcon: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "300",
  },
  navIconDisabled: {
    color: "rgba(255,255,255,0.3)",
  },
  speakButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#6c63ff",
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 30,
    shadowColor: "#6c63ff",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  speakButtonActive: {
    backgroundColor: "#ff4757",
    shadowColor: "#ff4757",
  },
  speakIcon: {
    fontSize: 22,
  },
  speakLabel: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },

  // Swipe hint
  swipeHint: {
    color: "rgba(255,255,255,0.2)",
    fontSize: 12,
    textAlign: "center",
    paddingTop: 8,
  },
});

export default React.memo(PassengerView);
