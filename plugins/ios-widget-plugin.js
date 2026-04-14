const {
  withEntitlementsPlist,
  withXcodeProject,
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
    // Team ID required for signing the app extension target under Xcode 14+.
    // Without DEVELOPMENT_TEAM on the widget target, xcodebuild fails with
    // "requires setting the development team" — and Expo's log classifier
    // reports that as XCODE_RESOURCE_BUNDLE_CODE_SIGNING_ERROR even though
    // the failing target is the extension, not a CocoaPods resource bundle.
    const appleTeamId = config.ios?.appleTeamId || "QV52UGHY49";

    // Copy widget source files to ios directory
    const iosDir = config.modRequest.platformProjectRoot;
    const widgetDir = path.join(iosDir, WIDGET_TARGET_NAME);

    if (!fs.existsSync(widgetDir)) {
      fs.mkdirSync(widgetDir, { recursive: true });
    }

    const sourceDir = path.join(config.modRequest.projectRoot, "ios-widget");
    const swiftFiles = ["TranslateWidget.swift", "TranslateWidgetBundle.swift"];
    const allFiles = [
      ...swiftFiles,
      "TranslateWidgetExtension.entitlements",
    ];

    for (const file of allFiles) {
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

    // Add the extension target
    const target = project.addTarget(
      WIDGET_TARGET_NAME,
      "app_extension",
      WIDGET_TARGET_NAME,
      widgetBundleId
    );

    if (target) {
      // Create a PBX group for widget files — only non-Swift files here;
      // Swift file refs are added manually below to avoid duplicates
      const nonSwiftFiles = ["TranslateWidgetExtension.entitlements", "Info.plist"];
      const widgetGroup = project.addPbxGroup(
        nonSwiftFiles,
        WIDGET_TARGET_NAME,
        WIDGET_TARGET_NAME
      );

      // Add group to main project group
      const mainGroup = project.getFirstProject().firstProject.mainGroup;
      project.addToPbxGroup(widgetGroup.uuid, mainGroup);

      // --- Manually add Swift files to the widget target's Sources build phase ---
      // addTarget() creates the native target but with empty buildPhases.
      // We must create PBXSourcesBuildPhase, PBXFrameworksBuildPhase,
      // PBXFileReferences, PBXBuildFiles, and wire them all together.

      const objects = project.hash.project.objects;

      // 1. Create PBXFileReferences for each Swift file
      const buildFileEntries = [];
      for (const swiftFile of swiftFiles) {
        const fileRefUuid = project.generateUuid();
        objects["PBXFileReference"][fileRefUuid] = {
          isa: "PBXFileReference",
          lastKnownFileType: "sourcecode.swift",
          path: swiftFile,
          sourceTree: '"<group>"',
          name: `"${swiftFile}"`,
        };
        objects["PBXFileReference"][`${fileRefUuid}_comment`] = swiftFile;

        const buildFileUuid = project.generateUuid();
        objects["PBXBuildFile"][buildFileUuid] = {
          isa: "PBXBuildFile",
          fileRef: fileRefUuid,
          fileRef_comment: swiftFile,
        };
        objects["PBXBuildFile"][`${buildFileUuid}_comment`] = `${swiftFile} in Sources`;

        buildFileEntries.push({
          value: buildFileUuid,
          comment: `${swiftFile} in Sources`,
        });

        // Add file ref to widget group
        const groupObj = objects["PBXGroup"][widgetGroup.uuid];
        if (groupObj && groupObj.children) {
          groupObj.children.push({ value: fileRefUuid, comment: swiftFile });
        }
      }

      // 2. Create PBXSourcesBuildPhase with the Swift build files
      const sourcesBuildPhaseUuid = project.generateUuid();
      if (!objects["PBXSourcesBuildPhase"]) {
        objects["PBXSourcesBuildPhase"] = {};
      }
      objects["PBXSourcesBuildPhase"][sourcesBuildPhaseUuid] = {
        isa: "PBXSourcesBuildPhase",
        buildActionMask: 2147483647,
        files: buildFileEntries,
        runOnlyForDeploymentPostprocessing: 0,
      };
      objects["PBXSourcesBuildPhase"][`${sourcesBuildPhaseUuid}_comment`] = "Sources";

      // 3. Create PBXFrameworksBuildPhase (required even if empty)
      const frameworksBuildPhaseUuid = project.generateUuid();
      if (!objects["PBXFrameworksBuildPhase"]) {
        objects["PBXFrameworksBuildPhase"] = {};
      }
      objects["PBXFrameworksBuildPhase"][frameworksBuildPhaseUuid] = {
        isa: "PBXFrameworksBuildPhase",
        buildActionMask: 2147483647,
        files: [],
        runOnlyForDeploymentPostprocessing: 0,
      };
      objects["PBXFrameworksBuildPhase"][`${frameworksBuildPhaseUuid}_comment`] = "Frameworks";

      // 4. Wire build phases into the widget native target
      const nativeTargets = objects["PBXNativeTarget"];
      let widgetNativeTargetUuid = null;
      for (const key in nativeTargets) {
        if (key.endsWith("_comment")) continue;
        const nt = nativeTargets[key];
        if (nt && nt.name && (nt.name === WIDGET_TARGET_NAME || nt.name === `"${WIDGET_TARGET_NAME}"`)) {
          nt.buildPhases = [
            { value: sourcesBuildPhaseUuid, comment: "Sources" },
            { value: frameworksBuildPhaseUuid, comment: "Frameworks" },
          ];
          widgetNativeTargetUuid = key;
          break;
        }
      }

      // 5. Register TargetAttributes for the widget under the PBXProject so
      // Xcode respects the automatic-signing settings on the target. Without
      // this, Xcode may silently fall back to manual signing and refuse to
      // pick a provisioning profile, producing "requires development team".
      if (widgetNativeTargetUuid) {
        const pbxProjectSection = objects["PBXProject"];
        for (const key in pbxProjectSection) {
          if (key.endsWith("_comment")) continue;
          const proj = pbxProjectSection[key];
          if (!proj || typeof proj !== "object") continue;
          if (!proj.attributes) proj.attributes = {};
          if (!proj.attributes.TargetAttributes) proj.attributes.TargetAttributes = {};
          proj.attributes.TargetAttributes[widgetNativeTargetUuid] = {
            CreatedOnToolsVersion: "15.0",
            DevelopmentTeam: appleTeamId,
            ProvisioningStyle: "Automatic",
          };
          break;
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
          config.buildSettings.MARKETING_VERSION = "1.0.0";
          config.buildSettings.CURRENT_PROJECT_VERSION = "1";
          config.buildSettings.GENERATE_INFOPLIST_FILE = "NO";
          config.buildSettings.SKIP_INSTALL = "YES";
          // Signing — required under Xcode 14+ for app extension targets.
          // Automatic signing + a team ID lets EAS's managed credentials flow
          // register the widget bundle ID with the Apple Developer portal
          // and pick a matching provisioning profile at build time.
          config.buildSettings.DEVELOPMENT_TEAM = appleTeamId;
          config.buildSettings.CODE_SIGN_STYLE = "Automatic";
          config.buildSettings.CODE_SIGN_IDENTITY = '"Apple Development"';
        }
      }
    }

    return config;
  });

  return config;
}

module.exports = withIOSWidget;
