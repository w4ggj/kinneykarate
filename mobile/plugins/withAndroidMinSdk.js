const { withProjectBuildGradle, withAppBuildGradle } = require('@expo/config-plugins');

function patchMinSdk(contents) {
  // Patch ext block: minSdkVersion = 24  or  minSdkVersion 24
  return contents.replace(/minSdkVersion\s*=?\s*\d+/g, 'minSdkVersion = 26');
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
