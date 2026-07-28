const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = (config) =>
  withAppBuildGradle(config, (config) => {
    config.modResults.contents = config.modResults.contents.replace(
      /minSdkVersion\s*=?\s*\d+/,
      'minSdkVersion = 26'
    );
    return config;
  });
