const { withProjectBuildGradle, withAppBuildGradle } = require('@expo/config-plugins');

function patchMinSdk(contents) {
  // Expo SDK 52 generates: minSdkVersion = Integer.parseInt(findProperty('android.minSdkVersion') ?: '24')
  // Also handles plain: minSdkVersion = 24  or  minSdkVersion 24
  return contents
    .replace(/minSdkVersion\s*=\s*Integer\.parseInt\([^)]+\)/g, 'minSdkVersion = 26')
    .replace(/minSdkVersion\s*=?\s*\d+/g, 'minSdkVersion = 26');
}

module.exports = (config) => {
  config = withProjectBuildGradle(config, (config) => {
    config.modResults.contents = patchMinSdk(config.modResults.contents);
    return config;
  });
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = patchMinSdk(config.modResults.contents);
    return config;
  });
  return config;
};
