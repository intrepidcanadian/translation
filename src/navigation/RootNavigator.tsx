import React from "react";
import { Text, Platform } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSettings } from "../contexts/SettingsContext";
import { getColors } from "../theme";
import type { RootTabParamList } from "./types";

import TranslateScreen from "../screens/TranslateScreen";
import ScanScreen from "../screens/ScanScreen";
import NotesScreen from "../screens/NotesScreen";
import SettingsScreen from "../screens/SettingsScreen";

const Tab = createBottomTabNavigator<RootTabParamList>();

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
        component={TranslateScreen}
        options={{
          tabBarLabel: "Translate",
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>🎙️</Text>,
        }}
      />
      <Tab.Screen
        name="Scan"
        component={ScanScreen}
        options={{
          tabBarLabel: "Scan",
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>📷</Text>,
        }}
      />
      <Tab.Screen
        name="Notes"
        component={NotesScreen}
        options={{
          tabBarLabel: "Notes",
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>🗒️</Text>,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: "Settings",
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>⚙</Text>,
        }}
      />
    </Tab.Navigator>
  );
}
