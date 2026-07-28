// Fixes the broken @stripe/stripe-terminal-react-native Expo config plugin.
// The plugin crashes Android prebuild by accessing iOS-only appDelegate
// unconditionally. We fix it two ways:
//   1. Remove "plugin" from expo-module.config.json so Expo never auto-registers it
//   2. Replace the plugin JS with a no-op as a belt-and-suspenders fallback
// All required permissions are declared directly in app.json.
const fs = require('fs');
const path = require('path');

const pkgRoot = path.join(
  __dirname,
  '..',
  'node_modules',
  '@stripe',
  'stripe-terminal-react-native'
);

// 1. Patch expo-module.config.json to remove the plugin auto-registration
const moduleConfigPath = path.join(pkgRoot, 'expo-module.config.json');
if (fs.existsSync(moduleConfigPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(moduleConfigPath, 'utf8'));
    if (config.plugin) {
      delete config.plugin;
      fs.writeFileSync(moduleConfigPath, JSON.stringify(config, null, 2) + '\n');
      console.log('[patch-stripe-plugin] Removed plugin from expo-module.config.json');
    } else {
      console.log('[patch-stripe-plugin] expo-module.config.json already has no plugin field');
    }
  } catch (e) {
    console.error('[patch-stripe-plugin] Failed to patch expo-module.config.json:', e.message);
  }
} else {
  console.log('[patch-stripe-plugin] expo-module.config.json not found, skipping');
}

// 2. Also replace withStripeTerminal.js with a no-op
const pluginPath = path.join(
  pkgRoot,
  'lib',
  'commonjs',
  'plugin',
  'withStripeTerminal.js'
);
if (fs.existsSync(pluginPath)) {
  fs.writeFileSync(pluginPath, 'module.exports = (config) => config;\n');
  console.log('[patch-stripe-plugin] Replaced withStripeTerminal.js with no-op');
} else {
  console.log('[patch-stripe-plugin] withStripeTerminal.js not found, skipping');
}
