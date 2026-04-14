const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Marker comment so the plugin is idempotent across re-runs and we can detect
// whether a previous run already patched the Podfile.
const MARKER = "# fix-resource-signing-plugin v3";

/**
 * Xcode 14+ requires every resource bundle target to declare a development team.
 * CocoaPods-generated resource bundles don't have one, so the build fails with
 * "Signing for ... requires a development team".
 *
 * The canonical fix is to disable code signing on those targets — they're
 * loaded at runtime by the already-signed host app, so they don't need their
 * own signature.
 *
 * v2 (2026-04-14): rewritten because the previous version anchored on
 * `react_native_post_install(...)` and silently failed to match the SDK 54
 * Podfile shape, leaving the build broken. This version:
 *   - anchors on `post_install do |installer|`, which is stable across SDKs
 *   - walks `do`/`end` pairs to find the matching block end instead of relying
 *     on a regex over multi-line Ruby
 *   - throws loudly if the structure isn't found, so future Podfile changes
 *     cause a CI failure instead of a silent regression
 *   - uses `installer.pods_project.targets` (vanilla CocoaPods API) so it
 *     doesn't depend on Expo's `target_installation_results` shim
 */
function withFixResourceBundleSigning(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );

      if (!fs.existsSync(podfilePath)) {
        throw new Error(
          `[fix-resource-signing] Podfile not found at ${podfilePath}`
        );
      }

      let podfile = fs.readFileSync(podfilePath, "utf8");

      if (podfile.includes(MARKER)) {
        // Already patched — nothing to do.
        return config;
      }

      const snippet = `
    ${MARKER}
    # Xcode 14+ requires every target with resources to declare a development
    # team. CocoaPods-generated targets (resource bundles AND pod framework /
    # library targets that bundle resources) don't have one, so the archive
    # fails with "Signing for ... requires a development team".
    #
    # All pods targets are statically linked into the already-signed host app
    # (framework build type is static library), so disabling their code signing
    # is safe. v3 broadens the filter from \`product_type == "bundle"\` to every
    # pods target because v2's narrower filter missed the actual failing target
    # on EAS, leaving the archive broken.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        bc.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        bc.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
        bc.build_settings['CODE_SIGN_IDENTITY'] = ''
        bc.build_settings['CODE_SIGN_ENTITLEMENTS'] = ''
        bc.build_settings['EXPANDED_CODE_SIGN_IDENTITY'] = ''
        bc.build_settings['DEVELOPMENT_TEAM'] = ''
      end
    end
`;

      // Locate `post_install do |installer|` — present in every Expo / RN
      // Podfile and stable across SDK versions.
      const postInstallRe = /post_install\s+do\s+\|installer\|/;
      const startMatch = podfile.match(postInstallRe);
      if (!startMatch || startMatch.index === undefined) {
        throw new Error(
          "[fix-resource-signing] Could not find `post_install do |installer|` in Podfile. " +
            "Either the Podfile structure has changed or the plugin needs to be updated."
        );
      }

      // Walk `do`/`end` pairs starting after the post_install opener to find
      // the matching closing `end`. We start at depth 1 because we already
      // consumed the opening `do` of post_install. Tokens are matched as whole
      // words so `end_of_thing` and `do_something` don't trip the counter.
      let depth = 1;
      const cursorStart = startMatch.index + startMatch[0].length;
      const tokenRe = /\b(do|end)\b/g;
      tokenRe.lastIndex = cursorStart;

      let endIdx = -1;
      let m;
      while ((m = tokenRe.exec(podfile)) !== null) {
        if (m[1] === "do") {
          depth++;
        } else {
          depth--;
          if (depth === 0) {
            endIdx = m.index;
            break;
          }
        }
      }

      if (endIdx === -1) {
        throw new Error(
          "[fix-resource-signing] Found `post_install do |installer|` but could not find its matching `end`."
        );
      }

      // Insert the snippet immediately before the closing `end` of the
      // post_install block. Indentation matches the block body.
      podfile =
        podfile.slice(0, endIdx) + snippet + "  " + podfile.slice(endIdx);

      fs.writeFileSync(podfilePath, podfile);

      // Loud success message — visible in EAS build logs under the Prebuild
      // step, so future regressions are obvious.
      console.log(
        "[fix-resource-signing] Patched Podfile to disable code signing on resource bundle targets."
      );

      return config;
    },
  ]);
}

module.exports = withFixResourceBundleSigning;
