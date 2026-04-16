/**
 * Unit tests for `services/haptics.ts` — the centralized haptic feedback
 * service that wraps expo-haptics with a settings-aware enabled/disabled gate.
 *
 * Why pin this:
 *  - Every haptic callsite in the app (mic start/stop, language swap, copy,
 *    swipe-to-delete, product scan, etc.) delegates through this module.
 *    If the gate breaks, disabled-haptics users get unexpected vibrations —
 *    an accessibility issue for users with motor sensitivities.
 *  - The service is stateful (module-level `_enabled` flag). Tests verify
 *    that `setHapticsEnabled(false)` truly suppresses all five feedback
 *    functions and that re-enabling restores them.
 *  - Each function maps to a specific expo-haptics call with a specific
 *    feedback style/type. A regression that swaps Light for Heavy (or
 *    Success for Warning) would be user-perceptible but invisible in code
 *    review without pinning the exact enum values.
 */

// ---- Mock expo-haptics ----
// The mock factory runs before imports. Variables must start with `mock` to
// be hoisted into the factory scope by Jest's transformer.
const mockImpactAsync = jest.fn();
const mockNotificationAsync = jest.fn();
const mockSelectionAsync = jest.fn();

jest.mock("expo-haptics", () => ({
  __esModule: true,
  impactAsync: (...args: unknown[]) => mockImpactAsync(...args),
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
  selectionAsync: (...args: unknown[]) => mockSelectionAsync(...args),
  ImpactFeedbackStyle: {
    Light: "Light",
    Medium: "Medium",
    Heavy: "Heavy",
  },
  NotificationFeedbackType: {
    Success: "Success",
    Warning: "Warning",
    Error: "Error",
  },
}));

import {
  setHapticsEnabled,
  impactLight,
  impactMedium,
  notifySuccess,
  notifyWarning,
  selection,
} from "../services/haptics";

describe("haptics service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to enabled (the module default) before each test
    setHapticsEnabled(true);
  });

  describe("when enabled (default)", () => {
    it("impactLight calls impactAsync with Light style", () => {
      impactLight();
      expect(mockImpactAsync).toHaveBeenCalledTimes(1);
      expect(mockImpactAsync).toHaveBeenCalledWith("Light");
    });

    it("impactMedium calls impactAsync with Medium style", () => {
      impactMedium();
      expect(mockImpactAsync).toHaveBeenCalledTimes(1);
      expect(mockImpactAsync).toHaveBeenCalledWith("Medium");
    });

    it("notifySuccess calls notificationAsync with Success type", () => {
      notifySuccess();
      expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
      expect(mockNotificationAsync).toHaveBeenCalledWith("Success");
    });

    it("notifyWarning calls notificationAsync with Warning type", () => {
      notifyWarning();
      expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
      expect(mockNotificationAsync).toHaveBeenCalledWith("Warning");
    });

    it("selection calls selectionAsync", () => {
      selection();
      expect(mockSelectionAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe("when disabled", () => {
    beforeEach(() => {
      setHapticsEnabled(false);
    });

    it("impactLight does not call expo-haptics", () => {
      impactLight();
      expect(mockImpactAsync).not.toHaveBeenCalled();
    });

    it("impactMedium does not call expo-haptics", () => {
      impactMedium();
      expect(mockImpactAsync).not.toHaveBeenCalled();
    });

    it("notifySuccess does not call expo-haptics", () => {
      notifySuccess();
      expect(mockNotificationAsync).not.toHaveBeenCalled();
    });

    it("notifyWarning does not call expo-haptics", () => {
      notifyWarning();
      expect(mockNotificationAsync).not.toHaveBeenCalled();
    });

    it("selection does not call expo-haptics", () => {
      selection();
      expect(mockSelectionAsync).not.toHaveBeenCalled();
    });
  });

  describe("re-enabling after disable", () => {
    it("restores haptic feedback after toggling off then on", () => {
      setHapticsEnabled(false);
      impactLight();
      expect(mockImpactAsync).not.toHaveBeenCalled();

      setHapticsEnabled(true);
      impactLight();
      expect(mockImpactAsync).toHaveBeenCalledTimes(1);
      expect(mockImpactAsync).toHaveBeenCalledWith("Light");
    });
  });

  describe("rapid toggle", () => {
    it("respects the most recent setHapticsEnabled call", () => {
      setHapticsEnabled(true);
      setHapticsEnabled(false);
      setHapticsEnabled(true);
      setHapticsEnabled(false);

      notifySuccess();
      expect(mockNotificationAsync).not.toHaveBeenCalled();

      setHapticsEnabled(true);
      notifySuccess();
      expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
    });
  });
});
