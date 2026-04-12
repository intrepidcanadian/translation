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
          }).start(() => onDelete());
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
      <View style={[styles.deleteBackground, colors && { backgroundColor: colors.destructiveBg }]}>
        <Text style={[styles.deleteText, colors && { color: colors.destructiveText }]}>Delete</Text>
        <Text style={styles.deleteIcon}>🗑</Text>
      </View>
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
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
    bottom: 0,
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
