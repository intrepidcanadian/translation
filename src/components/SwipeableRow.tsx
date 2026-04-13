import React, { useRef } from "react";
import { View, Text, Animated, PanResponder, StyleSheet } from "react-native";
import type { ThemeColors } from "../theme";

interface SwipeableRowProps {
  onDelete: () => void;
  children: React.ReactNode;
  colors?: ThemeColors;
}

export default function SwipeableRow({ onDelete, children, colors }: SwipeableRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const THRESHOLD = -80;

  // Keep a stable ref to onDelete so the PanResponder always calls the latest callback
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  // Derive opacity from translateX so the red delete bg only appears when swiping
  const deleteOpacity = translateX.interpolate({
    inputRange: [-120, -20, 0],
    outputRange: [1, 0.6, 0],
    extrapolate: "clamp",
  });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          translateX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < THRESHOLD) {
          Animated.timing(translateX, {
            toValue: -400,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onDeleteRef.current());
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        }
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.deleteBackground, colors && { backgroundColor: colors.destructiveBg }, { opacity: deleteOpacity }]}>
        <Text style={[styles.deleteText, colors && { color: colors.destructiveText }]}>Delete</Text>
        <Text style={styles.deleteIcon}>🗑</Text>
      </Animated.View>
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
        accessible={true}
        accessibilityHint="Swipe left to delete this translation"
        accessibilityRole="button"
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  deleteBackground: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 6,
    width: 120,
    backgroundColor: "#ff4757",
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    alignSelf: "flex-end",
  },
  deleteText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  deleteIcon: {
    fontSize: 16,
  },
});
