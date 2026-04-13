const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withFixResourceBundleSigning(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let podfile = fs.readFileSync(podfilePath, "utf8");

      const snippet = `
    # Fix Xcode 14+ resource bundle code signing
    installer.target_installation_results.pod_target_installation_results
      .each do |pod_name, target_installation_result|
        target_installation_result.resource_bundle_targets.each do |resource_bundle_target|
          resource_bundle_target.build_configurations.each do |config|
            config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
          end
        end
      end`;

      if (!podfile.includes("CODE_SIGNING_ALLOWED")) {
        // Insert before the last `end` in the post_install block
        podfile = podfile.replace(
          /^(\s*)(react_native_post_install\(.*?\n(?:.*\n)*?\s*\))/m,
          `$1$2\n${snippet}`
        );
        fs.writeFileSync(podfilePath, podfile);
      }

      return config;
    },
  ]);
}

module.exports = withFixResourceBundleSigning;
