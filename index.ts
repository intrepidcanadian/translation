import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './App';

// Register Android widget task handler
if (Platform.OS === 'android') {
  import('react-native-android-widget').then(({ registerWidgetTaskHandler }) => {
    import('./src/widgets/widgetTaskHandler').then(({ widgetTaskHandler }) => {
      registerWidgetTaskHandler(widgetTaskHandler);
    });
  }).catch(() => {
    // Widget module not available (e.g. web)
  });
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
