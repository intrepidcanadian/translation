import React from "react";
import { Platform } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSettings } from "../contexts/SettingsContext";
import { getColors } from "../theme";
import type { RootTabParamList } from "./types";
import ScreenErrorBoundary from "../components/ScreenErrorBoundary";

import TranslateScreen from "../screens/TranslateScreen";
import ScanScreen from "../screens/ScanScreen";
import NotesScreen from "../screens/NotesScreen";
import SettingsScreen from "../screens/SettingsScreen";

const Tab = createBottomTabNavigator<RootTabParamList>();

/**
 * Wrap a tab screen in a named ScreenErrorBoundary so a crash in one tab
 * doesn't take down the whole navigator. The root <ErrorBoundary> is still
 * the last line of defense — this just contains the blast radius per tab.
 */
function withBoundary<P extends object>(
  label: string,
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  const Wrapped = (props: P) => (
    <ScreenErrorBoundary label={label}>
      <Component {...props} />
    </ScreenErrorBoundary>
  );
  Wrapped.displayName = `${label}Screen(Boundary)`;
  return Wrapped;
}

const TranslateScreenSafe = withBoundary("Translate", TranslateScreen);
const ScanScreenSafe = withBoundary("Scan", ScanScreen);
const NotesScreenSafe = withBoundary("Notes", NotesScreen);
const SettingsScreenSafe = withBoundary("Settings", SettingsScreen);

export default function RootNavigator() {
  const { settings } = useSettings();
  const colors = getColors(settings.theme);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // Glass tab bar: translucent fill + hairline top border tinted to
        // glassBorder so it harmonizes with the screen-level glass surfaces
        // and the GlassBackdrop aurora bleeding through. `position:
        // absolute` lets content underneath show through the translucency
        // (otherwise the Tab.Navigator reserves opaque space and you get a
        // hard color seam regardless of the alpha). We add equivalent
        // bottom padding to each screen via SafeAreaView so content isn't
        // hidden under the floating bar.
        tabBarStyle: {
          position: "absolute",
          backgroundColor: colors.glassBgStrong,
          borderTopColor: colors.glassBorder,
          borderTopWidth: 1,
          paddingBottom: Platform.OS === "ios" ? 20 : 8,
          paddingTop: 8,
          height: Platform.OS === "ios" ? 85 : 65,
          // Soft elevation so the bar reads as a floating surface, not a
          // panel welded to the bottom edge.
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.12,
          shadowRadius: 12,
          elevation: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedText,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tab.Screen
        name="Translate"
        component={TranslateScreenSafe}
        options={{
          tabBarLabel: "Translate",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "mic" : "mic-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Scan"
        component={ScanScreenSafe}
        options={{
          tabBarLabel: "Scan",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "scan" : "scan-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Notes"
        component={NotesScreenSafe}
        options={{
          tabBarLabel: "Notes",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "document-text" : "document-text-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreenSafe}
        options={{
          tabBarLabel: "Settings",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "settings" : "settings-outline"} size={24} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
