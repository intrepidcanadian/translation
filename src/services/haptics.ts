// Centralized haptic feedback service
// Wraps expo-haptics with settings-awareness so callers don't need to check hapticsEnabled

import * as Haptics from "expo-haptics";

let _enabled = true;

export function setHapticsEnabled(enabled: boolean) {
  _enabled = enabled;
}

export function impactLight() {
  if (_enabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function impactMedium() {
  if (_enabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function notifySuccess() {
  if (_enabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function notifyWarning() {
  if (_enabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

export function selection() {
  if (_enabled) Haptics.selectionAsync();
}
