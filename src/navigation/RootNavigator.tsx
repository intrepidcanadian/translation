import React from "react";
import { Text, Platform } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
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
        tabBarStyle: {
          backgroundColor: colors.safeBg,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingBottom: Platform.OS === "ios" ? 20 : 8,
          paddingTop: 8,
          height: Platform.OS === "ios" ? 85 : 65,
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
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>🎙️</Text>,
        }}
      />
      <Tab.Screen
        name="Scan"
        component={ScanScreenSafe}
        options={{
          tabBarLabel: "Scan",
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>📷</Text>,
        }}
      />
      <Tab.Screen
        name="Notes"
        component={NotesScreenSafe}
        options={{
          tabBarLabel: "Notes",
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>🗒️</Text>,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreenSafe}
        options={{
          tabBarLabel: "Settings",
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>⚙</Text>,
        }}
      />
    </Tab.Navigator>
  );
}
