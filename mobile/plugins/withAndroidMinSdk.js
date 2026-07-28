const { withProjectBuildGradle, withAppBuildGradle, withGradleProperties } = require('@expo/config-plugins');

function patchMinSdk(contents) {
  // Handles: minSdkVersion = Integer.parseInt(findProperty('android.minSdkVersion') ?: '24')
  // The nested parens break [^)]+ so use a greedy match up to the line end instead
  return contents
    .replace(/minSdkVersion\s*=\s*Integer\.parseInt\(.*?\)/g, 'minSdkVersion = 26')
    .replace(/minSdkVersion\s*=?\s*\d+/g, 'minSdkVersion = 26');
}

module.exports = (config) => {
  // Patch gradle.properties so findProperty('android.minSdkVersion') returns 26
  config = withGradleProperties(config, (config) => {
    const props = config.modResults;
    const idx = props.findIndex(p => p.type === 'property' && p.key === 'android.minSdkVersion');
    if (idx >= 0) {
      props[idx].value = '26';
    } else {
      props.push({ type: 'property', key: 'android.minSdkVersion', value: '26' });
    }
    return config;
  });

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
