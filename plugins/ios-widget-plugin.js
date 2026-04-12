const {
  withEntitlementsPlist,
  withXcodeProject,
  withInfoPlist,
  IOSConfig,
} = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const APP_GROUP = "group.com.tonylau.livetranslator";
const WIDGET_TARGET_NAME = "TranslateWidgetExtension";
const WIDGET_BUNDLE_ID_SUFFIX = ".TranslateWidgetExtension";

function withIOSWidget(config) {
  // Step 1: Add App Group entitlement to main app
  config = withEntitlementsPlist(config, (config) => {
    if (!config.modResults["com.apple.security.application-groups"]) {
      config.modResults["com.apple.security.application-groups"] = [];
    }
    const groups = config.modResults["com.apple.security.application-groups"];
    if (!groups.includes(APP_GROUP)) {
      groups.push(APP_GROUP);
    }
    return config;
  });

  // Step 2: Add widget extension target to Xcode project
  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const mainBundleId = config.ios?.bundleIdentifier || "com.tonylau.livetranslator";
    const widgetBundleId = mainBundleId + WIDGET_BUNDLE_ID_SUFFIX;

    // Copy widget source files to ios directory
    const iosDir = path.join(config.modRequest.platformProjectRoot);
    const widgetDir = path.join(iosDir, WIDGET_TARGET_NAME);

    if (!fs.existsSync(widgetDir)) {
      fs.mkdirSync(widgetDir, { recursive: true });
    }

    const sourceDir = path.join(
      config.modRequest.projectRoot,
      "ios-widget"
    );
    const sourceFiles = [
      "TranslateWidget.swift",
      "TranslateWidgetBundle.swift",
      "TranslateWidgetExtension.entitlements",
    ];

    for (const file of sourceFiles) {
      const src = path.join(sourceDir, file);
      const dst = path.join(widgetDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
      }
    }

    // Write Info.plist for widget extension
    const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>Live Translator</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>`;
    fs.writeFileSync(path.join(widgetDir, "Info.plist"), infoPlist);

    // Add widget extension target to Xcode project
    const targetUuid = project.generateUuid();
    const buildConfigurationListUuid = project.generateUuid();
    const debugBuildConfigUuid = project.generateUuid();
    const releaseBuildConfigUuid = project.generateUuid();

    // Add the extension target
    const target = project.addTarget(
      WIDGET_TARGET_NAME,
      "app_extension",
      WIDGET_TARGET_NAME,
      widgetBundleId
    );

    if (target) {
      // Add source files to the target
      const widgetGroup = project.addPbxGroup(
        sourceFiles.concat(["Info.plist"]),
        WIDGET_TARGET_NAME,
        WIDGET_TARGET_NAME
      );

      // Add to main group
      const mainGroup = project.getFirstProject().firstProject.mainGroup;
      project.addToPbxGroup(widgetGroup.uuid, mainGroup);

      // Add source files to build phase
      for (const file of sourceFiles) {
        if (file.endsWith(".swift")) {
          project.addSourceFile(
            `${WIDGET_TARGET_NAME}/${file}`,
            { target: target.uuid },
            widgetGroup.uuid
          );
        }
      }

      // Set build settings for the widget target
      const configurations = project.pbxXCBuildConfigurationSection();
      for (const key in configurations) {
        const config = configurations[key];
        if (
          config.buildSettings &&
          config.buildSettings.PRODUCT_NAME === `"${WIDGET_TARGET_NAME}"`
        ) {
          config.buildSettings.SWIFT_VERSION = "5.0";
          config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "17.0";
          config.buildSettings.CODE_SIGN_ENTITLEMENTS = `${WIDGET_TARGET_NAME}/TranslateWidgetExtension.entitlements`;
          config.buildSettings.INFOPLIST_FILE = `${WIDGET_TARGET_NAME}/Info.plist`;
          config.buildSettings.LD_RUNPATH_SEARCH_PATHS = `"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"`;
          config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = widgetBundleId;
          config.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
          config.buildSettings.MARKETING_VERSION = "1.0";
          config.buildSettings.CURRENT_PROJECT_VERSION = "1";
        }
      }
    }

    return config;
  });

  return config;
}

module.exports = withIOSWidget;
