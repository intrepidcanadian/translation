import React from "react";
import { View, StyleSheet, Dimensions } from "react-native";

/**
 * Aurora backdrop for glassmorphic surfaces.
 *
 * The app deliberately avoids native graphics dependencies (expo-blur,
 * expo-linear-gradient, react-native-svg are all uninstalled) — adding one
 * here would force a native rebuild on top of the iOS audio/camera fixes
 * the user is already validating, which is risky. Instead this component
 * fakes a soft gradient/aurora with three large absolutely-positioned
 * circles at low opacity. When stacked behind translucent `glassBg`
 * surfaces it gives the eye the same "colored frost" impression as a real
 * backdrop blur, without any native code.
 *
 * The blobs are deliberately sized larger than the screen so their soft
 * edges (via huge borderRadius + low alpha) stay off-screen — you only
 * see the diffuse color, never a hard circle outline. Positioning is
 * fixed (no animation) to keep this component free.
 *
 * Drop `<GlassBackdrop />` inside any screen container, BEFORE the actual
 * content but AFTER the SafeAreaView, so it fills the safe area and the
 * content renders on top.
 */
function GlassBackdrop() {
  const { width, height } = Dimensions.get("window");
  // Blob size scales with the larger screen dimension so rotations and
  // landscape don't reveal hard edges. 1.4× covers all reasonable aspect
  // ratios including iPad split view.
  const blobSize = Math.max(width, height) * 1.4;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Top-left indigo blob */}
      <View
        style={[
          styles.blob,
          {
            width: blobSize,
            height: blobSize,
            borderRadius: blobSize / 2,
            top: -blobSize * 0.55,
            left: -blobSize * 0.35,
            backgroundColor: "rgba(108, 99, 255, 0.22)",
          },
        ]}
      />
      {/* Bottom-right violet blob */}
      <View
        style={[
          styles.blob,
          {
            width: blobSize,
            height: blobSize,
            borderRadius: blobSize / 2,
            bottom: -blobSize * 0.55,
            right: -blobSize * 0.4,
            backgroundColor: "rgba(168, 100, 255, 0.18)",
          },
        ]}
      />
      {/* Mid-left teal accent for color variation */}
      <View
        style={[
          styles.blob,
          {
            width: blobSize * 0.8,
            height: blobSize * 0.8,
            borderRadius: blobSize * 0.4,
            top: height * 0.35,
            left: -blobSize * 0.45,
            backgroundColor: "rgba(80, 180, 220, 0.13)",
          },
        ]}
      />
    </View>
  );
}

export default React.memo(GlassBackdrop);

const styles = StyleSheet.create({
  blob: {
    position: "absolute",
  },
});
